/**
 * Canonical fallback for the Romanian standard VAT rate, as an integer percent.
 *
 * The normal path always reads `invoiceSettings.defaultTaxRate` (tenant-scoped).
 * This constant is ONLY the fallback for a tenant with no invoiceSettings row.
 * Romania moved 19% → 21% in 2025/2026, and scattered `?? 19` / `?? 21` literals
 * had drifted apart across the billing code (audit finding M3/GAP-10) — a
 * settings-less tenant could get a 19% fiscal invoice but a 21% renewal email
 * for the same product. Server-side VAT fallbacks resolve here so the rate can
 * change in ONE place.
 *
 * NOTE: the DB column default (schema.ts `default(19)`) is NOT changed here —
 * that requires a migration and is tracked separately, as are the contract/PDF
 * and Svelte display fallbacks.
 */
export const DEFAULT_VAT_PERCENT = 21;
