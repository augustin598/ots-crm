import { describe, expect, test, mock, beforeEach } from 'bun:test';

mock.module('$env/dynamic/private', () => ({ env: { SQLITE_PATH: ':memory:' } }));
mock.module('$env/static/private', () => ({ SQLITE_PATH: ':memory:' }));

// ─── DB mock ─────────────────────────────────────────────────────────────────

// selectQueue: each entry is returned by successive .limit() calls in order
const selectQueue: Array<Record<string, unknown>[]> = [];
const insertCalled: Array<{ tenantId: string }> = [];

mock.module('$lib/server/db', () => {
	const makeChain = () => ({
		from: () => makeChain(),
		where: () => makeChain(),
		limit: () => {
			const next = selectQueue.shift() ?? [];
			return Promise.resolve(next);
		},
	});
	return {
		db: {
			select: () => ({ from: () => makeChain() }),
			insert: () => ({
				values: (v: Record<string, unknown>) => {
					insertCalled.push({ tenantId: v.tenantId as string });
					return Promise.resolve();
				}
			}),
		}
	};
});

mock.module('$lib/server/db/schema', () => ({
	adOptimizationRecommendation: { tenantId: 'tenant_id', id: 'id', status: 'status', clientId: 'client_id', externalCampaignId: 'external_campaign_id', createdAt: 'created_at' },
	client: { id: 'id', tenantId: 'tenant_id' },
	adMonitorTarget: { id: 'id', tenantId: 'tenant_id' },
	tenant: { id: 'id', slug: 'slug' },
	tenantUser: { tenantId: 'tenant_id', userId: 'user_id' },
	AD_RECOMMENDATION_ACTIONS: ['pause_ad', 'resume_ad', 'increase_budget', 'decrease_budget', 'refresh_creative', 'change_audience', 'investigate'],
	AD_RECOMMENDATION_STATUSES: ['draft', 'approved', 'rejected', 'applied', 'failed'],
}));

mock.module('$lib/server/notifications', () => ({ createNotification: async () => {} }));
mock.module('$lib/server/logger', () => ({ logInfo: () => {}, logError: () => {}, logWarning: () => {} }));

// Middleware: x-api-key 'key-tenant-b' → tenant-b, anything else → tenant-a
mock.module('$lib/server/api-keys/middleware', () => ({
	withApiKey: async (event: { request: Request }, _scope: string, handler: (e: unknown, ctx: unknown) => unknown) => {
		const key = event.request.headers.get('x-api-key');
		const tenantId = key === 'key-tenant-b' ? 'tenant-b' : 'tenant-a';
		const ctx = { tenantId, apiKeyId: 'key-1' };
		const result = await handler(event, ctx);
		if (result instanceof Response) return result;
		const r = result as { status: number; body: unknown };
		return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
	}
}));

const { POST } = await import('../recommendations/+server.js');

function makePostEvent(apiKey: string, body: unknown) {
	const url = new URL('http://localhost/api/external/ads-monitor/recommendations');
	return {
		request: new Request(url.toString(), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
			body: JSON.stringify(body),
		}),
		url,
		params: {},
	};
}

// ─── B3 Tenant Isolation Tests ───────────────────────────────────────────────

describe('B3 — POST /ads-monitor/recommendations: tenant isolation', () => {
	beforeEach(() => {
		selectQueue.length = 0;
		insertCalled.length = 0;
	});

	test('rejects cross-tenant: tenant-A key with client from tenant-B returns 404', async () => {
		// client lookup → empty (not in tenant-a)
		selectQueue.push([]);

		const event = makePostEvent('key-tenant-a', {
			clientId: 'client-from-tenant-b',
			externalCampaignId: 'camp-1',
			action: 'pause_ad',
			reason: 'cross-tenant test',
		});
		const res = await POST(event as never);
		const json = await res.json();

		expect(res.status).toBe(404);
		expect(json.error).toBe('client_not_found');
	});

	test('allows: tenant-A key with tenant-A client returns 201', async () => {
		// client lookup → found; no targetId so no second lookup; tenant lookup + recipients both empty → ok
		selectQueue.push([{ id: 'client-a1', tenantId: 'tenant-a' }]); // client
		selectQueue.push([{ id: 'tenant-a', slug: 'tenant-a' }]);       // tenant slug
		selectQueue.push([]);                                            // tenantUser recipients

		const event = makePostEvent('key-tenant-a', {
			clientId: 'client-a1',
			externalCampaignId: 'camp-1',
			action: 'pause_ad',
			reason: 'valid recommendation',
		});
		const res = await POST(event as never);

		expect(res.status).toBe(201);
		// Inserted recommendation must be scoped to tenant-a (derived from API key, not body)
		expect(insertCalled[0]?.tenantId).toBe('tenant-a');
	});

	test('tenant-B key with tenant-B client → 201 scoped to tenant-b', async () => {
		selectQueue.push([{ id: 'client-b1', tenantId: 'tenant-b' }]);
		selectQueue.push([{ id: 'tenant-b', slug: 'tenant-b' }]);
		selectQueue.push([]);

		const event = makePostEvent('key-tenant-b', {
			clientId: 'client-b1',
			externalCampaignId: 'camp-2',
			action: 'increase_budget',
			reason: 'tenant-b valid',
		});
		const res = await POST(event as never);

		expect(res.status).toBe(201);
		expect(insertCalled[0]?.tenantId).toBe('tenant-b');
	});
});
