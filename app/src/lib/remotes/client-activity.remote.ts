import { query, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc, lt } from 'drizzle-orm';

/**
 * Get activity feed (notifications) for a specific client.
 * Supports cursor-based pagination.
 */
export const getClientActivity = query(
	v.object({
		clientId: v.string(),
		limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(50))),
		cursor: v.optional(v.string()) // ISO timestamp for cursor-based pagination
	}),
	async ({ clientId, limit = 30, cursor }) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const conditions = [
			eq(table.notification.tenantId, event.locals.tenant.id),
			eq(table.notification.clientId, clientId)
		];

		if (cursor) {
			conditions.push(lt(table.notification.createdAt, new Date(cursor)));
		}

		const items = await db
			.select()
			.from(table.notification)
			.where(and(...conditions))
			.orderBy(desc(table.notification.createdAt))
			.limit(limit + 1); // fetch one extra to detect next page

		const hasMore = items.length > limit;
		const results = hasMore ? items.slice(0, limit) : items;
		const nextCursor = hasMore ? results[results.length - 1].createdAt.toISOString() : null;

		return { items: results, nextCursor };
	}
);
