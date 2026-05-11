/**
 * ONE-OFF RECOVERY: Replay Keez line-item sync for invoice rwy3s52stmt3rzedikzqk4fz
 *
 * IMPORTANT: This script CANNOT be run directly with `bun run` because sync.ts
 * imports from $lib/... (SvelteKit virtual modules that don't resolve outside
 * the SvelteKit runtime). Use the admin debug endpoint instead (see below).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REPLAY STRATEGY (execute after deploying the db-retry.ts fix):
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Option A — Use the existing manual sync endpoint (RECOMMENDED):
 *
 *   POST /ots/api/integrations/keez/sync
 *   Authorization: Bearer <admin-token>
 *   Content-Type: application/json
 *
 *   { "force": true }
 *
 *   This will re-sync all invoices with force=true, which skips the
 *   header-fingerprint cache and forces a fresh pull from Keez including
 *   line items for invoice rwy3s52stmt3rzedikzqk4fz.
 *
 * Option B — Via the Keez debug health endpoint, then trigger sync:
 *
 *   1. GET /ots/api/_debug-keez-health  (verify Keez is reachable)
 *   2. POST /ots/api/integrations/keez/sync  with { "force": true }
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VERIFICATION after replay:
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   Check that invoice rwy3s52stmt3rzedikzqk4fz now has 2 line items:
 *   - "Google ADS - Seo / Mentenanta website / Tiktok / Facebook" Ianuarie 2026 — 350000 micros
 *   - "Google ADS - Seo / Mentenanta website / Tiktok / Facebook" Februarie 2026 — 350000 micros
 *
 *   Query to verify:
 *     SELECT * FROM invoice_line_item WHERE invoice_id = 'rwy3s52stmt3rzedikzqk4fz';
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Root cause fixed:
 * ─────────────────────────────────────────────────────────────────────────────
 *   db-retry.ts BUSY_PATTERNS now includes 'invalid baton' (substring match),
 *   which covers both "invalid baton" and "Received an invalid baton" from the
 *   Turso HTTP layer. withTursoBusyRetry will retry up to 3 times (500ms, 1500ms)
 *   before giving up, instead of propagating immediately on the first attempt.
 */

export {};
