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
const insertedValues: unknown[] = [];
let deleteCount = 0;

function makeChain(rows: unknown[]): any {
	const p = Promise.resolve(rows);
	return Object.assign(p, {
		from: () => makeChain(rows),
		innerJoin: () => makeChain(rows),
		leftJoin: () => makeChain(rows),
		where: () => makeChain(rows),
		orderBy: () => makeChain(rows),
		limit: () => makeChain(rows),
		returning: () => makeChain(rows)
	});
}

mock.module('$lib/server/db', () => ({
	db: {
		select: () => makeChain(queryQueue.shift() ?? []),
		insert: () => ({
			values: (v: unknown) => {
				insertedValues.push(v);
				return makeChain([]);
			}
		}),
		delete: () => ({
			where: () => {
				deleteCount++;
				return Promise.resolve();
			}
		})
	}
}));

// ─── Schema ───────────────────────────────────────────────────────────────────
// Folosim schema REALĂ, fără mock.module: registry-ul global de mock-uri Bun e
// partajat între fișierele de test din același proces, iar un mock parțial de
// aici ar suprascrie schema pentru fișierele vecine (vezi comentariul CRITICAL
// din tasks.remote.test.ts). Fake-ul de DB de mai sus ignoră oricum argumentele
// din where/orderBy, deci coloanele reale drizzle funcționează nemodificate.
await import('$lib/server/db/schema');

// ─── Gmail client mock ────────────────────────────────────────────────────────

const gmailSearchCalls: unknown[][] = [];
const gmailGetCalls: unknown[][] = [];

mock.module('$lib/server/gmail/client', () => ({
	searchEmails: async (...args: unknown[]) => {
		gmailSearchCalls.push(args);
		return [{ id: 'm1', threadId: 't1' }];
	},
	getEmail: async (_tenantId: string, messageId: string) => {
		gmailGetCalls.push([_tenantId, messageId]);
		return {
			id: messageId,
			threadId: 't1',
			from: 'Client X <client@x.ro>',
			subject: 'Cerere modificări site',
			date: new Date('2026-07-29T10:00:00Z'),
			body: 'Bună ziua,\n\nVă rog să modificați secțiunea de prețuri de pe site.\n\nMulțumesc!',
			attachments: [{ id: 'att1', filename: 'brief.pdf', mimeType: 'application/pdf', size: 1234 }]
		};
	},
	getAttachment: async () => Buffer.from('x')
}));

// ─── requireStaff mock ────────────────────────────────────────────────────────
// Mirror-ul lui assertStaff: aruncă pentru client-portal users și anonimi.

mock.module('$lib/server/get-actor', () => ({
	requireStaff: async (ev: any) => {
		if (!ev?.locals?.user || ev?.locals?.isClientUser) throw new Error('Forbidden');
		return { kind: 'staff' };
	}
}));

// ─── Import subject under test (after mocks) ─────────────────────────────────

const {
	getTaskEmails,
	searchTaskEmails,
	linkTaskEmail,
	unlinkTaskEmail,
	getTaskEmailBody
} = await import('../task-emails.remote');

// ─── Event fixtures ───────────────────────────────────────────────────────────

const staffEvent = (role: string) => ({
	locals: {
		user: { id: 'u1' },
		tenant: { id: 'T1' },
		tenantUser: { role },
		isClientUser: false
	}
});

const clientEvent = (clientId: string) => ({
	locals: {
		user: { id: 'cu1' },
		tenant: { id: 'T1' },
		isClientUser: true,
		client: { id: clientId }
	}
});

const emailRow = {
	id: 'te1',
	tenantId: 'T1',
	taskId: 'task1',
	gmailMessageId: 'm1',
	gmailThreadId: 't1',
	subject: 'Cerere modificări site',
	fromEmail: 'Client X <client@x.ro>',
	snippet: 'Bună ziua, Vă rog să modificați...',
	emailDate: new Date('2026-07-29T10:00:00Z'),
	linkedByUserId: 'u1',
	createdAt: new Date('2026-07-30T08:00:00Z')
};

beforeEach(() => {
	currentEvent = null;
	queryQueue.length = 0;
	insertedValues.length = 0;
	gmailSearchCalls.length = 0;
	gmailGetCalls.length = 0;
	deleteCount = 0;
});

// ─── searchTaskEmails (Gmail live → owner/admin) ─────────────────────────────

describe('searchTaskEmails', () => {
	test('rol member este respins fără să atingă Gmail', async () => {
		currentEvent = staffEvent('member');
		await expect(searchTaskEmails({ search: 'from:client@x.ro' })).rejects.toThrow(
			/administratorii/i
		);
		expect(gmailSearchCalls.length).toBe(0);
	});

	test('rol admin primește rezultate mapate din Gmail', async () => {
		currentEvent = staffEvent('admin');
		const results = await searchTaskEmails({ search: 'from:client@x.ro' });
		expect(gmailSearchCalls.length).toBe(1);
		expect(gmailSearchCalls[0]![0]).toBe('T1');
		expect(gmailSearchCalls[0]![1]).toBe('from:client@x.ro');
		expect(results.length).toBe(1);
		expect(results[0]!.gmailMessageId).toBe('m1');
		expect(results[0]!.subject).toBe('Cerere modificări site');
		expect(results[0]!.from).toBe('Client X <client@x.ro>');
		expect(results[0]!.snippet.length).toBeLessThanOrEqual(200);
		expect(results[0]!.snippet).not.toContain('\n');
	});

	test('rol owner are acces', async () => {
		currentEvent = staffEvent('owner');
		const results = await searchTaskEmails({ search: 'facturi' });
		expect(results.length).toBe(1);
	});

	test('client-portal user este respins', async () => {
		currentEvent = clientEvent('C1');
		await expect(searchTaskEmails({ search: 'orice' })).rejects.toThrow();
		expect(gmailSearchCalls.length).toBe(0);
	});
});

// ─── linkTaskEmail ────────────────────────────────────────────────────────────

describe('linkTaskEmail', () => {
	test('rol member este respins fără insert', async () => {
		currentEvent = staffEvent('member');
		await expect(linkTaskEmail({ taskId: 'task1', gmailMessageId: 'm1' })).rejects.toThrow(
			/administratorii/i
		);
		expect(insertedValues.length).toBe(0);
	});

	test('admin asociază: insert cu tenant + metadate din Gmail', async () => {
		currentEvent = staffEvent('admin');
		queryQueue.push([{ id: 'task1' }]); // task lookup în tenant
		await linkTaskEmail({ taskId: 'task1', gmailMessageId: 'm1' });
		expect(insertedValues.length).toBe(1);
		const inserted = insertedValues[0] as Record<string, unknown>;
		expect(inserted.tenantId).toBe('T1');
		expect(inserted.taskId).toBe('task1');
		expect(inserted.gmailMessageId).toBe('m1');
		expect(inserted.subject).toBe('Cerere modificări site');
		expect(inserted.fromEmail).toBe('Client X <client@x.ro>');
		expect(inserted.linkedByUserId).toBe('u1');
		expect((inserted.snippet as string).length).toBeLessThanOrEqual(200);
	});

	test('task inexistent în tenant → eroare, fără insert', async () => {
		currentEvent = staffEvent('admin');
		queryQueue.push([]); // task lookup gol
		await expect(linkTaskEmail({ taskId: 'ghost', gmailMessageId: 'm1' })).rejects.toThrow(
			/task not found/i
		);
		expect(insertedValues.length).toBe(0);
	});
});

// ─── getTaskEmails ────────────────────────────────────────────────────────────

describe('getTaskEmails', () => {
	test('staff (member) vede metadatele complete din DB', async () => {
		currentEvent = staffEvent('member');
		queryQueue.push([{ id: 'task1', clientId: 'C1' }]); // task lookup
		queryQueue.push([emailRow]); // emails
		const rows = (await getTaskEmails('task1')) as Array<Record<string, unknown>>;
		expect(rows.length).toBe(1);
		expect(rows[0]!.subject).toBe('Cerere modificări site');
		expect(rows[0]!.fromEmail).toBe('Client X <client@x.ro>');
		expect(rows[0]!.snippet).toBeDefined();
	});

	test('client user pe task-ul clientului lui → DOAR {id, subject, emailDate}', async () => {
		currentEvent = clientEvent('C1');
		queryQueue.push([{ id: 'task1', clientId: 'C1' }]);
		queryQueue.push([emailRow]);
		const rows = (await getTaskEmails('task1')) as Array<Record<string, unknown>>;
		expect(rows.length).toBe(1);
		expect(rows[0]!.subject).toBe('Cerere modificări site');
		expect(rows[0]!.emailDate).toBeDefined();
		// nimic din inbox nu se scurge în portal
		expect(rows[0]!.snippet).toBeUndefined();
		expect(rows[0]!.fromEmail).toBeUndefined();
		expect(rows[0]!.gmailMessageId).toBeUndefined();
		expect(rows[0]!.gmailThreadId).toBeUndefined();
	});

	test('client user pe task-ul ALTUI client → Task not found', async () => {
		currentEvent = clientEvent('C2');
		queryQueue.push([{ id: 'task1', clientId: 'C1' }]);
		await expect(getTaskEmails('task1')).rejects.toThrow(/task not found/i);
	});

	test('task din alt tenant → Task not found', async () => {
		currentEvent = staffEvent('admin');
		queryQueue.push([]); // task lookup gol (scoped pe tenant)
		await expect(getTaskEmails('task-alt-tenant')).rejects.toThrow(/task not found/i);
	});
});

// ─── getTaskEmailBody (Gmail live → owner/admin) ─────────────────────────────

describe('getTaskEmailBody', () => {
	test('rol member este respins', async () => {
		currentEvent = staffEvent('member');
		await expect(getTaskEmailBody({ taskEmailId: 'te1' })).rejects.toThrow(/administratorii/i);
		expect(gmailGetCalls.length).toBe(0);
	});

	test('admin primește corpul + atașamentele', async () => {
		currentEvent = staffEvent('admin');
		queryQueue.push([emailRow]);
		const body = await getTaskEmailBody({ taskEmailId: 'te1' });
		expect(body.subject).toBe('Cerere modificări site');
		expect(body.body).toContain('secțiunea de prețuri');
		expect(body.attachments.length).toBe(1);
		expect(body.attachments[0]!.filename).toBe('brief.pdf');
	});

	test('email inexistent în tenant → eroare', async () => {
		currentEvent = staffEvent('owner');
		queryQueue.push([]);
		await expect(getTaskEmailBody({ taskEmailId: 'ghost' })).rejects.toThrow(/negăsit/i);
	});
});

// ─── unlinkTaskEmail ──────────────────────────────────────────────────────────

describe('unlinkTaskEmail', () => {
	test('rol member este respins fără delete', async () => {
		currentEvent = staffEvent('member');
		await expect(unlinkTaskEmail({ taskEmailId: 'te1' })).rejects.toThrow(/administratorii/i);
		expect(deleteCount).toBe(0);
	});

	test('admin dezasociază (delete scoped pe tenant)', async () => {
		currentEvent = staffEvent('admin');
		await unlinkTaskEmail({ taskEmailId: 'te1' });
		expect(deleteCount).toBe(1);
	});
});
