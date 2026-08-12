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
		getClientAddress: () => '10.0.0.1',
		request: { headers: new Headers() }
	})
}));

// ─── DB (doar UPDATE-ul de stripePaymentIntentId trece pe aici) ────────────────
let updateCalls = 0;
function makeUpdateChain(): any {
	const chain: any = {};
	chain.set = () => chain;
	chain.where = () => {
		updateCalls++;
		return Promise.resolve([]);
	};
	return chain;
}
mock.module('$lib/server/db', () => ({ db: { update: () => makeUpdateChain() } }));
await import('$lib/server/db/schema');

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

// ─── Token ────────────────────────────────────────────────────────────────────
let tokenResult: any = null;
mock.module('$lib/server/invoice-token', () => ({
	validateInvoiceViewToken: async () => tokenResult
}));

// ─── Stripe ───────────────────────────────────────────────────────────────────
let stripeConfigured = true;
let createdIntents: any[] = [];
let retrievedIntent: any = null;
mock.module('$lib/server/plugins/stripe/factory', () => ({
	isStripeConfiguredForTenant: async () => stripeConfigured,
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

const { createPublicInvoicePaymentIntent } = await import('../public-invoice.remote');

function validToken(overrides: Record<string, unknown> = {}) {
	return {
		tenant: { id: 't1', slug: 'ots' },
		invoice: {
			id: 'inv-1',
			tenantId: 't1',
			invoiceNumber: '8',
			invoiceSeries: 'OTSH',
			status: 'sent',
			totalAmount: 90629,
			currency: 'RON',
			stripePaymentIntentId: null,
			...overrides
		},
		lineItems: [],
		client: { id: 'c1', tenantId: 't1', name: 'MADDIE', email: 'client@example.com' },
		invoiceSettings: null
	};
}

const INPUT = { tenantSlug: 'ots', token: 'tok_123' };

beforeEach(() => {
	updateCalls = 0;
	rateLimitAllowed = true;
	rateLimitCalls.length = 0;
	tokenResult = validToken();
	stripeConfigured = true;
	createdIntents = [];
	retrievedIntent = null;
	customerCalls = 0;
});

describe('createPublicInvoicePaymentIntent — autorizare', () => {
	test('token invalid → refuz, fără apel la Stripe', async () => {
		tokenResult = null;
		await expect(createPublicInvoicePaymentIntent(INPUT)).rejects.toThrow();
		expect(createdIntents).toHaveLength(0);
	});

	test('token expirat → refuz, fără apel la Stripe', async () => {
		tokenResult = { expired: true };
		await expect(createPublicInvoicePaymentIntent(INPUT)).rejects.toThrow();
		expect(createdIntents).toHaveLength(0);
	});

	test('aplică rate limit pe IP ȘI pe factură', async () => {
		await createPublicInvoicePaymentIntent(INPUT);
		expect(rateLimitCalls.map((c) => c.kind)).toContain('invoice-pay-ip');
		expect(rateLimitCalls.map((c) => c.kind)).toContain('invoice-pay-inv');
	});

	test('cheia de rate limit pe factură e prefixată cu tenantId', async () => {
		await createPublicInvoicePaymentIntent(INPUT);
		const invoiceRl = rateLimitCalls.find((c) => c.kind === 'invoice-pay-inv');
		expect(invoiceRl?.ip).toBe('t1:inv-1');
	});

	test('rate limit depășit → refuz, fără apel la Stripe', async () => {
		rateLimitAllowed = false;
		await expect(createPublicInvoicePaymentIntent(INPUT)).rejects.toThrow();
		expect(createdIntents).toHaveLength(0);
	});
});

describe('createPublicInvoicePaymentIntent — eligibilitate', () => {
	test('factură deja plătită → alreadyPaid, fără apel la Stripe', async () => {
		tokenResult = validToken({ status: 'paid' });
		const res = await createPublicInvoicePaymentIntent(INPUT);
		expect(res).toEqual({ alreadyPaid: true });
		expect(createdIntents).toHaveLength(0);
	});

	test('factură anulată → refuz', async () => {
		tokenResult = validToken({ status: 'cancelled' });
		await expect(createPublicInvoicePaymentIntent(INPUT)).rejects.toThrow();
		expect(createdIntents).toHaveLength(0);
	});

	test('factură parțial plătită → refuz', async () => {
		tokenResult = validToken({ status: 'partially_paid' });
		await expect(createPublicInvoicePaymentIntent(INPUT)).rejects.toThrow();
		expect(createdIntents).toHaveLength(0);
	});

	test('sumă sub pragul Stripe → refuz', async () => {
		tokenResult = validToken({ totalAmount: 150 });
		await expect(createPublicInvoicePaymentIntent(INPUT)).rejects.toThrow();
		expect(createdIntents).toHaveLength(0);
	});

	test('Stripe neconfigurat pe tenant → refuz', async () => {
		stripeConfigured = false;
		await expect(createPublicInvoicePaymentIntent(INPUT)).rejects.toThrow();
		expect(createdIntents).toHaveLength(0);
	});
});

describe('createPublicInvoicePaymentIntent — PaymentIntent', () => {
	test('suma și moneda vin din factură, nu din request', async () => {
		const res = await createPublicInvoicePaymentIntent(INPUT);
		expect(createdIntents[0].amount).toBe(90629);
		expect(createdIntents[0].currency).toBe('ron');
		expect(res).toMatchObject({ alreadyPaid: false, total: 90629, currency: 'RON' });
	});

	test('metadata conține contractul așteptat de webhook', async () => {
		await createPublicInvoicePaymentIntent(INPUT);
		expect(createdIntents[0].metadata).toEqual({
			crmPurpose: 'invoice_payment',
			crmTenantId: 't1',
			crmInvoiceId: 'inv-1'
		});
	});

	test('salvează PaymentIntent-ul pe factură', async () => {
		await createPublicInvoicePaymentIntent(INPUT);
		expect(updateCalls).toBe(1);
	});

	test('client fără email → PaymentIntent fără customer', async () => {
		const t = validToken();
		t.client.email = null as unknown as string;
		tokenResult = t;
		await createPublicInvoicePaymentIntent(INPUT);
		expect(customerCalls).toBe(0);
		expect(createdIntents[0].customer).toBeUndefined();
	});

	test('client cu email → PaymentIntent cu customer', async () => {
		await createPublicInvoicePaymentIntent(INPUT);
		expect(customerCalls).toBe(1);
		expect(createdIntents[0].customer).toBe('cus_123');
	});

	test('refolosește un PaymentIntent deschis cu aceeași sumă și monedă', async () => {
		tokenResult = validToken({ stripePaymentIntentId: 'pi_open' });
		retrievedIntent = {
			id: 'pi_open',
			status: 'requires_payment_method',
			amount: 90629,
			currency: 'ron',
			client_secret: 'cs_open'
		};

		const res = await createPublicInvoicePaymentIntent(INPUT);
		expect(createdIntents).toHaveLength(0);
		expect(res).toMatchObject({ clientSecret: 'cs_open' });
		expect(updateCalls).toBe(0);
	});

	test('NU refolosește un PaymentIntent cu altă sumă (factura a fost editată)', async () => {
		tokenResult = validToken({ stripePaymentIntentId: 'pi_old' });
		retrievedIntent = {
			id: 'pi_old',
			status: 'requires_payment_method',
			amount: 50000,
			currency: 'ron',
			client_secret: 'cs_old'
		};

		const res = await createPublicInvoicePaymentIntent(INPUT);
		expect(createdIntents).toHaveLength(1);
		expect(createdIntents[0].amount).toBe(90629);
		expect(res).toMatchObject({ clientSecret: 'cs_new' });
	});

	test('NU refolosește un PaymentIntent deja reușit', async () => {
		tokenResult = validToken({ stripePaymentIntentId: 'pi_done' });
		retrievedIntent = {
			id: 'pi_done',
			status: 'succeeded',
			amount: 90629,
			currency: 'ron',
			client_secret: 'cs_done'
		};

		await createPublicInvoicePaymentIntent(INPUT);
		expect(createdIntents).toHaveLength(1);
	});

	test('PaymentIntent dispărut din Stripe → creează unul nou', async () => {
		tokenResult = validToken({ stripePaymentIntentId: 'pi_gone' });
		retrievedIntent = null; // retrieve aruncă
		await createPublicInvoicePaymentIntent(INPUT);
		expect(createdIntents).toHaveLength(1);
	});
});
