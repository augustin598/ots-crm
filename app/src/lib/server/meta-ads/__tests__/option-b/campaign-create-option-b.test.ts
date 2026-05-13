import { describe, it, expect, mock, beforeEach, spyOn } from 'bun:test';

// Capture fetch calls to assert status values
const fetchCalls: Array<{ url: string; body: URLSearchParams }> = [];

global.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
	const url = typeof input === 'string' ? input : input.toString();
	const body = new URLSearchParams((init?.body as string | undefined) ?? '');
	fetchCalls.push({ url, body });
	// Campaign step
	if (url.includes('/campaigns')) return new Response(JSON.stringify({ id: 'camp_1' }), { status: 200 });
	// Adset step
	if (url.includes('/adsets')) return new Response(JSON.stringify({ id: 'adset_1' }), { status: 200 });
	// Creative step
	if (url.includes('/adcreatives')) return new Response(JSON.stringify({ id: 'creative_1' }), { status: 200 });
	// Ad step
	if (url.includes('/ads')) return new Response(JSON.stringify({ id: 'ad_1' }), { status: 200 });
	return new Response('{}', { status: 200 });
}) as typeof fetch;

mock.module('$lib/server/db', () => ({
	db: {
		select: () => ({
			from: () => ({
				where: () => ({
					limit: () =>
						Promise.resolve([
							{
								id: 'crm-1',
								buildStep: 'none',
								buildAttempts: 0,
								externalCampaignId: null,
								externalAdsetId: null,
								externalCreativeId: null,
								externalAdId: null
							}
						])
				})
			})
		}),
		update: () => ({
			set: () => ({
				where: () => Promise.resolve()
			})
		}),
		insert: () => ({
			values: () => Promise.resolve()
		})
	}
}));

const fieldProxy = new Proxy({}, { get: (_t, p) => (typeof p === 'symbol' ? undefined : p) });
mock.module('$lib/server/db/schema', () => ({
	campaign: fieldProxy,
	campaignAudit: fieldProxy,
	metaAdsIntegration: fieldProxy,
	adOptimizationRecommendation: fieldProxy
}));

mock.module('drizzle-orm', () => ({ eq: () => ({}) }));

mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logWarning: () => {},
	logError: () => {}
}));

mock.module('$env/dynamic/private', () => ({
	env: { SQLITE_URI: 'file::memory:', META_APP_SECRET: 'sec' }
}));

mock.module('$lib/server/meta-ads/client', () => ({
	META_GRAPH_URL: 'https://graph.facebook.com/v25.0'
}));

const SPEC = {
	adAccountId: 'act_123',
	name: 'Test Campaign',
	objective: 'OUTCOME_TRAFFIC',
	budget: { type: 'daily' as const, cents: 1000 },
	optimizationGoal: 'LINK_CLICKS',
	audience: { geoCountries: ['RO'] },
	creative: { pageId: '999', linkUrl: 'https://example.com', body: 'test', title: 'test' }
};

describe('Option B — adset + ad created ACTIVE, campaign PAUSED', () => {
	beforeEach(() => {
		fetchCalls.length = 0;
	});

	it('creates campaign PAUSED, adset ACTIVE, ad ACTIVE', async () => {
		const { buildMetaCampaign } = await import('../../campaign-create');
		await buildMetaCampaign({ campaignId: 'crm-1', spec: SPEC, accessToken: 'tok', appSecret: 'sec' });

		const campaignCall = fetchCalls.find((c) => c.url.includes('/campaigns'));
		const adsetCall = fetchCalls.find((c) => c.url.includes('/adsets'));
		const adCall = fetchCalls.find(
			(c) => c.url.includes('/ads') && !c.url.includes('/adsets') && !c.url.includes('/adcreatives')
		);

		expect(campaignCall?.body.get('status')).toBe('PAUSED');
		expect(adsetCall?.body.get('status')).toBe('ACTIVE');
		expect(adCall?.body.get('status')).toBe('ACTIVE');
	});
});
