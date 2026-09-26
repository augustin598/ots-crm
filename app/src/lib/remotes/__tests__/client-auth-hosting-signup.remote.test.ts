import { describe, test, expect, mock, beforeEach } from 'bun:test';

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$env/dynamic/public', () => ({ env: {} }));
mock.module('$env/static/public', () => ({}));

// ─── Request context ──────────────────────────────────────────────────────────
mock.module('$app/server', () => ({
	query: (schemaOrFn: unknown, fn?: unknown) => fn ?? schemaOrFn,
	command: (schemaOrFn: unknown, fn?: unknown) => fn ?? schemaOrFn,
	getRequestEvent: () => ({
		getClientAddress: () => '10.0.0.7',
		request: { headers: new Headers() },
		locals: {}
	})
}));

// ─── DB: doar căutarea tenantului după slug ───────────────────────────────────
let tenantRows: Array<{ id: string; slug: string }> = [{ id: 't1', slug: 'ots' }];
mock.module('$lib/server/db', () => ({
	db: {
		select: () => ({ from: () => ({ where: () => ({ limit: async () => tenantRows }) }) })
	}
}));
await import('$lib/server/db/schema');

// ─── Restul dependențelor modulului remote (neatinse de hostingSignup) ─────────
mock.module('$lib/server/email', () => ({ sendMagicLinkEmail: async () => {} }));
mock.module('$lib/server/client-auth', () => ({ verifyMagicLinkToken: async () => ({}) }));
mock.module('$lib/server/logger', () => ({ logInfo: () => {}, logError: () => {}, logWarning: () => {} }));
mock.module('$lib/server/get-actor', () => ({ requireStaff: async () => {} }));
mock.module('$lib/server/app-url', () => ({ getAppBaseUrl: () => 'http://localhost:5173' }));

let rateLimited = false;
mock.module('$lib/server/rate-limiter', () => ({
	checkAuthRateLimit: () => (rateLimited ? 'Prea multe încercări.' : null)
}));

// ─── Helper-ele de signup: capturăm apelurile ────────────────────────────────
const calls: { create: unknown[]; link: unknown[][] } = { create: [], link: [] };
let createThrows = false;
let linkThrows = false;
mock.module('$lib/server/portal-signup', () => ({
	HostingSignupSchema: {},
	findOrCreateHostingSignupClient: async (input: { name: string }) => {
		if (createThrows) throw new Error('SQLITE_BUSY');
		calls.create.push(input);
		return { clients: [{ id: 'c1', name: input.name }], created: true };
	},
	issueMagicLink: async (...args: unknown[]) => {
		if (linkThrows) throw new Error('smtp down');
		calls.link.push(args);
	}
}));

const { hostingSignup } = await import('../client-auth.remote');

const INPUT = {
	tenantSlug: 'ots',
	name: 'Ion Popescu',
	email: 'ion.popescu@firma.ro',
	phone: '0722 123 456',
	consentTerms: true as const
};

beforeEach(() => {
	tenantRows = [{ id: 't1', slug: 'ots' }];
	rateLimited = false;
	createThrows = false;
	linkThrows = false;
	calls.create = [];
	calls.link = [];
});

describe('hostingSignup', () => {
	test('creează clientul în tenantul slug-ului și trimite magic link-ul', async () => {
		const r = await hostingSignup(INPUT);
		expect(r).toEqual({ success: true, message: expect.any(String) });
		expect(calls.create).toEqual([
			{ tenantId: 't1', name: 'Ion Popescu', email: 'ion.popescu@firma.ro', phone: '0722 123 456' }
		]);
		expect(calls.link).toEqual([
			[{ id: 't1', slug: 'ots' }, 'ion.popescu@firma.ro', [{ id: 'c1', name: 'Ion Popescu' }]]
		]);
	});

	test('fără telefon → phone: null', async () => {
		const { phone: _p, ...noPhone } = INPUT;
		await hostingSignup(noPhone);
		expect((calls.create[0] as { phone: unknown }).phone).toBeNull();
	});

	test('rate limit → același răspuns, fără client și fără email', async () => {
		rateLimited = true;
		const r = await hostingSignup(INPUT);
		expect(r.success).toBe(true);
		expect(calls.create).toHaveLength(0);
		expect(calls.link).toHaveLength(0);
	});

	test('tenant inexistent → același răspuns, fără client și fără email', async () => {
		tenantRows = [];
		const r = await hostingSignup({ ...INPUT, tenantSlug: 'nu-exista' });
		expect(r.success).toBe(true);
		expect(calls.create).toHaveLength(0);
	});

	test('emailul pică → tot răspuns generic, fără excepție', async () => {
		linkThrows = true;
		const r = await hostingSignup(INPUT);
		expect(r.success).toBe(true);
		expect(calls.create).toHaveLength(1);
	});

	test('baza pică → tot răspuns generic, fără excepție', async () => {
		createThrows = true;
		const r = await hostingSignup(INPUT);
		expect(r.success).toBe(true);
		expect(calls.link).toHaveLength(0);
	});
});
