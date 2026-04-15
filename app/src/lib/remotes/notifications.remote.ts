import { command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, or, lt, desc, sql, inArray } from 'drizzle-orm';

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
export const getNotifications = command(
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
			conditions.push(lt(table.notification.updatedAt, new Date(cursor)));
		}

		const items = await db
			.select()
			.from(table.notification)
			.where(and(...conditions))
			.orderBy(desc(table.notification.updatedAt))
			.limit(limit + 1);

		const hasMore = items.length > limit;
		const results = hasMore ? items.slice(0, limit) : items;
		const nextCursor = hasMore ? results[results.length - 1].updatedAt.toISOString() : null;

		return { items: results, nextCursor };
	}
);

/**
 * Get the count of unread notifications for the current user.
 */
export const getUnreadCount = command(async () => {
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

/**
 * Get count of unread urgent+high priority notifications (for badge).
 */
export const getUrgentUnreadCount = command(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	const [result] = await db
		.select({ count: sql<number>`count(*)`.as('count') })
		.from(table.notification)
		.where(and(
			getNotificationConditions(event),
			eq(table.notification.isRead, false),
			inArray(table.notification.priority, ['urgent', 'high'])
		));

	return { count: Number(result?.count) || 0 };
});
