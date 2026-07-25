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
const updateCalls: Array<{ set: unknown }> = [];

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
			set: (patch: unknown) => {
				updateCalls.push({ set: patch });
				return {
					where: () =>
						Object.assign(Promise.resolve([]), {
							returning: () => Promise.resolve([{ id: 'i1' }, { id: 'i2' }])
						})
				};
			}
		}),
		delete: () => ({ where: () => Promise.resolve() })
	}
}));

const {
	createInterview,
	assignInterviewsClient,
	getInterviews,
	getInterviewChannels,
	updateInterview,
	deleteInterview
} = await import('../interviuri.remote');

const CHANNELS = [
	{ id: 'ch1', tenantId: 't1', name: 'TikTok', color: '#000', icon: 'x', isSystem: true, sortOrder: 1 }
];

beforeEach(() => {
	selectQueue.length = 0;
	insertedValues.length = 0;
	updateCalls.length = 0;
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
	const clientEvent = () => ({
		locals: {
			user: { id: 'cu1' },
			tenant: { id: 't1' },
			isClientUser: true,
			client: { id: 'lucky1' }
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

	test('createInterview e respins pentru userul de portal', async () => {
		currentEvent = clientEvent();
		await expect(
			createInterview({ nume: 'X', dataInterviu: '2026-07-01', channelId: 'ch1' } as any)
		).rejects.toThrow(/unauthorized/i);
		expect(insertedValues.length).toBe(0);
	});

	test('updateInterview e respins pentru userul de portal', async () => {
		currentEvent = clientEvent();
		await expect(
			updateInterview({ id: 'i1', nume: 'X', dataInterviu: '2026-07-01', channelId: 'ch1' } as any)
		).rejects.toThrow(/unauthorized/i);
		expect(updateCalls.length).toBe(0);
	});

	test('deleteInterview e respins pentru userul de portal', async () => {
		currentEvent = clientEvent();
		await expect(deleteInterview('i1')).rejects.toThrow(/unauthorized/i);
	});

	test('assignInterviewsClient e respins pentru userul de portal', async () => {
		currentEvent = clientEvent();
		await expect(
			assignInterviewsClient({ clientId: 'lucky1', onlyUnassigned: true })
		).rejects.toThrow(/unauthorized/i);
		expect(updateCalls.length).toBe(0);
	});
});
