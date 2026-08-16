import { describe, test, expect, beforeEach, mock } from 'bun:test';

// --- SvelteKit virtual modules (db transitively imports $env) ---
mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));

// --- Capture buffers for the db mock ---
type Rows = unknown[];
let selectQueue: Rows[] = [];
const updates: Array<Record<string, unknown>> = [];
let updateRowsAffected = 1;

function makeSelectChain() {
	const chain: Record<string, unknown> = {};
	chain.from = () => chain;
	chain.where = () => chain;
	chain.limit = () => chain;
	chain.then = (resolve: (rows: Rows) => void) => resolve(selectQueue.shift() ?? []);
	return chain;
}
function makeUpdateChain() {
	let vals: Record<string, unknown> = {};
	const chain: Record<string, unknown> = {};
	chain.set = (v: Record<string, unknown>) => {
		vals = v;
		return chain;
	};
	chain.where = () => chain;
	chain.then = (resolve: (res: { rowsAffected: number }) => void) => {
		updates.push(vals);
		resolve({ rowsAffected: updateRowsAffected });
	};
	return chain;
}

mock.module('$lib/server/db', () => ({
	db: {
		select: () => makeSelectChain(),
		update: () => makeUpdateChain()
	}
}));

// --- Hooks manager capture ---
let emitted: Array<{ type: string }> = [];
let hookShouldThrow = false;
mock.module('$lib/server/plugins/hooks', () => ({
	getHooksManager: () => ({
		emit: async (event: { type: string }) => {
			emitted.push(event);
			if (hookShouldThrow) throw new Error('hook boom');
		}
	})
}));

// --- Stripe factory capture (anulare PaymentIntent deschis) ---
let cancelledPaymentIntents: string[] = [];
let cancelShouldThrow = false;
mock.module('$lib/server/plugins/stripe/factory', () => ({
	getStripeForTenant: async () => ({
		paymentIntents: {
			cancel: async (id: string) => {
				if (cancelShouldThrow) throw new Error('PI already succeeded');
				cancelledPaymentIntents.push(id);
				return { id, status: 'canceled' };
			}
		}
	})
}));

// --- Logger capture ---
let errorLogs: string[] = [];
let warningLogs: string[] = [];
mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logWarning: (_cat: string, msg: string) => {
		warningLogs.push(msg);
	},
	logError: (_cat: string, msg: string) => {
		errorLogs.push(msg);
	},
	serializeError: (e: unknown) => ({
		message: e instanceof Error ? e.message : String(e),
		stack: undefined
	})
}));

const { markHostingInvoicesPaid } = await import('../mark-invoices-paid');

beforeEach(() => {
	selectQueue = [];
	updates.length = 0;
	updateRowsAffected = 1;
	emitted = [];
	hookShouldThrow = false;
	errorLogs = [];
	warningLogs = [];
	cancelledPaymentIntents = [];
	cancelShouldThrow = false;
});

const TENANT = 'ots';
const ACCOUNT = 'acc-1';

function invoice(overrides: Record<string, unknown> = {}) {
	return {
		id: 'inv-1',
		tenantId: TENANT,
		invoiceNumber: 'OTSH 11',
		status: 'pending',
		clientId: 'cl-1',
		hostingAccountId: ACCOUNT,
		stripePaymentIntentId: null,
		totalAmount: 90629,
		...overrides
	};
}

function baseParams(overrides: Record<string, unknown> = {}) {
	return {
		tenantId: TENANT,
		userId: 'user-1',
		hostingAccountId: ACCOUNT,
		invoiceIds: ['inv-1'],
		method: 'op' as const,
		reference: '000ZEXA2622936M1',
		...overrides
	};
}

describe('markHostingInvoicesPaid', () => {
	test('factură pending cu FK pe cont → paid + transfer + referință + trio de hook-uri', async () => {
		const existing = invoice();
		selectQueue = [[existing], [{ ...existing, status: 'paid' }]];

		const res = await markHostingInvoicesPaid(baseParams());

		expect(res.marked).toEqual([{ id: 'inv-1', invoiceNumber: 'OTSH 11' }]);
		expect(res.skipped).toEqual([]);
		expect(updates).toHaveLength(1);
		expect(updates[0].status).toBe('paid');
		expect(updates[0].paymentMethod).toBe('transfer');
		expect(updates[0].externalTransactionId).toBe('000ZEXA2622936M1');
		expect(updates[0].paidDate).toBeInstanceOf(Date);
		expect(emitted.map((e) => e.type)).toEqual([
			'invoice.updated',
			'invoice.status.changed',
			'invoice.paid'
		]);
	});

	test('factură fără FK (atribuită doar euristic) → skipped not_linked, fără FK-heal', async () => {
		selectQueue = [[invoice({ hostingAccountId: null })]];

		const res = await markHostingInvoicesPaid(baseParams());

		expect(res.marked).toEqual([]);
		expect(res.skipped).toEqual([
			{ id: 'inv-1', invoiceNumber: 'OTSH 11', reason: 'not_linked' }
		]);
		expect(updates).toHaveLength(0);
		expect(emitted).toHaveLength(0);
	});

	test('factură legată de ALT cont → skipped, fără update, fără hook-uri', async () => {
		selectQueue = [[invoice({ hostingAccountId: 'acc-OTHER' })]];

		const res = await markHostingInvoicesPaid(baseParams());

		expect(res.marked).toEqual([]);
		expect(res.skipped[0]?.reason).toBe('not_linked');
		expect(updates).toHaveLength(0);
		expect(emitted).toHaveLength(0);
	});

	test('factură deja paid → skip idempotent, fără update și fără hook-uri', async () => {
		selectQueue = [[invoice({ status: 'paid' })]];

		const res = await markHostingInvoicesPaid(baseParams());

		expect(res.marked).toEqual([]);
		expect(res.skipped).toEqual([
			{ id: 'inv-1', invoiceNumber: 'OTSH 11', reason: 'already_paid' }
		]);
		expect(updates).toHaveLength(0);
		expect(emitted).toHaveLength(0);
	});

	test('cursă concurentă: rowsAffected=0 → skipped already_paid, fără hook-uri', async () => {
		const existing = invoice();
		selectQueue = [[existing]];
		updateRowsAffected = 0;

		const res = await markHostingInvoicesPaid(baseParams());

		expect(res.marked).toEqual([]);
		expect(res.skipped).toEqual([
			{ id: 'inv-1', invoiceNumber: 'OTSH 11', reason: 'already_paid' }
		]);
		expect(updates).toHaveLength(1); // UPDATE-ul s-a încercat, dar n-a prins niciun rând
		expect(emitted).toHaveLength(0);
	});

	test('draft → skipped not_payable', async () => {
		selectQueue = [[invoice({ status: 'draft' })]];

		const res = await markHostingInvoicesPaid(baseParams());

		expect(res.skipped[0]?.reason).toBe('not_payable');
		expect(updates).toHaveLength(0);
	});

	test('factură inexistentă → skipped not_found', async () => {
		selectQueue = [[]];

		const res = await markHostingInvoicesPaid(baseParams());

		expect(res.skipped).toEqual([{ id: 'inv-1', invoiceNumber: null, reason: 'not_found' }]);
	});

	test('PaymentIntent deschis pe factură → anulat la marcarea OP', async () => {
		const existing = invoice({ stripePaymentIntentId: 'pi_open_123' });
		selectQueue = [[existing], [{ ...existing, status: 'paid' }]];

		const res = await markHostingInvoicesPaid(baseParams());

		expect(res.marked).toHaveLength(1);
		expect(cancelledPaymentIntents).toEqual(['pi_open_123']);
	});

	test('anularea PI eșuează (deja încasat) → factura rămâne marcată + warning vizibil', async () => {
		const existing = invoice({ stripePaymentIntentId: 'pi_paid_456' });
		selectQueue = [[existing], [{ ...existing, status: 'paid' }]];
		cancelShouldThrow = true;

		const res = await markHostingInvoicesPaid(baseParams());

		expect(res.marked).toHaveLength(1);
		expect(warningLogs.some((m) => m.includes('pi_paid_456'))).toBe(true);
		expect(emitted).toHaveLength(3); // hook-urile se emit în continuare
	});

	test('fără PaymentIntent → nu se apelează Stripe', async () => {
		const existing = invoice();
		selectQueue = [[existing], [{ ...existing, status: 'paid' }]];

		await markHostingInvoicesPaid(baseParams());

		expect(cancelledPaymentIntents).toEqual([]);
	});

	test('hook care aruncă → factura rămâne marcată, logError, fără throw', async () => {
		const existing = invoice();
		selectQueue = [[existing], [{ ...existing, status: 'paid' }]];
		hookShouldThrow = true;

		const res = await markHostingInvoicesPaid(baseParams());

		expect(res.marked).toHaveLength(1);
		expect(updates).toHaveLength(1);
		expect(errorLogs.length).toBeGreaterThan(0);
	});

	test('cash → paymentMethod=cash', async () => {
		const existing = invoice();
		selectQueue = [[existing], [{ ...existing, status: 'paid' }]];

		await markHostingInvoicesPaid(baseParams({ method: 'cash' }));

		expect(updates[0].paymentMethod).toBe('cash');
	});

	test('referință goală → throw înainte de orice acces la DB', async () => {
		await expect(markHostingInvoicesPaid(baseParams({ reference: '   ' }))).rejects.toThrow();
		expect(updates).toHaveLength(0);
		expect(emitted).toHaveLength(0);
	});

	test('listă goală de facturi → rezultat gol, fără DB', async () => {
		const res = await markHostingInvoicesPaid(baseParams({ invoiceIds: [] }));
		expect(res.marked).toEqual([]);
		expect(res.skipped).toEqual([]);
	});

	test('id duplicat → procesat o singură dată', async () => {
		const existing = invoice();
		selectQueue = [[existing], [{ ...existing, status: 'paid' }]];

		const res = await markHostingInvoicesPaid(baseParams({ invoiceIds: ['inv-1', 'inv-1'] }));

		expect(res.marked).toHaveLength(1);
		expect(updates).toHaveLength(1);
	});
});
