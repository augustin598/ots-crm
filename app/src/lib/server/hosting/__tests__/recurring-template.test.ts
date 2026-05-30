import { describe, test, expect, beforeEach, afterAll, mock } from 'bun:test';

// --- SvelteKit virtual modules ---
mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));

// --- Capture buffers for the db mock ---
type Rows = unknown[];
let selectQueue: Rows[] = [];
const updates: Array<{ table: string; set: Record<string, unknown> }> = [];
const inserts: Array<{ table: string; values: Record<string, unknown> }> = [];

function tableName(t: unknown): string {
	return (t as { _name?: string })?._name ?? 'unknown';
}

function makeSelectChain() {
	const chain: Record<string, unknown> = {};
	chain.from = () => chain;
	chain.where = () => chain;
	chain.limit = () => chain;
	chain.then = (resolve: (rows: Rows) => void) => resolve(selectQueue.shift() ?? []);
	return chain;
}
function makeUpdateChain(t: unknown) {
	let captured: Record<string, unknown> = {};
	const chain: Record<string, unknown> = {};
	chain.set = (v: Record<string, unknown>) => {
		captured = v;
		return chain;
	};
	chain.where = () => chain;
	chain.then = (resolve: (rows: Rows) => void) => {
		updates.push({ table: tableName(t), set: captured });
		resolve([]);
	};
	return chain;
}
function makeInsertChain(t: unknown) {
	let vals: Record<string, unknown> = {};
	const chain: Record<string, unknown> = {};
	chain.values = (v: Record<string, unknown>) => {
		vals = v;
		return chain;
	};
	chain.onConflictDoNothing = () => chain;
	chain.returning = () => chain;
	chain.then = (resolve: (rows: Rows) => void) => {
		inserts.push({ table: tableName(t), values: vals });
		resolve([]);
	};
	return chain;
}

mock.module('$lib/server/db', () => ({
	db: {
		select: () => makeSelectChain(),
		update: (t: unknown) => makeUpdateChain(t),
		insert: (t: unknown) => makeInsertChain(t)
	}
}));
// Spread the REAL schema so exports this file doesn't override (e.g. tenantUser,
// consumed by sibling test files in the same Bun process) stay resolvable — and
// restore it in afterAll. Without this, our partial mock leaks across files and
// causes "Export named 'tenantUser' not found" link errors elsewhere.
const realSchema = await import('$lib/server/db/schema');

mock.module('$lib/server/db/schema', () => ({
	...realSchema,
	hostingProduct: {
		_name: 'hostingProduct',
		id: 'id',
		price: 'price',
		currency: 'currency',
		daPackageId: 'da_package_id',
		tenantId: 'tenant_id',
		name: 'name'
	},
	hostingAccount: {
		_name: 'hostingAccount',
		id: 'id',
		daPackageName: 'da_package_name',
		hostingProductId: 'hosting_product_id',
		recurringAmount: 'recurring_amount',
		currency: 'currency',
		updatedAt: 'updated_at'
	},
	recurringInvoice: {
		_name: 'recurringInvoice',
		id: 'id',
		hostingAccountId: 'hosting_account_id',
		amount: 'amount',
		currency: 'currency',
		recurringType: 'recurring_type',
		recurringInterval: 'recurring_interval',
		taxRate: 'tax_rate',
		isActive: 'is_active',
		lineItemsJson: 'line_items_json',
		tenantId: 'tenant_id'
	},
	invoiceSettings: { _name: 'invoiceSettings', defaultTaxRate: 'default_tax_rate', tenantId: 'tenant_id' }
}));
mock.module('$lib/server/bnr/client', () => ({
	getLatestBnrRate: async () => 1
}));

// Restore the real schema namespace after this file so the partial overrides
// above don't leak into other test files in the same Bun process.
afterAll(() => {
	mock.module('$lib/server/db/schema', () => realSchema);
});

const { upsertRecurringInvoiceForHostingAccount } = await import('../recurring-template');

const baseArgs = {
	tenantId: 't-1',
	userId: 'u-1',
	hostingAccountId: 'acc-1',
	hostingProductId: 'prod-1',
	clientId: 'cli-1',
	domain: 'nevadasuceava.ro',
	daPackageName: 'Wordpress_Silver',
	recurringAmount: 86600, // DRIFTED snapshot — should be reconciled to the catalog
	currency: 'RON',
	billingCycle: 'annually',
	startDate: '2025-08-23',
	nextDueDate: '2026-08-23',
	status: 'active'
};

describe('upsertRecurringInvoiceForHostingAccount — snapshot write-back (auto-heal)', () => {
	beforeEach(() => {
		selectQueue = [];
		updates.length = 0;
		inserts.length = 0;
	});

	test('reconciles hostingAccount.recurringAmount to the catalog price', async () => {
		selectQueue.push([{ id: 'prod-1', price: 114900, currency: 'RON' }]); // product lookup
		selectQueue.push([{ defaultTaxRate: 21 }]); // invoiceSettings
		selectQueue.push([]); // existing recurringInvoice → none → insert path

		const result = await upsertRecurringInvoiceForHostingAccount(baseArgs);

		expect(result.action).toBe('created');
		// The recurring invoice is billed at the catalog price...
		const recurInsert = inserts.find((i) => i.table === 'recurringInvoice');
		expect(recurInsert?.values.amount).toBe(114900);
		// ...AND the account snapshot is reconciled to match (the keystone fix):
		const acctUpdate = updates.find((u) => u.table === 'hostingAccount');
		expect(acctUpdate).toBeDefined();
		expect(acctUpdate?.set.recurringAmount).toBe(114900);
		expect(acctUpdate?.set.currency).toBe('RON');
	});

	test("'biannually' (semestrial alias) creates a 6-month template, not a silent skip", async () => {
		// 'biannually' is an accepted billing_cycle value (edit-form picklist), but
		// cycleToRecurring historically returned null for it → upsert skipped → NO
		// recurring invoice ever created → silent revenue loss (audit finding H3/CYCLE-1).
		selectQueue.push([{ id: 'prod-1', price: 114900, currency: 'RON' }]);
		selectQueue.push([{ defaultTaxRate: 21 }]);
		selectQueue.push([]); // no existing recurring invoice → insert path

		const result = await upsertRecurringInvoiceForHostingAccount({
			...baseArgs,
			billingCycle: 'biannually'
		});

		expect(result.action).toBe('created');
		expect(result.after?.recurringType).toBe('monthly');
		expect(result.after?.recurringInterval).toBe(6);
	});

	test('VAT fallback uses DEFAULT_VAT_PERCENT (21) when the tenant has no invoiceSettings row', async () => {
		selectQueue.push([{ id: 'prod-1', price: 114900, currency: 'RON' }]);
		selectQueue.push([]); // NO invoiceSettings row → fallback path
		selectQueue.push([]); // no existing recurring invoice

		const result = await upsertRecurringInvoiceForHostingAccount(baseArgs);

		expect(result.action).toBe('created');
		// taxRateBps = DEFAULT_VAT_PERCENT (21) × 100 — NOT the stale 19 (=1900).
		expect(result.after?.taxRateBps).toBe(2100);
	});

	test('dryRun writes nothing (no snapshot reconcile, no recurring upsert)', async () => {
		selectQueue.push([{ id: 'prod-1', price: 114900, currency: 'RON' }]);
		selectQueue.push([{ defaultTaxRate: 21 }]);
		selectQueue.push([]);

		const result = await upsertRecurringInvoiceForHostingAccount(baseArgs, { dryRun: true });

		expect(result.action).toBe('created');
		expect(updates.length).toBe(0);
		expect(inserts.length).toBe(0);
	});
});
