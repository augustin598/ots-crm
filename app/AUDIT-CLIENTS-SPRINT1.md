# Audit: Clients Page — Sprint 1 (2026-03-05)

## Scope
Full security, performance, UX, and validation audit of the clients page (`/[tenant]/clients/`),
including remotes (`clients.remote.ts`, `client-websites.remote.ts`) and UI (`+page.svelte`).

## Summary
- **15 issues found** (2 critical, 2 high, 5 medium, 6 low)
- **15 fixes applied**

---

## Critical Fixes

### FIX 1: SSRF protection in `getLogoFromWebsite`
**File:** `app/src/lib/remotes/clients.remote.ts`
**Issue:** URL validation only checked `startsWith('http')`. Attacker could fetch internal IPs (localhost, 127.0.0.1, 10.*, 192.168.*, 172.16-31.*), scanning internal network.
**Fix:** Added `isPrivateHost(hostname)` helper that blocks localhost, private IP ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, 0.0.0.0/8), and private TLDs (.local, .internal, .corp, .home, .lan). URL parsed with `new URL()` before fetch.

### FIX 2: `deleteClient` missing tenant scope in DELETE
**File:** `app/src/lib/remotes/clients.remote.ts` (line ~525)
**Issue:** Verify query checked tenantId, but actual DELETE used only `eq(table.client.id, clientId)` — defense-in-depth gap.
**Fix:** Added `and(eq(id), eq(tenantId))` to DELETE WHERE clause.

---

## High Fixes

### FIX 3: `createClientWebsite` missing client-tenant ownership
**File:** `app/src/lib/remotes/client-websites.remote.ts`
**Issue:** Accepted any `clientId` without verifying it belongs to the current tenant. Could create websites for other tenants' clients.
**Fix:** Added query to verify `client.id + client.tenantId` match before insert.

### FIX 4: `clientSchema.status` accepts any string
**File:** `app/src/lib/remotes/clients.remote.ts`
**Issue:** `status: v.optional(v.string())` — no validation against allowed values.
**Fix:** Changed to `v.optional(v.picklist(['prospect', 'active', 'inactive']))`.

---

## Medium Fixes

### FIX 5: `alert()` on delete/edit errors
**File:** `app/src/routes/[tenant]/clients/+page.svelte`
**Issue:** `handleDeleteClient` and `saveEditName` used browser `alert()` for errors — inconsistent with rest of app.
**Fix:** Replaced with `toast.error()` from svelte-sonner.

### FIX 6: Browser `confirm()` for delete
**File:** `app/src/routes/[tenant]/clients/+page.svelte`
**Issue:** Used native `confirm()` dialog — ugly, not customizable, inconsistent UX.
**Fix:** Replaced with styled Dialog component (already imported) with destructive button. Added `deleteConfirmOpen`, `deleteTargetId`, `deleteTargetName` state.

### FIX 7: Partner tenant query scans all tenants
**File:** `app/src/lib/remotes/clients.remote.ts`
**Issue:** `getClientPartnerInfo` and `setClientPartnerStatus` both ran `SELECT * FROM tenant` (no filter). Loads all tenants for VAT matching.
**Fix:** Added WHERE `vatNumber IS NOT NULL AND id != currentTenantId` — filters upfront instead of in JS loop.

### FIX 8: No max length on text fields
**File:** `app/src/lib/remotes/clients.remote.ts`
**Issue:** All clientSchema text fields lacked `maxLength` — could accept arbitrarily long strings.
**Fix:** Added `v.maxLength()` to all fields: name/businessName/email 255, phone 50, website/address 500, IBAN 34, CUI 20, notes 5000, etc.

### FIX 9: `deleteClient` no cascade/orphan check
**File:** `app/src/lib/remotes/clients.remote.ts`
**Issue:** Deleting a client with invoices, contracts, or projects left orphaned records (no FK cascade).
**Fix:** Added count checks on `invoice`, `contract`, `project` tables before delete. Throws descriptive error: "Nu se poate șterge clientul — are X facturi, Y contracte asociate".

---

## Low Fixes

### FIX 10: N+1 query in `getClientWebsitesSeoStats`
**File:** `app/src/lib/remotes/client-websites.remote.ts`
**Issue:** `Promise.all(websites.map(async => { query per website }))` — N+1 pattern.
**Fix:** Replaced with single LEFT JOIN + GROUP BY query with `SUM(CASE WHEN...)` aggregates.

### FIX 11: Website URL not validated
**File:** `app/src/lib/remotes/client-websites.remote.ts`
**Issue:** URL field accepted any string (no format validation).
**Fix:** Added `v.url('URL invalid')` + `v.maxLength(500)` to `clientWebsiteSchema.url`.

### FIX 12: `setDefaultClientWebsite` not in transaction
**File:** `app/src/lib/remotes/client-websites.remote.ts`
**Issue:** Two UPDATE queries (reset all → set one) without transaction. Race condition: concurrent calls could both set isDefault=true.
**Fix:** Wrapped in `db.transaction()`.

### FIX 13: Double-click on create client
**File:** `app/src/routes/[tenant]/clients/+page.svelte`
**Issue:** Form fields remained editable during `formLoading` — could trigger double submit.
**Fix:** Added `disabled={formLoading}` to all Input and Select components in create dialog.

### FIX 14: `getClientFirstInvoiceDates` swallows errors silently
**File:** `app/src/lib/remotes/clients.remote.ts`
**Issue:** `catch { return []; }` — errors hidden completely.
**Fix:** Added `console.error('[getClientFirstInvoiceDates]', e)`.

### FIX 15: `getClientsStats` swallows errors silently
**File:** `app/src/lib/remotes/clients.remote.ts`
**Issue:** Same pattern: `catch { return []; }`.
**Fix:** Added `console.error('[getClientsStats]', e)`.

---

## Files Modified
| File | Fixes |
|------|-------|
| `app/src/lib/remotes/clients.remote.ts` | #1, #2, #4, #7, #8, #9, #14, #15 |
| `app/src/lib/remotes/client-websites.remote.ts` | #3, #10, #11, #12 |
| `app/src/routes/[tenant]/clients/+page.svelte` | #5, #6, #13 |

## Migration
None required — all fixes in application code.

## Known Issues (not fixed — noted for future)
1. **No soft delete for clients** — `deleteClient` permanently removes from DB (violates audit trail principle)
2. **Expired magic link tokens not cleaned up** — `magicLinkToken` table grows unbounded (noted in AUDIT-GOOGLE-AUTH.md)
3. **No text search in client list** — only filter by selected IDs, no search by name/email/CUI
4. **CUI unique globally, not per-tenant** — schema has `.unique()` on CUI, prevents same CUI across tenants
5. **No audit trail on client modifications** — `updateClient` doesn't log who changed what
6. **Client access data decryption errors silent** — if decryption fails, shows null instead of error
7. **No max limit on secondary emails per client** — could add unlimited emails
