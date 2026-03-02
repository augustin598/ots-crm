import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';

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
