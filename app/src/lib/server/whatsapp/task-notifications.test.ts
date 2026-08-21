import { beforeEach, describe, expect, it, mock } from 'bun:test';

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/dynamic/public', () => ({ env: { PUBLIC_APP_URL: 'https://crm.test' } }));
mock.module('$env/static/private', () => ({}));
mock.module('$lib/server/logger', () => ({
	logError: () => {},
	logWarning: () => {},
	logInfo: () => {}
}));
mock.module('$lib/server/app-url', () => ({ getAppBaseUrl: () => 'https://crm.test' }));

const enqueued: Array<Record<string, unknown>> = [];
mock.module('./outbox', () => ({
	enqueueGroupMessage: async (input: Record<string, unknown>) => {
		enqueued.push(input);
		return { id: 'o1', action: 'insert' };
	}
}));

let phones = new Map<string, string>();
mock.module('./resolve-phone', () => ({
	getUserWhatsappPhonesBatch: async () => phones
}));

// Un singur „task cu grup" configurabil per test.
let linked: {
	groupJid: string;
	watched: boolean;
	actorFirst: string;
	actorLast: string;
} | null = null;
let mentionedName = { firstName: 'Ana', lastName: 'Pop' };

mock.module('$lib/server/db', () => ({
	db: {
		select: () => ({
			from: (t: { __name: string }) => ({
				innerJoin: () => ({
					where: () => ({
						limit: async () =>
							linked ? [{ groupJid: linked.groupJid, watched: linked.watched }] : []
					})
				}),
				where: () => ({
					limit: async () =>
						t.__name === 'user'
							? linked
								? [{ firstName: linked.actorFirst, lastName: linked.actorLast, email: 'a@b.c' }]
								: []
							: []
				})
			})
		})
	}
}));
mock.module('$lib/server/db/schema', () => ({
	task: { __name: 'task', id: 'id', tenantId: 'tenant_id', whatsappGroupId: 'wg' },
	whatsappGroup: { __name: 'whatsapp_group', id: 'id', groupJid: 'jid', watched: 'watched' },
	user: { __name: 'user', id: 'id', firstName: 'f', lastName: 'l', email: 'e' }
}));

const { notifyTaskStatusChangedInGroup, notifyTaskMentionInGroup, notifyTaskLinkedToGroup } = await import('./task-notifications');

const baseEvent = {
	type: 'task.status-changed' as const,
	taskId: 't1',
	taskTitle: 'Raport lunar',
	oldStatus: 'todo',
	newStatus: 'in-progress',
	changedByUserId: 'u1',
	clientId: 'c1',
	tenantId: 'ten',
	tenantSlug: 'ots'
};

beforeEach(() => {
	enqueued.length = 0;
	phones = new Map();
	linked = { groupJid: '123@g.us', watched: true, actorFirst: 'Andrei', actorLast: 'Pop' };
});

describe('schimbarea de status', () => {
	it('pune în coadă un mesaj cu cheie de coalescere pe task + grup', async () => {
		await notifyTaskStatusChangedInGroup(baseEvent);
		expect(enqueued).toHaveLength(1);
		expect(enqueued[0]).toMatchObject({
			tenantId: 'ten',
			groupJid: '123@g.us',
			kind: 'task.status',
			dedupeKey: 'task.status:t1:123@g.us',
			taskId: 't1'
		});
		expect(String(enqueued[0].body)).toContain('Andrei Pop a trecut task-ul în *În lucru*');
		expect(String(enqueued[0].body)).toContain('https://crm.test/client/ots/tasks/t1');
	});

	it('task fără grup: nimic', async () => {
		linked = null;
		await notifyTaskStatusChangedInGroup(baseEvent);
		expect(enqueued).toHaveLength(0);
	});

	it('grup debifat între timp: nimic (aceeași gardă ca la trimiterea manuală)', async () => {
		linked = { ...linked!, watched: false };
		await notifyTaskStatusChangedInGroup(baseEvent);
		expect(enqueued).toHaveLength(0);
	});

	it('pending-approval nu se anunță', async () => {
		await notifyTaskStatusChangedInGroup({ ...baseEvent, newStatus: 'pending-approval' });
		expect(enqueued).toHaveLength(0);
	});
});

describe('mențiunea', () => {
	const payload = {
		tenantId: 'ten',
		tenantSlug: 'ots',
		taskId: 't1',
		taskTitle: 'Raport lunar',
		authorUserId: 'u1',
		authorName: 'Andrei Pop',
		mentionedUserId: 'u2',
		mentionedName: 'Ana Pop',
		commentHtml: '<p>Ana, vezi te rog</p>'
	};

	it('cu număr: mențiune reală, fără cheie de coalescere', async () => {
		phones = new Map([['u2', '+40722123456']]);
		await notifyTaskMentionInGroup(payload);
		expect(enqueued).toHaveLength(1);
		expect(enqueued[0]).toMatchObject({
			kind: 'task.mention',
			mentions: ['40722123456@s.whatsapp.net']
		});
		expect(enqueued[0].dedupeKey ?? null).toBeNull();
		expect(String(enqueued[0].body)).toContain('pentru @Ana Pop:');
	});

	it('fără număr: numele simplu', async () => {
		await notifyTaskMentionInGroup(payload);
		expect(enqueued[0].mentions ?? []).toEqual([]);
		expect(String(enqueued[0].body)).toContain('pentru Ana Pop:');
	});

	it('autorul care se menționează singur nu produce mesaj', async () => {
		await notifyTaskMentionInGroup({ ...payload, mentionedUserId: 'u1' });
		expect(enqueued).toHaveLength(0);
	});
});

describe('legarea task-ului de grup', () => {
	it('pune în coadă prezentarea task-ului, fără coalescere', async () => {
		await notifyTaskLinkedToGroup({
			tenantId: 'ten',
			tenantSlug: 'ots',
			taskId: 't1',
			taskTitle: 'Raport lunar',
			status: 'todo',
			assigneeName: null,
			dueDate: null,
			actorUserId: 'u1',
			groupJid: '123@g.us'
		});
		expect(enqueued).toHaveLength(1);
		expect(enqueued[0]).toMatchObject({ kind: 'task.linked', groupJid: '123@g.us', taskId: 't1' });
		expect(enqueued[0].dedupeKey ?? null).toBeNull();
		expect(String(enqueued[0].body)).toContain('Task nou în grup, adăugat de Andrei Pop');
		expect(String(enqueued[0].body)).toContain('https://crm.test/client/ots/tasks/t1');
	});
});
