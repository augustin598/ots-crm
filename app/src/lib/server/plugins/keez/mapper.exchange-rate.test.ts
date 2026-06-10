import { describe, expect, test, mock } from 'bun:test';

// Stub the SvelteKit `$lib/*` and `$env/*` specifiers mapper.ts imports so the
// module loads without a generated .svelte-kit tsconfig / real DB. The EUR/EUR
// path never touches the DB or BNR client, so empty stubs are sufficient.
mock.module('$env/dynamic/private', () => ({ env: { SQLITE_PATH: ':memory:' } }));
mock.module('$env/static/private', () => ({ SQLITE_PATH: ':memory:' }));
mock.module('$lib/server/db/schema', () => ({}));
mock.module('$lib/server/db', () => ({ db: {} }));
mock.module('$lib/server/bnr/client', () => ({
	getLatestBnrRate: async () => null,
	getLatestBnrRateWithDate: async () => null
}));
mock.module('$lib/server/whmcs/errors', () => ({
	BnrRateStaleError: class BnrRateStaleError extends Error {}
}));
mock.module('$lib/server/logger', () => ({
	logWarning: () => {},
	logError: () => {},
	logInfo: () => {},
	serializeError: (e: unknown) => ({ message: String(e), stack: undefined })
}));

const { mapInvoiceToKeez } = await import('./mapper');

// Minimal builders — only the fields mapInvoiceToKeez actually reads. Everything
// the mapper guards with `|| undefined` can stay absent.
function buildClient(overrides: Record<string, unknown> = {}) {
	return {
		name: 'MACA GREEN DEVELOPMENT LTD',
		businessName: 'MACA GREEN DEVELOPMENT LTD',
		cui: 'CY10399119V',
		vatNumber: null,
		country: 'Cipru',
		county: null,
		city: 'Germasogeia',
		address: 'Karpasias 4',
		companyType: 'LTD',
		legalType: 'srl',
		...overrides
	} as never;
}

function buildLineItem(overrides: Record<string, unknown> = {}) {
	return {
		id: 'li-eur-1',
		description: 'Consultanță marketing',
		quantity: 1,
		rate: 100_000, // 1000.00 EUR in cents
		amount: 100_000,
		taxRate: null,
		discount: null,
		discountType: null,
		note: null,
		currency: 'EUR',
		unitOfMeasure: 'Buc',
		keezItemExternalId: null,
		...overrides
	} as never;
}

function buildInvoice(overrides: Record<string, unknown> = {}, lineItems = [buildLineItem()]) {
	return {
		id: 'inv-eur-1',
		invoiceNumber: 'OTS 549',
		invoiceCurrency: 'EUR',
		currency: 'EUR',
		// The polluted rate: BNR EUR→RON locked at generation time. Must NOT be applied.
		exchangeRate: '5,2436',
		taxApplicationType: 'none', // Cyprus EU B2B → reverse charge, 0% VAT
		taxRate: 0,
		issueDate: new Date('2026-06-10'),
		dueDate: new Date('2026-06-15'),
		discountType: null,
		discountValue: null,
		vatOnCollection: false,
		paymentMethod: 'bank',
		notes: null,
		lineItems,
		...overrides
	} as never;
}

describe('mapInvoiceToKeez — pure foreign-currency invoice (EUR/EUR)', () => {
	test('forces exchangeRate=1 and does NOT inflate EUR amounts by the stored BNR rate', async () => {
		const keez = await mapInvoiceToKeez(
			buildInvoice(),
			buildClient(),
			{ id: 't1' } as never
		);

		// Header: both currencies EUR, rate normalized to 1 (Keez example_EUR_EUR).
		expect(keez.currencyCode).toBe('EUR');
		expect(keez.referenceCurrencyCode).toBe('EUR');
		expect(keez.exchangeRate).toBe(1);

		// The whole point: 1000 EUR stays 1000 EUR — NOT 1000 × 5.2436 = 5243.60.
		expect(keez.netAmount).toBe(1000);
		expect(keez.netAmountCurrency).toBe(1000);
		expect(keez.grossAmount).toBe(1000);
		expect(keez.grossAmountCurrency).toBe(1000);
		expect(keez.vatAmount).toBe(0);

		const detail = keez.invoiceDetails[0];
		expect(detail.netAmount).toBe(1000);
		expect(detail.netAmountCurrency).toBe(1000);
		expect(detail.unitPrice).toBe(1000);
		expect(detail.unitPriceCurrency).toBe(1000);
	});

	test('regression guard: the non-suffixed (RON) amount equals the EUR amount, never the ×rate value', async () => {
		const keez = await mapInvoiceToKeez(
			buildInvoice(),
			buildClient(),
			{ id: 't1' } as never
		);
		expect(keez.netAmount).not.toBe(5243.6);
		expect(keez.invoiceDetails[0].netAmount).not.toBe(5243.6);
	});
});
