import { describe, test, expect, mock, beforeEach } from 'bun:test';

// Must mock SvelteKit virtual modules BEFORE any module loads
mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));

const sendCalls: Array<{ tenantId: string; userId: string; text: string; parseMode?: string }> = [];

mock.module('../sender', () => ({
	sendTelegramMessage: async (args: { tenantId: string; userId: string; text: string; parseMode?: string }) => {
		sendCalls.push(args);
		return { ok: true };
	},
}));

mock.module('$lib/server/logger', () => ({
	logError: () => {},
	logWarning: () => {},
	logInfo: () => {},
	serializeError: (e: unknown) => ({ message: String(e), stack: '' }),
}));

// Fake DB — configured per-test via dbNextResult
let dbNextResult: unknown[] = [];

// .where() is both awaitable and has .limit() so both query shapes work
function makeWhereResult() {
	const p = Promise.resolve(dbNextResult);
	return Object.assign(p, {
		limit: async (_n: number) => dbNextResult,
	});
}

const fakeDb = {
	select: () => ({
		from: () => ({
			where: () => makeWhereResult(),
		}),
	}),
};

mock.module('$lib/server/db', () => ({ db: fakeDb }));
mock.module('$lib/server/db/schema', () => ({
	task: { id: 'id', priority: 'priority', dueDate: 'dueDate' },
	taskWatcher: { taskId: 'task_id', tenantId: 'tenant_id', userId: 'user_id' },
	tenantUser: { tenantId: 'tenant_id', userId: 'user_id', role: 'role' },
}));

const {
	notifyTaskCreated,
	notifyTaskAssigned,
	notifyTaskCompleted,
	notifyTaskDueSoon,
	notifyTaskMention,
	notifyTaskOverdue,
} = await import('../task-notifications');

async function flush() {
	await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
	sendCalls.length = 0;
	dbNextResult = [];
});

describe('notifyTaskCreated', () => {
	const base = {
		type: 'task.created' as const,
		taskId: 'task1',
		taskTitle: 'New task',
		createdByUserId: 'client-user1',
		assignedToUserId: null,
		priority: 'medium',
		dueDate: null,
		clientId: 'client1',
		tenantId: 'tenant1',
		tenantSlug: 'ots',
	};

	test('notifies all admins when no assignee', async () => {
		dbNextResult = [{ userId: 'admin1' }, { userId: 'admin2' }];
		await notifyTaskCreated(base);
		await flush();
		expect(sendCalls).toHaveLength(2);
		const userIds = sendCalls.map((c) => c.userId);
		expect(userIds).toContain('admin1');
		expect(userIds).toContain('admin2');
		expect(sendCalls[0]!.text).toContain('New task');
	});

	test('skips notification when task is assigned', async () => {
		dbNextResult = [{ userId: 'admin1' }];
		await notifyTaskCreated({ ...base, assignedToUserId: 'user2' });
		await flush();
		expect(sendCalls).toHaveLength(0);
	});

	test('skips when no admins found', async () => {
		dbNextResult = [];
		await notifyTaskCreated(base);
		await flush();
		expect(sendCalls).toHaveLength(0);
	});
});

describe('notifyTaskAssigned', () => {
	const base = {
		type: 'task.assigned' as const,
		taskId: 'task1',
		taskTitle: 'Fix bug',
		assignedToUserId: 'user2',
		assignedByUserId: 'user1',
		tenantId: 'tenant1',
		tenantSlug: 'ots',
	};

	test('sends to assignee with correct payload', async () => {
		await notifyTaskAssigned(base);
		await flush();
		expect(sendCalls).toHaveLength(1);
		expect(sendCalls[0]!.tenantId).toBe('tenant1');
		expect(sendCalls[0]!.userId).toBe('user2');
		expect(sendCalls[0]!.text).toContain('Fix bug');
		expect(sendCalls[0]!.text).toContain('task1');
		expect(sendCalls[0]!.parseMode).toBe('Markdown');
	});

	test('sends notification on self-assignment (guard removed)', async () => {
		await notifyTaskAssigned({ ...base, assignedToUserId: 'user1', assignedByUserId: 'user1' });
		await flush();
		expect(sendCalls).toHaveLength(1);
		expect(sendCalls[0]!.userId).toBe('user1');
	});

	test('skips when assignedToUserId is empty', async () => {
		await notifyTaskAssigned({ ...base, assignedToUserId: '' });
		await flush();
		expect(sendCalls).toHaveLength(0);
	});
});

describe('notifyTaskCompleted', () => {
	const base = {
		type: 'task.completed' as const,
		taskId: 'task1',
		taskTitle: 'Ship feature',
		completedByUserId: 'user1',
		tenantId: 'tenant1',
		tenantSlug: 'ots',
	};

	test('notifies watchers excluding the completer', async () => {
		dbNextResult = [{ userId: 'user2' }, { userId: 'user3' }];
		await notifyTaskCompleted(base);
		await flush();
		expect(sendCalls).toHaveLength(2);
		const userIds = sendCalls.map((c) => c.userId);
		expect(userIds).toContain('user2');
		expect(userIds).toContain('user3');
	});

	test('sends no messages when there are no watchers', async () => {
		dbNextResult = [];
		await notifyTaskCompleted(base);
		await flush();
		expect(sendCalls).toHaveLength(0);
	});
});

describe('notifyTaskDueSoon', () => {
	test('sends to assignee', async () => {
		await notifyTaskDueSoon({
			tenantId: 'tenant1',
			tenantSlug: 'ots',
			taskId: 'task1',
			taskTitle: 'Report',
			assignedToUserId: 'user1',
			dueDate: new Date('2026-05-06'),
			priority: 'high',
		});
		await flush();
		expect(sendCalls).toHaveLength(1);
		expect(sendCalls[0]!.userId).toBe('user1');
		expect(sendCalls[0]!.text).toContain('Report');
	});

	test('skips when no assignee', async () => {
		await notifyTaskDueSoon({
			tenantId: 'tenant1',
			tenantSlug: 'ots',
			taskId: 'task1',
			taskTitle: 'Report',
			assignedToUserId: null,
			dueDate: new Date('2026-05-06'),
		});
		await flush();
		expect(sendCalls).toHaveLength(0);
	});
});

describe('notifyTaskMention', () => {
	const base = {
		tenantId: 'tenant1',
		tenantSlug: 'ots',
		taskId: 'task1',
		taskTitle: 'Review PR',
		mentionedUserId: 'user2',
		authorUserId: 'user1',
		authorName: 'Alice',
		commentSnippet: 'Hey check this',
	};

	test('notifies mentioned user', async () => {
		await notifyTaskMention(base);
		await flush();
		expect(sendCalls).toHaveLength(1);
		expect(sendCalls[0]!.userId).toBe('user2');
	});

	test('skips when author === mentioned', async () => {
		await notifyTaskMention({ ...base, authorUserId: 'user2', mentionedUserId: 'user2' });
		await flush();
		expect(sendCalls).toHaveLength(0);
	});
});

describe('notifyTaskOverdue', () => {
	test('notifies admin user with count and sample titles', async () => {
		await notifyTaskOverdue({
			tenantId: 'tenant1',
			tenantSlug: 'ots',
			adminUserId: 'admin1',
			count: 5,
			sampleTitles: ['Task A', 'Task B', 'Task C'],
		});
		await flush();
		expect(sendCalls).toHaveLength(1);
		expect(sendCalls[0]!.userId).toBe('admin1');
		expect(sendCalls[0]!.text).toContain('5 task-uri overdue');
		expect(sendCalls[0]!.text).toContain('Task A');
	});
});
