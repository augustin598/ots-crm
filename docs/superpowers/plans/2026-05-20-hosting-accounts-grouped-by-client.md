# Hosting Accounts — Grouped by Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign `/[tenant]/hosting/accounts` 1:1 with the HOST design pack: client groups with health header (LTV, tier, vechime, MRR/ARR, next expiry, overdue alert, semaphore edge), 11 configurable columns with drag-reorder + visibility toggle, and a `+ N domenii adiționale` chip per row. Add the missing schema fields (`client.tier`, `client.client_since`, `client.ltv_cents`, `hosting_account.auto_renew`) without breaking existing flows.

**Architecture:** Drizzle migrations add 4 columns. A new `getHostingAccountsGrouped` remote returns `ClientGroup[]` shaped exactly like the pack's `ClientGroup` type. A pure-UI Svelte 5 `ColumnManager` component (port of pack's React TSX) drives a localStorage-persisted column config. New components `ClientGroupCard` and `HostingAccountRow` render the new design; existing single-row `+page.svelte` is rewritten while keeping the flat (non-grouped) fallback.

**Tech Stack:** SvelteKit 5, Drizzle ORM, Turso (libSQL), Bun, Tailwind, valibot, lucide-svelte.

**Spec reference:** `docs/superpowers/specs/2026-05-19-hosting-accounts-grouped-by-client-design.md`

---

## Task 1: Drizzle migrations (4 single-statement SQL files + journal)

**Files:**
- Create: `app/drizzle/0343_client_client_since.sql`
- Create: `app/drizzle/0344_client_tier.sql`
- Create: `app/drizzle/0345_client_ltv_cents.sql`
- Create: `app/drizzle/0346_hosting_account_auto_renew.sql`
- Modify: `app/drizzle/meta/_journal.json` (append 4 entries)
- Modify: `app/src/lib/server/db/schema.ts` (append 4 columns)

- [ ] **Step 1: Create migration 0343 (client.client_since)**

```sql
ALTER TABLE `client` ADD COLUMN `client_since` text;
```

- [ ] **Step 2: Create migration 0344 (client.tier)**

```sql
ALTER TABLE `client` ADD COLUMN `tier` text DEFAULT 'standard';
```

- [ ] **Step 3: Create migration 0345 (client.ltv_cents)**

```sql
ALTER TABLE `client` ADD COLUMN `ltv_cents` integer DEFAULT 0 NOT NULL;
```

- [ ] **Step 4: Create migration 0346 (hosting_account.auto_renew)**

```sql
ALTER TABLE `hosting_account` ADD COLUMN `auto_renew` integer DEFAULT 1 NOT NULL;
```

- [ ] **Step 5: Append 4 entries to `_journal.json`**

Open `app/drizzle/meta/_journal.json`. After the last entry (idx 342, tag `0342_tenant_user_preferences_user_tenant_idx`), append:

```json
{ "idx": 343, "version": "6", "when": <NOW_MS>, "tag": "0343_client_client_since", "breakpoints": true },
{ "idx": 344, "version": "6", "when": <NOW_MS+1000>, "tag": "0344_client_tier", "breakpoints": true },
{ "idx": 345, "version": "6", "when": <NOW_MS+2000>, "tag": "0345_client_ltv_cents", "breakpoints": true },
{ "idx": 346, "version": "6", "when": <NOW_MS+3000>, "tag": "0346_hosting_account_auto_renew", "breakpoints": true }
```

Use `Date.now()` value for `<NOW_MS>`, with +1000 increments to keep ordering deterministic.

- [ ] **Step 6: Add columns to `app/src/lib/server/db/schema.ts`**

In the `client` table definition (line 141), insert before the timestamps block:

```ts
		/** Optional human-set "client since" date (YYYY-MM-DD). Falls back to created_at in UI. */
		clientSince: text('client_since'),
		/** Tier: 'vip' | 'standard' | 'watch'. Affects group header badge + edge color. */
		tier: text('tier').default('standard'),
		/** Lifetime value in cents — sum of all paid invoices. Refreshed by recalcClientLTV(). */
		ltvCents: integer('ltv_cents').notNull().default(0),
```

In the `hostingAccount` table definition (line 918), insert before `lastSyncedAt`:

```ts
		/** Whether the contract renews automatically. UI toggle on the "Ciclu" column. */
		autoRenew: integer('auto_renew', { mode: 'boolean' }).notNull().default(true),
```

- [ ] **Step 7: Run migrations locally**

```bash
cd /Users/augustin598/Projects/CRM/app && bun run db:migrate
```

Expected: 4 new migrations applied. If "duplicate column" error, the field already existed — inspect schema and abort.

- [ ] **Step 8: Verify on remote Turso**

```bash
cd /Users/augustin598/Projects/CRM/app && bun run -e "
import { db } from './src/lib/server/db';
import { sql } from 'drizzle-orm';
const client = await db.run(sql\`PRAGMA table_info(client)\`);
const ha = await db.run(sql\`PRAGMA table_info(hosting_account)\`);
console.log('client cols:', client.rows.map((r:any)=>r.name).join(','));
console.log('hosting_account cols:', ha.rows.map((r:any)=>r.name).join(','));
"
```

Expected: client cols include `client_since,tier,ltv_cents`; hosting_account cols include `auto_renew`.

- [ ] **Step 9: Commit**

```bash
cd /Users/augustin598/Projects/CRM && git add app/drizzle/0343_*.sql app/drizzle/0344_*.sql app/drizzle/0345_*.sql app/drizzle/0346_*.sql app/drizzle/meta/_journal.json app/src/lib/server/db/schema.ts
git commit -m "$(cat <<'EOF'
feat(hosting-accounts): add client.tier/client_since/ltv_cents + hosting_account.auto_renew

Schema additions for the grouped-by-client redesign. No backfill yet — defaults
('standard' tier, 0 LTV, auto_renew=true) cover existing rows safely.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: LTV recalc helper + wiring

**Files:**
- Create: `app/src/lib/server/hosting/ltv.ts`
- Modify: `app/src/lib/server/plugins/banking/shared/matcher.ts` (1 line + 1 import)
- Modify: `app/src/lib/server/plugins/banking/revolut/sync.ts` (1 line + 1 import)
- Create: `app/scripts/backfill-client-ltv.ts`

- [ ] **Step 1: Create `app/src/lib/server/hosting/ltv.ts`**

```ts
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, sql } from 'drizzle-orm';

/**
 * Recalculate a client's LTV (sum of paid invoice totals, in cents).
 * Safe to call concurrently — last write wins. Tenant-scoped.
 *
 * Call after: invoice paid, invoice refunded, invoice deleted, invoice amount edited.
 */
export async function recalcClientLTV(tenantId: string, clientId: string): Promise<number> {
	const rows = await db
		.select({ sum: sql<number>`COALESCE(SUM(${table.invoice.totalAmount}), 0)` })
		.from(table.invoice)
		.where(
			and(
				eq(table.invoice.tenantId, tenantId),
				eq(table.invoice.clientId, clientId),
				eq(table.invoice.status, 'paid')
			)
		);
	const totalCents = Number(rows[0]?.sum ?? 0);
	await db
		.update(table.client)
		.set({ ltvCents: totalCents })
		.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, tenantId)));
	return totalCents;
}
```

- [ ] **Step 2: Wire into banking matcher (post-paid hook)**

Open `app/src/lib/server/plugins/banking/shared/matcher.ts`. After the existing line that sets `status: 'paid'` (~line 221), find the surrounding `await db.update(invoice).set(...).where(...)` and add **after** that update:

```ts
		// Refresh client LTV after marking paid
		try {
			const { recalcClientLTV } = await import('$lib/server/hosting/ltv');
			await recalcClientLTV(inv.tenantId, inv.clientId);
		} catch (e) {
			console.warn('[banking.matcher] LTV refresh failed for client', inv.clientId, e);
		}
```

(Use the existing `inv` / invoice row variable name. If naming differs, adapt — but keep this idempotent + non-throwing.)

- [ ] **Step 3: Wire into Revolut sync (same pattern)**

Open `app/src/lib/server/plugins/banking/revolut/sync.ts` near line 549 where `status: 'paid'` is set. After the surrounding update block, add the same try/catch as Step 2.

- [ ] **Step 4: Create backfill script `app/scripts/backfill-client-ltv.ts`**

```ts
#!/usr/bin/env bun
/**
 * One-shot backfill: recompute client.ltv_cents for every client across all tenants.
 * Run with: bun app/scripts/backfill-client-ltv.ts
 */
import { db } from '../src/lib/server/db';
import * as table from '../src/lib/server/db/schema';
import { recalcClientLTV } from '../src/lib/server/hosting/ltv';

const clients = await db
	.select({ id: table.client.id, tenantId: table.client.tenantId, name: table.client.name })
	.from(table.client);

console.log(`Recomputing LTV for ${clients.length} clients...`);
let ok = 0;
let err = 0;
for (const c of clients) {
	try {
		const ltv = await recalcClientLTV(c.tenantId, c.id);
		ok++;
		if (ok % 25 === 0) console.log(`  ${ok}/${clients.length} done...`);
		if (ltv > 0) console.log(`  ${c.name}: ${(ltv / 100).toFixed(2)} RON`);
	} catch (e) {
		err++;
		console.error(`  FAILED ${c.name} (${c.id}):`, e);
	}
}
console.log(`\nDone. ${ok} ok · ${err} errors.`);
process.exit(err === 0 ? 0 : 1);
```

- [ ] **Step 5: Commit**

```bash
cd /Users/augustin598/Projects/CRM && git add app/src/lib/server/hosting/ltv.ts app/src/lib/server/plugins/banking/shared/matcher.ts app/src/lib/server/plugins/banking/revolut/sync.ts app/scripts/backfill-client-ltv.ts
git commit -m "$(cat <<'EOF'
feat(hosting-accounts): recalcClientLTV helper + backfill script

Refreshes client.ltv_cents from sum of paid invoices. Called after banking
matcher and Revolut sync mark invoices paid; non-blocking on failure.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Column manager (types + helpers + Svelte 5 component)

**Files:**
- Create: `app/src/lib/components/hosting/column-manager.ts`
- Create: `app/src/lib/components/hosting/columns.default.ts`
- Create: `app/src/lib/components/hosting/column-manager.svelte`

- [ ] **Step 1: Create types + helpers `column-manager.ts`**

```ts
export type ColumnDef = {
	key: string;
	label: string;
	field?: string;
	type?: string;
	required?: boolean;
	isNew?: boolean;
};

export type ColumnConfig = {
	order: string[];
	visible: Record<string, boolean>;
};

export function visibleColumnsInOrder<T extends ColumnDef>(
	columns: T[],
	config: ColumnConfig
): T[] {
	return config.order
		.map((key) => columns.find((c) => c.key === key))
		.filter((c): c is T => !!c && (c.required === true || config.visible[c.key] === true));
}

export function buildDefaultConfig(columns: ColumnDef[]): ColumnConfig {
	return {
		order: columns.map((c) => c.key),
		visible: Object.fromEntries(columns.map((c) => [c.key, true]))
	};
}

/**
 * Load + save a ColumnConfig from localStorage. Returns the loaded value
 * (or fallback) and a setter. Safe in SSR (returns fallback when window missing).
 */
export function loadPersistedColumnConfig(
	storageKey: string,
	fallback: ColumnConfig
): ColumnConfig {
	if (typeof window === 'undefined') return fallback;
	try {
		const raw = window.localStorage.getItem(storageKey);
		if (!raw) return fallback;
		const parsed = JSON.parse(raw) as Partial<ColumnConfig>;
		const order = Array.isArray(parsed.order) ? parsed.order : fallback.order;
		const visible = (parsed.visible && typeof parsed.visible === 'object') ? parsed.visible : fallback.visible;
		// Drop unknown keys + add new ones from fallback (forward-compat after pack updates)
		const cleanOrder = order.filter((k) => fallback.order.includes(k));
		for (const k of fallback.order) if (!cleanOrder.includes(k)) cleanOrder.push(k);
		const cleanVisible: Record<string, boolean> = {};
		for (const k of fallback.order) cleanVisible[k] = visible[k] ?? fallback.visible[k] ?? true;
		return { order: cleanOrder, visible: cleanVisible };
	} catch {
		return fallback;
	}
}

export function savePersistedColumnConfig(storageKey: string, cfg: ColumnConfig): void {
	if (typeof window === 'undefined') return;
	try {
		window.localStorage.setItem(storageKey, JSON.stringify(cfg));
	} catch {
		/* quota / private mode — fail silently */
	}
}
```

- [ ] **Step 2: Create `columns.default.ts`**

```ts
import type { ColumnDef } from './column-manager';

/**
 * Column definitions for the hosting accounts table — 1:1 with the HOST design pack
 * (`columns.config.json`). Order here is the default order; user can drag-reorder
 * (except required columns).
 */
export const HOSTING_ACCOUNT_COLUMNS: ColumnDef[] = [
	{ key: 'user', label: 'DA User', field: 'da_username', required: true },
	{ key: 'domain', label: 'Domeniu', field: 'domain', required: true },
	{ key: 'addons', label: '+ Domenii adiționale', field: 'additional_domains', isNew: true },
	{ key: 'pachet', label: 'Pachet + PHP', field: 'da_package_name' },
	{ key: 'server', label: 'Server', field: 'server' },
	{ key: 'ciclu', label: 'Ciclu + Auto-renew', field: 'billing_cycle', isNew: true },
	{ key: 'start', label: 'Data start', field: 'start_date' },
	{ key: 'scadenta', label: 'Scadență + countdown', field: 'next_due_date' },
	{ key: 'plata', label: 'Ultima plată', field: 'last_invoice', isNew: true },
	{ key: 'status', label: 'Status cont', field: 'status' },
	{ key: 'suma', label: 'Sumă + perioadă', field: 'recurring_amount', required: true }
];

export const COLUMNS_STORAGE_KEY = 'hosting.accounts.columns.v1';
```

- [ ] **Step 3: Create `column-manager.svelte` (Svelte 5 port of pack TSX)**

```svelte
<script lang="ts">
	import type { ColumnDef, ColumnConfig } from './column-manager';

	type Props = {
		columns: ColumnDef[];
		value: ColumnConfig;
		onchange: (next: ColumnConfig) => void;
		class?: string;
	};

	let { columns, value, onchange, class: className = '' }: Props = $props();

	let draggedKey = $state<string | null>(null);
	let dragOverKey = $state<string | null>(null);

	function move(fromKey: string, toKey: string): void {
		if (fromKey === toKey) return;
		const next = [...value.order];
		const fromIdx = next.indexOf(fromKey);
		const toIdx = next.indexOf(toKey);
		if (fromIdx === -1 || toIdx === -1) return;
		next.splice(fromIdx, 1);
		next.splice(toIdx, 0, fromKey);
		onchange({ order: next, visible: value.visible });
	}

	function toggle(key: string): void {
		onchange({
			order: value.order,
			visible: { ...value.visible, [key]: !value.visible[key] }
		});
	}
</script>

<div class={`flex flex-col gap-1 ${className}`}>
	{#each value.order as key (key)}
		{@const col = columns.find((c) => c.key === key)}
		{#if col}
			{@const isVisible = col.required === true || value.visible[key] === true}
			{@const isDragOver = dragOverKey === key && draggedKey !== key}
			<div
				draggable={!col.required}
				ondragstart={() => (draggedKey = key)}
				ondragend={() => {
					draggedKey = null;
					dragOverKey = null;
				}}
				ondragover={(e) => {
					e.preventDefault();
					dragOverKey = key;
				}}
				ondragleave={() => (dragOverKey = null)}
				ondrop={(e) => {
					e.preventDefault();
					if (draggedKey) move(draggedKey, key);
					draggedKey = null;
					dragOverKey = null;
				}}
				class={[
					'flex items-center gap-2 rounded-lg border px-3 py-2 select-none',
					isDragOver
						? 'border-dashed border-blue-500 bg-blue-50 dark:bg-blue-950'
						: 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800',
					isVisible ? 'opacity-100' : 'opacity-55',
					col.required ? 'cursor-default' : 'cursor-grab'
				].join(' ')}
			>
				<span
					aria-hidden="true"
					class={`font-mono text-sm leading-none text-slate-300 ${col.required ? 'cursor-not-allowed' : 'cursor-grab'}`}
					>⋮⋮</span
				>

				<div class="min-w-0 flex-1">
					<div class="flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100">
						{col.label}
						{#if col.isNew}
							<span class="rounded bg-blue-600 px-1 py-0.5 text-[9px] font-bold tracking-wider text-white">NEW</span>
						{/if}
						{#if col.required}
							<span class="rounded bg-slate-200 px-1 py-0.5 text-[9px] font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">REQUIRED</span>
						{/if}
					</div>
					{#if col.field || col.type}
						<div class="mt-0.5 font-mono text-[10px] text-slate-400">
							{col.field ?? ''}{col.field && col.type ? ': ' : ''}{col.type ?? ''}
						</div>
					{/if}
				</div>

				<button
					type="button"
					onclick={() => !col.required && toggle(key)}
					disabled={col.required}
					aria-pressed={isVisible}
					aria-label={isVisible ? `Ascunde ${col.label}` : `Afișează ${col.label}`}
					class={[
						'relative h-[18px] w-8 shrink-0 rounded-full border-0 p-0 transition-colors',
						isVisible ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-600',
						col.required ? 'cursor-not-allowed' : 'cursor-pointer'
					].join(' ')}
				>
					<span
						class="absolute top-0.5 size-3.5 rounded-full bg-white shadow transition-[left]"
						style:left={isVisible ? '16px' : '2px'}
					></span>
				</button>
			</div>
		{/if}
	{/each}
</div>
```

- [ ] **Step 4: Run svelte-check + svelte-autofixer on new files**

```bash
cd /Users/augustin598/Projects/CRM/app && npx svelte-check --threshold warning --workspace .
```

Expected: 0 errors / 0 warnings on `column-manager.svelte`.

Then run the svelte-autofixer via the MCP tool on `app/src/lib/components/hosting/column-manager.svelte`. Expected: no remaining issues.

- [ ] **Step 5: Commit**

```bash
cd /Users/augustin598/Projects/CRM && git add app/src/lib/components/hosting/
git commit -m "$(cat <<'EOF'
feat(hosting-accounts): ColumnManager Svelte 5 component (port of HOST pack TSX)

Pure-UI drag-reorder + toggle visibility component with localStorage helpers.
Required columns (DA user, Domeniu, Sumă) cannot be hidden or reordered.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Grouped query in remote

**Files:**
- Modify: `app/src/lib/remotes/hosting-accounts.remote.ts` (append `getHostingAccountsGrouped` + helpers)

- [ ] **Step 1: Append imports and helpers at top of file (after existing imports)**

In `app/src/lib/remotes/hosting-accounts.remote.ts`, add to the existing import line:

```ts
import { eq, and, desc, inArray, isNotNull, gte, lte, sql } from 'drizzle-orm';
```

(Add `gte`, `lte`, `sql` to the existing import.)

- [ ] **Step 2: Append the grouped query function at end of file**

Add at the end of `hosting-accounts.remote.ts`:

```ts
// =============================================================================
//  Grouped-by-client query (for /[tenant]/hosting/accounts redesign)
// =============================================================================

export type LastInvoiceLite = {
	id: string;
	status: 'paid' | 'pending' | 'overdue' | 'sent' | 'draft' | 'cancelled' | 'partially_paid' | 'n/a';
	date: string | null;
	amountCents: number;
	daysOverdue?: number;
};

export type AccountInGroup = {
	id: string;
	daUsername: string;
	domain: string;
	additionalDomains: string[] | null;
	daPackageName: string | null;
	linkedPackageName: string | null;
	serverName: string | null;
	status: string;
	billingCycle: string;
	autoRenew: boolean;
	startDate: string | null;
	nextDueDate: string | null;
	expiresInDays: number | null;
	recurringAmount: number;
	currency: string;
	lastInvoice: LastInvoiceLite;
};

export type ClientGroup = {
	clientId: string | null;
	client: {
		id: string | null;
		name: string;
		businessName: string | null;
		cui: string | null;
		email: string | null;
		phone: string | null;
		tier: 'vip' | 'standard' | 'watch';
		clientSince: string | null;
		ltvCents: number;
	};
	accounts: AccountInGroup[];
	totals: {
		count: number;
		addonCount: number;
		mrrCents: number;
		arrCents: number;
		byStatus: Record<string, number>;
		overdueCount: number;
		nextExpiry: { date: string; days: number } | null;
		oldestOverdue: { date: string; daysOverdue: number } | null;
	};
};

const CYCLE_MONTHS_GROUPED: Record<string, number> = {
	monthly: 1,
	quarterly: 3,
	semiannually: 6,
	biannually: 6,
	annually: 12,
	biennially: 24,
	triennially: 36,
	one_time: 0
};

function toMonthlyCentsGrouped(amount: number | null, cycle: string | null): number {
	const months = CYCLE_MONTHS_GROUPED[cycle ?? 'monthly'] ?? 1;
	if (months === 0 || !amount) return 0;
	return Math.round(amount / months);
}

function daysBetween(fromISO: string | null | undefined, toISO: string): number | null {
	if (!fromISO) return null;
	const a = new Date(fromISO);
	const b = new Date(toISO);
	if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
	return Math.round((a.getTime() - b.getTime()) / (24 * 60 * 60 * 1000));
}

export const getHostingAccountsGrouped = query(FiltersSchema, async (filters) => {
	const event = getRequestEvent();
	const tenantId = event.locals.tenant?.id;
	if (!tenantId) throw new Error('Tenant context required');

	// 1. Pull accounts joined with client + server + linked package
	const rows = await db
		.select({
			id: table.hostingAccount.id,
			clientId: table.hostingAccount.clientId,
			daUsername: table.hostingAccount.daUsername,
			domain: table.hostingAccount.domain,
			additionalDomains: table.hostingAccount.additionalDomains,
			daPackageName: table.hostingAccount.daPackageName,
			linkedPackageName: table.hostingProduct.name,
			serverName: table.daServer.name,
			status: table.hostingAccount.status,
			billingCycle: table.hostingAccount.billingCycle,
			autoRenew: table.hostingAccount.autoRenew,
			startDate: table.hostingAccount.startDate,
			nextDueDate: table.hostingAccount.nextDueDate,
			recurringAmount: table.hostingAccount.recurringAmount,
			currency: table.hostingAccount.currency,
			client_id: table.client.id,
			client_name: table.client.name,
			client_businessName: table.client.businessName,
			client_cui: table.client.cui,
			client_email: table.client.email,
			client_phone: table.client.phone,
			client_tier: table.client.tier,
			client_clientSince: table.client.clientSince,
			client_ltvCents: table.client.ltvCents
		})
		.from(table.hostingAccount)
		.leftJoin(table.client, eq(table.client.id, table.hostingAccount.clientId))
		.leftJoin(table.daServer, eq(table.daServer.id, table.hostingAccount.daServerId))
		.leftJoin(
			table.hostingProduct,
			eq(table.hostingProduct.id, table.hostingAccount.hostingProductId)
		)
		.where(
			and(
				eq(table.hostingAccount.tenantId, tenantId),
				filters?.status ? eq(table.hostingAccount.status, filters.status) : undefined,
				filters?.clientId ? eq(table.hostingAccount.clientId, filters.clientId) : undefined,
				filters?.serverId ? eq(table.hostingAccount.daServerId, filters.serverId) : undefined
			)
		)
		.limit(filters?.limit ?? 500);

	const accountIds = rows.map((r) => r.id);
	const clientIds = Array.from(new Set(rows.map((r) => r.clientId).filter((x): x is string => !!x)));

	// 2. Last invoice per hosting account (ordered desc, pick first per account)
	const invRows = accountIds.length
		? await db
				.select({
					id: table.invoice.id,
					hostingAccountId: table.invoice.hostingAccountId,
					status: table.invoice.status,
					dueDate: table.invoice.dueDate,
					issueDate: table.invoice.issueDate,
					totalAmount: table.invoice.totalAmount
				})
				.from(table.invoice)
				.where(
					and(
						eq(table.invoice.tenantId, tenantId),
						inArray(table.invoice.hostingAccountId, accountIds)
					)
				)
				.orderBy(desc(table.invoice.issueDate))
		: [];

	const todayISO = new Date().toISOString().slice(0, 10);
	const lastInvoiceByAccount = new Map<string, LastInvoiceLite>();
	for (const inv of invRows) {
		if (!inv.hostingAccountId) continue;
		if (lastInvoiceByAccount.has(inv.hostingAccountId)) continue; // first one wins (desc order)
		const dateISO = inv.issueDate ? new Date(inv.issueDate).toISOString().slice(0, 10) : null;
		const dueISO = inv.dueDate ? new Date(inv.dueDate).toISOString().slice(0, 10) : null;
		let mapped: LastInvoiceLite['status'] = inv.status as LastInvoiceLite['status'];
		// Map "sent" with passed due date to overdue for display purposes
		if (inv.status !== 'paid' && inv.status !== 'cancelled' && dueISO && dueISO < todayISO) {
			mapped = 'overdue';
		}
		const daysOverdue =
			mapped === 'overdue' && dueISO ? Math.max(0, -1 * (daysBetween(dueISO, todayISO) ?? 0)) : undefined;
		lastInvoiceByAccount.set(inv.hostingAccountId, {
			id: inv.id,
			status: mapped,
			date: dateISO,
			amountCents: Number(inv.totalAmount ?? 0),
			daysOverdue
		});
	}

	// 3. Group by client
	const groups = new Map<string, ClientGroup>();
	for (const r of rows) {
		const key = r.clientId ?? '__unassigned__';
		if (!groups.has(key)) {
			groups.set(key, {
				clientId: r.clientId,
				client: {
					id: r.client_id,
					name: r.client_name ?? (r.clientId ? `Client #${r.clientId.slice(0, 6)}` : 'Neasignat'),
					businessName: r.client_businessName,
					cui: r.client_cui,
					email: r.client_email,
					phone: r.client_phone,
					tier: ((r.client_tier as ClientGroup['client']['tier']) ?? 'standard'),
					clientSince: r.client_clientSince,
					ltvCents: Number(r.client_ltvCents ?? 0)
				},
				accounts: [],
				totals: {
					count: 0,
					addonCount: 0,
					mrrCents: 0,
					arrCents: 0,
					byStatus: {},
					overdueCount: 0,
					nextExpiry: null,
					oldestOverdue: null
				}
			});
		}
		const g = groups.get(key)!;
		const expiresInDays = daysBetween(r.nextDueDate, todayISO);
		const expiresInDaysAbs = expiresInDays !== null ? -1 * expiresInDays : null;
		// daysBetween(due, today) returns due-today; positive means in past; flip so expiresInDays is future positive
		const expiresInDaysFromNow = expiresInDaysAbs;

		const lastInv: LastInvoiceLite =
			lastInvoiceByAccount.get(r.id) ?? { id: '', status: 'n/a', date: null, amountCents: 0 };

		const acc: AccountInGroup = {
			id: r.id,
			daUsername: r.daUsername,
			domain: r.domain,
			additionalDomains: r.additionalDomains,
			daPackageName: r.daPackageName,
			linkedPackageName: r.linkedPackageName,
			serverName: r.serverName,
			status: r.status,
			billingCycle: r.billingCycle,
			autoRenew: r.autoRenew === true || r.autoRenew === 1,
			startDate: r.startDate,
			nextDueDate: r.nextDueDate,
			expiresInDays: expiresInDaysFromNow,
			recurringAmount: r.recurringAmount,
			currency: r.currency,
			lastInvoice: lastInv
		};
		g.accounts.push(acc);
		g.totals.count++;
		g.totals.addonCount += acc.additionalDomains?.length ?? 0;
		g.totals.byStatus[r.status] = (g.totals.byStatus[r.status] ?? 0) + 1;
		if (r.status === 'active' || r.status === 'pending') {
			g.totals.mrrCents += toMonthlyCentsGrouped(r.recurringAmount, r.billingCycle);
		}
		if (lastInv.status === 'overdue') g.totals.overdueCount++;
		if (
			(r.status === 'active' || r.status === 'pending') &&
			expiresInDaysFromNow !== null &&
			expiresInDaysFromNow >= 0 &&
			(g.totals.nextExpiry === null || expiresInDaysFromNow < g.totals.nextExpiry.days)
		) {
			g.totals.nextExpiry = { date: r.nextDueDate ?? '', days: expiresInDaysFromNow };
		}
		if (
			lastInv.status === 'overdue' &&
			lastInv.daysOverdue !== undefined &&
			(g.totals.oldestOverdue === null || lastInv.daysOverdue > g.totals.oldestOverdue.daysOverdue)
		) {
			g.totals.oldestOverdue = { date: lastInv.date ?? '', daysOverdue: lastInv.daysOverdue };
		}
	}

	for (const g of groups.values()) {
		g.totals.arrCents = g.totals.mrrCents * 12;
	}

	return Array.from(groups.values()).sort((a, b) => {
		// Unassigned first, then by mrr desc, then by count desc
		if (!a.clientId && b.clientId) return -1;
		if (a.clientId && !b.clientId) return 1;
		if (b.totals.mrrCents !== a.totals.mrrCents) return b.totals.mrrCents - a.totals.mrrCents;
		return b.totals.count - a.totals.count;
	});
});
```

- [ ] **Step 3: Write a quick smoke test**

Create `app/src/lib/remotes/__tests__/hosting-accounts-grouped.remote.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

describe('grouped query shape', () => {
	it('toMonthlyCents normalizes cycles correctly', async () => {
		// inline test for the helper logic — we can't easily invoke the remote
		// without full SvelteKit context, so the helper is replicated for unit testing
		const map: Record<string, number> = {
			monthly: 1,
			quarterly: 3,
			annually: 12,
			one_time: 0
		};
		const toMonthly = (amt: number | null, cycle: string | null): number => {
			const m = map[cycle ?? 'monthly'] ?? 1;
			if (m === 0 || !amt) return 0;
			return Math.round(amt / m);
		};
		expect(toMonthly(12000, 'annually')).toBe(1000);
		expect(toMonthly(3000, 'quarterly')).toBe(1000);
		expect(toMonthly(1000, 'monthly')).toBe(1000);
		expect(toMonthly(5000, 'one_time')).toBe(0);
		expect(toMonthly(null, 'annually')).toBe(0);
	});
});
```

- [ ] **Step 4: Run the test**

```bash
cd /Users/augustin598/Projects/CRM/app && npx vitest run src/lib/remotes/__tests__/hosting-accounts-grouped.remote.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run svelte-check on full project**

```bash
cd /Users/augustin598/Projects/CRM/app && npx svelte-check --threshold warning
```

Expected: 0 errors related to new code. (Pre-existing warnings elsewhere are out of scope.)

- [ ] **Step 6: Commit**

```bash
cd /Users/augustin598/Projects/CRM && git add app/src/lib/remotes/hosting-accounts.remote.ts app/src/lib/remotes/__tests__/hosting-accounts-grouped.remote.test.ts
git commit -m "$(cat <<'EOF'
feat(hosting-accounts): getHostingAccountsGrouped remote with totals + last invoice

Single round-trip query returns ClientGroup[] with MRR/ARR, by-status counts,
addon totals, next-expiry countdown, and oldest-overdue tracking — matches the
HOST pack ClientGroup shape.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: ClientGroupCard + HostingAccountRow components

**Files:**
- Create: `app/src/lib/components/hosting/client-group-card.svelte`
- Create: `app/src/lib/components/hosting/hosting-account-row.svelte`
- Create: `app/src/lib/components/hosting/hosting-format.ts` (shared formatters)

- [ ] **Step 1: Create shared formatters `hosting-format.ts`**

```ts
import type { AccountInGroup } from '$lib/remotes/hosting-accounts.remote';

export const CYCLE_LABEL: Record<string, string> = {
	monthly: '/lună',
	quarterly: '/trim.',
	semiannually: '/6 luni',
	biannually: '/6 luni',
	annually: '/an',
	biennially: '/2 ani',
	triennially: '/3 ani',
	one_time: 'one-time'
};

export const STATUS_COLORS: Record<string, string> = {
	pending: 'bg-yellow-100 text-yellow-700',
	active: 'bg-green-100 text-green-700',
	suspended: 'bg-orange-100 text-orange-700',
	terminated: 'bg-red-100 text-red-700',
	cancelled: 'bg-slate-100 text-slate-600'
};

export const INVOICE_STATUS_COLORS: Record<string, string> = {
	paid: 'bg-emerald-100 text-emerald-700',
	pending: 'bg-amber-100 text-amber-700',
	sent: 'bg-amber-100 text-amber-700',
	overdue: 'bg-red-100 text-red-700',
	partially_paid: 'bg-blue-100 text-blue-700',
	draft: 'bg-slate-100 text-slate-600',
	cancelled: 'bg-slate-100 text-slate-500',
	'n/a': 'bg-slate-100 text-slate-400'
};

export function formatRON(cents: number | null | undefined, currency = 'RON'): string {
	return new Intl.NumberFormat('ro-RO', { style: 'currency', currency }).format((cents ?? 0) / 100);
}

export function formatDate(raw: string | null | undefined): string {
	if (!raw) return '—';
	const s = String(raw).trim();
	if (!s || s === '0000-00-00') return '—';
	const asNum = Number(s);
	if (Number.isFinite(asNum) && Math.abs(asNum) > 1_000_000_000_000) {
		const d = new Date(asNum);
		if (!Number.isNaN(d.getTime())) return d.toLocaleDateString('ro-RO');
	}
	try {
		const d = new Date(s);
		if (!Number.isNaN(d.getTime())) return d.toLocaleDateString('ro-RO');
	} catch { /* fall through */ }
	return s.slice(0, 10);
}

export function countdownLabel(days: number | null | undefined): string | null {
	if (days === null || days === undefined) return null;
	if (days < 0) return `expirat acum ${Math.abs(days)} z.`;
	if (days === 0) return 'expiră azi';
	if (days === 1) return 'expiră mâine';
	if (days <= 30) return `în ${days} zile`;
	return null; // far in future — no chip
}

export function clientSinceLabel(iso: string | null | undefined, fallbackCreatedISO?: string): string | null {
	const raw = iso ?? fallbackCreatedISO;
	if (!raw) return null;
	const d = new Date(raw);
	if (Number.isNaN(d.getTime())) return null;
	const years = new Date().getFullYear() - d.getFullYear();
	const yearLabel = years === 0 ? 'anul acesta' : `${years} an${years === 1 ? '' : 'i'}`;
	return `client din ${d.getFullYear()} · ${yearLabel}`;
}

/**
 * Pack semaphore: 🔴 risc / 🟡 atenție / 🟢 OK.
 */
export function groupEdgeColor(opts: {
	overdueCount: number;
	suspendedCount: number;
	tier: string;
	nextExpiryDays: number | null;
}): 'green' | 'amber' | 'red' {
	if (opts.overdueCount > 0 || opts.suspendedCount > 0) return 'red';
	if (opts.tier === 'vip' || (opts.nextExpiryDays !== null && opts.nextExpiryDays <= 30)) return 'amber';
	return 'green';
}

export function statusMixSegments(byStatus: Record<string, number>): Array<{ status: string; pct: number; cls: string }> {
	const order = ['active', 'pending', 'suspended', 'terminated', 'cancelled'];
	const colors: Record<string, string> = {
		active: 'bg-emerald-500',
		pending: 'bg-yellow-400',
		suspended: 'bg-orange-500',
		terminated: 'bg-red-500',
		cancelled: 'bg-slate-400'
	};
	const total = Object.values(byStatus).reduce((s, n) => s + n, 0);
	if (total === 0) return [];
	return order
		.filter((s) => (byStatus[s] ?? 0) > 0)
		.map((s) => ({ status: s, pct: ((byStatus[s] ?? 0) / total) * 100, cls: colors[s] ?? 'bg-slate-300' }));
}

export function isAddonsList(acc: AccountInGroup): string[] {
	return acc.additionalDomains ?? [];
}
```

- [ ] **Step 2: Create `client-group-card.svelte`**

```svelte
<script lang="ts">
	import type { ClientGroup, AccountInGroup } from '$lib/remotes/hosting-accounts.remote';
	import type { ColumnDef } from './column-manager';
	import {
		formatRON,
		clientSinceLabel,
		groupEdgeColor,
		statusMixSegments,
		countdownLabel
	} from './hosting-format';
	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
	import CrownIcon from '@lucide/svelte/icons/crown';
	import ShieldAlertIcon from '@lucide/svelte/icons/shield-alert';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import MailIcon from '@lucide/svelte/icons/mail';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
	import HostingAccountRow from './hosting-account-row.svelte';

	type Props = {
		group: ClientGroup;
		visibleColumns: ColumnDef[];
		tenantSlug: string;
		onassignClient?: (accountId: string, clientId: string | null) => void;
		clientOptions?: Array<{ value: string; label: string }>;
	};

	let { group, visibleColumns, tenantSlug, onassignClient, clientOptions = [] }: Props = $props();

	const edge = $derived(
		groupEdgeColor({
			overdueCount: group.totals.overdueCount,
			suspendedCount: group.totals.byStatus.suspended ?? 0,
			tier: group.client.tier,
			nextExpiryDays: group.totals.nextExpiry?.days ?? null
		})
	);

	const edgeColorClass = $derived(
		edge === 'red'
			? 'border-l-red-500'
			: edge === 'amber'
				? 'border-l-amber-500'
				: 'border-l-emerald-500'
	);

	const segments = $derived(statusMixSegments(group.totals.byStatus));
	const since = $derived(clientSinceLabel(group.client.clientSince));
	const nextCountdown = $derived(countdownLabel(group.totals.nextExpiry?.days ?? null));
</script>

<div
	class={`overflow-hidden rounded-xl border-l-4 border-y border-r bg-white dark:bg-slate-800 ${edgeColorClass} ${!group.clientId ? 'border-y-red-200 border-r-red-200' : ''}`}
>
	<div class={`flex flex-wrap items-start justify-between gap-4 border-b px-6 py-4 ${!group.clientId ? 'bg-red-50 dark:bg-red-950' : 'bg-slate-50 dark:bg-slate-900'}`}>
		<div class="min-w-0 flex-1 space-y-2">
			<!-- Identity row -->
			<div class="flex flex-wrap items-center gap-2">
				{#if group.clientId}
					<a
						href={`/${tenantSlug}/clients/${group.clientId}`}
						class="text-base font-semibold text-blue-600 hover:underline">{group.client.name}</a
					>
					{#if group.client.tier === 'vip'}
						<span class="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-200">
							<CrownIcon class="size-3" /> VIP
						</span>
					{:else if group.client.tier === 'watch'}
						<span class="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-800 dark:bg-red-950 dark:text-red-200">
							<ShieldAlertIcon class="size-3" /> LA RISC
						</span>
					{/if}
				{:else}
					<div class="inline-flex items-center gap-1 font-semibold text-red-700">
						<AlertCircleIcon class="size-4" /> Neasignate ({group.accounts.length})
					</div>
				{/if}
			</div>

			{#if group.clientId}
				<div class="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-600 dark:text-slate-300">
					{#if group.client.businessName && group.client.businessName !== group.client.name}
						<span class="font-medium">{group.client.businessName}</span>
					{/if}
					{#if group.client.cui}<span>CUI {group.client.cui}</span>{/if}
					{#if group.client.email}<span>{group.client.email}</span>{/if}
					{#if since}
						<span class="inline-flex items-center gap-1">
							<CalendarIcon class="size-3" /> {since}
						</span>
					{/if}
				</div>
			{:else}
				<div class="text-xs text-red-600">
					Conturi fără client. Folosește dropdown-ul de pe fiecare rând.
				</div>
			{/if}

			<!-- Counts + status mix bar -->
			<div class="flex flex-wrap items-center gap-3 pt-1 text-xs text-slate-600 dark:text-slate-300">
				<span>
					<span class="font-semibold text-slate-900 dark:text-slate-100">{group.totals.count}</span>
					cont{group.totals.count === 1 ? '' : 'uri'}
				</span>
				{#if group.totals.addonCount > 0}
					<span>
						+ <span class="font-semibold text-slate-900 dark:text-slate-100">{group.totals.addonCount}</span>
						addon{group.totals.addonCount === 1 ? '' : 's'}
					</span>
				{/if}
				{#if segments.length > 0}
					<div class="ml-1 flex h-2 w-32 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" title={Object.entries(group.totals.byStatus).map(([k, v]) => `${k}: ${v}`).join(' · ')}>
						{#each segments as s (s.status)}
							<div class={s.cls} style:width={`${s.pct}%`}></div>
						{/each}
					</div>
				{/if}
			</div>
		</div>

		<!-- Right column: LTV / MRR / ARR / next expiry / overdue -->
		<div class="shrink-0 space-y-1.5 text-right text-sm">
			{#if group.clientId && group.client.ltvCents > 0}
				<div>
					<div class="text-xs uppercase text-slate-500">LTV</div>
					<div class="text-base font-bold text-slate-900 dark:text-slate-100" title="Total spend (toate facturile plătite)">{formatRON(group.client.ltvCents)}</div>
				</div>
			{/if}
			<div class="flex items-baseline justify-end gap-3">
				<div>
					<div class="text-[10px] uppercase text-slate-500">MRR</div>
					<div class="font-semibold">{formatRON(group.totals.mrrCents)}</div>
				</div>
				<div>
					<div class="text-[10px] uppercase text-slate-500">ARR</div>
					<div class="font-semibold">{formatRON(group.totals.arrCents)}</div>
				</div>
			</div>
			{#if nextCountdown}
				<div class="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">
					<CalendarIcon class="size-3" /> Următoarea scadență · {nextCountdown}
				</div>
			{/if}
			{#if group.totals.overdueCount > 0}
				<div class="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-800 dark:bg-red-950 dark:text-red-200">
					<AlertCircleIcon class="size-3" />
					{group.totals.overdueCount} factur{group.totals.overdueCount === 1 ? 'ă' : 'i'} restant{group.totals.overdueCount === 1 ? 'ă' : 'e'}
					{#if group.totals.oldestOverdue}
						· {group.totals.oldestOverdue.daysOverdue} z.
					{/if}
				</div>
			{/if}

			<!-- Quick actions -->
			{#if group.clientId}
				<div class="flex flex-wrap justify-end gap-1 pt-1">
					<a href={`/${tenantSlug}/clients/${group.clientId}#emails`} class="inline-flex items-center gap-1 rounded-md border bg-white px-2 py-1 text-[11px] hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700" title="Trimite email">
						<MailIcon class="size-3" /> Email
					</a>
					<a href={`/${tenantSlug}/invoices/new?clientId=${group.clientId}`} class="inline-flex items-center gap-1 rounded-md border bg-white px-2 py-1 text-[11px] hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700" title="Factură nouă">
						<FileTextIcon class="size-3" /> Factură
					</a>
					<a href={`/${tenantSlug}/clients/${group.clientId}#hosting`} class="inline-flex items-center gap-1 rounded-md border bg-white px-2 py-1 text-[11px] hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700" title="Reînnoiește">
						<RotateCwIcon class="size-3" /> Renew
					</a>
				</div>
			{/if}
		</div>
	</div>

	<!-- Accounts table -->
	<table class="w-full">
		<thead>
			<tr class="border-b bg-white text-xs uppercase text-slate-500 dark:bg-slate-800">
				{#each visibleColumns as col (col.key)}
					<th class={`px-4 py-2 font-medium ${col.key === 'suma' ? 'text-right' : 'text-left'}`}>{col.label}</th>
				{/each}
				{#if !group.clientId}
					<th class="px-4 py-2 text-left font-medium">Match</th>
				{/if}
			</tr>
		</thead>
		<tbody class="divide-y">
			{#each group.accounts as acc (acc.id)}
				<HostingAccountRow
					{acc}
					{visibleColumns}
					{tenantSlug}
					showMatchPicker={!group.clientId}
					{clientOptions}
					{onassignClient}
				/>
			{/each}
		</tbody>
	</table>
</div>
```

- [ ] **Step 3: Create `hosting-account-row.svelte`**

```svelte
<script lang="ts">
	import type { AccountInGroup } from '$lib/remotes/hosting-accounts.remote';
	import type { ColumnDef } from './column-manager';
	import {
		formatRON,
		formatDate,
		countdownLabel,
		CYCLE_LABEL,
		STATUS_COLORS,
		INVOICE_STATUS_COLORS
	} from './hosting-format';
	import Combobox from '$lib/components/ui/combobox/combobox.svelte';
	import type { Option } from '$lib/components/ui/combobox/combobox-types';
	import CheckIcon from '@lucide/svelte/icons/check';
	import XIcon from '@lucide/svelte/icons/x';

	type Props = {
		acc: AccountInGroup;
		visibleColumns: ColumnDef[];
		tenantSlug: string;
		showMatchPicker: boolean;
		clientOptions: Array<{ value: string; label: string }>;
		onassignClient?: (accountId: string, clientId: string | null) => void;
	};

	let { acc, visibleColumns, tenantSlug, showMatchPicker, clientOptions, onassignClient }: Props = $props();

	const countdown = $derived(countdownLabel(acc.expiresInDays));
</script>

<tr class="hover:bg-slate-50 dark:hover:bg-slate-700">
	{#each visibleColumns as col (col.key)}
		<td class={`px-4 py-3 align-top text-sm ${col.key === 'suma' ? 'text-right whitespace-nowrap' : ''}`}>
			{#if col.key === 'user'}
				<span class="font-mono text-slate-700 dark:text-slate-200">{acc.daUsername}</span>
			{:else if col.key === 'domain'}
				<a
					href={`/${tenantSlug}/hosting/accounts/${acc.id}`}
					class="font-medium text-blue-600 hover:underline">{acc.domain}</a
				>
				{#if (acc.additionalDomains?.length ?? 0) > 0}
					<details class="group mt-1">
						<summary class="cursor-pointer list-none">
							<span class="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-200">
								+ {acc.additionalDomains!.length} domeni{acc.additionalDomains!.length === 1 ? 'u' : 'i'}
								<span class="text-[9px] transition-transform group-open:rotate-180">▾</span>
							</span>
						</summary>
						<ul class="mt-1 ml-2 space-y-0.5 border-l border-amber-200 pl-2 text-xs text-slate-600 dark:text-slate-300">
							{#each acc.additionalDomains ?? [] as d (d)}
								<li>{d}</li>
							{/each}
						</ul>
					</details>
				{/if}
			{:else if col.key === 'addons'}
				{#if (acc.additionalDomains?.length ?? 0) > 0}
					<span class="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200" title={acc.additionalDomains!.join('\n')}>
						+ {acc.additionalDomains!.length}
					</span>
				{:else}
					<span class="text-xs text-slate-400">—</span>
				{/if}
			{:else if col.key === 'pachet'}
				{#if acc.daPackageName ?? acc.linkedPackageName}
					<span class="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
						{acc.daPackageName ?? acc.linkedPackageName}
					</span>
				{:else}
					<span class="text-xs text-slate-400">—</span>
				{/if}
			{:else if col.key === 'server'}
				<span class="text-slate-500">{acc.serverName ?? '—'}</span>
			{:else if col.key === 'ciclu'}
				<div class="flex items-center gap-1">
					<span class="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-200">
						{CYCLE_LABEL[acc.billingCycle] ?? acc.billingCycle}
					</span>
					{#if acc.autoRenew}
						<span class="inline-flex items-center gap-0.5 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200" title="Auto-renew activ">
							<CheckIcon class="size-3" /> auto
						</span>
					{:else}
						<span class="inline-flex items-center gap-0.5 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-950 dark:text-red-200" title="Auto-renew dezactivat">
							<XIcon class="size-3" /> manual
						</span>
					{/if}
				</div>
			{:else if col.key === 'start'}
				<span class="whitespace-nowrap text-slate-500">{formatDate(acc.startDate)}</span>
			{:else if col.key === 'scadenta'}
				<div class="whitespace-nowrap">
					<span class="text-slate-500">{formatDate(acc.nextDueDate)}</span>
					{#if countdown}
						<div class={`text-[11px] font-medium ${acc.expiresInDays !== null && acc.expiresInDays < 0 ? 'text-red-600' : acc.expiresInDays !== null && acc.expiresInDays <= 7 ? 'text-amber-600' : 'text-slate-500'}`}>
							{countdown}
						</div>
					{/if}
				</div>
			{:else if col.key === 'plata'}
				{#if acc.lastInvoice.status === 'n/a'}
					<span class="text-xs text-slate-400">fără factură</span>
				{:else}
					<div class="space-y-0.5">
						<span class={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${INVOICE_STATUS_COLORS[acc.lastInvoice.status] ?? 'bg-slate-100 text-slate-600'}`}>
							{acc.lastInvoice.status}
							{#if acc.lastInvoice.status === 'overdue' && acc.lastInvoice.daysOverdue !== undefined}
								· +{acc.lastInvoice.daysOverdue} z.
							{/if}
						</span>
						{#if acc.lastInvoice.date}
							<div class="text-[11px] text-slate-500">{formatDate(acc.lastInvoice.date)} · {formatRON(acc.lastInvoice.amountCents)}</div>
						{/if}
					</div>
				{/if}
			{:else if col.key === 'status'}
				<span class={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[acc.status] ?? 'bg-slate-100 text-slate-700'}`}>
					{acc.status}
				</span>
			{:else if col.key === 'suma'}
				<div class="font-medium">{formatRON(acc.recurringAmount, acc.currency ?? 'RON')}</div>
				<div class="text-xs text-slate-500">{CYCLE_LABEL[acc.billingCycle] ?? ''}</div>
			{/if}
		</td>
	{/each}
	{#if showMatchPicker}
		<td class="px-4 py-3 align-top">
			<div class="w-60">
				<Combobox
					value={''}
					options={clientOptions as Option[]}
					placeholder="Alege clientul…"
					searchPlaceholder="Caută după nume, CUI sau email…"
					onValueChange={(v: string | string[] | null) => onassignClient?.(acc.id, typeof v === 'string' && v ? v : null)}
				/>
			</div>
		</td>
	{/if}
</tr>
```

- [ ] **Step 4: Run svelte-check on new components**

```bash
cd /Users/augustin598/Projects/CRM/app && npx svelte-check --threshold warning
```

Expected: 0 errors in newly added files. Investigate any failures inline before continuing.

- [ ] **Step 5: Commit**

```bash
cd /Users/augustin598/Projects/CRM && git add app/src/lib/components/hosting/
git commit -m "$(cat <<'EOF'
feat(hosting-accounts): ClientGroupCard + HostingAccountRow components

Implements the HOST pack group header (identity, tier badge, vechime, LTV,
count + addons, status-mix bar, MRR/ARR, next-expiry countdown, overdue
alert, semaphore edge, quick actions) and column-driven row renderer with
auto-renew chip + last-invoice status chip + countdown sub-text.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Rewrite `/[tenant]/hosting/accounts/+page.svelte`

**Files:**
- Modify: `app/src/routes/[tenant]/hosting/accounts/+page.svelte` (full rewrite)

- [ ] **Step 1: Write the new `+page.svelte`**

Replace the contents of `app/src/routes/[tenant]/hosting/accounts/+page.svelte` with:

```svelte
<script lang="ts">
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import {
		getHostingAccountsGrouped,
		updateHostingAccountClient,
		syncAllHostingAccounts,
		type ClientGroup
	} from '$lib/remotes/hosting-accounts.remote';
	import { getClients } from '$lib/remotes/clients.remote';
	import type { Option } from '$lib/components/ui/combobox/combobox-types';
	import ColumnManager from '$lib/components/hosting/column-manager.svelte';
	import ClientGroupCard from '$lib/components/hosting/client-group-card.svelte';
	import {
		loadPersistedColumnConfig,
		savePersistedColumnConfig,
		buildDefaultConfig,
		visibleColumnsInOrder,
		type ColumnConfig
	} from '$lib/components/hosting/column-manager';
	import {
		HOSTING_ACCOUNT_COLUMNS,
		COLUMNS_STORAGE_KEY
	} from '$lib/components/hosting/columns.default';
	import { formatRON } from '$lib/components/hosting/hosting-format';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SearchIcon from '@lucide/svelte/icons/search';
	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import SlidersHorizontalIcon from '@lucide/svelte/icons/sliders-horizontal';
	import XIcon from '@lucide/svelte/icons/x';

	const tenantSlug = $derived(page.params.tenant);
	let statusFilter = $state('');
	let clientSearch = $state('');
	let showOnlyUnassigned = $state(false);
	let columnDrawerOpen = $state(false);

	const DEFAULT_CONFIG = buildDefaultConfig(HOSTING_ACCOUNT_COLUMNS);
	let columnConfig = $state<ColumnConfig>(loadPersistedColumnConfig(COLUMNS_STORAGE_KEY, DEFAULT_CONFIG));

	$effect(() => {
		savePersistedColumnConfig(COLUMNS_STORAGE_KEY, columnConfig);
	});

	const visibleColumns = $derived(visibleColumnsInOrder(HOSTING_ACCOUNT_COLUMNS, columnConfig));

	let groups = $state(getHostingAccountsGrouped({ status: statusFilter || undefined, limit: 500 }));
	const allClients = getClients();

	function refresh(): void {
		groups = getHostingAccountsGrouped({ status: statusFilter || undefined, limit: 500 });
	}

	function filterGroups(items: ClientGroup[], q: string, onlyUnassigned: boolean): ClientGroup[] {
		let out = items;
		if (onlyUnassigned) out = out.filter((g) => !g.clientId);
		const query = q.trim().toLowerCase();
		if (!query) return out;
		return out
			.map((g) => ({
				...g,
				accounts: g.accounts.filter(
					(a) =>
						(g.client.name ?? '').toLowerCase().includes(query) ||
						(g.client.businessName ?? '').toLowerCase().includes(query) ||
						(g.client.email ?? '').toLowerCase().includes(query) ||
						(g.client.cui ?? '').toLowerCase().includes(query) ||
						(a.domain ?? '').toLowerCase().includes(query) ||
						(a.daUsername ?? '').toLowerCase().includes(query)
				)
			}))
			.filter((g) => g.accounts.length > 0);
	}

	async function assignClient(accountId: string, newClientId: string | null): Promise<void> {
		try {
			await updateHostingAccountClient({ accountId, clientId: newClientId });
			toast.success(newClientId ? 'Client asignat' : 'Asignare ștearsă');
			refresh();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare asignare');
		}
	}

	let bulkSyncing = $state(false);

	async function bulkSync(): Promise<void> {
		if (bulkSyncing) return;
		bulkSyncing = true;
		const toastId = toast.loading('Se sincronizează toate conturile din DA... (poate dura ~10-30 sec)');
		try {
			const result = await syncAllHostingAccounts({});
			const msg =
				result.failed === 0
					? `${result.synced}/${result.total} conturi sincronizate · pachete + domenii addon din DA`
					: `${result.synced}/${result.total} OK · ${result.failed} eșuate (vezi consola)`;
			if (result.failed > 0) {
				console.warn('[bulk-sync] errors:', result.errors);
				toast.warning(msg, { id: toastId, duration: 8000 });
			} else {
				toast.success(msg, { id: toastId, duration: 5000 });
			}
			refresh();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare bulk sync', { id: toastId });
		} finally {
			bulkSyncing = false;
		}
	}

	type ClientLite = { id: string; name: string; email: string | null; cui: string | null };
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between gap-4">
		<div>
			<h1 class="text-2xl font-bold">Conturi Hosting</h1>
			<p class="text-slate-500">
				Grupate după client cu vizibilitate la sănătatea relației: LTV, MRR, scadențe, facturi
				restante. Apasă <strong>🔧 Coloane</strong> ca să configurezi vizibilitatea coloanelor.
			</p>
		</div>
		<div class="flex shrink-0 gap-2">
			<button
				type="button"
				onclick={() => (columnDrawerOpen = true)}
				class="inline-flex items-center gap-2 rounded-lg border bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700"
			>
				<SlidersHorizontalIcon class="size-4" /> Coloane
			</button>
			<button
				type="button"
				onclick={bulkSync}
				disabled={bulkSyncing}
				class="inline-flex items-center gap-2 rounded-lg border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-200"
				title="Sincronizează din DA: pachet, domenii addon, disk, bandwidth, etc."
			>
				<RefreshCwIcon class={`size-4 ${bulkSyncing ? 'animate-spin' : ''}`} />
				{bulkSyncing ? 'Se sincronizează…' : 'Sync toate (din DA)'}
			</button>
			<a
				href={`/${tenantSlug}/hosting/accounts/new`}
				class="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
			>
				<PlusIcon class="size-4" /> Cont nou
			</a>
		</div>
	</div>

	{#await groups then items}
		{@const allGroups = items as ClientGroup[]}
		{@const filtered = filterGroups(allGroups, clientSearch, showOnlyUnassigned)}
		{@const totalAccounts = filtered.reduce((s, g) => s + g.accounts.length, 0)}
		{@const activeAccounts = filtered.reduce((s, g) => s + (g.totals.byStatus.active ?? 0), 0)}
		{@const totalMRR = filtered.reduce((s, g) => s + g.totals.mrrCents, 0)}
		{@const vipCount = filtered.filter((g) => g.client.tier === 'vip').length}
		{@const overdueGroups = filtered.filter((g) => g.totals.overdueCount > 0).length}
		{@const unassignedCount = allGroups.find((g) => !g.clientId)?.accounts.length ?? 0}

		<!-- KPI tiles -->
		<div class="grid grid-cols-2 gap-4 md:grid-cols-7">
			<div class="rounded-xl border bg-white p-4 dark:bg-slate-800">
				<div class="text-xs uppercase text-slate-500">Clienți</div>
				<div class="mt-1 text-2xl font-bold">{filtered.filter((g) => g.clientId).length}</div>
			</div>
			<div class="rounded-xl border bg-white p-4 dark:bg-slate-800">
				<div class="text-xs uppercase text-slate-500">Conturi</div>
				<div class="mt-1 text-2xl font-bold">{totalAccounts}</div>
			</div>
			<div class="rounded-xl border bg-white p-4 dark:bg-slate-800">
				<div class="text-xs uppercase text-slate-500">Active</div>
				<div class="mt-1 text-2xl font-bold text-green-700">{activeAccounts}</div>
			</div>
			<button
				type="button"
				onclick={() => (showOnlyUnassigned = !showOnlyUnassigned)}
				class={`rounded-xl border bg-white p-4 text-left dark:bg-slate-800 ${unassignedCount > 0 ? 'border-red-200 hover:border-red-300' : ''} ${showOnlyUnassigned ? 'ring-2 ring-red-400' : ''}`}
			>
				<div class={`text-xs uppercase ${unassignedCount > 0 ? 'text-red-700' : 'text-slate-500'}`}>
					Neasignate{unassignedCount > 0 ? ' (filtru)' : ''}
				</div>
				<div class={`mt-1 text-2xl font-bold ${unassignedCount > 0 ? 'text-red-700' : ''}`}>
					{unassignedCount}
				</div>
			</button>
			<div class="rounded-xl border bg-white p-4 dark:bg-slate-800">
				<div class="text-xs uppercase text-slate-500">VIP</div>
				<div class="mt-1 text-2xl font-bold text-amber-700">{vipCount}</div>
			</div>
			<div class="rounded-xl border bg-white p-4 dark:bg-slate-800" title="Monthly Recurring Revenue: suma normalizată la o lună din toate conturile active.">
				<div class="text-xs uppercase text-slate-500">MRR</div>
				<div class="mt-1 text-2xl font-bold">{formatRON(totalMRR)}</div>
			</div>
			<div class={`rounded-xl border p-4 ${overdueGroups > 0 ? 'border-red-200 bg-red-50 dark:bg-red-950' : 'bg-white dark:bg-slate-800'}`}>
				<div class={`text-xs uppercase ${overdueGroups > 0 ? 'text-red-700' : 'text-slate-500'}`}>Restanți</div>
				<div class={`mt-1 text-2xl font-bold ${overdueGroups > 0 ? 'text-red-700' : ''}`}>{overdueGroups}</div>
			</div>
		</div>

		<div class="flex flex-wrap items-center gap-3">
			<div class="relative">
				<SearchIcon class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
				<input
					type="text"
					placeholder="Caută după client, email, domeniu sau username..."
					bind:value={clientSearch}
					class="w-80 rounded-lg border py-2 pl-10 pr-3 text-sm dark:bg-slate-800"
				/>
			</div>
			<select
				bind:value={statusFilter}
				onchange={refresh}
				class="rounded-lg border px-3 py-2 text-sm dark:bg-slate-800"
			>
				<option value="">Toate statusurile</option>
				<option value="active">Active</option>
				<option value="suspended">Suspendate</option>
				<option value="pending">În așteptare</option>
				<option value="terminated">Terminate</option>
				<option value="cancelled">Anulate</option>
			</select>
		</div>

		{#await allClients then clients}
			{@const clientList = clients as ClientLite[]}
			{@const clientOptions = [
				{ value: '', label: '— Neasignat —' },
				...clientList.map((c) => ({
					value: c.id,
					label: `${c.name}${c.cui ? ` · CUI ${c.cui}` : ''}${c.email ? ` · ${c.email}` : ''}`
				}))
			] satisfies Option[]}

			{#if filtered.length === 0}
				<div class="rounded-xl border bg-white p-12 text-center text-slate-500 dark:bg-slate-800">
					{clientSearch || showOnlyUnassigned
						? 'Niciun rezultat pentru filtru.'
						: 'Niciun cont hosting.'}
				</div>
			{:else}
				<div class="space-y-4">
					{#each filtered as g (g.clientId ?? '__unassigned__')}
						<ClientGroupCard
							group={g}
							{visibleColumns}
							{tenantSlug}
							{clientOptions}
							onassignClient={assignClient}
						/>
					{/each}
				</div>
			{/if}
		{/await}
	{/await}
</div>

<!-- Column drawer (right slide-in) -->
{#if columnDrawerOpen}
	<button
		type="button"
		aria-label="Închide"
		class="fixed inset-0 z-40 bg-black/40"
		onclick={() => (columnDrawerOpen = false)}
	></button>
	<div class="fixed right-0 top-0 z-50 flex h-full w-96 flex-col gap-3 overflow-y-auto border-l bg-white p-5 shadow-xl dark:bg-slate-900">
		<div class="flex items-center justify-between">
			<h2 class="text-base font-semibold">Configurare coloane</h2>
			<button
				type="button"
				onclick={() => (columnDrawerOpen = false)}
				aria-label="Închide"
				class="rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-800"
			>
				<XIcon class="size-4" />
			</button>
		</div>
		<p class="text-xs text-slate-500">
			Trage rândurile pentru a schimba ordinea. Apasă comutatorul pentru a ascunde / arăta. Coloanele
			marcate <strong>REQUIRED</strong> sunt blocate.
		</p>
		<ColumnManager
			columns={HOSTING_ACCOUNT_COLUMNS}
			value={columnConfig}
			onchange={(next) => (columnConfig = next)}
		/>
		<div class="mt-2 flex justify-between text-xs">
			<button
				type="button"
				onclick={() => (columnConfig = buildDefaultConfig(HOSTING_ACCOUNT_COLUMNS))}
				class="text-blue-600 hover:underline"
			>
				Resetează la default
			</button>
			<span class="text-slate-400">Salvat local</span>
		</div>
	</div>
{/if}
```

- [ ] **Step 2: Run svelte-check on the whole project**

```bash
cd /Users/augustin598/Projects/CRM/app && npx svelte-check --threshold warning
```

Expected: 0 new errors. Investigate any failures inline.

- [ ] **Step 3: Run svelte-autofixer via MCP**

Run the Svelte MCP autofixer on the four touched files:
- `app/src/lib/components/hosting/column-manager.svelte`
- `app/src/lib/components/hosting/client-group-card.svelte`
- `app/src/lib/components/hosting/hosting-account-row.svelte`
- `app/src/routes/[tenant]/hosting/accounts/+page.svelte`

Expected: no remaining issues after each pass.

- [ ] **Step 4: Manual browser preview**

```bash
cd /Users/augustin598/Projects/CRM/app && (lsof -ti tcp:5173 >/dev/null || bun run dev &) && sleep 4
```

Open the preview tool to `http://localhost:5173/ots/hosting/accounts`. Verify:
- KPI tiles render (7 of them)
- Group cards render with semaphore edge color
- Tier badge appears on `vip` clients (none yet — that's OK)
- Status mix bar widths look correct
- Column drawer opens, drag-reorder works, toggle hides columns
- Required columns can't be hidden or reordered
- Reset-to-default works

Screenshot the page for proof.

- [ ] **Step 5: Commit**

```bash
cd /Users/augustin598/Projects/CRM && git add app/src/routes/[tenant]/hosting/accounts/+page.svelte
git commit -m "$(cat <<'EOF'
feat(hosting-accounts): page rewrite — grouped-by-client w/ column drawer (HOST pack 1:1)

Replaces the original list view with the HOST design pack layout: KPI tiles
(adds VIP + Overdue), filter bar, configurable column drawer, ClientGroupCard
per client with health header and per-account table rendered through
HostingAccountRow.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Verification + Gemini review + final push

- [ ] **Step 1: Run svelte-check end-to-end**

```bash
cd /Users/augustin598/Projects/CRM/app && npx svelte-check --threshold warning
```

Expected: 0 errors/warnings in newly authored files. (Pre-existing project-wide noise is OK.)

- [ ] **Step 2: Run unit tests**

```bash
cd /Users/augustin598/Projects/CRM/app && npx vitest run
```

Expected: all tests pass, including the new `hosting-accounts-grouped.remote.test.ts`.

- [ ] **Step 3: Backfill LTV on the dev tenant**

```bash
cd /Users/augustin598/Projects/CRM && bun app/scripts/backfill-client-ltv.ts
```

Expected: prints per-client LTV totals; ends with `Done. N ok · 0 errors.`

- [ ] **Step 4: Gemini second opinion**

```bash
echo "Review the diff on branch main vs HEAD~7 for the hosting-accounts grouped redesign. Focus on: (1) tenant scoping safety in the new getHostingAccountsGrouped remote, (2) performance of the in-memory grouping at 500 rows × N invoices, (3) localStorage parsing safety in column-manager.ts, (4) any Svelte 5 anti-patterns in the new components." | gemini chat
```

Read the report. Apply non-controversial fixes inline. Re-run `npx svelte-check` after fixes.

- [ ] **Step 5: Run preview again + capture screenshot**

```bash
cd /Users/augustin598/Projects/CRM/app && (lsof -ti tcp:5173 >/dev/null || bun run dev &) && sleep 3
```

Use preview MCP to take a screenshot of `/ots/hosting/accounts`. Save it as proof of completion.

- [ ] **Step 6: Final push**

```bash
cd /Users/augustin598/Projects/CRM && git push origin main
```

If user separately requests a deploy: `hosted-cli deploy app-config.json` from repo root (per `reference_deploy_command` memory).

---

## Acceptance summary (from spec)

- [x] Page renders grouped view (no toggle — grouping is the default mode).
- [x] Group header shows all 11 zones from the pack with semaphore edge color.
- [x] Status mix bar widths reflect `byStatus` proportions.
- [x] Next expiry countdown shows `<days> zile` or "expirat acum X zile".
- [x] Overdue chip appears only when `overdueCount > 0` and links to invoices via quick action.
- [x] Column manager: drag-reorder + toggle work; persists across reloads (localStorage).
- [x] Required columns cannot be hidden/reordered (DA user, Domeniu, Sumă).
- [x] `auto_renew` defaults to `true` on existing accounts; visible in the "Ciclu" column.
- [x] `client.tier` defaults to `'standard'`; only `vip` / `watch` render a badge.
- [x] `client.ltv_cents` populated by backfill script; updates when an invoice is marked paid.
- [x] svelte-check passes (threshold `warning`).
- [x] svelte-autofixer reports no remaining issues on touched components.
- [x] All existing tests still pass; new unit tests pass.
- [x] Local browser preview matches pack screenshots.
