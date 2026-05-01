import { describe, expect, test, mock, beforeEach } from 'bun:test';

// Mock SvelteKit virtual modules before any imports
mock.module('$env/dynamic/private', () => ({ env: { SQLITE_PATH: ':memory:' } }));
mock.module('$env/static/private', () => ({ SQLITE_PATH: ':memory:' }));

// ─── DB mock ─────────────────────────────────────────────────────────────────

type MockRow = Record<string, unknown>;

const selectResult: MockRow[] = [];
const updateResult: MockRow[] = [];

mock.module('$lib/server/db', () => {
	const makeChain = (rows: MockRow[]) => ({
		from: () => makeChain(rows),
		where: () => makeChain(rows),
		orderBy: () => makeChain(rows),
		limit: () => Promise.resolve(rows),
		returning: () => Promise.resolve(rows),
		set: () => makeChain(rows),
	});
	return {
		db: {
			select: () => makeChain(selectResult),
			update: () => makeChain(updateResult),
		}
	};
});

mock.module('$lib/server/db/schema', () => ({
	adsOptimizationTask: { tenantId: 'tenant_id', id: 'id', status: 'status', clientId: 'client_id', createdAt: 'created_at' }
}));

mock.module('$lib/server/api-keys/middleware', () => ({
	withApiKey: async (event: Request, _scope: string, handler: (e: Request, ctx: unknown) => unknown) => {
		const ctx = { tenantId: 'tenant-1', apiKeyId: 'key-1' };
		const result = await handler(event, ctx);
		if (result instanceof Response) return result;
		const r = result as { status: number; body: unknown };
		return new Response(JSON.stringify(r.body), {
			status: r.status,
			headers: { 'Content-Type': 'application/json' },
		});
	}
}));

// Re-import after mocks are set up
const { GET } = await import('../+server.js');
const claimMod = await import('../[id]/claim/+server.js');
const patchMod = await import('../[id]/+server.js');

function makeEvent(opts: {
	method?: string;
	url?: string;
	body?: unknown;
	params?: Record<string, string>;
}): unknown {
	const url = new URL(opts.url ?? 'http://localhost/api/external/ads-optimization-tasks');
	return {
		request: new Request(url.toString(), {
			method: opts.method ?? 'GET',
			headers: { 'Content-Type': 'application/json', 'x-api-key': 'test-key' },
			body: opts.body ? JSON.stringify(opts.body) : undefined,
		}),
		url,
		params: opts.params ?? {},
	};
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('GET /api/external/ads-optimization-tasks', () => {
	beforeEach(() => {
		selectResult.length = 0;
	});

	test('returns pending tasks for tenant', async () => {
		selectResult.push({
			id: 'task-1',
			tenantId: 'tenant-1',
			targetId: 'tgt-1',
			externalCampaignId: 'camp-1',
			clientId: 'cli-1',
			type: 'analyze_for_suggestions',
			status: 'pending',
			scheduledFor: new Date('2026-04-30T00:00:00Z'),
			createdAt: new Date(),
			claimedAt: null,
			claimedBy: null,
			completedAt: null,
			resultJson: null,
			expiresAt: new Date('2026-05-07T00:00:00Z'),
		});

		const event = makeEvent({ url: 'http://localhost/api/external/ads-optimization-tasks?status=pending' });
		const res = await GET(event as never);
		const json = await res.json();

		expect(res.status).toBe(200);
		expect(json.items).toHaveLength(1);
		expect(json.items[0].id).toBe('task-1');
		expect(json.total).toBe(1);
	});

	test('rejects invalid status param', async () => {
		const event = makeEvent({ url: 'http://localhost/api/external/ads-optimization-tasks?status=invalid' });
		const res = await GET(event as never);
		const json = await res.json();

		expect(res.status).toBe(400);
		expect(json.error).toBe('invalid_status');
	});

	test('parses resultJson as object', async () => {
		selectResult.push({
			id: 'task-2',
			status: 'done',
			resultJson: '{"drafts_created":1,"recommendation_ids":["r1"]}',
		});
		const event = makeEvent({ url: 'http://localhost/api/external/ads-optimization-tasks?status=done' });
		const res = await GET(event as never);
		const json = await res.json();

		expect(res.status).toBe(200);
		expect(json.items[0].resultJson).toEqual({ drafts_created: 1, recommendation_ids: ['r1'] });
	});
});

describe('POST /api/external/ads-optimization-tasks/:id/claim', () => {
	beforeEach(() => {
		selectResult.length = 0;
		updateResult.length = 0;
	});

	test('claims a pending task — returns 200 with claimed task', async () => {
		const claimedTask = {
			id: 'task-1',
			tenantId: 'tenant-1',
			status: 'claimed',
			claimedAt: new Date(),
			claimedBy: 'worker-1',
			resultJson: null,
		};
		// First SELECT returns the pending task
		selectResult.push({ id: 'task-1', tenantId: 'tenant-1', status: 'pending' });
		// UPDATE returning returns claimed task
		updateResult.push(claimedTask);

		const event = makeEvent({ method: 'POST', params: { id: 'task-1' }, body: { workerId: 'worker-1' } });
		const res = await claimMod.POST(event as never);
		const json = await res.json();

		expect(res.status).toBe(200);
		expect(json.status).toBe('claimed');
		expect(json.claimedBy).toBe('worker-1');
	});

	test('returns 409 when task does not exist', async () => {
		// SELECT returns nothing
		const event = makeEvent({ method: 'POST', params: { id: 'missing' }, body: {} });
		const res = await claimMod.POST(event as never);
		const json = await res.json();

		expect(res.status).toBe(409);
		expect(json.error).toBe('task_not_claimable');
		expect(json.reason).toBe('not_found');
	});

	test('returns 409 when task is already claimed', async () => {
		selectResult.push({ id: 'task-1', tenantId: 'tenant-1', status: 'claimed' });

		const event = makeEvent({ method: 'POST', params: { id: 'task-1' }, body: {} });
		const res = await claimMod.POST(event as never);
		const json = await res.json();

		expect(res.status).toBe(409);
		expect(json.reason).toBe('already_claimed');
	});

	test('returns 409 on race (UPDATE returns 0 rows)', async () => {
		selectResult.push({ id: 'task-1', tenantId: 'tenant-1', status: 'pending' });
		// updateResult is empty → race condition, already claimed by another worker

		const event = makeEvent({ method: 'POST', params: { id: 'task-1' }, body: {} });
		const res = await claimMod.POST(event as never);
		const json = await res.json();

		expect(res.status).toBe(409);
		expect(json.reason).toBe('already_claimed');
	});
});

describe('PATCH /api/external/ads-optimization-tasks/:id', () => {
	beforeEach(() => {
		selectResult.length = 0;
		updateResult.length = 0;
	});

	test('completes a task with status=done and saves resultJson', async () => {
		selectResult.push({ id: 'task-1', status: 'claimed' });
		updateResult.push({
			id: 'task-1',
			status: 'done',
			completedAt: new Date(),
			resultJson: '{"drafts_created":2,"recommendation_ids":["r1","r2"]}'
		});

		const event = makeEvent({
			method: 'PATCH',
			params: { id: 'task-1' },
			body: { status: 'done', result: { drafts_created: 2, recommendation_ids: ['r1', 'r2'] } }
		});
		const res = await patchMod.PATCH(event as never);
		const json = await res.json();

		expect(res.status).toBe(200);
		expect(json.status).toBe('done');
		expect(json.resultJson).toEqual({ drafts_created: 2, recommendation_ids: ['r1', 'r2'] });
	});

	test('marks task failed', async () => {
		selectResult.push({ id: 'task-1', status: 'claimed' });
		updateResult.push({ id: 'task-1', status: 'failed', completedAt: new Date(), resultJson: '{"error":"worker_timeout"}' });

		const event = makeEvent({
			method: 'PATCH',
			params: { id: 'task-1' },
			body: { status: 'failed', result: { error: 'worker_timeout' } }
		});
		const res = await patchMod.PATCH(event as never);
		const json = await res.json();

		expect(res.status).toBe(200);
		expect(json.status).toBe('failed');
	});

	test('returns 400 for invalid status', async () => {
		const event = makeEvent({
			method: 'PATCH',
			params: { id: 'task-1' },
			body: { status: 'pending' }
		});
		const res = await patchMod.PATCH(event as never);
		const json = await res.json();

		expect(res.status).toBe(400);
		expect(json.error).toBe('invalid_status');
	});

	test('returns 404 when task not found', async () => {
		const event = makeEvent({
			method: 'PATCH',
			params: { id: 'ghost' },
			body: { status: 'done' }
		});
		const res = await patchMod.PATCH(event as never);
		const json = await res.json();

		expect(res.status).toBe(404);
	});

	test('returns 409 when task is not in claimed state', async () => {
		selectResult.push({ id: 'task-1', status: 'pending' });

		const event = makeEvent({
			method: 'PATCH',
			params: { id: 'task-1' },
			body: { status: 'done' }
		});
		const res = await patchMod.PATCH(event as never);
		const json = await res.json();

		expect(res.status).toBe(409);
	});
});
