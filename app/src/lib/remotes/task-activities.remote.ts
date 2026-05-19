import { query, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc } from 'drizzle-orm';

export const getTaskActivities = query(
	v.pipe(v.string(), v.minLength(1)),
	async (taskId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Collapse preflight tenant-check + activities query into a single JOIN.
		// The JOIN on task + tenantId filter implicitly enforces tenant isolation
		// and the IDOR guard (isClientUser clientId check) in one roundtrip.
		const activities = await db
			.select({
				id: table.taskActivity.id,
				taskId: table.taskActivity.taskId,
				userId: table.taskActivity.userId,
				action: table.taskActivity.action,
				field: table.taskActivity.field,
				oldValue: table.taskActivity.oldValue,
				newValue: table.taskActivity.newValue,
				createdAt: table.taskActivity.createdAt,
				userFirstName: table.user.firstName,
				userLastName: table.user.lastName,
				taskClientId: table.task.clientId
			})
			.from(table.taskActivity)
			.innerJoin(table.task, eq(table.taskActivity.taskId, table.task.id))
			.innerJoin(table.user, eq(table.taskActivity.userId, table.user.id))
			.where(
				and(
					eq(table.taskActivity.taskId, taskId),
					eq(table.task.tenantId, event.locals.tenant.id),
					...(event.locals.isClientUser && event.locals.client
						? [eq(table.task.clientId, event.locals.client.id)]
						: [])
				)
			)
			.orderBy(desc(table.taskActivity.createdAt));

		// If no rows returned, the task either doesn't exist or isn't accessible.
		// For activities, returning [] is correct — callers treat empty as "no activity yet".
		// No need for a separate existence check; the JOIN enforces both.

		return activities.map((a) => ({
			id: a.id,
			taskId: a.taskId,
			userId: a.userId,
			userName: `${a.userFirstName} ${a.userLastName}`.trim(),
			action: a.action,
			field: a.field,
			oldValue: a.oldValue,
			newValue: a.newValue,
			createdAt: a.createdAt
		}));
	}
);
