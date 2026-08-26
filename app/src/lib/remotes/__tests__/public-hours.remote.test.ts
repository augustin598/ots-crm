import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { getTableName } from 'drizzle-orm';

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
		request: { headers: new Headers({ 'user-agent': 'bun-test' }) }
	})
}));

// ─── Garda partajată (poartă + rate-limit) ───────────────────────────────────
let guardError: { status: number } | null = null;
mock.module('$lib/server/public-services-guard', () => ({
	guardPublicServicesSubmission: async () => {
		if (guardError) throw guardError;
		return { tenantId: 't1', ip: '10.0.0.7' };
	}
}));

// ─── DB: select pe tabel, insert/update capturate ────────────────────────────
let existingClients: any[] = [];
let clientLookups = 0;
/** A n-a căutare de client (1 = înainte de insert, 2 = după UNIQUE race). */
let clientLookup: (n: number) => any[] = () => existingClients.slice(0, 1);
let settingsRow: { defaultTaxRate: number } | null = { defaultTaxRate: 21 };
let insertedRows: Array<{ table: string; row: any }> = [];
let updatedRows: Array<{ table: string; row: any }> = [];
let clientInsertShouldThrow: Error | null = null;

mock.module('$lib/server/db', () => ({
	db: {
		select: () => ({
			from: (tbl: any) => ({
				where: () => ({
					limit: async () => {
						if (getTableName(tbl) === 'invoice_settings') return settingsRow ? [settingsRow] : [];
						if (getTableName(tbl) === 'client') {
							clientLookups += 1;
							return clientLookup(clientLookups);
						}
						return [];
					}
				})
			})
		}),
		insert: (tbl: any) => ({
			values: (row: any) => {
				const name = getTableName(tbl);
				const run = async () => {
					if (name === 'client' && clientInsertShouldThrow) throw clientInsertShouldThrow;
					insertedRows.push({ table: name, row });
					return [row];
				};
				// Apelanții fac fie `await db.insert().values()`, fie `.values().returning()`;
				// thenable LENEȘ, ca eșecul să apară pe calea efectiv apelată, nu ca
				// unhandled rejection.
				return {
					then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => run().then(res, rej),
					returning: run
				};
			}
		}),
		update: (tbl: any) => ({
			set: (row: any) => ({
				where: async () => {
					updatedRows.push({ table: getTableName(tbl), row });
				}
			})
		})
	}
}));

mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logError: () => {},
	logWarning: () => {},
	serializeError: (e: unknown) => ({
		message: e instanceof Error ? e.message : String(e),
		stack: ''
	})
}));

mock.module('$lib/server/plugins/keez/db-retry', () => ({
	withTursoBusyRetry: (fn: () => Promise<unknown>) => fn()
}));

// ─── CUI: validare simplă, fără check-digit real ─────────────────────────────
mock.module('$lib/server/cui-validator', () => ({
	validateCuiOrReason: (cui: string) =>
		/^\d{2,10}$/.test(cui.replace(/^RO/i, '')) ? null : 'CUI invalid.',
	normalizeCui: (cui: string) => cui.replace(/\D/g, '')
}));

// ─── Stripe ──────────────────────────────────────────────────────────────────
const createdIntents: any[] = [];
let stripeConfigured = true;
let devTestMode = true;
let stripeCreateShouldThrow = false;
let customerCalls = 0;
mock.module('$lib/server/plugins/stripe/factory', () => ({
	isStripeConfiguredForTenant: async () => stripeConfigured,
	isStripeDevTestMode: () => devTestMode,
	getPublishableKeyForTenant: async () => 'pk_test_x',
	getStripeForTenant: async () => ({
		paymentIntents: {
			create: async (args: any) => {
				if (stripeCreateShouldThrow) throw new Error('Stripe down');
				createdIntents.push(args);
				return { id: 'pi_test_1', client_secret: 'pi_test_1_secret' };
			}
		}
	})
}));
mock.module('$lib/server/stripe/customer', () => ({
	getOrCreateStripeCustomer: async () => {
		customerCalls += 1;
		return 'cus_test_1';
	}
}));

const { createHoursOrder } = await import('../public-hours.remote');

const INPUT = {
	rateSlug: 'development',
	hours: 10,
	billingType: 'company' as const,
	contactName: 'Ion Popescu',
	contactEmail: 'Ion.Popescu@Example.COM',
	contactPhone: '0722 123 456',
	companyName: 'Example SRL',
	cui: 'RO12345678',
	vatPayer: true,
	address: 'Str. Exemplu nr. 1',
	city: 'Suceava',
	county: 'Suceava',
	postalCode: '720001'
};

/** `error()` din SvelteKit aruncă un HttpError care NU extinde Error — verificăm statusul. */
async function expectHttpError(p: Promise<unknown>, status: number): Promise<void> {
	let caught: unknown = null;
	try {
		await p;
	} catch (e) {
		caught = e;
	}
	expect(caught).not.toBeNull();
	expect((caught as { status?: number }).status).toBe(status);
}

function orderRow() {
	return insertedRows.find((r) => r.table === 'service_hours_order')?.row;
}
function clientRow() {
	return insertedRows.find((r) => r.table === 'client')?.row;
}

beforeEach(() => {
	guardError = null;
	existingClients = [];
	clientLookups = 0;
	clientLookup = () => existingClients.slice(0, 1);
	settingsRow = { defaultTaxRate: 21 };
	insertedRows = [];
	updatedRows = [];
	clientInsertShouldThrow = null;
	createdIntents.length = 0;
	stripeConfigured = true;
	devTestMode = true;
	stripeCreateShouldThrow = false;
	customerCalls = 0;
});

describe('createHoursOrder — happy path', () => {
	test('salvează comanda cu snapshot corect și creează PaymentIntent pe BRUT', async () => {
		const res = await createHoursOrder(INPUT);

		expect(res.success).toBe(true);
		expect(res.clientSecret).toBe('pi_test_1_secret');
		expect(res.publishableKey).toBe('pk_test_x');
		expect(res.breakdown).toEqual({ netCents: 65000, vatCents: 13650, grossCents: 78650, vatPercent: 21 });

		const order = orderRow();
		expect(order).toBeDefined();
		expect(order.id).toBe(res.orderId);
		expect(order.tenantId).toBe('t1');
		expect(order.rateSlug).toBe('development');
		expect(order.rateLabel).toBe('Development');
		expect(order.rateEur).toBe(65);
		expect(order.hours).toBe(10);
		expect(order.netCents).toBe(65000);
		expect(order.vatCents).toBe(13650);
		expect(order.grossCents).toBe(78650);
		expect(order.vatPercent).toBe(21);
		expect(order.currency).toBe('EUR');
		expect(order.status).toBe('pending_payment');
		expect(order.contactEmail).toBe('ion.popescu@example.com');
		expect(order.companyName).toBe('Example SRL');
		expect(order.cui).toBe('12345678');
		expect(order.ipAddress).toBe('10.0.0.7');
		expect(order.userAgent).toBe('bun-test');

		const pi = createdIntents[0];
		expect(pi.amount).toBe(78650);
		expect(pi.currency).toBe('eur');
		expect(pi.metadata.crmPurpose).toBe('hours_purchase');
		expect(pi.metadata.crmTenantId).toBe('t1');
		expect(pi.metadata.crmHoursOrderId).toBe(order.id);
		expect(pi.metadata.crmClientId).toBe(order.clientId);
		expect(pi.metadata.crmNetCents).toBe('65000');

		// PI-ul e ștampilat pe comandă pentru trasabilitate.
		const upd = updatedRows.find((u) => u.table === 'service_hours_order');
		expect(upd?.row.stripePaymentIntentId).toBe('pi_test_1');
	});

	test('firmă nouă → client creat cu CUI, vatNumber RO-prefixat și legat de comandă', async () => {
		await createHoursOrder(INPUT);
		const c = clientRow();
		expect(c).toBeDefined();
		expect(c.tenantId).toBe('t1');
		expect(c.cui).toBe('12345678');
		expect(c.vatNumber).toBe('RO12345678');
		expect(c.legalType).toBe('srl');
		expect(c.name).toBe('Example SRL');
		expect(c.signupSource).toBe('public-form');
		expect(c.address).toBe('Str. Exemplu nr. 1');
		expect(c.city).toBe('Suceava');
		expect(orderRow().clientId).toBe(c.id);
	});

	test('client existent FĂRĂ adresă → adresa din formular se completează pe client', async () => {
		existingClients = [{ id: 'client-9', tenantId: 't1', email: 'alt@x.ro', name: 'Example SRL', address: null, city: null }];
		await createHoursOrder(INPUT);
		const upd = updatedRows.find((u) => u.table === 'client');
		expect(upd?.row.address).toBe('Str. Exemplu nr. 1');
		expect(upd?.row.city).toBe('Suceava');
	});

	test('client existent CU adresă → nu i se suprascrie adresa', async () => {
		existingClients = [{ id: 'client-9', tenantId: 't1', email: 'alt@x.ro', name: 'Example SRL', address: 'Adresa veche', city: 'Iași' }];
		await createHoursOrder(INPUT);
		expect(updatedRows.some((u) => u.table === 'client')).toBe(false);
	});

	test('firmă neplătitoare de TVA → vatNumber fără prefix', async () => {
		await createHoursOrder({ ...INPUT, vatPayer: false });
		expect(clientRow().vatNumber).toBe('12345678');
	});

	test('persoană fizică → client pf fără CUI', async () => {
		await createHoursOrder({
			...INPUT,
			billingType: 'person',
			companyName: undefined,
			cui: undefined,
			vatPayer: undefined
		});
		const c = clientRow();
		expect(c.legalType).toBe('pf');
		expect(c.cui).toBeNull();
		expect(c.vatNumber).toBeNull();
		expect(c.name).toBe('Ion Popescu');
		expect(orderRow().billingType).toBe('person');
		expect(orderRow().companyName).toBeNull();
	});

	test('client existent (CUI) → comanda se leagă, fără insert de client nou', async () => {
		existingClients = [{ id: 'client-9', tenantId: 't1', email: 'alt@x.ro', name: 'Example SRL' }];
		await createHoursOrder(INPUT);
		expect(clientRow()).toBeUndefined();
		expect(orderRow().clientId).toBe('client-9');
		expect(createdIntents[0].metadata.crmClientId).toBe('client-9');
	});

	test('UNIQUE race la insert client → se atașează la clientul găsit la re-căutare', async () => {
		clientInsertShouldThrow = new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed: client.email');
		// Prima căutare nu găsește nimic, a doua (după race) găsește.
		clientLookup = (n) => (n >= 2 ? [{ id: 'client-race', tenantId: 't1', email: 'x@y.ro' }] : []);
		await createHoursOrder(INPUT);
		expect(clientRow()).toBeUndefined();
		expect(orderRow().clientId).toBe('client-race');
	});

	test('TVA din setările tenantului lipsă → fallback la cota implicită', async () => {
		settingsRow = null;
		const res = await createHoursOrder(INPUT);
		expect(res.breakdown.vatPercent).toBeGreaterThan(0);
		expect(res.breakdown.grossCents).toBe(res.breakdown.netCents + res.breakdown.vatCents);
	});

	test('în afara dev-test → Stripe Customer creat și atașat', async () => {
		devTestMode = false;
		await createHoursOrder(INPUT);
		expect(customerCalls).toBe(1);
		expect(createdIntents[0].customer).toBe('cus_test_1');
	});

	test('în dev-test → fără Stripe Customer', async () => {
		await createHoursOrder(INPUT);
		expect(customerCalls).toBe(0);
		expect(createdIntents[0].customer).toBeUndefined();
	});
});

describe('createHoursOrder — refuzuri', () => {
	test('garda aruncă (poartă expirată) → propagă 403, nimic scris', async () => {
		guardError = { status: 403 };
		await expectHttpError(createHoursOrder(INPUT), 403);
		expect(insertedRows).toHaveLength(0);
	});

	test('Stripe neconfigurat → 503 înainte de orice scriere', async () => {
		stripeConfigured = false;
		await expectHttpError(createHoursOrder(INPUT), 503);
		expect(insertedRows).toHaveLength(0);
	});

	test('slug de specializare necunoscut → 400', async () => {
		await expectHttpError(createHoursOrder({ ...INPUT, rateSlug: 'marketing' }), 400);
		expect(insertedRows).toHaveLength(0);
	});

	test('firmă cu CUI invalid → 400', async () => {
		await expectHttpError(createHoursOrder({ ...INPUT, cui: 'abc' }), 400);
		expect(insertedRows).toHaveLength(0);
	});

	test('firmă fără denumire → 400', async () => {
		await expectHttpError(createHoursOrder({ ...INPUT, companyName: '   ' }), 400);
	});

	test('persoană fizică cu un singur cuvânt în nume → 400', async () => {
		await expectHttpError(
			createHoursOrder({ ...INPUT, billingType: 'person', contactName: 'Ion', cui: undefined }),
			400
		);
	});

	test('Stripe pică → 502, comanda rămâne înregistrată pending (staff o vede)', async () => {
		stripeCreateShouldThrow = true;
		await expectHttpError(createHoursOrder(INPUT), 502);
		expect(orderRow()?.status).toBe('pending_payment');
		expect(updatedRows).toHaveLength(0);
	});
});
