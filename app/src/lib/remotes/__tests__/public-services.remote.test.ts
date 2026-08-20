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

const { submitPublicPackageRequest } = await import('../public-services.remote');

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
