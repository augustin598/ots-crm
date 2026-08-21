import { command, getRequestEvent, query } from '$app/server';
import * as v from 'valibot';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { requireStaff } from '$lib/server/get-actor';
import { kickOutbox } from '$lib/server/whatsapp/outbox';

/**
 * Coada WhatsApp din Admin → Logs și Debug: ce a plecat și ce n-a plecat în
 * grupuri, pe același calapod cu coada de email. Doar owner/admin.
 */
async function assertAdmin() {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	await requireStaff(event);
	const role = event.locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') throw new Error('Forbidden: Admin access required');
	return { tenantId: event.locals.tenant.id };
}

const OUTBOX_STATUSES = ['queued', 'sending', 'sent', 'failed', 'expired'] as const;

export const getWhatsappOutbox = query(async () => {
	const { tenantId } = await assertAdmin();

	return db
		.select({
			id: table.whatsappOutbox.id,
			groupJid: table.whatsappOutbox.groupJid,
			groupSubject: table.whatsappGroup.subject,
			kind: table.whatsappOutbox.kind,
			taskId: table.whatsappOutbox.taskId,
			taskTitle: table.task.title,
			body: table.whatsappOutbox.body,
			status: table.whatsappOutbox.status,
			attempts: table.whatsappOutbox.attempts,
			nextAttemptAt: table.whatsappOutbox.nextAttemptAt,
			sentAt: table.whatsappOutbox.sentAt,
			wamId: table.whatsappOutbox.wamId,
			lastError: table.whatsappOutbox.lastError,
			createdAt: table.whatsappOutbox.createdAt
		})
		.from(table.whatsappOutbox)
		.leftJoin(
			table.whatsappGroup,
			and(
				eq(table.whatsappGroup.tenantId, table.whatsappOutbox.tenantId),
				eq(table.whatsappGroup.groupJid, table.whatsappOutbox.groupJid)
			)
		)
		.leftJoin(table.task, eq(table.task.id, table.whatsappOutbox.taskId))
		.where(eq(table.whatsappOutbox.tenantId, tenantId))
		.orderBy(desc(table.whatsappOutbox.createdAt))
		.limit(500);
});

export const getWhatsappOutboxStats = query(async () => {
	const { tenantId } = await assertAdmin();
	const rows = await db
		.select({ status: table.whatsappOutbox.status, n: sql<number>`count(*)` })
		.from(table.whatsappOutbox)
		.where(eq(table.whatsappOutbox.tenantId, tenantId))
		.groupBy(table.whatsappOutbox.status);
	const stats: Record<(typeof OUTBOX_STATUSES)[number], number> = {
		queued: 0,
		sending: 0,
		sent: 0,
		failed: 0,
		expired: 0
	};
	for (const r of rows) {
		if (r.status in stats) stats[r.status as keyof typeof stats] = Number(r.n);
	}
	return stats;
});

/** Pune din nou în coadă un rând picat sau expirat; pleacă la următoarea golire. */
export const retryWhatsappOutbox = command(v.pipe(v.string(), v.minLength(1)), async (id) => {
	const { tenantId } = await assertAdmin();
	const now = new Date();
	const res = await db
		.update(table.whatsappOutbox)
		.set({ status: 'queued', nextAttemptAt: now, lastError: null, updatedAt: now })
		.where(
			and(
				eq(table.whatsappOutbox.id, id),
				eq(table.whatsappOutbox.tenantId, tenantId),
				inArray(table.whatsappOutbox.status, ['failed', 'expired'])
			)
		);
	if ((res.rowsAffected ?? 0) === 0) throw new Error('Rândul nu mai e picat sau expirat.');
	kickOutbox(tenantId);
	return { success: true };
});

export const retryAllFailedWhatsappOutbox = command(async () => {
	const { tenantId } = await assertAdmin();
	const now = new Date();
	const res = await db
		.update(table.whatsappOutbox)
		.set({ status: 'queued', nextAttemptAt: now, lastError: null, updatedAt: now })
		.where(
			and(
				eq(table.whatsappOutbox.tenantId, tenantId),
				inArray(table.whatsappOutbox.status, ['failed', 'expired'])
			)
		);
	kickOutbox(tenantId);
	return { requeued: res.rowsAffected ?? 0 };
});

export const deleteWhatsappOutbox = command(v.pipe(v.string(), v.minLength(1)), async (id) => {
	const { tenantId } = await assertAdmin();
	await db
		.delete(table.whatsappOutbox)
		.where(and(eq(table.whatsappOutbox.id, id), eq(table.whatsappOutbox.tenantId, tenantId)));
	return { success: true };
});

/** Șterge doar ce nu mai e în lucru; rândurile `queued`/`sending` rămân. */
export const deleteFinishedWhatsappOutbox = command(async () => {
	const { tenantId } = await assertAdmin();
	const res = await db
		.delete(table.whatsappOutbox)
		.where(
			and(
				eq(table.whatsappOutbox.tenantId, tenantId),
				inArray(table.whatsappOutbox.status, ['sent', 'failed', 'expired'])
			)
		);
	return { deleted: res.rowsAffected ?? 0 };
});
