# Hosting Products page redesign (`/[tenant]/hosting/products`)

**Date:** 2026-05-20
**Author:** Claude (autonomous run)
**Source:** Claude Design handoff bundle `5nKGNa44LvL9b6M6t9ET-A` → `Hosting Products.html`

## Goal

Replace the current Tailwind/shadcn-styled hosting products admin page with the new "design pack" visual language already adopted by `/[tenant]/hosting/servers`. Preserve the existing data model and packages — only the presentation and a few derived KPIs change.

## Constraints — what stays the same

- **Schema:** `hostingProduct` table is **unchanged**. No migration.
- **Remote API:** existing `getHostingProducts`, `createHostingProduct`, `updateHostingProduct`, `deleteHostingProduct` keep their contracts. We **add** one new query (`getHostingProductStats`) for sold + MRR aggregation.
- **Multi-tenant:** all queries already scope by `tenantId` via `event.locals.tenant.id` + `assertCan(actor, 'admin.hosting.*')`. No change.
- **Packages:** the user's existing products (with their RO names like "WordPress Standard", DA package links, features) **stay** — design is purely a presentation layer.

## Mapping design fields → our schema

| Design field        | Source in our schema                                       | Notes                                  |
| ------------------- | ---------------------------------------------------------- | -------------------------------------- |
| name                | `hostingProduct.name`                                      | direct                                 |
| tagline             | `hostingProduct.description`                               | first line / full                      |
| priceMonth/Year     | `hostingProduct.price` + `billingCycle`                    | single price, no toggle                |
| currency            | `hostingProduct.currency`                                  | direct                                 |
| popular (badge TOP) | `hostingProduct.highlightBadge` non-empty                  | shown as design's "Cel mai vândut"     |
| active              | `hostingProduct.isActive`                                  | direct                                 |
| color               | derived from sortOrder index → rotating PALETTE            | no DB column                           |
| cpu / ram           | **not displayed** (we don't track these per product)       | DA panel doesn't expose vCPU/RAM       |
| disk (GB)           | `daPackage.quota` (MB → GB)                                | from joined DA package                 |
| traffic (GB)        | `daPackage.bandwidth` (MB → GB)                            | from joined DA package                 |
| domains             | `daPackage.maxDomains`                                     | null → "Nelimitat"                     |
| databases           | `daPackage.maxDatabases`                                   | null → "Nelimitat"                     |
| emails              | `daPackage.maxEmailAccounts`                               | null → "Nelimitat"                     |
| ssl                 | constant ✓ (we always include Let's Encrypt)               | hardcoded                              |
| backups             | derived from `features[]` (first match) or fallback string | "zilnic" default                       |
| phpVersions         | not stored — generic line "PHP 7.4 – 8.3" in table view    |                                        |
| sold                | **new query** count(hostingAccount where productId = ?)    | active+pending only                    |
| mrr                 | **new query** sum(recurringAmount / cycleMonths) per prod  | per-month equivalent, cents → RON      |

## New remote: `getHostingProductStats`

```ts
export const getHostingProductStats = query(async () => {
  // returns: Record<productId, { sold: number, mrrCents: number }>
  // aggregates hostingAccount per productId, scoped to tenant,
  // only includes status IN ('active', 'pending', 'suspended')  // suspended still has MRR commitment? — no, count active only.
  // mrrCents = sum(recurringAmount / cycleMonths)
});
```

Cycle months map: `monthly: 1, quarterly: 3, semiannually: 6, biannually: 6, annually: 12, biennially: 24, triennially: 36, one_time: null (excluded)`.

## Page structure (single `+page.svelte`)

```
<div class="hst-page">
  ├── Hero (h1 + p + actions: "Vezi pagina publică" + "Produs nou")
  ├── KPIs (6 tiles: Produse, Total conturi, MRR pachete, ARPU, Cel mai vândut, Inactive)
  ├── Toolbar (right-aligned view toggle: Carduri | Tabel comparativ)
  ├── Cards grid OR Comparison table  ← {#if view === 'cards'} … {:else} …
  ├── Empty state (no products yet)
  └── Modals: ProductModal (new/edit/duplicate), DeleteConfirm
</div>
```

Toasts via existing `svelte-sonner` (skip the design's custom toast host — `Toaster` already in app shell).

## Cards view

Each card shows:
- Color stripe + name (h3)
- Optional badge "Cel mai vândut" (top-left ribbon) when `highlightBadge` non-empty
- Optional "Inactiv" badge (top-right) when `!isActive`
- Tagline (description)
- Price block: `{price} {currency} / {cycleLabel}`
- Specs list (with green check icons): disk, traffic, domains, databases, emails, SSL, backup type
- Features list (from `features[]`) — bulleted, secondary section
- Stats foot: "Conturi · MRR" `{sold} · {mrr.toLocaleString('ro-RO')} RON`
- Action buttons: Edit (pencil), Duplicate (copy), More menu (toggle popular, toggle active, preview public, delete)

## Table view (comparison)

Rows: Preț, vCPU (—), RAM (—), Disk, Trafic, Domenii, Baze de date, Email, SSL, Backup, PHP versions, Conturi vândute, MRR.

Columns: one per product with mini header (color + name + TOP/OFF pills + Edit/Duplicate/Delete buttons).

## Edit modal (ProductModal)

Two columns — form on left, live preview card on right (matching design exactly).

**Form sections:**
1. **Identitate:** name, color (palette grid), tagline (= description), highlight badge.
2. **Prețuri:** price, currency, billing cycle (dropdown). _No separate yearly price — we use one cycle._
3. **Caracteristici / Features:** textarea (one per line, same as current page).
4. **DirectAdmin link:** server dropdown + package dropdown (existing UX, restyled).
5. **Setup fee + sort order + isPublic + publicSortOrder.**
6. **Active checkbox.**

**Right preview** mirrors the public card with live updates.

Mode-specific behavior:
- `new`: opens empty form
- `edit`: opens with product data
- `duplicate`: clones product, sets name = `"{name} (copie)"`, isActive=true, behaves like `new` on save

## Delete modal

Same as design — warns if accounts exist on this product (count from stats). Offers "Doar dezactivează" alongside "Șterge definitiv".

Since our backend `deleteHostingProduct` is already a **soft delete** (sets `isActive = false`), both options should map to that. Future: real hard-delete needs a separate command — out of scope for this redesign.

For now:
- "Doar dezactivează" → `updateHostingProduct({ isActive: false })`
- "Șterge definitiv" → `deleteHostingProduct(id)` (still soft, since we don't have hard delete)

## Styles

- Inline in `<style>` block, scoped to this page (same convention as `servers/+page.svelte`)
- No external CSS dependency on the design pack — we copy the relevant rules

## Out of scope (future)

- vCPU / RAM / PHP versions / explicit backup tier columns (would need migration to add fields)
- Monthly/Yearly toggle (would need two prices per product — currently one)
- Hard delete (current `deleteHostingProduct` is soft)
- Drag-to-reorder products (could be added via sortOrder later)

## Implementation order

1. Extend `hosting-products.remote.ts` with `getHostingProductStats` query.
2. Rewrite `+page.svelte`:
   a. Imports + state
   b. Helpers (formatRON, cycleLabel, cycleMonths, mrrPerMonth)
   c. Hero + KPIs
   d. Toolbar + view toggle
   e. Cards grid
   f. Comparison table
   g. Product modal (form + preview)
   h. Delete modal
   i. Styles (~700 lines)
3. Run `svelte-check`, `svelte-autofixer`.
4. Manual visual review.
5. Internal review (skill).
6. Gemini second opinion.
7. Commit + push.
