# Client Facebook Ads rk Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the admin "rk" Facebook Ads report design into the client portal page read-only, reusing the exact same components.

**Architecture:** Extract the rk component set (+ `rk-report.css`) out of the admin route into `$lib/components/reports/rk/` so both pages share one source. Enrich `getMyAdAccounts` with the 5 fields the payment/token banners need. Rewrite the client `+page.svelte` starting from the admin page as the base, then strip every write-control (On/Off toggle, budget edit, bulk pause) and admin-only affordance, and adapt account source + connection messaging for the client.

**Tech Stack:** SvelteKit 5 (runes), TypeScript, SvelteKit remote functions (`$lib/remotes/reports.remote.ts`), Drizzle ORM (libSQL/Turso), `svelte-check`, Svelte MCP `svelte-autofixer`.

**Working branch:** Work directly on `main` — this project runs its dev server from `main` and the user previews on localhost, so a worktree would hide the changes from them. Commit frequently.

**Reference files (read before starting):**
- Admin page (the design being ported): `app/src/routes/[tenant]/reports/facebook-ads/+page.svelte`
- Current client page (being replaced): `app/src/routes/client/[tenant]/(app)/reports/facebook-ads/+page.svelte`
- Remotes: `app/src/lib/remotes/reports.remote.ts` (`getMyAdAccounts` @271, `getReportAdAccounts` @150)
- Spec: `docs/superpowers/specs/2026-07-11-client-facebook-ads-rk-redesign-design.md`

**Verification command (used throughout):**
```bash
cd /Users/augustin598/Projects/CRM/app && NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --threshold warning
```
Baseline before this work: **16 errors / 56 warnings**. No task may increase these counts.

---

### Task 1: Extract rk components to a shared `$lib` folder

**Files:**
- Move: `app/src/routes/[tenant]/reports/facebook-ads/components/` (13 files) → `app/src/lib/components/reports/rk/`
- Move: `app/src/routes/[tenant]/reports/facebook-ads/rk-report.css` → `app/src/lib/components/reports/rk/rk-report.css`
- Modify: `app/src/routes/[tenant]/reports/facebook-ads/+page.svelte` (import paths only)

- [ ] **Step 1: Move the folder and CSS with `git mv` (preserves history)**

```bash
cd /Users/augustin598/Projects/CRM/app
mkdir -p src/lib/components/reports/rk
git mv "src/routes/[tenant]/reports/facebook-ads/components/"* src/lib/components/reports/rk/
git mv "src/routes/[tenant]/reports/facebook-ads/rk-report.css" src/lib/components/reports/rk/rk-report.css
rmdir "src/routes/[tenant]/reports/facebook-ads/components"
```

- [ ] **Step 2: Confirm the moved files and that internal relative imports are intact**

```bash
ls src/lib/components/reports/rk/
# Expect 14 files: AdvancedKpi.svelte Audience.svelte ColumnManager.svelte ComboChart.svelte
# FilterBar.svelte Funnel.svelte KpiRow.svelte PlatformSplit.svelte Popover.svelte
# PresetSelect.svelte SpendChart.svelte rk-helpers.ts rk-icons.ts rk-report.css
grep -rn "from '\.\./" src/lib/components/reports/rk/ || echo "no parent-relative imports (good)"
```
Expected: only sibling-relative (`./rk-helpers`, `./rk-icons`, `./Popover.svelte`) and `$lib/*` imports remain — both still resolve.

- [ ] **Step 3: Update the admin page imports**

In `app/src/routes/[tenant]/reports/facebook-ads/+page.svelte`, replace these import lines:

```
FROM: import './rk-report.css';
TO:   import '$lib/components/reports/rk/rk-report.css';

FROM: import KpiRow from './components/KpiRow.svelte';
TO:   import KpiRow from '$lib/components/reports/rk/KpiRow.svelte';

FROM: import SpendChart from './components/SpendChart.svelte';
TO:   import SpendChart from '$lib/components/reports/rk/SpendChart.svelte';

FROM: import ComboChart from './components/ComboChart.svelte';
TO:   import ComboChart from '$lib/components/reports/rk/ComboChart.svelte';

FROM: import AdvancedKpi from './components/AdvancedKpi.svelte';
TO:   import AdvancedKpi from '$lib/components/reports/rk/AdvancedKpi.svelte';

FROM: import Audience from './components/Audience.svelte';
TO:   import Audience from '$lib/components/reports/rk/Audience.svelte';

FROM: import Funnel from './components/Funnel.svelte';
TO:   import Funnel from '$lib/components/reports/rk/Funnel.svelte';

FROM: import PlatformSplit from './components/PlatformSplit.svelte';
TO:   import PlatformSplit from '$lib/components/reports/rk/PlatformSplit.svelte';

FROM: import FilterBar, { type RkFilters } from './components/FilterBar.svelte';
TO:   import FilterBar, { type RkFilters } from '$lib/components/reports/rk/FilterBar.svelte';

FROM: import ColumnManager from './components/ColumnManager.svelte';
TO:   import ColumnManager from '$lib/components/reports/rk/ColumnManager.svelte';

FROM: import PresetSelect from './components/PresetSelect.svelte';
TO:   import PresetSelect from '$lib/components/reports/rk/PresetSelect.svelte';

FROM: import { rkIcon } from './components/rk-icons';
TO:   import { rkIcon } from '$lib/components/reports/rk/rk-icons';

FROM: 	} from './components/rk-helpers';   (the multi-line import block ending on this line)
TO:   	} from '$lib/components/reports/rk/rk-helpers';
```

- [ ] **Step 4: Verify no other file referenced the old paths**

```bash
cd /Users/augustin598/Projects/CRM/app
grep -rn "reports/facebook-ads/components\|facebook-ads/rk-report" src/ || echo "no stale references (good)"
```
Expected: "no stale references (good)".

- [ ] **Step 5: Run svelte-check — must match baseline (16 err / 56 warn), no regression**

```bash
cd /Users/augustin598/Projects/CRM/app && NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --threshold warning 2>&1 | tail -5
```
Expected: error/warning counts unchanged from baseline.

- [ ] **Step 6: Commit**

```bash
cd /Users/augustin598/Projects/CRM
git add -A
git commit -m "refactor(reports): extract rk components to \$lib/components/reports/rk

Move the Facebook Ads rk design system (11 components + rk-helpers + rk-icons +
rk-report.css) out of the admin route into shared \$lib so the client portal can
reuse it. Admin page imports updated; no behavior change.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Enrich `getMyAdAccounts` with payment/token banner fields

**Files:**
- Modify: `app/src/lib/remotes/reports.remote.ts` — `getMyAdAccounts` (starts @271)

**Reference:** `getReportAdAccounts` (@150) already selects `disableReason`, `accountStatus`, `tokenExpiresAt`, `integrationActive`, `isActive`. Read its `.select({...})` block to copy the exact column references (`table.metaAdsAccount.*` and any joined `table.integration.*`).

- [ ] **Step 1: Read the admin query to copy exact field references**

```bash
cd /Users/augustin598/Projects/CRM/app && sed -n '150,230p' src/lib/remotes/reports.remote.ts
```
Note how each of the 5 fields is sourced (column on `metaAdsAccount` vs. joined `integration.isActive`/token columns). Reproduce the SAME sources in `getMyAdAccounts` (add the join if `getReportAdAccounts` uses one).

- [ ] **Step 2: Add the 5 fields to the `getMyAdAccounts` `.select({...})` (currently @278-284)**

Extend the projection so each returned account also carries (using the identical column sources found in Step 1):
```ts
disableReason: table.metaAdsAccount.disableReason,
accountStatus: table.metaAdsAccount.accountStatus,
tokenExpiresAt: /* same source as getReportAdAccounts */,
integrationActive: /* same source as getReportAdAccounts */,
isActive: table.metaAdsAccount.isActive,
```
If `getReportAdAccounts` joins `table.integration` for `tokenExpiresAt`/`integrationActive`, add the same `.leftJoin(table.integration, eq(...))` to `getMyAdAccounts`, keeping the existing `where` (tenant + client) untouched.

- [ ] **Step 3: Ensure the fields survive the per-account `result.push(...)` (@296-305)**

The loop spreads `...account`, so the new fields flow through automatically. Confirm no explicit field allow-list drops them.

- [ ] **Step 4: Run svelte-check — no regression**

```bash
cd /Users/augustin598/Projects/CRM/app && NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --threshold warning 2>&1 | tail -5
```
Expected: counts unchanged.

- [ ] **Step 5: Commit**

```bash
cd /Users/augustin598/Projects/CRM
git add app/src/lib/remotes/reports.remote.ts
git commit -m "feat(reports): getMyAdAccounts returns payment/token health fields

Add disableReason, accountStatus, tokenExpiresAt, integrationActive, isActive to
the client-scoped account query (additive SELECT; tenant+client scoping unchanged)
so the client report page can render the same payment/token warning banners as admin.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Scaffold the client page from the admin page

**Files:**
- Overwrite: `app/src/routes/client/[tenant]/(app)/reports/facebook-ads/+page.svelte`

**Approach:** The client page is "admin page minus write controls plus client adaptations." Starting from a copy of the (already-import-fixed) admin page guarantees visual parity and avoids hand-transcription errors. Tasks 4–5 apply the exact deletions/adaptations.

- [ ] **Step 1: Copy the admin page over the client page**

```bash
cd /Users/augustin598/Projects/CRM/app
cp "src/routes/[tenant]/reports/facebook-ads/+page.svelte" \
   "src/routes/client/[tenant]/(app)/reports/facebook-ads/+page.svelte"
```

- [ ] **Step 2: Swap the account source in the remote-import block**

At the top `import { ... } from '$lib/remotes/reports.remote';`, remove `getReportAdAccounts`, `updateBudget`, and `toggleCampaignStatus`; add `getMyAdAccounts`. Result keeps: `getMyAdAccounts, getMetaCampaignInsights, getMetaActiveCampaigns, getMetaAdsetInsights, getMetaAdInsights, getMetaDemographicInsights, getMetaPlatformSplit`.

- [ ] **Step 3: Point the accounts query at `getMyAdAccounts`**

```
FROM: const accountsQuery = getReportAdAccounts();
TO:   const accountsQuery = getMyAdAccounts();
```

- [ ] **Step 4: Run svelte-check (expect errors from still-referenced write handlers — that's fine, fixed in Task 4)**

```bash
cd /Users/augustin598/Projects/CRM/app && NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --threshold warning 2>&1 | tail -8
```
Expected: new errors referencing `updateBudget` / `toggleCampaignStatus` (removed in Task 4). Do NOT commit yet — Tasks 3–5 land as one coherent commit at the end of Task 5.

---

### Task 4: Strip write controls from the client page

**Files:**
- Modify: `app/src/routes/client/[tenant]/(app)/reports/facebook-ads/+page.svelte`

All line references below are relative to the admin source that was copied in Task 3.

- [ ] **Step 1: Remove budget-edit script state + handlers**

Delete the block that declares `budgetDialogOpen`, `budgetEditCampaign`, `budgetNewAmount`, `budgetSaving` and the functions `openBudgetEdit(...)` and `handleBudgetSave()` (admin lines ~519-550).

- [ ] **Step 2: Remove campaign toggle handlers**

Delete `togglingCampaignId` state and the `handleToggleStatus(...)` and `bulkToggle(...)` functions (admin lines ~552-581).

- [ ] **Step 3: Remove now-unused imports**

`Dialog`, `Button`, and `Input` were used only by the budget dialog. Remove:
```
import * as Dialog from '$lib/components/ui/dialog';
import { Button } from '$lib/components/ui/button';
import { Input } from '$lib/components/ui/input';
```
Also remove `Play` and `Pause` lucide imports (used only by the bulk bar / toggle) and any other icon left unreferenced after this task (verify with svelte-check unused warnings in Step 8).

- [ ] **Step 4: Remove the On/Off column from the table header**

Delete `<th class="rk-onoff">On/Off</th>` from `<thead>`.

- [ ] **Step 5: Remove the On/Off cells from every row**

Delete each `<td class="rk-onoff">…</td>`:
- the empty one in the **totals row**,
- the `<label class="rk-switch">…</label>` cell in the **campaign row**,
- the empty ones in the **adset subrow** and **ad subrow**.

- [ ] **Step 6: Remove the bulk action bar**

Delete the whole `{#if selectedCampaigns.size > 0}<div class="rk-bulkbar">…</div>{/if}` block (admin lines ~788-796).

- [ ] **Step 7: Remove the budget-edit pencil and the budget dialog**

- In the budget table cell, remove only the pencil button, keeping the value/subtext:
```
FROM: {#if col.key === 'budget' && (c.dailyBudget || c.lifetimeBudget)}<button onclick={() => openBudgetEdit(c)} title="Editează buget" aria-label="Editează buget"><Pencil size={10} /></button>{/if}
TO:   (delete this fragment)
```
Then remove the now-unused `Pencil` lucide import.
- Delete the entire `<!-- Budget edit dialog --> <Dialog.Root …>…</Dialog.Root>` block at the end of the file (admin lines ~942-968).

- [ ] **Step 8: Fix table column counts after dropping the On/Off column**

The admin fixed-column count was 5 (checkbox + onoff + name + status + actions); it is now **4**.
```
FROM: const colCount = $derived(visibleCols.length + 5);
TO:   const colCount = $derived(visibleCols.length + 4);
```
Then update every `colspan` that referenced the old layout. Search the template:
```bash
grep -n "colCount - 2\|colspan" "src/routes/client/[tenant]/(app)/reports/facebook-ads/+page.svelte"
```
The adset/ad loader rows used `colspan={colCount - 2}` to span past the 2 leading `chkcell`+`onoff` cells; there is now only 1 leading `chkcell` cell before the sticky name, so change those to `colspan={colCount - 1}`. Verify each loader row visually spans the full remaining width.

- [ ] **Step 9: Run svelte-check — write-control errors gone; expect only clientName-related errors (fixed in Task 5)**

```bash
cd /Users/augustin598/Projects/CRM/app && NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --threshold warning 2>&1 | tail -8
```

---

### Task 5: Adapt account source, owner filter, and client-facing messaging

**Files:**
- Modify: `app/src/routes/client/[tenant]/(app)/reports/facebook-ads/+page.svelte`

`getMyAdAccounts` returns `clientId` but NOT `clientName`, and this is a single-client portal — so the Owner filter and client-name suffixes go away.

- [ ] **Step 1: Neutralize the Owner filter**

```
FROM: const ownerOptions = $derived([...new Set(accounts.map((a: any) => a.clientName).filter(Boolean))] as string[]);
TO:   const ownerOptions: string[] = [];
```
`FilterBar` hides the Owner chip when `owners.length === 0`, and `passesFilters` only applies `filters.owner` when it is truthy (it never becomes truthy now), so no other change is needed. Leave the `<FilterBar … owners={ownerOptions} … />` prop as-is (now `[]`).

- [ ] **Step 2: Simplify the account `<option>` label (no clientName)**

```
FROM: <option value={account.metaAdAccountId}>{account.accountName || account.metaAdAccountId}{#if account.clientName} — {account.clientName}{/if}{#if account.integrationActive === false} ⚠{/if}</option>
TO:   <option value={account.metaAdAccountId}>{account.accountName || account.metaAdAccountId}{#if account.integrationActive === false} ⚠{/if}</option>
```

- [ ] **Step 3: Remove admin-only header affordances**

- Delete the bookmark button: `<button class="rk-icon-btn" title="Salvează ca favorit" …><Bookmark size={15} /></button>` and its now-unused `Bookmark` import.
- Delete the Monitoring link: `<a href="/{tenantSlug}/reports/facebook-ads/monitoring" …><button class="rk-hbtn"><Target size={14} /> Monitoring</button></a>` and, if `Target` is now unreferenced, its import (check svelte-check warnings).

- [ ] **Step 4: Adapt connection/error messaging to the client (no Settings links)**

Clients cannot reconnect integrations, so replace "Settings → Meta Ads" links with a plain instruction to contact the admin:
- **tokenWarning texts** (the `text:` strings in the `tokenWarning` derived): change trailing "Reconectează din Settings." → "Contactează administratorul pentru reconectare."
- **tokenWarning template** link `<a href="/{tenantSlug}/settings/meta-ads">Settings → Meta Ads</a>` → remove the anchor, leave the adapted text.
- **insightsError template** link `<a href="/{tenantSlug}/settings/meta-ads">Settings → Meta Ads</a>` → replace with plain text "Contactează administratorul pentru reconectare."
- **empty-accounts card**: `Conectează un Business Manager din <a …>Settings</a>.` → "Nu sunt conturi Meta Ads asociate profilului tău. Contactează administratorul."
- **paymentWarning**: keep the text and the external `https://business.facebook.com/billing` link as-is (that is the client's own Business Manager billing).

- [ ] **Step 5: Run svelte-check — must return to baseline (16 err / 56 warn)**

```bash
cd /Users/augustin598/Projects/CRM/app && NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --threshold warning 2>&1 | tail -6
```
Expected: back to baseline counts. If any "unused import/variable" warnings above baseline remain, delete those imports/vars until counts match.

- [ ] **Step 6: Commit the client page rewrite (Tasks 3–5 together)**

```bash
cd /Users/augustin598/Projects/CRM
git add "app/src/routes/client/[tenant]/(app)/reports/facebook-ads/+page.svelte"
git commit -m "feat(client-reports): Facebook Ads report on rk design, read-only

Rebuild the client portal Facebook Ads page 1:1 with the admin rk design:
dynamic KPIs, rk charts, AdvancedKpi, Audience, Funnel, PlatformSplit, anomaly
banners, previous-period comparison, and the rk campaign table with expandable
adset->ad. Drops all write controls (On/Off, budget edit, bulk pause) and the
owner filter/Monitoring link; account source is getMyAdAccounts and connection
errors tell the client to contact the admin.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Autofixer + final verification

**Files:**
- Verify only (no functional changes unless autofixer flags something).

- [ ] **Step 1: Run svelte-autofixer on the modified/new Svelte files**

Use the Svelte MCP `svelte-autofixer` tool on the rewritten client `+page.svelte` and on the admin `+page.svelte` (its imports changed). Apply any fixes it reports, then re-run it until clean (per project rule: always autofix new/modified components).

- [ ] **Step 2: Final svelte-check — confirm baseline**

```bash
cd /Users/augustin598/Projects/CRM/app && NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --threshold warning 2>&1 | tail -6
```
Expected: 16 err / 56 warn (baseline), no regression.

- [ ] **Step 3: Manual QA in the client portal (dev server on `main`, tenant `ots`, real client)**

Load the client portal Facebook Ads report and confirm:
- [ ] Visual parity with the admin page (header, KPI row, SpendChart+ComboChart, AdvancedKpi, Audience, Funnel, PlatformSplit, rk table).
- [ ] Data loads (KPIs populated, charts render, table rows present, adset→ad expand works).
- [ ] **Zero write controls**: no On/Off switch column, no budget pencil, no bulk pause/play bar.
- [ ] No Owner filter chip; no Monitoring link; no bookmark button.
- [ ] Payment/token banners render with client-appropriate text when applicable (e.g. temporarily point to an account with an expired token, or eyeball the derivation).
- [ ] Account switcher lists only this client's accounts, labels without "— clientName".

- [ ] **Step 4: Apply autofixer fixes commit (only if Step 1 changed files)**

```bash
cd /Users/augustin598/Projects/CRM
git add -A
git commit -m "chore(reports): svelte-autofixer pass on ported Facebook Ads pages

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (author checklist — completed)

**Spec coverage:**
- Extract components to `$lib` → Task 1. ✅
- Update admin importer → Task 1 Step 3. ✅
- Enrich `getMyAdAccounts` (5 fields) → Task 2. ✅
- Client page kept-sections (KPI/charts/advanced/audience/funnel/platform/anomalies/prev-period/table/CSV/toast) → inherited by copying admin (Task 3) and never removed. ✅
- Dropped: On/Off, budget edit, bulk, owner, Monitoring, bookmark → Tasks 4–5. ✅
- Adapted: getMyAdAccounts source, no clientName suffix, client messaging → Tasks 3 & 5. ✅
- SSR unchanged (layout-level `ssr=false`) → no task touches `+layout.ts` or adds `+page.ts`. ✅
- Testing: svelte-check no-regression gates + autofixer + manual QA → every task + Task 6. ✅

**Placeholder scan:** No TBD/TODO; every edit shows concrete before/after. The only intentional lookup is Task 2 Step 1 (read `getReportAdAccounts` for exact column sources) — required because the join shape must match existing code, not guessed.

**Type/name consistency:** `colCount` redefined once (Task 4 Step 8) and the dependent `colspan` updated in the same step. Removed symbols (`updateBudget`, `toggleCampaignStatus`, `openBudgetEdit`, `handleBudgetSave`, `handleToggleStatus`, `bulkToggle`, `Dialog`, `Button`, `Input`, `Pencil`, `Bookmark`, `Play`, `Pause`) are each deleted at both declaration and usage sites within Tasks 4–5.
