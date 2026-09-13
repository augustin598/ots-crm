import { describe, test, expect, beforeEach, mock } from 'bun:test';

// SvelteKit virtual modules + db must be mocked before importing the SUT.
type QueueItem = unknown[];
const queue: QueueItem[] = [];

const dbMock = {
	select: () => {
		const chain: Record<string, unknown> = {
			from: () => chain,
			innerJoin: () => chain,
			leftJoin: () => chain,
			where: () => chain,
			limit: () => chain,
			then: (resolve: (rows: QueueItem) => unknown) => resolve(queue.shift() ?? [])
		};
		return chain;
	}
};

const generateCalls: string[] = [];
const envMock: Record<string, string | undefined> = { APP_ENV: 'production' };

mock.module('$env/dynamic/private', () => ({ env: envMock }));
mock.module('$env/static/private', () => ({}));
mock.module('$env/dynamic/public', () => ({ env: {} }));
mock.module('$env/static/public', () => ({}));
mock.module('$lib/server/db', () => ({ db: dbMock }));
mock.module('$lib/server/db/schema', () => ({
	recurringInvoice: {},
	invoiceSettings: {},
	emailSettings: {},
	invoice: {},
	client: {}
}));
mock.module('$lib/server/invoice-utils', () => ({
	generateInvoiceFromRecurringTemplate: async (id: string) => {
		generateCalls.push(id);
		return { invoiceId: `inv-for-${id}` };
	}
}));
mock.module('$lib/server/email', () => ({
	sendInvoiceEmail: async () => {},
	getNotificationRecipients: async () => []
}));
mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logWarning: () => {},
	logError: () => {},
	serializeError: (e: unknown) => ({ message: String(e), stack: '' })
}));

const { processRecurringInvoices } = await import('../recurring-invoices');

function pastIso(): Date {
	const d = new Date();
	d.setUTCFullYear(d.getUTCFullYear() - 1);
	return d;
}

describe('processRecurringInvoices — doar producția emite facturi', () => {
	beforeEach(() => {
		queue.length = 0;
		generateCalls.length = 0;
		envMock.APP_ENV = 'production';
	});

	// Incident 2026-09-12 (OTS 559 + OTS 560, Wow Agency): staging are baza clonată
	// din prod, cu integrarea Keez și șabloanele recurente copiate. Scheduler-ul de
	// acolo a găsit șablonul „scadent" și a emis în Keez-ul real o a doua factură.
	for (const appEnv of ['staging', undefined]) {
		test(`APP_ENV=${appEnv}: nu generează nimic, nici nu citește șabloanele`, async () => {
			envMock.APP_ENV = appEnv;
			queue.push([
				{
					id: 'ri-due',
					tenantId: 't-1',
					clientId: 'c-1',
					isActive: true,
					nextRunDate: pastIso(),
					endDate: null,
					notes: null
				}
			]);
			queue.push([]);

			const result = await processRecurringInvoices();

			expect(generateCalls).toEqual([]);
			expect(result.invoicesGenerated).toBe(0);
			expect(queue).toHaveLength(2);
		});
	}
});

describe('processRecurringInvoices — Stripe-subscription templates are skipped', () => {
	beforeEach(() => {
		queue.length = 0;
		generateCalls.length = 0;
		envMock.APP_ENV = 'production';
	});

	test('does NOT generate an invoice for a template owned by a Stripe subscription', async () => {
		// Both templates are active + due. The Stripe one is billed by Stripe's own
		// recurring engine — the CRM scheduler must NOT also generate an invoice for
		// it (and its lineItemsJson historically stored cents → would bill ×100).
		const templates = [
			{
				id: 'ri-stripe',
				tenantId: 't-1',
				clientId: 'c-1',
				isActive: true,
				nextRunDate: pastIso(),
				endDate: null,
				notes: 'stripe_subscription:sub_123'
			},
			{
				id: 'ri-manual',
				tenantId: 't-1',
				clientId: 'c-1',
				isActive: true,
				nextRunDate: pastIso(),
				endDate: null,
				notes: null
			}
		];
		queue.push(templates); // main candidate query
		queue.push([]); // autoSend invoiceSettings lookup for ri-manual → early return

		const result = await processRecurringInvoices();

		// Only the manual template is billed by the CRM.
		expect(generateCalls).toEqual(['ri-manual']);
		expect(result.invoicesGenerated).toBe(1);
	});

	test('generates for ordinary (non-Stripe) templates as before', async () => {
		const templates = [
			{
				id: 'ri-a',
				tenantId: 't-1',
				clientId: 'c-1',
				isActive: true,
				nextRunDate: pastIso(),
				endDate: null,
				notes: 'Hosting example.ro'
			}
		];
		queue.push(templates);
		queue.push([]); // autoSend invoiceSettings → early return

		const result = await processRecurringInvoices();

		expect(generateCalls).toEqual(['ri-a']);
		expect(result.invoicesGenerated).toBe(1);
	});
});
