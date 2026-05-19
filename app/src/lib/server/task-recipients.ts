/**
 * Single source of truth for resolving email notification recipients
 * for task events (assignment, comment, status change).
 *
 * Resolves:
 *  - All current assignees (agency staff + clientUsers)
 *  - All watchers (agency only — clientUsers don't watch)
 *  - Mentioned users (passed in by caller, since mention extraction lives
 *    in the comment HTML parser)
 *
 * Applies:
 *  - actor exclusion (an event never emails its own actor)
 *  - per-clientUser preference gates (notifyTaskAssigned / notifyNewComment /
 *    notifyTaskStatusChange) — agency staff have no per-user opt-out
 *  - case-insensitive email dedup across the final recipient set
 *  - URL routing by recipient kind:
 *      agency  → `/{tenantSlug}/tasks/{taskId}`
 *      client  → `/client/{tenantSlug}/tasks/{taskId}`
 *
 * Design intent:
 *  - Personal assignment is "intentful" — it is NOT gated by the tenant
 *    master switch `taskSettings.clientEmailsEnabled`. That toggle still
 *    gates the legacy company-level pathway (handled separately by
 *    `sendClientNotificationIfEnabled` in tasks.remote.ts).
 *  - Agency staff always get assignment/comment/status emails when
 *    they're a current assignee, watcher, or mention. No opt-out yet.
 */

import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { env as publicEnv } from '$env/dynamic/public';

export type TaskEvent = 'assigned' | 'comment' | 'status-change';

export type RecipientKind = 'agency' | 'client';

export type RecipientReason = 'assignee' | 'watcher' | 'mention';

export interface TaskRecipient {
	userId: string;
	email: string;
	name: string;
	kind: RecipientKind;
	taskUrl: string;
	reason: RecipientReason;
}

interface CandidateRow {
	userId: string;
	email: string | null;
	firstName: string | null;
	lastName: string | null;
	kind: RecipientKind;
	reason: RecipientReason;
}

const baseUrl = () => publicEnv.PUBLIC_APP_URL || 'http://localhost:5173';

function buildTaskUrl(tenantSlug: string, taskId: string, kind: RecipientKind): string {
	const base = baseUrl();
	return kind === 'client'
		? `${base}/client/${tenantSlug}/tasks/${taskId}`
		: `${base}/${tenantSlug}/tasks/${taskId}`;
}

function displayName(firstName: string | null, lastName: string | null, fallback: string): string {
	const n = `${firstName ?? ''} ${lastName ?? ''}`.trim();
	return n || fallback;
}

/**
 * Returns the de-duplicated, prefs-gated, URL-routed recipient list for a
 * task event. Caller is responsible for actually sending the emails
 * (typically via `sendTaskAssignmentEmail` for `assigned`, or
 * `sendTaskUpdateEmail` for `comment`/`status-change`).
 *
 * The caller MUST pass `actorUserId` so the originator of the event is
 * never emailed about their own action.
 *
 * For `comment` events, the caller passes `mentionedUserIds` (extracted
 * from the comment HTML). Mentions of non-tenant non-client users are
 * silently dropped.
 */
export async function resolveTaskRecipients(args: {
	tenantId: string;
	tenantSlug: string;
	taskId: string;
	event: TaskEvent;
	actorUserId: string;
	mentionedUserIds?: string[];
}): Promise<TaskRecipient[]> {
	const { tenantId, tenantSlug, taskId, event, actorUserId } = args;
	const mentionedUserIds = args.mentionedUserIds ?? [];

	// 1. Load assignees (LEFT JOIN agency + client memberships to classify).
	//    A user may appear in BOTH tenantUser and clientUser (e.g., agency
	//    staff also acting as a client portal user for a partner agency).
	//    Resolution: agency takes precedence — they live in the agency app.
	const assigneeRows = await db
		.select({
			userId: table.taskAssignee.userId,
			email: table.user.email,
			firstName: table.user.firstName,
			lastName: table.user.lastName,
			isAgency: table.tenantUser.userId,
			isClient: table.clientUser.userId
		})
		.from(table.taskAssignee)
		.innerJoin(table.user, eq(table.user.id, table.taskAssignee.userId))
		.leftJoin(
			table.tenantUser,
			and(
				eq(table.tenantUser.userId, table.taskAssignee.userId),
				eq(table.tenantUser.tenantId, tenantId)
			)
		)
		.leftJoin(
			table.clientUser,
			and(
				eq(table.clientUser.userId, table.taskAssignee.userId),
				eq(table.clientUser.tenantId, tenantId)
			)
		)
		.where(
			and(
				eq(table.taskAssignee.taskId, taskId),
				eq(table.taskAssignee.tenantId, tenantId)
			)
		);

	const candidates: CandidateRow[] = assigneeRows.map((r) => ({
		userId: r.userId,
		email: r.email,
		firstName: r.firstName,
		lastName: r.lastName,
		kind: r.isAgency ? 'agency' : r.isClient ? 'client' : 'agency',
		reason: 'assignee' as RecipientReason
	}));

	// 2. Load watchers (agency only — the watcher table is agency-scoped).
	//    Only useful for `comment` events; assignment/status emails go to
	//    assignees, not watchers.
	if (event === 'comment') {
		const watcherRows = await db
			.select({
				userId: table.taskWatcher.userId,
				email: table.user.email,
				firstName: table.user.firstName,
				lastName: table.user.lastName
			})
			.from(table.taskWatcher)
			.innerJoin(table.user, eq(table.user.id, table.taskWatcher.userId))
			.where(
				and(
					eq(table.taskWatcher.taskId, taskId),
					eq(table.taskWatcher.tenantId, tenantId)
				)
			);

		for (const w of watcherRows) {
			candidates.push({
				userId: w.userId,
				email: w.email,
				firstName: w.firstName,
				lastName: w.lastName,
				kind: 'agency',
				reason: 'watcher'
			});
		}
	}

	// 3. Mentions (comment only). Classify via tenantUser/clientUser membership.
	if (event === 'comment' && mentionedUserIds.length > 0) {
		const mentioned = mentionedUserIds.filter((id) => id !== actorUserId);
		if (mentioned.length > 0) {
			const mentionRows = await db
				.select({
					userId: table.user.id,
					email: table.user.email,
					firstName: table.user.firstName,
					lastName: table.user.lastName,
					isAgency: table.tenantUser.userId,
					isClient: table.clientUser.userId
				})
				.from(table.user)
				.leftJoin(
					table.tenantUser,
					and(
						eq(table.tenantUser.userId, table.user.id),
						eq(table.tenantUser.tenantId, tenantId)
					)
				)
				.leftJoin(
					table.clientUser,
					and(
						eq(table.clientUser.userId, table.user.id),
						eq(table.clientUser.tenantId, tenantId)
					)
				)
				.where(inArray(table.user.id, mentioned));

			for (const m of mentionRows) {
				// Drop mentions of users with no tenant membership of any kind
				if (!m.isAgency && !m.isClient) continue;
				candidates.push({
					userId: m.userId,
					email: m.email,
					firstName: m.firstName,
					lastName: m.lastName,
					kind: m.isAgency ? 'agency' : 'client',
					reason: 'mention'
				});
			}
		}
	}

	// 4. Actor exclusion
	const filtered = candidates.filter((c) => c.userId !== actorUserId && !!c.email);
	if (filtered.length === 0) return [];

	// 5. Per-clientUser preference gate. Agency staff have no per-user
	//    opt-out (today). For client users, load clientUserPreferences and
	//    check the event-specific flag.
	const clientUserIds = [
		...new Set(filtered.filter((c) => c.kind === 'client').map((c) => c.userId))
	];

	let prefsMap = new Map<
		string,
		{ assigned: boolean; comment: boolean; statusChange: boolean }
	>();

	if (clientUserIds.length > 0) {
		const prefRows = await db
			.select({
				userId: table.clientUser.userId,
				notifyAssigned: table.clientUserPreferences.notifyTaskAssigned,
				notifyComment: table.clientUserPreferences.notifyNewComment,
				notifyStatus: table.clientUserPreferences.notifyTaskStatusChange
			})
			.from(table.clientUser)
			.leftJoin(
				table.clientUserPreferences,
				eq(table.clientUserPreferences.clientUserId, table.clientUser.id)
			)
			.where(
				and(
					inArray(table.clientUser.userId, clientUserIds),
					eq(table.clientUser.tenantId, tenantId)
				)
			);

		for (const r of prefRows) {
			prefsMap.set(r.userId, {
				assigned: r.notifyAssigned ?? true,
				comment: r.notifyComment ?? true,
				statusChange: r.notifyStatus ?? true
			});
		}
	}

	function passesPrefGate(c: CandidateRow): boolean {
		if (c.kind === 'agency') return true;
		const p = prefsMap.get(c.userId);
		if (!p) return true; // default ON when no prefs row exists
		if (event === 'assigned') return p.assigned;
		if (event === 'comment') return p.comment;
		if (event === 'status-change') return p.statusChange;
		return true;
	}

	// 6. Dedup by (userId) keeping the strongest reason (assignee > mention > watcher)
	//    plus dedup by case-insensitive email across kinds (the Lucian case).
	const reasonRank: Record<RecipientReason, number> = {
		assignee: 3,
		mention: 2,
		watcher: 1
	};

	const byUser = new Map<string, CandidateRow>();
	for (const c of filtered) {
		if (!passesPrefGate(c)) continue;
		const prev = byUser.get(c.userId);
		if (!prev || reasonRank[c.reason] > reasonRank[prev.reason]) {
			byUser.set(c.userId, c);
		}
	}

	// Email-level dedup (e.g., agency staff = client primary contact = same email)
	const byEmail = new Map<string, CandidateRow>();
	for (const c of byUser.values()) {
		const key = (c.email ?? '').toLowerCase().trim();
		if (!key) continue;
		const prev = byEmail.get(key);
		if (!prev) {
			byEmail.set(key, c);
			continue;
		}
		// Prefer agency over client for the same email (more reliable URL),
		// then prefer stronger reason.
		const preferNew =
			c.kind === 'agency' && prev.kind === 'client'
				? true
				: c.kind === prev.kind && reasonRank[c.reason] > reasonRank[prev.reason];
		if (preferNew) byEmail.set(key, c);
	}

	// 7. Build final recipients with kind-routed URLs
	const recipients: TaskRecipient[] = [];
	for (const c of byEmail.values()) {
		if (!c.email) continue;
		recipients.push({
			userId: c.userId,
			email: c.email,
			name: displayName(c.firstName, c.lastName, c.email),
			kind: c.kind,
			taskUrl: buildTaskUrl(tenantSlug, taskId, c.kind),
			reason: c.reason
		});
	}
	return recipients;
}

/**
 * Convenience: emails-only (lowercased, deduped) for the resolved set.
 * Useful for telling the legacy `sendClientNotificationIfEnabled` to skip
 * addresses already covered by the personal-assignment path.
 */
export function recipientEmailsLower(recipients: TaskRecipient[]): Set<string> {
	return new Set(recipients.map((r) => r.email.toLowerCase().trim()));
}
