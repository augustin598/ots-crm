import { query, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';

/**
 * Get the latest notifications for the current user in the current tenant.
 */
export const getNotifications = query(
	v.object({ limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(50))) }),
	async ({ limit = 20 }) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		return await db
			.select()
			.from(table.notification)
			.where(
				and(
					eq(table.notification.userId, event.locals.user.id),
					eq(table.notification.tenantId, event.locals.tenant.id)
				)
			)
			.orderBy(desc(table.notification.createdAt))
			.limit(limit);
	}
);

/**
 * Get the count of unread notifications for the current user.
 */
export const getUnreadCount = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	const [result] = await db
		.select({ count: sql<number>`count(*)`.as('count') })
		.from(table.notification)
		.where(
			and(
				eq(table.notification.userId, event.locals.user.id),
				eq(table.notification.tenantId, event.locals.tenant.id),
				eq(table.notification.isRead, false)
			)
		);

	return { count: Number(result?.count) || 0 };
});
