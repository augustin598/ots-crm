import { query, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, or, lt, desc, sql } from 'drizzle-orm';

/**
 * Build the WHERE condition for notifications.
 * - Admin users: notifications addressed to their userId
 * - Client users: notifications addressed to their userId OR linked to their clientId
 */
function getNotificationConditions(event: ReturnType<typeof getRequestEvent>) {
	const tenantId = event!.locals.tenant!.id;
	const userId = event!.locals.user!.id;
	const clientId = (event!.locals as any).client?.id as string | undefined;

	const userCondition = eq(table.notification.userId, userId);

	// Client portal users also see notifications scoped to their client
	const matchCondition = clientId
		? or(userCondition, eq(table.notification.clientId, clientId))
		: userCondition;

	return and(eq(table.notification.tenantId, tenantId), matchCondition);
}

/**
 * Get the latest notifications for the current user in the current tenant.
 */
export const getNotifications = query(
	v.object({
		limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(50))),
		cursor: v.optional(v.string())
	}),
	async ({ limit = 20, cursor }) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const conditions = [getNotificationConditions(event)];
		if (cursor) {
			conditions.push(lt(table.notification.createdAt, new Date(cursor)));
		}

		const items = await db
			.select()
			.from(table.notification)
			.where(and(...conditions))
			.orderBy(desc(table.notification.createdAt))
			.limit(limit + 1);

		const hasMore = items.length > limit;
		const results = hasMore ? items.slice(0, limit) : items;
		const nextCursor = hasMore ? results[results.length - 1].createdAt.toISOString() : null;

		return { items: results, nextCursor };
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
		.where(and(getNotificationConditions(event), eq(table.notification.isRead, false)));

	return { count: Number(result?.count) || 0 };
});
