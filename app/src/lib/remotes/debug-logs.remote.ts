import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc, count, sql } from 'drizzle-orm';

export const getDebugLogs = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}
	if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
		throw new Error('Forbidden: Admin access required');
	}

	return await db
		.select({
			id: table.debugLog.id,
			tenantId: table.debugLog.tenantId,
			level: table.debugLog.level,
			source: table.debugLog.source,
			message: table.debugLog.message,
			url: table.debugLog.url,
			stackTrace: table.debugLog.stackTrace,
			metadata: table.debugLog.metadata,
			userId: table.debugLog.userId,
			createdAt: table.debugLog.createdAt,
			userName: table.user.firstName
		})
		.from(table.debugLog)
		.leftJoin(table.user, eq(table.debugLog.userId, table.user.id))
		.where(eq(table.debugLog.tenantId, event.locals.tenant.id))
		.orderBy(desc(table.debugLog.createdAt))
		.limit(500);
});

export const getDebugLogStats = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}
	if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
		throw new Error('Forbidden: Admin access required');
	}

	const tenantId = event.locals.tenant.id;
	const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

	const [stats] = await db
		.select({
			total: count(),
			errors: sql<number>`sum(case when ${table.debugLog.level} = 'error' then 1 else 0 end)`,
			warnings: sql<number>`sum(case when ${table.debugLog.level} = 'warning' then 1 else 0 end)`,
			infos: sql<number>`sum(case when ${table.debugLog.level} = 'info' then 1 else 0 end)`,
			errors24h: sql<number>`sum(case when ${table.debugLog.level} = 'error' and ${table.debugLog.createdAt} >= ${twentyFourHoursAgo} then 1 else 0 end)`
		})
		.from(table.debugLog)
		.where(eq(table.debugLog.tenantId, tenantId));

	return {
		total: stats?.total ?? 0,
		errors: stats?.errors ?? 0,
		warnings: stats?.warnings ?? 0,
		infos: stats?.infos ?? 0,
		errors24h: stats?.errors24h ?? 0
	};
});

export const deleteDebugLog = command(v.pipe(v.string(), v.minLength(1)), async (logId) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}
	if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
		throw new Error('Forbidden: Admin access required');
	}

	await db
		.delete(table.debugLog)
		.where(
			and(eq(table.debugLog.id, logId), eq(table.debugLog.tenantId, event.locals.tenant.id))
		);
	return { success: true };
});

export const deleteDebugLogsByLevel = command(
	v.picklist(['info', 'warning', 'error']),
	async (level) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}
		if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
			throw new Error('Forbidden: Admin access required');
		}

		await db
			.delete(table.debugLog)
			.where(
				and(
					eq(table.debugLog.tenantId, event.locals.tenant.id),
					eq(table.debugLog.level, level)
				)
			);
		return { success: true };
	}
);

export const deleteAllDebugLogs = command(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}
	if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
		throw new Error('Forbidden: Admin access required');
	}

	await db.delete(table.debugLog).where(eq(table.debugLog.tenantId, event.locals.tenant.id));
	return { success: true };
});
