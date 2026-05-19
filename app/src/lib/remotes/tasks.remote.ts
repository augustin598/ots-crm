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
import { spawnNextRecurringTask } from '$lib/server/recurring-tasks';
import { createMeetEvent } from '$lib/server/google-calendar/meet';
import { getCalendarStatus, CalendarNotConnected } from '$lib/server/google-calendar/auth';

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

const VALID_STATUSES = ['todo', 'in-progress', 'review', 'done', 'cancelled', 'pending-approval', 'blocked'] as const;
const VALID_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
const VALID_RECURRING_TYPES = ['daily', 'weekly', 'monthly', 'yearly'] as const;
const VALID_TASK_TYPES = ['design', 'video', 'ads', 'dev', 'content', 'meeting', 'other'] as const;

const taskSchema = v.object({
	title: v.pipe(v.string(), v.minLength(1, 'Title is required')),
	description: v.optional(v.string()),
	projectId: v.optional(v.string()),
	clientId: v.optional(v.string()),
	milestoneId: v.optional(v.string()),
	status: v.optional(v.picklist(VALID_STATUSES)),
	priority: v.optional(v.picklist(VALID_PRIORITIES)),
	dueDate: v.optional(v.string()),
	assignedToUserId: v.optional(v.string()),
	isRecurring: v.optional(v.boolean()),
	recurringType: v.optional(v.picklist(VALID_RECURRING_TYPES)),
	recurringInterval: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(365))),
	recurringEndDate: v.optional(v.string()),
	type: v.optional(v.picklist(VALID_TASK_TYPES)),
	meetTime: v.optional(v.string()),
	meetDurationMinutes: v.optional(v.number()),
	subtasks: v.optional(v.array(v.pipe(v.string(), v.minLength(1)))),
	tagNames: v.optional(v.array(v.pipe(v.string(), v.minLength(1)))),
	assigneeUserIds: v.optional(v.array(v.pipe(v.string(), v.minLength(1))))
});

function validateRecurringPayload(data: {
	isRecurring?: boolean;
	recurringType?: string;
	dueDate?: string;
	recurringEndDate?: string;
}) {
	if (!data.isRecurring) return;
	if (!data.recurringType) {
		throw new Error('Selectează frecvența pentru task-ul recurent.');
	}
	if (!data.dueDate) {
		throw new Error('Selectează data limită pentru task-ul recurent.');
	}
	if (data.recurringEndDate && data.dueDate) {
		const [dy, dm, dd] = data.dueDate.split('-').map(Number);
		const [ey, em, ed] = data.recurringEndDate.split('-').map(Number);
		if (dy && dm && dd && ey && em && ed) {
			const due = new Date(dy, dm - 1, dd);
			const end = new Date(ey, em - 1, ed);
			if (end.getTime() < due.getTime()) {
				throw new Error('Data de sfârșit a recurenței trebuie să fie după data limită.');
			}
		}
	}
}


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

	let resolvedTask = task;

	if (!resolvedTask) {
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
			resolvedTask = sharedTask.task;
		}
	}

	if (!resolvedTask) {
		throw new Error('Task not found');
	}

	// Client portal isolation: client users can only see THEIR OWN client's tasks.
	if (event.locals.isClientUser && resolvedTask.clientId !== event.locals.client?.id) {
		throw new Error('Task not found');
	}

	const resolvedTenantId = resolvedTask.tenantId;

	// All three queries depend only on taskId + resolvedTenantId — fire in parallel
	const [subtasks, tagRows, assigneeRows] = await Promise.all([
		db
			.select()
			.from(table.subtask)
			.where(and(eq(table.subtask.taskId, taskId), eq(table.subtask.tenantId, resolvedTenantId)))
			.orderBy(asc(table.subtask.position), asc(table.subtask.createdAt)),

		db
			.select({
				id: table.taskTag.id,
				name: table.taskTag.name,
				color: table.taskTag.color
			})
			.from(table.taskToTag)
			.innerJoin(table.taskTag, eq(table.taskToTag.tagId, table.taskTag.id))
			.where(and(eq(table.taskToTag.taskId, taskId), eq(table.taskToTag.tenantId, resolvedTenantId))),

		db
			.select({
				userId: table.taskAssignee.userId,
				role: table.taskAssignee.role,
				firstName: table.user.firstName,
				lastName: table.user.lastName,
				email: table.user.email
			})
			.from(table.taskAssignee)
			.innerJoin(table.user, eq(table.taskAssignee.userId, table.user.id))
			.where(and(eq(table.taskAssignee.taskId, taskId), eq(table.taskAssignee.tenantId, resolvedTenantId)))
	]);

	return {
		...resolvedTask,
		subtasks,
		tags: tagRows,
		assignees: assigneeRows
	};
});

export const getTasks = query(
	v.object({
		projectId: v.optional(v.union([v.string(), v.array(v.string())])),
		clientId: v.optional(v.union([v.string(), v.array(v.string())])),
		milestoneId: v.optional(v.union([v.string(), v.array(v.string())])),
		status: v.optional(v.union([v.string(), v.array(v.string())])),
		priority: v.optional(v.union([v.string(), v.array(v.string())])),
		assignee: v.optional(v.union([v.string(), v.array(v.string())])),
		type: v.optional(
			v.union([v.picklist(VALID_TASK_TYPES), v.array(v.picklist(VALID_TASK_TYPES))])
		),
		search: v.optional(v.string()),
		dueDate: v.optional(v.string()), // 'overdue', 'today', 'thisWeek', 'thisMonth', or date range
		createdDate: v.optional(v.string()), // date range format: 'YYYY-MM-DD:YYYY-MM-DD'
		sortBy: v.optional(v.string()),
		sortDir: v.optional(v.union([v.literal('asc'), v.literal('desc')])),
		excludeCompleted: v.optional(v.boolean()), // when true, excludes done/cancelled (used by kanban view)
		include: v.optional(v.object({
			tags: v.optional(v.boolean()),
			assignees: v.optional(v.boolean()),
			subtasks: v.optional(v.boolean())
		}))
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

		// Type filter (task.type — design/video/ads/dev/content/meeting/other)
		if (filters.type) {
			const types = Array.isArray(filters.type) ? filters.type : [filters.type];
			conditions = and(conditions, inArray(table.task.type, types)) as any;
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
				// Overdue means dueDate in the past AND task is still actionable
				conditions = and(
					conditions,
					lt(table.task.dueDate, now),
					notInArray(table.task.status, ['done', 'cancelled'])
				) as any;
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

		const tasks = await queryBuilder;

		if (!filters.include || tasks.length === 0) {
			return tasks;
		}

		const taskIds = tasks.map((t: { id: string }) => t.id);
		const tenantId = event.locals.tenant.id;

		const subtaskCountMap: Record<string, { total: number; done: number }> = {};
		if (filters.include.subtasks) {
			const rows = await db
				.select({
					taskId: table.subtask.taskId,
					total: sql<number>`count(*)`,
					done: sql<number>`sum(case when ${table.subtask.done} = 1 then 1 else 0 end)`
				})
				.from(table.subtask)
				.where(and(inArray(table.subtask.taskId, taskIds), eq(table.subtask.tenantId, tenantId)))
				.groupBy(table.subtask.taskId);
			for (const row of rows) {
				subtaskCountMap[row.taskId] = { total: Number(row.total), done: Number(row.done) };
			}
		}

		const tagsByTask: Record<string, Array<{ id: string; name: string; color: string | null }>> = {};
		if (filters.include.tags) {
			const rows = await db
				.select({
					taskId: table.taskToTag.taskId,
					id: table.taskTag.id,
					name: table.taskTag.name,
					color: table.taskTag.color
				})
				.from(table.taskToTag)
				.innerJoin(table.taskTag, eq(table.taskToTag.tagId, table.taskTag.id))
				.where(and(inArray(table.taskToTag.taskId, taskIds), eq(table.taskToTag.tenantId, tenantId)));
			for (const row of rows) {
				(tagsByTask[row.taskId] ??= []).push({ id: row.id, name: row.name, color: row.color });
			}
		}

		const assigneesByTask: Record<string, Array<{ userId: string; role: string | null; firstName: string; lastName: string; email: string }>> = {};
		if (filters.include.assignees) {
			const rows = await db
				.select({
					taskId: table.taskAssignee.taskId,
					userId: table.taskAssignee.userId,
					role: table.taskAssignee.role,
					firstName: table.user.firstName,
					lastName: table.user.lastName,
					email: table.user.email
				})
				.from(table.taskAssignee)
				.innerJoin(table.user, eq(table.taskAssignee.userId, table.user.id))
				.where(and(inArray(table.taskAssignee.taskId, taskIds), eq(table.taskAssignee.tenantId, tenantId)));
			for (const row of rows) {
				(assigneesByTask[row.taskId] ??= []).push({ userId: row.userId, role: row.role, firstName: row.firstName, lastName: row.lastName, email: row.email });
			}
		}

		return tasks.map((t: { id: string }) => ({
			...t,
			...(filters.include!.subtasks ? {
				subtaskCount: subtaskCountMap[t.id]?.total ?? 0,
				subtaskDoneCount: subtaskCountMap[t.id]?.done ?? 0
			} : {}),
			...(filters.include!.tags ? { tags: tagsByTask[t.id] ?? [] } : {}),
			...(filters.include!.assignees ? { assignees: assigneesByTask[t.id] ?? [] } : {})
		}));
	}
);

export const getTaskClientIds = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	const rows = await db
		.selectDistinct({ clientId: table.task.clientId })
		.from(table.task)
		.where(
			and(eq(table.task.tenantId, event.locals.tenant.id), sql`${table.task.clientId} IS NOT NULL`)
		);

	return rows.map((r) => r.clientId).filter((id): id is string => !!id);
});

export const getCompletedTasks = query(
	v.object({
		projectId: v.optional(v.union([v.string(), v.array(v.string())])),
		clientId: v.optional(v.union([v.string(), v.array(v.string())])),
		milestoneId: v.optional(v.union([v.string(), v.array(v.string())])),
		priority: v.optional(v.union([v.string(), v.array(v.string())])),
		assignee: v.optional(v.union([v.string(), v.array(v.string())])),
		type: v.optional(
			v.union([v.picklist(VALID_TASK_TYPES), v.array(v.picklist(VALID_TASK_TYPES))])
		),
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

		// Type filter (task.type — design/video/ads/dev/content/meeting/other)
		if (filters.type) {
			const types = Array.isArray(filters.type) ? filters.type : [filters.type];
			conditions = and(conditions, inArray(table.task.type, types)) as any;
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

	validateRecurringPayload(data);

	// Resolve primary assignee from multi-select if provided
	if (!data.assignedToUserId && data.assigneeUserIds?.length) {
		data.assignedToUserId = data.assigneeUserIds[0];
	}

	const taskId = generateTaskId();
	// If client user, set status to pending-approval, otherwise use provided status or default to 'todo'
	const status = event.locals.isClientUser ? 'pending-approval' : data.status || 'todo';

	// Clients can only schedule tasks from tomorrow onwards.
	if (event.locals.isClientUser && data.dueDate) {
		const [y, m, d] = data.dueDate.split('-').map(Number);
		if (y && m && d) {
			const picked = new Date(y, m - 1, d);
			picked.setHours(0, 0, 0, 0);
			const tomorrow = new Date();
			tomorrow.setHours(0, 0, 0, 0);
			tomorrow.setDate(tomorrow.getDate() + 1);
			if (picked.getTime() < tomorrow.getTime()) {
				throw new Error('Data limită trebuie să fie de mâine sau mai târziu.');
			}
		}
	}

	// If client user, set clientId from context
	const clientId =
		event.locals.isClientUser && event.locals.client
			? event.locals.client.id
			: data.clientId || null;

	// Client portal task with no assignee → default to tenant owner/admin
	if (event.locals.isClientUser && !data.assignedToUserId) {
		const [owner] = await db
			.select({ userId: table.tenantUser.userId })
			.from(table.tenantUser)
			.where(
				and(
					eq(table.tenantUser.tenantId, targetTenantId),
					eq(table.tenantUser.role, 'owner')
				)
			)
			.limit(1);
		if (owner) {
			data.assignedToUserId = owner.userId;
		} else {
			const [admin] = await db
				.select({ userId: table.tenantUser.userId })
				.from(table.tenantUser)
				.where(
					and(
						eq(table.tenantUser.tenantId, targetTenantId),
						eq(table.tenantUser.role, 'admin')
					)
				)
				.limit(1);
			if (admin) data.assignedToUserId = admin.userId;
		}
	}

	// Get the highest position for this status to assign next position
	const [maxPositionResult] = await db
		.select({
			maxPosition: sql<number>`coalesce(max(${table.task.position}), -1)`.as('maxPosition')
		})
		.from(table.task)
		.where(and(eq(table.task.tenantId, targetTenantId), eq(table.task.status, status)));

	const nextPosition = (maxPositionResult?.maxPosition ?? -1) + 1;

	// Normalize tag names: lowercase + #-prefix + deduplicate (SQLite collation is case-sensitive)
	const uniqueTags = [
		...new Set(
			(data.tagNames || [])
				.map((t) => {
					const stripped = t.trim().startsWith('#') ? t.trim() : `#${t.trim()}`;
					return stripped.toLowerCase();
				})
				.filter((t) => t.length > 1)
		)
	];

	// Deduplicate assignee IDs before insert
	const uniqueAssigneeIds = [...new Set(data.assigneeUserIds || [])];

	// Atomic: task + subtasks + tags + assignees + watchers in one transaction
	await db.transaction(async (tx) => {
		await tx.insert(table.task).values({
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
			createdByUserId: event.locals.user.id,
			isRecurring: !!data.isRecurring,
			recurringType: data.isRecurring ? data.recurringType ?? null : null,
			recurringInterval: data.isRecurring ? data.recurringInterval ?? 1 : null,
			recurringEndDate:
				data.isRecurring && data.recurringEndDate ? new Date(data.recurringEndDate) : null,
			recurringParentId: null,
			recurringSpawnedAt: null,
			type: data.type || null
		});

		// Insert subtasks
		if (data.subtasks?.length) {
			for (let i = 0; i < data.subtasks.length; i++) {
				const subtaskId = generateTaskId();
				const now = Date.now();
				await tx.insert(table.subtask).values({
					id: subtaskId,
					taskId,
					tenantId: targetTenantId,
					title: data.subtasks[i],
					done: 0,
					position: i,
					createdByUserId: event.locals.user.id,
					createdAt: now,
					updatedAt: now
				});
			}
		}

		// Find-or-create tags and link to task (names already normalized + deduplicated)
		for (const normalizedName of uniqueTags) {
			const [existingTag] = await tx
				.select()
				.from(table.taskTag)
				.where(and(eq(table.taskTag.tenantId, targetTenantId), eq(table.taskTag.name, normalizedName)))
				.limit(1);
			let tagId: string;
			if (existingTag) {
				tagId = existingTag.id;
			} else {
				tagId = generateTaskId();
				await tx.insert(table.taskTag).values({
					id: tagId,
					tenantId: targetTenantId,
					name: normalizedName,
					createdAt: Date.now()
				});
			}
			await tx.insert(table.taskToTag).values({ taskId, tagId, tenantId: targetTenantId });
		}

		// Insert multi-assignees (deduplicated)
		for (const userId of uniqueAssigneeIds) {
			await tx.insert(table.taskAssignee).values({
				taskId,
				userId,
				tenantId: targetTenantId,
				createdAt: Date.now()
			});
		}

		// Auto-watch for creator
		const watcherId = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
		await tx.insert(table.taskWatcher).values({
			id: watcherId,
			taskId,
			userId: event.locals.user.id,
			tenantId: targetTenantId
		});

		// Auto-watch for assignee (if different from creator)
		if (data.assignedToUserId && data.assignedToUserId !== event.locals.user.id) {
			const assigneeWatcherId = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
			await tx.insert(table.taskWatcher).values({
				id: assigneeWatcherId,
				taskId,
				userId: data.assignedToUserId,
				tenantId: targetTenantId
			});
		}
	});

	// Emit task.created hook (always, regardless of assignee)
	try {
		const hooks = getHooksManager();
		await hooks.emit({
			type: 'task.created',
			taskId,
			taskTitle: data.title,
			createdByUserId: event.locals.user.id,
			assignedToUserId: data.assignedToUserId || null,
			priority: data.priority || 'medium',
			dueDate: data.dueDate ? new Date(data.dueDate) : null,
			clientId,
			tenantId: targetTenantId,
			tenantSlug: event.locals.tenant.slug
		});
	} catch {
		// Don't throw - task creation should succeed even if notification fails
	}

	// If task is assigned, send assignment email and in-app notification
	if (data.assignedToUserId) {
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

	// Auto-generate Google Meet for type=meeting tasks (separate integration)
	if (data.type === 'meeting' && data.meetTime) {
		const calStatus = await getCalendarStatus(event.locals.tenant.id);
		if (calStatus.connected) {
			try {
				const attendeeEmails: string[] = [];
				if (data.assigneeUserIds?.length) {
					const users = await db
						.select({ email: table.user.email })
						.from(table.user)
						.where(inArray(table.user.id, data.assigneeUserIds));
					attendeeEmails.push(...users.map((u) => u.email).filter((e): e is string => Boolean(e)));
				}
				if (clientId) {
					const [clientRow] = await db
						.select({ email: table.client.email })
						.from(table.client)
						.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, event.locals.tenant.id)))
						.limit(1);
					if (clientRow?.email) attendeeEmails.push(clientRow.email);
				}

				const meetResult = await createMeetEvent({
					tenantId: event.locals.tenant.id,
					title: data.title,
					startTime: new Date(data.meetTime),
					durationMinutes: data.meetDurationMinutes ?? 30,
					timezone: 'Europe/Bucharest',
					attendees: attendeeEmails,
					description: data.description ?? undefined
				});

				await db
					.update(table.task)
					.set({
						meetLink: meetResult.hangoutLink,
						googleCalendarEventId: meetResult.eventId
					})
					.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, event.locals.tenant.id)));

				await recordTaskActivity({
					taskId,
					userId: event.locals.user.id,
					tenantId: targetTenantId,
					action: 'meet_event_created',
					newValue: JSON.stringify({ eventId: meetResult.eventId, attendeeCount: attendeeEmails.length })
				});
			} catch (err) {
				if (!(err instanceof CalendarNotConnected)) {
					await recordTaskActivity({
						taskId,
						userId: event.locals.user.id,
						tenantId: targetTenantId,
						action: 'meet_event_failed',
						newValue: JSON.stringify({ stage: 'create', error: err instanceof Error ? err.message : String(err) })
					});
				}
				// Task succeeds regardless of Calendar failure
			}
		}
	}

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

			// Client users can only update limited fields (title, description, dueDate, recurrence on tasks they created)
			// Remove restricted fields
			delete updateData.status;
			delete updateData.priority;
			delete updateData.assignedToUserId;
			delete updateData.projectId;
			delete updateData.milestoneId;
			delete updateData.clientId;

			if (existing.createdByUserId !== event.locals.user.id) {
				delete updateData.isRecurring;
				delete updateData.recurringType;
				delete updateData.recurringInterval;
				delete updateData.recurringEndDate;
			}
		}

		const willBeRecurring = updateData.isRecurring ?? existing.isRecurring;
		validateRecurringPayload({
			isRecurring: willBeRecurring,
			recurringType: updateData.recurringType ?? existing.recurringType ?? undefined,
			dueDate: updateData.dueDate ?? (existing.dueDate ? existing.dueDate.toISOString().split('T')[0] : undefined),
			recurringEndDate: updateData.recurringEndDate ?? (existing.recurringEndDate ? existing.recurringEndDate.toISOString().split('T')[0] : undefined)
		});

		const oldAssigneeId = existing.assignedToUserId;
		const newAssigneeId = updateData.assignedToUserId;
		const assigneeChanged = newAssigneeId && oldAssigneeId !== newAssigneeId;
		const oldStatus = existing.status;
		const newStatus = updateData.status;
		const transitionedToDone = newStatus === 'done' && oldStatus !== 'done';

		const recurringPatch: {
			isRecurring?: boolean;
			recurringType?: 'daily' | 'weekly' | 'monthly' | 'yearly' | null;
			recurringInterval?: number | null;
			recurringEndDate?: Date | null;
		} = {};
		if (updateData.isRecurring !== undefined) {
			recurringPatch.isRecurring = !!updateData.isRecurring;
			if (!updateData.isRecurring) {
				recurringPatch.recurringType = null;
				recurringPatch.recurringInterval = null;
				recurringPatch.recurringEndDate = null;
			}
		}
		if (updateData.recurringType !== undefined) recurringPatch.recurringType = updateData.recurringType;
		if (updateData.recurringInterval !== undefined) recurringPatch.recurringInterval = updateData.recurringInterval;
		if (updateData.recurringEndDate !== undefined) {
			recurringPatch.recurringEndDate = updateData.recurringEndDate ? new Date(updateData.recurringEndDate) : null;
		}

		// Strip raw recurring fields from updateData so the spread doesn't reintroduce
		// the string-typed recurringEndDate (Drizzle expects Date).
		const {
			isRecurring: _ir,
			recurringType: _rt,
			recurringInterval: _ri,
			recurringEndDate: _red,
			subtasks: _subtasks,
			tagNames: _tagNames,
			assigneeUserIds: _assigneeUserIds,
			meetTime: _meetTime,
			meetDurationMinutes: _meetDurationMinutes,
			...restUpdateData
		} = updateData;

		await db
			.update(table.task)
			.set({
				...restUpdateData,
				...recurringPatch,
				dueDate: updateData.dueDate ? new Date(updateData.dueDate) : undefined,
				milestoneId: updateData.milestoneId || undefined,
				updatedAt: new Date()
			})
			.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, existing.tenantId)));

		// Record activity for changed fields
		const fieldsToTrack = ['title', 'description', 'status', 'priority', 'assignedToUserId', 'dueDate', 'clientId', 'projectId', 'milestoneId', 'isRecurring', 'recurringType', 'recurringInterval', 'recurringEndDate'] as const;
		const formatFieldValue = (val: unknown): string | null => {
			if (val == null) return null;
			if (val instanceof Date) return val.toISOString().split('T')[0];
			if (typeof val === 'boolean') return val ? 'true' : 'false';
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

		// If task transitioned to 'done' and is recurring, spawn the next occurrence
		if (transitionedToDone && (existing.isRecurring || updateData.isRecurring)) {
			try {
				await spawnNextRecurringTask(taskId);
			} catch (error) {
				logError('server', `Failed to spawn next recurring task for ${taskId}: ${(error as Error).message}`, { tenantId: existing.tenantId });
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
			// Determine change type BEFORE the email loop
			let changeType: string | undefined;
			if (updateData.status !== undefined && updateData.status !== existing.status) {
				changeType = 'status';
			} else if (updateData.dueDate !== undefined) {
				changeType = 'dueDate';
			} else {
				changeType = 'general';
			}

			// Single JOIN query — one DB roundtrip instead of N+1
			const watcherUsers = await db
				.select({
					userId: table.taskWatcher.userId,
					firstName: table.user.firstName,
					lastName: table.user.lastName,
					email: table.user.email
				})
				.from(table.taskWatcher)
				.innerJoin(table.user, eq(table.taskWatcher.userId, table.user.id))
				.where(
					and(
						eq(table.taskWatcher.taskId, taskId),
						eq(table.taskWatcher.tenantId, event.locals.tenant.id)
					)
				);

			// Release the write lock — email I/O runs AFTER DB work is complete.
			// Fire all notifications in parallel so one slow/failing send doesn't block the rest.
			await Promise.allSettled(
				watcherUsers
					.filter((w) => w.userId !== event.locals.user.id && w.email)
					.map(async (w) => {
						const watcherName = `${w.firstName} ${w.lastName}`.trim() || w.email!;
						await sendTaskUpdateEmail(taskId, w.email!, watcherName, changeType);
					})
			);
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

		// Emit task.completed hook when status transitions to 'done'
		if (transitionedToDone) {
			try {
				const hooks = getHooksManager();
				await hooks.emit({
					type: 'task.completed',
					taskId,
					taskTitle: existing.title,
					completedByUserId: event.locals.user.id,
					clientId: existing.clientId ?? undefined,
					tenantId: existing.tenantId,
					tenantSlug: event.locals.tenant.slug
				});
			} catch {
				// Don't throw - task update should succeed even if notification fails
			}
		}

		// ── Calendar diff sync (3-case) ──────────────────────────────────────────
		try {
			const hadEvent = Boolean(existing.googleCalendarEventId);
			const newType = updateData.type ?? existing.type;
			const isStillMeeting = newType === 'meeting';
			const newMeetTime = _meetTime ?? existing.meetTime;
			const newDuration = _meetDurationMinutes ?? existing.meetDurationMinutes;

			if (hadEvent && !isStillMeeting) {
				// Case A: type changed away from meeting → delete Calendar event
				const calStatus = await getCalendarStatus(event.locals.tenant.id);
				if (calStatus.connected) {
					const { deleteMeetEvent } = await import('$lib/server/google-calendar/meet');
					await deleteMeetEvent({ tenantId: event.locals.tenant.id, eventId: existing.googleCalendarEventId! });
					await db
						.update(table.task)
						.set({ meetLink: null, googleCalendarEventId: null })
						.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, existing.tenantId)));
					await recordTaskActivity({
						taskId,
						userId: event.locals.user.id,
						tenantId: existing.tenantId,
						action: 'meet_event_deleted'
					});
				}
			} else if (hadEvent && isStillMeeting) {
				// Case B: still a meeting + event exists → update if relevant field changed
				const titleChanged = updateData.title !== undefined && updateData.title !== existing.title;
				const descChanged = updateData.description !== undefined && updateData.description !== existing.description;
				const timeChanged = _meetTime !== undefined && _meetTime !== existing.meetTime;
				const durationChanged = _meetDurationMinutes !== undefined && _meetDurationMinutes !== existing.meetDurationMinutes;
				const clientChanged = updateData.clientId !== undefined && updateData.clientId !== existing.clientId;
				const assigneeChanged2 = updateData.assigneeUserIds !== undefined;

				if (titleChanged || descChanged || timeChanged || durationChanged || clientChanged || assigneeChanged2) {
					const calStatus = await getCalendarStatus(event.locals.tenant.id);
					if (calStatus.connected) {
						const { updateMeetEvent } = await import('$lib/server/google-calendar/meet');

						// Build fresh attendee list
						const assignees = await db
							.select({ email: table.user.email })
							.from(table.taskAssignee)
							.innerJoin(table.user, eq(table.taskAssignee.userId, table.user.id))
							.where(eq(table.taskAssignee.taskId, taskId));
						const attendeeEmails: string[] = assignees.map((a) => a.email).filter((e): e is string => Boolean(e));
						const effectiveClientId = updateData.clientId ?? existing.clientId;
						if (effectiveClientId) {
							const [clientRow] = await db
								.select({ email: table.client.email })
								.from(table.client)
								.where(and(eq(table.client.id, effectiveClientId), eq(table.client.tenantId, event.locals.tenant.id)))
								.limit(1);
							if (clientRow?.email) attendeeEmails.push(clientRow.email);
						}

						const startTime = newMeetTime ? new Date(newMeetTime) : undefined;
						await updateMeetEvent({
							tenantId: event.locals.tenant.id,
							eventId: existing.googleCalendarEventId!,
							title: updateData.title,
							description: updateData.description,
							startTime,
							durationMinutes: newDuration ?? undefined,
							timezone: 'Europe/Bucharest',
							attendees: attendeeEmails
						});
						await recordTaskActivity({
							taskId,
							userId: event.locals.user.id,
							tenantId: existing.tenantId,
							action: 'meet_event_updated',
							newValue: JSON.stringify({ eventId: existing.googleCalendarEventId })
						});
					}
				}
			} else if (!hadEvent && isStillMeeting && newMeetTime && updateData.type === 'meeting') {
				// Case C: just promoted to meeting type with a time → create Calendar event
				const calStatus = await getCalendarStatus(event.locals.tenant.id);
				if (calStatus.connected) {
					const { createMeetEvent: createMeet } = await import('$lib/server/google-calendar/meet');

					const assignees = await db
						.select({ email: table.user.email })
						.from(table.taskAssignee)
						.innerJoin(table.user, eq(table.taskAssignee.userId, table.user.id))
						.where(eq(table.taskAssignee.taskId, taskId));
					const attendeeEmails: string[] = assignees.map((a) => a.email).filter((e): e is string => Boolean(e));
					const effectiveClientId = updateData.clientId ?? existing.clientId;
					if (effectiveClientId) {
						const [clientRow] = await db
							.select({ email: table.client.email })
							.from(table.client)
							.where(and(eq(table.client.id, effectiveClientId), eq(table.client.tenantId, event.locals.tenant.id)))
							.limit(1);
						if (clientRow?.email) attendeeEmails.push(clientRow.email);
					}

					const meetResult = await createMeet({
						tenantId: event.locals.tenant.id,
						title: updateData.title ?? existing.title,
						startTime: new Date(newMeetTime),
						durationMinutes: newDuration ?? 30,
						timezone: 'Europe/Bucharest',
						attendees: attendeeEmails,
						description: updateData.description ?? existing.description ?? undefined
					});

					await db
						.update(table.task)
						.set({ meetLink: meetResult.hangoutLink, googleCalendarEventId: meetResult.eventId })
						.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, existing.tenantId)));

					await recordTaskActivity({
						taskId,
						userId: event.locals.user.id,
						tenantId: existing.tenantId,
						action: 'meet_event_created',
						newValue: JSON.stringify({ eventId: meetResult.eventId, attendeeCount: attendeeEmails.length })
					});
				}
			}
		} catch (err) {
			if (!(err instanceof CalendarNotConnected)) {
				await recordTaskActivity({
					taskId,
					userId: event.locals.user.id,
					tenantId: existing.tenantId,
					action: 'meet_event_failed',
					newValue: JSON.stringify({ stage: 'update', error: err instanceof Error ? err.message : String(err) })
				});
			}
			// Calendar failure must not roll back the task update
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
					eq(table.task.tenantId, existing.tenantId),
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
		if (event.locals.isClientUser) throw new Error('Unauthorized');

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

/**
 * Inline status edit (Table view + future bulk actions).
 * Tenant-scoped; records `status_changed` activity; fires client notification.
 * No position rebalancing — for ordered moves use updateTaskPosition.
 */
export const updateTaskStatus = command(
	v.object({
		taskId: v.pipe(v.string(), v.minLength(1)),
		newStatus: v.picklist(VALID_STATUSES)
	}),
	async ({ taskId, newStatus }) => {
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

		const oldStatus = task.status;
		if (oldStatus === newStatus) {
			return { success: true, changed: false };
		}

		await db
			.update(table.task)
			.set({ status: newStatus, updatedAt: new Date() })
			.where(eq(table.task.id, taskId));

		await recordTaskActivity({
			taskId,
			userId: event.locals.user.id,
			tenantId: event.locals.tenant.id,
			action: 'status_changed',
			field: 'status',
			oldValue: oldStatus,
			newValue: newStatus
		});

		await sendClientNotificationIfEnabled(
			taskId,
			event.locals.tenant.id,
			'status-change',
			{ newStatus },
			event.locals.user.email
		);

		return { success: true, changed: true };
	}
);

/**
 * Inline priority edit (Table view + future bulk actions).
 * Tenant-scoped; records `priority_changed` activity.
 */
export const updateTaskPriority = command(
	v.object({
		taskId: v.pipe(v.string(), v.minLength(1)),
		newPriority: v.picklist(VALID_PRIORITIES)
	}),
	async ({ taskId, newPriority }) => {
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

		const oldPriority = task.priority ?? 'medium';
		if (oldPriority === newPriority) {
			return { success: true, changed: false };
		}

		await db
			.update(table.task)
			.set({ priority: newPriority, updatedAt: new Date() })
			.where(eq(table.task.id, taskId));

		await recordTaskActivity({
			taskId,
			userId: event.locals.user.id,
			tenantId: event.locals.tenant.id,
			action: 'priority_changed',
			field: 'priority',
			oldValue: oldPriority,
			newValue: newPriority
		});

		return { success: true, changed: true };
	}
);

/**
 * Bulk status update — admin bulk action bar.
 * Multi-tenant safety: pre-fetch whitelist of task IDs scoped to current tenant
 * (never trust user-provided IDs directly in `IN (...)`).
 * Skips no-op rows; writes one `bulk_status_changed` activity row per changed task.
 */
export const bulkUpdateTaskStatus = command(
	v.object({
		taskIds: v.pipe(v.array(v.pipe(v.string(), v.minLength(1))), v.minLength(1), v.maxLength(500)),
		newStatus: v.picklist(VALID_STATUSES)
	}),
	async ({ taskIds, newStatus }) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}
		const tenantId = event.locals.tenant.id;
		const userId = event.locals.user.id;

		// Whitelist IDs that actually belong to this tenant
		const ownedTasks = await db
			.select({ id: table.task.id, status: table.task.status })
			.from(table.task)
			.where(and(eq(table.task.tenantId, tenantId), inArray(table.task.id, taskIds)));

		// Filter to tasks where status actually changes
		const changedTasks = ownedTasks.filter((t) => t.status !== newStatus);
		const changedIds = changedTasks.map((t) => t.id);

		if (changedIds.length === 0) {
			return {
				success: true,
				totalRequested: taskIds.length,
				owned: ownedTasks.length,
				changed: 0
			};
		}

		await db.transaction(async (tx) => {
			await tx
				.update(table.task)
				.set({ status: newStatus, updatedAt: new Date() })
				.where(
					and(eq(table.task.tenantId, tenantId), inArray(table.task.id, changedIds))
				);
		});

		// Batch activity insert — single DB roundtrip instead of N sequential inserts
		const activityRows = changedTasks.map((t) => ({
			id: encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15))),
			taskId: t.id,
			userId,
			tenantId,
			action: 'bulk_status_changed',
			field: 'status',
			oldValue: t.status,
			newValue: newStatus,
			createdAt: new Date()
		}));

		try {
			await db.insert(table.taskActivity).values(activityRows);
		} catch (error) {
			logWarning('server', 'Bulk status activity insert failed', {
				tenantId,
				metadata: { error: (error as Error).message, newStatus, count: activityRows.length }
			});
		}

		// Parallel client notifications — all fire concurrently, failures are isolated
		await Promise.allSettled(
			changedTasks.map((t) =>
				sendClientNotificationIfEnabled(
					t.id,
					tenantId,
					'status-change',
					{ newStatus },
					event.locals.user.email
				)
			)
		);

		return {
			success: true,
			totalRequested: taskIds.length,
			owned: ownedTasks.length,
			changed: changedIds.length
		};
	}
);

/**
 * Bulk delete — admin bulk action bar.
 * Hard delete; FK cascades remove subtasks/activity/assignees/tags-join.
 * Multi-tenant safety via whitelist.
 */
export const bulkDeleteTasks = command(
	v.pipe(v.array(v.pipe(v.string(), v.minLength(1))), v.minLength(1), v.maxLength(500)),
	async (taskIds) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}
		const tenantId = event.locals.tenant.id;

		const owned = await db
			.select({ id: table.task.id })
			.from(table.task)
			.where(and(eq(table.task.tenantId, tenantId), inArray(table.task.id, taskIds)));
		const ownedIds = owned.map((t) => t.id);
		if (ownedIds.length === 0) {
			return { success: true, totalRequested: taskIds.length, deleted: 0 };
		}

		await db.transaction(async (tx) => {
			await tx
				.delete(table.task)
				.where(and(eq(table.task.tenantId, tenantId), inArray(table.task.id, ownedIds)));
		});

		return { success: true, totalRequested: taskIds.length, deleted: ownedIds.length };
	}
);

/**
 * Bulk duplicate — admin bulk action bar.
 * Copies title (prefixed "Copie - "), description, priority, type, client/project/milestone refs,
 * subtasks, tags-join, and assignees. New tasks land in `status='todo'` with `position=null`.
 * Recurring metadata is reset (the copy is a one-off).
 */
export const bulkDuplicateTasks = command(
	v.pipe(v.array(v.pipe(v.string(), v.minLength(1))), v.minLength(1), v.maxLength(100)),
	async (taskIds) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}
		const tenantId = event.locals.tenant.id;
		const userId = event.locals.user.id;

		// Whitelist + fetch full rows
		const sourceTasks = await db
			.select()
			.from(table.task)
			.where(and(eq(table.task.tenantId, tenantId), inArray(table.task.id, taskIds)));

		if (sourceTasks.length === 0) {
			return { success: true, totalRequested: taskIds.length, duplicated: 0, newIds: [] as string[] };
		}

		// Pre-load subtasks, tag-joins, and assignees for the source set
		const sourceIds = sourceTasks.map((t) => t.id);
		const [sourceSubtasks, sourceTagLinks, sourceAssignees] = await Promise.all([
			db
				.select()
				.from(table.subtask)
				.where(and(eq(table.subtask.tenantId, tenantId), inArray(table.subtask.taskId, sourceIds))),
			db
				.select()
				.from(table.taskToTag)
				.where(and(eq(table.taskToTag.tenantId, tenantId), inArray(table.taskToTag.taskId, sourceIds))),
			db
				.select()
				.from(table.taskAssignee)
				.where(and(eq(table.taskAssignee.tenantId, tenantId), inArray(table.taskAssignee.taskId, sourceIds)))
		]);

		// Group by source task id
		const subtasksByTask = new Map<string, typeof sourceSubtasks>();
		for (const s of sourceSubtasks) {
			const list = subtasksByTask.get(s.taskId) ?? [];
			list.push(s);
			subtasksByTask.set(s.taskId, list);
		}
		const tagLinksByTask = new Map<string, typeof sourceTagLinks>();
		for (const tl of sourceTagLinks) {
			const list = tagLinksByTask.get(tl.taskId) ?? [];
			list.push(tl);
			tagLinksByTask.set(tl.taskId, list);
		}
		const assigneesByTask = new Map<string, typeof sourceAssignees>();
		for (const a of sourceAssignees) {
			const list = assigneesByTask.get(a.taskId) ?? [];
			list.push(a);
			assigneesByTask.set(a.taskId, list);
		}

		const newIds: string[] = [];
		const nowDate = new Date();
		const nowMs = Date.now();

		// Pre-build ALL insert rows OUTSIDE the transaction to avoid sequential awaits
		// inside it (Turso has ~30s tx time limits — 2000+ sequential round-trips would
		// reliably timeout for tenants with subtask-heavy task sets).
		const taskRows: Array<typeof table.task.$inferInsert> = [];
		const subtaskRows: Array<typeof table.subtask.$inferInsert> = [];
		const tagLinkRows: Array<typeof table.taskToTag.$inferInsert> = [];
		const assigneeRows: Array<typeof table.taskAssignee.$inferInsert> = [];

		for (const src of sourceTasks) {
			const newId = generateTaskId();
			newIds.push(newId);

			taskRows.push({
				id: newId,
				tenantId,
				projectId: src.projectId,
				clientId: src.clientId,
				milestoneId: src.milestoneId,
				title: `Copie - ${src.title}`,
				description: src.description,
				status: 'todo',
				priority: src.priority,
				position: null,
				dueDate: src.dueDate,
				assignedToUserId: src.assignedToUserId,
				createdByUserId: userId,
				isRecurring: false,
				recurringType: null,
				recurringInterval: null,
				recurringEndDate: null,
				recurringParentId: null,
				type: src.type,
				meetTime: null,
				meetDurationMinutes: null,
				createdAt: nowDate,
				updatedAt: nowDate
			});

			for (const s of subtasksByTask.get(src.id) ?? []) {
				subtaskRows.push({
					id: generateTaskId(),
					taskId: newId,
					tenantId,
					title: s.title,
					done: 0,
					position: s.position,
					createdByUserId: userId,
					createdAt: nowMs,
					updatedAt: nowMs
				});
			}

			for (const tl of tagLinksByTask.get(src.id) ?? []) {
				tagLinkRows.push({
					taskId: newId,
					tagId: tl.tagId,
					tenantId
				});
			}

			for (const a of assigneesByTask.get(src.id) ?? []) {
				assigneeRows.push({
					taskId: newId,
					userId: a.userId,
					role: a.role,
					tenantId,
					createdAt: nowMs
				});
			}
		}

		// Single transaction with at most 4 INSERT statements regardless of input size.
		// Drizzle batches the rows into one parameterized statement per table.
		await db.transaction(async (tx) => {
			if (taskRows.length > 0) {
				await tx.insert(table.task).values(taskRows);
			}
			if (subtaskRows.length > 0) {
				await tx.insert(table.subtask).values(subtaskRows);
			}
			if (tagLinkRows.length > 0) {
				await tx.insert(table.taskToTag).values(tagLinkRows);
			}
			if (assigneeRows.length > 0) {
				await tx.insert(table.taskAssignee).values(assigneeRows);
			}
		});

		// Activity log: 'duplicated' on each NEW task — single batched INSERT
		const duplicateActivityRows = sourceTasks.map((src, i) => ({
			id: encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15))),
			taskId: newIds[i],
			userId,
			tenantId,
			action: 'duplicated',
			field: 'origin',
			oldValue: null as string | null,
			newValue: src.id,
			createdAt: new Date()
		}));

		try {
			await db.insert(table.taskActivity).values(duplicateActivityRows);
		} catch (error) {
			logWarning('server', `Bulk duplicate activity insert failed for ${duplicateActivityRows.length} tasks`, {
				tenantId,
				metadata: { error: (error as Error).message }
			});
		}

		return {
			success: true,
			totalRequested: taskIds.length,
			duplicated: sourceTasks.length,
			newIds
		};
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

	// Best-effort: delete Calendar event before removing the task row
	if (task.googleCalendarEventId) {
		const calStatus = await getCalendarStatus(event.locals.tenant.id);
		if (calStatus.connected) {
			try {
				const { deleteMeetEvent } = await import('$lib/server/google-calendar/meet');
				await deleteMeetEvent({ tenantId: event.locals.tenant.id, eventId: task.googleCalendarEventId });
			} catch (err) {
				logWarning('google-calendar', 'Calendar event delete failed during task delete', {
					tenantId: event.locals.tenant.id,
					metadata: { taskId, eventId: task.googleCalendarEventId, error: err instanceof Error ? err.message : String(err) }
				});
			}
		}
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
			.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, event.locals.tenant.id)));

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
		.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, event.locals.tenant.id)));

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

export const getTags = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	return db
		.select()
		.from(table.taskTag)
		.where(eq(table.taskTag.tenantId, event.locals.tenant.id))
		.orderBy(asc(table.taskTag.name));
});

export const toggleSubtask = command(
	v.object({ subtaskId: v.pipe(v.string(), v.minLength(1)), done: v.boolean() }),
	async ({ subtaskId, done }) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
		if (event.locals.isClientUser) throw new Error('Unauthorized');

		const result = await db
			.update(table.subtask)
			.set({ done: done ? 1 : 0, updatedAt: Date.now() })
			.where(and(eq(table.subtask.id, subtaskId), eq(table.subtask.tenantId, event.locals.tenant.id)))
			.returning({ id: table.subtask.id });

		if (result.length === 0) throw new Error('Subtask not found');

		return { success: true };
	}
);

export const addSubtask = command(
	v.object({ taskId: v.pipe(v.string(), v.minLength(1)), title: v.pipe(v.string(), v.minLength(1)) }),
	async ({ taskId, title }) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
		if (event.locals.isClientUser) throw new Error('Unauthorized');

		const [task] = await db
			.select({ id: table.task.id, tenantId: table.task.tenantId })
			.from(table.task)
			.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, event.locals.tenant.id)))
			.limit(1);

		if (!task) throw new Error('Task not found');

		const [last] = await db
			.select({ position: table.subtask.position })
			.from(table.subtask)
			.where(eq(table.subtask.taskId, taskId))
			.orderBy(desc(table.subtask.position))
			.limit(1);

		const position = (last?.position ?? -1) + 1;
		const id = generateTaskId();
		const now = Date.now();

		await db.insert(table.subtask).values({
			id,
			taskId,
			tenantId: event.locals.tenant.id,
			title: title.trim(),
			done: 0,
			position,
			createdByUserId: event.locals.user.id,
			createdAt: now,
			updatedAt: now
		});

		return { success: true, id };
	}
);

export const deleteSubtask = command(
	v.pipe(v.string(), v.minLength(1)),
	async (subtaskId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
		if (event.locals.isClientUser) throw new Error('Unauthorized');

		const result = await db
			.delete(table.subtask)
			.where(and(eq(table.subtask.id, subtaskId), eq(table.subtask.tenantId, event.locals.tenant.id)))
			.returning({ id: table.subtask.id });

		if (result.length === 0) throw new Error('Subtask not found');

		return { success: true };
	}
);

export const updateSubtask = command(
	v.object({
		subtaskId: v.pipe(v.string(), v.minLength(1)),
		done: v.optional(v.boolean()),
		title: v.optional(v.pipe(v.string(), v.minLength(1)))
	}),
	async ({ subtaskId, done, title }) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
		if (event.locals.isClientUser) throw new Error('Unauthorized');

		const [sub] = await db
			.select()
			.from(table.subtask)
			.where(and(eq(table.subtask.id, subtaskId), eq(table.subtask.tenantId, event.locals.tenant.id)))
			.limit(1);

		if (!sub) throw new Error('Subtask not found');

		await db.update(table.subtask).set({
			...(done !== undefined ? { done: done ? 1 : 0 } : {}),
			...(title !== undefined ? { title } : {}),
			updatedAt: Date.now()
		}).where(and(eq(table.subtask.id, subtaskId), eq(table.subtask.tenantId, event.locals.tenant.id)));

		return { success: true };
	}
);

export const addAssignee = command(
	v.object({
		taskId: v.pipe(v.string(), v.minLength(1)),
		userId: v.pipe(v.string(), v.minLength(1)),
		role: v.optional(v.string())
	}),
	async ({ taskId, userId, role }) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
		// Block client users from assigning anyone
		if (event.locals.isClientUser) throw new Error('Unauthorized');

		const tenantId = event.locals.tenant.id;

		const [task] = await db
			.select({ id: table.task.id, clientId: table.task.clientId })
			.from(table.task)
			.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, tenantId)))
			.limit(1);
		if (!task) throw new Error('Task not found');

		// Validate the user being assigned. Two acceptable shapes:
		//  A. Agency user: row in tenant_user for current tenant
		//  B. Client user: row in client_user for the task's clientId + current tenant
		const [agencyMembership] = await db
			.select({ userId: table.tenantUser.userId })
			.from(table.tenantUser)
			.where(
				and(
					eq(table.tenantUser.userId, userId),
					eq(table.tenantUser.tenantId, tenantId)
				)
			)
			.limit(1);

		if (!agencyMembership) {
			// Not an agency user — must be a valid client user for this task's client
			if (!task.clientId) {
				throw new Error('User is not a member of this tenant');
			}
			const [clientMembership] = await db
				.select({ userId: table.clientUser.userId })
				.from(table.clientUser)
				.where(
					and(
						eq(table.clientUser.userId, userId),
						eq(table.clientUser.clientId, task.clientId),
						eq(table.clientUser.tenantId, tenantId)
					)
				)
				.limit(1);
			if (!clientMembership) {
				throw new Error('User is not associated with this task\'s client');
			}
		}

		const [existing] = await db
			.select({ taskId: table.taskAssignee.taskId })
			.from(table.taskAssignee)
			.where(
				and(
					eq(table.taskAssignee.taskId, taskId),
					eq(table.taskAssignee.userId, userId),
					eq(table.taskAssignee.tenantId, tenantId)
				)
			)
			.limit(1);

		if (!existing) {
			await db.insert(table.taskAssignee).values({
				taskId,
				userId,
				tenantId,
				role: role ?? null,
				createdAt: Date.now()
			});
		}

		return { success: true };
	}
);

export const removeAssignee = command(
	v.object({
		taskId: v.pipe(v.string(), v.minLength(1)),
		userId: v.pipe(v.string(), v.minLength(1))
	}),
	async ({ taskId, userId }) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');

		const [task] = await db.select()
			.from(table.task)
			.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, event.locals.tenant.id)))
			.limit(1);
		if (!task) throw new Error('Task not found');

		await db.transaction(async (tx) => {
			await tx.delete(table.taskAssignee)
				.where(and(
					eq(table.taskAssignee.taskId, taskId),
					eq(table.taskAssignee.userId, userId),
					eq(table.taskAssignee.tenantId, event.locals.tenant.id)
				));

			if (task.assignedToUserId === userId) {
				const [next] = await tx.select({ userId: table.taskAssignee.userId })
					.from(table.taskAssignee)
					.where(and(
						eq(table.taskAssignee.taskId, taskId),
						eq(table.taskAssignee.tenantId, event.locals.tenant.id)
					))
					.orderBy(asc(table.taskAssignee.createdAt))
					.limit(1);

				await tx.update(table.task).set({
					assignedToUserId: next?.userId ?? null,
					updatedAt: new Date()
				}).where(eq(table.task.id, taskId));
			}
		});

		return { success: true };
	}
);

export const addTag = command(
	v.object({
		taskId: v.pipe(v.string(), v.minLength(1)),
		tagName: v.pipe(v.string(), v.minLength(1))
	}),
	async ({ taskId, tagName }) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');

		const [task] = await db.select({ id: table.task.id })
			.from(table.task)
			.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, event.locals.tenant.id)))
			.limit(1);
		if (!task) throw new Error('Task not found');

		const tenantId = event.locals.tenant.id;
		const normalizedName = (tagName.trim().startsWith('#') ? tagName.trim() : `#${tagName.trim()}`).toLowerCase();

		await db.transaction(async (tx) => {
			const [existing] = await tx.select({ id: table.taskTag.id })
				.from(table.taskTag)
				.where(and(eq(table.taskTag.tenantId, tenantId), eq(table.taskTag.name, normalizedName)))
				.limit(1);

			const tagId = existing?.id ?? generateTaskId();
			if (!existing) {
				await tx.insert(table.taskTag).values({ id: tagId, tenantId, name: normalizedName, createdAt: Date.now() });
			}

			const [existingLink] = await tx.select({ taskId: table.taskToTag.taskId })
				.from(table.taskToTag)
				.where(and(eq(table.taskToTag.taskId, taskId), eq(table.taskToTag.tagId, tagId)))
				.limit(1);

			if (!existingLink) {
				await tx.insert(table.taskToTag).values({ taskId, tagId, tenantId });
			}
		});

		return { success: true };
	}
);

export const removeTag = command(
	v.object({
		taskId: v.pipe(v.string(), v.minLength(1)),
		tagId: v.pipe(v.string(), v.minLength(1))
	}),
	async ({ taskId, tagId }) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');

		const [task] = await db.select({ id: table.task.id })
			.from(table.task)
			.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, event.locals.tenant.id)))
			.limit(1);
		if (!task) throw new Error('Task not found');

		await db.delete(table.taskToTag)
			.where(and(
				eq(table.taskToTag.taskId, taskId),
				eq(table.taskToTag.tagId, tagId),
				eq(table.taskToTag.tenantId, event.locals.tenant.id)
			));

		return { success: true };
	}
);

export const scheduleMeet = command(
	v.object({
		taskId: v.pipe(v.string(), v.minLength(1)),
		meetLink: v.optional(v.string()),
		meetTime: v.optional(v.string()),
		meetDurationMinutes: v.optional(v.number())
	}),
	async ({ taskId, meetLink, meetTime, meetDurationMinutes }) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
		if (event.locals.isClientUser) throw new Error('Unauthorized');

		const [task] = await db.select({ id: table.task.id })
			.from(table.task)
			.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, event.locals.tenant.id)))
			.limit(1);
		if (!task) throw new Error('Task not found');

		await db.update(table.task).set({
			meetLink: meetLink ?? null,
			meetTime: meetTime ?? null,
			meetDurationMinutes: meetDurationMinutes ?? null,
			updatedAt: new Date()
		}).where(eq(table.task.id, taskId));

		// Auto-generate Calendar event when scheduling a time (and no event yet)
		if (meetTime) {
			const [taskRow] = await db
				.select({
					id: table.task.id,
					title: table.task.title,
					description: table.task.description,
					clientId: table.task.clientId,
					meetDurationMinutes: table.task.meetDurationMinutes,
					googleCalendarEventId: table.task.googleCalendarEventId
				})
				.from(table.task)
				.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, event.locals.tenant.id)))
				.limit(1);

			if (taskRow && !taskRow.googleCalendarEventId) {
				const calStatus = await getCalendarStatus(event.locals.tenant.id);
				if (calStatus.connected) {
					try {
						const assignees = await db
							.select({ email: table.user.email })
							.from(table.taskAssignee)
							.innerJoin(table.user, eq(table.taskAssignee.userId, table.user.id))
							.where(eq(table.taskAssignee.taskId, taskId));
						const attendeeEmails: string[] = assignees.map((a) => a.email).filter((e): e is string => Boolean(e));

						if (taskRow.clientId) {
							const [clientRow] = await db
								.select({ email: table.client.email })
								.from(table.client)
								.where(and(eq(table.client.id, taskRow.clientId), eq(table.client.tenantId, event.locals.tenant.id)))
								.limit(1);
							if (clientRow?.email) attendeeEmails.push(clientRow.email);
						}

						const meetResult = await createMeetEvent({
							tenantId: event.locals.tenant.id,
							title: taskRow.title,
							startTime: new Date(meetTime),
							durationMinutes: meetDurationMinutes ?? taskRow.meetDurationMinutes ?? 30,
							timezone: 'Europe/Bucharest',
							attendees: attendeeEmails,
							description: taskRow.description ?? undefined
						});

						await db
							.update(table.task)
							.set({ meetLink: meetResult.hangoutLink, googleCalendarEventId: meetResult.eventId })
							.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, event.locals.tenant.id)));

						await recordTaskActivity({
							taskId,
							userId: event.locals.user.id,
							tenantId: event.locals.tenant.id,
							action: 'meet_event_created',
							newValue: JSON.stringify({ eventId: meetResult.eventId, attendeeCount: attendeeEmails.length })
						});
					} catch (err) {
						if (!(err instanceof CalendarNotConnected)) {
							await recordTaskActivity({
								taskId,
								userId: event.locals.user.id,
								tenantId: event.locals.tenant.id,
								action: 'meet_event_failed',
								newValue: JSON.stringify({ stage: 'schedule', error: err instanceof Error ? err.message : String(err) })
							});
						}
					}
				}
			}
		}

		return { success: true };
	}
);
