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

/**
 * Canonical fallback for the Romanian standard VAT rate, as an integer percent.
 *
 * Romania moved 19% → 21% in 2025. The normal path always reads the tenant's
 * `invoiceSettings.defaultTaxRate`; this constant is ONLY the fallback for a
 * tenant with no settings row (or a code path that has no settings loaded).
 * Kept HERE (client-safe, no server imports) so Svelte pages and server code
 * share ONE source — `$lib/server/vat/rate.ts` re-exports it for back-compat.
 * Scattered `?? 19` / `?? 21` literals had drifted apart across the billing
 * code (audit M3/GAP-10); resolve every fallback through here instead.
 */
export const DEFAULT_VAT_PERCENT = 21;

/**
 * Resolve a tenant's VAT percent from its (possibly missing) setting.
 * `??` preserves a legitimate stored 0 (a fully reverse-charge tenant); only
 * null/undefined falls back to the Romanian standard. Never hard-code 19/21 at
 * the call site — route it through here.
 */
export function resolveVatPercent(settingRate: number | null | undefined): number {
	return settingRate ?? DEFAULT_VAT_PERCENT;
}

/**
 * Convert a stored invoice/line-item `taxRate` (percent × 100, bps) to an
 * integer percent for downstream APIs (e.g. Keez article vatRate).
 *
 * A stored `0` means a genuine 0% invoice (reverse charge / export / intracom)
 * and MUST stay 0 — the old `taxRate ? taxRate / 100 : 19` truthy-coerced 0 → 19
 * and pushed 19% articles to Keez for zero-VAT invoices. Only a missing rate
 * (null/undefined) falls back to the Romanian standard.
 */
export function invoiceVatPercentFromBps(taxRateBps: number | null | undefined): number {
	return taxRateBps == null ? DEFAULT_VAT_PERCENT : taxRateBps / 100;
}

/**
 * Resolve a stored `taxRate` that may be missing, staying in bps — the sibling of
 * `resolveVatPercent` for the many code paths that keep the rate in bps
 * (`invoice.taxRate`, `invoice_line_item.taxRate`).
 *
 * Use this instead of `taxRate || 1900`: `||` treats a genuine 0% invoice (reverse
 * charge / export) as missing and silently stamps 19/21% on it. That bug shipped in
 * updateInvoice and in the Keez/SmartBill/ANAF import mappers — a 0% invoice could be
 * flipped to 19% by an unrelated edit. `??` only falls back on null/undefined.
 */
export function resolveVatBps(taxRateBps: number | null | undefined): number {
	return taxRateBps ?? vatPercentToBps(DEFAULT_VAT_PERCENT);
}
