import { describe, test, expect, beforeEach, mock } from 'bun:test';

// SvelteKit virtual modules + db + hooks must be mocked before importing the SUT.
type QueueItem = unknown[];
const queue: QueueItem[] = [];

const dbMock = {
	select: () => {
		const chain: Record<string, unknown> = {
			from: () => chain,
			innerJoin: () => chain,
			where: () => chain,
			limit: () => chain,
			then: (resolve: (rows: QueueItem) => unknown) => resolve(queue.shift() ?? [])
		};
		return chain;
	}
};

// Capture every hook emitted so we can assert the payload shape the DA suspend
// hook actually reads (event.invoice.id, .hostingAccountId, .clientId, ...).
const emitted: Array<Record<string, any>> = [];

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$lib/server/db', () => ({ db: dbMock }));
mock.module('$lib/server/db/schema', () => ({ invoice: {}, hostingAccount: {} }));
mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logError: () => {},
	serializeError: (e: unknown) => ({ message: String(e), stack: '' })
}));
mock.module('$lib/server/plugins/hooks', () => ({
	getHooksManager: () => ({
		emit: async (event: Record<string, any>) => {
			emitted.push(event);
		}
	})
}));

const { processHostingExpiryGuard } = await import('../hosting-expiry-guard');

// Realistic fixture mirroring the happy-time-pizza.ro / "OTSH 3" incident:
// an unpaid renewal proforma (Keez Draft) 20 days past its due date, with the
// hosting_account_id FK correctly set.
function makeRow() {
	return {
		invoice: {
			id: 'inv_otsh3_dnxr5xxm',
			tenantId: 'tnt_ots',
			clientId: 'cli_oleniuc_lite',
			hostingAccountId: 'acc_happytime',
			invoiceNumber: 'OTSH 3',
			status: 'draft',
			keezStatus: 'Draft',
			issueDate: new Date('2026-05-26T21:00:00.000Z'),
			dueDate: new Date('2026-06-09T21:00:00.000Z'),
			paidDate: null,
			remainingAmount: 90629,
			totalAmount: 90629,
			currency: 'RON'
		},
		domain: 'happy-time-pizza.ro'
	};
}

describe('processHostingExpiryGuard', () => {
	beforeEach(() => {
		queue.length = 0;
		emitted.length = 0;
	});

	test('dry-run (default) returns the candidate but emits NOTHING', async () => {
		queue.push([makeRow()]);
		const r = await processHostingExpiryGuard(); // default → dryRun:true
		expect(r.dryRun).toBe(true);
		expect(r.checked).toBe(1);
		expect(r.suspended).toBe(0);
		expect(emitted).toHaveLength(0);
		expect(r.candidates[0].invoiceId).toBe('inv_otsh3_dnxr5xxm');
		expect(r.candidates[0].domain).toBe('happy-time-pizza.ro');
		expect(r.candidates[0].dueDate).toBe('2026-06-09');
	});

	// REGRESSION (root-cause bug #2): the emitted payload must be a full invoice
	// row whose `.id` is set. The DA suspend hook reads `event.invoice.id` to set
	// autoSuspendedByInvoiceId (so onInvoicePaid can auto-unsuspend) and to look up
	// the invoice for the suspension email. A projection that aliases id → invoiceId
	// leaves event.invoice.id undefined, silently breaking both.
	test('live mode emits invoice.status.changed with a payload carrying invoice.id', async () => {
		queue.push([makeRow()]);
		const r = await processHostingExpiryGuard({ dryRun: false });
		expect(r.dryRun).toBe(false);
		expect(r.suspended).toBe(1);
		expect(emitted).toHaveLength(1);

		const ev = emitted[0];
		expect(ev.type).toBe('invoice.status.changed');
		expect(ev.newStatus).toBe('overdue');
		expect(ev.tenantId).toBe('tnt_ots');
		// The exact fields the DA suspend hook dereferences:
		expect(ev.invoice.id).toBe('inv_otsh3_dnxr5xxm');
		expect(ev.invoice.hostingAccountId).toBe('acc_happytime');
		expect(ev.invoice.clientId).toBe('cli_oleniuc_lite');
		expect(ev.invoice.invoiceNumber).toBe('OTSH 3');
		// Fields the dual-paid guard (isInvoiceEffectivelyPaid) reads:
		expect(ev.invoice.status).toBe('draft');
		expect(ev.invoice.paidDate).toBeNull();
		expect(ev.invoice.remainingAmount).toBe(90629);
	});

	test('no candidates → checked 0, suspended 0, no emit', async () => {
		queue.push([]);
		const r = await processHostingExpiryGuard({ dryRun: false });
		expect(r.checked).toBe(0);
		expect(r.suspended).toBe(0);
		expect(emitted).toHaveLength(0);
	});
});
