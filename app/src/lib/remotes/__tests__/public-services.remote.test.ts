import { describe, test, expect, mock, beforeEach } from 'bun:test';

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$env/dynamic/public', () => ({ env: {} }));
mock.module('$env/static/public', () => ({}));

// ─── Request context ──────────────────────────────────────────────────────────
mock.module('$app/server', () => ({
	query: (schemaOrFn: any, fn?: Function) => fn ?? schemaOrFn,
	command: (schemaOrFn: any, fn?: Function) => fn ?? schemaOrFn,
	getRequestEvent: () => ({
		getClientAddress: () => '10.0.0.7',
		request: { headers: new Headers() }
	})
}));

// ─── DB: capturăm ce s-ar insera ──────────────────────────────────────────────
let insertedRows: any[] = [];
let insertShouldThrow = false;
mock.module('$lib/server/db', () => ({
	db: {
		insert: () => ({
			values: async (row: any) => {
				if (insertShouldThrow) throw new Error('SQLITE_BUSY');
				insertedRows.push(row);
				return [];
			}
		})
	}
}));
await import('$lib/server/db/schema');

mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logError: () => {},
	logWarning: () => {},
	serializeError: (e: unknown) => ({
		message: e instanceof Error ? e.message : String(e),
		stack: ''
	})
}));

// ─── Poarta cu parolă ─────────────────────────────────────────────────────────
let gate: { tenantId: string; row: any } | null = { tenantId: 't1', row: { enabled: true } };
mock.module('$lib/server/public-page-access', () => ({
	PUBLIC_SERVICES_PAGE_KEY: 'services',
	requireUnlockedPublicPage: async () => gate
}));

// ─── Rate limit ───────────────────────────────────────────────────────────────
let rateLimitAllowed = true;
const rateLimitCalls: Array<{ kind: string; ip: string }> = [];
mock.module('$lib/server/redis', () => ({
	rateLimit: async ({ kind, ip }: { kind: string; ip: string }) => {
		rateLimitCalls.push({ kind, ip });
		return { allowed: rateLimitAllowed, count: 1, limit: 8 };
	}
}));

// ─── Notificare admini ────────────────────────────────────────────────────────
const notified: Array<{ tenantId: string; requestId: string }> = [];
mock.module('$lib/server/package-requests', () => ({
	notifyAdminsOfPackageRequestInBackground: (tenantId: string, requestId: string) => {
		notified.push({ tenantId, requestId });
	}
}));

const { submitPublicPackageRequest, submitPublicQuoteRequest } = await import(
	'../public-services.remote'
);

const INPUT = {
	categorySlug: 'seo',
	tier: 'silver' as const,
	contactName: 'Ion Popescu',
	contactEmail: 'Ion.Popescu@Example.COM',
	contactPhone: '0722 123 456',
	companyName: 'Example SRL',
	note: 'Vrem lead-uri pe zona Suceava.'
};

beforeEach(() => {
	insertedRows = [];
	insertShouldThrow = false;
	gate = { tenantId: 't1', row: { enabled: true } };
	rateLimitAllowed = true;
	rateLimitCalls.length = 0;
	notified.length = 0;
});

describe('submitPublicPackageRequest — autorizare', () => {
	test('fără cookie de deblocare validă → refuz, fără scriere în DB', async () => {
		gate = null;
		await expect(submitPublicPackageRequest(INPUT)).rejects.toThrow();
		expect(insertedRows).toHaveLength(0);
		expect(notified).toHaveLength(0);
	});

	test('peste limita de cereri pe IP → refuz, fără scriere în DB', async () => {
		rateLimitAllowed = false;
		await expect(submitPublicPackageRequest(INPUT)).rejects.toThrow();
		expect(insertedRows).toHaveLength(0);
	});

	test('rate limit-ul folosește IP-ul requestului', async () => {
		await submitPublicPackageRequest(INPUT);
		expect(rateLimitCalls).toHaveLength(1);
		expect(rateLimitCalls[0]).toEqual({ kind: 'public-services-request', ip: '10.0.0.7' });
	});

	test('categorie inexistentă → refuz (nu ne bazăm pe payload)', async () => {
		await expect(
			submitPublicPackageRequest({ ...INPUT, categorySlug: 'nu-exista-asa-ceva' })
		).rejects.toThrow();
		expect(insertedRows).toHaveLength(0);
	});
});

describe('submitPublicPackageRequest — scrierea cererii', () => {
	test('salvează cererea fără client și marcată ca publică', async () => {
		const result = await submitPublicPackageRequest(INPUT);

		expect(result.success).toBe(true);
		expect(insertedRows).toHaveLength(1);

		const row = insertedRows[0];
		expect(row.tenantId).toBe('t1');
		expect(row.source).toBe('public');
		expect(row.status).toBe('pending');
		// O cerere publică NU se leagă singură de un client existent.
		expect(row.clientId).toBeNull();
		expect(row.clientUserId).toBeNull();
		expect(row.id).toBe(result.requestId);
	});

	test('normalizează emailul și păstrează restul datelor de contact', async () => {
		await submitPublicPackageRequest(INPUT);
		const row = insertedRows[0];
		expect(row.contactEmail).toBe('ion.popescu@example.com');
		expect(row.contactName).toBe('Ion Popescu');
		expect(row.contactPhone).toBe('0722 123 456');
		expect(row.companyName).toBe('Example SRL');
		expect(row.note).toBe('Vrem lead-uri pe zona Suceava.');
	});

	test('câmpurile opționale goale devin null, nu string gol', async () => {
		await submitPublicPackageRequest({
			categorySlug: 'seo',
			tier: 'bronze',
			contactName: 'Maria T',
			contactEmail: 'maria@example.com'
		});
		const row = insertedRows[0];
		expect(row.contactPhone).toBeNull();
		expect(row.companyName).toBeNull();
		expect(row.note).toBeNull();
	});

	test('tenantul vine din poartă, nu din payload', async () => {
		gate = { tenantId: 'tenant-real', row: { enabled: true } };
		await submitPublicPackageRequest({ ...INPUT, tenantId: 'tenant-fals' } as never);
		expect(insertedRows[0].tenantId).toBe('tenant-real');
	});

	test('notifică echipa după salvare', async () => {
		const result = await submitPublicPackageRequest(INPUT);
		expect(notified).toEqual([{ tenantId: 't1', requestId: result.requestId }]);
	});

	test('dacă INSERT-ul pică, nu trimitem notificare', async () => {
		insertShouldThrow = true;
		await expect(submitPublicPackageRequest(INPUT)).rejects.toThrow();
		expect(notified).toHaveLength(0);
	});
});

// ─── submitPublicQuoteRequest (coș multi-serviciu) ────────────────────────────
const QUOTE_INPUT = {
	items: [
		{ categorySlug: 'google-ads', tier: 'gold' as const },
		{ categorySlug: 'seo', tier: 'bronze' as const }
	],
	contactName: 'Maria Ionescu',
	contactEmail: 'Maria@Example.RO',
	contactPhone: '0733 000 111',
	companyName: 'Maria SRL',
	note: 'Vrem să pornim în septembrie.'
};

describe('submitPublicQuoteRequest', () => {
	test('scrie UN rând cu pivot, services, items (snapshot preț) și discount', async () => {
		const result = await submitPublicQuoteRequest(QUOTE_INPUT);

		expect(result.success).toBe(true);
		expect(insertedRows).toHaveLength(1);
		const row = insertedRows[0];

		expect(row.id).toBe(result.requestId);
		expect(row.tenantId).toBe('t1');
		expect(row.clientId).toBeNull();
		expect(row.clientUserId).toBeNull();
		expect(row.source).toBe('public');
		expect(row.status).toBe('pending');
		// Pivotul = primul serviciu, ca admin/email/portal să poată citi rândul ca până acum.
		expect(row.categorySlug).toBe('google-ads');
		expect(row.tier).toBe('gold');
		expect(row.bundleId).toBeNull();
		expect(JSON.parse(row.services)).toEqual(['google-ads', 'seo']);

		const items = JSON.parse(row.items);
		expect(items).toHaveLength(2);
		expect(items[0]).toMatchObject({ categorySlug: 'google-ads', tier: 'gold' });
		expect(items[1]).toMatchObject({ categorySlug: 'seo', tier: 'bronze' });
		// Snapshot de preț: numere (sau null pentru setup-only), niciodată undefined.
		expect(typeof items[0].monthlyEur).toBe('number');
		expect('setupEur' in items[0]).toBe(true);
		// 2 servicii → regula de 10 % din catalog.
		expect(row.discountPct).toBe(10);

		expect(row.contactEmail).toBe('maria@example.ro');
		expect(row.contactName).toBe('Maria Ionescu');
		expect(row.contactPhone).toBe('0733 000 111');
		expect(row.companyName).toBe('Maria SRL');
		expect(row.note).toBe('Vrem să pornim în septembrie.');
		expect(notified).toEqual([{ tenantId: 't1', requestId: result.requestId }]);
	});

	test('un singur serviciu → services tot JSON, discount 0', async () => {
		await submitPublicQuoteRequest({ ...QUOTE_INPUT, items: [QUOTE_INPUT.items[1]] });
		const row = insertedRows[0];
		expect(JSON.parse(row.services)).toEqual(['seo']);
		expect(row.discountPct).toBe(0);
		expect(row.categorySlug).toBe('seo');
		expect(row.tier).toBe('bronze');
	});

	test('câmpurile opționale goale devin null', async () => {
		await submitPublicQuoteRequest({
			items: QUOTE_INPUT.items,
			contactName: 'Maria T',
			contactEmail: 'maria@example.com'
		});
		const row = insertedRows[0];
		expect(row.contactPhone).toBeNull();
		expect(row.companyName).toBeNull();
		expect(row.note).toBeNull();
	});

	test('slug necunoscut → 400, nimic inserat', async () => {
		await expect(
			submitPublicQuoteRequest({
				...QUOTE_INPUT,
				items: [{ categorySlug: 'nu-exista', tier: 'gold' }]
			})
		).rejects.toMatchObject({ status: 400 });
		expect(insertedRows).toHaveLength(0);
	});

	test('același serviciu de două ori → 400', async () => {
		await expect(
			submitPublicQuoteRequest({
				...QUOTE_INPUT,
				items: [
					{ categorySlug: 'seo', tier: 'gold' },
					{ categorySlug: 'seo', tier: 'bronze' }
				]
			})
		).rejects.toMatchObject({ status: 400 });
		expect(insertedRows).toHaveLength(0);
	});

	test('tier neoferit pentru categorie (fără preț și fără setup) → 400', async () => {
		// Găsim din catalogul real o combinație (slug, tier) fără preț lunar și fără setup.
		const { CATEGORIES, TIERS } = await import('$lib/constants/ots-catalog');
		let combo: { categorySlug: string; tier: (typeof TIERS)[number] } | null = null;
		for (const c of CATEGORIES) {
			for (const t of TIERS) {
				if (c.prices[t] === null && c.setupFees?.[t] === undefined) {
					combo = { categorySlug: c.slug, tier: t };
					break;
				}
			}
			if (combo) break;
		}
		if (!combo) return; // catalogul nu are o astfel de combinație; nimic de verificat
		await expect(
			submitPublicQuoteRequest({ ...QUOTE_INPUT, items: [combo] })
		).rejects.toMatchObject({ status: 400 });
		expect(insertedRows).toHaveLength(0);
	});

	test('tenantul vine din poartă, nu din payload', async () => {
		gate = { tenantId: 'tenant-real', row: { enabled: true } };
		await submitPublicQuoteRequest({ ...QUOTE_INPUT, tenantId: 'tenant-fals' } as never);
		expect(insertedRows[0].tenantId).toBe('tenant-real');
	});

	test('poarta închisă → 403', async () => {
		gate = null;
		await expect(submitPublicQuoteRequest(QUOTE_INPUT)).rejects.toMatchObject({ status: 403 });
		expect(insertedRows).toHaveLength(0);
	});

	test('rate limit depășit → 429, aceeași găleată ca formularul simplu', async () => {
		rateLimitAllowed = false;
		await expect(submitPublicQuoteRequest(QUOTE_INPUT)).rejects.toMatchObject({ status: 429 });
		expect(rateLimitCalls[0]).toEqual({ kind: 'public-services-request', ip: '10.0.0.7' });
		expect(insertedRows).toHaveLength(0);
	});

	test('INSERT eșuat → 500, fără notificare', async () => {
		insertShouldThrow = true;
		await expect(submitPublicQuoteRequest(QUOTE_INPUT)).rejects.toMatchObject({ status: 500 });
		expect(notified).toHaveLength(0);
	});
});
