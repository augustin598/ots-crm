# Google Ads Invoice Extraction Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Google Ads invoice extraction work again (no invoice has been imported since 2026-05-04) and make the failure modes visible instead of silent.

**Architecture:** The durable path becomes a Tampermonkey userscript (v3) that runs in the user's real logged-in browser, downloads each invoice PDF inside the payments.google.com iframe and POSTs it to two new tenant-scoped API endpoints (`check` + `ingest`). The server never needs a Google session for this path. Server-side fixes remove the silent failures: the keep-alive probe no longer reports a dead session as active, "Scan cu Browser" refuses to start on a server without a display, `listInvoices` errors are serialized, accounts removed from the MCC are deactivated, and the three remaining `await import()` calls in the remote file are made static.

**Tech Stack:** SvelteKit 5 remote functions + `+server.ts` routes, Bun, Drizzle/libSQL, MinIO (`uploadBuffer`), valibot, bun:test (run through `bun run test`), Tampermonkey userscript (plain JS, `GM_xmlhttpRequest`).

---

## Diagnosis (evidence gathered 2026-09-09)

| # | Finding | Evidence |
|---|---------|----------|
| R1 | Last invoice import: 2026-05-04 (issue date 2026-04-30). May–Aug are missing for every client → portal shows "În așteptare". | `google_ads_invoice` max(created_at) |
| R2 | Keep-alive probe hits `payments.google.com/payments/u/0/w/home`, which returns **200 even without cookies** → `google_session_status='active'` is a false positive. | `curl` without cookies → 200; `ads.google.com/aw/billing/documents` without cookies → 302 to `accounts.google.com/ServiceLogin` |
| R3 | "Scan cu Browser" on prod launches Chromium `headless: 'shell'` on the server (`hasDisplay:false`). Nobody can log in there → "Nu ești logat încă" forever. | debug_log 2026-09-09 07:29 `Launching interactive browser {chromePath:/usr/bin/chromium, headlessMode:shell}` |
| R4 | API sync (`Sync Acum`, cron on the 1st) only lists invoices for accounts on **monthly invoicing**; all mapped accounts pay by card → 0 invoices. Meduza errors are logged as `[object Object]`; the account vanished from the MCC (last_fetched 2026-05-04) but stays `is_active=1`. | debug_log `google-ads-sync` errors; `google_ads_account` rows |
| R5 | `google-ads-invoices.remote.ts` still has 3 `await import()` (lines 541, 586, 741) — rolldown can compile them to `await void 0` on prod. | grep |

## File Structure

- Create `src/lib/server/scraper/google-probe.ts` — pure verdict for the Google session probe.
- Create `src/lib/server/scraper/browser-availability.ts` — pure "can we open a visible browser here?".
- Create `src/lib/server/google-ads/invoice-parsing.ts` — pure parsing/validation (amount, date, PDF magic, base64, valibot schemas).
- Create `src/lib/server/google-ads/invoice-ingest.ts` — DB/MinIO persistence shared by the downloader and the ingest endpoint.
- Create `src/lib/server/google-ads/sync-errors.ts` — pure error description/classification for `listInvoices`.
- Create `src/lib/server/google-ads/reconcile-accounts.ts` — pure reconciliation of DB accounts vs MCC listing.
- Create `src/routes/[tenant]/api/google-ads/invoices/check/+server.ts` and `.../ingest/+server.ts`.
- Modify `src/lib/server/scraper/api-session-refresh.ts`, `invoice-scraper.ts`, `platforms/google-scraper.ts`, `google-ads/invoice-downloader.ts`, `google-ads/sync.ts`, `google-ads/auth.ts`, `remotes/google-ads-invoices.remote.ts`, `remotes/invoice-scraper.remote.ts`, `logger.ts` (LogSource), `routes/[tenant]/invoices/google-ads/+page.svelte`, `static/google-ads-invoice-extractor.user.js`.
- Tests under `src/lib/server/scraper/__tests__/` and `src/lib/server/google-ads/__tests__/`.
- Docs: `docs/google-ads-invoices.md` (new).

Run tests with `bun run test <filter>` (never `bun test`).

---

### Task 1: Google session probe verdict (fix R2)

**Files:**
- Create: `src/lib/server/scraper/google-probe.ts`
- Test: `src/lib/server/scraper/__tests__/google-probe.test.ts`
- Modify: `src/lib/server/scraper/api-session-refresh.ts:100-121`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, test, expect } from 'bun:test';
import { classifyGoogleProbe, GOOGLE_SESSION_PROBE_URL } from '../google-probe';

describe('classifyGoogleProbe', () => {
	test('probe URL is the ads.google.com billing page (payments home is 200 even logged out)', () => {
		expect(GOOGLE_SESSION_PROBE_URL).toBe('https://ads.google.com/aw/billing/documents');
	});
	test('302 to accounts.google.com ServiceLogin → expired', () => {
		expect(classifyGoogleProbe(302, 'https://accounts.google.com/ServiceLogin?service=adwords')).toBe('expired');
	});
	test('302 that stays on ads.google.com → alive', () => {
		expect(classifyGoogleProbe(302, 'https://ads.google.com/aw/billing/documents?ocid=123')).toBe('alive');
	});
	test('200 → alive', () => {
		expect(classifyGoogleProbe(200, null)).toBe('alive');
	});
	test('401/403 → expired', () => {
		expect(classifyGoogleProbe(401, null)).toBe('expired');
		expect(classifyGoogleProbe(403, null)).toBe('expired');
	});
	test('5xx and redirect without location → error (never false-expire)', () => {
		expect(classifyGoogleProbe(503, null)).toBe('error');
		expect(classifyGoogleProbe(302, null)).toBe('error');
	});
});
```

- [ ] **Step 2: Run test to verify it fails** — `bun run test google-probe` → FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
export const GOOGLE_SESSION_PROBE_URL = 'https://ads.google.com/aw/billing/documents';
export type GoogleProbeVerdict = 'alive' | 'expired' | 'error';
const LOGIN_REDIRECT = /accounts\.google\.com|ServiceLogin|\/signin/i;
export function classifyGoogleProbe(status: number, location: string | null | undefined): GoogleProbeVerdict {
	if (status >= 300 && status < 400) {
		const loc = location || '';
		if (LOGIN_REDIRECT.test(loc)) return 'expired';
		if (/ads\.google\.com/i.test(loc)) return 'alive';
		return 'error';
	}
	if (status === 200) return 'alive';
	if (status === 401 || status === 403) return 'expired';
	return 'error';
}
```

Then in `api-session-refresh.ts` replace `probeGoogle` with a fetch of `GOOGLE_SESSION_PROBE_URL` (same headers, `redirect: 'manual'`, 15s timeout) returning `classifyGoogleProbe(res.status, res.headers.get('location'))`.

- [ ] **Step 4: Run test to verify it passes** — `bun run test google-probe` → PASS.
- [ ] **Step 5: Commit** `fix(google-ads): session keep-alive probes ads.google.com, not the always-200 payments home`

### Task 2: Interactive browser availability (fix R3)

**Files:**
- Create: `src/lib/server/scraper/browser-availability.ts`
- Test: `src/lib/server/scraper/__tests__/browser-availability.test.ts`
- Modify: `src/lib/server/scraper/invoice-scraper.ts` (`launchInteractiveBrowser`, `createSession`), `src/lib/server/google-ads/auth.ts` (`getGoogleAdsStatus` → `browserScanAvailable`), `src/lib/remotes/invoice-scraper.remote.ts` (clear error), page (hide button).

- [ ] **Step 1: Test**

```ts
import { describe, test, expect } from 'bun:test';
import { isInteractiveBrowserAvailable, BROWSER_SCAN_UNAVAILABLE_MESSAGE } from '../browser-availability';
describe('isInteractiveBrowserAvailable', () => {
	test('macOS always has a display', () => expect(isInteractiveBrowserAvailable({ platform: 'darwin' })).toBe(true));
	test('linux without DISPLAY (k8s pod) → false', () => expect(isInteractiveBrowserAvailable({ platform: 'linux' })).toBe(false));
	test('linux with DISPLAY → true', () => expect(isInteractiveBrowserAvailable({ platform: 'linux', display: ':0' })).toBe(true));
	test('message tells the user to use the userscript', () => expect(BROWSER_SCAN_UNAVAILABLE_MESSAGE).toContain('Tampermonkey'));
});
```

- [ ] **Step 2: Run → FAIL.** **Step 3: Implement** (`isInteractiveBrowserAvailable`, `interactiveBrowserAvailable()` reading `process.platform`/`process.env.DISPLAY`, message constant). Wire: `createSession` throws `BROWSER_SCAN_UNAVAILABLE_MESSAGE` when unavailable; `launchInteractiveBrowser` uses the helper for `useHeadless`; `getGoogleAdsStatus` returns `browserScanAvailable`; admin page hides the button/panel when false.
- [ ] **Step 4: Run → PASS.** **Step 5: Commit** `fix(scraper): refuse "Scan cu Browser" on servers without a display`

### Task 3: Pure invoice parsing helpers

**Files:**
- Create: `src/lib/server/google-ads/invoice-parsing.ts`
- Test: `src/lib/server/google-ads/__tests__/invoice-parsing.test.ts`
- Modify: `google-scraper.ts` (import `parseInvoiceDateText` instead of local `parseDate`), `invoice-downloader.ts` (import `parseAmountString`).

- [ ] **Step 1: Test** covering `parseAmountString` ("7.536,54 RON"→7536.54, "7,536.54 USD"→7536.54, "1.234,56 lei"→1234.56, "12,50 RON"→12.5, ""/undefined→null), `parseInvoiceDateText` ("31 aug. 2026"→"2026-08-31", "30 noiembrie 2025"→"2025-11-30", "August 31, 2026"→"2026-08-31", "9 Apr 2025"→"2025-04-09", "n/a"→undefined), `parseIssueDate` ("2026-08-31"→Date UTC midnight, "31 aug. 2026"→2026-08-31, "garbage"→null), `isPdfBuffer`, `decodePdfBase64` (ok / not_pdf / too_large / invalid_base64), and valibot schemas (`ingestInvoiceSchema` accepts a valid payload, rejects invoiceId with letters).
- [ ] **Step 2: Run → FAIL.** **Step 3: Implement.** **Step 4: Run → PASS.** **Step 5: Commit** `refactor(google-ads): shared invoice parsing helpers`

### Task 4: Shared persistence `persistGoogleInvoicePdf`

**Files:**
- Create: `src/lib/server/google-ads/invoice-ingest.ts`
- Test: `src/lib/server/google-ads/__tests__/invoice-ingest.test.ts` (mock `$lib/server/db`, `$lib/server/db/schema`, `drizzle-orm`, `$lib/server/logger`, `$lib/server/storage`)
- Modify: `invoice-downloader.ts` (`downloadGoogleInvoicesFromLinks` uses `resolveMappedAccount`, `findExistingInvoice`, `backfillExistingInvoice`, `persistGoogleInvoicePdf`).

API:
```ts
export class GoogleAccountNotMappedError extends Error {}
export async function resolveMappedAccount(tenantId, customerId): Promise<{ clientId; accountName; currencyCode } | null>
export async function findExistingInvoice(tenantId, invoiceId): Promise<{ id; pdfPath; totalAmountMicros; googleAdsCustomerId; clientId } | null>
export async function listExistingInvoiceIds(tenantId, invoiceIds): Promise<Set<string>>  // only rows with pdfPath
export async function backfillExistingInvoice(existing, account, tenantId, customerId, amountText): Promise<void>
export async function persistGoogleInvoicePdf(input: { tenantId; customerId; invoiceId; issueDate: Date | null; amountText?: string | null; pdfBuffer: Buffer; source: 'userscript' | 'server-download' }): Promise<{ status: 'imported' | 'updated' | 'skipped'; invoiceRowId: string }>
```
Tests: inserts with tenantId/clientId/currency/amount micros when no existing row; updates when existing row has no pdf; skips (no upload) when existing has pdf; throws `GoogleAccountNotMappedError` when the account is not mapped.

- [ ] Steps: test → FAIL → implement → PASS → commit `refactor(google-ads): shared invoice persistence for downloader + ingest`

### Task 5: API endpoints `check` and `ingest`

**Files:**
- Create: `src/routes/[tenant]/api/google-ads/invoices/check/+server.ts`, `src/routes/[tenant]/api/google-ads/invoices/ingest/+server.ts`
- Modify: `src/lib/server/logger.ts` (add `'google-ads-ingest'` to `LogSource`)

Both: `if (!locals.user || !locals.tenant) throw error(401)`; `await requireStaff(event)`; JSON body only; valibot schema from Task 3; tenant from `locals.tenant.id`.
- `check` → `{ ok, account: { customerId, accountName, clientName }, missing: string[], existing: string[] }` or 404 `{ ok:false, error:'account_not_mapped', message }`.
- `ingest` (one invoice per request, PDF ≤ 6 MB) → `{ ok, status, invoiceId, dateGuessed }`; 404 unmapped, 422 not a PDF, 413 too large, 400 invalid payload.

- [ ] Implement; verify with `curl` against the dev server (401 without cookie; 400 on bad payload). Commit `feat(google-ads): tenant API to ingest invoice PDFs from the browser userscript`

### Task 6: Userscript v3 (`static/google-ads-invoice-extractor.user.js`)

- `@version 3.0`, `@grant GM_xmlhttpRequest GM_getValue GM_setValue GM_setClipboard`, `@connect clients.onetopsolution.ro`, `@connect localhost`.
- Iframe (payments.google.com): answers `OTS_EXTRACT_REQUEST` with rows `{url, invoiceId, date, amount}`; answers `OTS_DOWNLOAD_REQUEST {url, invoiceId}` by `fetch(url, {credentials:'include'})` → `%PDF` check → base64 → `OTS_DOWNLOAD_RESULT`.
- Parent (ads.google.com): detects customer ID (`\d{3}-\d{3}-\d{4}` in header/body; per-`ocid` override stored with `GM_setValue`; prompt fallback), account name from `document.title`; button "▶ Trimite în CRM": extract → `POST check` → download+`POST ingest` per missing invoice with progress → summary; secondary "📋 Copiază JSON" (legacy fallback); "⚙" to set CRM URL/tenant.
- [ ] Implement; smoke-test the parsing helpers in Node (`node -e`) for the base64 chunking; commit `feat(userscript): Google Ads invoices sent straight to the CRM (v3)`

### Task 7: Sync error classification + MCC reconciliation + static imports (fix R4/R5)

**Files:**
- Create: `src/lib/server/google-ads/sync-errors.ts` (+ test), `src/lib/server/google-ads/reconcile-accounts.ts` (+ test)
- Modify: `sync.ts:244-256`, `google-ads-invoices.remote.ts` (`fetchGoogleAdsAccounts`, lines 541/586/741)

```ts
export function describeGoogleAdsError(err: unknown): string
export function classifyListInvoicesError(err: unknown): { kind: 'not_monthly_invoicing' | 'account_inaccessible' | 'other'; message: string }
export function reconcileMccAccounts(existing: { id: string; googleAdsCustomerId: string; isActive: boolean }[], fetched: { customerId: string }[]): { deactivateIds: string[] }
```
Tests: GoogleAdsFailure-like `{ errors: [{ error_code: { authorization_error: 'USER_PERMISSION_DENIED' }, message: 'no access' }] }` → `account_inaccessible`, message contains `USER_PERMISSION_DENIED`; `Error('BILLING_SETUP_NOT_ON_MONTHLY_INVOICING')` → `not_monthly_invoicing`; plain Error → `other` with its message (never `[object Object]`). Reconcile: active row absent from MCC listing → in `deactivateIds`; present → not; already inactive → not.

- [ ] Steps: tests → FAIL → implement → PASS → wire into `sync.ts` (log `not_monthly_invoicing` as info, `account_inaccessible` as warning without counting an error, `other` as error) and `fetchGoogleAdsAccounts` (deactivate + logInfo) → replace the 3 dynamic imports with static ones → commit `fix(google-ads): readable sync errors, deactivate accounts gone from the MCC, no dynamic imports in remote`

### Task 8: Admin page UI

- Hide "Scan cu Browser" and the `ScraperPanel` unless `connectionStatusQuery.current?.browserScanAvailable`.
- "Import Facturi" card explains the v3 script (install link `/google-ads-invoice-extractor.user.js`, 3 steps) and keeps the JSON paste as fallback.
- Session warning copy points to the userscript.
- [ ] svelte-autofixer on the page → `/build-check` → screenshot with testermcp → commit `feat(google-ads): invoices page guides the userscript flow, hides browser scan on servers`

### Task 9: Verification, docs, memory

- [ ] `bun run test google-ads`, `bun run test scraper`, `bun run test` (full) → all green.
- [ ] `/build-check` (svelte-check, baseline 16 err / 56 warn) and `bun run build` (dynamic-import guard).
- [ ] `docs/google-ads-invoices.md`: the three paths (userscript v3 primary, API sync for monthly invoicing only, local browser scan), the diagnosis table, how to verify.
- [ ] Memory note `project_google_ads_invoice_extraction_2026_09_09.md`.
