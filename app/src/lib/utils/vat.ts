/**
 * Single source of truth for VAT money math on the hosting checkout flow.
 *
 * Audit C1 (2026-05-31): the customer-facing total, the amount Stripe charges,
 * and the Keez fiscal invoice total MUST be identical. They previously drifted
 * (Stripe charged NET while the UI + Keez invoice were GROSS → VAT promised +
 * invoiced but never collected). Every surface now derives the breakdown from
 * THIS function so they can never diverge again:
 *   - hosting-checkout-modal.svelte (display)
 *   - public-hosting.remote.ts (Stripe PaymentIntent amount + Tax Rate)
 *   - emit-keez-invoice.ts (fiscal invoice net/VAT/total)
 *
 * Client-safe (no server imports) so the Svelte component can use it directly.
 *
 * All amounts are in the smallest currency unit (bani for RON). `vatPercent` is
 * an integer percent (e.g. 21 for 21%). Rounding is half-up via Math.round on
 * the VAT component — the same rule Stripe applies per line, so a Stripe Tax Rate
 * of `vatPercent` on a NET Price yields the same gross to the cent.
 */
export interface VatBreakdown {
	netCents: number;
	vatCents: number;
	grossCents: number;
	vatPercent: number;
}

export function computeVatBreakdown(netCents: number, vatPercent: number): VatBreakdown {
	const net = Math.round(netCents); // defensive: callers pass integer bani
	const vatCents = Math.round((net * vatPercent) / 100);
	return { netCents: net, vatCents, grossCents: net + vatCents, vatPercent };
}

/**
 * Stored line-item / invoice `taxRate` convention is the percentage × 100
 * (e.g. 2100 for 21%). Centralised so the bps form stays consistent with the
 * integer percent used everywhere else.
 */
export function vatPercentToBps(vatPercent: number): number {
	return Math.round(vatPercent * 100);
}
