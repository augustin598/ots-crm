import { beforeEach, describe, expect, it, mock } from 'bun:test';

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$lib/server/logger', () => ({
	logError: () => {},
	logWarning: () => {},
	logInfo: () => {}
}));

let group: { id: string; clientId: string | null; watched: boolean } | null = null;
mock.module('./group-store', () => ({
	getStoredGroup: async () => group
}));

let sender: { userId: string; name: string; isStaff: boolean; clientIds: string[] } | null = null;
mock.module('./resolve-phone', () => ({
	resolveUserByWhatsappPhone: async () => sender
}));

const enqueued: Array<Record<string, unknown>> = [];
mock.module('./outbox', () => ({
	enqueueGroupMessage: async (input: Record<string, unknown>) => {
		enqueued.push(input);
		return { id: 'o1', action: 'insert' };
	}
}));

const inserted: Array<{ table: string; values: Record<string, unknown> }> = [];
let insertThrows: Error | null = null;
mock.module('$lib/server/db', () => ({
	db: {
		insert: (t: { __name: string }) => ({
			values: async (values: Record<string, unknown>) => {
				if (insertThrows && t.__name === 'task') throw insertThrows;
				inserted.push({ table: t.__name, values });
			}
		})
	}
}));
mock.module('$lib/server/db/schema', () => ({
	task: { __name: 'task' },
	taskActivity: { __name: 'task_activity' }
}));

// Limitatorul e cel real: vrem să vedem că oprește al șaselea mesaj.
const { handleTaskCommand } = await import('./task-command');

const base = {
	tenantId: 'ten',
	groupJid: '123@g.us',
	senderPhoneE164: '+40722123456',
	wamId: 'W1',
	body: '/task Refacem bannerele'
};

beforeEach(() => {
	enqueued.length = 0;
	inserted.length = 0;
	insertThrows = null;
	group = { id: 'g1', clientId: 'c1', watched: true };
	sender = { userId: 'u1', name: 'Claudia Darie', isStaff: false, clientIds: ['c1'] };
});

describe('gărzile comenzii /task', () => {
	it('un mesaj obișnuit nu e comandă', async () => {
		const out = await handleTaskCommand({ ...base, body: 'bună ziua' });
		expect(out).toEqual({ handled: false, reason: 'not-a-command' });
		expect(inserted).toHaveLength(0);
	});

	it('expeditor fără număr rezolvat: refuzat', async () => {
		const out = await handleTaskCommand({ ...base, senderPhoneE164: null, wamId: 'W-nophone' });
		expect(out).toEqual({ handled: false, reason: 'no-sender' });
	});

	it('grup fără client legat: refuzat, ca taskul să nu rămână orfan', async () => {
		group = { id: 'g1', clientId: null, watched: true };
		const out = await handleTaskCommand({ ...base, wamId: 'W-noclient' });
		expect(out).toEqual({ handled: false, reason: 'no-client' });
	});

	it('număr necunoscut: refuzat în tăcere, fără mesaj în grup', async () => {
		sender = null;
		const out = await handleTaskCommand({ ...base, wamId: 'W-unknown' });
		expect(out).toEqual({ handled: false, reason: 'unknown-sender' });
		expect(enqueued).toHaveLength(0);
	});

	it('om al altui client, deși e în grup: refuzat', async () => {
		sender = { userId: 'u9', name: 'X', isStaff: false, clientIds: ['alt-client'] };
		const out = await handleTaskCommand({ ...base, wamId: 'W-other' });
		expect(out).toEqual({ handled: false, reason: 'not-allowed' });
	});

	it('cineva din echipă poate scrie în orice grup legat', async () => {
		sender = { userId: 'u2', name: 'Augustin', isStaff: true, clientIds: [] };
		const out = await handleTaskCommand({ ...base, wamId: 'W-staff' });
		expect(out).toMatchObject({ handled: true });
	});

	it('taskul se creează în pending-approval, legat de grup și de client', async () => {
		const out = await handleTaskCommand({ ...base, wamId: 'W-ok' });
		expect(out).toMatchObject({ handled: true });
		const task = inserted.find((i) => i.table === 'task')!;
		expect(task.values).toMatchObject({
			tenantId: 'ten',
			clientId: 'c1',
			title: 'Refacem bannerele',
			status: 'pending-approval',
			createdByUserId: 'u1',
			whatsappGroupId: 'g1',
			sourceWamId: 'W-ok'
		});
		expect(inserted.some((i) => i.table === 'task_activity')).toBe(true);
		expect(enqueued[0]).toMatchObject({ kind: 'task.command-ack', taskId: out.handled ? out.taskId : '' });
		expect(String(enqueued[0].body)).toContain('Am notat de la Claudia Darie');
	});

	it('același mesaj livrat de două ori nu creează al doilea task', async () => {
		insertThrows = new Error('UNIQUE constraint failed: task.tenant_id, task.source_wam_id');
		const out = await handleTaskCommand({ ...base, wamId: 'W-dup' });
		expect(out).toEqual({ handled: false, reason: 'duplicate' });
		expect(enqueued).toHaveLength(0);
	});

	it('al șaselea task într-o oră de la același număr e oprit', async () => {
		const phone = '+40799000111';
		for (let i = 0; i < 5; i++) {
			const out = await handleTaskCommand({ ...base, senderPhoneE164: phone, wamId: `W-rl-${i}` });
			expect(out).toMatchObject({ handled: true });
		}
		const blocked = await handleTaskCommand({ ...base, senderPhoneE164: phone, wamId: 'W-rl-5' });
		expect(blocked).toEqual({ handled: false, reason: 'rate-limited' });
	});
});
