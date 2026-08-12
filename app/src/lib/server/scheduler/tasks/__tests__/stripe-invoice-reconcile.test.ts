import { describe, test, expect, mock, beforeEach } from 'bun:test';

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$env/dynamic/public', () => ({ env: {} }));

let candidateRows: unknown[] = [];
function makeChain(rows: unknown[]): any {
	const p = Promise.resolve(rows);
	return Object.assign(p, {
		from: () => makeChain(rows),
		where: () => makeChain(rows),
		orderBy: () => makeChain(rows),
		limit: () => makeChain(rows)
	});
}
mock.module('$lib/server/db', () => ({ db: { select: () => makeChain(candidateRows) } }));
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

let stripeConfigured = true;
let intentsById: Record<string, { id: string; status: string; amount: number }> = {};
mock.module('$lib/server/plugins/stripe/factory', () => ({
	isStripeConfiguredForTenant: async () => stripeConfigured,
	getStripeForTenant: async () => ({
		paymentIntents: {
			retrieve: async (id: string) => {
				const found = intentsById[id];
				if (!found) throw new Error('No such payment_intent');
				return found;
			}
		}
	})
}));

const handledPayments: Array<{ invoiceId: string; paymentIntentId: string | null }> = [];
mock.module('$lib/server/stripe/invoice-payment', () => ({
	handleStripeInvoicePayment: async (p: { invoiceId: string; paymentIntentId: string | null }) => {
		handledPayments.push(p);
	}
}));

const { processStripeInvoiceReconcile } = await import('../stripe-invoice-reconcile');

beforeEach(() => {
	candidateRows = [];
	intentsById = {};
	handledPayments.length = 0;
	stripeConfigured = true;
});

describe('processStripeInvoiceReconcile', () => {
	test('PaymentIntent succeeded pe factură neplătită → o marchează plătită', async () => {
		candidateRows = [
			{ id: 'inv-1', tenantId: 't1', stripePaymentIntentId: 'pi_1', totalAmount: 90629 }
		];
		intentsById = { pi_1: { id: 'pi_1', status: 'succeeded', amount: 90629 } };

		const res = await processStripeInvoiceReconcile();

		expect(handledPayments).toHaveLength(1);
		expect(handledPayments[0]).toMatchObject({ invoiceId: 'inv-1', paymentIntentId: 'pi_1' });
		expect(res.reconciled).toBe(1);
	});

	test('trece suma reală din Stripe, ca guard-ul de sumă să poată face treaba', async () => {
		candidateRows = [
			{ id: 'inv-1', tenantId: 't1', stripePaymentIntentId: 'pi_1', totalAmount: 90629 }
		];
		intentsById = { pi_1: { id: 'pi_1', status: 'succeeded', amount: 50000 } };

		await processStripeInvoiceReconcile();

		expect(handledPayments[0]).toMatchObject({ paidAmountCents: 50000 } as never);
	});

	test('PaymentIntent neplătit → nu atinge factura', async () => {
		candidateRows = [
			{ id: 'inv-1', tenantId: 't1', stripePaymentIntentId: 'pi_1', totalAmount: 90629 }
		];
		intentsById = { pi_1: { id: 'pi_1', status: 'requires_payment_method', amount: 90629 } };

		const res = await processStripeInvoiceReconcile();

		expect(handledPayments).toHaveLength(0);
		expect(res.reconciled).toBe(0);
	});

	test('tenant fără Stripe configurat → sărit, fără eroare', async () => {
		stripeConfigured = false;
		candidateRows = [
			{ id: 'inv-1', tenantId: 't1', stripePaymentIntentId: 'pi_1', totalAmount: 90629 }
		];
		intentsById = { pi_1: { id: 'pi_1', status: 'succeeded', amount: 90629 } };

		const res = await processStripeInvoiceReconcile();

		expect(handledPayments).toHaveLength(0);
		expect(res.errors).toBe(0);
	});

	test('PaymentIntent dispărut → contorizat ca eroare, nu aruncă', async () => {
		candidateRows = [
			{ id: 'inv-1', tenantId: 't1', stripePaymentIntentId: 'pi_gone', totalAmount: 90629 }
		];

		const res = await processStripeInvoiceReconcile();

		expect(handledPayments).toHaveLength(0);
		expect(res.errors).toBe(1);
		expect(res.success).toBe(true);
	});

	test('o factură eșuată nu oprește restul', async () => {
		candidateRows = [
			{ id: 'inv-1', tenantId: 't1', stripePaymentIntentId: 'pi_gone', totalAmount: 100 },
			{ id: 'inv-2', tenantId: 't1', stripePaymentIntentId: 'pi_2', totalAmount: 90629 }
		];
		intentsById = { pi_2: { id: 'pi_2', status: 'succeeded', amount: 90629 } };

		const res = await processStripeInvoiceReconcile();

		expect(res.reconciled).toBe(1);
		expect(res.errors).toBe(1);
	});

	test('fără candidați → rulare fără apeluri Stripe', async () => {
		const res = await processStripeInvoiceReconcile();
		expect(res).toMatchObject({ success: true, checked: 0, reconciled: 0, errors: 0 });
	});
});
