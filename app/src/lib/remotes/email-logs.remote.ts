import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import {
	sendInvoiceEmail,
	sendInvoicePaidEmail,
	sendOverdueReminderEmail,
	sendTaskAssignmentEmail,
	sendTaskUpdateEmail,
	sendTaskClientNotificationEmail,
	sendTaskReminderEmail
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
		.select()
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

const RETRYABLE_EMAIL_TYPES = new Set([
	'invoice',
	'invoice-paid',
	'invoice-overdue-reminder',
	'task-assignment',
	'task-update',
	'task-client-notification',
	'task-reminder'
]);

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
	if (!RETRYABLE_EMAIL_TYPES.has(log.emailType)) {
		throw new Error('Acest tip de email nu poate fi retrimis automat');
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

	return { success: true };
});
