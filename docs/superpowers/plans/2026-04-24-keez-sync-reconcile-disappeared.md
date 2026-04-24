# Keez Sync: Pagination + Reconcile Disappeared Invoices — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `syncKeezInvoicesForTenant` paginate through all Keez invoices (was capped at one page) and automatically mark CRM invoices as `cancelled` when their Keez counterpart no longer exists upstream.

**Architecture:** Two surgical phases inside `_syncKeezInvoicesForTenantInner`. Phase 1 wraps the existing per-page processing in an offset-driven loop and accumulates a `seen` set of Keez `externalId`s. Phase 2 lists CRM invoices with a `keezExternalId` not in `seen`, calls `getInvoice` on each, and marks them `cancelled` when Keez returns the unambiguous "missing" signal (404 OR 400+`VALIDATION_ERROR`+`"nu exista"`). The 400 detector lives in `error-classification.ts` so the existing `_debug-keez-invoice` endpoint and the new reconciler share one canonical helper.

**Tech Stack:** SvelteKit 5, Bun, TypeScript, Drizzle ORM (libSQL/Turso), `bun:test`.

**Spec:** [docs/superpowers/specs/2026-04-24-keez-sync-reconcile-disappeared-design.md](docs/superpowers/specs/2026-04-24-keez-sync-reconcile-disappeared-design.md)

## File map

| File | Change | Why |
|------|--------|-----|
| `app/src/lib/server/plugins/keez/error-classification.ts` | Add `isMissingOnKeez(err)` predicate | Single source of truth for "Keez says it's gone" |
| `app/src/lib/server/plugins/keez/error-classification.test.ts` | Extend with `isMissingOnKeez` cases | TDD coverage |
| `app/src/routes/[tenant]/api/_debug-keez-invoice/+server.ts` | Replace inline `isMissingOnKeez` with import | Stop carrying two copies |
| `app/src/lib/server/plugins/keez/sync.ts` | Add pagination loop + reconcile pass; extend `SyncKeezInvoicesResult` | The feature itself |
| `app/src/lib/server/plugins/keez/sync-reconcile.test.ts` (new) | Pagination + reconcile pass behaviour | TDD coverage |
| `app/src/lib/remotes/keez.remote.ts:805` | Bump manual-sync default `count` from 100 → 500 | Match cron; one click reconciles whole account |

---

## Task 1 — Extract `isMissingOnKeez` to error-classification.ts

**Files:**
- Modify: `app/src/lib/server/plugins/keez/error-classification.ts`
- Modify: `app/src/lib/server/plugins/keez/error-classification.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `app/src/lib/server/plugins/keez/error-classification.test.ts`:

```ts
import { isMissingOnKeez } from './error-classification';

describe('isMissingOnKeez', () => {
	test('plain Error("Not found") (the 404 path from client.ts) → true', () => {
		expect(isMissingOnKeez(new Error('Not found'))).toBe(true);
	});

	test('KeezClientError with status 404 → true', () => {
		expect(isMissingOnKeez(new KeezClientError('whatever', 404))).toBe(true);
	});

	test('KeezClientError 400 with VALIDATION_ERROR + "nu exista" → true (the actual Keez signal)', () => {
		const body = '{"Code":"VALIDATION_ERROR","Message":"Erori de validare;Factura (xxx) nu exista!"}';
		expect(isMissingOnKeez(new KeezClientError(`Keez API client error 400: ${body}`, 400))).toBe(true);
	});

	test('KeezClientError 400 with VALIDATION_ERROR + Not Found in inner errors → true', () => {
		const body = '{"Code":"VALIDATION_ERROR","errors":[{"code":"Not Found","message":"x"}]}';
		expect(isMissingOnKeez(new KeezClientError(`Keez API client error 400: ${body}`, 400))).toBe(true);
	});

	test('KeezClientError 400 with VALIDATION_ERROR but no "nu exista" / "Not Found" → false (other validation)', () => {
		const body = '{"Code":"VALIDATION_ERROR","Message":"Camp obligatoriu lipseste"}';
		expect(isMissingOnKeez(new KeezClientError(`Keez API client error 400: ${body}`, 400))).toBe(false);
	});

	test('KeezClientError 400 without VALIDATION_ERROR → false', () => {
		expect(isMissingOnKeez(new KeezClientError('Keez API client error 400: bad', 400))).toBe(false);
	});

	test('KeezClientError 502 → false (transient, not "missing")', () => {
		expect(isMissingOnKeez(new KeezClientError('upstream', 502))).toBe(false);
	});

	test('plain Error with random message → false', () => {
		expect(isMissingOnKeez(new Error('something else'))).toBe(false);
	});

	test('non-Error value → false', () => {
		expect(isMissingOnKeez('string error')).toBe(false);
		expect(isMissingOnKeez(null)).toBe(false);
		expect(isMissingOnKeez(undefined)).toBe(false);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && bun test src/lib/server/plugins/keez/error-classification.test.ts`
Expected: 9 new failures with "isMissingOnKeez is not a function".

- [ ] **Step 3: Implement `isMissingOnKeez` in `error-classification.ts`**

Append to `app/src/lib/server/plugins/keez/error-classification.ts`:

```ts
/**
 * Detect Keez's "this invoice doesn't exist" signal across the two HTTP
 * shapes the API actually returns:
 *   1. HTTP 404 with `Error('Not found')` thrown by client.ts:308.
 *   2. HTTP 400 with body `{"Code":"VALIDATION_ERROR","Message":"...nu exista..."}`
 *      thrown as KeezClientError(400, "Keez API client error 400: {...}").
 *      This is the actual common case — Keez did NOT pick 404 for missing
 *      records. See memory/project_keez_400_for_missing_invoice.md.
 */
export function isMissingOnKeez(err: unknown): boolean {
	if (err instanceof Error && err.message === 'Not found') return true;
	if (err instanceof KeezClientError) {
		if (err.status === 404) return true;
		if (err.status === 400) {
			const msg = err.message || '';
			if (/VALIDATION_ERROR/.test(msg) && /nu exista|Not Found/i.test(msg)) {
				return true;
			}
		}
	}
	return false;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && bun test src/lib/server/plugins/keez/error-classification.test.ts`
Expected: all PASS (existing 7 + new 9 = 16).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/server/plugins/keez/error-classification.ts \
        app/src/lib/server/plugins/keez/error-classification.test.ts
git commit -m "feat(keez): isMissingOnKeez predicate (404 + 400 VALIDATION_ERROR shapes)"
```

---

## Task 2 — Migrate the debug endpoint to the canonical predicate

**Files:**
- Modify: `app/src/routes/[tenant]/api/_debug-keez-invoice/+server.ts`

- [ ] **Step 1: Replace the local helper with an import**

Edit `app/src/routes/[tenant]/api/_debug-keez-invoice/+server.ts`:

Find the import block at the top (currently importing `KeezClientError`) and add `isMissingOnKeez`:

```ts
import { KeezClientError } from '$lib/server/plugins/keez/errors';
import { isMissingOnKeez } from '$lib/server/plugins/keez/error-classification';
```

Then delete the local `isMissingOnKeez` function definition entirely (the one introduced in commit `9727927`). Leave the call sites in `verifyOnKeez` unchanged — they already call `isMissingOnKeez(err)` and will now bind to the imported version.

- [ ] **Step 2: Type-check passes**

Run: `cd app && bunx --bun svelte-check --tsconfig ./tsconfig.json --threshold error 2>&1 | grep -E '(_debug-keez|errors found)' | tail -5`
Expected: no errors mentioning `_debug-keez-invoice/+server.ts`. The summary line stays at 12 (preexisting).

- [ ] **Step 3: Commit**

```bash
git add app/src/routes/\[tenant\]/api/_debug-keez-invoice/+server.ts
git commit -m "refactor(keez debug): use canonical isMissingOnKeez from error-classification"
```

---

## Task 3 — Extend `SyncKeezInvoicesResult` with reconcile counters

**Files:**
- Modify: `app/src/lib/server/plugins/keez/sync.ts:63-68`

- [ ] **Step 1: Edit the interface**

Edit `app/src/lib/server/plugins/keez/sync.ts:63-68`. Replace:

```ts
export interface SyncKeezInvoicesResult {
	imported: number;
	updated: number;
	skipped: number;
	errors: number;
}
```

with:

```ts
export interface SyncKeezInvoicesResult {
	imported: number;
	updated: number;
	skipped: number;
	errors: number;
	/** Pages pulled from Keez during this run (≥1 on success, 0 if the integration was skipped). */
	pagesFetched?: number;
	/** CRM invoices that were marked cancelled because they no longer exist on Keez. */
	reconciledCancelled?: number;
}
```

- [ ] **Step 2: Type-check passes**

Run: `cd app && bunx --bun svelte-check --tsconfig ./tsconfig.json --threshold error 2>&1 | tail -3`
Expected: still 12 preexisting errors, none new (the new fields are optional).

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/server/plugins/keez/sync.ts
git commit -m "feat(keez): add pagesFetched + reconciledCancelled to sync result shape"
```

---

## Task 4 — Add the pagination loop (replaces the single fetch)

**Files:**
- Modify: `app/src/lib/server/plugins/keez/sync.ts:125-471`

This is the biggest task. The existing code is a single `getInvoices` call followed by a `for (const invoiceHeader of response.data || [])` loop. We wrap that in an outer `while` loop driven by `offset` and the response's `recordsCount`, and we accumulate `seen` along the way (used by Task 5).

- [ ] **Step 1: Read the current shape**

Read `app/src/lib/server/plugins/keez/sync.ts:125-471` end to end so the wrapping doesn't introduce off-by-ones.
Specifically note: line 138 declares `let consecutiveTransient = 0` (per-run circuit breaker — must remain *outside* the per-page loop or it will reset every page); line 462-470 contains the catch block that throws after 3 consecutive transients.

- [ ] **Step 2: Wrap fetch + per-invoice loop in a pagination while-loop**

Edit `app/src/lib/server/plugins/keez/sync.ts`. Replace the block from line 125 (`// Get invoices from Keez`) through the closing `}` of the `for (const invoiceHeader of response.data || [])` loop (line 471), keeping the success-path block (line 472+) untouched.

Replace:

```ts
	// Get invoices from Keez
	const response = await keezClient.getInvoices({
		offset: options?.offset,
		count: options?.count || 500,
		filter: options?.filter
	});

	logInfo('keez', `Sync fetched ${response.data?.length || 0} invoices (recordsCount: ${response.recordsCount}, total: ${response.total ?? 'N/A'}) [${response.first}-${response.last}]`, { tenantId });

	// Per-run circuit breaker: ...
	let consecutiveTransient = 0;
	for (const invoiceHeader of response.data || []) {
		// ...existing per-invoice body...
	}
```

with:

```ts
	// Pagination + per-run circuit breaker.
	// Pagination: loop offset += pageSize until we've consumed recordsCount or
	// hit a short page (defensive). Without pagination the seen-set used by the
	// reconcile pass would only cover one page and we'd false-cancel everything
	// on pages 2+.
	// Circuit breaker (consecutiveTransient) lives OUTSIDE the page loop on
	// purpose — a streak of 502s spanning pages should still trip after 3, not
	// reset every page.
	const pageSize = options?.count || 500;
	let offset = options?.offset ?? 0;
	let totalRecords: number | null = null;
	const seen = new Set<string>();
	let consecutiveTransient = 0;
	let pagesFetched = 0;

	pagination: while (true) {
		const response = await keezClient.getInvoices({
			offset,
			count: pageSize,
			filter: options?.filter,
		});
		pagesFetched++;
		totalRecords = response.recordsCount ?? totalRecords;

		logInfo(
			'keez',
			`Sync fetched ${response.data?.length || 0} invoices (recordsCount: ${response.recordsCount}, total: ${response.total ?? 'N/A'}) [${response.first}-${response.last}]`,
			{ tenantId },
		);

		const pageData = response.data || [];
		for (const invoiceHeader of pageData) {
			seen.add(invoiceHeader.externalId);
			try {
				// ===== begin existing per-invoice body (UNCHANGED, just re-indented) =====
				// (paste the existing body verbatim — see Step 3 for the exact diff aid)
				// ===== end existing per-invoice body =====
			} catch (error) {
				const processErr = serializeError(error);
				logError('keez', `Sync failed to process invoice ${invoiceHeader.externalId}: ${processErr.message}`, { tenantId, stackTrace: processErr.stack });
				result.errors++;

				if (classifyKeezError(error) === 'transient') {
					consecutiveTransient++;
					if (consecutiveTransient >= 3) {
						logWarning('keez', `Aborting sync run after ${consecutiveTransient} consecutive transient errors`, { tenantId });
						throw error;
					}
				} else {
					consecutiveTransient = 0;
				}
			}
		}

		// Exit conditions, in order of safety:
		offset += pageData.length;
		if (pageData.length === 0) break pagination; // nothing on this page → done
		if (pageData.length < pageSize) break pagination; // short page → almost certainly the tail
		if (totalRecords !== null && offset >= totalRecords) break pagination; // counted out
		// else: keep paginating with the new offset.
	}

	result.pagesFetched = pagesFetched;
```

**Important:** the per-invoice try-body (everything between `seen.add(...)` and the catch) is the existing code from old lines 141-461 verbatim — DO NOT rewrite it. Paste it as-is, indented one level deeper to live inside the `for` inside the `while`.

- [ ] **Step 3: Apply Step 2 mechanically**

Use `Edit` with `old_string` covering the exact lines. The safest approach is two edits:
1. Replace lines 125-141 (`// Get invoices from Keez` through the existing `for (const invoiceHeader of response.data || []) {`) with the new pre-loop + outer `while` + opening of `for` (everything up through `seen.add(invoiceHeader.externalId);`). This keeps the existing per-invoice body in place.
2. Replace lines 462-470 (the existing catch block + closing brace of for-loop) with the new catch block + page-loop exit conditions. Keep the closing `}` count correct: the original had 1 closing brace for the for-loop; the new shape needs 1 closing for the for-loop AND 1 closing for the while-loop.

After editing, the structure must look like:

```
        const pageSize = ...
        ...
        pagination: while (true) {
                const response = ...
                ...
                const pageData = response.data || [];
                for (const invoiceHeader of pageData) {
                        seen.add(invoiceHeader.externalId);
                        try {
                                // ... existing 300+ lines unchanged ...
                        } catch (error) {
                                ... circuit breaker ...
                        }
                }

                offset += pageData.length;
                if (pageData.length === 0) break pagination;
                if (pageData.length < pageSize) break pagination;
                if (totalRecords !== null && offset >= totalRecords) break pagination;
        }

        result.pagesFetched = pagesFetched;

        // Successful completion — always update lastSyncAt AND reset failure columns,
        // ... (existing trailing block unchanged) ...
```

- [ ] **Step 4: Type-check passes**

Run: `cd app && bunx --bun svelte-check --tsconfig ./tsconfig.json --threshold error 2>&1 | grep -E '(sync\.ts|errors found)' | tail -5`
Expected: no errors in `sync.ts`. Summary stays at 12 preexisting.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/server/plugins/keez/sync.ts
git commit -m "feat(keez): paginate sync until recordsCount reached"
```

---

## Task 5 — Add reconcile pass (RED first)

**Files:**
- Create: `app/src/lib/server/plugins/keez/sync-reconcile.test.ts`
- Modify: `app/src/lib/server/plugins/keez/sync.ts` (add reconcile block after pagination loop)

The reconcile pass is harder to unit-test in isolation because it's nested inside the sync function and depends on DB state plus the keez client. The plan tests at the **predicate boundary**: a small extracted `reconcileMissingKeezInvoices` function that accepts injected `(seen: Set<string>, listCandidates, getInvoiceFn, markCancelled)` so the test never touches the real DB or HTTP.

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/server/plugins/keez/sync-reconcile.test.ts`:

```ts
import { describe, expect, test, mock } from 'bun:test';

mock.module('$env/dynamic/private', () => ({ env: { SQLITE_PATH: ':memory:' } }));
mock.module('$env/static/private', () => ({ SQLITE_PATH: ':memory:' }));

const { reconcileMissingKeezInvoices } = await import('./sync-reconcile');
const { KeezClientError } = await import('./errors');

describe('reconcileMissingKeezInvoices', () => {
	test('marks cancelled the candidates whose getInvoice returns 400 VALIDATION_ERROR + nu exista', async () => {
		const seen = new Set(['A', 'B']);
		const candidates = [
			{ id: 'inv-A', externalId: 'A' }, // in seen — should NOT appear in candidate list passed in by caller, but defensively skipped here too
			{ id: 'inv-C', externalId: 'C' }, // not in seen — should be verified
			{ id: 'inv-D', externalId: 'D' }, // not in seen — should be verified
		];
		const getInvoice = mock((externalId: string) => {
			if (externalId === 'C') {
				return Promise.reject(
					new KeezClientError(
						'Keez API client error 400: {"Code":"VALIDATION_ERROR","Message":"Factura (C) nu exista!"}',
						400,
					),
				);
			}
			// D still exists upstream
			return Promise.resolve({ externalId: 'D', status: 'Valid' });
		});
		const cancelled: string[] = [];
		const markCancelled = (id: string) => {
			cancelled.push(id);
			return Promise.resolve();
		};

		const result = await reconcileMissingKeezInvoices({ seen, candidates, getInvoice, markCancelled });

		expect(cancelled).toEqual(['inv-C']);
		expect(result.cancelled).toBe(1);
		expect(result.verified).toBe(2); // C and D were both verified; A skipped
		expect(result.skipped).toBe(1); // A
	});

	test('does NOT cancel on transient errors (502)', async () => {
		const candidates = [{ id: 'inv-X', externalId: 'X' }];
		const getInvoice = mock(() =>
			Promise.reject(new KeezClientError('Keez API client error: 502 nginx', 502)),
		);
		const cancelled: string[] = [];

		const result = await reconcileMissingKeezInvoices({
			seen: new Set(),
			candidates,
			getInvoice,
			markCancelled: (id) => {
				cancelled.push(id);
				return Promise.resolve();
			},
		});

		expect(cancelled).toEqual([]);
		expect(result.cancelled).toBe(0);
	});

	test('handles empty candidate list (no-op)', async () => {
		const result = await reconcileMissingKeezInvoices({
			seen: new Set(['A']),
			candidates: [],
			getInvoice: () => Promise.resolve({}),
			markCancelled: () => Promise.resolve(),
		});
		expect(result).toEqual({ verified: 0, cancelled: 0, skipped: 0 });
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && bun test src/lib/server/plugins/keez/sync-reconcile.test.ts`
Expected: FAIL with "Cannot find module './sync-reconcile'".

- [ ] **Step 3: Create the pure helper**

Create `app/src/lib/server/plugins/keez/sync-reconcile.ts`:

```ts
import { isMissingOnKeez } from './error-classification';

/**
 * Pure reconciliation logic — no DB, no Keez client. Caller injects:
 *   - `seen`: externalIds already observed during this sync run
 *   - `candidates`: CRM invoices with a keezExternalId that COULD be stale
 *     (the caller pre-filters out 'cancelled' ones; we defensively skip
 *     candidates whose externalId is in `seen`)
 *   - `getInvoice`: per-invoice verification call (Keez API)
 *   - `markCancelled`: per-invoice cancellation write (DB)
 *
 * Returns counts for logging + result reporting.
 */
export async function reconcileMissingKeezInvoices(input: {
	seen: Set<string>;
	candidates: Array<{ id: string; externalId: string }>;
	getInvoice: (externalId: string) => Promise<unknown>;
	markCancelled: (id: string) => Promise<void>;
}): Promise<{ verified: number; cancelled: number; skipped: number }> {
	const { seen, candidates, getInvoice, markCancelled } = input;
	let verified = 0;
	let cancelled = 0;
	let skipped = 0;

	for (const c of candidates) {
		// Defensive: a candidate that's in `seen` was processed in pagination
		// — never reconcile-cancel it.
		if (seen.has(c.externalId)) {
			skipped++;
			continue;
		}
		verified++;
		try {
			await getInvoice(c.externalId);
			// 200 → still exists upstream; race with creation. No-op.
		} catch (err) {
			if (isMissingOnKeez(err)) {
				await markCancelled(c.id);
				cancelled++;
			}
			// else: transient / unknown → leave alone, retry next sync.
		}
	}

	return { verified, cancelled, skipped };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && bun test src/lib/server/plugins/keez/sync-reconcile.test.ts`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/server/plugins/keez/sync-reconcile.ts \
        app/src/lib/server/plugins/keez/sync-reconcile.test.ts
git commit -m "feat(keez): pure reconcileMissingKeezInvoices helper + tests"
```

---

## Task 6 — Wire the reconcile pass into the sync function

**Files:**
- Modify: `app/src/lib/server/plugins/keez/sync.ts`

The pure helper from Task 5 needs to be called from `_syncKeezInvoicesForTenantInner` after the pagination loop completes successfully.

- [ ] **Step 1: Add the import**

Edit `app/src/lib/server/plugins/keez/sync.ts` imports near the top. Add after the existing `classifyKeezError` import:

```ts
import { reconcileMissingKeezInvoices } from './sync-reconcile';
import { isNotNull } from 'drizzle-orm';
```

(The existing import line `import { eq, and } from 'drizzle-orm';` becomes `import { eq, and, isNotNull } from 'drizzle-orm';` if it's the same statement — keep one import line per source.)

- [ ] **Step 2: Add the reconcile pass after the pagination loop**

Find the line `result.pagesFetched = pagesFetched;` (added in Task 4) and insert immediately after:

```ts
	// Reconcile pass: any CRM invoice whose Keez counterpart we did NOT see in
	// any page, and which Keez confirms is gone, is marked cancelled here.
	// This runs only after a successful pagination — if the per-run circuit
	// breaker threw earlier, control never reaches here and no false cancels.
	const crmKeezBacked = await db
		.select({
			id: table.invoice.id,
			externalId: table.invoice.keezExternalId,
		})
		.from(table.invoice)
		.where(
			and(
				eq(table.invoice.tenantId, tenantId),
				isNotNull(table.invoice.keezExternalId),
				// don't re-cancel already-cancelled rows
				// (drizzle: ne is not in the imports of this file by default;
				// keep it simple with a JS-side filter below.)
			),
		);
	const candidates = crmKeezBacked
		.filter((r): r is { id: string; externalId: string } => !!r.externalId && !seen.has(r.externalId))
		.map((r) => ({ id: r.id, externalId: r.externalId }));

	if (candidates.length > 0) {
		logInfo(
			'keez',
			`Reconcile: ${candidates.length} CRM invoice(s) not seen in this run, verifying individually`,
			{ tenantId },
		);
	}
	const recon = await reconcileMissingKeezInvoices({
		seen,
		candidates,
		getInvoice: (externalId) => keezClient.getInvoice(externalId),
		markCancelled: async (invoiceId) => {
			await db
				.update(table.invoice)
				.set({ status: 'cancelled', updatedAt: new Date() })
				.where(eq(table.invoice.id, invoiceId));
			logWarning('keez', `Reconcile: marked invoice cancelled (no longer on Keez)`, {
				tenantId,
				metadata: { invoiceId },
			});
		},
	});
	result.reconciledCancelled = recon.cancelled;
	if (recon.cancelled > 0 || recon.verified > 0) {
		logInfo(
			'keez',
			`Reconcile complete: verified=${recon.verified} cancelled=${recon.cancelled} skipped=${recon.skipped}`,
			{ tenantId },
		);
	}
```

- [ ] **Step 3: Filter out already-cancelled candidates**

The DB query above doesn't exclude `status='cancelled'` — we'd waste a Keez API call re-verifying invoices we already marked cancelled in a previous run. Tighten the JS filter:

Edit the `candidates` filter step. Replace:

```ts
	const candidates = crmKeezBacked
		.filter((r): r is { id: string; externalId: string } => !!r.externalId && !seen.has(r.externalId))
		.map((r) => ({ id: r.id, externalId: r.externalId }));
```

with:

```ts
	const candidates = crmKeezBacked
		.filter((r): r is { id: string; externalId: string; status: string } =>
			!!r.externalId && !seen.has(r.externalId) && r.status !== 'cancelled',
		)
		.map((r) => ({ id: r.id, externalId: r.externalId }));
```

And bump the SELECT to include status:

```ts
	const crmKeezBacked = await db
		.select({
			id: table.invoice.id,
			externalId: table.invoice.keezExternalId,
			status: table.invoice.status,
		})
		.from(table.invoice)
		.where(
			and(eq(table.invoice.tenantId, tenantId), isNotNull(table.invoice.keezExternalId)),
		);
```

- [ ] **Step 4: Type-check passes**

Run: `cd app && bunx --bun svelte-check --tsconfig ./tsconfig.json --threshold error 2>&1 | grep -E '(sync\.ts|errors found)' | tail -5`
Expected: no errors in `sync.ts`. Summary stays at 12 preexisting.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/server/plugins/keez/sync.ts
git commit -m "feat(keez): reconcile-cancel CRM invoices missing on Keez (pagination wired)"
```

---

## Task 7 — Bump manual-sync default count to match cron

**Files:**
- Modify: `app/src/lib/remotes/keez.remote.ts:805`

Manual sync currently caps at `count: 100` for "UI responsiveness". With pagination (Task 4) the count is just a page size; the loop fetches everything regardless. 100 makes the loop do 6 pages for a 555-invoice account when 1 page would suffice.

- [ ] **Step 1: Edit the default**

Edit `app/src/lib/remotes/keez.remote.ts:805`. Find:

```ts
		count: filters.count ?? 100, // manual default: 100 for UI responsiveness (scheduler uses 500)
```

and change to:

```ts
		count: filters.count ?? 500, // matches scheduler — pagination loop will fetch all pages anyway; this is just the page size
```

- [ ] **Step 2: Type-check passes**

Run: `cd app && bunx --bun svelte-check --tsconfig ./tsconfig.json --threshold error 2>&1 | tail -3`
Expected: 12 preexisting errors, none new.

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/remotes/keez.remote.ts
git commit -m "chore(keez): manual-sync page size 100 → 500 (pagination fetches all anyway)"
```

---

## Task 8 — Final verification

**Files:**
- (no code changes)

- [ ] **Step 1: Full keez test suite**

Run: `cd app && bun test src/lib/server/plugins/keez/ src/lib/server/scheduler/tasks/keez-invoice-sync-retry.test.ts`
Expected: all PASS. Tally:
- `error-classification.test.ts`: 7 (existing) + 9 (new) = 16
- `sync-reconcile.test.ts`: 3 (new)
- `failure-handler.test.ts`: 5 (existing — unchanged)
- `retry-policy.test.ts`: 6 (existing — unchanged)
- `keez-invoice-sync-retry.test.ts`: 7 (existing — unchanged)
- Total: 37 pass / 0 fail

- [ ] **Step 2: Type-check whole app**

Run: `cd app && bunx --bun svelte-check --tsconfig ./tsconfig.json --threshold error 2>&1 | tail -3`
Expected: `12 errors and 1 warning in 7 files` (preexisting, identical to `main`).

- [ ] **Step 3: Push branch**

```bash
git push -u origin claude/keez-reconcile-disappeared
```

- [ ] **Step 4: Create PR**

```bash
gh pr create --base main --title "feat(keez): paginate sync + reconcile-cancel disappeared invoices" \
  --body "$(cat <<'EOF'
## Summary
- Sync paginates through all Keez invoices (was capped at one page; tail invisible for tenants with >500).
- Adds reconcile pass: invoices whose Keez counterpart no longer exists are auto-marked cancelled.
- Cancellation is gated by per-invoice `getInvoice` verification — only the unambiguous "missing" signal (Keez 404 OR 400+VALIDATION_ERROR+"nu exista") triggers cancel.
- The 400-detection helper (`isMissingOnKeez`) lives in `error-classification.ts`; the existing `_debug-keez-invoice` endpoint now imports the canonical version.

## Test plan
- [x] `bun test src/lib/server/plugins/keez/` → 30+ pass
- [x] `svelte-check` → preexisting 12 errors, none new
- [ ] Manual smoke: trigger sync from `/{tenant}/settings/keez`, confirm OTS 542 (and any other zombie invoices) get marked cancelled

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review

**Spec coverage:** every section of the design doc is covered.
- Pagination loop → Task 4
- `seen` set construction → Task 4 (`seen.add` inside the for-loop)
- Reconcile pass with per-invoice verify → Tasks 5+6
- `isMissingOnKeez` shared helper → Task 1, debug endpoint migration in Task 2
- Result shape extension → Task 3
- Manual-sync page size bump → Task 7
- Tests at predicate boundary (`reconcileMissingKeezInvoices` pure helper) → Task 5
- Safety properties (circuit breaker stays outside pagination, reconcile only runs on successful pagination because exceptions throw before reaching it) → Tasks 4+6 comments + Task 8 verification

**Placeholder scan:** no TBDs, every step has runnable code or shell commands.

**Type consistency:** `seen: Set<string>`, `candidates: Array<{ id: string; externalId: string }>`, `pagesFetched`, `reconciledCancelled` are used identically across Tasks 3–6.
