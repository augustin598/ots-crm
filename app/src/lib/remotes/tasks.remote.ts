import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, or, inArray, notInArray, like, sql, asc, desc, lt, gte, lte } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { sendTaskAssignmentEmail, sendTaskUpdateEmail, sendTaskClientNotificationEmail, getNotificationRecipients } from '$lib/server/email';
import { recordTaskActivity } from '$lib/server/task-activity';
import { getHooksManager } from '$lib/server/plugins/hooks';
import { logError, logWarning } from '$lib/server/logger';

type ClientNotificationType = 'created' | 'status-change' | 'comment' | 'modified';

async function sendClientNotificationIfEnabled(
	taskId: string,
	tenantId: string,
	notificationType: ClientNotificationType,
	extra?: { newStatus?: string; commentPreview?: string; changedFields?: string },
	excludeEmail?: string
): Promise<void> {
	try {
		// Load task settings
		const [settings] = await db
			.select()
			.from(table.taskSettings)
			.where(eq(table.taskSettings.tenantId, tenantId))
			.limit(1);

		// Check master toggle (default OFF)
		if (!settings?.clientEmailsEnabled) return;

		// Check sub-toggle
		const toggleMap: Record<ClientNotificationType, boolean> = {
			'created': settings.clientEmailOnTaskCreated ?? true,
			'status-change': settings.clientEmailOnStatusChange ?? true,
			'comment': settings.clientEmailOnComment ?? true,
			'modified': settings.clientEmailOnTaskModified ?? true
		};
		if (!toggleMap[notificationType]) return;

		// Get task with client (tenant-scoped for isolation)
		const [task] = await db
			.select()
			.from(table.task)
			.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, tenantId)))
			.limit(1);

		if (!task?.clientId) return;

		// Get client + all secondary emails with tasks notification enabled
		const [client] = await db
			.select()
			.from(table.client)
			.where(eq(table.client.id, task.clientId))
			.limit(1);

		if (!client?.email) return;

		const recipients = await getNotificationRecipients(task.clientId, 'tasks');
		const errors: Array<{ email: string; error: string }> = [];
		for (const recipient of recipients) {
			// Skip the user who performed the action (don't notify yourself)
			if (excludeEmail && recipient.email.toLowerCase() === excludeEmail.toLowerCase()) continue;
			try {
				await sendTaskClientNotificationEmail(
					taskId,
					recipient.email,
					recipient.name || null,
					notificationType,
					extra
				);
			} catch (error) {
				errors.push({ email: recipient.email, error: (error as Error).message });
			}
		}
		if (errors.length > 0) {
			logWarning('email', `Failed to send client ${notificationType} notification to ${errors.length} recipient(s)`, {
				tenantId,
				metadata: { taskId, errors }
			});
		}
	} catch (error) {
		logError('email', `Failed to send client notification (${notificationType}): ${(error as Error).message}`, {
			tenantId,
			metadata: { taskId }
		});
	}
}

function generateTaskId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

const VALID_STATUSES = ['todo', 'in-progress', 'review', 'done', 'cancelled', 'pending-approval'] as const;
const VALID_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

const taskSchema = v.object({
	title: v.pipe(v.string(), v.minLength(1, 'Title is required')),
	description: v.optional(v.string()),
	projectId: v.optional(v.string()),
	clientId: v.optional(v.string()),
	milestoneId: v.optional(v.string()),
	status: v.optional(v.picklist(VALID_STATUSES)),
	priority: v.optional(v.picklist(VALID_PRIORITIES)),
	dueDate: v.optional(v.string()),
	assignedToUserId: v.optional(v.string())
});

export const getTask = query(v.pipe(v.string(), v.minLength(1)), async (taskId) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	const [task] = await db
		.select()
		.from(table.task)
		.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, event.locals.tenant.id)))
		.limit(1);

	if (task) {
		return task;
	}

	// Check shared task
	const [sharedTask] = await db
		.select({ task: table.task })
		.from(table.task)
		.innerJoin(table.projectPartner, eq(table.task.projectId, table.projectPartner.projectId))
		.innerJoin(table.partner, eq(table.projectPartner.partnerId, table.partner.id))
		.where(
			and(eq(table.task.id, taskId), eq(table.partner.partnerTenantId, event.locals.tenant.id))
		)
		.limit(1);

	if (sharedTask) {
		return sharedTask.task;
	}

	throw new Error('Task not found');
});

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
		sortDir: v.optional(v.union([v.literal('asc'), v.literal('desc')])),
		excludeCompleted: v.optional(v.boolean()) // when true, excludes done/cancelled (used by kanban view)
	}),
	async (filters) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Get shared project IDs
		const sharedProjects = await db
			.select({ id: table.projectPartner.projectId })
			.from(table.projectPartner)
			.innerJoin(table.partner, eq(table.projectPartner.partnerId, table.partner.id))
			.where(eq(table.partner.partnerTenantId, event.locals.tenant.id));

		const sharedProjectIds = sharedProjects.map((p) => p.id);

		let conditions: any =
			sharedProjectIds.length > 0
				? or(
						eq(table.task.tenantId, event.locals.tenant!.id),
						inArray(table.task.projectId, sharedProjectIds)
					)
				: eq(table.task.tenantId, event.locals.tenant.id);

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
				or(like(table.task.title, searchPattern), like(table.task.description, searchPattern))
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

		// Exclude done/cancelled when in kanban view (loaded separately via getCompletedTasks)
		if (filters.excludeCompleted && !filters.status) {
			conditions = and(
				conditions,
				notInArray(table.task.status, ['done', 'cancelled'])
			) as any;
		}

		// Build query
		let queryBuilder: any = db.select().from(table.task).where(conditions);

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

export const getCompletedTasks = query(
	v.object({
		projectId: v.optional(v.union([v.string(), v.array(v.string())])),
		clientId: v.optional(v.union([v.string(), v.array(v.string())])),
		milestoneId: v.optional(v.union([v.string(), v.array(v.string())])),
		priority: v.optional(v.union([v.string(), v.array(v.string())])),
		assignee: v.optional(v.union([v.string(), v.array(v.string())])),
		search: v.optional(v.string()),
		dueDate: v.optional(v.string()),
		createdDate: v.optional(v.string()),
		sortBy: v.optional(v.string()),
		sortDir: v.optional(v.union([v.literal('asc'), v.literal('desc')])),
		page: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
		pageSize: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100)))
	}),
	async (filters) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const page = filters.page ?? 1;
		const pageSize = filters.pageSize ?? 20;
		const offset = (page - 1) * pageSize;

		// Get shared project IDs
		const sharedProjects = await db
			.select({ id: table.projectPartner.projectId })
			.from(table.projectPartner)
			.innerJoin(table.partner, eq(table.projectPartner.partnerId, table.partner.id))
			.where(eq(table.partner.partnerTenantId, event.locals.tenant.id));

		const sharedProjectIds = sharedProjects.map((p) => p.id);

		let conditions: any =
			sharedProjectIds.length > 0
				? or(
						eq(table.task.tenantId, event.locals.tenant!.id),
						inArray(table.task.projectId, sharedProjectIds)
					)
				: eq(table.task.tenantId, event.locals.tenant.id);

		// If user is a client user, filter by their client ID
		if (event.locals.isClientUser && event.locals.client) {
			conditions = and(conditions, eq(table.task.clientId, event.locals.client.id)) as any;
		}

		// Hard-scope to completed statuses
		conditions = and(conditions, inArray(table.task.status, ['done', 'cancelled'])) as any;

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

		// Search filter
		if (filters.search) {
			const searchPattern = `%${filters.search}%`;
			conditions = and(
				conditions,
				or(like(table.task.title, searchPattern), like(table.task.description, searchPattern))
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

		// Count query
		const [countResult] = await db
			.select({ count: sql<number>`count(*)` })
			.from(table.task)
			.where(conditions);

		const totalCount = Number(countResult?.count ?? 0);
		const totalPages = Math.ceil(totalCount / pageSize);

		// Data query with pagination, sorted by position then createdAt desc
		const sortDir = filters.sortDir === 'desc' ? desc : asc;
		let queryBuilder: any = db.select().from(table.task).where(conditions);

		if (filters.sortBy) {
			switch (filters.sortBy) {
				case 'title':
					queryBuilder = queryBuilder.orderBy(sortDir(table.task.title));
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
					queryBuilder = queryBuilder.orderBy(asc(table.task.position), desc(table.task.createdAt));
			}
		} else {
			queryBuilder = queryBuilder.orderBy(asc(table.task.position), desc(table.task.createdAt));
		}

		const items = await queryBuilder.limit(pageSize).offset(offset);

		return { items, totalCount, totalPages, page, pageSize };
	}
);

export const createTask = command(taskSchema, async (data) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	let targetTenantId = event.locals.tenant.id;

	if (data.projectId) {
		// Check local project
		const [project] = await db
			.select()
			.from(table.project)
			.where(
				and(
					eq(table.project.id, data.projectId),
					eq(table.project.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (project) {
			targetTenantId = project.tenantId;
		} else {
			// Check shared project
			const [sharedProject] = await db
				.select({ tenantId: table.project.tenantId })
				.from(table.projectPartner)
				.innerJoin(table.project, eq(table.projectPartner.projectId, table.project.id))
				.innerJoin(table.partner, eq(table.projectPartner.partnerId, table.partner.id))
				.where(
					and(
						eq(table.projectPartner.projectId, data.projectId),
						eq(table.partner.partnerTenantId, event.locals.tenant.id)
					)
				)
				.limit(1);

			if (sharedProject) {
				targetTenantId = sharedProject.tenantId;
			} else {
				throw new Error('Project not found');
			}
		}
	}

	const taskId = generateTaskId();
	// If client user, set status to pending-approval, otherwise use provided status or default to 'todo'
	const status = event.locals.isClientUser ? 'pending-approval' : data.status || 'todo';

	// If client user, set clientId from context
	const clientId =
		event.locals.isClientUser && event.locals.client
			? event.locals.client.id
			: data.clientId || null;

	// Get the highest position for this status to assign next position
	const [maxPositionResult] = await db
		.select({
			maxPosition: sql<number>`coalesce(max(${table.task.position}), -1)`.as('maxPosition')
		})
		.from(table.task)
		.where(and(eq(table.task.tenantId, targetTenantId), eq(table.task.status, status)));

	const nextPosition = (maxPositionResult?.maxPosition ?? -1) + 1;

	await db.insert(table.task).values({
		id: taskId,
		tenantId: targetTenantId,
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
		tenantId: targetTenantId
	});

	// If task is assigned, auto-watch for assignee and send assignment email
	if (data.assignedToUserId) {
		// Auto-watch for assignee
		const assigneeWatcherId = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
		await db.insert(table.taskWatcher).values({
			id: assigneeWatcherId,
			taskId,
			userId: data.assignedToUserId,
			tenantId: targetTenantId
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
				logWarning('email', `Failed to send task assignment email: ${(error as Error).message}`);
				// Don't throw - task creation should succeed even if email fails
			}
		}

		// Emit task.assigned hook for in-app notification
		try {
			const hooks = getHooksManager();
			await hooks.emit({
				type: 'task.assigned',
				taskId,
				taskTitle: data.title,
				assignedToUserId: data.assignedToUserId,
				assignedByUserId: event.locals.user.id,
				clientId: clientId,
				tenantId: targetTenantId,
				tenantSlug: event.locals.tenant.slug
			});
		} catch {
			// Don't throw - task creation should succeed even if notification fails
		}
	}

	// Record activity
	await recordTaskActivity({
		taskId,
		userId: event.locals.user.id,
		tenantId: targetTenantId,
		action: 'created'
	});

	// Send client notification
	await sendClientNotificationIfEnabled(taskId, targetTenantId, 'created', undefined, event.locals.user.email);

	// Emit approval.requested hook if task needs approval
	if (status === 'pending-approval') {
		try {
			const hooks = getHooksManager();
			await hooks.emit({
				type: 'approval.requested',
				taskId,
				taskTitle: data.title,
				requestedByUserId: event.locals.user.id,
				tenantId: targetTenantId,
				tenantSlug: event.locals.tenant.slug
			});
		} catch {
			// Don't throw - task creation should succeed even if notification fails
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

		let [existing] = await db
			.select()
			.from(table.task)
			.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, event.locals.tenant.id)))
			.limit(1);

		if (!existing) {
			// Check shared
			const [sharedTask] = await db
				.select({ task: table.task })
				.from(table.task)
				.innerJoin(table.projectPartner, eq(table.task.projectId, table.projectPartner.projectId))
				.innerJoin(table.partner, eq(table.projectPartner.partnerId, table.partner.id))
				.where(
					and(eq(table.task.id, taskId), eq(table.partner.partnerTenantId, event.locals.tenant.id))
				)
				.limit(1);

			if (sharedTask) existing = sharedTask.task;
		}

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

		// Record activity for changed fields
		const fieldsToTrack = ['title', 'description', 'status', 'priority', 'assignedToUserId', 'dueDate', 'clientId', 'projectId', 'milestoneId'] as const;
		const formatFieldValue = (val: unknown): string | null => {
			if (val == null) return null;
			if (val instanceof Date) return val.toISOString().split('T')[0];
			return String(val);
		};
		for (const field of fieldsToTrack) {
			const oldVal = existing[field];
			const newVal = updateData[field as keyof typeof updateData];
			if (newVal !== undefined && formatFieldValue(oldVal) !== formatFieldValue(newVal)) {
				await recordTaskActivity({
					taskId,
					userId: event.locals.user.id,
					tenantId: existing.tenantId,
					action: field === 'status' ? 'status_changed' : field === 'assignedToUserId' ? 'assigned' : 'updated',
					field,
					oldValue: formatFieldValue(oldVal),
					newValue: formatFieldValue(newVal)
				});
			}
		}

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
						eq(table.taskWatcher.tenantId, existing.tenantId)
					)
				)
				.limit(1);

			if (!existingWatcher) {
				const assigneeWatcherId = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
				await db.insert(table.taskWatcher).values({
					id: assigneeWatcherId,
					taskId,
					userId: newAssigneeId,
					tenantId: existing.tenantId
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
					const assigneeName =
						`${assignee.firstName} ${assignee.lastName}`.trim() || assignee.email;
					await sendTaskAssignmentEmail(taskId, assignee.email, assigneeName);
				} catch (error) {
					logWarning('email', `Failed to send task assignment email: ${(error as Error).message}`);
					// Don't throw - task update should succeed even if email fails
				}
			}

			// Emit in-app notification for the new assignee
			try {
				const hooks = getHooksManager();
				await hooks.emit({
					type: 'task.assigned',
					taskId,
					taskTitle: existing.title,
					assignedToUserId: newAssigneeId,
					assignedByUserId: event.locals.user.id,
					clientId: existing.clientId,
					tenantId: existing.tenantId,
					tenantSlug: event.locals.tenant.slug
				});
			} catch (error) {
				logError('server', 'Failed to emit task.assigned hook', { metadata: { error: error instanceof Error ? error.message : String(error) } });
				// Don't throw - task update should succeed even if notification fails
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
						logWarning('email', `Failed to send task update email: ${(error as Error).message}`);
						// Continue with other watchers even if one fails
					}
				}
			}
		}

		// Send client notification
		const statusChanged = updateData.status !== undefined && updateData.status !== existing.status;
		if (statusChanged) {
			await sendClientNotificationIfEnabled(taskId, existing.tenantId, 'status-change', {
				newStatus: updateData.status
			}, event.locals.user.email);
		} else {
			// Collect changed fields for notification
			const changedFieldLabels: string[] = [];
			const fieldLabels: Record<string, string> = {
				title: 'Titlu', description: 'Descriere', priority: 'Prioritate',
				dueDate: 'Termen', assignedToUserId: 'Persoana asignată',
				projectId: 'Proiect', milestoneId: 'Milestone', clientId: 'Client'
			};
			for (const field of Object.keys(fieldLabels)) {
				const newVal = updateData[field as keyof typeof updateData];
				if (newVal !== undefined && String(existing[field as keyof typeof existing] ?? '') !== String(newVal)) {
					changedFieldLabels.push(fieldLabels[field]);
				}
			}
			if (changedFieldLabels.length > 0) {
				await sendClientNotificationIfEnabled(taskId, existing.tenantId, 'modified', {
					changedFields: changedFieldLabels.join(', ')
				}, event.locals.user.email);
			}
		}

		// Emit approval.requested hook if status changed to pending-approval
		if (updateData.status === 'pending-approval' && existing.status !== 'pending-approval') {
			try {
				const hooks = getHooksManager();
				await hooks.emit({
					type: 'approval.requested',
					taskId,
					taskTitle: existing.title,
					requestedByUserId: event.locals.user.id,
					tenantId: existing.tenantId,
					tenantSlug: event.locals.tenant.slug
				});
			} catch {
				// Don't throw - task update should succeed even if notification fails
			}
		}

		return { success: true };
	}
);

export const reopenTask = command(
	v.object({
		taskId: v.pipe(v.string(), v.minLength(1))
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const { taskId } = data;

		const [existing] = await db
			.select()
			.from(table.task)
			.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, event.locals.tenant.id)))
			.limit(1);

		if (!existing) {
			throw new Error('Task not found');
		}

		// Client users can only reopen their own tasks
		if (event.locals.isClientUser && existing.clientId !== event.locals.client?.id) {
			throw new Error('Unauthorized: You do not have access to this task');
		}

		if (existing.status !== 'done' && existing.status !== 'cancelled') {
			throw new Error('Only completed or cancelled tasks can be reopened');
		}

		// Cooldown: prevent spam reopening (30 seconds)
		const [recentReopen] = await db
			.select({ id: table.taskActivity.id })
			.from(table.taskActivity)
			.where(
				and(
					eq(table.taskActivity.taskId, taskId),
					eq(table.taskActivity.action, 'status_changed'),
					gte(table.taskActivity.createdAt, new Date(Date.now() - 30_000))
				)
			)
			.orderBy(desc(table.taskActivity.createdAt))
			.limit(1);

		if (recentReopen) {
			throw new Error('Task-ul a fost modificat recent. Așteaptă câteva secunde.');
		}

		const oldStatus = existing.status;

		// Conditional update to prevent race conditions
		const result = await db
			.update(table.task)
			.set({ status: 'pending-approval', updatedAt: new Date() })
			.where(
				and(
					eq(table.task.id, taskId),
					inArray(table.task.status, ['done', 'cancelled'])
				)
			);

		// Verify the update actually changed a row (race condition guard)
		const [verifyTask] = await db
			.select({ status: table.task.status })
			.from(table.task)
			.where(eq(table.task.id, taskId))
			.limit(1);

		if (verifyTask?.status !== 'pending-approval') {
			throw new Error('Task-ul nu mai poate fi redeschis (statusul s-a schimbat deja).');
		}

		await recordTaskActivity({
			taskId,
			tenantId: event.locals.tenant.id,
			userId: event.locals.user.id,
			action: 'status_changed',
			field: 'status',
			oldValue: oldStatus,
			newValue: 'pending-approval'
		});

		const reopenerName = `${event.locals.user.firstName ?? ''} ${event.locals.user.lastName ?? ''}`.trim() || event.locals.user.email;
		const currentUserId = event.locals.user.id;

		// Notify assignee (skip if reopener is the assignee)
		if (existing.assignedToUserId && existing.assignedToUserId !== currentUserId) {
			try {
				const [assignee] = await db
					.select()
					.from(table.user)
					.where(eq(table.user.id, existing.assignedToUserId))
					.limit(1);

				if (assignee?.email) {
					const assigneeName = `${assignee.firstName} ${assignee.lastName}`.trim() || assignee.email;
					await sendTaskUpdateEmail(taskId, assignee.email, assigneeName, `Task redeschis de ${reopenerName} - necesită aprobare`);
				}
			} catch (error) {
				logError('email', 'Failed to send reopen notification email', { stackTrace: error instanceof Error ? error.stack : String(error) });
			}
		}

		// Notify tenant admin/owner users (skip reopener and assignee)
		try {
			const adminUsers = await db
				.select()
				.from(table.user)
				.innerJoin(table.tenantUser, eq(table.user.id, table.tenantUser.userId))
				.where(
					and(
						eq(table.tenantUser.tenantId, event.locals.tenant.id),
						or(eq(table.tenantUser.role, 'admin'), eq(table.tenantUser.role, 'owner'))
					)
				);

			for (const { user: adminUser } of adminUsers) {
				if (adminUser.email && adminUser.id !== existing.assignedToUserId && adminUser.id !== currentUserId) {
					const adminName = `${adminUser.firstName} ${adminUser.lastName}`.trim() || adminUser.email;
					await sendTaskUpdateEmail(taskId, adminUser.email, adminName, `Task redeschis de ${reopenerName} - necesită aprobare`);
				}
			}
		} catch (error) {
			logError('email', 'Failed to send admin reopen notification emails', { stackTrace: error instanceof Error ? error.stack : String(error) });
		}

		// Send client notification for status change
		await sendClientNotificationIfEnabled(taskId, event.locals.tenant.id, 'status-change', {
			newStatus: 'pending-approval'
		}, event.locals.user.email);

		return { success: true };
	}
);

export const updateTaskPosition = command(
	v.object({
		taskId: v.pipe(v.string(), v.minLength(1)),
		newStatus: v.picklist(VALID_STATUSES),
		newPosition: v.number(),
		oldStatus: v.optional(v.picklist(VALID_STATUSES)),
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
							eq(table.task.tenantId, event.locals.tenant!.id),
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
							eq(table.task.tenantId, event.locals.tenant!.id),
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

		// Record activity if status changed
		if (oldStatus && oldStatus !== newStatus) {
			await recordTaskActivity({
				taskId,
				userId: event.locals.user.id,
				tenantId: event.locals.tenant.id,
				action: 'status_changed',
				field: 'status',
				oldValue: oldStatus,
				newValue: newStatus
			});

			// Send client notification for status change
			await sendClientNotificationIfEnabled(taskId, event.locals.tenant.id, 'status-change', {
				newStatus
			}, event.locals.user.email);
		}

		return { success: true };
	}
);

export const deleteTask = command(v.pipe(v.string(), v.minLength(1)), async (taskId) => {
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
						eq(table.task.tenantId, event.locals.tenant!.id),
						eq(table.task.status, task.status),
						sql`${table.task.position} > ${task.position}`
					)
				);
		}
	});

	return { success: true };
});

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
		newStatus: v.optional(v.picklist(['todo', 'in-progress', 'review', 'done']))
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

		await recordTaskActivity({
			taskId,
			userId: event.locals.user.id,
			tenantId: event.locals.tenant.id,
			action: 'approved',
			field: 'status',
			oldValue: 'pending-approval',
			newValue: status
		});

		// Send client notification
		await sendClientNotificationIfEnabled(taskId, event.locals.tenant.id, 'status-change', {
			newStatus: status
		}, event.locals.user.email);

		return { success: true, taskId };
	}
);

/**
 * Reject a task (change status to cancelled)
 */
export const rejectTask = command(v.pipe(v.string(), v.minLength(1)), async (taskId) => {
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

	await recordTaskActivity({
		taskId,
		userId: event.locals.user.id,
		tenantId: event.locals.tenant.id,
		action: 'rejected',
		field: 'status',
		oldValue: 'pending-approval',
		newValue: 'cancelled'
	});

	// Send client notification
	await sendClientNotificationIfEnabled(taskId, event.locals.tenant.id, 'status-change', {
		newStatus: 'cancelled'
	}, event.locals.user.email);

	return { success: true, taskId };
});
