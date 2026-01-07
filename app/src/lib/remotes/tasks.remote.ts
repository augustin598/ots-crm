import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';

function generateTaskId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

const taskSchema = v.object({
	title: v.pipe(v.string(), v.minLength(1, 'Title is required')),
	description: v.optional(v.string()),
	projectId: v.optional(v.string()),
	clientId: v.optional(v.string()),
	status: v.optional(v.string()),
	priority: v.optional(v.string()),
	dueDate: v.optional(v.string()),
	assignedToUserId: v.optional(v.string())
});

export const getTask = query(
	v.pipe(v.string(), v.minLength(1)),
	async (taskId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const [task] = await db
			.select()
			.from(table.task)
			.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, event.locals.tenant.id)))
			.limit(1);

		if (!task) {
			throw new Error('Task not found');
		}

		return task;
	}
);

export const getTasks = query(
	v.object({
		projectId: v.optional(v.string()),
		clientId: v.optional(v.string())
	}),
	async (filters) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		let conditions = eq(table.task.tenantId, event.locals.tenant.id);

		if (filters.projectId) {
			conditions = and(conditions, eq(table.task.projectId, filters.projectId)) as any;
		}
		if (filters.clientId) {
			conditions = and(conditions, eq(table.task.clientId, filters.clientId)) as any;
		}

		return await db.select().from(table.task).where(conditions);
	}
);

export const createTask = command(taskSchema, async (data) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	const taskId = generateTaskId();

	await db.insert(table.task).values({
		id: taskId,
		tenantId: event.locals.tenant.id,
		projectId: data.projectId || null,
		clientId: data.clientId || null,
		title: data.title,
		description: data.description || null,
		status: data.status || 'todo',
		priority: data.priority || 'medium',
		dueDate: data.dueDate ? new Date(data.dueDate) : null,
		assignedToUserId: data.assignedToUserId || null
	});

	return { success: true, taskId };
});

export const updateTask = command(
	v.object({
		taskId: v.pipe(v.string(), v.minLength(1)),
		...taskSchema.entries
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const { taskId, ...updateData } = data;

		const [existing] = await db
			.select()
			.from(table.task)
			.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, event.locals.tenant.id)))
			.limit(1);

		if (!existing) {
			throw new Error('Task not found');
		}

		await db
			.update(table.task)
			.set({
				...updateData,
				dueDate: updateData.dueDate ? new Date(updateData.dueDate) : undefined,
				updatedAt: new Date()
			})
			.where(eq(table.task.id, taskId));

		return { success: true };
	}
);

export const deleteTask = command(
	v.pipe(v.string(), v.minLength(1)),
	async (taskId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		await db.delete(table.task).where(eq(table.task.id, taskId));

		return { success: true };
	}
);
