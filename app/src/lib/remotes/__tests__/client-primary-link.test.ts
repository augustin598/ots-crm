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

// Eagerly load the REAL schema module BEFORE any mock — same rationale as
// tasks.remote.test.ts:40-51 (Bun's module registry is global per process; the
// real import guarantees every table keeps its full column shape for neighbor
// test files sharing this process). This file does NOT mock the schema at all:
// the real drizzle tables double as identity markers for the recorded ops.
await import('$lib/server/db/schema');
import * as table from '$lib/server/db/schema';

// ─── Side-effect mocks ────────────────────────────────────────────────────────

mock.module('$lib/server/get-actor', () => ({
	getActor: async () => currentEvent?.locals?.actor,
	requireStaff: async () => {
		if (currentEvent?.locals?.actor?.kind !== 'tenant') throw new Error('Unauthorized');
		return currentEvent.locals.actor;
	}
}));

mock.module('$lib/server/access', () => ({
	assertCan: async () => {},
	validateOverride: (caps: unknown) => caps
}));

mock.module('$lib/server/whatsapp/resolve-phone', () => ({
	getUserWhatsappPhonesBatch: async () => new Map<string, string>()
}));

// ─── Fake DB: select-urile consumă queryQueue, mutațiile se înregistrează ─────

const queryQueue: Array<unknown[]> = [];
type Op = { op: 'insert' | 'update' | 'delete'; table: unknown; values?: any; set?: any };
const ops: Op[] = [];

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
		groupBy: () => makeChain(rows)
	});
}

function makeDb(): any {
	return {
		select: () => makeChain(queryQueue.length > 0 ? (queryQueue.shift() as unknown[]) : []),
		insert: (t: unknown) => ({
			values: (v: any) => {
				ops.push({ op: 'insert', table: t, values: v });
				return Promise.resolve();
			}
		}),
		update: (t: unknown) => ({
			set: (s: any) => ({
				where: () => {
					ops.push({ op: 'update', table: t, set: s });
					return Promise.resolve();
				}
			})
		}),
		delete: (t: unknown) => ({
			where: () => {
				ops.push({ op: 'delete', table: t });
				return Promise.resolve();
			}
		}),
		transaction: (fn: Function) => fn(makeDb())
	};
}

mock.module('$lib/server/db', () => ({ db: makeDb() }));

const { getAssignableClientUsers } = await import('../users.remote');
const { updateClient, updateClientCompanyData } = await import('../clients.remote');
const { getEligibleClientAssigneeIds, getTaskParticipantEmails } = await import(
	'$lib/server/client-users'
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TENANT = 'tenant-ots';
const CLIENT = 'client-lucky';

function staffEvent() {
	return {
		locals: {
			user: { id: 'staff-1', email: 'office@onetopsolution.ro' },
			tenant: { id: TENANT, slug: 'ots' },
			isClientUser: false,
			client: null,
			actor: { kind: 'tenant', userId: 'staff-1', tenantId: TENANT, role: 'owner' }
		}
	};
}

function clientEvent(clientId: string) {
	return {
		locals: {
			user: { id: 'cu-user', email: 'client@heylux.ro' },
			tenant: { id: TENANT, slug: 'ots' },
			isClientUser: true,
			client: { id: clientId, tenantId: TENANT },
			clientUser: { id: 'cu-link-1', isPrimary: true },
			actor: { kind: 'client', userId: 'cu-user', tenantId: TENANT, clientId }
		}
	};
}

const georgeRow = {
	userId: 'u-george',
	email: 'georgedragoiu.heylux@gmail.com',
	firstName: 'Dragoiu',
	lastName: 'George Ciprian',
	isPrimary: false // flag pierdut în DB — exact cazul Lucky Group
};

const secergiuRow = {
	userId: 'u-sergiu',
	email: 'birzu.sergiu@gmail.com',
	firstName: 'Birzu',
	lastName: 'Sergiu',
	isPrimary: false
};

const sergiuCse = {
	email: 'birzu.sergiu@gmail.com',
	label: 'Birzu Sergiu',
	accessFlags: JSON.stringify({ tasks: true }),
	notifyTasks: 1
};

function cuOps() {
	return ops.filter((o) => o.table === table.clientUser);
}

function cuInserts() {
	return cuOps().filter((o) => o.op === 'insert');
}

function cuPromotes() {
	return cuOps().filter((o) => o.op === 'update' && o.set?.isPrimary === true);
}

function cuDemotes() {
	return cuOps().filter((o) => o.op === 'update' && o.set?.isPrimary === false);
}

function cuRelinks() {
	return cuOps().filter((o) => o.op === 'update' && typeof o.set?.userId === 'string');
}

beforeEach(() => {
	queryQueue.length = 0;
	ops.length = 0;
	currentEvent = staffEvent();
});

// ─── getAssignableClientUsers ─────────────────────────────────────────────────

describe('getAssignableClientUsers — contact principal', () => {
	test('include contactul principal chiar cu is_primary=0 stale, pe baza client.email', async () => {
		queryQueue.push(
			[georgeRow, secergiuRow], // client_user JOIN user
			[sergiuCse], // client_secondary_email
			[{ email: 'georgedragoiu.heylux@gmail.com' }] // client.email
		);

		const result = await (getAssignableClientUsers as any)(CLIENT);

		const ids = result.map((r: any) => r.id);
		expect(ids).toContain('u-george');
		expect(ids).toContain('u-sergiu');
		const george = result.find((r: any) => r.id === 'u-george');
		expect(george.isPrimary).toBe(true);
	});

	test('email principal cu majuscule tot marchează contactul ca primar', async () => {
		queryQueue.push(
			[georgeRow],
			[],
			[{ email: 'GeorgeDragoiu.Heylux@Gmail.com ' }]
		);

		const result = await (getAssignableClientUsers as any)(CLIENT);

		expect(result).toHaveLength(1);
		expect(result[0].id).toBe('u-george');
		expect(result[0].isPrimary).toBe(true);
	});

	test('regresie: primarul flagged rămâne, secundarul fără acces tasks e exclus', async () => {
		queryQueue.push(
			[
				{ ...georgeRow, isPrimary: true },
				{
					userId: 'u-conta',
					email: 'expertcontabil.heylux@gmail.com',
					firstName: 'Conta',
					lastName: 'Bilitate',
					isPrimary: false
				}
			],
			[
				{
					email: 'expertcontabil.heylux@gmail.com',
					label: 'Contabilitate',
					accessFlags: null,
					notifyTasks: 0
				}
			],
			[{ email: 'georgedragoiu.heylux@gmail.com' }]
		);

		const result = await (getAssignableClientUsers as any)(CLIENT);

		expect(result).toHaveLength(1);
		expect(result[0].id).toBe('u-george');
	});

	test('negativ: un client user NU poate lista echipa altui client', async () => {
		currentEvent = clientEvent('client-altul');
		await expect((getAssignableClientUsers as any)(CLIENT)).rejects.toThrow('Unauthorized');
	});
});

// ─── getEligibleClientAssigneeIds (validare server-side) ─────────────────────

describe('getEligibleClientAssigneeIds — regula de eligibilitate', () => {
	test('include primarul după email (flag stale) și secundarul cu acces; exclude restul', async () => {
		queryQueue.push(
			[
				georgeRow,
				secergiuRow,
				{ userId: 'u-conta', email: 'expertcontabil.heylux@gmail.com', isPrimary: false }
			],
			[sergiuCse, { email: 'expertcontabil.heylux@gmail.com', accessFlags: null, notifyTasks: 0 }],
			[{ email: 'georgedragoiu.heylux@gmail.com' }]
		);

		const eligible = await getEligibleClientAssigneeIds(TENANT, CLIENT);

		expect(eligible.has('u-george')).toBe(true);
		expect(eligible.has('u-sergiu')).toBe(true);
		expect(eligible.has('u-conta')).toBe(false);
	});

	test('fără rânduri client_user → set gol (fără alte query-uri)', async () => {
		queryQueue.push([]);
		const eligible = await getEligibleClientAssigneeIds(TENANT, CLIENT);
		expect(eligible.size).toBe(0);
		expect(queryQueue).toHaveLength(0);
	});
});

// ─── getTaskParticipantEmails (filtrul notificărilor de client) ───────────────

describe('getTaskParticipantEmails — participanții la task', () => {
	test('adună asignații, watcherii și assignedTo, lowercased', async () => {
		queryQueue.push(
			[{ email: 'Birzu.Sergiu@gmail.com' }, { email: 'george@heylux.ro' }], // task_assignee
			[{ email: 'office@onetopsolution.ro' }], // task_watcher
			[{ email: 'Extra@Assigned.ro' }] // user-ul din assignedToUserId
		);
		const set = await getTaskParticipantEmails('task-1', TENANT, 'u-extra');
		expect(set.has('birzu.sergiu@gmail.com')).toBe(true);
		expect(set.has('george@heylux.ro')).toBe(true);
		expect(set.has('office@onetopsolution.ro')).toBe(true);
		expect(set.has('extra@assigned.ro')).toBe(true);
		expect(set.size).toBe(4);
	});

	test('fără assignedTo: nu face lookup suplimentar și setul rămâne corect', async () => {
		queryQueue.push([{ email: 'a@x.ro' }], []);
		const set = await getTaskParticipantEmails('task-1', TENANT, null);
		expect(set.has('a@x.ro')).toBe(true);
		expect(set.size).toBe(1);
		expect(queryQueue).toHaveLength(0);
	});
});

// ─── updateClient — sincronizarea link-ului primar la schimbare de email ──────

const existingClient = {
	id: CLIENT,
	tenantId: TENANT,
	name: 'Lucky Group',
	email: 'vechi@heylux.ro',
	phone: '0232240692'
};

describe('updateClient — link primar client_user', () => {
	test('fără link vechi: creează link primar nou + demote pe flagurile stale', async () => {
		queryQueue.push(
			[existingClient], // client existent
			[{ id: 'u-george' }], // user email nou
			[{ id: 'u-old' }], // user email vechi
			[], // link primar vechi — LIPSEȘTE (cazul Lucky Group)
			[] // link existent pentru userul nou — lipsește
		);

		await (updateClient as any)({
			clientId: CLIENT,
			name: 'Lucky Group',
			email: 'georgedragoiu.heylux@gmail.com'
		});

		expect(cuInserts()).toHaveLength(1);
		expect(cuInserts()[0].values.userId).toBe('u-george');
		expect(cuInserts()[0].values.clientId).toBe(CLIENT);
		expect(cuInserts()[0].values.tenantId).toBe(TENANT);
		expect(cuInserts()[0].values.isPrimary).toBe(true);
		// invariantul un-singur-primar: alte rânduri flagged primar sunt demote-uite
		expect(cuDemotes()).toHaveLength(1);
	});

	test('userul nou are deja link secundar: îl promovează la primar', async () => {
		queryQueue.push(
			[existingClient],
			[{ id: 'u-george' }], // user nou
			[], // userul vechi nu există
			[{ id: 'cu-george', isPrimary: false }] // link existent (secundar)
		);

		await (updateClient as any)({
			clientId: CLIENT,
			name: 'Lucky Group',
			email: 'georgedragoiu.heylux@gmail.com'
		});

		expect(cuPromotes()).toHaveLength(1);
		expect(cuInserts()).toHaveLength(0);
	});

	test('client fără email inițial: setarea emailului creează link primar', async () => {
		queryQueue.push(
			[{ ...existingClient, email: null }],
			[{ id: 'u-george' }], // user nou
			[] // link existent — lipsește
		);

		await (updateClient as any)({
			clientId: CLIENT,
			name: 'Lucky Group',
			email: 'georgedragoiu.heylux@gmail.com'
		});

		expect(cuInserts()).toHaveLength(1);
		expect(cuInserts()[0].values.userId).toBe('u-george');
		expect(cuInserts()[0].values.isPrimary).toBe(true);
	});

	test('regresie: link vechi + user nou fără link → re-link, fără insert', async () => {
		queryQueue.push(
			[existingClient],
			[{ id: 'u-nou' }], // user email nou
			[{ id: 'u-old' }], // user email vechi
			[{ id: 'cu-old', isPrimary: true, userId: 'u-old' }], // link primar vechi
			[] // userul nou nu are link → re-link
		);

		await (updateClient as any)({
			clientId: CLIENT,
			name: 'Lucky Group',
			email: 'nou@heylux.ro'
		});

		expect(cuRelinks()).toHaveLength(1);
		expect(cuRelinks()[0].set.userId).toBe('u-nou');
		expect(cuInserts()).toHaveLength(0);
		expect(cuOps().filter((o) => o.op === 'delete')).toHaveLength(0);
	});

	test('regresie: email nou fără cont → link vechi șters, nimic creat', async () => {
		queryQueue.push(
			[existingClient],
			[], // emailul nou nu are user
			[{ id: 'u-old' }],
			[{ id: 'cu-old', isPrimary: true, userId: 'u-old' }]
		);

		await (updateClient as any)({
			clientId: CLIENT,
			name: 'Lucky Group',
			email: 'inexistent@heylux.ro'
		});

		expect(cuOps().filter((o) => o.op === 'delete')).toHaveLength(1);
		expect(cuInserts()).toHaveLength(0);
	});

	test('email neschimbat: nicio operație pe client_user', async () => {
		queryQueue.push([existingClient]);

		await (updateClient as any)({
			clientId: CLIENT,
			name: 'Lucky Group',
			email: 'vechi@heylux.ro'
		});

		expect(cuOps()).toHaveLength(0);
	});

	test('email OMIS din payload: coloana rămâne, link-ul primar NU e atins', async () => {
		queryQueue.push([existingClient]);

		await (updateClient as any)({
			clientId: CLIENT,
			name: 'Lucky Group Redenumit'
		});

		expect(cuOps()).toHaveLength(0);
	});
});

// ─── updateClientCompanyData — path-ul din portalul clientului ────────────────

describe('updateClientCompanyData — sync link primar din portal', () => {
	beforeEach(() => {
		currentEvent = clientEvent(CLIENT);
	});

	test('schimbarea emailului companiei sincronizează link-ul primar', async () => {
		queryQueue.push(
			[{ email: 'vechi@heylux.ro' }], // client existent
			[{ id: 'u-george' }], // user email nou
			[], // user email vechi — lipsește
			[] // link existent pentru userul nou — lipsește
		);

		await (updateClientCompanyData as any)({
			name: 'Lucky Group',
			email: 'georgedragoiu.heylux@gmail.com'
		});

		expect(cuInserts()).toHaveLength(1);
		expect(cuInserts()[0].values.userId).toBe('u-george');
		expect(cuInserts()[0].values.isPrimary).toBe(true);
		expect(cuDemotes()).toHaveLength(1);
	});

	test('email gol e IGNORAT: nu golește contactul principal și nu atinge link-ul', async () => {
		queryQueue.push([{ email: 'vechi@heylux.ro' }]);

		await (updateClientCompanyData as any)({ name: 'Lucky Group', email: '' });

		expect(cuOps()).toHaveLength(0);
		const clientUpdates = ops.filter((o) => o.op === 'update' && o.table === table.client);
		expect(clientUpdates).toHaveLength(1);
		expect('email' in clientUpdates[0].set).toBe(false);
	});

	test('email invalid e respins', async () => {
		await expect(
			(updateClientCompanyData as any)({ name: 'Lucky Group', email: 'nu-e-email' })
		).rejects.toThrow('nu este validă');
	});
});
