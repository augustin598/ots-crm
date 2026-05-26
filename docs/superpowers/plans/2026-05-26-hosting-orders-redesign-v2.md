# Hosting Orders Redesign v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the new "Comenzi hosting" admin UI from the 4 reference screenshots and back it with `order_number` (sequential per-tenant) + a proper `hosting_inquiry_item` line-items table so the design renders real persisted facts.

**Architecture:** Three small backend additions (one column, one table, one return-shape change) feed the new UI. Public-form submit (`public-hosting.remote.ts`) writes one item per cart line at order time. Existing remote functions (`acceptHostingOrderPayment`, `provisionFromInquiry`, etc.) are NOT touched. The `+page.svelte` is rewritten end-to-end with a new `--hod-*` design system. A one-shot Node script backfills existing rows. Stripe refund is NOT implemented in this iteration — the Refund button is a `toast.info('Funcție în curând')` placeholder.

**Tech Stack:** SvelteKit 5 (runes), Drizzle ORM, Turso/libSQL, TypeScript, bun:test, lucide-svelte, svelte-sonner.

**Spec:** [`docs/superpowers/specs/2026-05-26-hosting-orders-ui-redesign-design.md`](../specs/2026-05-26-hosting-orders-ui-redesign-design.md)

---

## File Structure

**Created:**
- `app/src/lib/utils/hosting-order-id.ts` — `displayOrderId` helper (single source of truth for `OTS-XXXXX` formatting).
- `app/src/lib/utils/__tests__/hosting-order-id.test.ts` — bun:test for the helper.
- `app/drizzle/0381_hosting_inquiry_order_number.sql` — add column.
- `app/drizzle/0382_hosting_inquiry_order_number_unique.sql` — UNIQUE index per tenant.
- `app/drizzle/0383_hosting_inquiry_item_create.sql` — new table.
- `app/drizzle/0384_hosting_inquiry_item_inquiry_idx.sql` — index on `inquiry_id`.
- `app/drizzle/0385_hosting_inquiry_item_tenant_idx.sql` — index on `tenant_id`.
- `app/scripts/backfill-hosting-order-numbers-and-items.ts` — one-shot backfill.

**Modified:**
- `app/src/lib/server/db/schema.ts` — add `orderNumber` column, add `hostingInquiryItem` table.
- `app/drizzle/meta/_journal.json` — append 5 entries.
- `app/src/lib/remotes/public-hosting.remote.ts` — extend `OrderSchema`, insert `orderNumber` subquery at 6 insert sites, insert items.
- `app/src/lib/components/hosting-checkout-modal.svelte` — pass `domainName`, `domainMode`, `domainCostCents` in submit payload.
- `app/src/lib/remotes/hosting-inquiries.remote.ts` — extend `HostingOrderRow` with `orderNumber` + `items`, modify `getHostingOrders` to fetch items.
- `app/src/routes/[tenant]/hosting/inquiries/+page.svelte` — full rewrite (script additions + new markup + new styles).

---

### Task 1: Display-ID helper + test

**Files:**
- Create: `app/src/lib/utils/hosting-order-id.ts`
- Create: `app/src/lib/utils/__tests__/hosting-order-id.test.ts`

- [ ] **Step 1: Write the test**

`app/src/lib/utils/__tests__/hosting-order-id.test.ts`:
```ts
import { describe, test, expect } from 'bun:test';
import { displayOrderId } from '../hosting-order-id';

describe('displayOrderId', () => {
	test('formats a sequential order number with zero-padding to 5 digits', () => {
		expect(displayOrderId(1, 'abc123')).toBe('OTS-00001');
		expect(displayOrderId(48217, 'abc123')).toBe('OTS-48217');
		expect(displayOrderId(99999, 'abc123')).toBe('OTS-99999');
	});

	test('does not truncate numbers larger than 5 digits', () => {
		expect(displayOrderId(123456, 'abc')).toBe('OTS-123456');
	});

	test('falls back to first 5 chars of uuid uppercased when orderNumber is null', () => {
		expect(displayOrderId(null, 'abcdefghij')).toBe('OTS-ABCDE');
	});

	test('falls back to first 5 chars even when uuid is shorter than 5', () => {
		expect(displayOrderId(null, 'abc')).toBe('OTS-ABC');
	});

	test('handles a zero order number as a real number, not null', () => {
		// 0 is a legal pre-increment value; should pad like any other.
		expect(displayOrderId(0, 'abc')).toBe('OTS-00000');
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/augustin598/Projects/CRM/app && bun test src/lib/utils/__tests__/hosting-order-id.test.ts
```

Expected: `FAIL` — module not found.

- [ ] **Step 3: Implement the helper**

`app/src/lib/utils/hosting-order-id.ts`:
```ts
/**
 * Format a hosting-inquiry display ID. Uses the sequential `order_number`
 * (assigned at INSERT time, tenant-scoped) when available. Falls back to
 * the first 5 chars of the random `id` for the brief window between schema
 * deploy and backfill completion, OR for any orphaned row that somehow
 * escaped the backfill (defensive — should never appear in production).
 *
 * NOT a legal invoice number — Keez assigns those separately (RON-YYYY-NNNNNN,
 * monotonic, no gaps). This is for internal CRM tracking only.
 */
export function displayOrderId(orderNumber: number | null, fallbackId: string): string {
	if (orderNumber == null) return 'OTS-' + fallbackId.slice(0, 5).toUpperCase();
	return 'OTS-' + String(orderNumber).padStart(5, '0');
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/augustin598/Projects/CRM/app && bun test src/lib/utils/__tests__/hosting-order-id.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/augustin598/Projects/CRM && git add app/src/lib/utils/hosting-order-id.ts app/src/lib/utils/__tests__/hosting-order-id.test.ts
git commit -m "feat(hosting-orders): displayOrderId helper + tests"
```

---

### Task 2: Schema — add `orderNumber` column + `hostingInquiryItem` table

**Files:**
- Modify: `app/src/lib/server/db/schema.ts`

- [ ] **Step 1: Add `orderNumber` field to `hostingInquiry`**

Open `app/src/lib/server/db/schema.ts`. Inside the `hostingInquiry` block (around line 1124, right after `requestedDomain`), add:

```ts
		// Sequential per-tenant order counter (NOT a legal invoice number — Keez
		// issues those independently). Assigned at INSERT time using
		// `(SELECT COALESCE(MAX(order_number), 0) + 1 FROM hosting_inquiry WHERE tenant_id = ?)`.
		// libSQL single-writer serialization makes the subquery race-free; the
		// `hosting_inquiry_tenant_order_idx` UNIQUE index is the safety guard.
		orderNumber: integer('order_number'),
```

- [ ] **Step 2: Add `hostingInquiryItem` table at the END of the file (or right after `hostingInquiry` block)**

```ts
/**
 * Line items for a hosting inquiry — one row per cart line at order time.
 * Today: one 'hosting' row (always) + optional 'domain' row. Future: 'ssl',
 * 'backup', etc. Prices are TTC snapshots — immune to future product/TLD
 * price changes. Used by the admin Comenzi hosting page (line items section
 * in the drawer) and the Keez invoice emitter.
 */
export const hostingInquiryItem = sqliteTable(
	'hosting_inquiry_item',
	{
		id: text('id').primaryKey(),
		inquiryId: text('inquiry_id')
			.notNull()
			.references(() => hostingInquiry.id, { onDelete: 'cascade' }),
		tenantId: text('tenant_id')
			.notNull()
			.references(() => tenant.id),
		kind: text('kind').notNull(), // 'hosting' | 'domain' | 'ssl' | 'backup' (future)
		label: text('label').notNull(), // 'Hosting Pro (anual)', 'Domeniu andreimarinescu.ro'
		hostingProductId: text('hosting_product_id').references(() => hostingProduct.id, {
			onDelete: 'set null'
		}),
		unitPriceCents: integer('unit_price_cents').notNull(), // TTC at order time
		quantity: integer('quantity').notNull().default(1),
		vatRate: integer('vat_rate').notNull().default(19), // percent; 19 for RO standard
		domainName: text('domain_name'), // nullable for non-domain items
		domainMode: text('domain_mode'), // 'buy' | 'have' | 'transfer'; nullable
		createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
			.notNull()
			.default(sql`current_timestamp`)
	},
	(t) => [
		index('hosting_inquiry_item_inquiry_idx').on(t.inquiryId),
		index('hosting_inquiry_item_tenant_idx').on(t.tenantId)
	]
);
```

- [ ] **Step 3: Verify types compile**

```bash
cd /Users/augustin598/Projects/CRM/app && bunx svelte-check --threshold warning src/lib/server/db/schema.ts 2>&1 | tail -20
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/augustin598/Projects/CRM && git add app/src/lib/server/db/schema.ts
git commit -m "feat(hosting-orders): schema for order_number + hostingInquiryItem"
```

---

### Task 3: Migration 0381 — `order_number` column

**Files:**
- Create: `app/drizzle/0381_hosting_inquiry_order_number.sql`

- [ ] **Step 1: Write the migration**

`app/drizzle/0381_hosting_inquiry_order_number.sql`:
```sql
ALTER TABLE hosting_inquiry ADD COLUMN order_number INTEGER;
```

- [ ] **Step 2: Commit**

```bash
cd /Users/augustin598/Projects/CRM && git add app/drizzle/0381_hosting_inquiry_order_number.sql
git commit -m "feat(hosting-orders): migration 0381 add order_number column"
```

---

### Task 4: Migration 0382 — UNIQUE `(tenant_id, order_number)` index

**Files:**
- Create: `app/drizzle/0382_hosting_inquiry_order_number_unique.sql`

- [ ] **Step 1: Write the migration**

`app/drizzle/0382_hosting_inquiry_order_number_unique.sql`:
```sql
CREATE UNIQUE INDEX hosting_inquiry_tenant_order_idx
  ON hosting_inquiry(tenant_id, order_number);
```

Note: SQLite treats `NULL` values as distinct in a UNIQUE index, so legacy rows with `order_number IS NULL` won't conflict during the deploy → backfill window.

- [ ] **Step 2: Commit**

```bash
cd /Users/augustin598/Projects/CRM && git add app/drizzle/0382_hosting_inquiry_order_number_unique.sql
git commit -m "feat(hosting-orders): migration 0382 unique tenant+order_number"
```

---

### Task 5: Migration 0383 — `hosting_inquiry_item` table

**Files:**
- Create: `app/drizzle/0383_hosting_inquiry_item_create.sql`

- [ ] **Step 1: Write the migration**

`app/drizzle/0383_hosting_inquiry_item_create.sql`:
```sql
CREATE TABLE hosting_inquiry_item (
  id TEXT PRIMARY KEY NOT NULL,
  inquiry_id TEXT NOT NULL REFERENCES hosting_inquiry(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenant(id),
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  hosting_product_id TEXT REFERENCES hosting_product(id) ON DELETE SET NULL,
  unit_price_cents INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  vat_rate INTEGER NOT NULL DEFAULT 19,
  domain_name TEXT,
  domain_mode TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

- [ ] **Step 2: Commit**

```bash
cd /Users/augustin598/Projects/CRM && git add app/drizzle/0383_hosting_inquiry_item_create.sql
git commit -m "feat(hosting-orders): migration 0383 create hosting_inquiry_item"
```

---

### Task 6: Migration 0384 — index on `inquiry_id`

**Files:**
- Create: `app/drizzle/0384_hosting_inquiry_item_inquiry_idx.sql`

- [ ] **Step 1: Write the migration**

`app/drizzle/0384_hosting_inquiry_item_inquiry_idx.sql`:
```sql
CREATE INDEX hosting_inquiry_item_inquiry_idx ON hosting_inquiry_item(inquiry_id);
```

- [ ] **Step 2: Commit**

```bash
cd /Users/augustin598/Projects/CRM && git add app/drizzle/0384_hosting_inquiry_item_inquiry_idx.sql
git commit -m "feat(hosting-orders): migration 0384 index inquiry_id"
```

---

### Task 7: Migration 0385 — index on `tenant_id`

**Files:**
- Create: `app/drizzle/0385_hosting_inquiry_item_tenant_idx.sql`

- [ ] **Step 1: Write the migration**

`app/drizzle/0385_hosting_inquiry_item_tenant_idx.sql`:
```sql
CREATE INDEX hosting_inquiry_item_tenant_idx ON hosting_inquiry_item(tenant_id);
```

- [ ] **Step 2: Commit**

```bash
cd /Users/augustin598/Projects/CRM && git add app/drizzle/0385_hosting_inquiry_item_tenant_idx.sql
git commit -m "feat(hosting-orders): migration 0385 index tenant_id"
```

---

### Task 8: Append 5 entries to `_journal.json`

**Files:**
- Modify: `app/drizzle/meta/_journal.json`

- [ ] **Step 1: Read the current journal to confirm the last `when` epoch**

```bash
cd /Users/augustin598/Projects/CRM/app && tail -20 drizzle/meta/_journal.json
```

Note the last entry's `when` and `idx` (should be `idx: 380`, tag `0380_hosting_account_tags`). The new entries follow.

- [ ] **Step 2: Append the 5 new entries**

Open `app/drizzle/meta/_journal.json`. Inside the `"entries"` array, append (after the last entry, BEFORE the closing `]`):

```json
{
  "idx": 381,
  "version": "6",
  "when": 1779800000000,
  "tag": "0381_hosting_inquiry_order_number",
  "breakpoints": true
},
{
  "idx": 382,
  "version": "6",
  "when": 1779800001000,
  "tag": "0382_hosting_inquiry_order_number_unique",
  "breakpoints": true
},
{
  "idx": 383,
  "version": "6",
  "when": 1779800002000,
  "tag": "0383_hosting_inquiry_item_create",
  "breakpoints": true
},
{
  "idx": 384,
  "version": "6",
  "when": 1779800003000,
  "tag": "0384_hosting_inquiry_item_inquiry_idx",
  "breakpoints": true
},
{
  "idx": 385,
  "version": "6",
  "when": 1779800004000,
  "tag": "0385_hosting_inquiry_item_tenant_idx",
  "breakpoints": true
}
```

Make sure to add a comma after the previous last entry. Confirm the JSON parses:

```bash
cd /Users/augustin598/Projects/CRM/app && python3 -c "import json; json.load(open('drizzle/meta/_journal.json'))" && echo "OK"
```

Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
cd /Users/augustin598/Projects/CRM && git add app/drizzle/meta/_journal.json
git commit -m "feat(hosting-orders): journal entries 381-385"
```

---

### Task 9: Apply migrations to dev DB

- [ ] **Step 1: Run the migrator**

```bash
cd /Users/augustin598/Projects/CRM/app && bun run db:migrate 2>&1 | tail -30
```

Expected: 5 migrations applied. No errors.

- [ ] **Step 2: Verify columns + table exist (sqlite3 against local.db)**

```bash
cd /Users/augustin598/Projects/CRM/app && sqlite3 local-ots.db "PRAGMA table_info(hosting_inquiry);" | grep -E "(order_number)"
```

Expected: one row `order_number|INTEGER|0||0` (column 0 nullable).

```bash
cd /Users/augustin598/Projects/CRM/app && sqlite3 local-ots.db "PRAGMA table_info(hosting_inquiry_item);" | wc -l
```

Expected: `12` (12 columns).

```bash
cd /Users/augustin598/Projects/CRM/app && sqlite3 local-ots.db "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name IN ('hosting_inquiry','hosting_inquiry_item') ORDER BY name;"
```

Expected: includes `hosting_inquiry_item_inquiry_idx`, `hosting_inquiry_item_tenant_idx`, `hosting_inquiry_tenant_order_idx`.

- [ ] **Step 3: No commit (this is just DB state)**

---

### Task 10: Extend `OrderSchema` in `public-hosting.remote.ts`

**Files:**
- Modify: `app/src/lib/remotes/public-hosting.remote.ts:674` (OrderSchema)

- [ ] **Step 1: Add 3 fields to the schema**

Open `app/src/lib/remotes/public-hosting.remote.ts`. At the end of the `OrderSchema` object (around line 720, before the closing `})`), add:

```ts
		// Domain breakdown — captured from the checkout modal so the admin
		// drawer + future invoice can show a real line for the domain. `buy` =
		// new registration (cost paid now). `have`/`transfer` = no cost (the
		// row exists for audit but unit_price_cents stays 0).
		domainName: v.optional(v.pipe(v.string(), v.maxLength(253))),
		domainMode: v.optional(v.picklist(['buy', 'have', 'transfer'])),
		domainCostCents: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0)))
```

If the previous field doesn't already have a trailing comma, add one.

- [ ] **Step 2: Run svelte-check**

```bash
cd /Users/augustin598/Projects/CRM/app && bunx svelte-check --threshold warning src/lib/remotes/public-hosting.remote.ts 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/augustin598/Projects/CRM && git add app/src/lib/remotes/public-hosting.remote.ts
git commit -m "feat(hosting-orders): OrderSchema accepts domain breakdown"
```

---

### Task 11: Add `orderNumber` subquery + items insert to all 6 inquiry inserts

**Files:**
- Modify: `app/src/lib/remotes/public-hosting.remote.ts` at lines 233, 832, 905, 955, 1030, 1097 (6 insert sites)

**Background:** There are 6 `db.insert(table.hostingInquiry).values({...})` call sites. Each one needs:
1. `orderNumber: sql\`(SELECT COALESCE(MAX(order_number), 0) + 1 FROM hosting_inquiry WHERE tenant_id = ${tenantId})\`` in the values block.
2. A follow-up insert into `hostingInquiryItem` for hosting + optional domain.

Define a helper at the top of the file (after the existing `generateId` at line 40) to centralize the items insert so we don't duplicate code 6 times.

- [ ] **Step 1: Add the helper**

After line 42 (after `generateId`), insert:

```ts
import { hostingInquiryItem } from '$lib/server/db/schema';
// (only add the import if it's not already there — check existing imports first)

/**
 * Insert line items for a fresh hosting inquiry. Centralized to avoid
 * duplicating this logic across the 6 inquiry-insert call sites.
 */
async function insertInquiryItems(args: {
	inquiryId: string;
	tenantId: string;
	product: { id: string; name: string; price: number; billingCycle: string | null } | null;
	domainName: string | undefined;
	domainMode: 'buy' | 'have' | 'transfer' | undefined;
	domainCostCents: number | undefined;
}): Promise<void> {
	const items: (typeof hostingInquiryItem.$inferInsert)[] = [];

	if (args.product) {
		const period = args.product.billingCycle === 'yearly' ? 'anual' : 'lunar';
		items.push({
			id: generateId(),
			inquiryId: args.inquiryId,
			tenantId: args.tenantId,
			kind: 'hosting',
			label: `${args.product.name} (${period})`,
			hostingProductId: args.product.id,
			unitPriceCents: args.product.price,
			quantity: 1,
			vatRate: 19
		});
	}

	if (args.domainName) {
		if (args.domainMode === 'buy' && (args.domainCostCents ?? 0) > 0) {
			items.push({
				id: generateId(),
				inquiryId: args.inquiryId,
				tenantId: args.tenantId,
				kind: 'domain',
				label: `Domeniu ${args.domainName}`,
				unitPriceCents: args.domainCostCents!,
				quantity: 1,
				vatRate: 19,
				domainName: args.domainName,
				domainMode: 'buy'
			});
		} else if (args.domainMode === 'have' || args.domainMode === 'transfer') {
			const modeLabel = args.domainMode === 'have' ? 'existent' : 'transfer';
			items.push({
				id: generateId(),
				inquiryId: args.inquiryId,
				tenantId: args.tenantId,
				kind: 'domain',
				label: `Domeniu ${args.domainName} (${modeLabel})`,
				unitPriceCents: 0,
				quantity: 1,
				vatRate: 19,
				domainName: args.domainName,
				domainMode: args.domainMode
			});
		}
	}

	if (items.length) await db.insert(hostingInquiryItem).values(items);
}
```

If `hostingInquiryItem` is already exported from `$lib/server/db/schema` via the `table.*` import alias, use `table.hostingInquiryItem` instead and skip the standalone import. (Check what the file currently does — preserve the pattern.)

- [ ] **Step 2: Patch each of the 6 insert sites — add `orderNumber` subquery**

For each `db.insert(table.hostingInquiry).values({...})` at lines 233, 832, 905, 955, 1030, 1097, add this property to the values object (alongside `id`, `tenantId`, etc.):

```ts
orderNumber: sql`(SELECT COALESCE(MAX(order_number), 0) + 1 FROM hosting_inquiry WHERE tenant_id = ${tenantId})`,
```

`sql` must be imported from `drizzle-orm`. Verify the import exists at the top of the file:

```bash
cd /Users/augustin598/Projects/CRM/app && head -30 src/lib/remotes/public-hosting.remote.ts | grep "drizzle-orm"
```

If `sql` is not imported, add it: `import { sql, ... } from 'drizzle-orm';`.

- [ ] **Step 3: Patch each of the 6 insert sites — call the items helper**

After each `db.insert(table.hostingInquiry).values({...})` (or the surrounding `await` if it's wrapped in a transaction), add:

```ts
await insertInquiryItems({
	inquiryId: <inquiryIdVar>,  // 'id' at line 233; 'inquiryId' at lines 832, 905, 955, 1030, 1097
	tenantId,
	product: product ?? null,  // local var holding the loaded hostingProduct (or null)
	domainName: data.domainName,
	domainMode: data.domainMode,
	domainCostCents: data.domainCostCents
});
```

The `<inquiryIdVar>` is whatever local variable holds the inquiry id at that call site — read each block and use the matching name. Check around each insert by reading lines [N-5, N+5] before patching.

For the call sites that DON'T load a `product` variable (e.g. duplicate-CUI race path that already exists at line 832), call `await loadHostingProductIfAny(data.hostingProductId, tenantId)` first OR pass `product: null` (the line item insert tolerates missing product — only the hosting line is skipped). The simpler change is to pass `null` at those sites; the synthetic hosting line is fine to skip for race-recovery inquiries (they'll get the line at the real submit).

Actually simpler: at every site, look at the surrounding block. If a `product` (or similarly-named row from a SELECT against `hostingProduct`) is in scope, use it. Otherwise pass `null`. The backfill won't run for new rows — they'll appear with just a domain line, which is acceptable for race-recovery rows.

- [ ] **Step 4: svelte-check**

```bash
cd /Users/augustin598/Projects/CRM/app && bunx svelte-check --threshold warning src/lib/remotes/public-hosting.remote.ts 2>&1 | tail -20
```

Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/augustin598/Projects/CRM && git add app/src/lib/remotes/public-hosting.remote.ts
git commit -m "feat(hosting-orders): assign order_number + write line items on submit"
```

---

### Task 12: Checkout modal — pass `domainName`/`Mode`/`CostCents` to submit

**Files:**
- Modify: `app/src/lib/components/hosting-checkout-modal.svelte:979` (the `submitHostingOrder({...})` call)

- [ ] **Step 1: Read the existing submit call**

```bash
cd /Users/augustin598/Projects/CRM/app && sed -n '975,1000p' src/lib/components/hosting-checkout-modal.svelte
```

Confirm the structure of the existing payload object.

- [ ] **Step 2: Add the 3 new fields to the payload**

In the `submitHostingOrder({...})` call (around line 979), add:

```ts
				domainName: (domainName + domainTld).toLowerCase(),
				domainMode,
				domainCostCents: domainMode === 'buy' ? Math.round(tldPrice * 100) : 0,
```

These existing variables in the modal already hold the right values:
- `domainName` (`$state(''))` — the bare SLD typed by the customer
- `domainTld` (`$state('.ro'))` — selected TLD (e.g. `.ro`)
- `domainMode` (`$state<'buy'|'have'|'transfer'>(...)`)
- `tldPrice` (`$derived(...)` from `TLDs` array, RON integer like `49`)

- [ ] **Step 3: svelte-check**

```bash
cd /Users/augustin598/Projects/CRM/app && bunx svelte-check --threshold warning src/lib/components/hosting-checkout-modal.svelte 2>&1 | tail -10
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/augustin598/Projects/CRM && git add app/src/lib/components/hosting-checkout-modal.svelte
git commit -m "feat(hosting-orders): checkout modal sends domain breakdown to backend"
```

---

### Task 13: Extend `HostingOrderRow` + `getHostingOrders` to return items

**Files:**
- Modify: `app/src/lib/remotes/hosting-inquiries.remote.ts:135` (type), `:177-246` (query)

- [ ] **Step 1: Extend the type**

In `app/src/lib/remotes/hosting-inquiries.remote.ts`, locate the `export type HostingOrderRow = {` block (line ~135). Above it, add a new exported type:

```ts
export type HostingOrderItemRow = {
	id: string;
	kind: string;
	label: string;
	unitPriceCents: number;
	quantity: number;
	vatRate: number;
	domainName: string | null;
	domainMode: string | null;
};
```

Then inside `HostingOrderRow`, add 2 new fields at the end (before the closing `};`):

```ts
	orderNumber: number | null;
	items: HostingOrderItemRow[];
```

- [ ] **Step 2: Select `orderNumber` in the main query**

In `getHostingOrders` (line ~177), inside the `.select({...})` block, add this line near the other `hostingInquiry.*` fields (e.g. right after `id: table.hostingInquiry.id`):

```ts
				orderNumber: table.hostingInquiry.orderNumber,
```

- [ ] **Step 3: Fetch items in parallel + group them**

Replace the trailing `return rows as HostingOrderRow[];` (line ~245) with:

```ts
	if (rows.length === 0) return [];

	const inquiryIds = rows.map((r) => r.id);
	const itemRows = await db
		.select({
			id: table.hostingInquiryItem.id,
			inquiryId: table.hostingInquiryItem.inquiryId,
			kind: table.hostingInquiryItem.kind,
			label: table.hostingInquiryItem.label,
			unitPriceCents: table.hostingInquiryItem.unitPriceCents,
			quantity: table.hostingInquiryItem.quantity,
			vatRate: table.hostingInquiryItem.vatRate,
			domainName: table.hostingInquiryItem.domainName,
			domainMode: table.hostingInquiryItem.domainMode
		})
		.from(table.hostingInquiryItem)
		.where(
			and(
				eq(table.hostingInquiryItem.tenantId, tenantId),
				inArray(table.hostingInquiryItem.inquiryId, inquiryIds)
			)
		);

	const byInquiry = new Map<string, HostingOrderItemRow[]>();
	for (const it of itemRows) {
		const arr = byInquiry.get(it.inquiryId) ?? [];
		arr.push({
			id: it.id,
			kind: it.kind,
			label: it.label,
			unitPriceCents: it.unitPriceCents,
			quantity: it.quantity,
			vatRate: it.vatRate,
			domainName: it.domainName,
			domainMode: it.domainMode
		});
		byInquiry.set(it.inquiryId, arr);
	}

	return rows.map((r) => ({ ...r, items: byInquiry.get(r.id) ?? [] })) as HostingOrderRow[];
```

If `inArray` is not yet imported from `drizzle-orm`, add it to the existing drizzle-orm import.

- [ ] **Step 4: svelte-check**

```bash
cd /Users/augustin598/Projects/CRM/app && bunx svelte-check --threshold warning src/lib/remotes/hosting-inquiries.remote.ts 2>&1 | tail -10
```

Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/augustin598/Projects/CRM && git add app/src/lib/remotes/hosting-inquiries.remote.ts
git commit -m "feat(hosting-orders): getHostingOrders returns orderNumber + items"
```

---

### Task 14: Backfill script

**Files:**
- Create: `app/scripts/backfill-hosting-order-numbers-and-items.ts`

- [ ] **Step 1: Write the script**

`app/scripts/backfill-hosting-order-numbers-and-items.ts`:
```ts
/**
 * One-shot backfill for the May 2026 Comenzi hosting redesign.
 *
 * Run: `cd app && bun run scripts/backfill-hosting-order-numbers-and-items.ts`
 *
 * Idempotent — safe to re-run. Numbers rows that already have `order_number`
 * are skipped; inquiries that already have at least one item row are skipped.
 *
 * Order of operations matters: we run this AFTER migrations 0381-0385 have
 * been applied and BEFORE deploying code that depends on either column being
 * populated.
 */
import { db } from '../src/lib/server/db';
import {
	hostingInquiry,
	hostingInquiryItem,
	hostingProduct
} from '../src/lib/server/db/schema';
import { and, eq, isNull, sql, notExists } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

async function main(): Promise<void> {
	let numbered = 0;
	let synthesized = 0;

	// 1. Assign order_number to rows missing one, grouped by tenant.
	const tenantsWithMissing = await db
		.selectDistinct({ tenantId: hostingInquiry.tenantId })
		.from(hostingInquiry)
		.where(isNull(hostingInquiry.orderNumber));

	for (const { tenantId } of tenantsWithMissing) {
		const rows = await db
			.select({ id: hostingInquiry.id })
			.from(hostingInquiry)
			.where(and(eq(hostingInquiry.tenantId, tenantId), isNull(hostingInquiry.orderNumber)))
			.orderBy(hostingInquiry.createdAt);

		const [{ maxN }] = await db
			.select({ maxN: sql<number>`COALESCE(MAX(order_number), 0)` })
			.from(hostingInquiry)
			.where(eq(hostingInquiry.tenantId, tenantId));

		let n = maxN ?? 0;
		for (const row of rows) {
			n += 1;
			await db.update(hostingInquiry).set({ orderNumber: n }).where(eq(hostingInquiry.id, row.id));
			numbered += 1;
		}
	}

	console.log(`[backfill] Assigned order_number to ${numbered} rows.`);

	// 2. Synthesize one 'hosting' item per inquiry that has zero items today.
	const missing = await db
		.select({
			id: hostingInquiry.id,
			tenantId: hostingInquiry.tenantId,
			productId: hostingInquiry.hostingProductId,
			productName: hostingProduct.name,
			productPrice: hostingProduct.price,
			productCycle: hostingProduct.billingCycle
		})
		.from(hostingInquiry)
		.leftJoin(hostingProduct, eq(hostingInquiry.hostingProductId, hostingProduct.id))
		.where(
			notExists(
				db
					.select({ x: sql<number>`1` })
					.from(hostingInquiryItem)
					.where(eq(hostingInquiryItem.inquiryId, hostingInquiry.id))
			)
		);

	for (const r of missing) {
		// Skip inquiries with no product (legacy contact-form submissions that
		// never picked a product). These render in the UI as "—" pachet and the
		// drawer line-items section is empty — acceptable.
		if (!r.productPrice || !r.productName) continue;
		const period = r.productCycle === 'yearly' ? 'anual' : 'lunar';
		await db.insert(hostingInquiryItem).values({
			id: generateId(),
			inquiryId: r.id,
			tenantId: r.tenantId,
			kind: 'hosting',
			label: `${r.productName} (${period})`,
			hostingProductId: r.productId,
			unitPriceCents: r.productPrice,
			quantity: 1,
			vatRate: 19
		});
		synthesized += 1;
	}

	console.log(`[backfill] Synthesized ${synthesized} hosting items.`);
	console.log('[backfill] Done.');
}

main()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error('[backfill] FAILED:', err);
		process.exit(1);
	});
```

- [ ] **Step 2: Run the backfill against the dev DB**

```bash
cd /Users/augustin598/Projects/CRM/app && bun run scripts/backfill-hosting-order-numbers-and-items.ts
```

Expected output (counts depend on local data):
```
[backfill] Assigned order_number to N rows.
[backfill] Synthesized N hosting items.
[backfill] Done.
```

- [ ] **Step 3: Verify backfill worked**

```bash
cd /Users/augustin598/Projects/CRM/app && sqlite3 local-ots.db "SELECT COUNT(*) FROM hosting_inquiry WHERE order_number IS NULL;"
```

Expected: `0`.

```bash
cd /Users/augustin598/Projects/CRM/app && sqlite3 local-ots.db "SELECT COUNT(*) FROM hosting_inquiry_item;"
```

Expected: ≥ count of inquiries that have a product, > 0 if there's any local data.

- [ ] **Step 4: Run the script a second time and confirm idempotency**

```bash
cd /Users/augustin598/Projects/CRM/app && bun run scripts/backfill-hosting-order-numbers-and-items.ts
```

Expected: `Assigned order_number to 0 rows. Synthesized 0 hosting items.`

- [ ] **Step 5: Commit**

```bash
cd /Users/augustin598/Projects/CRM && git add app/scripts/backfill-hosting-order-numbers-and-items.ts
git commit -m "feat(hosting-orders): one-shot backfill script for orders + items"
```

---

### Task 15: Rewrite `+page.svelte` — script section additions

**Files:**
- Modify: `app/src/routes/[tenant]/hosting/inquiries/+page.svelte` — `<script>` block

The script currently spans lines 1–470. We're adding 3 things:
1. Import `displayOrderId` + `HostingOrderItemRow` type.
2. Add `buildHistory()` helper.
3. Add `lineItems()`, `lineTotalCents()`, `lineTvaCents()` helpers.
4. Adjust `methodLabel()` if needed (no change today).
5. Add an active-tab `$state` for the new tabs row (replacing the `funnel` chip set).
6. Add `daServerName` lookup helper (already partly there via `getDAServer`).

- [ ] **Step 1: Update imports**

Find the existing imports block (lines 1–37). Add:

```ts
	import { displayOrderId } from '$lib/utils/hosting-order-id';
	import type { HostingOrderItemRow } from '$lib/remotes/hosting-inquiries.remote';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
```

(Some of these may already be imported — verify and only add what's missing.)

- [ ] **Step 2: Add `activeTab` state + replace `funnel` chips logic**

Below the existing `let view = $state<'grid' | 'table'>('grid');` line (~49), add:

```ts
	type ActiveTab = 'all' | 'activity' | 'pending' | 'failed' | 'refunded';
	let activeTab = $state<ActiveTab>('all');
```

Remove the `view` state and the `funnel`/`payment`/`method` chip states — they're replaced by the new tabs + dropdowns. Keep `search` state.

Add these for the new dropdowns:
```ts
	let filterPackage = $state<string>('');  // hostingProductId or ''
	let filterMethod = $state<'all' | 'card' | 'op' | 'paypal' | 'revolut'>('all');
```

- [ ] **Step 3: Replace `applyFilters` to use the new tab + dropdowns**

Replace the existing `applyFilters` (line ~381) with:

```ts
	function applyFilters(list: HostingOrderRow[]): HostingOrderRow[] {
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		return list.filter((o) => {
			// Tab filter
			if (activeTab === 'pending' && o.paymentStatus !== 'pending') return false;
			if (activeTab === 'failed' && o.paymentStatus !== 'failed') return false;
			if (activeTab === 'refunded' && o.paymentStatus !== 'refunded') return false;
			if (activeTab === 'activity') {
				const touched =
					(o.createdAt && new Date(o.createdAt).getTime() >= today.getTime()) ||
					(o.paidAt && new Date(o.paidAt).getTime() >= today.getTime()) ||
					(o.acceptedAt && new Date(o.acceptedAt).getTime() >= today.getTime());
				if (!touched) return false;
			}
			// Dropdown filters
			if (filterPackage && o.hostingProductId !== filterPackage) return false;
			if (filterMethod !== 'all' && o.paymentMethod !== filterMethod) return false;
			// Search
			if (search) {
				const q = search.toLowerCase();
				const hay = [
					displayOrderId(o.orderNumber, o.id),
					o.contactName,
					o.contactEmail,
					o.companyName ?? '',
					o.vatNumber ?? '',
					o.productName ?? '',
					o.daDomain ?? '',
					o.daUsername ?? ''
				]
					.join(' ')
					.toLowerCase();
				if (!hay.includes(q)) return false;
			}
			return true;
		});
	}
```

- [ ] **Step 4: Add history + line-item helpers**

After `function applyFilters(...)`, add:

```ts
	type HistoryEntry = {
		kind: 'placed' | 'paid' | 'failed' | 'provisioning' | 'provisioned' | 'refunded';
		at: Date | string | null;
		label: string;
		meta: string;
	};

	function buildHistory(o: HostingOrderRow, daServerName: string | null): HistoryEntry[] {
		const out: HistoryEntry[] = [];
		out.push({
			kind: 'placed',
			at: o.createdAt,
			label: 'Comandă plasată',
			meta: `de pe /${o.source}`
		});
		if (o.paymentStatus === 'paid') {
			out.push({
				kind: 'paid',
				at: o.paidAt ?? o.acceptedAt ?? o.createdAt,
				label: 'Plată confirmată',
				meta: `${methodLabel(o.paymentMethod)} · ${fmtMoney(o.paidAmountCents, o.productCurrency)}`
			});
		}
		if (o.paymentStatus === 'failed') {
			out.push({
				kind: 'failed',
				at: o.createdAt,
				label: 'Plată eșuată',
				meta: 'Card refuzat de bancă'
			});
		}
		if (o.paymentStatus === 'refunded') {
			out.push({
				kind: 'refunded',
				at: o.acceptedAt ?? o.createdAt,
				label: 'Refundat',
				meta: 'Sumă returnată'
			});
		}
		if (o.hostingAccountId && o.daUsername) {
			out.push({
				kind: 'provisioned',
				at: o.paidAt ?? o.createdAt,
				label: 'Cont DirectAdmin creat',
				meta: `Server ${daServerName ?? '—'} · credențiale trimise pe ${o.contactEmail}`
			});
		} else if (o.paymentStatus === 'paid' && !o.hostingAccountId) {
			out.push({
				kind: 'provisioning',
				at: o.paidAt ?? o.createdAt,
				label: 'Cont în provisionare',
				meta: 'în curs · Server auto-alocat · credențiale în max 5 minute'
			});
		}
		return out;
	}

	/** Sum of all items × quantity, TTC. */
	function lineTotalCents(items: HostingOrderItemRow[]): number {
		return items.reduce((a, it) => a + it.unitPriceCents * it.quantity, 0);
	}

	/** Derived TVA — sum of each item's TVA portion at its own vat_rate. */
	function lineTvaCents(items: HostingOrderItemRow[]): number {
		return items.reduce((a, it) => {
			const lineTtc = it.unitPriceCents * it.quantity;
			return a + Math.round((lineTtc * it.vatRate) / (100 + it.vatRate));
		}, 0);
	}

	/** Visible (non-zero) items — hide "Domeniu X (existent)" lines that have 0 cost. */
	function visibleItems(items: HostingOrderItemRow[]): HostingOrderItemRow[] {
		return items.filter((it) => it.unitPriceCents > 0);
	}

	function billingCycleLabel(cycle: string | null): string {
		if (cycle === 'yearly') return 'Anual';
		if (cycle === 'monthly') return 'Lunar';
		return '—';
	}

	function domainModeLabel(mode: string | null): string {
		if (mode === 'buy') return 'Cumpărat nou';
		if (mode === 'transfer') return 'Transfer';
		if (mode === 'have') return 'Existent';
		return '—';
	}

	function accountStatusLabel(o: HostingOrderRow): {
		text: string;
		tone: 'ok' | 'warn' | 'bad' | 'neutral';
	} {
		if (o.hostingAccountId && o.daAccountStatus === 'active') return { text: 'Activ', tone: 'ok' };
		if (o.paymentStatus === 'paid' && !o.hostingAccountId)
			return { text: 'Se creează', tone: 'warn' };
		if (o.paymentStatus === 'failed') return { text: 'Anulat', tone: 'neutral' };
		if (o.paymentStatus === 'refunded') return { text: 'Refundat', tone: 'neutral' };
		return { text: 'Așteaptă plată', tone: 'warn' };
	}

	function fmtTime(d: Date | string | null): string {
		if (!d) return '';
		try {
			return new Date(d).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' });
		} catch {
			return '';
		}
	}
```

- [ ] **Step 5: Replace `counts()` helper with the new KPI shape**

Replace the existing `counts(...)` (line ~403) with:

```ts
	function counts(list: HostingOrderRow[]) {
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
		const startOfPrevMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
		const endOfPrevMonth = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59);

		const paidThisMonth = list
			.filter((o) => o.paidAt && new Date(o.paidAt).getTime() >= startOfMonth.getTime())
			.reduce((a, o) => a + (o.paidAmountCents ?? 0), 0);
		const paidPrevMonth = list
			.filter((o) => {
				if (!o.paidAt) return false;
				const t = new Date(o.paidAt).getTime();
				return t >= startOfPrevMonth.getTime() && t <= endOfPrevMonth.getTime();
			})
			.reduce((a, o) => a + (o.paidAmountCents ?? 0), 0);
		const revenueDeltaPct =
			paidPrevMonth > 0 ? ((paidThisMonth - paidPrevMonth) / paidPrevMonth) * 100 : null;

		const pending = list.filter((o) => o.paymentStatus === 'pending');
		const failed = list.filter((o) => o.paymentStatus === 'failed');
		const refunded = list.filter((o) => o.paymentStatus === 'refunded');
		const pendingAmount = pending.reduce((a, o) => a + (o.productPrice ?? 0), 0);
		const failedAmount = failed.reduce((a, o) => a + (o.productPrice ?? 0), 0);

		const createdToday = list.filter(
			(o) => o.createdAt && new Date(o.createdAt).getTime() >= today.getTime()
		).length;
		const yesterday = new Date(today);
		yesterday.setDate(today.getDate() - 1);
		const createdYesterday = list.filter((o) => {
			if (!o.createdAt) return false;
			const t = new Date(o.createdAt).getTime();
			return t >= yesterday.getTime() && t < today.getTime();
		}).length;

		const activityToday = list.filter((o) => {
			const c = o.createdAt && new Date(o.createdAt).getTime() >= today.getTime();
			const p = o.paidAt && new Date(o.paidAt).getTime() >= today.getTime();
			const a = o.acceptedAt && new Date(o.acceptedAt).getTime() >= today.getTime();
			return c || p || a;
		}).length;

		return {
			total: list.length,
			createdToday,
			createdYesterday,
			activityToday,
			pendingCount: pending.length,
			pendingAmount,
			failedCount: failed.length,
			failedAmount,
			refundedCount: refunded.length,
			paidThisMonth,
			revenueDeltaPct
		};
	}
```

- [ ] **Step 6: svelte-check**

```bash
cd /Users/augustin598/Projects/CRM/app && bunx svelte-check --threshold warning src/routes/[tenant]/hosting/inquiries/+page.svelte 2>&1 | tail -20
```

Expected: the script section is type-clean. There WILL be markup/style errors (markup still references old vars). That's fine until Task 16.

- [ ] **Step 7: Commit**

```bash
cd /Users/augustin598/Projects/CRM && git add app/src/routes/[tenant]/hosting/inquiries/+page.svelte
git commit -m "feat(hosting-orders): script helpers for new UI (history, items, kpis, tabs)"
```

---

### Task 16: Rewrite `+page.svelte` — markup (template)

**Files:**
- Modify: `app/src/routes/[tenant]/hosting/inquiries/+page.svelte` — replace markup (lines 472–~960 today)

This is the largest single task. We replace the entire template + drawer with the new design.

- [ ] **Step 1: Replace everything from `<div class="hst-page">` through the closing `</div>` of the drawer (i.e. everything below `</script>` and above `<style>`) with:**

```svelte
<div class="hod-page">
	{#await ordersPromise}
		<div class="hod-loading">Se încarcă comenzile…</div>
	{:then orders}
		{@const c = counts(orders)}
		{@const filtered = applyFilters(orders)}
		{@const productOptions = Array.from(
			new Map(
				orders
					.filter((o) => o.hostingProductId && o.productName)
					.map((o) => [o.hostingProductId, o.productName])
			).entries()
		)}

		<!-- Hero -->
		<div class="hod-hero">
			<div>
				<h1>Comenzi hosting</h1>
				<p>
					Comenzile primite de pe pagina publică /pachete-hosting · {c.total} total · {c.createdToday}
					azi · {fmtMoney(c.paidThisMonth, 'RON')} achitați
				</p>
			</div>
			<div class="hod-hero-actions">
				<button class="hod-btn hod-btn-ghost" onclick={() => refresh()}>
					<RefreshCwIcon size={14} /> Refresh
				</button>
				<button
					class="hod-btn hod-btn-ghost"
					onclick={() => exportCsv(filtered)}
					disabled={filtered.length === 0}
				>
					<DownloadIcon size={14} /> Export CSV
				</button>
				<a href="/pachete-hosting" target="_blank" rel="noopener" class="hod-btn hod-btn-ghost">
					<ExternalLinkIcon size={14} /> Pagina publică
				</a>
			</div>
		</div>

		<!-- KPI strip -->
		<div class="hod-kpis">
			<div class="hod-kpi" data-tone="info">
				<div class="hod-kpi-stripe"></div>
				<div class="hod-kpi-body">
					<div class="hod-kpi-head">
						<ShoppingCartIcon size={14} />
						<span>COMENZI TOTAL</span>
					</div>
					<div class="hod-kpi-value">{c.total}</div>
					<div class="hod-kpi-foot">+{c.createdToday} azi · {c.createdYesterday} ieri</div>
				</div>
			</div>

			<div class="hod-kpi" data-tone="ok">
				<div class="hod-kpi-stripe"></div>
				<div class="hod-kpi-body">
					<div class="hod-kpi-head">
						<TrendingUpIcon size={14} />
						<span>REVENUE ACHITAT</span>
					</div>
					<div class="hod-kpi-value">{fmtMoney(c.paidThisMonth, 'RON')}</div>
					<div class="hod-kpi-foot">
						{#if c.revenueDeltaPct == null}
							luna curentă
						{:else}
							{c.revenueDeltaPct >= 0 ? '+' : ''}{c.revenueDeltaPct.toFixed(1)}% vs luna trecută
						{/if}
					</div>
				</div>
			</div>

			<div class="hod-kpi" data-tone="warn">
				<div class="hod-kpi-stripe"></div>
				<div class="hod-kpi-body">
					<div class="hod-kpi-head">
						<ClockIcon size={14} />
						<span>PLĂȚI ÎN AȘTEPTARE</span>
					</div>
					<div class="hod-kpi-value">{fmtMoney(c.pendingAmount, 'RON')}</div>
					<div class="hod-kpi-foot">{c.pendingCount} comenzi pending</div>
				</div>
			</div>

			<div class="hod-kpi" data-tone="bad">
				<div class="hod-kpi-stripe"></div>
				<div class="hod-kpi-body">
					<div class="hod-kpi-head">
						<AlertTriangleIcon size={14} />
						<span>PLĂȚI EȘUATE</span>
					</div>
					<div class="hod-kpi-value">{fmtMoney(c.failedAmount, 'RON')}</div>
					<div class="hod-kpi-foot">{c.failedCount} comenzi de recuperat</div>
				</div>
			</div>

			<div class="hod-kpi" data-tone="neutral">
				<div class="hod-kpi-stripe"></div>
				<div class="hod-kpi-body">
					<div class="hod-kpi-head">
						<RotateCcwIcon size={14} />
						<span>REFUNDATE</span>
					</div>
					<div class="hod-kpi-value">{c.refundedCount}</div>
					<div class="hod-kpi-foot">istoric tenant</div>
				</div>
			</div>
		</div>

		<!-- Tabs -->
		<div class="hod-tabs" role="tablist">
			<button
				role="tab"
				aria-selected={activeTab === 'all'}
				class:active={activeTab === 'all'}
				onclick={() => (activeTab = 'all')}
			>
				Toate <span class="hod-tab-count">{c.total}</span>
			</button>
			<button
				role="tab"
				aria-selected={activeTab === 'activity'}
				class:active={activeTab === 'activity'}
				onclick={() => (activeTab = 'activity')}
			>
				Activitate <span class="hod-tab-count">{c.activityToday}</span>
			</button>
			<button
				role="tab"
				aria-selected={activeTab === 'pending'}
				class:active={activeTab === 'pending'}
				onclick={() => (activeTab = 'pending')}
			>
				În așteptare <span class="hod-tab-count">{c.pendingCount}</span>
			</button>
			<button
				role="tab"
				aria-selected={activeTab === 'failed'}
				class:active={activeTab === 'failed'}
				onclick={() => (activeTab = 'failed')}
			>
				Eșuate <span class="hod-tab-count">{c.failedCount}</span>
			</button>
			<button
				role="tab"
				aria-selected={activeTab === 'refunded'}
				class:active={activeTab === 'refunded'}
				onclick={() => (activeTab = 'refunded')}
			>
				Refundate <span class="hod-tab-count">{c.refundedCount}</span>
			</button>
		</div>

		<!-- Filter row -->
		<div class="hod-filters">
			<div class="hod-search">
				<SearchIcon size={14} />
				<input placeholder="Caută ID, nume, email, domeniu…" bind:value={search} />
			</div>
			<select class="hod-filter-select" bind:value={filterPackage}>
				<option value="">📦 Pachet — toate</option>
				{#each productOptions as [id, name]}
					<option value={id}>{name}</option>
				{/each}
			</select>
			<select class="hod-filter-select" bind:value={filterMethod}>
				<option value="all">💳 Metodă — toate</option>
				<option value="card">Card</option>
				<option value="op">Ordin de plată</option>
				<option value="paypal">PayPal</option>
				<option value="revolut">Revolut</option>
			</select>
			<select class="hod-filter-select" disabled title="În curând">
				<option>📅 Perioadă</option>
			</select>
			<select class="hod-filter-select" disabled title="În curând">
				<option>📆 Data</option>
			</select>
		</div>

		{#if filtered.length === 0}
			<div class="hod-empty">
				<ShoppingCartIcon size={40} />
				<p>Nicio comandă pentru filtrele curente.</p>
			</div>
		{:else}
			<div class="hod-table-wrap">
				<table class="hod-table">
					<thead>
						<tr>
							<th>COMANDĂ</th>
							<th>CLIENT</th>
							<th>PACHET</th>
							<th>METODĂ</th>
							<th class="num">SUMĂ</th>
							<th>STATUS</th>
						</tr>
					</thead>
					<tbody>
						{#each filtered as o (o.id)}
							<tr onclick={() => openDrawer(o)}>
								<td>
									<div class="hod-cell-strong">{displayOrderId(o.orderNumber, o.id)}</div>
									<div class="hod-cell-muted">{fmtRelative(o.createdAt)}</div>
									<div class="hod-cell-faint">📄 /{o.source}</div>
								</td>
								<td>
									<div class="hod-cell-strong">{o.contactName}</div>
									<div class="hod-cell-muted">{o.contactEmail}</div>
								</td>
								<td>
									<div class="hod-cell-strong">{o.productName ?? '—'}</div>
									<div class="hod-cell-muted">{billingCycleLabel(o.productBillingCycle)}</div>
								</td>
								<td>
									<div class="hod-cell-strong">{methodLabel(o.paymentMethod)}</div>
								</td>
								<td class="num">
									<div class="hod-cell-strong">
										{o.paidAmountCents != null
											? fmtMoney(o.paidAmountCents, o.productCurrency)
											: o.productPrice != null
												? fmtMoney(o.productPrice, o.productCurrency)
												: '—'}
									</div>
									<div class="hod-cell-faint">incl. TVA 19%</div>
								</td>
								<td>
									<span class="hod-pill" data-tone={paymentTone(o.paymentStatus)}>
										<span class="hod-dot"></span>{paymentLabel(o.paymentStatus).toUpperCase()}
									</span>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	{:catch err}
		<div class="hod-empty">
			<AlertTriangleIcon size={40} />
			<p>Eroare la încărcare: {err instanceof Error ? err.message : String(err)}</p>
		</div>
	{/await}
</div>

{#if openOrder}
	{@const o = openOrder}
	{@const items = o.items ?? []}
	{@const visItems = visibleItems(items)}
	{@const totalCents = o.paidAmountCents ?? lineTotalCents(items)}
	{@const tvaCents = lineTvaCents(items)}
	{@const acctStatus = accountStatusLabel(o)}
	{@const domainItem = items.find((it) => it.kind === 'domain') ?? null}
	{@const daServer = o.productDaServerId ? getDAServer(o.productDaServerId) : null}

	<button
		class="hod-drawer-back"
		aria-label="Închide"
		onclick={() => {
			openOrder = null;
			acceptOpen = false;
		}}
	></button>

	<div
		class="hod-drawer"
		role="dialog"
		aria-modal="true"
		aria-labelledby="hod-drawer-title"
		use:focusTrap={{ initialFocus: '.hod-drawer-close' }}
	>
		<!-- Header -->
		<header class="hod-drawer-head">
			<div class="hod-drawer-head-icon">
				<ShoppingCartIcon size={18} />
			</div>
			<div class="hod-drawer-head-text">
				<div class="hod-drawer-title" id="hod-drawer-title">
					{displayOrderId(o.orderNumber, o.id)}
				</div>
				<div class="hod-drawer-subtitle">
					{fmtRelative(o.createdAt)}, {fmtTime(o.createdAt)} · de pe /{o.source}
				</div>
			</div>
			<span class="hod-pill" data-tone={paymentTone(o.paymentStatus)}>
				<span class="hod-dot"></span>{paymentLabel(o.paymentStatus).toUpperCase()}
			</span>
			<button
				class="hod-drawer-close"
				aria-label="Închide"
				onclick={() => {
					openOrder = null;
					acceptOpen = false;
				}}
			>
				<XIcon size={18} />
			</button>
		</header>

		<!-- Body -->
		<div class="hod-drawer-body">
			<!-- Failed-payment banner -->
			{#if o.paymentStatus === 'failed'}
				<div class="hod-banner hod-banner-bad">
					<div>
						<strong>Plata a eșuat</strong>
						<div>Card refuzat de bancă · cod 51 (fonduri insuficiente)</div>
					</div>
					<button class="hod-btn hod-btn-bad" onclick={() => openAcceptDialog(o)}>
						<RotateCcwIcon size={14} /> Retry
					</button>
				</div>
			{/if}

			<!-- Accept payment subform (renders inline above sections when triggered) -->
			{#if acceptOpen}
				<section class="hod-accept">
					<div class="hod-accept-head">
						<h3>Confirmă încasarea</h3>
						<span class="hod-pill" data-tone="warn">
							<span class="hod-dot"></span>ÎN AȘTEPTARE
						</span>
					</div>

					<div class="hod-tab-group" role="tablist">
						<button
							role="tab"
							aria-selected={acceptMethod === 'card'}
							class:active={acceptMethod === 'card'}
							onclick={() => (acceptMethod = 'card')}
						>
							<CreditCardIcon size={14} /> Card (offline / POS)
						</button>
						<button
							role="tab"
							aria-selected={acceptMethod === 'op'}
							class:active={acceptMethod === 'op'}
							onclick={() => (acceptMethod = 'op')}
						>
							<BanknoteIcon size={14} /> Transfer bancar / OP
						</button>
						<button
							role="tab"
							aria-selected={acceptMethod === 'other'}
							class:active={acceptMethod === 'other'}
							onclick={() => (acceptMethod = 'other')}
						>
							Cash
						</button>
					</div>

					<label class="hod-input-block">
						<span>SUMĂ ({o.productCurrency ?? 'RON'})</span>
						<input
							type="text"
							inputmode="decimal"
							bind:value={acceptAmount}
							placeholder="123.45"
						/>
					</label>

					<label class="hod-input-block">
						<span>{acceptRefLabel.toUpperCase()}</span>
						<input
							type="text"
							bind:value={acceptRef}
							placeholder={acceptRefPlaceholder}
							maxlength="200"
							required={acceptIsBankMethod}
						/>
					</label>

					<label class="hod-input-block">
						<span>NOTĂ (OPȚIONAL)</span>
						<textarea bind:value={acceptNote} maxlength="500" rows="2"
							placeholder="Detalii pentru audit intern"></textarea>
					</label>

					<label class="hod-check">
						<input type="checkbox" bind:checked={acceptProvision} />
						<span>
							Declanșează provisioning DirectAdmin imediat după confirmare
						</span>
					</label>

					<div class="hod-accept-foot">
						<div class="hod-accept-context">
							Pachet <strong>{o.productName ?? '—'}</strong> · {o.requestedDomain ?? '—'}
						</div>
						<button class="hod-btn hod-btn-ghost" onclick={() => (acceptOpen = false)}>
							Anulează
						</button>
						<button
							class="hod-btn hod-btn-primary"
							disabled={accepting}
							onclick={() => submitAccept(o.id)}
						>
							<CheckCircle2Icon size={14} /> Confirmă
						</button>
					</div>
				</section>
			{/if}

			<!-- CLIENT -->
			<section class="hod-section">
				<div class="hod-section-label">CLIENT</div>
				<div class="hod-grid-2">
					<div class="hod-input-block hod-readonly">
						<span>NUME</span>
						<div class="hod-value">{o.contactName}</div>
					</div>
					<div class="hod-input-block hod-readonly">
						<span>EMAIL</span>
						<div class="hod-value">{o.contactEmail}</div>
					</div>
					<div class="hod-input-block hod-readonly">
						<span>TIP</span>
						<div class="hod-value">
							{o.companyName ? 'Persoană juridică' : 'Persoană fizică'}
						</div>
					</div>
					{#if o.vatNumber}
						<div class="hod-input-block hod-readonly">
							<span>CUI</span>
							<div class="hod-value">{o.vatNumber}</div>
						</div>
					{/if}
				</div>
			</section>

			<!-- DETALII COMANDĂ -->
			<section class="hod-section">
				<div class="hod-section-label">DETALII COMANDĂ</div>
				<div class="hod-grid-2">
					<div class="hod-input-block hod-readonly">
						<span>PACHET</span>
						<div class="hod-value hod-link">{o.productName ?? '—'}</div>
					</div>
					<div class="hod-input-block hod-readonly">
						<span>FACTURARE</span>
						<div class="hod-value">{billingCycleLabel(o.productBillingCycle)}</div>
					</div>
					<div class="hod-input-block hod-readonly">
						<span>DOMENIU</span>
						<div class="hod-value">
							{domainItem?.domainName ?? o.requestedDomain ?? '—'}
						</div>
					</div>
					<div class="hod-input-block hod-readonly">
						<span>MOD DOMENIU</span>
						<div class="hod-value">{domainModeLabel(domainItem?.domainMode ?? null)}</div>
					</div>
					<div class="hod-input-block hod-readonly">
						<span>SERVER</span>
						<div class="hod-value hod-mono">
							{#if daServer}
								{#await daServer then srv}
									{srv?.name ?? '—'}
								{/await}
							{:else if o.paymentStatus === 'paid'}
								Auto-alocare în curs
							{:else}
								—
							{/if}
						</div>
					</div>
					<div class="hod-input-block hod-readonly">
						<span>STATUS CONT</span>
						<div class="hod-value">
							<span class="hod-pill hod-pill-sm" data-tone={acctStatus.tone}>
								<span class="hod-dot"></span>{acctStatus.text}
							</span>
						</div>
					</div>
				</div>
			</section>

			<!-- PLATĂ -->
			<section class="hod-section">
				<div class="hod-section-label">PLATĂ</div>
				<div class="hod-grid-2">
					<div class="hod-input-block hod-readonly">
						<span>METODĂ</span>
						<div class="hod-value">
							<CreditCardIcon size={14} />
							{methodLabel(o.paymentMethod)}
						</div>
					</div>
					<div class="hod-input-block hod-readonly">
						<span>STATUS</span>
						<div class="hod-value">
							<span class="hod-pill hod-pill-sm" data-tone={paymentTone(o.paymentStatus)}>
								<span class="hod-dot"></span>{paymentLabel(o.paymentStatus).toUpperCase()}
							</span>
						</div>
					</div>
				</div>

				<!-- Line items box -->
				<div class="hod-items">
					{#each visItems as it (it.id)}
						<div class="hod-item-row">
							<span class="hod-item-label">{it.label}</span>
							<span class="hod-item-value"
								>{fmtMoney(it.unitPriceCents * it.quantity, o.productCurrency)}</span
							>
						</div>
					{/each}
					{#if visItems.length > 0}
						<div class="hod-item-row">
							<span class="hod-item-label">TVA 19%</span>
							<span class="hod-item-value">{fmtMoney(tvaCents, o.productCurrency)}</span>
						</div>
					{/if}
					<div class="hod-item-row hod-item-total">
						<span class="hod-item-label">
							{o.paymentStatus === 'paid' ? 'Total achitat' : 'Total de plată'}
						</span>
						<span class="hod-item-value">{fmtMoney(totalCents, o.productCurrency)}</span>
					</div>
				</div>
			</section>

			<!-- ISTORIC -->
			<section class="hod-section">
				<div class="hod-section-label">ISTORIC</div>
				<ol class="hod-timeline">
					{#each buildHistory(o, null) as h, idx (idx)}
						<li class="hod-timeline-step" data-kind={h.kind}>
							<span class="hod-timeline-dot"></span>
							<div class="hod-timeline-body">
								<div class="hod-timeline-title">{h.label}</div>
								<div class="hod-timeline-meta">
									{fmtRelative(h.at)}{h.meta ? ` · ${h.meta}` : ''}
								</div>
							</div>
						</li>
					{/each}
				</ol>
			</section>

			<!-- Provisioning form (existing — shown only when openProvisionForm was called) -->
			{#if o.paymentStatus === 'paid' && !o.hostingAccountId && lastProvisionInitId === o.id}
				<section class="hod-section" id="drawer-provisioning">
					<div class="hod-section-label">PROVISIONING DA</div>
					<!-- Reuses existing inputs/handlers — see Task 17 -->
					<!-- (full provisioning form markup kept from current implementation, restyled with hod-* classes) -->
				</section>
			{/if}
		</div>

		<!-- Sticky footer action bar -->
		<footer class="hod-drawer-foot">
			{#if o.paymentStatus === 'pending'}
				<a
					class="hod-btn hod-btn-ghost"
					href={`mailto:${o.contactEmail}?subject=${encodeURIComponent('Comanda ' + displayOrderId(o.orderNumber, o.id))}`}
				>
					<MailIcon size={14} /> Email client
				</a>
				<button class="hod-btn hod-btn-primary" onclick={() => openAcceptDialog(o)}>
					<CheckCircle2Icon size={14} /> Marchează plătit
				</button>
			{:else if o.paymentStatus === 'failed'}
				<a
					class="hod-btn hod-btn-ghost"
					href={`mailto:${o.contactEmail}?subject=${encodeURIComponent('Comanda ' + displayOrderId(o.orderNumber, o.id))}`}
				>
					<MailIcon size={14} /> Email client
				</a>
			{:else}
				<!-- Paid or refunded -->
				<a
					class="hod-btn hod-btn-ghost"
					href={`/${page.params.tenant}/invoices?clientEmail=${encodeURIComponent(o.contactEmail)}`}
				>
					<FileTextIcon size={14} /> Factură fiscală
				</a>
				<button
					class="hod-btn hod-btn-ghost"
					onclick={() => toast.info('Refund prin Stripe — funcție în curând')}
				>
					<RotateCcwIcon size={14} /> Refund
				</button>
				<a
					class="hod-btn hod-btn-ghost"
					href={`mailto:${o.contactEmail}?subject=${encodeURIComponent('Comanda ' + displayOrderId(o.orderNumber, o.id))}`}
				>
					<MailIcon size={14} /> Email client
				</a>
				{#if o.hostingAccountId}
					<a
						class="hod-btn hod-btn-primary"
						href={`/${page.params.tenant}/hosting/accounts/${o.hostingAccountId}`}
					>
						<ExternalLinkIcon size={14} /> Vezi cont
					</a>
				{:else}
					<button class="hod-btn hod-btn-primary" onclick={() => openOrderAtProvision(o)}>
						<SparklesIcon size={14} /> Forțează provisionare
					</button>
				{/if}
			{/if}
		</footer>
	</div>
{/if}
```

Notes:
- We removed the `view = 'grid'` toggle entirely — the new design only has the table view.
- `paymentTone(o.paymentStatus)` is a helper used multiple times — add it to the script section if not already there:
  ```ts
  function paymentTone(s: string): 'ok' | 'warn' | 'bad' | 'neutral' {
  	if (s === 'paid') return 'ok';
  	if (s === 'pending') return 'warn';
  	if (s === 'failed') return 'bad';
  	if (s === 'refunded') return 'neutral';
  	return 'neutral';
  }
  ```
  Add it next to `accountStatusLabel` (from Task 15).
- The provisioning form markup is referenced but not pasted (Task 17 handles it).

- [ ] **Step 2: Add `paymentTone` helper to the script if missing**

Per the notes above — add to the `<script>` block.

- [ ] **Step 3: svelte-check**

```bash
cd /Users/augustin598/Projects/CRM/app && bunx svelte-check --threshold warning src/routes/[tenant]/hosting/inquiries/+page.svelte 2>&1 | tail -30
```

Expected: WILL have style-class warnings (CSS classes referenced but not yet defined). That's resolved in Task 18. Type errors should be zero.

- [ ] **Step 4: Commit**

```bash
cd /Users/augustin598/Projects/CRM && git add app/src/routes/[tenant]/hosting/inquiries/+page.svelte
git commit -m "feat(hosting-orders): new markup for list + drawer + KPI strip"
```

---

### Task 17: Restyle the provisioning form to use `hod-*` classes

**Files:**
- Modify: `app/src/routes/[tenant]/hosting/inquiries/+page.svelte` — provisioning section inside the drawer

The original provisioning form (server, package, username, domain, password, notes inputs + Submit button) currently lives inside the drawer with `hst-*` classes. Task 16 left a TODO placeholder for it. Now paste the actual markup inside the `{#if o.paymentStatus === 'paid' && !o.hostingAccountId && lastProvisionInitId === o.id}` block, restyled.

- [ ] **Step 1: Replace the `PROVISIONING DA` section in the drawer with the full form**

Replace the placeholder section from Task 16:

```svelte
			{#if o.paymentStatus === 'paid' && !o.hostingAccountId && lastProvisionInitId === o.id}
				<section class="hod-section" id="drawer-provisioning">
					<div class="hod-section-label">PROVISIONING DA</div>

					{#await serversPromise then servers}
						<div class="hod-grid-2">
							<label class="hod-input-block">
								<span>SERVER</span>
								<select bind:value={provServerId}>
									<option value="">— alege —</option>
									{#each servers as srv (srv.id)}
										<option value={srv.id}>{srv.name}</option>
									{/each}
								</select>
							</label>
							<label class="hod-input-block">
								<span>PACHET DA (OPȚIONAL)</span>
								<input type="text" bind:value={provPackageId} placeholder="ex: standard" />
							</label>
							<label class="hod-input-block">
								<span>USERNAME DA</span>
								<input type="text" bind:value={provUsername} placeholder="ex: andreim" />
							</label>
							<label class="hod-input-block">
								<span>DOMENIU PRIMAR</span>
								<input type="text" bind:value={provDomain} placeholder="ex: domeniu.ro" />
							</label>
							<label class="hod-input-block">
								<span>PAROLĂ</span>
								<div class="hod-pwd-row">
									<input type="text" bind:value={provPassword} />
									<button type="button" class="hod-btn hod-btn-ghost" onclick={regeneratePassword}>
										<SparklesIcon size={12} /> Regen
									</button>
									<button type="button" class="hod-btn hod-btn-ghost" onclick={copyPassword}>
										<CopyIcon size={12} /> {provPwdCopied ? 'Copiat' : 'Copiază'}
									</button>
								</div>
							</label>
							<label class="hod-input-block hod-grid-span-2">
								<span>NOTE INTERNE (OPȚIONAL)</span>
								<textarea rows="2" bind:value={provNotes} maxlength="500"></textarea>
							</label>
						</div>

						<div class="hod-accept-foot">
							<button class="hod-btn hod-btn-ghost" onclick={() => (openOrder = null)}>
								Anulează
							</button>
							<button
								class="hod-btn hod-btn-primary"
								disabled={provisioning}
								onclick={() => submitProvision(o.id)}
							>
								<HardDriveIcon size={14} /> Provisionează
							</button>
						</div>
					{/await}
				</section>
			{/if}
```

- [ ] **Step 2: svelte-check**

```bash
cd /Users/augustin598/Projects/CRM/app && bunx svelte-check --threshold warning src/routes/[tenant]/hosting/inquiries/+page.svelte 2>&1 | tail -20
```

Expected: still style-only warnings (no `hod-*` CSS yet). Zero type errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/augustin598/Projects/CRM && git add app/src/routes/[tenant]/hosting/inquiries/+page.svelte
git commit -m "feat(hosting-orders): restyle provisioning form with hod-* classes"
```

---

### Task 18: Replace `<style>` block with `--hod-*` system

**Files:**
- Modify: `app/src/routes/[tenant]/hosting/inquiries/+page.svelte` — `<style>` block

- [ ] **Step 1: Replace the entire `<style>` block with the new CSS**

```svelte
<style>
	/* ===== Tokens ===== */
	.hod-page {
		--hod-bg: #ffffff;
		--hod-bg-soft: #f9fafb;
		--hod-border: #e5e7eb;
		--hod-border-strong: #d1d5db;
		--hod-text: #111827;
		--hod-text-muted: #6b7280;
		--hod-text-faint: #9ca3af;
		--hod-accent: #2563eb;
		--hod-accent-soft: rgba(37, 99, 235, 0.08);
		--hod-ok: #10b981;
		--hod-warn: #f59e0b;
		--hod-bad: #ef4444;
		--hod-radius: 8px;
		--hod-radius-sm: 6px;
		padding: 24px;
		color: var(--hod-text);
		font-size: 14px;
	}
	.hod-loading,
	.hod-empty {
		padding: 48px 24px;
		text-align: center;
		color: var(--hod-text-faint);
	}
	.hod-empty p {
		margin: 8px 0 0;
	}

	/* ===== Hero ===== */
	.hod-hero {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		margin-bottom: 16px;
		gap: 16px;
		flex-wrap: wrap;
	}
	.hod-hero h1 {
		margin: 0;
		font-size: 24px;
		font-weight: 700;
	}
	.hod-hero p {
		margin: 4px 0 0;
		color: var(--hod-text-muted);
		font-size: 13px;
	}
	.hod-hero-actions {
		display: flex;
		gap: 8px;
	}

	/* ===== Buttons ===== */
	.hod-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 8px 12px;
		border-radius: var(--hod-radius-sm);
		border: 1px solid var(--hod-border);
		background: var(--hod-bg);
		color: var(--hod-text);
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		text-decoration: none;
		transition: all 0.12s ease;
	}
	.hod-btn:hover {
		background: var(--hod-bg-soft);
		border-color: var(--hod-border-strong);
	}
	.hod-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.hod-btn-primary {
		background: var(--hod-accent);
		color: #fff;
		border-color: var(--hod-accent);
	}
	.hod-btn-primary:hover {
		filter: brightness(0.95);
	}
	.hod-btn-bad {
		background: var(--hod-bad);
		color: #fff;
		border-color: var(--hod-bad);
	}
	.hod-btn-ghost {
		background: transparent;
	}

	/* ===== KPI strip ===== */
	.hod-kpis {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 12px;
		margin-bottom: 20px;
	}
	.hod-kpi {
		display: flex;
		background: var(--hod-bg);
		border: 1px solid var(--hod-border);
		border-radius: var(--hod-radius);
		overflow: hidden;
	}
	.hod-kpi-stripe {
		width: 4px;
		background: var(--hod-text-faint);
	}
	.hod-kpi[data-tone='ok'] .hod-kpi-stripe {
		background: var(--hod-ok);
	}
	.hod-kpi[data-tone='warn'] .hod-kpi-stripe {
		background: var(--hod-warn);
	}
	.hod-kpi[data-tone='bad'] .hod-kpi-stripe {
		background: var(--hod-bad);
	}
	.hod-kpi[data-tone='info'] .hod-kpi-stripe {
		background: var(--hod-accent);
	}
	.hod-kpi-body {
		flex: 1;
		padding: 12px 14px;
	}
	.hod-kpi-head {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.05em;
		color: var(--hod-text-faint);
	}
	.hod-kpi-value {
		font-size: 22px;
		font-weight: 700;
		color: var(--hod-text);
		margin-top: 4px;
	}
	.hod-kpi-foot {
		font-size: 11px;
		color: var(--hod-text-muted);
		margin-top: 4px;
	}

	/* ===== Tabs ===== */
	.hod-tabs {
		display: flex;
		gap: 4px;
		border-bottom: 1px solid var(--hod-border);
		margin-bottom: 12px;
	}
	.hod-tabs button {
		padding: 10px 14px;
		background: transparent;
		border: 0;
		border-bottom: 2px solid transparent;
		color: var(--hod-text-muted);
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		display: inline-flex;
		gap: 6px;
		align-items: center;
	}
	.hod-tabs button.active {
		color: var(--hod-accent);
		border-bottom-color: var(--hod-accent);
	}
	.hod-tab-count {
		background: var(--hod-bg-soft);
		color: var(--hod-text-muted);
		padding: 2px 6px;
		border-radius: 10px;
		font-size: 11px;
		font-weight: 600;
	}
	.hod-tabs button.active .hod-tab-count {
		background: var(--hod-accent-soft);
		color: var(--hod-accent);
	}

	/* ===== Filter row ===== */
	.hod-filters {
		display: flex;
		gap: 8px;
		margin-bottom: 12px;
		flex-wrap: wrap;
	}
	.hod-search {
		display: flex;
		align-items: center;
		gap: 6px;
		flex: 1;
		min-width: 220px;
		padding: 6px 10px;
		border: 1px solid var(--hod-border);
		border-radius: var(--hod-radius-sm);
		background: var(--hod-bg);
		color: var(--hod-text-muted);
	}
	.hod-search input {
		flex: 1;
		border: 0;
		outline: 0;
		font-size: 13px;
		background: transparent;
		color: var(--hod-text);
	}
	.hod-filter-select {
		padding: 8px 10px;
		border: 1px solid var(--hod-border);
		border-radius: var(--hod-radius-sm);
		background: var(--hod-bg);
		font-size: 13px;
		color: var(--hod-text);
		cursor: pointer;
	}
	.hod-filter-select:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* ===== Table ===== */
	.hod-table-wrap {
		background: var(--hod-bg);
		border: 1px solid var(--hod-border);
		border-radius: var(--hod-radius);
		overflow: hidden;
	}
	.hod-table {
		width: 100%;
		border-collapse: collapse;
	}
	.hod-table th {
		text-align: left;
		padding: 12px 14px;
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.05em;
		color: var(--hod-text-faint);
		background: var(--hod-bg-soft);
		border-bottom: 1px solid var(--hod-border);
	}
	.hod-table th.num,
	.hod-table td.num {
		text-align: right;
	}
	.hod-table td {
		padding: 12px 14px;
		border-bottom: 1px solid var(--hod-border);
		vertical-align: top;
	}
	.hod-table tbody tr {
		cursor: pointer;
	}
	.hod-table tbody tr:hover {
		background: var(--hod-bg-soft);
	}
	.hod-table tbody tr:last-child td {
		border-bottom: 0;
	}
	.hod-cell-strong {
		font-weight: 600;
		color: var(--hod-text);
	}
	.hod-cell-muted {
		font-size: 12px;
		color: var(--hod-text-muted);
		margin-top: 2px;
	}
	.hod-cell-faint {
		font-size: 11px;
		color: var(--hod-text-faint);
		margin-top: 2px;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	}

	/* ===== Status pills ===== */
	.hod-pill {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 4px 10px;
		border-radius: 999px;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	.hod-pill-sm {
		padding: 2px 8px;
		font-size: 10px;
	}
	.hod-pill[data-tone='ok'] {
		background: rgba(16, 185, 129, 0.12);
		color: var(--hod-ok);
	}
	.hod-pill[data-tone='warn'] {
		background: rgba(245, 158, 11, 0.12);
		color: var(--hod-warn);
	}
	.hod-pill[data-tone='bad'] {
		background: rgba(239, 68, 68, 0.12);
		color: var(--hod-bad);
	}
	.hod-pill[data-tone='neutral'] {
		background: rgba(107, 114, 128, 0.12);
		color: var(--hod-text-muted);
	}
	.hod-dot {
		width: 6px;
		height: 6px;
		border-radius: 999px;
		background: currentColor;
	}

	/* ===== Drawer ===== */
	.hod-drawer-back {
		position: fixed;
		inset: 0;
		background: rgba(17, 24, 39, 0.4);
		border: 0;
		cursor: pointer;
		z-index: 99;
	}
	.hod-drawer {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		width: 580px;
		max-width: 100vw;
		background: var(--hod-bg);
		border-left: 1px solid var(--hod-border);
		z-index: 100;
		display: flex;
		flex-direction: column;
		box-shadow: -16px 0 40px -16px rgba(17, 24, 39, 0.2);
	}
	.hod-drawer-head {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 16px 20px;
		border-bottom: 1px solid var(--hod-border);
	}
	.hod-drawer-head-icon {
		width: 32px;
		height: 32px;
		border-radius: var(--hod-radius-sm);
		background: var(--hod-accent-soft);
		color: var(--hod-accent);
		display: grid;
		place-items: center;
	}
	.hod-drawer-head-text {
		flex: 1;
	}
	.hod-drawer-title {
		font-size: 16px;
		font-weight: 700;
		color: var(--hod-text);
	}
	.hod-drawer-subtitle {
		font-size: 12px;
		color: var(--hod-text-muted);
		margin-top: 2px;
	}
	.hod-drawer-close {
		width: 32px;
		height: 32px;
		border-radius: var(--hod-radius-sm);
		border: 0;
		background: transparent;
		color: var(--hod-text-muted);
		cursor: pointer;
		display: grid;
		place-items: center;
	}
	.hod-drawer-close:hover {
		background: var(--hod-bg-soft);
		color: var(--hod-text);
	}
	.hod-drawer-body {
		flex: 1;
		overflow-y: auto;
		padding: 20px;
	}

	/* ===== Banner ===== */
	.hod-banner {
		display: flex;
		gap: 12px;
		align-items: center;
		padding: 12px 14px;
		border-radius: var(--hod-radius-sm);
		margin-bottom: 16px;
		font-size: 13px;
	}
	.hod-banner-bad {
		background: rgba(239, 68, 68, 0.08);
		border: 1px solid rgba(239, 68, 68, 0.3);
		color: var(--hod-text);
	}
	.hod-banner > div {
		flex: 1;
	}
	.hod-banner strong {
		color: var(--hod-bad);
	}

	/* ===== Sections ===== */
	.hod-section {
		margin-bottom: 20px;
	}
	.hod-section-label {
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.08em;
		color: var(--hod-text-faint);
		text-transform: uppercase;
		margin-bottom: 8px;
	}
	.hod-grid-2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}
	.hod-grid-span-2 {
		grid-column: span 2;
	}
	.hod-input-block {
		display: flex;
		flex-direction: column;
		padding: 8px 12px 10px;
		border: 1px solid var(--hod-border);
		border-radius: var(--hod-radius-sm);
		background: var(--hod-bg);
	}
	.hod-input-block > span {
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.06em;
		color: var(--hod-text-faint);
		margin-bottom: 4px;
	}
	.hod-input-block input,
	.hod-input-block select,
	.hod-input-block textarea {
		border: 0;
		outline: 0;
		font-size: 14px;
		padding: 0;
		background: transparent;
		color: var(--hod-text);
		font-family: inherit;
	}
	.hod-input-block textarea {
		resize: vertical;
		min-height: 36px;
	}
	.hod-readonly .hod-value {
		font-size: 14px;
		font-weight: 500;
		color: var(--hod-text);
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.hod-link {
		color: var(--hod-accent);
	}
	.hod-mono {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 13px;
	}

	/* ===== Line items box ===== */
	.hod-items {
		margin-top: 10px;
		border: 1px solid var(--hod-border);
		border-radius: var(--hod-radius-sm);
		padding: 12px 14px;
		background: var(--hod-bg);
	}
	.hod-item-row {
		display: flex;
		justify-content: space-between;
		padding: 4px 0;
		font-size: 13px;
		color: var(--hod-text);
	}
	.hod-item-total {
		border-top: 1px solid var(--hod-border);
		margin-top: 6px;
		padding-top: 10px;
		font-weight: 700;
	}
	.hod-item-total .hod-item-value {
		color: var(--hod-accent);
		font-size: 18px;
	}

	/* ===== Timeline ===== */
	.hod-timeline {
		list-style: none;
		padding: 0;
		margin: 0;
		position: relative;
	}
	.hod-timeline::before {
		content: '';
		position: absolute;
		left: 4px;
		top: 6px;
		bottom: 6px;
		width: 2px;
		background: var(--hod-border);
	}
	.hod-timeline-step {
		display: flex;
		gap: 10px;
		padding: 4px 0 12px;
		position: relative;
	}
	.hod-timeline-dot {
		width: 10px;
		height: 10px;
		border-radius: 999px;
		background: var(--hod-text-faint);
		margin-top: 4px;
		z-index: 1;
		box-shadow: 0 0 0 3px var(--hod-bg);
	}
	.hod-timeline-step[data-kind='paid'] .hod-timeline-dot,
	.hod-timeline-step[data-kind='provisioned'] .hod-timeline-dot {
		background: var(--hod-ok);
	}
	.hod-timeline-step[data-kind='failed'] .hod-timeline-dot {
		background: var(--hod-bad);
	}
	.hod-timeline-step[data-kind='provisioning'] .hod-timeline-dot {
		background: var(--hod-accent);
	}
	.hod-timeline-step[data-kind='refunded'] .hod-timeline-dot {
		background: var(--hod-text-muted);
	}
	.hod-timeline-title {
		font-size: 13px;
		font-weight: 600;
		color: var(--hod-text);
	}
	.hod-timeline-meta {
		font-size: 12px;
		color: var(--hod-text-muted);
		margin-top: 2px;
	}

	/* ===== Accept-payment subform ===== */
	.hod-accept {
		background: var(--hod-bg-soft);
		border: 1px solid var(--hod-border);
		border-radius: var(--hod-radius);
		padding: 16px;
		margin-bottom: 20px;
	}
	.hod-accept-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 12px;
	}
	.hod-accept-head h3 {
		margin: 0;
		font-size: 14px;
		font-weight: 700;
	}
	.hod-tab-group {
		display: flex;
		gap: 6px;
		margin-bottom: 12px;
	}
	.hod-tab-group button {
		flex: 1;
		padding: 10px 8px;
		border: 1px solid var(--hod-border);
		border-radius: var(--hod-radius-sm);
		background: var(--hod-bg);
		font-size: 12px;
		font-weight: 500;
		color: var(--hod-text-muted);
		cursor: pointer;
		display: inline-flex;
		gap: 6px;
		align-items: center;
		justify-content: center;
	}
	.hod-tab-group button.active {
		background: var(--hod-bg);
		border-color: var(--hod-accent);
		color: var(--hod-accent);
		box-shadow: inset 0 0 0 1px var(--hod-accent);
	}
	.hod-check {
		display: flex;
		gap: 8px;
		align-items: center;
		font-size: 13px;
		color: var(--hod-text);
		margin-top: 10px;
	}
	.hod-accept-foot {
		display: flex;
		gap: 8px;
		align-items: center;
		margin-top: 14px;
	}
	.hod-accept-context {
		flex: 1;
		font-size: 12px;
		color: var(--hod-text-muted);
	}

	/* ===== Provisioning pwd row ===== */
	.hod-pwd-row {
		display: flex;
		gap: 6px;
		align-items: center;
	}
	.hod-pwd-row input {
		flex: 1;
	}

	/* ===== Sticky footer ===== */
	.hod-drawer-foot {
		display: flex;
		gap: 8px;
		padding: 14px 20px;
		border-top: 1px solid var(--hod-border);
		background: var(--hod-bg);
		flex-wrap: wrap;
	}

	/* ===== Mobile ===== */
	@media (max-width: 640px) {
		.hod-drawer {
			width: 100vw;
		}
		.hod-grid-2 {
			grid-template-columns: 1fr;
		}
		.hod-kpis {
			grid-template-columns: 1fr 1fr;
		}
	}
</style>
```

- [ ] **Step 2: svelte-check (clean now)**

```bash
cd /Users/augustin598/Projects/CRM/app && bunx svelte-check --threshold warning src/routes/[tenant]/hosting/inquiries/+page.svelte 2>&1 | tail -10
```

Expected: 0 errors, 0 warnings in this file.

- [ ] **Step 3: Commit**

```bash
cd /Users/augustin598/Projects/CRM && git add app/src/routes/[tenant]/hosting/inquiries/+page.svelte
git commit -m "feat(hosting-orders): new design system (--hod-*) styles"
```

---

### Task 18.5: Type-check the whole project

- [ ] **Step 1: Run svelte-check across the whole app**

```bash
cd /Users/augustin598/Projects/CRM/app && bunx svelte-check --threshold warning 2>&1 | tail -40
```

Expected: 0 new errors. If any errors mention `HostingOrderRow` missing fields, double-check Task 13 was applied. If errors mention `domainName` / `domainMode` / `domainCostCents` in the modal, double-check Task 12.

If errors exist, fix them in the same task before committing the final commit message.

- [ ] **Step 2: If any fixes needed, commit them**

```bash
cd /Users/augustin598/Projects/CRM && git add -A
git commit -m "fix(hosting-orders): type-check fixes from full svelte-check pass"
```

---

### Task 19: Smoke test against the running dev server

- [ ] **Step 1: Start the dev server**

```bash
cd /Users/augustin598/Projects/CRM/app && bun run dev
```

- [ ] **Step 2: Open `http://localhost:5173/ots/hosting/inquiries` in a browser**

Verify:
1. Page loads. Hero, KPI strip, tabs row, table all render.
2. Each table row shows `OTS-XXXXX` (padded), client name + email, package name + cycle, method, amount, status pill.
3. Click any row → drawer opens with new design (CLIENT / DETALII COMANDĂ / PLATĂ / ISTORIC sections).
4. Drawer header shows `OTS-XXXXX` + relative time + `/source`.
5. Line items section shows the rows from `o.items` (hosting + optional domain), TVA 19% derived, total.
6. ISTORIC shows the timeline with correct dot colors per state.
7. Footer action bar shows buttons appropriate to state:
   - pending → [Email client] [Marchează plătit]
   - failed → [Email client] (Retry is in the red banner)
   - paid + no DA → [Factură fiscală] [Refund] [Email client] [Forțează provisionare]
   - paid + DA → [Factură fiscală] [Refund] [Email client] [Vezi cont]
8. Click "Marchează plătit" on a pending order → accept subform appears inline with method tabs.
9. Switch method tab to "Transfer bancar / OP" → label changes to "ID tranzacție bancă *" (required).
10. Click "Refund" → toast says "Refund prin Stripe — funcție în curând".
11. Click "Email client" → `mailto:` opens with subject `Comanda OTS-XXXXX`.
12. Click "Factură fiscală" → navigates to `/ots/invoices?clientEmail=...`.
13. Filter tabs work (Toate / Activitate / În așteptare / Eșuate / Refundate) — counts match.
14. Pachet dropdown filters by selected hostingProductId.
15. Search by `OTS-` + digits OR domain OR email — all hit.

- [ ] **Step 3: Submit a NEW order via `/pachete-hosting/comanda`**

Open `http://localhost:5173/pachete-hosting`, pick a package, submit a full order including domain "test-NEW.ro" (mode `buy`). Confirm in the admin page that:
- The new order appears at the top with the NEXT `order_number` (one higher than the previous max).
- Opening its drawer shows TWO line items: `Hosting <name> (anual/lunar)` and `Domeniu test-new.ro`.
- Total = hosting price + 49 RON (TLD `.ro` price).
- TVA = derived from total.

- [ ] **Step 4: Run existing test suite to catch regressions**

```bash
cd /Users/augustin598/Projects/CRM/app && bun test 2>&1 | tail -30
```

Expected: zero new failures. The new `hosting-order-id.test.ts` passes.

- [ ] **Step 5: No commit (verification only — any fixes should go into a follow-up commit in the same logical task)**

---

### Task 20: Sidebar label (if needed)

The previous redesign already changed "Cereri" → "Comenzi" in the sidebar. Verify nothing more is needed.

- [ ] **Step 1: Verify the label in the sidebar config**

```bash
cd /Users/augustin598/Projects/CRM/app && grep -rn "/hosting/inquiries" src/lib/components/ots-sidebar/ 2>&1 | head -5
```

If the label is already "Comenzi", no change. If not, update it to "Comenzi".

- [ ] **Step 2: If a change is needed, commit**

```bash
cd /Users/augustin598/Projects/CRM && git add app/src/lib/components/ots-sidebar/
git commit -m "feat(hosting-orders): sidebar label Comenzi (if not already)"
```

---

### Task 21: Final push

- [ ] **Step 1: Review commits**

```bash
cd /Users/augustin598/Projects/CRM && git log --oneline -25
```

Expected: about 20 commits in the new feature, starting with `docs(hosting-orders): UI redesign spec — drawer + table + KPI restyling` (`a6c0216`) → `docs(hosting-orders): expand spec — order_number, line items, backfill` (`1bbe5cc`) → migrations → backend wiring → UI → smoke verification.

- [ ] **Step 2: Push**

```bash
cd /Users/augustin598/Projects/CRM && git push
```

If push fails because of pre-commit hooks running tests, fix the failing test and retry. NEVER use `--no-verify`.
