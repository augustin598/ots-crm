/**
 * Notificări de task în grupul WhatsApp legat de task (etapa 2).
 *
 * Echivalentul lui `telegram/task-notifications.ts`, dar cu o diferență de
 * livrare: aici nu trimitem direct, punem în `whatsapp_outbox`, fiindcă
 * socketul Baileys poate fi pe altă instanță (vezi `outbox.ts`).
 *
 * Nu se abonează la `task.completed`: `done` vine tot prin
 * `task.status-changed`, altfel am trimite de două ori.
 */
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { logWarning } from '$lib/server/logger';
import { getAppBaseUrl } from '$lib/server/app-url';
import type { TaskStatusChangedEvent } from '$lib/server/plugins/types';
import { enqueueGroupMessage } from './outbox';
import { statusDedupeKey } from './outbox-policy';
import { getUserWhatsappPhonesBatch } from './resolve-phone';
import { buildLinkedTaskMessage, buildMentionMessage, buildStatusMessage, notifiesGroup } from './task-messages';

/**
 * Linkul din grup e cel din portalul clientului, nu din admin: în grup sunt
 * oamenii clientului. Același format ca `buildTaskUrl(kind='client')` din
 * task-recipients.ts.
 */
function taskUrl(tenantSlug: string, taskId: string): string {
	return `${getAppBaseUrl()}/client/${tenantSlug}/tasks/${taskId}`;
}

/** Grupul legat de task, doar dacă e încă bifat în inbox. */
async function linkedWatchedGroup(tenantId: string, taskId: string): Promise<string | null> {
	const [row] = await db
		.select({ groupJid: table.whatsappGroup.groupJid, watched: table.whatsappGroup.watched })
		.from(table.task)
		.innerJoin(table.whatsappGroup, eq(table.whatsappGroup.id, table.task.whatsappGroupId))
		.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, tenantId)))
		.limit(1);
	if (!row) return null;
	if (!row.watched) {
		logWarning('whatsapp', 'task legat de un grup debifat; notificarea nu pleacă', {
			tenantId,
			metadata: { taskId, groupJid: row.groupJid }
		});
		return null;
	}
	return row.groupJid;
}

async function userDisplayName(userId: string): Promise<string> {
	const [u] = await db
		.select({ firstName: table.user.firstName, lastName: table.user.lastName, email: table.user.email })
		.from(table.user)
		.where(eq(table.user.id, userId))
		.limit(1);
	if (!u) return 'Cineva';
	return `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email;
}

export async function notifyTaskStatusChangedInGroup(event: TaskStatusChangedEvent): Promise<void> {
	if (!notifiesGroup(event.newStatus)) return;
	const groupJid = await linkedWatchedGroup(event.tenantId, event.taskId);
	if (!groupJid) return;

	const actorName = await userDisplayName(event.changedByUserId);
	const body = buildStatusMessage({
		taskTitle: event.taskTitle,
		actorName,
		oldStatus: event.oldStatus,
		newStatus: event.newStatus,
		taskUrl: taskUrl(event.tenantSlug, event.taskId)
	});

	await enqueueGroupMessage({
		tenantId: event.tenantId,
		groupJid,
		kind: 'task.status',
		dedupeKey: statusDedupeKey(event.taskId, groupJid),
		taskId: event.taskId,
		body
	});
}

export async function notifyTaskMentionInGroup(payload: {
	tenantId: string;
	tenantSlug: string;
	taskId: string;
	taskTitle: string;
	authorUserId: string;
	authorName: string;
	/** Toți cei menționați în comentariu; autorul se scoate aici. */
	mentioned: Array<{ userId: string; name: string }>;
	commentHtml: string;
}): Promise<void> {
	const targets = payload.mentioned.filter((m) => m.userId !== payload.authorUserId);
	if (targets.length === 0) return;
	const groupJid = await linkedWatchedGroup(payload.tenantId, payload.taskId);
	if (!groupJid) return;

	const phones = await getUserWhatsappPhonesBatch(
		payload.tenantId,
		targets.map((m) => m.userId)
	);
	const { text, mentions } = buildMentionMessage({
		taskTitle: payload.taskTitle,
		authorName: payload.authorName,
		mentioned: targets.map((m) => ({ name: m.name, phoneE164: phones.get(m.userId) ?? null })),
		commentHtml: payload.commentHtml,
		taskUrl: taskUrl(payload.tenantSlug, payload.taskId)
	});

	await enqueueGroupMessage({
		tenantId: payload.tenantId,
		groupJid,
		kind: 'task.mention',
		taskId: payload.taskId,
		body: text,
		mentions
	});
}

/**
 * La legarea task-ului de grup: prezentarea lui. Grupul a fost deja validat
 * (bifat) de `setTaskWhatsappGroup`, de aceea primim JID-ul direct.
 */
export async function notifyTaskLinkedToGroup(payload: {
	tenantId: string;
	tenantSlug: string;
	taskId: string;
	taskTitle: string;
	status: string;
	assigneeName: string | null;
	dueDate: Date | null;
	actorUserId: string;
	groupJid: string;
}): Promise<void> {
	const actorName = await userDisplayName(payload.actorUserId);
	const body = buildLinkedTaskMessage({
		taskTitle: payload.taskTitle,
		actorName,
		status: payload.status,
		assigneeName: payload.assigneeName,
		dueDate: payload.dueDate,
		taskUrl: taskUrl(payload.tenantSlug, payload.taskId)
	});
	await enqueueGroupMessage({
		tenantId: payload.tenantId,
		groupJid: payload.groupJid,
		kind: 'task.linked',
		taskId: payload.taskId,
		body
	});
}
