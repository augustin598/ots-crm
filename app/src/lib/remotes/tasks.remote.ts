import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, or, inArray, like, sql, asc, desc, lt, gte, lte } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { sendTaskAssignmentEmail, sendTaskUpdateEmail } from '$lib/server/email';

function generateTaskId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

const taskSchema = v.object({
	title: v.pipe(v.string(), v.minLength(1, 'Title is required')),
	description: v.optional(v.string()),
	projectId: v.optional(v.string()),
	clientId: v.optional(v.string()),
	milestoneId: v.optional(v.string()),
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
		projectId: v.optional(v.union([v.string(), v.array(v.string())])),
		clientId: v.optional(v.union([v.string(), v.array(v.string())])),
		milestoneId: v.optional(v.union([v.string(), v.array(v.string())])),
		status: v.optional(v.union([v.string(), v.array(v.string())])),
		priority: v.optional(v.union([v.string(), v.array(v.string())])),
		assignee: v.optional(v.union([v.string(), v.array(v.string())])),
		search: v.optional(v.string()),
		dueDate: v.optional(v.string()), // 'overdue', 'today', 'thisWeek', 'thisMonth', or date range
		createdDate: v.optional(v.string()), // date range format: 'YYYY-MM-DD:YYYY-MM-DD'
		sortBy: v.optional(v.string()),
		sortDir: v.optional(v.union([v.literal('asc'), v.literal('desc')]))
	}),
	async (filters) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		let conditions: any = eq(table.task.tenantId, event.locals.tenant.id);

		// If user is a client user, filter by their client ID
		if (event.locals.isClientUser && event.locals.client) {
			conditions = and(conditions, eq(table.task.clientId, event.locals.client.id)) as any;
		}

		// Project filter
		if (filters.projectId) {
			const projectIds = Array.isArray(filters.projectId) ? filters.projectId : [filters.projectId];
			conditions = and(conditions, inArray(table.task.projectId, projectIds)) as any;
		}

		// Client filter
		if (filters.clientId) {
			const clientIds = Array.isArray(filters.clientId) ? filters.clientId : [filters.clientId];
			conditions = and(conditions, inArray(table.task.clientId, clientIds)) as any;
		}

		// Milestone filter
		if (filters.milestoneId) {
			const milestoneIds = Array.isArray(filters.milestoneId)
				? filters.milestoneId
				: [filters.milestoneId];
			conditions = and(conditions, inArray(table.task.milestoneId, milestoneIds)) as any;
		}

		// Status filter
		if (filters.status) {
			const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
			conditions = and(conditions, inArray(table.task.status, statuses)) as any;
		}

		// Priority filter
		if (filters.priority) {
			const priorities = Array.isArray(filters.priority) ? filters.priority : [filters.priority];
			conditions = and(conditions, inArray(table.task.priority, priorities)) as any;
		}

		// Assignee filter
		if (filters.assignee) {
			const assignees = Array.isArray(filters.assignee) ? filters.assignee : [filters.assignee];
			conditions = and(conditions, inArray(table.task.assignedToUserId, assignees)) as any;
		}

		// Search filter (title and description)
		if (filters.search) {
			const searchPattern = `%${filters.search}%`;
			conditions = and(
				conditions,
				or(
					like(table.task.title, searchPattern),
					like(table.task.description, searchPattern)
				)
			) as any;
		}

		// Due date filter
		if (filters.dueDate) {
			const now = new Date();
			now.setHours(0, 0, 0, 0);
			const todayEnd = new Date(now);
			todayEnd.setHours(23, 59, 59, 999);

			if (filters.dueDate === 'overdue') {
				conditions = and(conditions, lt(table.task.dueDate, now)) as any;
			} else if (filters.dueDate === 'today') {
				conditions = and(
					conditions,
					and(gte(table.task.dueDate, now), lte(table.task.dueDate, todayEnd))
				) as any;
			} else if (filters.dueDate === 'thisWeek') {
				const weekEnd = new Date(now);
				weekEnd.setDate(weekEnd.getDate() + 7);
				conditions = and(
					conditions,
					and(gte(table.task.dueDate, now), lte(table.task.dueDate, weekEnd))
				) as any;
			} else if (filters.dueDate === 'thisMonth') {
				const monthEnd = new Date(now);
				monthEnd.setMonth(monthEnd.getMonth() + 1);
				conditions = and(
					conditions,
					and(gte(table.task.dueDate, now), lte(table.task.dueDate, monthEnd))
				) as any;
			} else if (filters.dueDate.startsWith('dateRange:')) {
				const [startStr, endStr] = filters.dueDate.replace('dateRange:', '').split(':');
				const startDate = new Date(startStr);
				const endDate = new Date(endStr);
				endDate.setHours(23, 59, 59, 999);
				conditions = and(
					conditions,
					and(gte(table.task.dueDate, startDate), lte(table.task.dueDate, endDate))
				) as any;
			}
		}

		// Created date filter
		if (filters.createdDate && filters.createdDate.startsWith('dateRange:')) {
			const [startStr, endStr] = filters.createdDate.replace('dateRange:', '').split(':');
			const startDate = new Date(startStr);
			const endDate = new Date(endStr);
			endDate.setHours(23, 59, 59, 999);
			conditions = and(
				conditions,
				and(gte(table.task.createdAt, startDate), lte(table.task.createdAt, endDate))
			) as any;
		}

		// Build query
		let queryBuilder = db.select().from(table.task).where(conditions);

		// Sorting
		if (filters.sortBy) {
			const sortDir = filters.sortDir === 'desc' ? desc : asc;
			switch (filters.sortBy) {
				case 'title':
					queryBuilder = queryBuilder.orderBy(sortDir(table.task.title));
					break;
				case 'status':
					queryBuilder = queryBuilder.orderBy(sortDir(table.task.status));
					break;
				case 'priority':
					queryBuilder = queryBuilder.orderBy(sortDir(table.task.priority));
					break;
				case 'dueDate':
					queryBuilder = queryBuilder.orderBy(sortDir(table.task.dueDate));
					break;
				case 'createdAt':
					queryBuilder = queryBuilder.orderBy(sortDir(table.task.createdAt));
					break;
				default:
					// Default: sort by position within status, then by createdAt
					queryBuilder = queryBuilder.orderBy(
						asc(table.task.status),
						asc(table.task.position),
						desc(table.task.createdAt)
					);
			}
		} else {
			// Default sorting: by status, then position, then createdAt
			queryBuilder = queryBuilder.orderBy(
				asc(table.task.status),
				asc(table.task.position),
				desc(table.task.createdAt)
			);
		}

		return await queryBuilder;
	}
);

export const createTask = command(taskSchema, async (data) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	const taskId = generateTaskId();
	// If client user, set status to pending-approval, otherwise use provided status or default to 'todo'
	const status = event.locals.isClientUser
		? 'pending-approval'
		: data.status || 'todo';
	
	// If client user, set clientId from context
	const clientId = event.locals.isClientUser && event.locals.client
		? event.locals.client.id
		: data.clientId || null;

	// Get the highest position for this status to assign next position
	const [maxPositionResult] = await db
		.select({ maxPosition: sql<number>`coalesce(max(${table.task.position}), -1)`.as('maxPosition') })
		.from(table.task)
		.where(and(eq(table.task.tenantId, event.locals.tenant.id), eq(table.task.status, status)));

	const nextPosition = (maxPositionResult?.maxPosition ?? -1) + 1;

	await db.insert(table.task).values({
		id: taskId,
		tenantId: event.locals.tenant.id,
		projectId: data.projectId || null,
		clientId: clientId,
		milestoneId: data.milestoneId || null,
		title: data.title,
		description: data.description || null,
		status: status,
		priority: data.priority || 'medium',
		position: nextPosition,
		dueDate: data.dueDate ? new Date(data.dueDate) : null,
		assignedToUserId: data.assignedToUserId || null,
		createdByUserId: event.locals.user.id
	});

	// Auto-watch task for creator
	const watcherId = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
	await db.insert(table.taskWatcher).values({
		id: watcherId,
		taskId,
		userId: event.locals.user.id,
		tenantId: event.locals.tenant.id
	});

	// If task is assigned, auto-watch for assignee and send assignment email
	if (data.assignedToUserId) {
		// Auto-watch for assignee
		const assigneeWatcherId = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
		await db.insert(table.taskWatcher).values({
			id: assigneeWatcherId,
			taskId,
			userId: data.assignedToUserId,
			tenantId: event.locals.tenant.id
		});

		// Get assignee email
		const [assignee] = await db
			.select()
			.from(table.user)
			.where(eq(table.user.id, data.assignedToUserId))
			.limit(1);

		if (assignee?.email) {
			try {
				const assigneeName = `${assignee.firstName} ${assignee.lastName}`.trim() || assignee.email;
				await sendTaskAssignmentEmail(taskId, assignee.email, assigneeName);
			} catch (error) {
				console.error('Failed to send task assignment email:', error);
				// Don't throw - task creation should succeed even if email fails
			}
		}
	}

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

		// If client user, restrict updates
		if (event.locals.isClientUser && event.locals.client) {
			// Client users can only update their own tasks
			if (existing.clientId !== event.locals.client.id) {
				throw new Error('Unauthorized - you can only update your own tasks');
			}

			// Client users can only update limited fields (title, description, dueDate)
			// Remove restricted fields
			delete updateData.status;
			delete updateData.priority;
			delete updateData.assignedToUserId;
			delete updateData.projectId;
			delete updateData.milestoneId;
			delete updateData.clientId;
		}

		const oldAssigneeId = existing.assignedToUserId;
		const newAssigneeId = updateData.assignedToUserId;
		const assigneeChanged = newAssigneeId && oldAssigneeId !== newAssigneeId;

		await db
			.update(table.task)
			.set({
				...updateData,
				dueDate: updateData.dueDate ? new Date(updateData.dueDate) : undefined,
				milestoneId: updateData.milestoneId || undefined,
				updatedAt: new Date()
			})
			.where(eq(table.task.id, taskId));

		// Handle assignment change
		if (assigneeChanged) {
			// Auto-watch for new assignee
			const [existingWatcher] = await db
				.select()
				.from(table.taskWatcher)
				.where(
					and(
						eq(table.taskWatcher.taskId, taskId),
						eq(table.taskWatcher.userId, newAssigneeId),
						eq(table.taskWatcher.tenantId, event.locals.tenant.id)
					)
				)
				.limit(1);

			if (!existingWatcher) {
				const assigneeWatcherId = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
				await db.insert(table.taskWatcher).values({
					id: assigneeWatcherId,
					taskId,
					userId: newAssigneeId,
					tenantId: event.locals.tenant.id
				});
			}

			// Auto-watch for assigner (current user)
			const [assignerWatcher] = await db
				.select()
				.from(table.taskWatcher)
				.where(
					and(
						eq(table.taskWatcher.taskId, taskId),
						eq(table.taskWatcher.userId, event.locals.user.id),
						eq(table.taskWatcher.tenantId, event.locals.tenant.id)
					)
				)
				.limit(1);

			if (!assignerWatcher) {
				const assignerWatcherId = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
				await db.insert(table.taskWatcher).values({
					id: assignerWatcherId,
					taskId,
					userId: event.locals.user.id,
					tenantId: event.locals.tenant.id
				});
			}

			// Send assignment email to new assignee
			const [assignee] = await db
				.select()
				.from(table.user)
				.where(eq(table.user.id, newAssigneeId))
				.limit(1);

			if (assignee?.email) {
				try {
					const assigneeName = `${assignee.firstName} ${assignee.lastName}`.trim() || assignee.email;
					await sendTaskAssignmentEmail(taskId, assignee.email, assigneeName);
				} catch (error) {
					console.error('Failed to send task assignment email:', error);
					// Don't throw - task update should succeed even if email fails
				}
			}
		}

		// Notify all watchers of other changes (except assignment changes which were handled above)
		if (!assigneeChanged) {
			const watchers = await db
				.select()
				.from(table.taskWatcher)
				.where(
					and(
						eq(table.taskWatcher.taskId, taskId),
						eq(table.taskWatcher.tenantId, event.locals.tenant.id)
					)
				);

			// Determine change type
			let changeType: string | undefined;
			if (updateData.status !== undefined && updateData.status !== existing.status) {
				changeType = 'status';
			} else if (updateData.dueDate !== undefined) {
				changeType = 'dueDate';
			} else {
				changeType = 'general';
			}

			// Send update emails to all watchers (excluding the user who made the change)
			for (const watcher of watchers) {
				if (watcher.userId === event.locals.user.id) {
					continue; // Don't notify the person who made the change
				}

				const [watcherUser] = await db
					.select()
					.from(table.user)
					.where(eq(table.user.id, watcher.userId))
					.limit(1);

				if (watcherUser?.email) {
					try {
						const watcherName =
							`${watcherUser.firstName} ${watcherUser.lastName}`.trim() || watcherUser.email;
						await sendTaskUpdateEmail(taskId, watcherUser.email, watcherName, changeType);
					} catch (error) {
						console.error('Failed to send task update email:', error);
						// Continue with other watchers even if one fails
					}
				}
			}
		}

		return { success: true };
	}
);

export const updateTaskPosition = command(
	v.object({
		taskId: v.pipe(v.string(), v.minLength(1)),
		newStatus: v.string(),
		newPosition: v.number(),
		oldStatus: v.optional(v.string()),
		oldPosition: v.optional(v.number())
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const { taskId, newStatus, newPosition, oldStatus, oldPosition } = data;

		// Verify task exists and belongs to tenant
		const [task] = await db
			.select()
			.from(table.task)
			.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, event.locals.tenant.id)))
			.limit(1);

		if (!task) {
			throw new Error('Task not found');
		}

		// Use transaction to ensure data consistency
		await db.transaction(async (tx) => {
			// If moving to a different status, shift positions in old status column
			if (oldStatus && oldStatus !== newStatus && oldPosition !== undefined) {
				// Decrease positions of tasks after the old position in old status
				await tx
					.update(table.task)
					.set({
						position: sql`${table.task.position} - 1`
					})
					.where(
						and(
							eq(table.task.tenantId, event.locals.tenant.id),
							eq(table.task.status, oldStatus),
							sql`${table.task.position} > ${oldPosition}`
						)
					);
			}

			// Shift positions in new status column to make room
			if (newStatus !== oldStatus || newPosition !== oldPosition) {
				await tx
					.update(table.task)
					.set({
						position: sql`${table.task.position} + 1`
					})
					.where(
						and(
							eq(table.task.tenantId, event.locals.tenant.id),
							eq(table.task.status, newStatus),
							sql`${table.task.position} >= ${newPosition}`
						)
					);
			}

			// Update the task's status and position
			await tx
				.update(table.task)
				.set({
					status: newStatus,
					position: newPosition,
					updatedAt: new Date()
				})
				.where(eq(table.task.id, taskId));
		});

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

		// Get task to know its status and position
		const [task] = await db
			.select()
			.from(table.task)
			.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, event.locals.tenant.id)))
			.limit(1);

		if (!task) {
			throw new Error('Task not found');
		}

		// Use transaction to update positions after deletion
		await db.transaction(async (tx) => {
			// Delete the task
			await tx.delete(table.task).where(eq(table.task.id, taskId));

			// Decrease positions of tasks after the deleted task's position
			if (task.status && task.position !== null) {
				await tx
					.update(table.task)
					.set({
						position: sql`${table.task.position} - 1`
					})
					.where(
						and(
							eq(table.task.tenantId, event.locals.tenant.id),
							eq(table.task.status, task.status),
							sql`${table.task.position} > ${task.position}`
						)
					);
			}
		});

		return { success: true };
	}
);

/**
 * Watch a task - receive notifications for task changes
 */
export const watchTask = command(v.pipe(v.string(), v.minLength(1)), async (taskId) => {
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

	// Check if already watching
	const [existing] = await db
		.select()
		.from(table.taskWatcher)
		.where(
			and(
				eq(table.taskWatcher.taskId, taskId),
				eq(table.taskWatcher.userId, event.locals.user.id),
				eq(table.taskWatcher.tenantId, event.locals.tenant.id)
			)
		)
		.limit(1);

	if (existing) {
		return { success: true, alreadyWatching: true };
	}

	// Add watcher
	const watcherId = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
	await db.insert(table.taskWatcher).values({
		id: watcherId,
		taskId,
		userId: event.locals.user.id,
		tenantId: event.locals.tenant.id
	});

	return { success: true };
});

/**
 * Unwatch a task - stop receiving notifications
 */
export const unwatchTask = command(v.pipe(v.string(), v.minLength(1)), async (taskId) => {
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

	// Remove watcher
	await db
		.delete(table.taskWatcher)
		.where(
			and(
				eq(table.taskWatcher.taskId, taskId),
				eq(table.taskWatcher.userId, event.locals.user.id),
				eq(table.taskWatcher.tenantId, event.locals.tenant.id)
			)
		);

	return { success: true };
});

/**
 * Get list of task watchers
 */
export const getTaskWatchers = query(v.pipe(v.string(), v.minLength(1)), async (taskId) => {
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

	// Get watchers with user details
	const watchers = await db
		.select({
			id: table.taskWatcher.id,
			userId: table.taskWatcher.userId,
			user: {
				email: table.user.email,
				firstName: table.user.firstName,
				lastName: table.user.lastName
			},
			createdAt: table.taskWatcher.createdAt
		})
		.from(table.taskWatcher)
		.innerJoin(table.user, eq(table.taskWatcher.userId, table.user.id))
		.where(
			and(
				eq(table.taskWatcher.taskId, taskId),
				eq(table.taskWatcher.tenantId, event.locals.tenant.id)
			)
		);

	return watchers.map((w) => ({
		id: w.id,
		userId: w.userId,
		email: w.user.email,
		name: `${w.user.firstName} ${w.user.lastName}`.trim() || w.user.email,
		createdAt: w.createdAt
	}));
});

/**
 * Check if current user is watching a task
 */
export const isWatchingTask = query(v.pipe(v.string(), v.minLength(1)), async (taskId) => {
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

	// Check if watching
	const [watcher] = await db
		.select()
		.from(table.taskWatcher)
		.where(
			and(
				eq(table.taskWatcher.taskId, taskId),
				eq(table.taskWatcher.userId, event.locals.user.id),
				eq(table.taskWatcher.tenantId, event.locals.tenant.id)
			)
		)
		.limit(1);

	return { isWatching: !!watcher };
});

/**
 * Approve a task (change status from pending-approval to todo or specified status)
 */
export const approveTask = command(
	v.object({
		taskId: v.pipe(v.string(), v.minLength(1)),
		newStatus: v.optional(v.string())
	}),
	async ({ taskId, newStatus }) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Only tenant users (not client users) can approve tasks
		if (event.locals.isClientUser) {
			throw new Error('Unauthorized - only administrators can approve tasks');
		}

		const [existing] = await db
			.select()
			.from(table.task)
			.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, event.locals.tenant.id)))
			.limit(1);

		if (!existing) {
			throw new Error('Task not found');
		}

		if (existing.status !== 'pending-approval') {
			throw new Error('Task is not pending approval');
		}

		// Update status to newStatus or default to 'todo'
		const status = newStatus || 'todo';

		await db
			.update(table.task)
			.set({
				status,
				updatedAt: new Date()
			})
			.where(eq(table.task.id, taskId));

		return { success: true, taskId };
	}
);

/**
 * Reject a task (change status to cancelled)
 */
export const rejectTask = command(
	v.pipe(v.string(), v.minLength(1)),
	async (taskId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Only tenant users (not client users) can reject tasks
		if (event.locals.isClientUser) {
			throw new Error('Unauthorized - only administrators can reject tasks');
		}

		const [existing] = await db
			.select()
			.from(table.task)
			.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, event.locals.tenant.id)))
			.limit(1);

		if (!existing) {
			throw new Error('Task not found');
		}

		if (existing.status !== 'pending-approval') {
			throw new Error('Task is not pending approval');
		}

		await db
			.update(table.task)
			.set({
				status: 'cancelled',
				updatedAt: new Date()
			})
			.where(eq(table.task.id, taskId));

		return { success: true, taskId };
	}
);
