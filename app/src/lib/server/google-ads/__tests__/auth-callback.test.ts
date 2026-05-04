import { describe, it, expect, mock, beforeEach } from 'bun:test';

// Captured DB updates
const dbUpdates: Record<string, unknown>[] = [];

const mockExistingIntegration = {
	id: 'gads-integration-1',
	tenantId: 'test-tenant',
	email: 'old@example.com',
	isActive: false,
	consecutiveRefreshFailures: 5,
	lastRefreshError: 'invalid_grant from previous cycle',
};

mock.module('$lib/server/db', () => {
	const selectChain = {
		from: () => selectChain,
		where: () => selectChain,
		limit: async () => [mockExistingIntegration],
	};
	const updateChain = {
		set: (fields: Record<string, unknown>) => {
			dbUpdates.push(fields);
			return updateChain;
		},
		where: () => Promise.resolve(),
	};
	return {
		db: {
			select: () => selectChain,
			update: () => updateChain,
			insert: () => ({ values: () => Promise.resolve() }),
		},
	};
});

mock.module('$lib/server/db/schema', () => ({
	googleAdsIntegration: new Proxy({}, { get: (_t, p) => p }),
}));

mock.module('drizzle-orm', () => ({
	eq: () => ({}),
	and: () => ({}),
}));

mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logWarning: () => {},
	logError: () => {},
	serializeError: (e: unknown) => String(e),
}));

// Mock googleapis
mock.module('googleapis', () => {
	const fakeAuth = {
		OAuth2: class {
			generateAuthUrl() { return 'https://accounts.google.com/...'; }
			setCredentials() {}
			async getToken() {
				return {
					tokens: {
						access_token: 'new-access-token',
						refresh_token: 'new-refresh-token',
						expiry_date: Date.now() + 3600_000,
					},
				};
			}
		},
	};
	return {
		google: {
			auth: fakeAuth,
			oauth2: () => ({
				userinfo: {
					get: async () => ({ data: { email: 'new@example.com' } }),
				},
			}),
		},
	};
});

mock.module('$env/dynamic/private', () => ({
	env: {
		GOOGLE_CLIENT_ID: 'cid',
		GOOGLE_CLIENT_SECRET: 'csecret',
		GOOGLE_ADS_REDIRECT_URI: 'https://app.example.com/api/google-ads/callback',
	},
}));

describe('google-ads handleCallback', () => {
	beforeEach(() => {
		dbUpdates.length = 0;
	});

	it('resets consecutiveRefreshFailures and lastRefreshError on successful reconnect', async () => {
		const { handleCallback } = await import('../auth');
		const result = await handleCallback(
			'auth-code',
			'test-tenant',
			'mcc-123',
			'dev-token',
			'https://app.example.com'
		);

		expect(result.email).toBe('new@example.com');

		const update = dbUpdates.find(
			(u) => 'consecutiveRefreshFailures' in u || 'lastRefreshError' in u
		);
		expect(update).toBeDefined();
		expect(update!.consecutiveRefreshFailures).toBe(0);
		expect(update!.lastRefreshError).toBeNull();
		expect(update!.isActive).toBe(true);
	});
});
