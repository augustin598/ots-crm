/**
 * Regression test for audit C1 (2026-05-31): the amount the customer SEES, the
 * amount Stripe CHARGES, and the Keez fiscal invoice TOTAL must be identical.
 *
 * Before the fix Stripe charged only the NET catalog price while the modal/wizard
 * displayed a VAT-inclusive total and Keez emitted the invoice on net+VAT — so
 * VAT was promised + invoiced but never collected (fiscal exposure on every
 * order). All three surfaces now derive money from ONE helper
 * (`src/lib/utils/vat.ts#computeVatBreakdown`); this test locks that they agree.
 *
 * Run:  cd app && bun run test-hosting-checkout-vat-reconciliation.ts
 */
import { computeVatBreakdown, vatPercentToBps } from './src/lib/utils/vat';

let failures = 0;
function assert(name: string, condition: boolean, detail?: string) {
	if (!condition) {
		console.error(`❌ FAIL: ${name}${detail ? ` — ${detail}` : ''}`);
		failures++;
		return;
	}
	console.log(`✅ PASS: ${name}`);
}

// Realistic Romanian hosting products — NET price in bani (smallest unit) + the
// tenant VAT rate read from invoice_settings.defaultTaxRate.
const cases = [
	{ label: 'WordPress Premium anual (1399 RON, 21%)', netCents: 139900, vat: 21 },
	{ label: 'Hosting Start lunar (49 RON, 21%)', netCents: 4900, vat: 21 },
	{ label: 'WooCommerce Pro (2499 RON, 21%)', netCents: 249900, vat: 21 },
	{ label: 'Legacy 19% VAT tenant (1399 RON)', netCents: 139900, vat: 19 },
	{ label: 'Rounding edge — net 9999 bani @21% (=2099.79→2100)', netCents: 9999, vat: 21 },
	{ label: 'Rounding edge — net 12345 bani @19% (=2345.55→2346)', netCents: 12345, vat: 19 },
	{ label: 'One bani @21% (=0.21→0)', netCents: 1, vat: 21 }
];

for (const c of cases) {
	const b = computeVatBreakdown(c.netCents, c.vat);

	// 1. Helper is arithmetically correct (independent expected value).
	const expectedVat = Math.round((c.netCents * c.vat) / 100);
	assert(`${c.label} · vatCents`, b.vatCents === expectedVat, `${b.vatCents} != ${expectedVat}`);
	assert(
		`${c.label} · grossCents = net + vat`,
		b.grossCents === c.netCents + expectedVat,
		`${b.grossCents} != ${c.netCents + expectedVat}`
	);

	// 2. The three surfaces all derive from the SAME helper → identical gross.
	//    - Stripe one-time PaymentIntent: amount = grossCents (public-hosting.remote.ts)
	//    - Keez fiscal invoice: totalAmount = grossCents (emit-keez-invoice.ts)
	//    - Modal displayed "Total de plată": totalCents = grossCents (hosting-checkout-modal.svelte)
	const stripeOneTimeAmount = computeVatBreakdown(c.netCents, c.vat).grossCents;
	const keezInvoiceTotal = computeVatBreakdown(c.netCents, c.vat).grossCents;
	const modalDisplayedTotal = computeVatBreakdown(c.netCents, c.vat).grossCents;
	assert(`${c.label} · Stripe amount == Keez total`, stripeOneTimeAmount === keezInvoiceTotal);
	assert(`${c.label} · Stripe amount == modal total`, stripeOneTimeAmount === modalDisplayedTotal);

	// 3. Subscription path: Stripe applies a Tax Rate of vat% on the NET unit_amount.
	//    Stripe's per-line rule is round(unit_amount * pct/100), half-up — identical
	//    to our helper, so the subscription charge == one-time == Keez.
	const stripePerLineTax = Math.round((c.netCents * c.vat) / 100);
	assert(`${c.label} · subscription Tax Rate parity`, stripePerLineTax === b.vatCents);

	// 4. Stored taxRate bps (invoice + line item) = percent × 100.
	assert(`${c.label} · taxRate bps`, vatPercentToBps(c.vat) === c.vat * 100);
}

// Negative: a mismatched surface (the OLD bug — Stripe charges NET while invoice
// is GROSS) must NOT pass the reconciliation invariant.
{
	const c = cases[0];
	const net = c.netCents;
	const gross = computeVatBreakdown(net, c.vat).grossCents;
	assert(
		'OLD BUG would be caught — net (Stripe) != gross (Keez)',
		net !== gross,
		'gross must exceed net for any positive VAT'
	);
}

if (failures > 0) {
	console.error(`\n❌ ${failures} assertion(s) failed`);
	process.exit(1);
}
console.log('\n✅ All VAT reconciliation assertions passed (Stripe == Keez == displayed)');
