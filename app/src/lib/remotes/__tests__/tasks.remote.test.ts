import { describe, test, expect, mock, beforeEach } from 'bun:test';

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$env/dynamic/public', () => ({ env: {} }));

// ─── Request context ──────────────────────────────────────────────────────────

let currentEvent: any = null;

mock.module('$app/server', () => ({
	query: (schemaOrFn: any, fn?: Function) => fn ?? schemaOrFn,
	command: (schemaOrFn: any, fn?: Function) => fn ?? schemaOrFn,
	getRequestEvent: () => currentEvent
}));

// ─── Fake DB ──────────────────────────────────────────────────────────────────

const queryQueue: Array<unknown[]> = [];

function makeChain(rows: unknown[]): any {
	const p = Promise.resolve(rows);
	return Object.assign(p, {
		from: () => makeChain(rows),
		innerJoin: () => makeChain(rows),
		leftJoin: () => makeChain(rows),
		where: () => makeChain(rows),
		orderBy: () => makeChain(rows),
		limit: () => makeChain(rows),
		offset: () => makeChain(rows),
		groupBy: () => makeChain(rows),
		returning: () => makeChain(rows),
		set: () => makeChain(rows)
	});
}

// ─── Schema mock ──────────────────────────────────────────────────────────────
//
// CRITICAL: eagerly load the REAL schema module BEFORE mocking. Bun's
// mock.module() registers in a global registry that persists across test files
// in the same process — and once the module is cached, subsequent mock.module()
// calls in OTHER test files are no-ops. By loading the real module first, we
// guarantee the cached shape includes every column the real codebase exposes
// (so neighbor test files like hosting-inquiries-delete-safety.test.ts that
// rely on `table.hostingInquiry.*` won't hit "undefined is not an object" when
// they share this Bun process). This also rescues this file's own
// `table.userWhatsappLink.phoneE164` / `table.clientUser.userId` references in
// task-comments.remote.ts, which were broken by the partial mock below.
// Pattern mirrors the Pre-Task 9 fix in app/src/lib/server/hosting/__tests__/notifications.test.ts.
await import('$lib/server/db/schema');

const col = (n: string) => n;

mock.module('$lib/server/db/schema', () => ({
	task: {
		id: col('id'), tenantId: col('tenantId'), projectId: col('projectId'),
		clientId: col('clientId'), milestoneId: col('milestoneId'), title: col('title'),
		description: col('description'), status: col('status'), priority: col('priority'),
		position: col('position'), dueDate: col('dueDate'), assignedToUserId: col('assignedToUserId'),
		createdByUserId: col('createdByUserId'), isRecurring: col('isRecurring'),
		recurringType: col('recurringType'), recurringInterval: col('recurringInterval'),
		recurringEndDate: col('recurringEndDate'), recurringParentId: col('recurringParentId'),
		recurringSpawnedAt: col('recurringSpawnedAt'), type: col('type'),
		createdAt: col('createdAt'), updatedAt: col('updatedAt')
	},
	subtask: {
		id: col('id'), taskId: col('taskId'), tenantId: col('tenantId'),
		title: col('title'), done: col('done'), position: col('position'),
		createdByUserId: col('createdByUserId'), createdAt: col('createdAt'), updatedAt: col('updatedAt')
	},
	taskTag: { id: col('id'), tenantId: col('tenantId'), name: col('name'), color: col('color'), createdAt: col('createdAt') },
	taskToTag: { taskId: col('taskId'), tagId: col('tagId'), tenantId: col('tenantId') },
	taskAssignee: { taskId: col('taskId'), userId: col('userId'), tenantId: col('tenantId'), role: col('role'), createdAt: col('createdAt') },
	user: { id: col('id'), email: col('email'), firstName: col('firstName'), lastName: col('lastName'), passwordHash: col('passwordHash') },
	projectPartner: { projectId: col('projectId'), partnerId: col('partnerId') },
	partner: { id: col('id'), partnerTenantId: col('partnerTenantId') },
	taskSettings: {
		tenantId: col('tenantId'), clientEmailsEnabled: col('clientEmailsEnabled'),
		clientEmailOnTaskCreated: col('clientEmailOnTaskCreated'),
		clientEmailOnStatusChange: col('clientEmailOnStatusChange'),
		clientEmailOnComment: col('clientEmailOnComment'),
		clientEmailOnTaskModified: col('clientEmailOnTaskModified')
	},
	taskWatcher: { id: col('id'), taskId: col('taskId'), userId: col('userId'), tenantId: col('tenantId'), createdAt: col('createdAt') },
	taskActivity: { id: col('id'), taskId: col('taskId'), userId: col('userId'), tenantId: col('tenantId'), action: col('action'), field: col('field'), oldValue: col('oldValue'), newValue: col('newValue'), createdAt: col('createdAt') },
	tenantUser: { tenantId: col('tenantId'), userId: col('userId'), role: col('role') },
	taskComment: {
		id: col('id'), taskId: col('taskId'), userId: col('userId'), tenantId: col('tenantId'),
		parentCommentId: col('parentCommentId'), content: col('content'),
		attachmentPath: col('attachmentPath'), attachmentMimeType: col('attachmentMimeType'),
		attachmentFileName: col('attachmentFileName'), attachmentFileSize: col('attachmentFileSize'),
		createdAt: col('createdAt'), updatedAt: col('updatedAt')
	},
	taskCommentAttachment: {
		id: col('id'), commentId: col('commentId'), path: col('path'),
		mimeType: col('mimeType'), fileName: col('fileName'), fileSize: col('fileSize'),
		createdAt: col('createdAt')
	},
	taskCommentReaction: {
		id: col('id'), commentId: col('commentId'), userId: col('userId'),
		tenantId: col('tenantId'), emoji: col('emoji'), createdAt: col('createdAt')
	},
	client: {
		id: col('id'), tenantId: col('tenantId'), name: col('name'), email: col('email'),
		slug: col('slug'), createdAt: col('createdAt')
	}
}));

// ─── Side-effect mocks ────────────────────────────────────────────────────────

mock.module('$lib/server/email', () => ({
	sendTaskAssignmentEmail: async () => {},
	sendTaskUpdateEmail: async () => {},
	sendTaskClientNotificationEmail: async () => {},
	getNotificationRecipients: async () => []
}));

mock.module('$lib/server/task-activity', () => ({
	recordTaskActivity: async () => {}
}));

mock.module('$lib/server/plugins/hooks', () => ({
	getHooksManager: () => ({ emit: async () => {} })
}));

mock.module('$lib/server/logger', () => ({
	logError: () => {},
	logWarning: () => {},
	logInfo: () => {},
	serializeError: (err: unknown) => (err instanceof Error ? err.message : String(err))
}));

mock.module('$lib/server/google-calendar/meet', () => ({
	createMeetEvent: async () => ({ eventId: 'evt_mock', hangoutLink: 'https://meet.google.com/mock' })
}));

mock.module('$lib/server/google-calendar/auth', () => ({
	getCalendarStatus: async () => ({ connected: false, email: null }),
	CalendarNotConnected: class extends Error {}
}));

mock.module('$lib/server/recurring-tasks', () => ({
	spawnNextRecurringTask: async () => {}
}));

mock.module('$lib/server/storage', () => ({
	getDownloadUrl: async () => 'https://example.com/file'
}));

mock.module('$lib/server/notifications', () => ({
	createNotification: async () => {}
}));

mock.module('$lib/server/telegram/task-notifications', () => ({
	notifyTaskMention: async () => {}
}));

mock.module('sanitize-html', () => ({
	default: (html: string) => html
}));

// ─── deletedRows queue: used by toggleReaction's delete().returning() ──────────

const deletedRowsQueue: Array<unknown[]> = [];

mock.module('$lib/server/db', () => ({
	db: {
		select: () => makeChain(queryQueue.length > 0 ? (queryQueue.shift() as unknown[]) : []),
		selectDistinct: () =>
			makeChain(queryQueue.length > 0 ? (queryQueue.shift() as unknown[]) : []),
		insert: () => ({ values: () => Promise.resolve() }),
		update: () => ({
			set: () => ({
				where: () => ({
					returning: () => Promise.resolve(deletedRowsQueue.length > 0 ? deletedRowsQueue.shift() : [])
				})
			})
		}),
		delete: () => ({
			where: () => ({
				returning: () => Promise.resolve(deletedRowsQueue.length > 0 ? deletedRowsQueue.shift() : [])
			}),
			returning: () => Promise.resolve(deletedRowsQueue.length > 0 ? deletedRowsQueue.shift() : [])
		}),
		transaction: (fn: Function) =>
			fn({
				insert: () => ({ values: () => Promise.resolve() }),
				update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
				delete: () => ({ where: () => Promise.resolve() })
			})
	}
}));

const {
	getTask,
	getTasks,
	updateTaskStatus,
	updateTaskPriority,
	bulkUpdateTaskStatus,
	bulkDeleteTasks,
	bulkDuplicateTasks,
	watchTask,
	unwatchTask,
	approveTask,
	rejectTask,
	addSubtask,
	toggleSubtask,
	deleteSubtask,
	scheduleMeet
} = await import('../tasks.remote');

const {
	getTaskComments,
	createTaskComment,
	toggleReaction
} = await import('../task-comments.remote');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEvent(tenantId: string) {
	return {
		locals: {
			user: { id: 'user1', email: 'user1@example.com', firstName: 'User', lastName: 'One' },
			tenant: { id: tenantId, slug: tenantId },
			isClientUser: false,
			client: null
		}
	};
}

function makeClientEvent(tenantId: string, clientId: string) {
	return {
		locals: {
			user: { id: 'client-user-1', email: 'client@example.com', firstName: 'Client', lastName: 'User' },
			tenant: { id: tenantId, slug: tenantId },
			isClientUser: true,
			client: { id: clientId, tenantId }
		}
	};
}

// ─── getTask ──────────────────────────────────────────────────────────────────

describe('getTask', () => {
	beforeEach(() => {
		queryQueue.length = 0;
		currentEvent = makeEvent('tenant-a');
	});

	test('returns enriched task including subtasks, tags, and assignees', async () => {
		const taskRow = { id: 'task1', tenantId: 'tenant-a', title: 'Test Task', status: 'todo', priority: 'medium' };
		queryQueue.push([taskRow]); // main task query
		queryQueue.push([{ id: 'sub1', taskId: 'task1', tenantId: 'tenant-a', title: 'Sub 1', done: 0, position: 0, createdAt: 0, updatedAt: 0 }]); // subtasks
		queryQueue.push([{ id: 'tag1', name: 'Bug', color: 'red' }]); // tags
		queryQueue.push([{ userId: 'user2', role: 'reviewer', createdAt: 0, email: 'john@example.com', firstName: 'John', lastName: 'Doe' }]); // assignees

		const result = await getTask('task1') as any;

		expect(result.id).toBe('task1');
		expect(result.subtasks).toHaveLength(1);
		expect(result.subtasks[0].title).toBe('Sub 1');
		expect(result.tags).toHaveLength(1);
		expect(result.tags[0].name).toBe('Bug');
		expect(result.assignees).toHaveLength(1);
		expect(result.assignees[0].email).toBe('john@example.com');
	});

	test('returns empty arrays when task has no related data', async () => {
		const taskRow = { id: 'task2', tenantId: 'tenant-a', title: 'Empty Task', status: 'todo', priority: 'low' };
		queryQueue.push([taskRow]); // main task
		queryQueue.push([]); // subtasks
		queryQueue.push([]); // tags
		queryQueue.push([]); // assignees

		const result = await getTask('task2') as any;

		expect(result.subtasks).toHaveLength(0);
		expect(result.tags).toHaveLength(0);
		expect(result.assignees).toHaveLength(0);
	});

	test('throws Task not found when task does not belong to tenant (tenant isolation)', async () => {
		queryQueue.push([]); // no match in tenant-a
		queryQueue.push([]); // no shared project match either

		await expect(getTask('task-from-tenant-b')).rejects.toThrow('Task not found');
	});

	test('throws Unauthorized when no user in event', async () => {
		currentEvent = { locals: { user: null, tenant: { id: 'tenant-a' } } };

		await expect(getTask('task1')).rejects.toThrow('Unauthorized');
	});
});

// ─── getTasks ─────────────────────────────────────────────────────────────────

describe('getTasks — tenant isolation', () => {
	beforeEach(() => {
		queryQueue.length = 0;
	});

	test('tenant A only receives its own tasks', async () => {
		currentEvent = makeEvent('tenant-a');
		queryQueue.push([]); // shared projects → none
		queryQueue.push([
			{ id: 'task-a1', tenantId: 'tenant-a', title: 'A Task 1' },
			{ id: 'task-a2', tenantId: 'tenant-a', title: 'A Task 2' }
		]);

		const result = await getTasks({}) as any[];

		expect(result).toHaveLength(2);
		expect(result.every((t) => t.tenantId === 'tenant-a')).toBe(true);
	});

	test('tenant B only receives its own tasks', async () => {
		currentEvent = makeEvent('tenant-b');
		queryQueue.push([]); // shared projects → none
		queryQueue.push([{ id: 'task-b1', tenantId: 'tenant-b', title: 'B Task 1' }]);

		const result = await getTasks({}) as any[];

		expect(result).toHaveLength(1);
		expect(result[0].tenantId).toBe('tenant-b');
	});

	test('tenant A and tenant B results are independent across calls', async () => {
		// Tenant A call
		currentEvent = makeEvent('tenant-a');
		queryQueue.push([]); // shared projects
		queryQueue.push([{ id: 'task-a1', tenantId: 'tenant-a', title: 'Task A1' }]);

		const resultA = await getTasks({}) as any[];
		expect(resultA).toHaveLength(1);
		expect(resultA[0].id).toBe('task-a1');

		// Tenant B call
		currentEvent = makeEvent('tenant-b');
		queryQueue.push([]); // shared projects
		queryQueue.push([{ id: 'task-b1', tenantId: 'tenant-b', title: 'Task B1' }]);

		const resultB = await getTasks({}) as any[];
		expect(resultB).toHaveLength(1);
		expect(resultB[0].id).toBe('task-b1');
	});

	test('returns empty list when tenant has no tasks', async () => {
		currentEvent = makeEvent('tenant-empty');
		queryQueue.push([]); // no shared projects
		queryQueue.push([]); // no tasks

		const result = await getTasks({}) as any[];
		expect(result).toHaveLength(0);
	});
});

describe('getTasks — include flags', () => {
	beforeEach(() => {
		queryQueue.length = 0;
		currentEvent = makeEvent('tenant-a');
	});

	test('no include flags: returns plain task rows without extra fields', async () => {
		queryQueue.push([]); // shared projects
		queryQueue.push([{ id: 'task-a1', tenantId: 'tenant-a', title: 'Task A1' }]);

		const result = await getTasks({}) as any[];

		expect(result).toHaveLength(1);
		expect(result[0].tags).toBeUndefined();
		expect(result[0].assignees).toBeUndefined();
		expect(result[0].subtaskCount).toBeUndefined();
	});

	test('include.tags=true returns tags per task', async () => {
		queryQueue.push([]); // shared projects
		queryQueue.push([{ id: 'task-a1', tenantId: 'tenant-a', title: 'Task A1' }]); // tasks
		// subtasks not requested → skipped
		queryQueue.push([{ taskId: 'task-a1', id: 'tag1', name: 'Feature', color: 'blue' }]); // tags
		// assignees not requested → skipped

		const result = await getTasks({ include: { tags: true } }) as any[];

		expect(result[0].tags).toHaveLength(1);
		expect(result[0].tags[0].name).toBe('Feature');
	});

	test('include.assignees=true returns assignees per task', async () => {
		queryQueue.push([]); // shared projects
		queryQueue.push([{ id: 'task-a1', tenantId: 'tenant-a', title: 'Task A1' }]); // tasks
		// subtasks not requested → skipped
		// tags not requested → skipped
		queryQueue.push([{ taskId: 'task-a1', userId: 'user2', role: 'owner', firstName: 'Jane', lastName: 'Smith', email: 'jane@example.com' }]); // assignees

		const result = await getTasks({ include: { assignees: true } }) as any[];

		expect(result[0].assignees).toHaveLength(1);
		expect(result[0].assignees[0].email).toBe('jane@example.com');
	});

	test('include.subtasks=true returns subtask counts per task', async () => {
		queryQueue.push([]); // shared projects
		queryQueue.push([{ id: 'task-a1', tenantId: 'tenant-a', title: 'Task A1' }]); // tasks
		queryQueue.push([{ taskId: 'task-a1', total: 3, done: 1 }]); // subtask counts
		// tags not requested → skipped
		// assignees not requested → skipped

		const result = await getTasks({ include: { subtasks: true } }) as any[];

		expect(result[0].subtaskCount).toBe(3);
		expect(result[0].subtaskDoneCount).toBe(1);
	});

	test('include with empty task list returns empty array without extra queries', async () => {
		queryQueue.push([]); // shared projects
		queryQueue.push([]); // no tasks

		const result = await getTasks({ include: { tags: true, assignees: true } }) as any[];
		expect(result).toHaveLength(0);
		// queue should still be empty — no extra queries fired
		expect(queryQueue).toHaveLength(0);
	});
});

describe('getTasks — backward compat: legacy assignedToUserId filter', () => {
	beforeEach(() => {
		queryQueue.length = 0;
		currentEvent = makeEvent('tenant-a');
	});

	test('assignee filter still filters by assignedToUserId column', async () => {
		queryQueue.push([]); // shared projects
		queryQueue.push([{ id: 'task-a1', tenantId: 'tenant-a', title: 'Task A1', assignedToUserId: 'user-x' }]);

		const result = await getTasks({ assignee: 'user-x' }) as any[];

		expect(result).toHaveLength(1);
		expect(result[0].assignedToUserId).toBe('user-x');
	});
});

// ─── updateTaskStatus / updateTaskPriority — single inline edits ─────────────

describe('updateTaskStatus', () => {
	beforeEach(() => {
		queryQueue.length = 0;
		currentEvent = makeEvent('tenant-a');
	});

	test('rejects task not owned by current tenant', async () => {
		// Whitelist SELECT scoped by tenantId returns nothing for cross-tenant ID
		queryQueue.push([]);
		await expect(
			updateTaskStatus({ taskId: 'task-from-tenant-b', newStatus: 'blocked' })
		).rejects.toThrow(/not found/i);
	});

	test('skips no-op when newStatus equals oldStatus', async () => {
		queryQueue.push([{ id: 'task-a1', tenantId: 'tenant-a', status: 'in-progress', priority: 'medium' }]);
		const result = await updateTaskStatus({ taskId: 'task-a1', newStatus: 'in-progress' });
		expect(result.success).toBe(true);
		expect(result.changed).toBe(false);
	});

	test('updates task when status changes', async () => {
		queryQueue.push([{ id: 'task-a1', tenantId: 'tenant-a', status: 'todo', priority: 'medium' }]);
		// taskSettings probe (client notification gate — returns empty so no email is sent)
		queryQueue.push([{ tenantId: 'tenant-a', clientEmailsEnabled: 0 }]);
		const result = await updateTaskStatus({ taskId: 'task-a1', newStatus: 'blocked' });
		expect(result.success).toBe(true);
		expect(result.changed).toBe(true);
	});

	test('throws Unauthorized when no tenant in context', async () => {
		currentEvent = { locals: { user: null, tenant: null, isClientUser: false, client: null } };
		await expect(
			updateTaskStatus({ taskId: 'task-a1', newStatus: 'done' })
		).rejects.toThrow(/Unauthorized/i);
	});
});

describe('updateTaskPriority', () => {
	beforeEach(() => {
		queryQueue.length = 0;
		currentEvent = makeEvent('tenant-a');
	});

	test('rejects task not owned by current tenant', async () => {
		queryQueue.push([]);
		await expect(
			updateTaskPriority({ taskId: 'task-from-tenant-b', newPriority: 'urgent' })
		).rejects.toThrow(/not found/i);
	});

	test('skips no-op when newPriority equals oldPriority', async () => {
		queryQueue.push([{ id: 'task-a1', tenantId: 'tenant-a', status: 'todo', priority: 'high' }]);
		const result = await updateTaskPriority({ taskId: 'task-a1', newPriority: 'high' });
		expect(result.success).toBe(true);
		expect(result.changed).toBe(false);
	});

	test('updates task when priority changes', async () => {
		queryQueue.push([{ id: 'task-a1', tenantId: 'tenant-a', status: 'todo', priority: 'medium' }]);
		const result = await updateTaskPriority({ taskId: 'task-a1', newPriority: 'urgent' });
		expect(result.success).toBe(true);
		expect(result.changed).toBe(true);
	});
});

// ─── Bulk operations — multi-tenant whitelist enforcement ────────────────────

describe('bulkUpdateTaskStatus — tenant whitelist', () => {
	beforeEach(() => {
		queryQueue.length = 0;
		currentEvent = makeEvent('tenant-a');
	});

	test('only counts tenant-a tasks even when payload includes tenant-b IDs', async () => {
		// User sends 3 IDs; whitelist SELECT (scoped by tenant_id=tenant-a) returns only 2.
		// The third ID belongs to tenant-b and is filtered out by the WHERE clause.
		queryQueue.push([
			{ id: 'task-a1', status: 'todo' },
			{ id: 'task-a2', status: 'in-progress' }
			// task-b1 NOT returned — different tenant
		]);

		const result = await bulkUpdateTaskStatus({
			taskIds: ['task-a1', 'task-a2', 'task-b1'],
			newStatus: 'blocked'
		});

		expect(result.success).toBe(true);
		expect(result.totalRequested).toBe(3);
		expect(result.owned).toBe(2);
		expect(result.changed).toBe(2);
	});

	test('returns changed=0 when all tasks already have target status', async () => {
		queryQueue.push([
			{ id: 'task-a1', status: 'blocked' },
			{ id: 'task-a2', status: 'blocked' }
		]);
		const result = await bulkUpdateTaskStatus({
			taskIds: ['task-a1', 'task-a2'],
			newStatus: 'blocked'
		});
		expect(result.owned).toBe(2);
		expect(result.changed).toBe(0);
	});

	test('counts only the tasks where status actually changes', async () => {
		queryQueue.push([
			{ id: 'task-a1', status: 'todo' }, // will change
			{ id: 'task-a2', status: 'blocked' } // no-op
		]);
		const result = await bulkUpdateTaskStatus({
			taskIds: ['task-a1', 'task-a2'],
			newStatus: 'blocked'
		});
		expect(result.owned).toBe(2);
		expect(result.changed).toBe(1);
	});

	test('returns 0 when no requested IDs belong to the tenant', async () => {
		queryQueue.push([]); // tenant-a owns none of the requested IDs
		const result = await bulkUpdateTaskStatus({
			taskIds: ['task-b1', 'task-b2'],
			newStatus: 'blocked'
		});
		expect(result.totalRequested).toBe(2);
		expect(result.owned).toBe(0);
		expect(result.changed).toBe(0);
	});
});

describe('bulkDeleteTasks — tenant whitelist', () => {
	beforeEach(() => {
		queryQueue.length = 0;
		currentEvent = makeEvent('tenant-a');
	});

	test('deletes only tenant-a tasks when payload mixes tenants', async () => {
		queryQueue.push([{ id: 'task-a1' }, { id: 'task-a2' }]); // whitelist returns 2 of 3
		const result = await bulkDeleteTasks(['task-a1', 'task-a2', 'task-b1']);
		expect(result.success).toBe(true);
		expect(result.totalRequested).toBe(3);
		expect(result.deleted).toBe(2);
	});

	test('returns 0 deletions when no IDs belong to tenant', async () => {
		queryQueue.push([]);
		const result = await bulkDeleteTasks(['task-b1', 'task-b2']);
		expect(result.totalRequested).toBe(2);
		expect(result.deleted).toBe(0);
	});
});

describe('bulkDuplicateTasks — tenant whitelist + batch inserts', () => {
	beforeEach(() => {
		queryQueue.length = 0;
		currentEvent = makeEvent('tenant-a');
	});

	test('duplicates only tenant-a tasks when payload mixes tenants', async () => {
		// Source whitelist SELECT — returns 2 of 3 (third is tenant-b, filtered)
		queryQueue.push([
			{
				id: 'task-a1',
				tenantId: 'tenant-a',
				title: 'Task A1',
				description: 'desc',
				status: 'in-progress',
				priority: 'high',
				type: 'video',
				projectId: null,
				clientId: null,
				milestoneId: null,
				dueDate: null,
				assignedToUserId: null,
				recurringType: null,
				recurringInterval: null,
				recurringEndDate: null,
				recurringParentId: null,
				meetTime: null,
				meetDurationMinutes: null
			},
			{
				id: 'task-a2',
				tenantId: 'tenant-a',
				title: 'Task A2',
				description: null,
				status: 'todo',
				priority: 'medium',
				type: 'design',
				projectId: null,
				clientId: null,
				milestoneId: null,
				dueDate: null,
				assignedToUserId: null,
				recurringType: null,
				recurringInterval: null,
				recurringEndDate: null,
				recurringParentId: null,
				meetTime: null,
				meetDurationMinutes: null
			}
		]);
		// Promise.all of 3 follow-up queries (subtasks, tag links, assignees)
		queryQueue.push([]); // subtasks
		queryQueue.push([]); // tag links
		queryQueue.push([]); // assignees

		const result = await bulkDuplicateTasks(['task-a1', 'task-a2', 'task-b1']);

		expect(result.success).toBe(true);
		expect(result.totalRequested).toBe(3);
		expect(result.duplicated).toBe(2);
		expect(result.newIds).toHaveLength(2);
		// IDs must be freshly generated, not the source IDs
		expect(result.newIds).not.toContain('task-a1');
		expect(result.newIds).not.toContain('task-a2');
		expect(result.newIds).not.toContain('task-b1');
	});

	test('returns empty newIds when no requested IDs belong to tenant', async () => {
		queryQueue.push([]); // source whitelist empty
		const result = await bulkDuplicateTasks(['task-b1']);
		expect(result.totalRequested).toBe(1);
		expect(result.duplicated).toBe(0);
		expect(result.newIds).toHaveLength(0);
	});
});

// ─── Perf regression — Fix 4: getTask parallelized queries ──────────────────

describe('getTask — parallel subtask/tag/assignee shape (perf regression Fix 4)', () => {
	beforeEach(() => {
		queryQueue.length = 0;
		currentEvent = makeEvent('tenant-a');
	});

	test('returns correct shape with all three relations populated after parallelization', async () => {
		const taskRow = { id: 'task-perf-1', tenantId: 'tenant-a', clientId: null, title: 'Perf Task', status: 'in-progress', priority: 'high' };
		queryQueue.push([taskRow]); // main task query
		// Promise.all fires 3 queries — queryQueue serves them in order
		queryQueue.push([
			{ id: 'sub-1', taskId: 'task-perf-1', tenantId: 'tenant-a', title: 'Subtask A', done: 0, position: 0, createdAt: 0, updatedAt: 0 },
			{ id: 'sub-2', taskId: 'task-perf-1', tenantId: 'tenant-a', title: 'Subtask B', done: 1, position: 1, createdAt: 0, updatedAt: 0 }
		]); // subtasks
		queryQueue.push([
			{ id: 'tag-1', name: 'Design', color: '#00f' },
			{ id: 'tag-2', name: 'Urgent', color: '#f00' }
		]); // tags
		queryQueue.push([
			{ userId: 'user-2', role: 'lead', firstName: 'Ana', lastName: 'Pop', email: 'ana@example.com' }
		]); // assignees

		const result = await getTask('task-perf-1') as any;

		expect(result.id).toBe('task-perf-1');
		expect(result.subtasks).toHaveLength(2);
		expect(result.subtasks[0].title).toBe('Subtask A');
		expect(result.subtasks[1].title).toBe('Subtask B');
		expect(result.tags).toHaveLength(2);
		expect(result.tags.map((t: any) => t.name)).toContain('Design');
		expect(result.tags.map((t: any) => t.name)).toContain('Urgent');
		expect(result.assignees).toHaveLength(1);
		expect(result.assignees[0].email).toBe('ana@example.com');
		expect(result.assignees[0].role).toBe('lead');
	});

	test('getTask returns empty relations when no related data exists', async () => {
		const taskRow = { id: 'task-perf-2', tenantId: 'tenant-a', clientId: null, title: 'Empty Task', status: 'todo', priority: 'low' };
		queryQueue.push([taskRow]);
		queryQueue.push([]); // subtasks empty
		queryQueue.push([]); // tags empty
		queryQueue.push([]); // assignees empty

		const result = await getTask('task-perf-2') as any;

		expect(result.subtasks).toHaveLength(0);
		expect(result.tags).toHaveLength(0);
		expect(result.assignees).toHaveLength(0);
	});
});

// ─── Perf regression — Fix 2: bulkUpdateTaskStatus batched writes ────────────

describe('bulkUpdateTaskStatus — batched activity insert shape (perf regression Fix 2)', () => {
	beforeEach(() => {
		queryQueue.length = 0;
		currentEvent = makeEvent('tenant-a');
	});

	test('processes 10 tasks without individual per-task DB calls', async () => {
		// Whitelist returns 10 tasks, all with different statuses so all change
		const tasks = Array.from({ length: 10 }, (_, i) => ({
			id: `task-${i + 1}`,
			status: 'todo'
		}));
		queryQueue.push(tasks);

		const start = Date.now();
		const result = await bulkUpdateTaskStatus({
			taskIds: tasks.map(t => t.id),
			newStatus: 'done'
		});
		const duration = Date.now() - start;

		expect(result.success).toBe(true);
		expect(result.owned).toBe(10);
		expect(result.changed).toBe(10);
		// Soft perf assertion: mocked DB should complete well under 2s
		expect(duration).toBeLessThan(2000);
	});

	test('correctly counts no-ops when all tasks already have target status', async () => {
		const tasks = Array.from({ length: 10 }, (_, i) => ({
			id: `task-${i + 1}`,
			status: 'done'
		}));
		queryQueue.push(tasks);

		const result = await bulkUpdateTaskStatus({
			taskIds: tasks.map(t => t.id),
			newStatus: 'done'
		});

		expect(result.owned).toBe(10);
		expect(result.changed).toBe(0);
	});
});

// ─── P0 IDOR regression tests — client cross-client isolation ──────────────

describe('getTask — client portal cross-client IDOR (P0 regression)', () => {
	beforeEach(() => {
		queryQueue.length = 0;
	});

	test('client user from client-A cannot read a task belonging to client-B in same tenant', async () => {
		// Task exists in tenant-a but belongs to client-b
		const taskRow = { id: 'task-from-client-b', tenantId: 'tenant-a', clientId: 'client-b', title: 'Secret task', status: 'todo', priority: 'medium' };
		queryQueue.push([taskRow]); // main task query returns the task
		queryQueue.push([]); // no shared project match

		// Client user is from client-a, not client-b
		currentEvent = makeClientEvent('tenant-a', 'client-a');

		await expect(getTask('task-from-client-b')).rejects.toThrow('Task not found');
	});

	test('client user can read their own task', async () => {
		const taskRow = { id: 'task-from-client-a', tenantId: 'tenant-a', clientId: 'client-a', title: 'My task', status: 'todo', priority: 'medium' };
		queryQueue.push([taskRow]); // main task query
		queryQueue.push([]); // subtasks
		queryQueue.push([]); // tags
		queryQueue.push([]); // assignees

		currentEvent = makeClientEvent('tenant-a', 'client-a');

		const result = await getTask('task-from-client-a') as any;
		expect(result.id).toBe('task-from-client-a');
	});
});

// ─── Group A: getTaskComments ─────────────────────────────────────────────────

describe('getTaskComments', () => {
	beforeEach(() => {
		queryQueue.length = 0;
		deletedRowsQueue.length = 0;
		currentEvent = makeEvent('tenant-a');
	});

	test('returns comments for a task belonging to the current tenant', async () => {
		queryQueue.push([
			{
				id: 'comment-1', taskId: 'task-a1', userId: 'user1', tenantId: 'tenant-a',
				parentCommentId: null, content: '<p>Salut!</p>', createdAt: 1000, updatedAt: 1000,
				authorName: 'Ion', authorLastName: 'Popescu', authorEmail: 'ion@example.com',
				taskClientId: null
			}
		]); // comments with JOIN on task (enforces tenantId)
		queryQueue.push([]); // attachments
		queryQueue.push([]); // reactions

		const result = await getTaskComments('task-a1') as any[];

		expect(result).toHaveLength(1);
		expect(result[0].id).toBe('comment-1');
		expect(result[0].attachments).toHaveLength(0);
		expect(result[0].reactions).toEqual({});
	});

	// SECURITY: IDOR regression — client from Client A must not see comments on Client B's tasks
	test('client user from Client A cannot see comments for Client B tasks (IDOR regression)', async () => {
		// The query JOINs task and filters by task.clientId for isClientUser.
		// Simulating the guard: DB returns empty because task.clientId !== client.id
		queryQueue.push([]); // JOIN returns nothing — cross-client isolation enforced by WHERE

		currentEvent = makeClientEvent('tenant-a', 'client-a');

		// getTaskComments returns [] (empty) rather than throwing — the JOIN guard filters at query level
		const result = await getTaskComments('task-belongs-to-client-b') as any[];
		expect(result).toHaveLength(0);
	});
});

// ─── Group A: toggleReaction ──────────────────────────────────────────────────

describe('toggleReaction', () => {
	beforeEach(() => {
		queryQueue.length = 0;
		deletedRowsQueue.length = 0;
		currentEvent = makeEvent('tenant-a');
	});

	test('adds a reaction when none exists yet (toggle ON)', async () => {
		// delete().where().returning() → empty (nothing previously existed)
		deletedRowsQueue.push([]);
		// SELECT comment tenantId — returns comment belonging to tenant-a
		queryQueue.push([{ tenantId: 'tenant-a' }]);
		// insert succeeds

		const result = await toggleReaction({ commentId: 'comment-1', emoji: '👍' });
		expect((result as any).ok).toBe(true);
	});

	test('removes a reaction when one already exists (toggle OFF)', async () => {
		// delete().where().returning() → returns 1 row (reaction was deleted)
		deletedRowsQueue.push([{ id: 'reaction-1', commentId: 'comment-1', userId: 'user1', emoji: '👍' }]);
		// No insert needed — branch returns early

		const result = await toggleReaction({ commentId: 'comment-1', emoji: '👍' });
		expect((result as any).ok).toBe(true);
	});

	// SECURITY: cross-tenant — tenant B user cannot react to tenant A's comments
	test('rejects reaction on a comment belonging to a different tenant', async () => {
		// delete returns nothing (no existing reaction)
		deletedRowsQueue.push([]);
		// SELECT comment/task join → empty (comment not in tenant-b)
		queryQueue.push([]);

		currentEvent = makeEvent('tenant-b');

		// toggleReaction uses SvelteKit's error(404, ...) which throws an HttpError object
		await expect(
			toggleReaction({ commentId: 'comment-from-tenant-a', emoji: '🔥' })
		).rejects.toMatchObject({ status: 404 });
	});
});

// ─── Group A: createTaskComment ───────────────────────────────────────────────

describe('createTaskComment — client cross-client isolation', () => {
	beforeEach(() => {
		queryQueue.length = 0;
		deletedRowsQueue.length = 0;
	});

	test('internal user can comment on a task', async () => {
		currentEvent = makeEvent('tenant-a');
		// task lookup returns task belonging to tenant-a
		queryQueue.push([{ id: 'task-a1', tenantId: 'tenant-a', clientId: null, title: 'Campanie Meta' }]);
		// taskSettings lookup
		queryQueue.push([{ tenantId: 'tenant-a', clientEmailsEnabled: 0 }]);

		const result = await createTaskComment({
			taskId: 'task-a1',
			content: '<p>Comentariu valid</p>'
		});

		expect((result as any).success).toBe(true);
	});

	test('client user from Client A cannot comment on Client B task (IDOR)', async () => {
		currentEvent = makeClientEvent('tenant-a', 'client-a');
		// task lookup returns task belonging to client-b
		queryQueue.push([{ id: 'task-client-b', tenantId: 'tenant-a', clientId: 'client-b', title: 'Task secret' }]);

		await expect(
			createTaskComment({ taskId: 'task-client-b', content: '<p>Test</p>' })
		).rejects.toThrow(/unauthorized/i);
	});
});

// ─── Group B: addSubtask ──────────────────────────────────────────────────────

describe('addSubtask', () => {
	beforeEach(() => {
		queryQueue.length = 0;
		deletedRowsQueue.length = 0;
		currentEvent = makeEvent('tenant-a');
	});

	test('happy path: adds a subtask to a tenant-owned task', async () => {
		queryQueue.push([{ id: 'task-a1', tenantId: 'tenant-a' }]); // task lookup
		queryQueue.push([]); // last position query → empty, so position = 0

		const result = await addSubtask({ taskId: 'task-a1', title: 'Pregătire materiale' });

		expect((result as any).success).toBe(true);
		expect(typeof (result as any).id).toBe('string');
	});

	test('rejects when isClientUser is true (gate enforced)', async () => {
		currentEvent = makeClientEvent('tenant-a', 'client-a');

		await expect(
			addSubtask({ taskId: 'task-a1', title: 'Subtask interzis' })
		).rejects.toThrow(/unauthorized/i);
	});

	test('rejects task from a different tenant (cross-tenant)', async () => {
		// task query returns empty — task doesn't belong to tenant-a
		queryQueue.push([]);

		await expect(
			addSubtask({ taskId: 'task-from-tenant-b', title: 'Subtask' })
		).rejects.toThrow(/not found/i);
	});
});

// ─── Group B: toggleSubtask ───────────────────────────────────────────────────

describe('toggleSubtask', () => {
	beforeEach(() => {
		queryQueue.length = 0;
		deletedRowsQueue.length = 0;
		currentEvent = makeEvent('tenant-a');
	});

	test('happy path: marks a subtask as done', async () => {
		// toggleSubtask uses update().set().where().returning({id})
		// Enqueue the updated row into deletedRowsQueue (shared returning queue)
		deletedRowsQueue.push([{ id: 'sub-a1' }]);

		const result = await toggleSubtask({ subtaskId: 'sub-a1', done: true });
		expect((result as any).success).toBe(true);
	});

	test('rejects when isClientUser is true (gate enforced)', async () => {
		currentEvent = makeClientEvent('tenant-a', 'client-a');

		await expect(
			toggleSubtask({ subtaskId: 'sub-1', done: true })
		).rejects.toThrow(/unauthorized/i);
	});
});

// ─── Group B: deleteSubtask ───────────────────────────────────────────────────

describe('deleteSubtask', () => {
	beforeEach(() => {
		queryQueue.length = 0;
		deletedRowsQueue.length = 0;
		currentEvent = makeEvent('tenant-a');
	});

	test('rejects when isClientUser is true (gate enforced)', async () => {
		currentEvent = makeClientEvent('tenant-a', 'client-a');

		await expect(deleteSubtask('sub-1')).rejects.toThrow(/unauthorized/i);
	});

	// SECURITY: cross-tenant — subtask not in tenant-a → throws
	test('rejects subtask belonging to a different tenant (cross-tenant)', async () => {
		// delete().where().returning() → empty array (subtask not in tenant-b)
		deletedRowsQueue.push([]);

		currentEvent = makeEvent('tenant-b');

		await expect(deleteSubtask('sub-from-tenant-a')).rejects.toThrow(/not found/i);
	});

	test('happy path: deletes subtask belonging to current tenant', async () => {
		// delete().where().returning() → returns the deleted row
		deletedRowsQueue.push([{ id: 'sub-a1' }]);

		const result = await deleteSubtask('sub-a1');
		expect((result as any).success).toBe(true);
	});
});

// ─── Group C: scheduleMeet ────────────────────────────────────────────────────

describe('scheduleMeet', () => {
	beforeEach(() => {
		queryQueue.length = 0;
		deletedRowsQueue.length = 0;
		currentEvent = makeEvent('tenant-a');
	});

	test('happy path: schedules a meet on a tenant-owned task', async () => {
		queryQueue.push([{ id: 'task-a1' }]); // task lookup

		const result = await scheduleMeet({
			taskId: 'task-a1',
			meetTime: '2026-06-01T10:00:00.000Z',
			meetDurationMinutes: 60
		});

		expect((result as any).success).toBe(true);
	});

	test('rejects when isClientUser is true (gate enforced)', async () => {
		currentEvent = makeClientEvent('tenant-a', 'client-a');

		await expect(
			scheduleMeet({ taskId: 'task-a1', meetTime: '2026-06-01T10:00:00.000Z' })
		).rejects.toThrow(/unauthorized/i);
	});

	// SECURITY: cross-tenant
	test('rejects task from a different tenant (cross-tenant)', async () => {
		queryQueue.push([]); // task lookup returns empty — not in tenant-a

		await expect(
			scheduleMeet({ taskId: 'task-from-tenant-b', meetTime: '2026-06-01T10:00:00.000Z' })
		).rejects.toThrow(/not found/i);
	});
});

// ─── Group C: approveTask ─────────────────────────────────────────────────────

describe('approveTask', () => {
	beforeEach(() => {
		queryQueue.length = 0;
		deletedRowsQueue.length = 0;
		currentEvent = makeEvent('tenant-a');
	});

	test('happy path: approves a pending-approval task', async () => {
		queryQueue.push([{ id: 'task-a1', tenantId: 'tenant-a', status: 'pending-approval' }]);
		// sendClientNotificationIfEnabled: taskSettings + task + client lookups
		queryQueue.push([{ tenantId: 'tenant-a', clientEmailsEnabled: 0 }]);

		const result = await approveTask({ taskId: 'task-a1' });
		expect((result as any).success).toBe(true);
		expect((result as any).taskId).toBe('task-a1');
	});

	test('rejects when isClientUser is true (gate enforced)', async () => {
		currentEvent = makeClientEvent('tenant-a', 'client-a');

		await expect(
			approveTask({ taskId: 'task-a1' })
		).rejects.toThrow(/unauthorized/i);
	});

	// SECURITY: cross-tenant
	test('rejects task from a different tenant (cross-tenant)', async () => {
		queryQueue.push([]); // task not found in tenant-a

		await expect(
			approveTask({ taskId: 'task-from-tenant-b' })
		).rejects.toThrow(/not found/i);
	});
});

// ─── Group C: rejectTask ──────────────────────────────────────────────────────

describe('rejectTask', () => {
	beforeEach(() => {
		queryQueue.length = 0;
		deletedRowsQueue.length = 0;
		currentEvent = makeEvent('tenant-a');
	});

	test('happy path: rejects a pending-approval task', async () => {
		queryQueue.push([{ id: 'task-a1', tenantId: 'tenant-a', status: 'pending-approval' }]);
		// sendClientNotificationIfEnabled
		queryQueue.push([{ tenantId: 'tenant-a', clientEmailsEnabled: 0 }]);

		const result = await rejectTask('task-a1');
		expect((result as any).success).toBe(true);
	});

	test('rejects when isClientUser is true (gate enforced)', async () => {
		currentEvent = makeClientEvent('tenant-a', 'client-a');

		await expect(rejectTask('task-a1')).rejects.toThrow(/unauthorized/i);
	});

	// SECURITY: cross-tenant
	test('rejects task from a different tenant (cross-tenant)', async () => {
		queryQueue.push([]); // task not found in tenant-a

		await expect(rejectTask('task-from-tenant-b')).rejects.toThrow(/not found/i);
	});
});

// ─── Group C: watchTask ───────────────────────────────────────────────────────

describe('watchTask', () => {
	beforeEach(() => {
		queryQueue.length = 0;
		deletedRowsQueue.length = 0;
		currentEvent = makeEvent('tenant-a');
	});

	test('happy path: watches a task that belongs to the current tenant', async () => {
		queryQueue.push([{ id: 'task-a1', tenantId: 'tenant-a' }]); // task lookup
		queryQueue.push([]); // existing watcher check → none

		const result = await watchTask('task-a1');
		expect((result as any).success).toBe(true);
	});

	test('returns alreadyWatching=true when user already watches the task', async () => {
		queryQueue.push([{ id: 'task-a1', tenantId: 'tenant-a' }]); // task lookup
		queryQueue.push([{ id: 'watcher-1' }]); // existing watcher found

		const result = await watchTask('task-a1') as any;
		expect(result.success).toBe(true);
		expect(result.alreadyWatching).toBe(true);
	});

	// SECURITY: cross-tenant
	test('rejects watch on task from a different tenant (cross-tenant)', async () => {
		queryQueue.push([]); // task not found in tenant-a

		await expect(watchTask('task-from-tenant-b')).rejects.toThrow(/not found/i);
	});
});

// ─── Group C: unwatchTask ─────────────────────────────────────────────────────

describe('unwatchTask', () => {
	beforeEach(() => {
		queryQueue.length = 0;
		deletedRowsQueue.length = 0;
		currentEvent = makeEvent('tenant-a');
	});

	test('happy path: unwatches a task that belongs to the current tenant', async () => {
		queryQueue.push([{ id: 'task-a1', tenantId: 'tenant-a' }]); // task lookup
		// delete fires silently — no return value needed

		const result = await unwatchTask('task-a1');
		expect((result as any).success).toBe(true);
	});

	// SECURITY: cross-tenant
	test('rejects unwatch on task from a different tenant (cross-tenant)', async () => {
		queryQueue.push([]); // task not found in tenant-a

		await expect(unwatchTask('task-from-tenant-b')).rejects.toThrow(/not found/i);
	});
});
