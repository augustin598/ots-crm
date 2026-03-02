import { query, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';

export const getTaskActivities = query(
	v.pipe(v.string(), v.minLength(1)),
	async (taskId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Verify task belongs to tenant
		const [task] = await db
			.select()
			.from(table.task)
			.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, event.locals.tenant.id)))
			.limit(1);

		if (!task) {
			throw new Error('Task not found');
		}

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
				userLastName: table.user.lastName
			})
			.from(table.taskActivity)
			.innerJoin(table.user, eq(table.taskActivity.userId, table.user.id))
			.where(eq(table.taskActivity.taskId, taskId))
			.orderBy(desc(table.taskActivity.createdAt));

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
