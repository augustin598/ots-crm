import { describe, test, expect, mock, beforeEach } from 'bun:test';

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));

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
		where: () => makeChain(rows),
		orderBy: () => makeChain(rows),
		limit: () => makeChain(rows),
		offset: () => makeChain(rows),
		groupBy: () => makeChain(rows),
		returning: () => makeChain(rows),
		set: () => makeChain(rows)
	});
}

mock.module('$lib/server/db', () => ({
	db: {
		select: () => makeChain(queryQueue.length > 0 ? (queryQueue.shift() as unknown[]) : []),
		selectDistinct: () =>
			makeChain(queryQueue.length > 0 ? (queryQueue.shift() as unknown[]) : []),
		insert: () => ({ values: () => Promise.resolve() }),
		update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
		delete: () => ({ where: () => Promise.resolve() }),
		transaction: (fn: Function) =>
			fn({
				insert: () => ({ values: () => Promise.resolve() }),
				update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
				delete: () => ({ where: () => Promise.resolve() })
			})
	}
}));

// ─── Schema mock ──────────────────────────────────────────────────────────────

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
	tenantUser: { tenantId: col('tenantId'), userId: col('userId'), role: col('role') }
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
	logInfo: () => {}
}));

mock.module('$lib/server/recurring-tasks', () => ({
	spawnNextRecurringTask: async () => {}
}));

const {
	getTask,
	getTasks,
	updateTaskStatus,
	updateTaskPriority,
	bulkUpdateTaskStatus,
	bulkDeleteTasks,
	bulkDuplicateTasks
} = await import('../tasks.remote');

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
