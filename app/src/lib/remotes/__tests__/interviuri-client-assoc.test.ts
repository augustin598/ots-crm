import { describe, test, expect, mock, beforeEach } from 'bun:test';

/**
 * Asociere interviuri ↔ client (mecanismul seoLink.clientId).
 *
 * Invariantul multi-tenant testat aici: orice clientId primit de la UI trebuie
 * validat că aparține tenantului curent ÎNAINTE de orice insert/update pe
 * `interview`. Fără validare, un staff dintr-un tenant ar putea agăța
 * interviurile de clientul altui tenant (clasa de bug F8).
 */

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$env/dynamic/public', () => ({ env: {} }));

// CRITICAL: eager-load schema reală ÎNAINTE de orice mock — mock.module()
// leak-uiește între fișierele suitei în bun; vezi comentariul din
// hosting-inquiries-delete-safety.test.ts.
await import('$lib/server/db/schema');

// ─── Request context ──────────────────────────────────────────────────────────

let currentEvent: any = null;

mock.module('$app/server', () => ({
	query: (schemaOrFn: any, fn?: Function) => fn ?? schemaOrFn,
	command: (schemaOrFn: any, fn?: Function) => fn ?? schemaOrFn,
	getRequestEvent: () => currentEvent
}));

// Ca în producție: requireStaff respinge userii de portal (isClientUser).
mock.module('$lib/server/get-actor', () => ({
	requireStaff: async () => {
		if (currentEvent?.locals?.isClientUser) throw new Error('Unauthorized');
		return { type: 'staff', user: { id: 'u1' } };
	}
}));

// ─── Fake DB ──────────────────────────────────────────────────────────────────

const selectQueue: Array<unknown[]> = [];
const insertedValues: unknown[] = [];
const updateCalls: Array<{ set: unknown; where: unknown }> = [];
const deleteCalls: Array<{ where: unknown }> = [];
// Rândurile pe care le „prinde" WHERE-ul; [] = niciunul (rând al altui client).
let updateReturns: unknown[] = [{ id: 'i1' }, { id: 'i2' }];
let deleteReturns: unknown[] = [{ id: 'i1' }];

/**
 * Extrage valorile parametrilor dintr-un obiect SQL drizzle, ca să putem
 * verifica CE filtrează clauza WHERE (ex: client_id-ul din sesiune).
 */
function paramValues(node: unknown, out: unknown[] = []): unknown[] {
	if (!node || typeof node !== 'object') return out;
	const n = node as Record<string, unknown>;
	if (Array.isArray(n.queryChunks)) n.queryChunks.forEach((c) => paramValues(c, out));
	// Param.value = valoarea legată; StringChunk.value = string[] (SQL brut) → ignorat.
	else if ('value' in n && !Array.isArray(n.value)) out.push(n.value);
	return out;
}

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
		returning: () => makeChain(rows)
	});
}

mock.module('$lib/server/db', () => ({
	db: {
		select: () => makeChain(selectQueue.shift() ?? []),
		insert: () => ({
			values: (v: unknown) => {
				insertedValues.push(v);
				return Promise.resolve();
			}
		}),
		update: () => ({
			set: (patch: unknown) => ({
				where: (w: unknown) => {
					updateCalls.push({ set: patch, where: w });
					return Object.assign(Promise.resolve([]), {
						returning: () => Promise.resolve(updateReturns)
					});
				}
			})
		}),
		delete: () => ({
			where: (w: unknown) => {
				deleteCalls.push({ where: w });
				return Object.assign(Promise.resolve([]), {
					returning: () => Promise.resolve(deleteReturns)
				});
			}
		})
	}
}));

const {
	createInterview,
	assignInterviewsClient,
	getInterviews,
	getInterviewChannels,
	updateInterview,
	deleteInterview,
	createInterviewChannel
} = await import('../interviuri.remote');

const CHANNELS = [
	{ id: 'ch1', tenantId: 't1', name: 'TikTok', color: '#000', icon: 'x', isSystem: true, sortOrder: 1 }
];

beforeEach(() => {
	selectQueue.length = 0;
	insertedValues.length = 0;
	updateCalls.length = 0;
	deleteCalls.length = 0;
	updateReturns = [{ id: 'i1' }, { id: 'i2' }];
	deleteReturns = [{ id: 'i1' }];
	currentEvent = { locals: { user: { id: 'u1' }, tenant: { id: 't1' } } };
});

describe('createInterview cu clientId', () => {
	test('clientId inexistent în tenant → aruncă eroare, nu inserează', async () => {
		selectQueue.push([]); // lookup client în tenant → gol
		await expect(
			createInterview({ nume: 'Test', dataInterviu: '2026-07-01', clientId: 'evil-client' } as any)
		).rejects.toThrow(/client/i);
		expect(insertedValues.length).toBe(0);
	});

	test('clientId valid în tenant → inserează cu clientId', async () => {
		selectQueue.push([{ id: 'lucky1' }]); // lookup client OK
		selectQueue.push([{ id: 'ch1' }]); // ensureChannelsSeeded: există canale
		selectQueue.push(CHANNELS); // channelsForTenant
		await createInterview({
			nume: 'Test',
			dataInterviu: '2026-07-01',
			clientId: 'lucky1',
			channelId: 'ch1'
		} as any);
		expect(insertedValues.length).toBe(1);
		expect((insertedValues[0] as any).clientId).toBe('lucky1');
	});

	test('fără clientId → inserează cu clientId null', async () => {
		selectQueue.push([{ id: 'ch1' }]); // ensureChannelsSeeded
		selectQueue.push(CHANNELS); // channelsForTenant
		await createInterview({ nume: 'Test', dataInterviu: '2026-07-01', channelId: 'ch1' } as any);
		expect(insertedValues.length).toBe(1);
		expect((insertedValues[0] as any).clientId).toBeNull();
	});
});

describe('assignInterviewsClient', () => {
	test('clientId inexistent în tenant → aruncă, nu face update', async () => {
		selectQueue.push([]); // lookup client → gol
		await expect(
			assignInterviewsClient({ clientId: 'evil', onlyUnassigned: true })
		).rejects.toThrow(/client/i);
		expect(updateCalls.length).toBe(0);
	});

	test('clientId valid → update cu clientId și întoarce count', async () => {
		selectQueue.push([{ id: 'lucky1' }]); // lookup client OK
		const res = await assignInterviewsClient({ clientId: 'lucky1', onlyUnassigned: true });
		expect(updateCalls.length).toBe(1);
		expect((updateCalls[0].set as any).clientId).toBe('lucky1');
		expect(res.count).toBe(2);
	});
});

describe('acces portal client (isClientUser)', () => {
	// Contact PRIMAR: `getRequestAccessFlags` îi dă toate flag-urile fără să
	// atingă DB-ul, deci selectQueue rămâne aliniat cu ce cere codul.
	// Testele de aici verifică SCOPAREA pe client, nu gate-ul de acces — pentru
	// acela vezi testul cu contactul secundar de mai jos.
	const clientEvent = () => ({
		locals: {
			user: { id: 'cu1', email: 'primar@example.com' },
			tenant: { id: 't1' },
			isClientUser: true,
			client: { id: 'lucky1' },
			clientUser: { isPrimary: true }
		}
	});

	test('getInterviews e permis pentru userul de portal (scopat pe clientul lui)', async () => {
		currentEvent = clientEvent();
		selectQueue.push([{ id: 'ch1' }]); // ensureChannelsSeeded: există canale
		selectQueue.push([]); // rândurile interviurilor
		const rows = await getInterviews(undefined as any);
		expect(Array.isArray(rows)).toBe(true);
	});

	test('getInterviewChannels e permis pentru userul de portal', async () => {
		currentEvent = clientEvent();
		selectQueue.push([{ id: 'ch1' }]); // ensureChannelsSeeded: există canale
		selectQueue.push(CHANNELS); // channelsForTenant
		const channels = await getInterviewChannels(undefined as any);
		expect(Array.isArray(channels)).toBe(true);
	});

	// Portalul are CRUD pe PROPRIILE interviuri. Delimitarea între clienți NU se
	// face în UI: create forțează client_id-ul din sesiune, iar update/delete
	// primesc client_id în WHERE, deci nu pot atinge rândurile altui client.
	test('createInterview din portal ignoră clientId-ul din payload', async () => {
		currentEvent = clientEvent();
		selectQueue.push([{ id: 'ch1' }]); // ensureChannelsSeeded
		selectQueue.push(CHANNELS); // channelsForTenant
		await createInterview({
			nume: 'X',
			dataInterviu: '2026-07-01',
			clientId: 'alt-client', // încearcă să agațe interviul de alt client
			channelId: 'ch1'
		} as any);
		expect(insertedValues.length).toBe(1);
		expect((insertedValues[0] as any).clientId).toBe('lucky1'); // clientul din sesiune
	});

	test('updateInterview din portal filtrează WHERE pe clientul din sesiune', async () => {
		currentEvent = clientEvent();
		selectQueue.push([{ id: 'ch1' }]);
		selectQueue.push(CHANNELS);
		await updateInterview({
			id: 'i1',
			nume: 'X',
			dataInterviu: '2026-07-01',
			clientId: 'alt-client',
			channelId: 'ch1'
		} as any);
		expect(updateCalls.length).toBe(1);
		expect((updateCalls[0].set as any).clientId).toBe('lucky1'); // nu poate fi mutat
		expect(paramValues(updateCalls[0].where)).toContain('lucky1'); // WHERE ... client_id = 'lucky1'
	});

	test('updateInterview pe rândul altui client aruncă (0 rânduri atinse)', async () => {
		currentEvent = clientEvent();
		selectQueue.push([{ id: 'ch1' }]);
		selectQueue.push(CHANNELS);
		updateReturns = []; // WHERE-ul cu client_id nu prinde rândul
		await expect(
			updateInterview({ id: 'i-altul', nume: 'X', dataInterviu: '2026-07-01', channelId: 'ch1' } as any)
		).rejects.toThrow(/nu a fost găsit/i);
	});

	test('deleteInterview din portal filtrează WHERE pe clientul din sesiune', async () => {
		currentEvent = clientEvent();
		await deleteInterview('i1');
		expect(deleteCalls.length).toBe(1);
		expect(paramValues(deleteCalls[0].where)).toContain('lucky1');
	});

	test('deleteInterview pe rândul altui client aruncă (0 rânduri atinse)', async () => {
		currentEvent = clientEvent();
		deleteReturns = [];
		await expect(deleteInterview('i-altul')).rejects.toThrow(/nu a fost găsit/i);
	});

	// Gate-ul de acces în sine: contactul SECUNDAR fără flag-ul `interviuri` e
	// respins de remote, nu doar ascuns din navigare. Layout-ul gate-uiește doar
	// meniul — fără verificarea asta, flag-ul ar fi pur cosmetic.
	test('contactul secundar FĂRĂ flag-ul interviuri e respins la citire și la scriere', async () => {
		const secondaryEvent = () => ({
			locals: {
				user: { id: 'cu2', email: 'secundar@example.com' },
				tenant: { id: 't1' },
				isClientUser: true,
				client: { id: 'lucky1' },
				clientUser: { isPrimary: false }
			}
		});

		// getRequestAccessFlags citește rândul de secondary email; gol = fără acces.
		currentEvent = secondaryEvent();
		selectQueue.push([]);
		await expect(getInterviews(undefined as any)).rejects.toThrow(/nu ai acces/i);

		currentEvent = secondaryEvent();
		selectQueue.push([]);
		await expect(
			createInterview({
				nume: 'X',
				dataInterviu: '2026-07-01',
				channelId: 'ch1'
			} as any)
		).rejects.toThrow(/nu ai acces/i);
	});

	test('staff nu primește filtru pe client în WHERE (vede tot tenantul)', async () => {
		currentEvent = { locals: { user: { id: 'u1' }, tenant: { id: 't1' } } };
		await deleteInterview('i1');
		expect(paramValues(deleteCalls[0].where)).toEqual(['i1', 't1']);
	});

	test('createInterviewChannel e respins pentru userul de portal', async () => {
		currentEvent = clientEvent();
		await expect(createInterviewChannel({ name: 'Canal Portal' } as any)).rejects.toThrow(
			/unauthorized/i
		);
	});

	test('assignInterviewsClient e respins pentru userul de portal', async () => {
		currentEvent = clientEvent();
		await expect(
			assignInterviewsClient({ clientId: 'lucky1', onlyUnassigned: true })
		).rejects.toThrow(/unauthorized/i);
		expect(updateCalls.length).toBe(0);
	});
});
