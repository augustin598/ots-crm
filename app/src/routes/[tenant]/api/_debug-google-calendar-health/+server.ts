import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, desc, eq, like } from 'drizzle-orm';
import { getCalendarStatus, probeCalendarAccess } from '$lib/server/google-calendar/auth';
import { describeCalendarError } from '$lib/server/google-calendar/errors';
import { toNaiveDateTime } from '$lib/server/google-calendar/time';
import { MEET_TIMEZONE } from '$lib/server/google-calendar/task-meet-sync';
import { logInfo, serializeError } from '$lib/server/logger';
import type { RequestHandler } from './$types';

/**
 * Google Calendar / Meet health probe.
 *
 *   GET ?action=status              — integrarea din DB + probe REAL pe API-ul Google
 *   GET ?action=failures&limit=20   — ultimele eșecuri meet_event_failed, decodate
 *   GET ?action=task&taskId=xxx     — starea Meet a unui task + activitatea lui
 *
 * De ce există: pe 20 aug 2026 toate meeting-urile picau cu `SERVICE_DISABLED`
 * (Calendar API nedezactivat în proiectul Cloud), dar `getCalendarStatus` raporta
 * vesel "connected" fiindcă se uita doar la rândul din DB, iar eroarea reală
 * stătea îngropată în `task_activity.new_value`. Diagnosticul a cerut un query
 * manual pe baza de date. `action=status` face un apel real ca să distingă
 * "avem token" de "Google chiar ne acceptă scrierile".
 *
 * Admin-only, tenant-scoped pe locals.tenant.
 */

function requireAdmin(event: Parameters<RequestHandler>[0]) {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	const role = event.locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') {
		throw error(403, 'Forbidden: Admin access required');
	}
}

/** `meet_event_failed.new_value` is JSON; surface it decoded, not as a blob. */
function decodePayload(raw: string | null): Record<string, unknown> | { raw: string } | null {
	if (!raw) return null;
	try {
		return JSON.parse(raw) as Record<string, unknown>;
	} catch {
		return { raw };
	}
}

export const GET: RequestHandler = async (event) => {
	requireAdmin(event);
	const tenantId = event.locals.tenant!.id;
	const action = event.url.searchParams.get('action') ?? 'status';

	if (action === 'status') {
		const stored = await getCalendarStatus(tenantId);

		const [integration] = await db
			.select({
				email: table.googleCalendarIntegration.email,
				isActive: table.googleCalendarIntegration.isActive,
				tokenExpiresAt: table.googleCalendarIntegration.tokenExpiresAt,
				grantedScopes: table.googleCalendarIntegration.grantedScopes,
				createdAt: table.googleCalendarIntegration.createdAt,
				updatedAt: table.googleCalendarIntegration.updatedAt
			})
			.from(table.googleCalendarIntegration)
			.where(eq(table.googleCalendarIntegration.tenantId, tenantId))
			.limit(1);

		let scopes: string[] = [];
		try {
			scopes = integration?.grantedScopes ? JSON.parse(integration.grantedScopes) : [];
		} catch {
			scopes = [];
		}

		// The real question: will Google accept a write right now?
		const probe = await probeCalendarAccess(tenantId);
		const diagnosis = probe.ok ? null : describeCalendarError(new Error(probe.error ?? 'unknown'));

		logInfo('google-calendar', 'Health probe run', {
			tenantId,
			metadata: { ok: probe.ok, kind: diagnosis?.kind ?? null }
		});

		return json({
			ok: probe.ok,
			storedStatus: stored,
			integration: integration
				? {
						email: integration.email,
						isActive: integration.isActive,
						tokenExpiresAt: integration.tokenExpiresAt,
						connectedAt: integration.createdAt,
						updatedAt: integration.updatedAt,
						scopes,
						hasCalendarScope: scopes.some((s) => s.includes('auth/calendar'))
					}
				: null,
			probe: {
				ok: probe.ok,
				error: probe.error,
				kind: diagnosis?.kind ?? null,
				message: diagnosis?.message ?? null,
				actionUrl: diagnosis?.actionUrl ?? null
			},
			timezone: MEET_TIMEZONE,
			// Proves the wall-clock conversion the Meet flow will apply, so a
			// timezone regression shows up here instead of in someone's calendar.
			sampleTimeConversion: (() => {
				try {
					return {
						input: '2026-08-21T10:00',
						sentToGoogle: toNaiveDateTime('2026-08-21T10:00', MEET_TIMEZONE),
						serverTz: Intl.DateTimeFormat().resolvedOptions().timeZone
					};
				} catch (err) {
					return { error: serializeError(err) };
				}
			})()
		});
	}

	if (action === 'failures') {
		const limitRaw = Number(event.url.searchParams.get('limit') ?? 20);
		const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20;

		const rows = await db
			.select({
				taskId: table.taskActivity.taskId,
				taskTitle: table.task.title,
				action: table.taskActivity.action,
				newValue: table.taskActivity.newValue,
				createdAt: table.taskActivity.createdAt
			})
			.from(table.taskActivity)
			.innerJoin(table.task, eq(table.taskActivity.taskId, table.task.id))
			.where(
				and(
					eq(table.taskActivity.tenantId, tenantId),
					like(table.taskActivity.action, 'meet_event_%')
				)
			)
			.orderBy(desc(table.taskActivity.createdAt))
			.limit(limit);

		return json({
			count: rows.length,
			events: rows.map((r) => ({
				taskId: r.taskId,
				taskTitle: r.taskTitle,
				action: r.action,
				at: r.createdAt,
				payload: decodePayload(r.newValue)
			}))
		});
	}

	if (action === 'task') {
		const taskId = event.url.searchParams.get('taskId');
		if (!taskId) throw error(400, 'taskId is required');

		const [task] = await db
			.select({
				id: table.task.id,
				title: table.task.title,
				type: table.task.type,
				status: table.task.status,
				meetTime: table.task.meetTime,
				meetLink: table.task.meetLink,
				meetDurationMinutes: table.task.meetDurationMinutes,
				googleCalendarEventId: table.task.googleCalendarEventId,
				dueDate: table.task.dueDate,
				createdAt: table.task.createdAt,
				updatedAt: table.task.updatedAt
			})
			.from(table.task)
			.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, tenantId)))
			.limit(1);

		if (!task) throw error(404, 'Task not found');

		const activity = await db
			.select({
				action: table.taskActivity.action,
				newValue: table.taskActivity.newValue,
				createdAt: table.taskActivity.createdAt
			})
			.from(table.taskActivity)
			.where(
				and(
					eq(table.taskActivity.taskId, taskId),
					eq(table.taskActivity.tenantId, tenantId),
					like(table.taskActivity.action, 'meet_event_%')
				)
			)
			.orderBy(desc(table.taskActivity.createdAt))
			.limit(50);

		let willSendToGoogle: string | null = null;
		let timeError: string | null = null;
		if (task.meetTime) {
			try {
				willSendToGoogle = toNaiveDateTime(task.meetTime, MEET_TIMEZONE);
			} catch (err) {
				timeError = err instanceof Error ? err.message : String(err);
			}
		}

		return json({
			task,
			diagnosis: {
				hasCalendarEvent: Boolean(task.googleCalendarEventId),
				hasMeetLink: Boolean(task.meetLink),
				isMeetingType: task.type === 'meeting',
				willSendToGoogle,
				timeError,
				timezone: MEET_TIMEZONE
			},
			meetActivity: activity.map((a) => ({
				action: a.action,
				at: a.createdAt,
				payload: decodePayload(a.newValue)
			}))
		});
	}

	throw error(400, `Unknown action: ${action}`);
};
