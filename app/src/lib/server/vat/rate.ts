/**
 * Server-side VAT fallback entry point.
 *
 * The canonical value + helpers now live in the client-safe `$lib/utils/vat`
 * so Svelte pages and server code share ONE source of truth. This module
 * re-exports them for back-compat with existing `$lib/server/vat/rate` imports.
 *
 * Romania moved 19% → 21% in 2025/2026. The normal path always reads
 * `invoiceSettings.defaultTaxRate` (tenant-scoped); these helpers are ONLY the
 * fallback for a tenant with no invoiceSettings row.
 */
export { DEFAULT_VAT_PERCENT, resolveVatPercent, invoiceVatPercentFromBps } from '$lib/utils/vat';
