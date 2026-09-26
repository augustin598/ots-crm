import { describe, test, expect, mock, beforeEach } from 'bun:test';

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));

// ─── DB fals ──────────────────────────────────────────────────────────────────
// `selectResults` e coada de rezultate pentru select-urile în ordinea apelării;
// insert-urile se capturează în `inserted`.
let selectResults: unknown[][] = [];
let inserted: Record<string, unknown>[] = [];
let insertThrows: Error | null = null;
let updated: Record<string, unknown>[] = [];

const chain = (rows: unknown[]) => {
	const c: Record<string, unknown> = {};
	for (const m of ['from', 'where', 'limit', 'innerJoin', 'orderBy']) c[m] = () => c;
	c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
		Promise.resolve(rows).then(res, rej);
	return c;
};

mock.module('$lib/server/db', () => ({
	db: {
		select: () => chain(selectResults.shift() ?? []),
		insert: () => ({
			values: (row: Record<string, unknown>) => {
				if (insertThrows) throw insertThrows;
				inserted.push(row);
				return { returning: async () => [row] };
			}
		}),
		update: () => ({
			set: (patch: Record<string, unknown>) => ({
				where: async () => {
					updated.push(patch);
					return {};
				}
			})
		})
	}
}));
await import('$lib/server/db/schema');

// Emailul și token-urile: nu ne interesează aici decât că se apelează corect.
const sent: unknown[][] = [];
mock.module('$lib/server/email', () => ({
	sendMagicLinkEmail: async (...args: unknown[]) => {
		sent.push(args);
	}
}));
mock.module('$lib/server/client-auth', () => ({
	generateMagicLinkToken: () => 'token-in-clar',
	hashToken: (t: string) => `hash:${t}`
}));

const {
	HostingSignupSchema,
	findClientIdsForEmail,
	findOrCreateHostingSignupClient,
	resolvePortalClientForUser,
	issueMagicLink
} = await import('../portal-signup');
const v = await import('valibot');

describe('HostingSignupSchema', () => {
	const ok = {
		tenantSlug: 'ots',
		name: '  Ion Popescu ',
		email: ' Ion.Popescu@Firma.RO ',
		phone: ' 0722 123 456 ',
		consentTerms: true as const
	};

	test('input valid: normalizează nume/email/telefon', () => {
		const r = v.safeParse(HostingSignupSchema, ok);
		expect(r.success).toBe(true);
		if (r.success) {
			expect(r.output).toEqual({
				tenantSlug: 'ots',
				name: 'Ion Popescu',
				email: 'ion.popescu@firma.ro',
				phone: '0722 123 456',
				consentTerms: true
			});
		}
	});

	test('telefonul e opțional', () => {
		const { phone: _p, ...noPhone } = ok;
		expect(v.safeParse(HostingSignupSchema, noPhone).success).toBe(true);
	});

	test('fără acceptarea termenilor → respins', () => {
		expect(v.safeParse(HostingSignupSchema, { ...ok, consentTerms: false }).success).toBe(false);
	});

	test('nume prea scurt, email invalid, tenant lipsă → respinse', () => {
		expect(v.safeParse(HostingSignupSchema, { ...ok, name: 'Io' }).success).toBe(false);
		expect(v.safeParse(HostingSignupSchema, { ...ok, email: 'nu-e-email' }).success).toBe(false);
		expect(v.safeParse(HostingSignupSchema, { ...ok, tenantSlug: '' }).success).toBe(false);
	});
});

beforeEach(() => {
	selectResults = [];
	inserted = [];
	updated = [];
	insertThrows = null;
	sent.length = 0;
});

describe('findClientIdsForEmail', () => {
	test('unește potrivirile pe email primar și secundar, fără dubluri', async () => {
		selectResults = [
			[{ id: 'c1', name: 'Helen’s SRL' }],
			[
				{ id: 'c1', name: 'Helen’s SRL' },
				{ id: 'c2', name: 'Monte Pizza SRL' }
			]
		];
		const r = await findClientIdsForEmail('t1', 'Management@CasaElena.ro');
		expect(r.map((c) => c.id)).toEqual(['c1', 'c2']);
	});

	test('fără potriviri → listă goală', async () => {
		selectResults = [[], []];
		expect(await findClientIdsForEmail('t1', 'nimeni@exemplu.ro')).toEqual([]);
	});
});

describe('findOrCreateHostingSignupClient', () => {
	test('client nou: prospect, hosting-signup, scope hosting, email normalizat, fără CUI', async () => {
		selectResults = [[], []];
		const r = await findOrCreateHostingSignupClient({
			tenantId: 't1',
			name: '  Ion Popescu ',
			email: 'Ion.Popescu@Firma.RO',
			phone: '0722 123 456'
		});
		expect(r.created).toBe(true);
		expect(r.clients).toHaveLength(1);
		expect(inserted).toHaveLength(1);
		expect(inserted[0]).toMatchObject({
			tenantId: 't1',
			name: 'Ion Popescu',
			businessName: null,
			email: 'ion.popescu@firma.ro',
			phone: '0722 123 456',
			status: 'prospect',
			cui: null,
			vatNumber: null,
			legalType: null,
			country: 'RO',
			signupSource: 'hosting-signup',
			onboardingStatus: 'pending_email',
			portalScope: 'hosting'
		});
		expect(typeof inserted[0].id).toBe('string');
	});

	test('emailul e deja verificat (Google) → onboarding direct activ', async () => {
		selectResults = [[], []];
		await findOrCreateHostingSignupClient({
			tenantId: 't1',
			name: 'Ana Ionescu',
			email: 'ana@gmail.com',
			phone: null,
			emailVerified: true
		});
		expect(inserted[0]).toMatchObject({ onboardingStatus: 'active', portalScope: 'hosting' });
	});

	test('telefon gol → null, nu șir gol', async () => {
		selectResults = [[], []];
		await findOrCreateHostingSignupClient({ tenantId: 't1', name: 'Ana Ionescu', email: 'ana@x.ro', phone: '' });
		expect(inserted[0].phone).toBeNull();
	});

	test('email deja client → nu inserează nimic, întoarce clientul existent', async () => {
		selectResults = [[{ id: 'c9', name: 'Helen’s SRL' }], []];
		const r = await findOrCreateHostingSignupClient({
			tenantId: 't1',
			name: 'Alexandru Horga',
			email: 'management@casaelena.ro',
			phone: null
		});
		expect(r.created).toBe(false);
		expect(r.clients.map((c) => c.id)).toEqual(['c9']);
		expect(inserted).toHaveLength(0);
	});

	test('cursă pe UNIQUE(email): re-citește și întoarce rândul câștigător', async () => {
		selectResults = [[], [], [{ id: 'c7', name: 'Ion Popescu' }], []];
		insertThrows = new Error('UNIQUE constraint failed: client.tenant_id, client.email');
		const r = await findOrCreateHostingSignupClient({
			tenantId: 't1',
			name: 'Ion Popescu',
			email: 'ion@firma.ro',
			phone: null
		});
		expect(r.created).toBe(false);
		expect(r.clients[0].id).toBe('c7');
	});

	test('altă eroare la insert se propagă', async () => {
		selectResults = [[], []];
		insertThrows = new Error('SQLITE_BUSY');
		await expect(
			findOrCreateHostingSignupClient({ tenantId: 't1', name: 'Ion Popescu', email: 'ion@firma.ro', phone: null })
		).rejects.toThrow('SQLITE_BUSY');
	});
});

describe('resolvePortalClientForUser', () => {
	test('întoarce clientul activ al userului sau null', async () => {
		selectResults = [[{ id: 'c1', name: 'Helen’s SRL', email: 'management@casaelena.ro', portalScope: 'hosting' }]];
		expect(await resolvePortalClientForUser('t1', 'u1')).toMatchObject({ id: 'c1', portalScope: 'hosting' });
		selectResults = [[]];
		expect(await resolvePortalClientForUser('t1', 'u1')).toBeNull();
	});
});

describe('issueMagicLink', () => {
	test('invalidează token-urile vechi, inserează unul nou cu toate id-urile și trimite emailul', async () => {
		await issueMagicLink({ id: 't1', slug: 'ots' }, 'Ion@Firma.ro', [
			{ id: 'c1', name: 'Ion Popescu' },
			{ id: 'c2', name: 'Firma SRL' }
		]);
		expect(updated).toHaveLength(1);
		expect(updated[0]).toMatchObject({ used: true });
		expect(inserted).toHaveLength(1);
		expect(inserted[0]).toMatchObject({
			token: 'hash:token-in-clar',
			email: 'ion@firma.ro',
			clientId: 'c1',
			tenantId: 't1',
			used: false
		});
		expect(JSON.parse(inserted[0].matchedClientIds as string)).toEqual(['c1', 'c2']);
		expect((inserted[0].expiresAt as Date).getTime()).toBeGreaterThan(Date.now() + 23 * 3600 * 1000);
		expect(sent).toHaveLength(1);
		expect(sent[0]).toEqual(['ion@firma.ro', 'token-in-clar', 'ots', 'Ion Popescu']);
	});
});
