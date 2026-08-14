import { describe, test, expect, mock, beforeEach } from 'bun:test';

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$env/dynamic/public', () => ({ env: {} }));
mock.module('$env/static/public', () => ({}));

// ─── Request context (portal client user) ─────────────────────────────────────
let locals: any;
mock.module('$app/server', () => ({
	query: (schemaOrFn: any, fn?: Function) => fn ?? schemaOrFn,
	command: (schemaOrFn: any, fn?: Function) => fn ?? schemaOrFn,
	getRequestEvent: () => ({
		locals,
		getClientAddress: () => '10.0.0.1',
		request: { headers: new Headers() }
	})
}));

// ─── DB — select (factură + invoiceSettings) și update (stripePaymentIntentId) ─
let invoiceRow: any = null;
let settingsRow: any = null;
let updateCalls = 0;

const schema = await import('$lib/server/db/schema');

function makeSelectChain(tbl: any): any {
	const rows = async () => {
		if (tbl === schema.invoice) return invoiceRow ? [invoiceRow] : [];
		if (tbl === schema.invoiceSettings) return settingsRow ? [settingsRow] : [];
		return [];
	};
	const chain: any = {};
	chain.where = () => chain;
	chain.limit = () => rows();
	return chain;
}

function makeUpdateChain(): any {
	const chain: any = {};
	chain.set = () => chain;
	chain.where = () => {
		updateCalls++;
		return Promise.resolve([]);
	};
	return chain;
}

mock.module('$lib/server/db', () => ({
	db: {
		select: () => ({ from: (tbl: any) => makeSelectChain(tbl) }),
		update: () => makeUpdateChain()
	}
}));

// ─── Logger ───────────────────────────────────────────────────────────────────
mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logError: () => {},
	logWarning: () => {},
	serializeError: (e: unknown) => ({
		message: e instanceof Error ? e.message : String(e),
		stack: ''
	})
}));

// ─── Rate limit ───────────────────────────────────────────────────────────────
let rateLimitAllowed = true;
const rateLimitCalls: Array<{ kind: string; ip: string }> = [];
mock.module('$lib/server/redis', () => ({
	rateLimit: async ({ kind, ip }: { kind: string; ip: string }) => {
		rateLimitCalls.push({ kind, ip });
		return { allowed: rateLimitAllowed, count: 1, limit: 10 };
	}
}));

// ─── Stripe ───────────────────────────────────────────────────────────────────
let stripeConfigured = true;
let createdIntents: any[] = [];
let retrievedIntent: any = null;
let devTestMode = false;
mock.module('$lib/server/plugins/stripe/factory', () => ({
	isStripeConfiguredForTenant: async () => stripeConfigured,
	isStripeDevTestMode: () => devTestMode,
	getPublishableKeyForTenant: async () => 'pk_test_123',
	getStripeForTenant: async () => ({
		paymentIntents: {
			create: async (params: any) => {
				createdIntents.push(params);
				return { id: 'pi_new', client_secret: 'cs_new', ...params };
			},
			retrieve: async () => {
				if (!retrievedIntent) throw new Error('No such payment_intent');
				return retrievedIntent;
			}
		}
	})
}));

let customerCalls = 0;
mock.module('$lib/server/stripe/customer', () => ({
	getOrCreateStripeCustomer: async () => {
		customerCalls++;
		return 'cus_123';
	}
}));

const { createClientInvoicePaymentIntent } = await import('../portal-invoice-payment.remote');

function clientLocals(overrides: Record<string, unknown> = {}) {
	return {
		user: { id: 'u1' },
		tenant: { id: 't1', slug: 'ots' },
		isClientUser: true,
		isClientUserPrimary: true,
		client: { id: 'c1', tenantId: 't1', name: 'MADDIE', email: 'client@example.com' },
		...overrides
	};
}

function validInvoice(overrides: Record<string, unknown> = {}) {
	return {
		id: 'inv-1',
		tenantId: 't1',
		clientId: 'c1',
		invoiceNumber: '8',
		invoiceSeries: 'OTSH',
		status: 'sent',
		totalAmount: 90629,
		currency: 'RON',
		stripePaymentIntentId: null,
		...overrides
	};
}

const INPUT = { invoiceId: 'inv-1' };

beforeEach(() => {
	locals = clientLocals();
	invoiceRow = validInvoice();
	settingsRow = null;
	updateCalls = 0;
	rateLimitAllowed = true;
	rateLimitCalls.length = 0;
	stripeConfigured = true;
	createdIntents = [];
	retrievedIntent = null;
	customerCalls = 0;
	devTestMode = false;
});

describe('createClientInvoicePaymentIntent — autorizare', () => {
	test('fără user/tenant → refuz, fără apel la Stripe', async () => {
		locals = {};
		await expect(createClientInvoicePaymentIntent(INPUT)).rejects.toThrow();
		expect(createdIntents).toHaveLength(0);
	});

	test('sesiune staff (nu client user) → refuz', async () => {
		locals = clientLocals({ isClientUser: false, client: null });
		await expect(createClientInvoicePaymentIntent(INPUT)).rejects.toThrow();
		expect(createdIntents).toHaveLength(0);
	});

	test('contact secundar (nu primar) → refuz — secundarii nu văd facturile', async () => {
		locals = clientLocals({ isClientUserPrimary: false });
		await expect(createClientInvoicePaymentIntent(INPUT)).rejects.toThrow();
		expect(createdIntents).toHaveLength(0);
	});

	test('factura altui client → refuz (selectul scoped nu o găsește)', async () => {
		invoiceRow = null;
		await expect(createClientInvoicePaymentIntent(INPUT)).rejects.toThrow();
		expect(createdIntents).toHaveLength(0);
	});

	test('aplică rate limit pe client ȘI pe factură, cu chei prefixate cu tenantId', async () => {
		await createClientInvoicePaymentIntent(INPUT);
		const kinds = rateLimitCalls.map((c) => c.kind);
		expect(kinds).toContain('invoice-pay-portal');
		expect(kinds).toContain('invoice-pay-inv');
		expect(rateLimitCalls.find((c) => c.kind === 'invoice-pay-portal')?.ip).toBe('t1:c1');
		expect(rateLimitCalls.find((c) => c.kind === 'invoice-pay-inv')?.ip).toBe('t1:inv-1');
	});

	test('rate limit depășit → refuz, fără apel la Stripe', async () => {
		rateLimitAllowed = false;
		await expect(createClientInvoicePaymentIntent(INPUT)).rejects.toThrow();
		expect(createdIntents).toHaveLength(0);
	});
});

describe('createClientInvoicePaymentIntent — eligibilitate', () => {
	test('factură deja plătită → alreadyPaid, fără apel la Stripe', async () => {
		invoiceRow = validInvoice({ status: 'paid' });
		const res = await createClientInvoicePaymentIntent(INPUT);
		expect(res).toEqual({ alreadyPaid: true });
		expect(createdIntents).toHaveLength(0);
	});

	test('factură anulată → refuz', async () => {
		invoiceRow = validInvoice({ status: 'cancelled' });
		await expect(createClientInvoicePaymentIntent(INPUT)).rejects.toThrow();
		expect(createdIntents).toHaveLength(0);
	});

	test('factură parțial plătită → refuz', async () => {
		invoiceRow = validInvoice({ status: 'partially_paid' });
		await expect(createClientInvoicePaymentIntent(INPUT)).rejects.toThrow();
		expect(createdIntents).toHaveLength(0);
	});

	test('CIORNĂ → refuz — staff-ul încă o editează, portalul nu are gate de token', async () => {
		invoiceRow = validInvoice({ status: 'draft' });
		await expect(createClientInvoicePaymentIntent(INPUT)).rejects.toThrow();
		expect(createdIntents).toHaveLength(0);
	});

	test('sumă sub pragul Stripe → refuz', async () => {
		invoiceRow = validInvoice({ totalAmount: 150 });
		await expect(createClientInvoicePaymentIntent(INPUT)).rejects.toThrow();
		expect(createdIntents).toHaveLength(0);
	});

	test('Stripe neconfigurat pe tenant → refuz', async () => {
		stripeConfigured = false;
		await expect(createClientInvoicePaymentIntent(INPUT)).rejects.toThrow();
		expect(createdIntents).toHaveLength(0);
	});
});

describe('createClientInvoicePaymentIntent — PaymentIntent', () => {
	test('suma și moneda vin din factură (DB), nu din request', async () => {
		const res = await createClientInvoicePaymentIntent(INPUT);
		expect(createdIntents[0].amount).toBe(90629);
		expect(createdIntents[0].currency).toBe('ron');
		expect(res).toMatchObject({ alreadyPaid: false, total: 90629, currency: 'RON' });
	});

	test('metadata conține contractul așteptat de webhook', async () => {
		await createClientInvoicePaymentIntent(INPUT);
		expect(createdIntents[0].metadata).toEqual({
			crmPurpose: 'invoice_payment',
			crmTenantId: 't1',
			crmInvoiceId: 'inv-1'
		});
	});

	test('salvează PaymentIntent-ul pe factură', async () => {
		await createClientInvoicePaymentIntent(INPUT);
		expect(updateCalls).toBe(1);
	});

	test('client cu email → PaymentIntent cu customer', async () => {
		await createClientInvoicePaymentIntent(INPUT);
		expect(customerCalls).toBe(1);
		expect(createdIntents[0].customer).toBe('cus_123');
	});

	test('refolosește un PaymentIntent deschis cu aceeași sumă și monedă', async () => {
		invoiceRow = validInvoice({ stripePaymentIntentId: 'pi_open' });
		retrievedIntent = {
			id: 'pi_open',
			status: 'requires_payment_method',
			amount: 90629,
			currency: 'ron',
			client_secret: 'cs_open'
		};

		const res = await createClientInvoicePaymentIntent(INPUT);
		expect(createdIntents).toHaveLength(0);
		expect(res).toMatchObject({ clientSecret: 'cs_open' });
		expect(updateCalls).toBe(0);
	});

	test('NU refolosește un PaymentIntent cu altă sumă (factura a fost editată)', async () => {
		invoiceRow = validInvoice({ stripePaymentIntentId: 'pi_old' });
		retrievedIntent = {
			id: 'pi_old',
			status: 'requires_payment_method',
			amount: 50000,
			currency: 'ron',
			client_secret: 'cs_old'
		};

		const res = await createClientInvoicePaymentIntent(INPUT);
		expect(createdIntents).toHaveLength(1);
		expect(createdIntents[0].amount).toBe(90629);
		expect(res).toMatchObject({ clientSecret: 'cs_new' });
	});

	test('eticheta facturii folosește seria (OTSH 8)', async () => {
		const res = await createClientInvoicePaymentIntent(INPUT);
		expect(res).toMatchObject({ invoiceLabel: 'OTSH 8' });
	});

	test('dev-test: NU salvează PI-ul pe factură și NU creează Stripe Customer (DB partajat cu prod)', async () => {
		devTestMode = true;
		const res = await createClientInvoicePaymentIntent(INPUT);
		expect(res).toMatchObject({ alreadyPaid: false, clientSecret: 'cs_new' });
		expect(updateCalls).toBe(0);
		expect(customerCalls).toBe(0);
		expect(createdIntents[0].customer).toBeUndefined();
	});
});
