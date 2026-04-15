import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc, sql, isNotNull } from 'drizzle-orm';
import {
	sendInvoiceEmail,
	sendInvoicePaidEmail,
	sendOverdueReminderEmail,
	sendTaskAssignmentEmail,
	sendTaskUpdateEmail,
	sendTaskClientNotificationEmail,
	sendTaskReminderEmail,
	EMAIL_SEND_REGISTRY,
	clearTenantTransporterCache
} from '$lib/server/email';

export const getEmailLogs = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}
	if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
		throw new Error('Forbidden: Admin access required');
	}

	return await db
		.select({
			id: table.emailLog.id,
			tenantId: table.emailLog.tenantId,
			toEmail: table.emailLog.toEmail,
			subject: table.emailLog.subject,
			emailType: table.emailLog.emailType,
			status: table.emailLog.status,
			attempts: table.emailLog.attempts,
			maxAttempts: table.emailLog.maxAttempts,
			errorMessage: table.emailLog.errorMessage,
			smtpMessageId: table.emailLog.smtpMessageId,
			smtpResponse: table.emailLog.smtpResponse,
			processedAt: table.emailLog.processedAt,
			completedAt: table.emailLog.completedAt,
			metadata: table.emailLog.metadata,
			createdAt: table.emailLog.createdAt,
			updatedAt: table.emailLog.updatedAt,
			hasHtmlBody: sql<boolean>`(${table.emailLog.htmlBody} IS NOT NULL AND ${table.emailLog.htmlBody} != '')`.as('has_html_body'),
			hasPayload: sql<boolean>`(${table.emailLog.payload} IS NOT NULL)`.as('has_payload')
		})
		.from(table.emailLog)
		.where(eq(table.emailLog.tenantId, event.locals.tenant.id))
		.orderBy(desc(table.emailLog.createdAt))
		.limit(500);
});

export const getEmailLogStats = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}
	if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
		throw new Error('Forbidden: Admin access required');
	}

	const tenantId = event.locals.tenant.id;

	const [stats] = await db
		.select({
			pending: sql<number>`sum(case when ${table.emailLog.status} = 'pending' then 1 else 0 end)`,
			active: sql<number>`sum(case when ${table.emailLog.status} = 'active' then 1 else 0 end)`,
			completed: sql<number>`sum(case when ${table.emailLog.status} = 'completed' then 1 else 0 end)`,
			failed: sql<number>`sum(case when ${table.emailLog.status} = 'failed' then 1 else 0 end)`,
			delayed: sql<number>`sum(case when ${table.emailLog.status} = 'delayed' then 1 else 0 end)`
		})
		.from(table.emailLog)
		.where(eq(table.emailLog.tenantId, tenantId));

	return {
		pending: stats?.pending ?? 0,
		active: stats?.active ?? 0,
		completed: stats?.completed ?? 0,
		failed: stats?.failed ?? 0,
		delayed: stats?.delayed ?? 0
	};
});

export const deleteEmailLog = command(v.pipe(v.string(), v.minLength(1)), async (logId) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}
	if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
		throw new Error('Forbidden: Admin access required');
	}

	await db
		.delete(table.emailLog)
		.where(
			and(eq(table.emailLog.id, logId), eq(table.emailLog.tenantId, event.locals.tenant.id))
		);
	return { success: true };
});

export const deleteAllEmailLogs = command(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}
	if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
		throw new Error('Forbidden: Admin access required');
	}

	await db.delete(table.emailLog).where(eq(table.emailLog.tenantId, event.locals.tenant.id));
	return { success: true };
});

/**
 * Legacy retry path for `email_log` rows created before the `payload` column existed.
 * New rows use the payload-based dispatcher (see `dispatchPayloadRetry`).
 */
const LEGACY_RETRYABLE_EMAIL_TYPES = new Set([
	'invoice',
	'invoice-paid',
	'invoice-overdue-reminder',
	'task-assignment',
	'task-update',
	'task-client-notification',
	'task-reminder'
]);

async function dispatchLegacyRetry(log: typeof table.emailLog.$inferSelect): Promise<void> {
	if (!LEGACY_RETRYABLE_EMAIL_TYPES.has(log.emailType)) {
		throw new Error('Acest tip de email nu poate fi retrimis automat (rând legacy fără payload)');
	}
	const metadata = log.metadata ? JSON.parse(log.metadata) : {};
	switch (log.emailType) {
		case 'invoice':
			await sendInvoiceEmail(metadata.invoiceId, log.toEmail);
			break;
		case 'invoice-paid':
			await sendInvoicePaidEmail(metadata.invoiceId, log.toEmail);
			break;
		case 'invoice-overdue-reminder':
			await sendOverdueReminderEmail(
				metadata.invoiceId,
				log.toEmail,
				metadata.daysOverdue || 0,
				metadata.reminderNumber || 1
			);
			break;
		case 'task-assignment':
			await sendTaskAssignmentEmail(metadata.taskId, log.toEmail);
			break;
		case 'task-update':
			await sendTaskUpdateEmail(metadata.taskId, log.toEmail, undefined, metadata.changeType);
			break;
		case 'task-client-notification':
			await sendTaskClientNotificationEmail(
				metadata.taskId,
				log.toEmail,
				'',
				metadata.notificationType || 'modified',
				{
					newStatus: metadata.newStatus,
					commentPreview: metadata.commentPreview,
					changedFields: metadata.changedFields
				}
			);
			break;
		case 'task-reminder':
			await sendTaskReminderEmail(metadata.taskId, log.toEmail);
			break;
	}
}

/**
 * Payload-based retry — works for any email type that uses `sendWithPersistence` with
 * a non-null payload. Auto-covers new email types without needing changes here.
 */
async function dispatchPayloadRetry(log: typeof table.emailLog.$inferSelect): Promise<void> {
	const parsed = JSON.parse(log.payload!) as { sendFn: string; args: unknown[] };
	const handler = EMAIL_SEND_REGISTRY[parsed.sendFn];
	if (!handler) {
		throw new Error(`Handler necunoscut: ${parsed.sendFn}`);
	}
	await handler(...parsed.args);
}

export const retryEmailLog = command(v.pipe(v.string(), v.minLength(1)), async (logId) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}
	if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
		throw new Error('Forbidden: Admin access required');
	}

	const [log] = await db
		.select()
		.from(table.emailLog)
		.where(and(eq(table.emailLog.id, logId), eq(table.emailLog.tenantId, event.locals.tenant.id)))
		.limit(1);

	if (!log) throw new Error('Log not found');
	if (log.status !== 'failed') throw new Error('Doar emailurile esuate pot fi retrimise');

	// Force fresh decryption — admin may have just re-saved SMTP password.
	if (log.tenantId) {
		clearTenantTransporterCache(log.tenantId);
	}

	// Delete the old failed log entry first — the send function creates a new log via
	// sendWithPersistence (or via the legacy code path).
	await db.delete(table.emailLog).where(eq(table.emailLog.id, logId));

	if (log.payload) {
		await dispatchPayloadRetry(log);
	} else {
		await dispatchLegacyRetry(log);
	}

	return { success: true };
});

/**
 * Bulk retry: replay every failed email for the current tenant that has a payload.
 * Useful after re-saving SMTP password to recover all vanished emails in one click.
 */
export const retryAllFailedEmails = command(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}
	if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
		throw new Error('Forbidden: Admin access required');
	}

	const tenantId = event.locals.tenant.id;

	// Force fresh decryption once for the tenant.
	clearTenantTransporterCache(tenantId);

	const rows = await db
		.select()
		.from(table.emailLog)
		.where(
			and(
				eq(table.emailLog.tenantId, tenantId),
				eq(table.emailLog.status, 'failed'),
				isNotNull(table.emailLog.payload)
			)
		);

	let processed = 0;
	let recovered = 0;

	for (const row of rows) {
		processed++;
		try {
			await db.delete(table.emailLog).where(eq(table.emailLog.id, row.id));
			await dispatchPayloadRetry(row);
			recovered++;
		} catch {
			// New row already records the new failure; nothing else to do.
		}
	}

	return { processed, recovered };
});
