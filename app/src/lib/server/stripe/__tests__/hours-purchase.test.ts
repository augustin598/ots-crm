import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type Stripe from 'stripe';

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$env/dynamic/public', () => ({ env: {} }));
mock.module('$env/static/public', () => ({}));

// ─── DB: select (comanda), transaction (tx.update), update (failed) ─────────
let orderRow: Record<string, unknown> | null = null;
let selectCalls = 0;
let txUpdates: Array<Record<string, unknown>> = [];
let updates: Array<Record<string, unknown>> = [];
let transactionRuns = 0;

function makeUpdateChain(sink: Array<Record<string, unknown>>) {
	const chain: Record<string, unknown> = {};
	chain.set = (payload: Record<string, unknown>) => {
		sink.push(payload);
		return chain;
	};
	chain.where = () => chain;
	chain.then = (resolve: (v: unknown[]) => void) => resolve([]);
	return chain;
}

mock.module('$lib/server/db', () => ({
	db: {
		select: () => {
			const chain: Record<string, unknown> = {};
			chain.from = () => chain;
			chain.where = () => chain;
			chain.limit = async () => {
				selectCalls += 1;
				return orderRow ? [orderRow] : [];
			};
			return chain;
		},
		transaction: async (fn: (tx: unknown) => Promise<void>) => {
			transactionRuns += 1;
			await fn({ update: () => makeUpdateChain(txUpdates) });
		},
		update: () => makeUpdateChain(updates)
	}
}));
await import('$lib/server/db/schema');

let errorLogs: string[] = [];
let warningLogs: string[] = [];
mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logError: (_s: string, m: string) => {
		errorLogs.push(m);
	},
	logWarning: (_s: string, m: string) => {
		warningLogs.push(m);
	},
	serializeError: (e: unknown) => ({ message: e instanceof Error ? e.message : String(e), stack: '' })
}));

mock.module('$lib/server/plugins/keez/db-retry', () => ({
	withTursoBusyRetry: (fn: () => Promise<unknown>) => fn()
}));

// ─── Pașii post-plată, capturați ─────────────────────────────────────────────
let emitCalls: unknown[] = [];
let emitResult: unknown = { invoiceId: 'inv-1', keezExternalId: 'keez-1', invoiceNumber: 'OTS 7' };
let emitThrows: Error | null = null;
mock.module('$lib/server/stripe/post-payment/emit-keez-hours-invoice', () => ({
	emitKeezHoursInvoice: async (params: unknown) => {
		emitCalls.push(params);
		if (emitThrows) throw emitThrows;
		return emitResult;
	}
}));

let magicLinkCalls: unknown[] = [];
let magicLinkThrows: Error | null = null;
mock.module('$lib/server/stripe/post-payment/send-magic-link', () => ({
	sendOnboardingMagicLink: async (params: unknown) => {
		magicLinkCalls.push(params);
		if (magicLinkThrows) throw magicLinkThrows;
		return { tokenId: 'tok', expiresAt: 'x' };
	}
}));

let clientNotifyCalls: unknown[] = [];
let adminNotifyCalls: unknown[] = [];
mock.module('$lib/server/stripe/notifications', () => ({
	notifyPaymentSucceeded: async (tenantId: string, invoiceId: string) => {
		clientNotifyCalls.push({ tenantId, invoiceId });
	},
	notifyAdminPaymentReceived: async (tenantId: string, invoiceId: string, steps: unknown) => {
		adminNotifyCalls.push({ tenantId, invoiceId, steps });
	}
}));

const { handleHoursPurchaseSucceeded, handleHoursPurchaseFailed } = await import(
	'../hours-purchase'
);

const META = {
	crmPurpose: 'hours_purchase',
	crmTenantId: 't1',
	crmClientId: 'c1',
	crmHoursOrderId: 'o1'
};

function intent(over: Partial<Stripe.PaymentIntent> = {}): Stripe.PaymentIntent {
	return {
		id: 'pi_1',
		amount: 78650,
		currency: 'eur',
		metadata: META,
		...over
	} as unknown as Stripe.PaymentIntent;
}

beforeEach(() => {
	orderRow = { id: 'o1', tenantId: 't1', clientId: 'c1', status: 'pending_payment', grossCents: 78650 };
	selectCalls = 0;
	txUpdates = [];
	updates = [];
	transactionRuns = 0;
	errorLogs = [];
	warningLogs = [];
	emitCalls = [];
	emitResult = { invoiceId: 'inv-1', keezExternalId: 'keez-1', invoiceNumber: 'OTS 7' };
	emitThrows = null;
	magicLinkCalls = [];
	magicLinkThrows = null;
	clientNotifyCalls = [];
	adminNotifyCalls = [];
});

describe('handleHoursPurchaseSucceeded', () => {
	test('happy path: client activ, comanda plătită, factură + magic link + emailuri', async () => {
		await handleHoursPurchaseSucceeded(intent());

		expect(transactionRuns).toBe(1);
		expect(txUpdates).toHaveLength(2);
		expect(txUpdates[0]).toMatchObject({ status: 'active' }); // client
		expect(txUpdates[1]).toMatchObject({ status: 'paid', stripePaymentIntentId: 'pi_1' }); // comanda
		expect(txUpdates[1].paidAt).toBeInstanceOf(Date);

		expect(emitCalls).toEqual([
			{ tenantId: 't1', clientId: 'c1', orderId: 'o1', stripePaymentIntentId: 'pi_1' }
		]);
		expect(magicLinkCalls).toEqual([{ tenantId: 't1', clientId: 'c1' }]);
		expect(clientNotifyCalls).toEqual([{ tenantId: 't1', invoiceId: 'inv-1' }]);
		expect(adminNotifyCalls).toHaveLength(1);
		expect(adminNotifyCalls[0]).toMatchObject({ tenantId: 't1', invoiceId: 'inv-1' });
		expect(errorLogs).toHaveLength(0);
	});

	test('comanda deja plătită → idempotent, nimic nu se reia', async () => {
		orderRow = { ...orderRow!, status: 'paid' };
		await handleHoursPurchaseSucceeded(intent());
		expect(transactionRuns).toBe(0);
		expect(emitCalls).toHaveLength(0);
		expect(magicLinkCalls).toHaveLength(0);
		expect(clientNotifyCalls).toHaveLength(0);
	});

	test('sumă încasată ≠ brutul comenzii → NU marchează plătit, log critic', async () => {
		await handleHoursPurchaseSucceeded(intent({ amount: 10000 }));
		expect(transactionRuns).toBe(0);
		expect(emitCalls).toHaveLength(0);
		expect(errorLogs.some((m) => m.includes('10000') && m.includes('78650'))).toBe(true);
	});

	test('metadata incompletă → return fără să atingă DB-ul', async () => {
		await handleHoursPurchaseSucceeded(intent({ metadata: { crmPurpose: 'hours_purchase' } }));
		expect(selectCalls).toBe(0);
		expect(transactionRuns).toBe(0);
		expect(errorLogs).toHaveLength(1);
	});

	test('comanda nu există → return, log', async () => {
		orderRow = null;
		await handleHoursPurchaseSucceeded(intent());
		expect(transactionRuns).toBe(0);
		expect(errorLogs.some((m) => m.includes('o1'))).toBe(true);
	});

	test('emitterul aruncă → comanda rămâne plătită, magic link tot pleacă, fără emailuri de factură', async () => {
		emitThrows = new Error('Keez down');
		await handleHoursPurchaseSucceeded(intent());
		expect(transactionRuns).toBe(1);
		expect(magicLinkCalls).toHaveLength(1);
		expect(clientNotifyCalls).toHaveLength(0);
		expect(adminNotifyCalls).toHaveLength(0);
		expect(errorLogs.some((m) => m.includes('Keez down'))).toBe(true);
	});

	test('emitterul sare (skipped) → fără emailuri de factură, fără crash', async () => {
		emitResult = { skipped: true, reason: 'tenant_owner_missing' };
		await handleHoursPurchaseSucceeded(intent());
		expect(clientNotifyCalls).toHaveLength(0);
		expect(magicLinkCalls).toHaveLength(1);
	});

	test('magic link eșuează → emailurile de factură pleacă oricum', async () => {
		magicLinkThrows = new Error('smtp');
		await handleHoursPurchaseSucceeded(intent());
		expect(clientNotifyCalls).toHaveLength(1);
		expect(adminNotifyCalls).toHaveLength(1);
		expect(warningLogs.some((m) => m.includes('smtp'))).toBe(true);
	});
});

describe('handleHoursPurchaseFailed', () => {
	test('marchează comanda failed (doar din pending_payment — condiția e în WHERE)', async () => {
		await handleHoursPurchaseFailed(
			intent({
				last_payment_error: { code: 'card_declined', decline_code: 'insufficient_funds', message: 'x' }
			} as Partial<Stripe.PaymentIntent>)
		);
		expect(updates).toHaveLength(1);
		expect(updates[0]).toMatchObject({ status: 'failed' });
	});

	test('metadata incompletă → nimic', async () => {
		await handleHoursPurchaseFailed(intent({ metadata: { crmPurpose: 'hours_purchase' } }));
		expect(updates).toHaveLength(0);
	});
});
