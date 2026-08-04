import { describe, it, expect, mock, beforeEach } from 'bun:test';

const dbUpdates: Record<string, unknown>[] = [];

const mockExistingIntegration = {
	id: 'gmail-integration-1',
	tenantId: 'test-tenant',
	email: 'old@example.com',
	isActive: false,
	consecutiveRefreshFailures: 3,
	lastRefreshError: 'Token has been expired or revoked',
	accessTokenEncrypted: null,
	refreshTokenEncrypted: null,
	accessToken: 'old-at',
	refreshToken: 'old-rt',
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
	gmailIntegration: new Proxy({}, { get: (_t, p) => p }),
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

mock.module('$lib/server/plugins/smartbill/crypto', () => ({
	encryptVerified: (_tenantId: string, value: string) => `enc:${value}`,
	decrypt: (_tenantId: string, value: string) => value.replace('enc:', ''),
}));

mock.module('googleapis', () => {
	const fakeAuth = {
		OAuth2: class {
			setCredentials() {}
			async getToken() {
				return {
					tokens: {
						access_token: 'new-access-token',
						refresh_token: 'new-refresh-token',
						expiry_date: Date.now() + 3600_000,
						scope: 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly',
					},
				};
			}
		},
	};
	return {
		google: {
			auth: fakeAuth,
			gmail: () => ({
				users: {
					getProfile: async () => ({ data: { emailAddress: 'new@example.com' } }),
				},
			}),
		},
	};
});

mock.module('$env/dynamic/private', () => ({
	env: {
		GOOGLE_CLIENT_ID: 'cid',
		GOOGLE_CLIENT_SECRET: 'csecret',
		GOOGLE_REDIRECT_URI: 'https://app.example.com/api/gmail/callback',
	},
}));

mock.module('$lib/server/email', () => ({
	clearTenantTransporterCache: () => {},
}));

describe('gmail handleCallback', () => {
	beforeEach(() => {
		dbUpdates.length = 0;
	});

	it('resets consecutiveRefreshFailures and lastRefreshError on successful reconnect', async () => {
		const { handleCallback } = await import('../auth');
		const result = await handleCallback('auth-code', 'test-tenant');

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
