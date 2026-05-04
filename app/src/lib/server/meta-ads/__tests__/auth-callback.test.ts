import { describe, it, expect, mock, beforeEach } from 'bun:test';

const dbUpdates: Record<string, unknown>[] = [];

mock.module('$lib/server/db', () => {
	const updateChain = {
		set: (fields: Record<string, unknown>) => {
			dbUpdates.push(fields);
			return updateChain;
		},
		where: () => Promise.resolve(),
	};
	return {
		db: {
			update: () => updateChain,
		},
	};
});

mock.module('$lib/server/db/schema', () => ({
	metaAdsIntegration: new Proxy({}, { get: (_t, p) => p }),
}));

mock.module('drizzle-orm', () => ({
	eq: () => ({}),
	and: () => ({}),
}));

mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logWarning: () => {},
	logError: () => {},
}));

mock.module('$env/dynamic/private', () => ({
	env: {
		META_APP_ID: 'meta-app-id',
		META_APP_SECRET: 'meta-app-secret',
		META_REDIRECT_URI: 'https://app.example.com/api/meta-ads/callback',
	},
}));

// Mock fetch globally for this test
const originalFetch = globalThis.fetch;

describe('meta-ads handleCallback', () => {
	beforeEach(() => {
		dbUpdates.length = 0;
		// Mock fetch for Meta API calls
		globalThis.fetch = (async (url: string | URL | Request): Promise<Response> => {
			const urlStr = url.toString();
			if (urlStr.includes('/oauth/access_token') && urlStr.includes('code=')) {
				return new Response(JSON.stringify({ access_token: 'short-lived-token' }), { status: 200 });
			}
			if (urlStr.includes('/oauth/access_token') && urlStr.includes('fb_exchange_token')) {
				return new Response(JSON.stringify({ access_token: 'long-lived-token', expires_in: 5184000 }), { status: 200 });
			}
			if (urlStr.includes('/me?fields=')) {
				return new Response(JSON.stringify({ email: 'meta@example.com', name: 'Test User' }), { status: 200 });
			}
			return new Response(JSON.stringify({}), { status: 200 });
		}) as typeof fetch;
	});

	it('resets consecutiveRefreshFailures and lastRefreshError on successful reconnect', async () => {
		const { handleCallback } = await import('../auth');
		const result = await handleCallback('auth-code', 'test-tenant', 'integration-id-1');

		expect(result.email).toBe('meta@example.com');

		const update = dbUpdates.find(
			(u) => 'consecutiveRefreshFailures' in u || 'lastRefreshError' in u
		);
		expect(update).toBeDefined();
		expect(update!.consecutiveRefreshFailures).toBe(0);
		expect(update!.lastRefreshError).toBeNull();
		expect(update!.isActive).toBe(true);
	});
});
