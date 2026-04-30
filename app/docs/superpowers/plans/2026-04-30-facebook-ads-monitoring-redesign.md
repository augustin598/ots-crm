# Facebook Ads Monitoring Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign `/ots/reports/facebook-ads/monitoring` with KPI strip, ad-account context, side drawer with Performance/Edit/Overrides/History tabs, plus deterministic worker training loop via per-target overrides and rejection feedback.

**Architecture:** Three sequential PRs. PR1 lands schema + diff helper. PR2 lands endpoints + worker integration with optimistic locking. PR3 lands the Svelte component refactor. Worker (PersonalOPS) deploys after PR2 is live in CRM.

**Tech Stack:** SvelteKit + Bun + Drizzle ORM + Turso libSQL (CRM). Bun + Hono (PersonalOPS). Tests via `bun:test`. UI: shadcn-svelte (Sheet, Card, Button, Badge already in `$lib/components/ui/`).

**Spec reference:** `docs/superpowers/specs/2026-04-30-facebook-ads-monitoring-redesign-design.md`

---

## File Structure

### CRM repo (`/Users/augustin598/Projects/CRM/app`)

```
src/lib/server/db/
  schema.ts                                          [MODIFY: extend adMonitorTarget, add 2 tables]
  ads-monitor/
    diff-builder.ts                                  [CREATE]
    diff-builder.test.ts                             [CREATE]
    audit-writer.ts                                  [CREATE]
    feedback-aggregate.ts                            [CREATE]
    feedback-aggregate.test.ts                       [CREATE]

drizzle/
  0227_ad_monitor_target_overrides.sql               [CREATE — generated]
  0228_ad_monitor_target_audit.sql                   [CREATE — generated]
  0229_ad_recommendation_feedback.sql                [CREATE — generated]

src/routes/[tenant]/api/ads-monitor/
  targets/+server.ts                                 [MODIFY: POST inserts created audit + ad-account lookup]
  targets/[id]/+server.ts                            [MODIFY: PATCH adds optimistic lock + audit + new fields]
  targets/[id]/audit/+server.ts                      [CREATE — GET]
  summary/+server.ts                                 [CREATE — GET]
  recommendations/[id]/reject/+server.ts             [MODIFY: write feedback row]

src/routes/api/external/ads-monitor/
  targets/[id]/+server.ts                            [MODIFY: ?withOverrides=true]
  targets/[id]/auto-suppress/+server.ts              [CREATE — POST]

src/routes/[tenant]/reports/facebook-ads/monitoring/
  +page.server.ts                                    [MODIFY: extended query + ad-account join + 7d agg]
  +page.svelte                                       [MODIFY: wire new components]
  components/
    KpiStrip.svelte                                  [CREATE]
    TargetFilters.svelte                             [CREATE]
    TargetRow.svelte                                 [CREATE]
    Sparkline.svelte                                 [CREATE]
    TargetDrawer.svelte                              [CREATE]
    AddTargetForm.svelte                             [CREATE]
    RejectRecModal.svelte                            [CREATE]
    drawer/
      PerformanceTab.svelte                          [CREATE]
      EditTargetTab.svelte                           [CREATE]
      OverridesTab.svelte                            [CREATE]
      HistoryTab.svelte                              [CREATE]
```

### PersonalOPS repo (`/Users/augustin598/Projects/PersonalOPS`)

```
src/services/workers/ads-optimizer/
  types.ts                                           [MODIFY: add override fields to DecideInput]
  decision-engine.ts                                 [MODIFY: read overrides + rejection rate]
  __tests__/
    decision-engine.test.ts                          [MODIFY: add 6 override cases]
    decision-engine-feedback-loop.test.ts            [CREATE]
  handler.ts                                         [MODIFY: fetch overrides + compute rates + auto-suppress]
src/services/workers/
  ads-crm-client.ts                                  [MODIFY: add getTargetWithOverrides + autoSuppress]
```

---

# PR 1 — Data Layer

**Goal:** Land schema changes, migrations, diff helper. No behavior change yet (columns nullable, tables new).

**Branch:** `feat/ads-monitoring-redesign-data`

---

### Task 1.1: Extend `adMonitorTarget` schema with override + version columns

**Files:**
- Modify: `src/lib/server/db/schema.ts:4300-4344`

- [ ] **Step 1: Add 6 new columns to `adMonitorTarget` definition**

In the schema, find the `adMonitorTarget` table block (around line 4300). After `notifyInApp: boolean('notify_in_app')...` and before `createdByUserId`, add:

```ts
		// User-facing free-form notes (max 500 char enforced server-side)
		notes: text('notes'),
		// Worker overrides — null = use default
		externalAdAccountId: text('external_ad_account_id'),
		customCooldownHours: integer('custom_cooldown_hours'),
		// JSON array of AdRecommendationAction strings; queried via json_each()
		suppressedActions: text('suppressed_actions').notNull().default('[]'),
		severityOverride: text('severity_override'),
		minConversionsThreshold: integer('min_conversions_threshold'),
		// Optimistic-locking guard
		version: integer('version').notNull().default(1),
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/augustin598/Projects/CRM/app && bunx tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected: no errors related to `adMonitorTarget`.

- [ ] **Step 3: Commit**

```bash
cd /Users/augustin598/Projects/CRM/app
git add src/lib/server/db/schema.ts
git commit -m "feat(ads-monitor): add override + version columns to adMonitorTarget"
```

---

### Task 1.2: Add `adMonitorTargetAudit` table

**Files:**
- Modify: `src/lib/server/db/schema.ts` (after `adMonitorTargetRelations` block, ~line 4424)

- [ ] **Step 1: Add table definition + relations + types**

After the `adMonitorTargetRelations` export (around line 4424), insert:

```ts
// Immutable audit trail for adMonitorTarget changes — written on POST/PATCH/DELETE/mute/unmute
export const adMonitorTargetAudit = sqliteTable(
	'ad_monitor_target_audit',
	{
		id: text('id').primaryKey(),
		tenantId: text('tenant_id')
			.notNull()
			.references(() => tenant.id),
		targetId: text('target_id')
			.notNull()
			.references(() => adMonitorTarget.id, { onDelete: 'cascade' }),
		actorType: text('actor_type').notNull(), // 'user' | 'worker' | 'system'
		actorId: text('actor_id').notNull(), // user.id | worker_id | 'system'
		action: text('action').notNull(), // 'created'|'updated'|'muted'|'unmuted'|'deactivated'|'reactivated'
		changesJson: text('changes_json').notNull().default('{}'), // {field: {from, to}}
		note: text('note'), // free-form, max 200 char enforced server-side
		metadataJson: text('metadata_json').notNull().default('{}'), // ex: {expiresAt: ISO} for auto-suppress
		at: timestamp('at', { withTimezone: true, mode: 'date' })
			.notNull()
			.default(sql`current_timestamp`)
	},
	(t) => ({
		targetAtIdx: index('ad_monitor_target_audit_target_at_idx').on(t.targetId, t.at),
		tenantAtIdx: index('ad_monitor_target_audit_tenant_at_idx').on(t.tenantId, t.at)
	})
);

export const adMonitorTargetAuditRelations = relations(adMonitorTargetAudit, ({ one }) => ({
	tenant: one(tenant, { fields: [adMonitorTargetAudit.tenantId], references: [tenant.id] }),
	target: one(adMonitorTarget, {
		fields: [adMonitorTargetAudit.targetId],
		references: [adMonitorTarget.id]
	})
}));

export type AdMonitorTargetAudit = typeof adMonitorTargetAudit.$inferSelect;
export type NewAdMonitorTargetAudit = typeof adMonitorTargetAudit.$inferInsert;

export const AD_AUDIT_ACTOR_TYPES = ['user', 'worker', 'system'] as const;
export type AdAuditActorType = (typeof AD_AUDIT_ACTOR_TYPES)[number];

export const AD_AUDIT_ACTIONS = [
	'created',
	'updated',
	'muted',
	'unmuted',
	'deactivated',
	'reactivated'
] as const;
export type AdAuditAction = (typeof AD_AUDIT_ACTIONS)[number];
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/augustin598/Projects/CRM/app && bunx tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/db/schema.ts
git commit -m "feat(ads-monitor): add adMonitorTargetAudit table"
```

---

### Task 1.3: Add `adRecommendationFeedback` table

**Files:**
- Modify: `src/lib/server/db/schema.ts` (after `adOptimizationRecommendationRelations`, ~line 4506)

- [ ] **Step 1: Add table definition + relations + types**

After the `adOptimizationRecommendationRelations` export (around line 4506), insert:

```ts
// Structured feedback signal on rejected recommendations — used by worker auto-suppress logic
export const adRecommendationFeedback = sqliteTable(
	'ad_recommendation_feedback',
	{
		id: text('id').primaryKey(),
		tenantId: text('tenant_id')
			.notNull()
			.references(() => tenant.id),
		recommendationId: text('recommendation_id')
			.notNull()
			.references(() => adOptimizationRecommendation.id, { onDelete: 'cascade' }),
		userId: text('user_id').references(() => user.id),
		// 'false_positive' | 'wrong_action' | 'bad_timing' | 'manually_handled' | 'other'
		rejectionReason: text('rejection_reason').notNull(),
		note: text('note'),
		at: timestamp('at', { withTimezone: true, mode: 'date' })
			.notNull()
			.default(sql`current_timestamp`)
	},
	(t) => ({
		recIdx: index('ad_recommendation_feedback_rec_idx').on(t.recommendationId),
		tenantAtIdx: index('ad_recommendation_feedback_tenant_at_idx').on(t.tenantId, t.at)
	})
);

export const adRecommendationFeedbackRelations = relations(adRecommendationFeedback, ({ one }) => ({
	tenant: one(tenant, {
		fields: [adRecommendationFeedback.tenantId],
		references: [tenant.id]
	}),
	recommendation: one(adOptimizationRecommendation, {
		fields: [adRecommendationFeedback.recommendationId],
		references: [adOptimizationRecommendation.id]
	}),
	user: one(user, {
		fields: [adRecommendationFeedback.userId],
		references: [user.id]
	})
}));

export type AdRecommendationFeedback = typeof adRecommendationFeedback.$inferSelect;
export type NewAdRecommendationFeedback = typeof adRecommendationFeedback.$inferInsert;

export const AD_REJECTION_REASONS = [
	'false_positive',
	'wrong_action',
	'bad_timing',
	'manually_handled',
	'other'
] as const;
export type AdRejectionReason = (typeof AD_REJECTION_REASONS)[number];
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/augustin598/Projects/CRM/app && bunx tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/db/schema.ts
git commit -m "feat(ads-monitor): add adRecommendationFeedback table"
```

---

### Task 1.4: Generate Drizzle migrations

**Files:**
- Create: `drizzle/0227_*.sql`, `drizzle/0228_*.sql`, `drizzle/0229_*.sql` (auto-generated; exact names will vary)

- [ ] **Step 1: Generate migration files**

Run:
```bash
cd /Users/augustin598/Projects/CRM/app && bun run db:gen
```

Expected: 1 to 3 new `.sql` files in `drizzle/` directory. The drizzle-kit may bundle multiple table changes into a single file — that's fine.

- [ ] **Step 2: Inspect generated SQL**

```bash
ls drizzle/0227_* drizzle/0228_* drizzle/0229_* 2>/dev/null
```

For each new file, read it and verify:
- ALTER TABLE for `ad_monitor_target` adds 7 nullable/defaulted columns (notes, external_ad_account_id, custom_cooldown_hours, suppressed_actions DEFAULT '[]', severity_override, min_conversions_threshold, version DEFAULT 1)
- CREATE TABLE for `ad_monitor_target_audit` with 2 indexes
- CREATE TABLE for `ad_recommendation_feedback` with 2 indexes

If drizzle-kit produces incorrect SQL (rare for additive changes), edit manually.

- [ ] **Step 3: Verify migration applies cleanly to a test DB**

Run on a local/test Turso/SQLite (DO NOT run on production):
```bash
cd /Users/augustin598/Projects/CRM/app && bun run db:migrate 2>&1 | tail -20
```

Expected: "Migrations applied" or equivalent success message. No errors.

- [ ] **Step 4: Commit migrations**

```bash
git add drizzle/0227_* drizzle/0228_* drizzle/0229_* drizzle/meta/
git commit -m "feat(ads-monitor): migrations for overrides, audit, feedback tables"
```

---

### Task 1.5: Write `diff-builder.ts` pure helper

**Files:**
- Create: `src/lib/server/ads-monitor/diff-builder.ts`

- [ ] **Step 1: Write failing test first**

Create `src/lib/server/ads-monitor/diff-builder.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { buildDiff, type FieldDiff } from './diff-builder';

describe('buildDiff', () => {
	test('returns empty diff when before and after are identical', () => {
		const result = buildDiff({ targetCplCents: 3000 }, { targetCplCents: 3000 });
		expect(result).toEqual({});
	});

	test('captures changed primitive field with from/to', () => {
		const result = buildDiff({ targetCplCents: 3000 }, { targetCplCents: 2500 });
		expect(result).toEqual({ targetCplCents: { from: 3000, to: 2500 } });
	});

	test('captures multiple changes', () => {
		const before = { targetCplCents: 3000, notes: null, customCooldownHours: null };
		const after = { targetCplCents: 2500, notes: 'reduced', customCooldownHours: 24 };
		expect(buildDiff(before, after)).toEqual({
			targetCplCents: { from: 3000, to: 2500 },
			notes: { from: null, to: 'reduced' },
			customCooldownHours: { from: null, to: 24 }
		});
	});

	test('ignores fields not present in after', () => {
		const result = buildDiff({ a: 1, b: 2 }, { a: 5 });
		expect(result).toEqual({ a: { from: 1, to: 5 } });
	});

	test('treats array fields with deep equality (suppressedActions)', () => {
		const result = buildDiff(
			{ suppressedActions: ['pause_ad'] },
			{ suppressedActions: ['pause_ad'] }
		);
		expect(result).toEqual({});
	});

	test('captures array changes (suppressedActions)', () => {
		const result = buildDiff(
			{ suppressedActions: ['pause_ad'] },
			{ suppressedActions: ['pause_ad', 'increase_budget'] }
		);
		expect(result).toEqual({
			suppressedActions: { from: ['pause_ad'], to: ['pause_ad', 'increase_budget'] }
		});
	});

	test('treats undefined and null as equivalent for nullable fields', () => {
		const result = buildDiff({ notes: undefined }, { notes: null });
		expect(result).toEqual({});
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/augustin598/Projects/CRM/app && bun test src/lib/server/ads-monitor/diff-builder.test.ts`
Expected: fails with "Cannot find module './diff-builder'".

- [ ] **Step 3: Implement `diff-builder.ts`**

Create `src/lib/server/ads-monitor/diff-builder.ts`:

```ts
export type FieldDiff = { from: unknown; to: unknown };
export type ChangesJson = Record<string, FieldDiff>;

function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (a == null && b == null) return true; // null and undefined treated equal
	if (a == null || b == null) return false;
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) return false;
		return a.every((v, i) => deepEqual(v, b[i]));
	}
	return false;
}

/**
 * Compute structured diff between before and after states.
 * Only fields present in `after` are evaluated. Fields with deep-equal values are omitted.
 */
export function buildDiff(
	before: Record<string, unknown>,
	after: Record<string, unknown>
): ChangesJson {
	const out: ChangesJson = {};
	for (const key of Object.keys(after)) {
		if (!deepEqual(before[key], after[key])) {
			out[key] = { from: before[key] ?? null, to: after[key] ?? null };
		}
	}
	return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/augustin598/Projects/CRM/app && bun test src/lib/server/ads-monitor/diff-builder.test.ts`
Expected: 7 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/ads-monitor/diff-builder.ts src/lib/server/ads-monitor/diff-builder.test.ts
git commit -m "feat(ads-monitor): add diff-builder helper for audit changesJson"
```

---

### Task 1.6: Write `audit-writer.ts` server-side helper

**Files:**
- Create: `src/lib/server/ads-monitor/audit-writer.ts`

- [ ] **Step 1: Implement (no test — thin wrapper around DB insert; covered by integration tests in PR2)**

Create `src/lib/server/ads-monitor/audit-writer.ts`:

```ts
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import type { ChangesJson } from './diff-builder';
import type { AdAuditAction, AdAuditActorType } from '$lib/server/db/schema';

export interface WriteAuditInput {
	tenantId: string;
	targetId: string;
	actorType: AdAuditActorType;
	actorId: string;
	action: AdAuditAction;
	changes?: ChangesJson;
	note?: string | null;
	metadata?: Record<string, unknown>;
}

/**
 * Insert one row into adMonitorTargetAudit. Skips if both `changes` is empty
 * AND `action` is 'updated' (i.e., a no-op patch). Always writes for non-update actions.
 */
export async function writeTargetAudit(input: WriteAuditInput): Promise<string | null> {
	const changes = input.changes ?? {};
	if (input.action === 'updated' && Object.keys(changes).length === 0) {
		return null; // skip no-op
	}
	const id = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
	await db.insert(table.adMonitorTargetAudit).values({
		id,
		tenantId: input.tenantId,
		targetId: input.targetId,
		actorType: input.actorType,
		actorId: input.actorId,
		action: input.action,
		changesJson: JSON.stringify(changes),
		note: input.note?.trim().slice(0, 200) ?? null,
		metadataJson: JSON.stringify(input.metadata ?? {})
	});
	return id;
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `cd /Users/augustin598/Projects/CRM/app && bunx tsc --noEmit -p tsconfig.json 2>&1 | head -10`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/ads-monitor/audit-writer.ts
git commit -m "feat(ads-monitor): add audit-writer helper"
```

---

### Task 1.7: Write `feedback-aggregate.ts` for rejection-rate computation

**Files:**
- Create: `src/lib/server/ads-monitor/feedback-aggregate.ts`
- Create: `src/lib/server/ads-monitor/feedback-aggregate.test.ts`

- [ ] **Step 1: Write failing test first**

Create `src/lib/server/ads-monitor/feedback-aggregate.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { computeRejectionRates, type RecRecord } from './feedback-aggregate';

const NOW = new Date('2026-04-30T00:00:00Z');
const recent = (daysAgo: number) =>
	new Date(NOW.getTime() - daysAgo * 86400_000);

function rec(action: string, status: string, daysAgo: number): RecRecord {
	return { action, status, decidedAt: status === 'draft' ? null : recent(daysAgo) };
}

describe('computeRejectionRates', () => {
	test('returns empty object for empty input', () => {
		expect(computeRejectionRates([], NOW)).toEqual({});
	});

	test('computes rejection rate per action over last 30 days', () => {
		const recs = [
			rec('increase_budget', 'rejected', 5),
			rec('increase_budget', 'rejected', 10),
			rec('increase_budget', 'applied', 15),
			rec('increase_budget', 'rejected', 20),
			rec('increase_budget', 'applied', 25)
		];
		const rates = computeRejectionRates(recs, NOW);
		expect(rates.increase_budget).toBeCloseTo(0.6, 2);
	});

	test('ignores draft (undecided) recommendations', () => {
		const recs = [rec('pause_ad', 'rejected', 5), rec('pause_ad', 'draft', 0)];
		const rates = computeRejectionRates(recs, NOW);
		expect(rates.pause_ad).toBe(1);
	});

	test('ignores recs older than 30 days', () => {
		const recs = [
			rec('refresh_creative', 'rejected', 5),
			rec('refresh_creative', 'applied', 40)
		];
		const rates = computeRejectionRates(recs, NOW);
		expect(rates.refresh_creative).toBe(1);
	});

	test('returns 0 when no rejections in window', () => {
		const recs = [rec('decrease_budget', 'applied', 5), rec('decrease_budget', 'applied', 10)];
		const rates = computeRejectionRates(recs, NOW);
		expect(rates.decrease_budget).toBe(0);
	});

	test('separate rates per action', () => {
		const recs = [
			rec('pause_ad', 'rejected', 5),
			rec('pause_ad', 'applied', 10),
			rec('increase_budget', 'rejected', 5),
			rec('increase_budget', 'rejected', 10)
		];
		const rates = computeRejectionRates(recs, NOW);
		expect(rates.pause_ad).toBe(0.5);
		expect(rates.increase_budget).toBe(1);
	});
});
```

- [ ] **Step 2: Run test, expect fail**

Run: `cd /Users/augustin598/Projects/CRM/app && bun test src/lib/server/ads-monitor/feedback-aggregate.test.ts`
Expected: fails with "Cannot find module".

- [ ] **Step 3: Implement helper**

Create `src/lib/server/ads-monitor/feedback-aggregate.ts`:

```ts
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, gte } from 'drizzle-orm';

export interface RecRecord {
	action: string;
	status: string;
	decidedAt: Date | null;
}

const WINDOW_DAYS = 30;
const MS_PER_DAY = 86400_000;

/**
 * Compute rejection rate per action over last 30 days.
 * Numerator: rejected. Denominator: rejected + applied (decided recs only).
 */
export function computeRejectionRates(
	recs: RecRecord[],
	now: Date = new Date()
): Record<string, number> {
	const cutoff = now.getTime() - WINDOW_DAYS * MS_PER_DAY;
	const inWindow = recs.filter(
		(r) =>
			r.decidedAt !== null &&
			r.decidedAt.getTime() >= cutoff &&
			(r.status === 'rejected' || r.status === 'applied')
	);
	const buckets = new Map<string, { rejected: number; total: number }>();
	for (const r of inWindow) {
		const b = buckets.get(r.action) ?? { rejected: 0, total: 0 };
		b.total += 1;
		if (r.status === 'rejected') b.rejected += 1;
		buckets.set(r.action, b);
	}
	const out: Record<string, number> = {};
	for (const [action, b] of buckets) {
		out[action] = b.total > 0 ? b.rejected / b.total : 0;
	}
	return out;
}

/**
 * Fetch decided recs for a (tenant, clientId) over last 30 days, ready for computeRejectionRates.
 */
export async function fetchRecsForFeedback(
	tenantId: string,
	clientId: string
): Promise<RecRecord[]> {
	const cutoff = new Date(Date.now() - WINDOW_DAYS * MS_PER_DAY);
	const rows = await db
		.select({
			action: table.adOptimizationRecommendation.action,
			status: table.adOptimizationRecommendation.status,
			decidedAt: table.adOptimizationRecommendation.decidedAt
		})
		.from(table.adOptimizationRecommendation)
		.where(
			and(
				eq(table.adOptimizationRecommendation.tenantId, tenantId),
				eq(table.adOptimizationRecommendation.clientId, clientId),
				gte(table.adOptimizationRecommendation.createdAt, cutoff)
			)
		);
	return rows;
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `cd /Users/augustin598/Projects/CRM/app && bun test src/lib/server/ads-monitor/feedback-aggregate.test.ts`
Expected: 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/ads-monitor/feedback-aggregate.ts src/lib/server/ads-monitor/feedback-aggregate.test.ts
git commit -m "feat(ads-monitor): add feedback-aggregate helper for rejection rates"
```

---

### Task 1.8: PR1 final verification + push

- [ ] **Step 1: Run full type check**

```bash
cd /Users/augustin598/Projects/CRM/app && bunx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "(error|Error)" | head -20
```
Expected: no errors.

- [ ] **Step 2: Run all new unit tests**

```bash
cd /Users/augustin598/Projects/CRM/app && bun test src/lib/server/ads-monitor/
```
Expected: all tests pass (13 tests across 2 files).

- [ ] **Step 3: Push branch + open PR (manual)**

```bash
git log --oneline main..HEAD
```
Expected: 6 commits (1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7 — task 1.4 may be 1 commit; 7 max).

User pushes branch and opens PR1 manually.

---

# PR 2 — API + Worker

**Goal:** Land server endpoints (internal + external), worker integration with overrides, optimistic locking, auto-suppress with TTL. PR1 must be merged + deployed first.

**Branch:** `feat/ads-monitoring-redesign-api-worker`

---

### Task 2.1: Extend POST /api/ads-monitor/targets to write `created` audit row

**Files:**
- Modify: `src/routes/[tenant]/api/ads-monitor/targets/+server.ts`

- [ ] **Step 1: Lookup primary ad account + insert audit row**

Replace the existing POST handler body. After the `db.insert(table.adMonitorTarget).values(...)` call, before the `return json(...)`, add:

```ts
// Lookup primary ad account for client (best-effort — null if none)
const [primaryAccount] = await db
	.select({
		metaAdAccountId: table.metaAdsAccount.metaAdAccountId,
		accountName: table.metaAdsAccount.accountName
	})
	.from(table.metaAdsAccount)
	.where(
		and(
			eq(table.metaAdsAccount.clientId, clientId),
			eq(table.metaAdsAccount.tenantId, locals.tenant.id),
			eq(table.metaAdsAccount.isPrimary, true)
		)
	)
	.limit(1);
```

Then before `db.insert(...)`, add resolution into the values:
```ts
const externalAdAccountId =
	(typeof body.externalAdAccountId === 'string' ? body.externalAdAccountId : null) ??
	primaryAccount?.metaAdAccountId ??
	null;
```

In the insert `.values({...})`, add `externalAdAccountId` and:
```ts
notes: typeof body.notes === 'string' ? body.notes.trim().slice(0, 500) : null,
```

After insert succeeds, before `logInfo`, add:
```ts
// Audit: 'created' row capturing initial values
await writeTargetAudit({
	tenantId: locals.tenant.id,
	targetId: id,
	actorType: 'user',
	actorId: locals.user.id,
	action: 'created',
	changes: {
		clientId: { from: null, to: clientId },
		externalCampaignId: { from: null, to: externalCampaignId },
		externalAdsetId: { from: null, to: externalAdsetId },
		objective: { from: null, to: objective },
		targetCplCents: { from: null, to: typeof body.targetCplCents === 'number' ? body.targetCplCents : null },
		targetCpaCents: { from: null, to: typeof body.targetCpaCents === 'number' ? body.targetCpaCents : null },
		targetRoas: { from: null, to: typeof body.targetRoas === 'number' ? body.targetRoas : null },
		targetCtr: { from: null, to: typeof body.targetCtr === 'number' ? body.targetCtr : null },
		targetDailyBudgetCents: { from: null, to: typeof body.targetDailyBudgetCents === 'number' ? body.targetDailyBudgetCents : null },
		deviationThresholdPct: { from: null, to: deviationThresholdPct }
	}
});
```

Add the import at top of file:
```ts
import { writeTargetAudit } from '$lib/server/ads-monitor/audit-writer';
```

- [ ] **Step 2: Manual smoke (DB seeded with one client)**

Open DevTools → Network on `/ots/reports/facebook-ads/monitoring`, click "Adaugă target", fill the form, submit. Verify in DB:
```sql
SELECT actor_type, action, changes_json FROM ad_monitor_target_audit ORDER BY at DESC LIMIT 1;
```
Expected: one row, `action='created'`, `changes_json` contains `objective` and `targetCplCents` if provided.

- [ ] **Step 3: Commit**

```bash
git add src/routes/[tenant]/api/ads-monitor/targets/+server.ts
git commit -m "feat(ads-monitor): POST target writes created audit + ad-account lookup"
```

---

### Task 2.2: Extend PATCH /api/ads-monitor/targets/[id] with optimistic lock + audit + new fields

**Files:**
- Modify: `src/routes/[tenant]/api/ads-monitor/targets/[id]/+server.ts`

- [ ] **Step 1: Add validation + diff + version check + audit**

Replace the entire PATCH handler with:

```ts
import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { AD_RECOMMENDATION_ACTIONS } from '$lib/server/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { logInfo, logError, serializeError } from '$lib/server/logger';
import { buildDiff } from '$lib/server/ads-monitor/diff-builder';
import { writeTargetAudit } from '$lib/server/ads-monitor/audit-writer';
import type { RequestHandler } from './$types';

const SEVERITY_VALUES = new Set(['urgent', 'high', 'warning', 'opportunity']);

function normalizeSuppressedActions(input: unknown): string[] | undefined {
	if (input === undefined) return undefined;
	if (!Array.isArray(input)) {
		throw error(400, 'suppressedActions trebuie să fie array');
	}
	const valid = new Set<string>(AD_RECOMMENDATION_ACTIONS);
	const out: string[] = [];
	for (const a of input) {
		if (typeof a !== 'string' || !valid.has(a)) {
			throw error(400, `suppressedActions: acțiune invalidă "${String(a)}"`);
		}
		if (!out.includes(a)) out.push(a);
	}
	out.sort();
	return out;
}

export const PATCH: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user || !locals.tenant) throw error(401, 'Unauthorized');
	if (!params.id) throw error(400, 'Missing id');

	const [target] = await db
		.select()
		.from(table.adMonitorTarget)
		.where(
			and(eq(table.adMonitorTarget.id, params.id), eq(table.adMonitorTarget.tenantId, locals.tenant.id))
		)
		.limit(1);
	if (!target) throw error(404, 'Target inexistent');

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		throw error(400, 'JSON invalid');
	}

	// Mute/unmute remains a special action (no version check needed — informational)
	if (body.action === 'mute' || body.action === 'unmute') {
		const isMute = body.action === 'mute';
		const days = typeof body.days === 'number' ? body.days : 7;
		const mutedUntil = isMute ? new Date(Date.now() + days * 86400_000) : null;
		await db
			.update(table.adMonitorTarget)
			.set({ isMuted: isMute, mutedUntil, updatedAt: new Date() })
			.where(
				and(eq(table.adMonitorTarget.id, params.id), eq(table.adMonitorTarget.tenantId, locals.tenant.id))
			);
		await writeTargetAudit({
			tenantId: locals.tenant.id,
			targetId: params.id,
			actorType: 'user',
			actorId: locals.user.id,
			action: isMute ? 'muted' : 'unmuted',
			changes: { isMuted: { from: target.isMuted, to: isMute } }
		});
		return json({ ok: true });
	}

	// Validate expectedVersion
	if (typeof body.expectedVersion !== 'number') {
		throw error(400, 'expectedVersion lipsește');
	}
	if (body.expectedVersion !== target.version) {
		return json(
			{ ok: false, error: 'version_conflict', currentVersion: target.version },
			{ status: 409 }
		);
	}

	// Build candidate update with strict whitelisting
	const updates: Record<string, unknown> = {};

	const numericNullable = (key: string, min?: number, max?: number) => {
		if (!(key in body)) return;
		const v = body[key];
		if (v === null) {
			updates[key] = null;
			return;
		}
		if (typeof v !== 'number' || !isFinite(v)) {
			throw error(400, `${key} invalid`);
		}
		if (min !== undefined && v < min) throw error(400, `${key} < ${min}`);
		if (max !== undefined && v > max) throw error(400, `${key} > ${max}`);
		updates[key] = v;
	};

	numericNullable('targetCplCents', 0);
	numericNullable('targetCpaCents', 0);
	numericNullable('targetRoas', 0);
	numericNullable('targetCtr', 0, 1);
	numericNullable('targetDailyBudgetCents', 0);
	numericNullable('deviationThresholdPct', 5, 100);
	numericNullable('customCooldownHours', 1, 720);
	numericNullable('minConversionsThreshold', 0, 100);

	if (typeof body.isActive === 'boolean') updates.isActive = body.isActive;
	if (typeof body.notifyTelegram === 'boolean') updates.notifyTelegram = body.notifyTelegram;
	if (typeof body.notifyEmail === 'boolean') updates.notifyEmail = body.notifyEmail;
	if (typeof body.notifyInApp === 'boolean') updates.notifyInApp = body.notifyInApp;

	if ('notes' in body) {
		updates.notes =
			typeof body.notes === 'string' ? body.notes.trim().slice(0, 500) : null;
	}

	if ('severityOverride' in body) {
		const v = body.severityOverride;
		if (v === null) updates.severityOverride = null;
		else if (typeof v === 'string' && SEVERITY_VALUES.has(v)) updates.severityOverride = v;
		else throw error(400, 'severityOverride invalid');
	}

	const normSuppressed = normalizeSuppressedActions(body.suppressedActions);
	if (normSuppressed !== undefined) {
		updates.suppressedActions = JSON.stringify(normSuppressed);
	}

	// Compute diff (skip if nothing meaningful changed)
	const beforeFlat: Record<string, unknown> = {
		...target,
		suppressedActions: JSON.parse(target.suppressedActions ?? '[]')
	};
	const afterFlat: Record<string, unknown> = { ...updates };
	if (normSuppressed !== undefined) afterFlat.suppressedActions = normSuppressed;
	delete afterFlat.suppressedActions; // re-add as parsed array
	if (normSuppressed !== undefined) afterFlat.suppressedActions = normSuppressed;

	const changes = buildDiff(beforeFlat, afterFlat);
	if (Object.keys(changes).length === 0) {
		return json({ ok: true, changed: false, version: target.version });
	}

	// Apply update + bump version atomically (single SQL statement guards against races)
	updates.updatedAt = new Date();
	const updated = await db
		.update(table.adMonitorTarget)
		.set({ ...updates, version: sql`${table.adMonitorTarget.version} + 1` })
		.where(
			and(
				eq(table.adMonitorTarget.id, params.id),
				eq(table.adMonitorTarget.tenantId, locals.tenant.id),
				eq(table.adMonitorTarget.version, target.version)
			)
		)
		.returning({ version: table.adMonitorTarget.version });

	if (updated.length === 0) {
		// Race: someone bumped version between SELECT and UPDATE
		const [fresh] = await db
			.select({ version: table.adMonitorTarget.version })
			.from(table.adMonitorTarget)
			.where(eq(table.adMonitorTarget.id, params.id))
			.limit(1);
		return json(
			{ ok: false, error: 'version_conflict', currentVersion: fresh?.version ?? null },
			{ status: 409 }
		);
	}

	const auditNote =
		typeof body.auditNote === 'string' ? body.auditNote.trim().slice(0, 200) : null;

	await writeTargetAudit({
		tenantId: locals.tenant.id,
		targetId: params.id,
		actorType: 'user',
		actorId: locals.user.id,
		action: 'updated',
		changes,
		note: auditNote
	});

	logInfo('ads-monitor', `Target updated: ${params.id}`, {
		tenantId: locals.tenant.id,
		userId: locals.user.id,
		metadata: { targetId: params.id, fields: Object.keys(changes) }
	});

	return json({ ok: true, changed: true, version: updated[0].version });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user || !locals.tenant) throw error(401, 'Unauthorized');
	if (!params.id) throw error(400, 'Missing id');

	try {
		await db
			.delete(table.adMonitorTarget)
			.where(
				and(eq(table.adMonitorTarget.id, params.id), eq(table.adMonitorTarget.tenantId, locals.tenant.id))
			);
		return json({ ok: true });
	} catch (e) {
		logError('ads-monitor', `Failed to delete target ${params.id}: ${serializeError(e).message}`, {
			tenantId: locals.tenant.id
		});
		throw error(500, 'Eroare la ștergerea target-ului');
	}
};
```

- [ ] **Step 2: Type check**

Run: `cd /Users/augustin598/Projects/CRM/app && bunx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "ads-monitor/targets" | head`
Expected: no errors.

- [ ] **Step 3: Manual smoke**

Open monitoring page, edit a target via API directly (use DevTools or curl) with a stale `expectedVersion`. Verify 409 returned.

- [ ] **Step 4: Commit**

```bash
git add src/routes/[tenant]/api/ads-monitor/targets/[id]/+server.ts
git commit -m "feat(ads-monitor): PATCH target with optimistic lock + audit + new fields"
```

---

### Task 2.3: Add GET /api/ads-monitor/targets/[id] (single target with overrides)

**Files:**
- Modify: `src/routes/[tenant]/api/ads-monitor/targets/[id]/+server.ts` (add GET)

- [ ] **Step 1: Add GET handler exposing the target with parsed overrides**

At the top of the file, after PATCH/DELETE export, add:

```ts
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user || !locals.tenant) throw error(401, 'Unauthorized');
	if (!params.id) throw error(400, 'Missing id');

	const [row] = await db
		.select({
			target: table.adMonitorTarget,
			clientName: table.client.name,
			accountName: table.metaAdsAccount.accountName,
			accountId: table.metaAdsAccount.metaAdAccountId
		})
		.from(table.adMonitorTarget)
		.innerJoin(table.client, eq(table.client.id, table.adMonitorTarget.clientId))
		.leftJoin(
			table.metaAdsAccount,
			and(
				eq(table.metaAdsAccount.clientId, table.adMonitorTarget.clientId),
				eq(table.metaAdsAccount.tenantId, locals.tenant.id),
				eq(table.metaAdsAccount.isPrimary, true)
			)
		)
		.where(
			and(
				eq(table.adMonitorTarget.id, params.id),
				eq(table.adMonitorTarget.tenantId, locals.tenant.id)
			)
		)
		.limit(1);

	if (!row) throw error(404, 'Target inexistent');

	let suppressed: string[] = [];
	try {
		const parsed = JSON.parse(row.target.suppressedActions ?? '[]');
		if (Array.isArray(parsed)) suppressed = parsed.filter((x): x is string => typeof x === 'string');
	} catch {
		suppressed = [];
	}

	return json({
		target: {
			...row.target,
			suppressedActions: suppressed
		},
		clientName: row.clientName,
		accountName: row.accountName,
		accountId: row.target.externalAdAccountId ?? row.accountId ?? null
	});
};
```

- [ ] **Step 2: Type check**

Run: `cd /Users/augustin598/Projects/CRM/app && bunx tsc --noEmit -p tsconfig.json 2>&1 | grep "targets/\[id\]"`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/routes/[tenant]/api/ads-monitor/targets/[id]/+server.ts
git commit -m "feat(ads-monitor): GET single target with parsed overrides + ad-account"
```

---

### Task 2.4: Add GET /api/ads-monitor/targets/[id]/audit endpoint

**Files:**
- Create: `src/routes/[tenant]/api/ads-monitor/targets/[id]/audit/+server.ts`

- [ ] **Step 1: Implement listing endpoint**

```ts
import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, desc } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals, url }) => {
	if (!locals.user || !locals.tenant) throw error(401, 'Unauthorized');
	if (!params.id) throw error(400, 'Missing id');

	// Confirm target belongs to tenant before exposing audit
	const [exists] = await db
		.select({ id: table.adMonitorTarget.id })
		.from(table.adMonitorTarget)
		.where(
			and(
				eq(table.adMonitorTarget.id, params.id),
				eq(table.adMonitorTarget.tenantId, locals.tenant.id)
			)
		)
		.limit(1);
	if (!exists) throw error(404, 'Target inexistent');

	const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 100);
	const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0);

	const rows = await db
		.select({
			id: table.adMonitorTargetAudit.id,
			actorType: table.adMonitorTargetAudit.actorType,
			actorId: table.adMonitorTargetAudit.actorId,
			action: table.adMonitorTargetAudit.action,
			changesJson: table.adMonitorTargetAudit.changesJson,
			note: table.adMonitorTargetAudit.note,
			metadataJson: table.adMonitorTargetAudit.metadataJson,
			at: table.adMonitorTargetAudit.at,
			actorName: table.user.email
		})
		.from(table.adMonitorTargetAudit)
		.leftJoin(
			table.user,
			and(
				eq(table.user.id, table.adMonitorTargetAudit.actorId),
				eq(table.adMonitorTargetAudit.actorType, 'user')
			)
		)
		.where(eq(table.adMonitorTargetAudit.targetId, params.id))
		.orderBy(desc(table.adMonitorTargetAudit.at))
		.limit(limit)
		.offset(offset);

	return json({ entries: rows, limit, offset });
};
```

- [ ] **Step 2: Type check**

Run: `cd /Users/augustin598/Projects/CRM/app && bunx tsc --noEmit -p tsconfig.json 2>&1 | grep "audit/+server"`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/routes/[tenant]/api/ads-monitor/targets/[id]/audit/
git commit -m "feat(ads-monitor): GET target audit history endpoint"
```

---

### Task 2.5: Add GET /api/ads-monitor/summary (KPI strip)

**Files:**
- Create: `src/routes/[tenant]/api/ads-monitor/summary/+server.ts`

- [ ] **Step 1: Implement summary endpoint**

```ts
import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, gte, sql } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user || !locals.tenant) throw error(401, 'Unauthorized');

	const tenantId = locals.tenant.id;

	const [activeRow] = await db
		.select({ count: sql<number>`count(*)` })
		.from(table.adMonitorTarget)
		.where(and(eq(table.adMonitorTarget.tenantId, tenantId), eq(table.adMonitorTarget.isActive, true)));

	const [pendingRow] = await db
		.select({ count: sql<number>`count(*)` })
		.from(table.adOptimizationRecommendation)
		.where(
			and(
				eq(table.adOptimizationRecommendation.tenantId, tenantId),
				eq(table.adOptimizationRecommendation.status, 'draft')
			)
		);

	const cutoff = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
	const [spendRow] = await db
		.select({
			spend7dCents: sql<number>`coalesce(sum(${table.adMetricSnapshot.spendCents}), 0)`
		})
		.from(table.adMetricSnapshot)
		.where(
			and(
				eq(table.adMetricSnapshot.tenantId, tenantId),
				gte(table.adMetricSnapshot.date, cutoff)
			)
		);

	// Avg CPL last 30d (per active target with CPL target set)
	const cutoff30 = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
	const cplRows = await db
		.select({
			cplCents: table.adMetricSnapshot.cplCents,
			targetCplCents: table.adMonitorTarget.targetCplCents
		})
		.from(table.adMetricSnapshot)
		.innerJoin(
			table.adMonitorTarget,
			and(
				eq(table.adMonitorTarget.tenantId, table.adMetricSnapshot.tenantId),
				eq(table.adMonitorTarget.externalCampaignId, table.adMetricSnapshot.externalCampaignId)
			)
		)
		.where(
			and(
				eq(table.adMonitorTarget.tenantId, tenantId),
				eq(table.adMonitorTarget.isActive, true),
				gte(table.adMetricSnapshot.date, cutoff30)
			)
		);

	let cplSum = 0,
		cplCount = 0,
		targetSum = 0,
		targetCount = 0;
	for (const r of cplRows) {
		if (typeof r.cplCents === 'number') {
			cplSum += r.cplCents;
			cplCount += 1;
		}
		if (typeof r.targetCplCents === 'number') {
			targetSum += r.targetCplCents;
			targetCount += 1;
		}
	}

	return json({
		activeTargets: Number(activeRow?.count ?? 0),
		pendingRecs: Number(pendingRow?.count ?? 0),
		spend7dCents: Number(spendRow?.spend7dCents ?? 0),
		avgCpl30dCents: cplCount > 0 ? Math.round(cplSum / cplCount) : null,
		avgTargetCplCents: targetCount > 0 ? Math.round(targetSum / targetCount) : null
	});
};
```

- [ ] **Step 2: Smoke test**

```bash
curl -H "Cookie: <auth>" https://localhost:5173/<tenantSlug>/api/ads-monitor/summary
```
Expected: JSON with 5 numeric fields.

- [ ] **Step 3: Commit**

```bash
git add src/routes/[tenant]/api/ads-monitor/summary/
git commit -m "feat(ads-monitor): GET summary endpoint for KPI strip"
```

---

### Task 2.6: Extend reject endpoint to write feedback

**Files:**
- Modify: `src/routes/[tenant]/api/ads-monitor/recommendations/[id]/reject/+server.ts`

- [ ] **Step 1: Read existing handler, add feedback row write**

Read the existing file. After the existing `db.update(...).set({status: 'rejected', ...})` call succeeds, before returning, add:

```ts
// Optional structured feedback for worker tuning
const reason = typeof body.reason === 'string' ? body.reason : null;
const VALID_REASONS = new Set(['false_positive','wrong_action','bad_timing','manually_handled','other']);
if (reason && VALID_REASONS.has(reason)) {
	const fid = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
	await db.insert(table.adRecommendationFeedback).values({
		id: fid,
		tenantId: locals.tenant.id,
		recommendationId: params.id,
		userId: locals.user.id,
		rejectionReason: reason,
		note: typeof body.note === 'string' ? body.note.trim().slice(0, 200) : null
	});
}
```

Add imports at top:
```ts
import { encodeBase32LowerCase } from '@oslojs/encoding';
```

Update the handler signature so `body` is parsed first (if not already):
```ts
let body: Record<string, unknown> = {};
try {
	body = (await request.json()) as Record<string, unknown>;
} catch { /* empty body OK for backwards compat */ }
```

- [ ] **Step 2: Type check**

Run: `cd /Users/augustin598/Projects/CRM/app && bunx tsc --noEmit -p tsconfig.json 2>&1 | grep "reject/+server"`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/routes/[tenant]/api/ads-monitor/recommendations/[id]/reject/+server.ts
git commit -m "feat(ads-monitor): reject endpoint records structured feedback"
```

---

### Task 2.7: Extend external GET target with `?withOverrides=true`

**Files:**
- Modify: `src/routes/api/external/ads-monitor/targets/[id]/+server.ts`

- [ ] **Step 1: Read existing handler, add overrides + feedback aggregate when query flag set**

Open the file and locate the existing GET handler. At the end (before the final `return json(...)`), add:

```ts
const withOverrides = url.searchParams.get('withOverrides') === 'true';
if (withOverrides) {
	let suppressed: string[] = [];
	try {
		const parsed = JSON.parse((row as any).suppressedActions ?? '[]');
		if (Array.isArray(parsed)) suppressed = parsed.filter((x): x is string => typeof x === 'string');
	} catch { suppressed = []; }

	const recs = await fetchRecsForFeedback(tenantId, (row as any).clientId);
	const rates = computeRejectionRates(recs);

	return json({
		...row,
		overrides: {
			customCooldownHours: (row as any).customCooldownHours ?? null,
			suppressedActions: suppressed,
			severityOverride: (row as any).severityOverride ?? null,
			minConversionsThreshold: (row as any).minConversionsThreshold ?? null,
			version: (row as any).version
		},
		feedback: { rejectionRateLast30d: rates }
	});
}
```

Add imports:
```ts
import {
	fetchRecsForFeedback,
	computeRejectionRates
} from '$lib/server/ads-monitor/feedback-aggregate';
```

Note: rename existing local variable `tenantId` if it already exists; otherwise add `const tenantId = ...` from the auth context as appropriate.

- [ ] **Step 2: Smoke**

```bash
curl -H "X-API-Key: <test_key>" "https://crm.example/api/external/ads-monitor/targets/<id>?withOverrides=true"
```
Expected: response includes `overrides` and `feedback.rejectionRateLast30d`.

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/external/ads-monitor/targets/[id]/+server.ts
git commit -m "feat(ads-monitor): external GET target with overrides + feedback"
```

---

### Task 2.8: Add external POST /api/external/ads-monitor/targets/[id]/auto-suppress

**Files:**
- Create: `src/routes/api/external/ads-monitor/targets/[id]/auto-suppress/+server.ts`

- [ ] **Step 1: Implement endpoint with optimistic lock + TTL metadata**

```ts
import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { AD_RECOMMENDATION_ACTIONS } from '$lib/server/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { writeTargetAudit } from '$lib/server/ads-monitor/audit-writer';
import { logInfo } from '$lib/server/logger';
import type { RequestHandler } from './$types';

const TTL_DAYS = 30;
const VALID_ACTIONS = new Set(AD_RECOMMENDATION_ACTIONS);

export const POST: RequestHandler = async ({ params, locals, request }) => {
	const apiKey = locals.apiKey;
	if (!apiKey) throw error(401, 'Unauthorized');
	if (!apiKey.scopes.includes('ads_monitor:write')) {
		throw error(403, 'Lipsește scope ads_monitor:write');
	}
	if (!params.id) throw error(400, 'Missing id');

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		throw error(400, 'JSON invalid');
	}

	const action = typeof body.action === 'string' ? body.action : null;
	const expectedVersion = typeof body.expectedVersion === 'number' ? body.expectedVersion : null;
	const reason = typeof body.reason === 'string' ? body.reason.slice(0, 200) : null;

	if (!action || !VALID_ACTIONS.has(action)) throw error(400, 'action invalid');
	if (expectedVersion === null) throw error(400, 'expectedVersion lipsește');

	const [target] = await db
		.select()
		.from(table.adMonitorTarget)
		.where(
			and(eq(table.adMonitorTarget.id, params.id), eq(table.adMonitorTarget.tenantId, apiKey.tenantId))
		)
		.limit(1);
	if (!target) throw error(404, 'Target inexistent');

	if (target.version !== expectedVersion) {
		return json(
			{ ok: false, error: 'version_conflict', currentVersion: target.version },
			{ status: 409 }
		);
	}

	let current: string[] = [];
	try {
		const parsed = JSON.parse(target.suppressedActions ?? '[]');
		if (Array.isArray(parsed)) current = parsed.filter((x): x is string => typeof x === 'string');
	} catch { current = []; }

	if (current.includes(action)) {
		return json({ ok: true, alreadySuppressed: true, version: target.version });
	}

	const next = [...current, action].sort();
	const updated = await db
		.update(table.adMonitorTarget)
		.set({
			suppressedActions: JSON.stringify(next),
			updatedAt: new Date(),
			version: sql`${table.adMonitorTarget.version} + 1`
		})
		.where(
			and(
				eq(table.adMonitorTarget.id, params.id),
				eq(table.adMonitorTarget.tenantId, apiKey.tenantId),
				eq(table.adMonitorTarget.version, target.version)
			)
		)
		.returning({ version: table.adMonitorTarget.version });

	if (updated.length === 0) {
		const [fresh] = await db
			.select({ version: table.adMonitorTarget.version })
			.from(table.adMonitorTarget)
			.where(eq(table.adMonitorTarget.id, params.id))
			.limit(1);
		return json(
			{ ok: false, error: 'version_conflict', currentVersion: fresh?.version ?? null },
			{ status: 409 }
		);
	}

	const expiresAt = new Date(Date.now() + TTL_DAYS * 86400_000);
	await writeTargetAudit({
		tenantId: apiKey.tenantId,
		targetId: params.id,
		actorType: 'worker',
		actorId: 'ads_optimizer',
		action: 'updated',
		changes: { suppressedActions: { from: current, to: next } },
		note: `Auto-suppress: ${reason ?? 'rate threshold exceeded'} — expiră în ${TTL_DAYS} zile`,
		metadata: { expiresAt: expiresAt.toISOString(), suppressedAction: action }
	});

	logInfo('ads-monitor', `Auto-suppress applied: target=${params.id} action=${action}`, {
		tenantId: apiKey.tenantId,
		metadata: { reason, expiresAt: expiresAt.toISOString() }
	});

	return json({ ok: true, version: updated[0].version, expiresAt: expiresAt.toISOString() });
};
```

- [ ] **Step 2: Type check**

Run: `cd /Users/augustin598/Projects/CRM/app && bunx tsc --noEmit -p tsconfig.json 2>&1 | grep "auto-suppress"`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/external/ads-monitor/targets/[id]/auto-suppress/
git commit -m "feat(ads-monitor): external auto-suppress endpoint with version + TTL"
```

---

### Task 2.9: Add lazy auto-unsuppress in target GET endpoints

**Files:**
- Modify: `src/lib/server/ads-monitor/audit-writer.ts` (add helper)
- Modify: `src/routes/[tenant]/api/ads-monitor/targets/[id]/+server.ts` (call helper in GET)
- Modify: `src/routes/api/external/ads-monitor/targets/[id]/+server.ts` (call helper in GET)

- [ ] **Step 1: Add `evaluateAutoUnsuppress` helper**

Append to `src/lib/server/ads-monitor/audit-writer.ts`:

```ts
import { db as _db } from '$lib/server/db';
import * as t from '$lib/server/db/schema';
import { and as _and, eq as _eq, desc as _desc, sql as _sql } from 'drizzle-orm';

/**
 * Lazily auto-unsuppresses actions whose TTL has expired.
 * Called on GET target endpoints. Idempotent. No-op if nothing expired.
 * Returns the cleaned suppressedActions array (or original if no change).
 */
export async function evaluateAutoUnsuppress(
	tenantId: string,
	targetId: string,
	currentSuppressed: string[],
	currentVersion: number
): Promise<{ suppressedActions: string[]; version: number; changed: boolean }> {
	if (currentSuppressed.length === 0) {
		return { suppressedActions: currentSuppressed, version: currentVersion, changed: false };
	}
	// Find the auto-suppress audit row per action with metadata.expiresAt
	const auditRows = await _db
		.select({
			metadataJson: t.adMonitorTargetAudit.metadataJson,
			at: t.adMonitorTargetAudit.at
		})
		.from(t.adMonitorTargetAudit)
		.where(
			_and(
				_eq(t.adMonitorTargetAudit.targetId, targetId),
				_eq(t.adMonitorTargetAudit.actorType, 'worker')
			)
		)
		.orderBy(_desc(t.adMonitorTargetAudit.at));

	const expiredActions = new Set<string>();
	const now = Date.now();
	const seen = new Set<string>();
	for (const r of auditRows) {
		try {
			const meta = JSON.parse(r.metadataJson ?? '{}');
			const action = typeof meta.suppressedAction === 'string' ? meta.suppressedAction : null;
			const expiresIso = typeof meta.expiresAt === 'string' ? meta.expiresAt : null;
			if (!action || seen.has(action)) continue; // pick latest per action
			seen.add(action);
			if (expiresIso) {
				const exp = new Date(expiresIso).getTime();
				if (isFinite(exp) && now >= exp && currentSuppressed.includes(action)) {
					expiredActions.add(action);
				}
			}
		} catch {
			/* ignore */
		}
	}
	if (expiredActions.size === 0) {
		return { suppressedActions: currentSuppressed, version: currentVersion, changed: false };
	}
	const next = currentSuppressed.filter((a) => !expiredActions.has(a)).sort();
	const updated = await _db
		.update(t.adMonitorTarget)
		.set({
			suppressedActions: JSON.stringify(next),
			updatedAt: new Date(),
			version: _sql`${t.adMonitorTarget.version} + 1`
		})
		.where(
			_and(
				_eq(t.adMonitorTarget.id, targetId),
				_eq(t.adMonitorTarget.tenantId, tenantId),
				_eq(t.adMonitorTarget.version, currentVersion)
			)
		)
		.returning({ version: t.adMonitorTarget.version });
	if (updated.length === 0) {
		// Race lost — caller will see fresh state on retry; safe to return current
		return { suppressedActions: currentSuppressed, version: currentVersion, changed: false };
	}
	for (const action of expiredActions) {
		await writeTargetAudit({
			tenantId,
			targetId,
			actorType: 'system',
			actorId: 'auto-unsuppress',
			action: 'updated',
			changes: { suppressedActions: { from: currentSuppressed, to: next } },
			note: `Auto-unsuppress: TTL expirat pentru ${action}`
		});
	}
	return { suppressedActions: next, version: updated[0].version, changed: true };
}
```

- [ ] **Step 2: Wire helper into both GET endpoints**

In `src/routes/[tenant]/api/ads-monitor/targets/[id]/+server.ts` GET handler, after parsing `suppressed` and before the final `return json(...)`, call:

```ts
const cleaned = await evaluateAutoUnsuppress(
	locals.tenant.id,
	row.target.id,
	suppressed,
	row.target.version
);
suppressed = cleaned.suppressedActions;
const effectiveVersion = cleaned.version;
```

Then in the response object, replace `version: row.target.version` (or equivalent) with `version: effectiveVersion`. Add import.

Repeat the same wiring in `src/routes/api/external/ads-monitor/targets/[id]/+server.ts` (in the `withOverrides=true` branch).

- [ ] **Step 3: Type check**

Run: `cd /Users/augustin598/Projects/CRM/app && bunx tsc --noEmit -p tsconfig.json 2>&1 | grep "ads-monitor"`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/server/ads-monitor/audit-writer.ts \
  src/routes/[tenant]/api/ads-monitor/targets/[id]/+server.ts \
  src/routes/api/external/ads-monitor/targets/[id]/+server.ts
git commit -m "feat(ads-monitor): lazy auto-unsuppress on TTL expiry in GET endpoints"
```

---

### Task 2.10: PersonalOPS — extend `Target` and `DecideInput` types

**Files:**
- Modify: `/Users/augustin598/Projects/PersonalOPS/src/services/workers/ads-optimizer/types.ts`

- [ ] **Step 1: Add override fields**

Open the file and locate the `Target` interface. Add:

```ts
	// Worker overrides — null = use default
	customCooldownHours?: number | null;
	suppressedActions?: string[];
	severityOverride?: 'urgent' | 'high' | 'warning' | 'opportunity' | null;
	minConversionsThreshold?: number | null;
	version?: number;
```

In `DecideInput` (in `decision-engine.ts`, but if defined in types.ts, here), add:

```ts
	recentRejectionRates?: Partial<Record<AdAction, number>>;
```

- [ ] **Step 2: Type check (PersonalOPS)**

Run: `cd /Users/augustin598/Projects/PersonalOPS && bunx tsc --noEmit -p tsconfig.json 2>&1 | grep "ads-optimizer" | head`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/augustin598/Projects/PersonalOPS
git add src/services/workers/ads-optimizer/types.ts
git commit -m "feat(ads): extend Target + DecideInput with override fields"
```

---

### Task 2.11: PersonalOPS — extend `decision-engine.ts` to honor overrides

**Files:**
- Modify: `/Users/augustin598/Projects/PersonalOPS/src/services/workers/ads-optimizer/decision-engine.ts`

- [ ] **Step 1: Replace `COOLDOWN_MS` constant usage and add override checks**

Locate `const COOLDOWN_MS = 72 * 3600_000;` (line ~36). Keep it as the default. Inside `decideAction`, **at the very top of the function** (before the `if (s.maturity === "learning")` check), add:

```ts
	// Override: cooldown
	const cooldownMs = (target.customCooldownHours ?? 72) * 3600_000;
	// Override: min conversions threshold
	const minConv = target.minConversionsThreshold ?? 5;
	// Override: suppressed actions set
	const suppressed = new Set(target.suppressedActions ?? []);
	// Auto-suppress signal from feedback aggregate
	const rates = input.recentRejectionRates ?? {};
```

Replace `Date.now() - lastAppliedAt.getTime() < COOLDOWN_MS` with `Date.now() - lastAppliedAt.getTime() < cooldownMs`.

Replace `if (s.conversions < 5)` with `if (s.conversions < minConv)`.

For each `return { skip: false, action: ... }` in the function, **wrap the return** with a helper:

```ts
function gateAction(
	action: AdAction,
	severity: 'urgent' | 'high' | 'warning' | 'opportunity',
	suggestedPayload: Record<string, unknown>,
	reason: string,
	suppressed: Set<string>,
	rates: Partial<Record<string, number>>,
	severityOverride: 'urgent' | 'high' | 'warning' | 'opportunity' | null | undefined
): DecideResult {
	if (suppressed.has(action)) {
		return { skip: true, skipReason: 'action_suppressed_by_user' };
	}
	const rejRate = rates[action] ?? 0;
	if (rejRate > 0.5) {
		return { skip: true, skipReason: 'high_rejection_rate_auto_suppress' };
	}
	return {
		skip: false,
		action,
		severity: severityOverride ?? severity,
		suggestedPayload,
		reason
	};
}
```

Add this helper above `decideAction`. Then refactor each existing successful return to use it. Example:

```ts
return gateAction(
	'pause_ad',
	'urgent',
	{},
	`CPL actual ${cplRon} RON depășește target ${tCplRon} RON, 0 conversii pe ${spendRon} RON spend (maturity=mature).`,
	suppressed,
	rates,
	target.severityOverride
);
```

Apply this transformation to all 5 success returns in the function (pause_ad, refresh_creative for dry spell, decrease_budget for aggregate, decrease_budget for daily, increase_budget, refresh_creative for low CTR).

- [ ] **Step 2: Type check**

Run: `cd /Users/augustin598/Projects/PersonalOPS && bunx tsc --noEmit -p tsconfig.json 2>&1 | grep "decision-engine"`
Expected: no errors.

- [ ] **Step 3: Commit (tests added in next task)**

```bash
git add src/services/workers/ads-optimizer/decision-engine.ts
git commit -m "feat(ads): decision-engine honors target overrides + rejection rates"
```

---

### Task 2.12: PersonalOPS — add 6 unit tests for overrides

**Files:**
- Modify: `/Users/augustin598/Projects/PersonalOPS/src/services/workers/ads-optimizer/__tests__/decision-engine.test.ts`

- [ ] **Step 1: Append override test cases**

At the bottom of the existing test file, append:

```ts
describe("decideAction — override behaviors", () => {
	it("Override 1: customCooldownHours=24 — cooldown skip kicks in earlier", () => {
		const lastApplied = new Date(Date.now() - 25 * 3600_000); // 25h ago
		// Default cooldown 72h would NOT skip; override 24h SHOULD allow (25 > 24)
		const targetWithOverride = { ...baseTarget, customCooldownHours: 24 };
		const result = decideAction({
			target: targetWithOverride,
			latestSnapshot: { ...matureSnapshot, conversions: 10, cplCents: 2000 },
			consecutiveDays: 3,
			hasOpenRec: false,
			lastAppliedAt: lastApplied,
		});
		// 25h > 24h cooldown → cooldown should NOT block (other rules may skip but reason != 'cooldown_active')
		if (result.skip) expect(result.skipReason).not.toBe("cooldown_active");
	});

	it("Override 2: suppressedActions=['pause_ad'] — skip with action_suppressed_by_user", () => {
		const targetWithOverride = { ...baseTarget, suppressedActions: ['pause_ad'] };
		// Trigger pause_ad: emergency CPL > 1.5x with 0 conversions on >3x target spend
		const trigger: MetricSnapshot = {
			...matureSnapshot,
			cplCents: 5000,           // 5x target
			spendCents: 5000,         // > 3 * 1200 = 3600
			conversions: 0,
			maturity: 'mature',
		};
		const result = decideAction({
			target: targetWithOverride,
			latestSnapshot: trigger,
			consecutiveDays: 3,
			hasOpenRec: false,
			lastAppliedAt: null,
		});
		expect(result.skip).toBe(true);
		if (result.skip) expect(result.skipReason).toBe("action_suppressed_by_user");
	});

	it("Override 3: severityOverride='urgent' propagates to result severity", () => {
		const targetWithOverride = { ...baseTarget, severityOverride: 'urgent' as const };
		// Trigger increase_budget: CPL well below target
		const trigger: MetricSnapshot = {
			...matureSnapshot,
			cplCents: 600,
			conversions: 10,
			roas: 4,
		};
		const result = decideAction({
			target: targetWithOverride,
			latestSnapshot: trigger,
			consecutiveDays: 3,
			hasOpenRec: false,
			lastAppliedAt: null,
		});
		expect(result.skip).toBe(false);
		if (!result.skip) expect(result.severity).toBe('urgent');
	});

	it("Override 4: minConversionsThreshold=10 blocks at conversions=8", () => {
		const targetWithOverride = { ...baseTarget, minConversionsThreshold: 10 };
		const result = decideAction({
			target: targetWithOverride,
			latestSnapshot: { ...matureSnapshot, conversions: 8 },
			consecutiveDays: 3,
			hasOpenRec: false,
			lastAppliedAt: null,
		});
		expect(result.skip).toBe(true);
		if (result.skip) expect(result.skipReason).toBe("insufficient_conversions");
	});

	it("Override 5: recentRejectionRates['increase_budget']=0.6 → skip auto-suppress", () => {
		const trigger: MetricSnapshot = {
			...matureSnapshot,
			cplCents: 600,
			conversions: 10,
			roas: 4,
		};
		const result = decideAction({
			target: baseTarget,
			latestSnapshot: trigger,
			consecutiveDays: 3,
			hasOpenRec: false,
			lastAppliedAt: null,
			recentRejectionRates: { increase_budget: 0.6 },
		});
		expect(result.skip).toBe(true);
		if (result.skip) expect(result.skipReason).toBe("high_rejection_rate_auto_suppress");
	});

	it("Override 6: all overrides null/empty → behaves identically to existing tests", () => {
		const result = decideAction({
			target: baseTarget,
			latestSnapshot: { ...matureSnapshot, conversions: 2 },
			consecutiveDays: 3,
			hasOpenRec: false,
			lastAppliedAt: null,
		});
		expect(result.skip).toBe(true);
		if (result.skip) expect(result.skipReason).toBe("insufficient_conversions");
	});
});
```

- [ ] **Step 2: Run all tests**

Run: `cd /Users/augustin598/Projects/PersonalOPS && bun test src/services/workers/ads-optimizer/__tests__/decision-engine.test.ts`
Expected: all existing tests still pass + 6 new tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/services/workers/ads-optimizer/__tests__/decision-engine.test.ts
git commit -m "test(ads): cover override + rejection-rate cases in decision-engine"
```

---

### Task 2.13: PersonalOPS — extend `ads-crm-client.ts` with `getTargetWithOverrides` + `autoSuppress`

**Files:**
- Modify: `/Users/augustin598/Projects/PersonalOPS/src/services/workers/ads-crm-client.ts`

- [ ] **Step 1: Add types and methods**

In the file, after the existing `IntegrationHealth` interface, add:

```ts
export interface TargetWithOverrides {
	id: string;
	tenantId: string;
	clientId: string;
	platform: string;
	externalCampaignId: string;
	externalAdsetId: string | null;
	externalAdAccountId: string | null;
	objective: string;
	targetCplCents: number | null;
	targetCpaCents: number | null;
	targetRoas: number | null;
	targetCtr: number | null;
	targetDailyBudgetCents: number | null;
	deviationThresholdPct: number;
	isActive: boolean;
	isMuted: boolean;
	overrides: {
		customCooldownHours: number | null;
		suppressedActions: string[];
		severityOverride: 'urgent' | 'high' | 'warning' | 'opportunity' | null;
		minConversionsThreshold: number | null;
		version: number;
	};
	feedback: {
		rejectionRateLast30d: Record<string, number>;
	};
}

export interface AutoSuppressInput {
	targetId: string;
	action: string;
	expectedVersion: number;
	reason: string;
}

export interface AutoSuppressResult {
	ok: boolean;
	version?: number;
	expiresAt?: string;
	error?: string;
	currentVersion?: number;
	alreadySuppressed?: boolean;
}
```

In the `AdsCrmClient` class, add methods (anywhere after existing methods):

```ts
	async getTargetWithOverrides(targetId: string): Promise<TargetWithOverrides> {
		return this.request(
			"GET",
			`/api/external/ads-monitor/targets/${encodeURIComponent(targetId)}?withOverrides=true`,
		);
	}

	async autoSuppress(input: AutoSuppressInput): Promise<AutoSuppressResult> {
		try {
			return (await this.request(
				"POST",
				`/api/external/ads-monitor/targets/${encodeURIComponent(input.targetId)}/auto-suppress`,
				{
					body: {
						action: input.action,
						expectedVersion: input.expectedVersion,
						reason: input.reason,
					},
				},
			)) as AutoSuppressResult;
		} catch (e) {
			if (e instanceof CrmApiError && e.status === 409) {
				const detail = (e.detail ?? {}) as Record<string, unknown>;
				return {
					ok: false,
					error: 'version_conflict',
					currentVersion: typeof detail.currentVersion === 'number' ? detail.currentVersion : undefined,
				};
			}
			throw e;
		}
	}
```

- [ ] **Step 2: Type check**

Run: `cd /Users/augustin598/Projects/PersonalOPS && bunx tsc --noEmit -p tsconfig.json 2>&1 | grep "ads-crm-client"`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/services/workers/ads-crm-client.ts
git commit -m "feat(ads): CRM client supports getTargetWithOverrides + autoSuppress"
```

---

### Task 2.14: PersonalOPS — handler reads overrides + computes auto-suppress trigger

**Files:**
- Modify: `/Users/augustin598/Projects/PersonalOPS/src/services/workers/ads-optimizer/handler.ts`

- [ ] **Step 1: Inject overrides + rejection rates into decideAction call**

Open the handler. Locate where `decideAction({ ... })` is called per target. Before that call, add:

```ts
let overrides: TargetWithOverrides | null = null;
try {
	overrides = await crmClient.getTargetWithOverrides(target.id);
} catch (err) {
	console.warn(`[ads-optimizer] getTargetWithOverrides failed for ${target.id}, falling back to defaults:`, err);
}

const enrichedTarget = overrides
	? { ...target,
		customCooldownHours: overrides.overrides.customCooldownHours,
		suppressedActions: overrides.overrides.suppressedActions,
		severityOverride: overrides.overrides.severityOverride,
		minConversionsThreshold: overrides.overrides.minConversionsThreshold,
		version: overrides.overrides.version }
	: target;

const recentRejectionRates = overrides?.feedback.rejectionRateLast30d ?? {};

const decision = decideAction({
	target: enrichedTarget,
	latestSnapshot,
	consecutiveDays,
	hasOpenRec,
	lastAppliedAt,
	agg,
	recentRejectionRates,
});
```

- [ ] **Step 2: After decision, if action gated by `high_rejection_rate_auto_suppress`, call `autoSuppress`**

After `const decision = decideAction(...)`, add:

```ts
if (decision.skip && decision.skipReason === 'high_rejection_rate_auto_suppress' && overrides) {
	// Determine which action triggered the gate (the one with rate > 0.5)
	const triggers = Object.entries(recentRejectionRates)
		.filter(([action, rate]) => rate > 0.5 && !overrides!.overrides.suppressedActions.includes(action));
	for (const [action, rate] of triggers) {
		// Require N>=3 in feedback aggregate (already implicit if rate computed over rejected+applied; tighten if needed)
		const result = await crmClient.autoSuppress({
			targetId: target.id,
			action,
			expectedVersion: overrides.overrides.version,
			reason: `rejection_rate_${rate.toFixed(2)}_in_30d`,
		});
		if (!result.ok && result.error === 'version_conflict' && result.currentVersion !== undefined) {
			// Refetch and retry once
			try {
				const refreshed = await crmClient.getTargetWithOverrides(target.id);
				await crmClient.autoSuppress({
					targetId: target.id,
					action,
					expectedVersion: refreshed.overrides.version,
					reason: `rejection_rate_${rate.toFixed(2)}_in_30d_retry`,
				});
			} catch (err) {
				console.warn(`[ads-optimizer] autoSuppress retry failed for ${target.id}:`, err);
			}
		}
	}
}
```

Add imports at top of file:

```ts
import type { TargetWithOverrides } from '../ads-crm-client';
```

- [ ] **Step 3: Type check**

Run: `cd /Users/augustin598/Projects/PersonalOPS && bunx tsc --noEmit -p tsconfig.json 2>&1 | grep "ads-optimizer/handler"`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/services/workers/ads-optimizer/handler.ts
git commit -m "feat(ads): handler fetches overrides + triggers auto-suppress"
```

---

### Task 2.15: PersonalOPS — feedback-loop integration test

**Files:**
- Create: `/Users/augustin598/Projects/PersonalOPS/src/services/workers/ads-optimizer/__tests__/decision-engine-feedback-loop.test.ts`

- [ ] **Step 1: Add test verifying rate-gate → suppressed-set transition**

```ts
import { describe, it, expect } from "bun:test";
import { decideAction } from "../decision-engine";
import type { Target, MetricSnapshot } from "../types";

const target: Target = {
	id: "tgt_loop",
	tenantId: "ots",
	clientId: "client_loop",
	platform: "meta",
	externalCampaignId: "camp_loop",
	objective: "OUTCOME_LEADS",
	targetCplCents: 1200,
	targetRoas: 2,
	targetCtr: 0.02,
	targetDailyBudgetCents: 5000,
	deviationThresholdPct: 20,
	isActive: true,
	isMuted: false,
	notifyTelegram: true,
	notifyEmail: false,
	notifyInApp: true,
	suppressedActions: [],
};

const triggerIncreaseBudget: MetricSnapshot = {
	spendCents: 10000, impressions: 5000, clicks: 100, conversions: 10,
	cpcCents: 100, cpmCents: 200, cpaCents: 500, cplCents: 600,
	ctr: 0.02, roas: 4, frequency: 1.5, maturity: "mature",
};

describe("feedback loop", () => {
	it("phase 1: no suppression, no rejections → action proposed", () => {
		const r = decideAction({
			target, latestSnapshot: triggerIncreaseBudget,
			consecutiveDays: 3, hasOpenRec: false, lastAppliedAt: null,
		});
		expect(r.skip).toBe(false);
		if (!r.skip) expect(r.action).toBe("increase_budget");
	});

	it("phase 2: rejection rate 0.6 → gate trips with high_rejection_rate_auto_suppress", () => {
		const r = decideAction({
			target, latestSnapshot: triggerIncreaseBudget,
			consecutiveDays: 3, hasOpenRec: false, lastAppliedAt: null,
			recentRejectionRates: { increase_budget: 0.6 },
		});
		expect(r.skip).toBe(true);
		if (r.skip) expect(r.skipReason).toBe("high_rejection_rate_auto_suppress");
	});

	it("phase 3: action moved to suppressedActions → skip with action_suppressed_by_user", () => {
		const suppressed: Target = { ...target, suppressedActions: ['increase_budget'] };
		const r = decideAction({
			target: suppressed, latestSnapshot: triggerIncreaseBudget,
			consecutiveDays: 3, hasOpenRec: false, lastAppliedAt: null,
			recentRejectionRates: {},
		});
		expect(r.skip).toBe(true);
		if (r.skip) expect(r.skipReason).toBe("action_suppressed_by_user");
	});

	it("phase 4: TTL expired (suppressedActions cleared by lazy unsuppress) → action proposed again", () => {
		const restored: Target = { ...target, suppressedActions: [] };
		const r = decideAction({
			target: restored, latestSnapshot: triggerIncreaseBudget,
			consecutiveDays: 3, hasOpenRec: false, lastAppliedAt: null,
			recentRejectionRates: {},
		});
		expect(r.skip).toBe(false);
		if (!r.skip) expect(r.action).toBe("increase_budget");
	});
});
```

- [ ] **Step 2: Run**

Run: `cd /Users/augustin598/Projects/PersonalOPS && bun test src/services/workers/ads-optimizer/__tests__/decision-engine-feedback-loop.test.ts`
Expected: 4 tests passing.

- [ ] **Step 3: Commit**

```bash
git add src/services/workers/ads-optimizer/__tests__/decision-engine-feedback-loop.test.ts
git commit -m "test(ads): integration test for feedback loop 4 phases"
```

---

### Task 2.16: PR2 final verification + push

- [ ] **Step 1: Type check both repos**

```bash
cd /Users/augustin598/Projects/CRM/app && bunx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "(error|Error)" | head -10
cd /Users/augustin598/Projects/PersonalOPS && bunx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "(error|Error)" | head -10
```
Expected: no errors in either repo.

- [ ] **Step 2: Run all relevant tests**

```bash
cd /Users/augustin598/Projects/CRM/app && bun test src/lib/server/ads-monitor/
cd /Users/augustin598/Projects/PersonalOPS && bun test src/services/workers/ads-optimizer/__tests__/
```
Expected: all green.

- [ ] **Step 3: Manual smoke**

- Open `/ots/reports/facebook-ads/monitoring`
- Reject a recommendation with `{ reason: 'wrong_action' }` via DevTools fetch
- Verify `ad_recommendation_feedback` row inserted in DB
- PATCH a target with stale `expectedVersion` → 409
- PATCH a target with fresh `expectedVersion` → 200, version bumped, audit row written
- POST `/api/external/ads-monitor/targets/<id>/auto-suppress` with valid scope key → audit row with `actorType='worker'`, `metadata.expiresAt` populated

- [ ] **Step 4: Push branches + open PRs**

User pushes both branches and opens PRs.

---

# PR 3 — UI

**Goal:** Refactor monitoring page into composable components with side drawer. Depends on PR1 + PR2 deployed.

**Branch:** `feat/ads-monitoring-redesign-ui`

---

### Task 3.1: Create `Sparkline.svelte` (pure SVG, no deps)

**Files:**
- Create: `src/routes/[tenant]/reports/facebook-ads/monitoring/components/Sparkline.svelte`

- [ ] **Step 1: Implement**

```svelte
<script lang="ts">
	interface Props {
		values: Array<number | null>;
		width?: number;
		height?: number;
		ariaLabel: string;
		color?: string;
	}
	let { values, width = 60, height = 16, ariaLabel, color = 'currentColor' }: Props = $props();

	const numeric = $derived(values.filter((v): v is number => typeof v === 'number'));
	const min = $derived(numeric.length > 0 ? Math.min(...numeric) : 0);
	const max = $derived(numeric.length > 0 ? Math.max(...numeric) : 1);
	const range = $derived(max - min || 1);
	const step = $derived(values.length > 1 ? width / (values.length - 1) : width);

	const points = $derived(
		values
			.map((v, i) => {
				if (typeof v !== 'number') return null;
				const x = i * step;
				const y = height - ((v - min) / range) * height;
				return `${x.toFixed(1)},${y.toFixed(1)}`;
			})
			.filter((p): p is string => p !== null)
			.join(' ')
	);
</script>

{#if numeric.length === 0}
	<span class="text-xs text-muted-foreground" aria-label={ariaLabel}>—</span>
{:else}
	<svg
		role="img"
		aria-label={ariaLabel}
		{width}
		{height}
		viewBox="0 0 {width} {height}"
		class="inline-block"
	>
		<polyline fill="none" stroke={color} stroke-width="1.5" points={points} />
	</svg>
{/if}
```

- [ ] **Step 2: Visual smoke (Storybook-style — render in isolation)**

Add a temp test page or use the existing dev server: render `<Sparkline values={[1,3,2,5,4,7,6]} ariaLabel="test" />` and verify it draws.

- [ ] **Step 3: Commit**

```bash
git add src/routes/[tenant]/reports/facebook-ads/monitoring/components/Sparkline.svelte
git commit -m "feat(ads-monitor-ui): pure-SVG Sparkline component"
```

---

### Task 3.2: Create `KpiStrip.svelte`

**Files:**
- Create: `src/routes/[tenant]/reports/facebook-ads/monitoring/components/KpiStrip.svelte`

- [ ] **Step 1: Implement**

```svelte
<script lang="ts">
	import { Card } from '$lib/components/ui/card';

	interface Props {
		summary: {
			activeTargets: number;
			pendingRecs: number;
			spend7dCents: number;
			avgCpl30dCents: number | null;
			avgTargetCplCents: number | null;
		};
	}
	let { summary }: Props = $props();

	const fmt = (cents: number) => `${(cents / 100).toFixed(0)} RON`;
	const cplDelta = $derived(
		summary.avgCpl30dCents !== null && summary.avgTargetCplCents !== null
			? summary.avgCpl30dCents - summary.avgTargetCplCents
			: null
	);
	const cplPctDelta = $derived(
		cplDelta !== null && summary.avgTargetCplCents
			? ((cplDelta / summary.avgTargetCplCents) * 100).toFixed(0)
			: null
	);
</script>

<div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
	<Card class="p-4">
		<div class="text-xs text-muted-foreground uppercase tracking-wide">Active</div>
		<div class="text-2xl font-bold">{summary.activeTargets}</div>
	</Card>
	<Card class="p-4">
		<div class="text-xs text-muted-foreground uppercase tracking-wide">Pending</div>
		<div class="text-2xl font-bold">
			{summary.pendingRecs}
			{#if summary.pendingRecs > 0}<span class="text-amber-500 text-base">▲</span>{/if}
		</div>
	</Card>
	<Card class="p-4">
		<div class="text-xs text-muted-foreground uppercase tracking-wide">Spend 7d</div>
		<div class="text-2xl font-bold">{fmt(summary.spend7dCents)}</div>
	</Card>
	<Card class="p-4">
		<div class="text-xs text-muted-foreground uppercase tracking-wide">Avg CPL 30d</div>
		<div class="text-2xl font-bold">
			{summary.avgCpl30dCents !== null ? fmt(summary.avgCpl30dCents) : '—'}
			{#if summary.avgTargetCplCents !== null}
				<span class="text-sm text-muted-foreground"> / {fmt(summary.avgTargetCplCents)}</span>
			{/if}
		</div>
		{#if cplPctDelta !== null}
			<div class="text-xs {Number(cplPctDelta) > 0 ? 'text-red-600' : 'text-green-600'}">
				{Number(cplPctDelta) > 0 ? '+' : ''}{cplPctDelta}% vs target
			</div>
		{/if}
	</Card>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/[tenant]/reports/facebook-ads/monitoring/components/KpiStrip.svelte
git commit -m "feat(ads-monitor-ui): KpiStrip 4-card summary"
```

---

### Task 3.3: Create `TargetFilters.svelte`

**Files:**
- Create: `src/routes/[tenant]/reports/facebook-ads/monitoring/components/TargetFilters.svelte`

- [ ] **Step 1: Implement controlled-component filters**

```svelte
<script lang="ts">
	interface Client { id: string; name: string }
	interface Props {
		clients: Client[];
		clientId: string;
		status: 'all' | 'active' | 'muted' | 'inactive';
		deviation: 'all' | 'over' | 'under' | 'ok';
		search: string;
		onChange: (next: { clientId: string; status: string; deviation: string; search: string }) => void;
	}
	let { clients, clientId = $bindable(), status = $bindable(), deviation = $bindable(), search = $bindable(), onChange }: Props = $props();

	function emit() {
		onChange({ clientId, status, deviation, search });
	}
</script>

<div class="flex flex-wrap gap-3 items-center">
	<select bind:value={clientId} onchange={emit} class="h-9 rounded-md border px-3 bg-background">
		<option value="">Toți clienții</option>
		{#each clients as c}
			<option value={c.id}>{c.name}</option>
		{/each}
	</select>
	<select bind:value={status} onchange={emit} class="h-9 rounded-md border px-3 bg-background">
		<option value="all">Toate</option>
		<option value="active">Active</option>
		<option value="muted">Muted</option>
		<option value="inactive">Inactive</option>
	</select>
	<select bind:value={deviation} onchange={emit} class="h-9 rounded-md border px-3 bg-background">
		<option value="all">Orice deviație</option>
		<option value="over">Peste target</option>
		<option value="under">Sub target</option>
		<option value="ok">În target</option>
	</select>
	<input
		type="search"
		placeholder="Caută campanie / client…"
		bind:value={search}
		oninput={emit}
		class="h-9 rounded-md border px-3 bg-background flex-1 min-w-[200px]"
	/>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/[tenant]/reports/facebook-ads/monitoring/components/TargetFilters.svelte
git commit -m "feat(ads-monitor-ui): TargetFilters controlled component"
```

---

### Task 3.4: Create `TargetRow.svelte` with sparkline + drawer trigger

**Files:**
- Create: `src/routes/[tenant]/reports/facebook-ads/monitoring/components/TargetRow.svelte`

- [ ] **Step 1: Implement**

```svelte
<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import Sparkline from './Sparkline.svelte';

	interface TargetRowData {
		id: string;
		clientName: string;
		accountName: string | null;
		accountId: string | null;
		externalCampaignId: string;
		objective: string;
		targetCplCents: number | null;
		latestCplCents: number | null;
		spark7d: Array<number | null>;
		isActive: boolean;
		isMuted: boolean;
		mutedUntil: Date | null;
	}
	interface Props {
		target: TargetRowData;
		onSelect: (id: string) => void;
	}
	let { target, onSelect }: Props = $props();

	const fmt = (c: number | null) => (c === null ? '—' : `${(c / 100).toFixed(0)} RON`);
	const deltaPct = $derived(
		target.targetCplCents && target.latestCplCents
			? Math.round((target.latestCplCents / target.targetCplCents - 1) * 100)
			: null
	);
	const deltaClass = $derived(
		deltaPct === null
			? 'text-muted-foreground'
			: deltaPct > 10
				? 'text-red-600'
				: deltaPct < -10
					? 'text-green-600'
					: 'text-muted-foreground'
	);
</script>

<tr class="border-b hover:bg-muted/20 cursor-pointer" onclick={() => onSelect(target.id)}>
	<td class="px-3 py-2">{target.clientName}</td>
	<td class="px-3 py-2 text-xs">
		{#if target.accountId}
			<div class="font-mono text-muted-foreground">{target.accountId}</div>
			{#if target.accountName}<div>{target.accountName}</div>{/if}
		{:else}
			<Badge variant="outline" class="text-xs">act_? (neasignat)</Badge>
		{/if}
	</td>
	<td class="px-3 py-2 font-mono text-xs">{target.externalCampaignId}</td>
	<td class="px-3 py-2 text-right">
		<div>{fmt(target.latestCplCents)} / {fmt(target.targetCplCents)}</div>
		{#if deltaPct !== null}
			<div class="text-xs {deltaClass}">{deltaPct > 0 ? '+' : ''}{deltaPct}%</div>
		{/if}
	</td>
	<td class="px-3 py-2"><Sparkline values={target.spark7d} ariaLabel="CPL ultimele 7 zile" /></td>
	<td class="px-3 py-2">
		{#if target.isMuted}
			<Badge variant="secondary" class="text-xs">🔇 Mute</Badge>
		{:else if target.isActive}
			<Badge variant="default" class="text-xs">Activ</Badge>
		{:else}
			<Badge variant="outline" class="text-xs">Inactiv</Badge>
		{/if}
	</td>
</tr>
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/[tenant]/reports/facebook-ads/monitoring/components/TargetRow.svelte
git commit -m "feat(ads-monitor-ui): TargetRow with sparkline + ad-account display"
```

---

### Task 3.5: Create `TargetDrawer.svelte` shell with 4 tabs

**Files:**
- Create: `src/routes/[tenant]/reports/facebook-ads/monitoring/components/TargetDrawer.svelte`

- [ ] **Step 1: Implement shell with tab switching + footer**

```svelte
<script lang="ts">
	import * as Sheet from '$lib/components/ui/sheet';
	import { Button } from '$lib/components/ui/button';
	import PerformanceTab from './drawer/PerformanceTab.svelte';
	import EditTargetTab from './drawer/EditTargetTab.svelte';
	import OverridesTab from './drawer/OverridesTab.svelte';
	import HistoryTab from './drawer/HistoryTab.svelte';

	type Tab = 'performance' | 'edit' | 'overrides' | 'history';

	interface Props {
		open: boolean;
		targetId: string | null;
		tenantSlug: string;
		onClose: () => void;
		onUpdated: () => void;
	}
	let { open = $bindable(), targetId, tenantSlug, onClose, onUpdated }: Props = $props();

	let activeTab = $state<Tab>('performance');
	let target = $state<any>(null);
	let lastAudit = $state<{ at: string; actorName: string | null; action: string } | null>(null);
	let loading = $state(false);

	$effect(() => {
		if (open && targetId) loadTarget();
	});

	async function loadTarget() {
		loading = true;
		try {
			const res = await fetch(`/${tenantSlug}/api/ads-monitor/targets/${targetId}`);
			if (!res.ok) throw new Error('load failed');
			target = await res.json();
			const auditRes = await fetch(
				`/${tenantSlug}/api/ads-monitor/targets/${targetId}/audit?limit=1`
			);
			if (auditRes.ok) {
				const data = await auditRes.json();
				lastAudit = data.entries[0] ?? null;
			}
		} finally {
			loading = false;
		}
	}
</script>

<Sheet.Root bind:open onOpenChange={(o) => { if (!o) onClose(); }}>
	<Sheet.Content side="right" class="w-[480px] max-w-full">
		{#if loading || !target}
			<div class="p-6 text-muted-foreground">Se încarcă…</div>
		{:else}
			<Sheet.Header>
				<Sheet.Title>{target.clientName}</Sheet.Title>
				<Sheet.Description class="text-xs">
					{target.accountId ?? 'act_? (neasignat)'} · {target.target.externalCampaignId}
				</Sheet.Description>
			</Sheet.Header>

			<div class="flex gap-1 border-b mt-3" role="tablist">
				{#each [['performance','Performance'],['edit','Edit'],['overrides','Overrides'],['history','Istoric']] as [val, label]}
					<button
						role="tab"
						aria-selected={activeTab === val}
						class="px-3 py-2 text-sm border-b-2 -mb-px {activeTab === val ? 'border-primary' : 'border-transparent text-muted-foreground'}"
						onclick={() => (activeTab = val as Tab)}
					>{label}</button>
				{/each}
			</div>

			<div class="py-4 max-h-[calc(100vh-260px)] overflow-y-auto">
				{#if activeTab === 'performance'}
					<PerformanceTab {tenantSlug} campaignId={target.target.externalCampaignId} target={target.target} />
				{:else if activeTab === 'edit'}
					<EditTargetTab {tenantSlug} target={target.target} onSaved={() => { loadTarget(); onUpdated(); }} />
				{:else if activeTab === 'overrides'}
					<OverridesTab {tenantSlug} target={target.target} onSaved={() => { loadTarget(); onUpdated(); }} />
				{:else if activeTab === 'history'}
					<HistoryTab {tenantSlug} targetId={target.target.id} />
				{/if}
			</div>

			{#if lastAudit}
				<Sheet.Footer class="text-xs text-muted-foreground border-t pt-2">
					Ultima modificare: {lastAudit.actorName ?? lastAudit.action}
					· {new Date(lastAudit.at).toLocaleString('ro-RO')}
				</Sheet.Footer>
			{/if}
		{/if}
	</Sheet.Content>
</Sheet.Root>
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/[tenant]/reports/facebook-ads/monitoring/components/TargetDrawer.svelte
git commit -m "feat(ads-monitor-ui): TargetDrawer shell with 4 tabs + lastAudit footer"
```

---

### Task 3.6: Create `PerformanceTab.svelte`

**Files:**
- Create: `src/routes/[tenant]/reports/facebook-ads/monitoring/components/drawer/PerformanceTab.svelte`

- [ ] **Step 1: Implement**

```svelte
<script lang="ts">
	import Sparkline from '../Sparkline.svelte';
	import { Badge } from '$lib/components/ui/badge';

	interface Snapshot {
		date: string;
		spendCents: number; impressions: number; clicks: number; conversions: number;
		cpcCents: number | null; cpaCents: number | null; cplCents: number | null;
		ctr: number | null; roas: number | null; frequency: number | null;
		maturity: string;
	}
	interface Props { tenantSlug: string; campaignId: string; target: any }
	let { tenantSlug, campaignId, target }: Props = $props();

	let snapshots = $state<Snapshot[]>([]);
	let loading = $state(true);

	$effect(() => { load(); });

	async function load() {
		loading = true;
		try {
			const res = await fetch(`/${tenantSlug}/api/ads-monitor/snapshots?campaignId=${campaignId}&days=30`);
			if (res.ok) {
				const data = await res.json();
				snapshots = data.snapshots ?? [];
			}
		} finally { loading = false; }
	}

	const last7 = $derived(snapshots.slice(-7));
	const cpl7 = $derived(last7.map((s) => s.cplCents));
	const spend7 = $derived(last7.map((s) => s.spendCents));
	const conv7 = $derived(last7.map((s) => s.conversions));
	const ctr7 = $derived(last7.map((s) => s.ctr));

	const avg30Cpl = $derived(() => {
		const vals = snapshots.map((s) => s.cplCents).filter((v): v is number => typeof v === 'number');
		return vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
	});
	const total30Spend = $derived(snapshots.reduce((sum, s) => sum + s.spendCents, 0));
	const total30Conv = $derived(snapshots.reduce((sum, s) => sum + s.conversions, 0));
	const lastSnap = $derived(snapshots[snapshots.length - 1]);

	const fmt = (c: number | null) => (c === null ? '—' : `${(c / 100).toFixed(2)} RON`);
</script>

{#if loading}
	<div class="text-muted-foreground">Se încarcă…</div>
{:else if snapshots.length === 0}
	<div class="text-center text-muted-foreground py-8">
		<p>Niciun snapshot încă.</p>
		<p class="text-xs mt-1">Așteaptă cron-ul de noapte sau rulează manual.</p>
	</div>
{:else}
	<section class="space-y-3">
		<h3 class="text-sm font-semibold">Ultimele 7 zile</h3>
		<div class="grid grid-cols-2 gap-3 text-sm">
			<div class="flex items-center gap-2">CPL <Sparkline values={cpl7} ariaLabel="CPL 7 zile" /> {fmt(cpl7[cpl7.length - 1] ?? null)}</div>
			<div class="flex items-center gap-2">Spend <Sparkline values={spend7} ariaLabel="Spend 7 zile" /> {fmt(spend7[spend7.length - 1] ?? null)}</div>
			<div class="flex items-center gap-2">Conv <Sparkline values={conv7} ariaLabel="Conv 7 zile" /> {conv7[conv7.length - 1] ?? '—'}</div>
			<div class="flex items-center gap-2">CTR <Sparkline values={ctr7} ariaLabel="CTR 7 zile" /> {(typeof ctr7[ctr7.length - 1] === 'number' ? (ctr7[ctr7.length - 1]! * 100).toFixed(2) + '%' : '—')}</div>
		</div>
	</section>

	<section class="space-y-2 mt-4 pt-4 border-t">
		<h3 class="text-sm font-semibold">30 zile</h3>
		<div class="text-sm space-y-1">
			<div>Avg CPL: <span class="font-mono">{fmt(avg30Cpl)}</span> · Target: <span class="font-mono">{fmt(target.targetCplCents)}</span></div>
			<div>Total spend: <span class="font-mono">{fmt(total30Spend)}</span> · Conversii: {total30Conv}</div>
		</div>
	</section>

	{#if lastSnap}
		<section class="mt-4 pt-4 border-t text-xs text-muted-foreground">
			Ultimul snapshot: {lastSnap.date} · Maturity: <Badge variant="outline" class="text-xs">{lastSnap.maturity}</Badge>
		</section>
	{/if}
{/if}
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/[tenant]/reports/facebook-ads/monitoring/components/drawer/PerformanceTab.svelte
git commit -m "feat(ads-monitor-ui): PerformanceTab with sparklines + 30d aggregates"
```

---

### Task 3.7: Create `EditTargetTab.svelte`

**Files:**
- Create: `src/routes/[tenant]/reports/facebook-ads/monitoring/components/drawer/EditTargetTab.svelte`

- [ ] **Step 1: Implement form with optimistic-lock handling**

```svelte
<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { toast } from 'svelte-sonner';

	interface Props { tenantSlug: string; target: any; onSaved: () => void }
	let { tenantSlug, target, onSaved }: Props = $props();

	let cpl = $state(target.targetCplCents !== null ? (target.targetCplCents / 100).toString() : '');
	let cpa = $state(target.targetCpaCents !== null ? (target.targetCpaCents / 100).toString() : '');
	let roas = $state(target.targetRoas !== null ? String(target.targetRoas) : '');
	let ctr = $state(target.targetCtr !== null ? String(target.targetCtr) : '');
	let dailyBudget = $state(
		target.targetDailyBudgetCents !== null ? (target.targetDailyBudgetCents / 100).toString() : ''
	);
	let threshold = $state(String(target.deviationThresholdPct ?? 20));
	let notes = $state(target.notes ?? '');
	let auditNote = $state('');
	let saving = $state(false);

	const ronToCents = (v: string): number | null => {
		const t = v.trim(); if (!t) return null;
		const n = parseFloat(t); return isFinite(n) ? Math.round(n * 100) : null;
	};
	const numOrNull = (v: string): number | null => {
		const t = v.trim(); if (!t) return null;
		const n = parseFloat(t); return isFinite(n) ? n : null;
	};

	async function save() {
		saving = true;
		try {
			const res = await fetch(`/${tenantSlug}/api/ads-monitor/targets/${target.id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					expectedVersion: target.version,
					targetCplCents: ronToCents(cpl),
					targetCpaCents: ronToCents(cpa),
					targetRoas: numOrNull(roas),
					targetCtr: numOrNull(ctr),
					targetDailyBudgetCents: ronToCents(dailyBudget),
					deviationThresholdPct: parseInt(threshold, 10) || 20,
					notes: notes.trim().slice(0, 500) || null,
					auditNote: auditNote.trim().slice(0, 200) || undefined
				})
			});
			const body = await res.json();
			if (res.status === 409) {
				toast.error('Targetul a fost modificat între timp — am reîncărcat datele.');
				onSaved();
				return;
			}
			if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
			if (body.changed === false) {
				toast.info('Nicio modificare detectată.');
			} else {
				toast.success('Salvat.');
			}
			onSaved();
		} catch (e) {
			toast.error(`Eroare: ${(e as Error).message}`);
		} finally {
			saving = false;
		}
	}
</script>

<div class="grid grid-cols-2 gap-3">
	<label class="flex flex-col gap-1 text-sm">
		CPL țintă (RON)
		<input bind:value={cpl} type="number" step="0.01" class="h-9 rounded-md border px-3 bg-background" />
	</label>
	<label class="flex flex-col gap-1 text-sm">
		CPA țintă (RON)
		<input bind:value={cpa} type="number" step="0.01" class="h-9 rounded-md border px-3 bg-background" />
	</label>
	<label class="flex flex-col gap-1 text-sm">
		ROAS țintă
		<input bind:value={roas} type="number" step="0.1" class="h-9 rounded-md border px-3 bg-background" />
	</label>
	<label class="flex flex-col gap-1 text-sm">
		CTR țintă (zecimal)
		<input bind:value={ctr} type="number" step="0.001" class="h-9 rounded-md border px-3 bg-background" />
	</label>
	<label class="flex flex-col gap-1 text-sm">
		Buget zilnic (RON)
		<input bind:value={dailyBudget} type="number" step="0.01" class="h-9 rounded-md border px-3 bg-background" />
	</label>
	<label class="flex flex-col gap-1 text-sm">
		Prag deviație (%)
		<input bind:value={threshold} type="number" min="5" max="100" class="h-9 rounded-md border px-3 bg-background" />
	</label>
</div>
<label class="flex flex-col gap-1 text-sm mt-3">
	Notițe interne (max 500 char)
	<textarea bind:value={notes} maxlength="500" rows="2" class="rounded-md border px-3 py-2 bg-background"></textarea>
</label>
<label class="flex flex-col gap-1 text-sm mt-3">
	Motiv modificare (opțional, max 200 char)
	<input bind:value={auditNote} maxlength="200" placeholder="ex: Client a redus targetul după A/B test" class="h-9 rounded-md border px-3 bg-background" />
</label>
<div class="flex justify-end mt-4">
	<Button onclick={save} disabled={saving}>{saving ? 'Se salvează…' : 'Salvează'}</Button>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/[tenant]/reports/facebook-ads/monitoring/components/drawer/EditTargetTab.svelte
git commit -m "feat(ads-monitor-ui): EditTargetTab with optimistic-lock handling"
```

---

### Task 3.8: Create `OverridesTab.svelte`

**Files:**
- Create: `src/routes/[tenant]/reports/facebook-ads/monitoring/components/drawer/OverridesTab.svelte`

- [ ] **Step 1: Implement**

```svelte
<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { toast } from 'svelte-sonner';

	const ALL_ACTIONS = [
		'pause_ad','resume_ad','increase_budget','decrease_budget','refresh_creative','change_audience'
	] as const;
	const SEVERITY_OPTIONS = ['', 'urgent', 'high', 'warning', 'opportunity'];

	interface Props { tenantSlug: string; target: any; onSaved: () => void }
	let { tenantSlug, target, onSaved }: Props = $props();

	let cooldown = $state(target.customCooldownHours !== null ? String(target.customCooldownHours) : '');
	let minConv = $state(target.minConversionsThreshold !== null ? String(target.minConversionsThreshold) : '');
	let severity = $state(target.severityOverride ?? '');
	let suppressed = $state<string[]>(Array.isArray(target.suppressedActions) ? [...target.suppressedActions] : []);
	let saving = $state(false);

	function toggle(action: string) {
		suppressed = suppressed.includes(action)
			? suppressed.filter((a) => a !== action)
			: [...suppressed, action];
	}

	async function save() {
		if (suppressed.length === ALL_ACTIONS.length) {
			if (!confirm('Toate cele 6 acțiuni sunt suprimate. Workerul nu va mai propune nimic. Continui?')) return;
		}
		saving = true;
		try {
			const res = await fetch(`/${tenantSlug}/api/ads-monitor/targets/${target.id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					expectedVersion: target.version,
					customCooldownHours: cooldown.trim() === '' ? null : parseInt(cooldown, 10),
					minConversionsThreshold: minConv.trim() === '' ? null : parseInt(minConv, 10),
					severityOverride: severity || null,
					suppressedActions: suppressed
				})
			});
			const body = await res.json();
			if (res.status === 409) { toast.error('Targetul a fost modificat — reîncarc.'); onSaved(); return; }
			if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
			toast.success('Override-uri salvate.');
			onSaved();
		} catch (e) {
			toast.error(`Eroare: ${(e as Error).message}`);
		} finally { saving = false; }
	}
</script>

<div class="space-y-4 text-sm">
	<label class="flex flex-col gap-1">
		Cooldown personalizat (ore, default 72)
		<input bind:value={cooldown} type="number" min="1" max="720" placeholder="default 72" class="h-9 rounded-md border px-3 bg-background" />
	</label>
	<label class="flex flex-col gap-1">
		Min conversii pentru evaluare (default 5)
		<input bind:value={minConv} type="number" min="0" max="100" placeholder="default 5" class="h-9 rounded-md border px-3 bg-background" />
	</label>
	<label class="flex flex-col gap-1">
		Severity override
		<select bind:value={severity} class="h-9 rounded-md border px-3 bg-background">
			<option value="">auto</option>
			<option value="urgent">urgent</option>
			<option value="high">high</option>
			<option value="warning">warning</option>
			<option value="opportunity">opportunity</option>
		</select>
	</label>
	<fieldset class="space-y-2">
		<legend class="font-medium">Suprimă acțiuni propuse</legend>
		{#each ALL_ACTIONS as action}
			<label class="flex items-center gap-2">
				<input type="checkbox" checked={suppressed.includes(action)} onchange={() => toggle(action)} />
				<code class="text-xs">{action}</code>
			</label>
		{/each}
	</fieldset>
	{#if suppressed.length === ALL_ACTIONS.length}
		<p class="text-amber-600 text-xs">⚠ Workerul nu va mai propune nimic pentru acest target.</p>
	{/if}
	<div class="flex justify-end pt-2">
		<Button onclick={save} disabled={saving}>{saving ? 'Salvez…' : 'Salvează override-uri'}</Button>
	</div>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/[tenant]/reports/facebook-ads/monitoring/components/drawer/OverridesTab.svelte
git commit -m "feat(ads-monitor-ui): OverridesTab with all-suppressed warning"
```

---

### Task 3.9: Create `HistoryTab.svelte`

**Files:**
- Create: `src/routes/[tenant]/reports/facebook-ads/monitoring/components/drawer/HistoryTab.svelte`

- [ ] **Step 1: Implement timeline**

```svelte
<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';

	interface Entry {
		id: string; actorType: string; actorId: string; actorName: string | null;
		action: string; changesJson: string; note: string | null; metadataJson: string; at: string;
	}
	interface Props { tenantSlug: string; targetId: string }
	let { tenantSlug, targetId }: Props = $props();

	let entries = $state<Entry[]>([]);
	let offset = $state(0);
	let hasMore = $state(true);
	let loading = $state(false);

	$effect(() => { entries = []; offset = 0; hasMore = true; load(); });

	async function load() {
		if (loading || !hasMore) return;
		loading = true;
		try {
			const res = await fetch(
				`/${tenantSlug}/api/ads-monitor/targets/${targetId}/audit?limit=20&offset=${offset}`
			);
			if (res.ok) {
				const data = await res.json();
				entries = [...entries, ...data.entries];
				hasMore = data.entries.length === 20;
				offset += data.entries.length;
			}
		} finally { loading = false; }
	}

	function diffPairs(json: string): Array<[string, unknown, unknown]> {
		try {
			const parsed = JSON.parse(json) as Record<string, { from: unknown; to: unknown }>;
			return Object.entries(parsed).map(([k, v]) => [k, v.from, v.to]);
		} catch { return []; }
	}

	function fmtVal(v: unknown): string {
		if (v === null || v === undefined) return '—';
		if (Array.isArray(v)) return v.length === 0 ? '[]' : v.join(', ');
		return String(v);
	}
</script>

<div class="space-y-3">
	{#each entries as e (e.id)}
		<div class="text-sm border-l-2 pl-3 py-1 {e.actorType === 'worker' ? 'border-amber-500' : e.actorType === 'system' ? 'border-blue-500' : 'border-primary'}">
			<div class="flex items-center gap-2 text-xs text-muted-foreground">
				<span>{new Date(e.at).toLocaleString('ro-RO')}</span>
				<span>·</span>
				<Badge variant="outline" class="text-xs">{e.actorType}</Badge>
				<span>{e.actorName ?? e.actorId}</span>
				<Badge class="text-xs">{e.action}</Badge>
			</div>
			{#each diffPairs(e.changesJson) as [field, from, to]}
				<div class="text-xs"><span class="text-muted-foreground">{field}:</span> {fmtVal(from)} → {fmtVal(to)}</div>
			{/each}
			{#if e.note}
				<p class="text-xs italic mt-1 text-muted-foreground">„{e.note}"</p>
			{/if}
		</div>
	{/each}
	{#if hasMore}
		<button onclick={load} disabled={loading} class="text-xs text-primary hover:underline">
			{loading ? 'Se încarcă…' : 'Încarcă mai mult'}
		</button>
	{/if}
	{#if entries.length === 0 && !loading}
		<p class="text-muted-foreground text-sm">Niciun eveniment în istoric.</p>
	{/if}
</div>
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/[tenant]/reports/facebook-ads/monitoring/components/drawer/HistoryTab.svelte
git commit -m "feat(ads-monitor-ui): HistoryTab timeline with paginated diff display"
```

---

### Task 3.10: Create `RejectRecModal.svelte`

**Files:**
- Create: `src/routes/[tenant]/reports/facebook-ads/monitoring/components/RejectRecModal.svelte`

- [ ] **Step 1: Implement structured-reason modal**

```svelte
<script lang="ts">
	import * as Sheet from '$lib/components/ui/sheet';
	import { Button } from '$lib/components/ui/button';
	import { toast } from 'svelte-sonner';

	const REASONS = [
		{ value: 'false_positive', label: 'Recomandare greșită (fals pozitiv)' },
		{ value: 'wrong_action', label: 'Acțiune greșită (alta ar fi mai potrivită)' },
		{ value: 'bad_timing', label: 'Timing prost (ex: înainte de campanie sezonieră)' },
		{ value: 'manually_handled', label: 'Am rezolvat manual' },
		{ value: 'other', label: 'Altul' }
	];

	interface Props {
		open: boolean;
		recId: string | null;
		tenantSlug: string;
		onClose: () => void;
		onRejected: () => void;
	}
	let { open = $bindable(), recId, tenantSlug, onClose, onRejected }: Props = $props();

	let reason = $state('false_positive');
	let note = $state('');
	let saving = $state(false);

	async function submit() {
		if (!recId) return;
		saving = true;
		try {
			const res = await fetch(`/${tenantSlug}/api/ads-monitor/recommendations/${recId}/reject`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ reason, note: note.trim().slice(0, 200) || undefined })
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			toast.success('Recomandare respinsă cu feedback.');
			onRejected();
			onClose();
		} catch (e) {
			toast.error(`Eroare: ${(e as Error).message}`);
		} finally { saving = false; }
	}
</script>

<Sheet.Root bind:open onOpenChange={(o) => { if (!o) onClose(); }}>
	<Sheet.Content side="right" class="w-[400px]">
		<Sheet.Header>
			<Sheet.Title>Respinge recomandare</Sheet.Title>
		</Sheet.Header>
		<div class="space-y-3 py-4">
			<fieldset class="space-y-2">
				<legend class="text-sm font-medium">Motiv</legend>
				{#each REASONS as r}
					<label class="flex items-start gap-2 text-sm">
						<input type="radio" bind:group={reason} value={r.value} />
						<span>{r.label}</span>
					</label>
				{/each}
			</fieldset>
			<label class="flex flex-col gap-1 text-sm">
				Notă opțională (max 200)
				<textarea bind:value={note} maxlength="200" rows="2" class="rounded-md border px-3 py-2 bg-background"></textarea>
			</label>
		</div>
		<Sheet.Footer>
			<Button variant="outline" onclick={onClose}>Anulează</Button>
			<Button onclick={submit} disabled={saving}>{saving ? 'Salvez…' : 'Respinge'}</Button>
		</Sheet.Footer>
	</Sheet.Content>
</Sheet.Root>
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/[tenant]/reports/facebook-ads/monitoring/components/RejectRecModal.svelte
git commit -m "feat(ads-monitor-ui): RejectRecModal with structured reasons"
```

---

### Task 3.11: Update `+page.server.ts` load query

**Files:**
- Modify: `src/routes/[tenant]/reports/facebook-ads/monitoring/+page.server.ts`

- [ ] **Step 1: Extend select with ad-account join + last-snapshot subquery**

Replace the entire load function with:

```ts
import { error, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, desc, gte, sql } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, fetch }) => {
	if (!locals.user || !locals.tenant) throw redirect(302, '/login');

	const since7 = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);

	const targetRows = await db
		.select({
			id: table.adMonitorTarget.id,
			clientId: table.adMonitorTarget.clientId,
			clientName: table.client.name,
			externalCampaignId: table.adMonitorTarget.externalCampaignId,
			externalAdsetId: table.adMonitorTarget.externalAdsetId,
			externalAdAccountId: table.adMonitorTarget.externalAdAccountId,
			objective: table.adMonitorTarget.objective,
			targetCplCents: table.adMonitorTarget.targetCplCents,
			targetCpaCents: table.adMonitorTarget.targetCpaCents,
			targetRoas: table.adMonitorTarget.targetRoas,
			targetCtr: table.adMonitorTarget.targetCtr,
			targetDailyBudgetCents: table.adMonitorTarget.targetDailyBudgetCents,
			deviationThresholdPct: table.adMonitorTarget.deviationThresholdPct,
			isActive: table.adMonitorTarget.isActive,
			isMuted: table.adMonitorTarget.isMuted,
			mutedUntil: table.adMonitorTarget.mutedUntil,
			notifyTelegram: table.adMonitorTarget.notifyTelegram,
			notifyEmail: table.adMonitorTarget.notifyEmail,
			notifyInApp: table.adMonitorTarget.notifyInApp,
			version: table.adMonitorTarget.version,
			updatedAt: table.adMonitorTarget.updatedAt,
			accountName: table.metaAdsAccount.accountName,
			accountId: table.metaAdsAccount.metaAdAccountId
		})
		.from(table.adMonitorTarget)
		.innerJoin(table.client, eq(table.client.id, table.adMonitorTarget.clientId))
		.leftJoin(
			table.metaAdsAccount,
			and(
				eq(table.metaAdsAccount.clientId, table.adMonitorTarget.clientId),
				eq(table.metaAdsAccount.tenantId, locals.tenant.id),
				eq(table.metaAdsAccount.isPrimary, true)
			)
		)
		.where(
			and(
				eq(table.adMonitorTarget.tenantId, locals.tenant.id),
				eq(table.adMonitorTarget.platform, 'meta')
			)
		)
		.orderBy(desc(table.adMonitorTarget.updatedAt));

	// Fetch last 7d snapshots in one query, group in JS
	const campaignIds = targetRows.map((t) => t.externalCampaignId);
	const snapshots =
		campaignIds.length > 0
			? await db
					.select({
						externalCampaignId: table.adMetricSnapshot.externalCampaignId,
						date: table.adMetricSnapshot.date,
						cplCents: table.adMetricSnapshot.cplCents,
						spendCents: table.adMetricSnapshot.spendCents
					})
					.from(table.adMetricSnapshot)
					.where(
						and(
							eq(table.adMetricSnapshot.tenantId, locals.tenant.id),
							gte(table.adMetricSnapshot.date, since7)
						)
					)
			: [];

	const sparkByCampaign = new Map<string, Array<number | null>>();
	const latestByCampaign = new Map<string, number | null>();
	for (const s of snapshots) {
		const arr = sparkByCampaign.get(s.externalCampaignId) ?? [];
		arr.push(s.cplCents);
		sparkByCampaign.set(s.externalCampaignId, arr);
		latestByCampaign.set(s.externalCampaignId, s.cplCents);
	}

	const targets = targetRows.map((t) => ({
		...t,
		spark7d: sparkByCampaign.get(t.externalCampaignId) ?? [],
		latestCplCents: latestByCampaign.get(t.externalCampaignId) ?? null,
		accountId: t.externalAdAccountId ?? t.accountId ?? null
	}));

	const clients = await db
		.select({ id: table.client.id, name: table.client.name })
		.from(table.client)
		.where(eq(table.client.tenantId, locals.tenant.id))
		.orderBy(table.client.name);

	const recommendations = await db
		.select({
			id: table.adOptimizationRecommendation.id,
			clientId: table.adOptimizationRecommendation.clientId,
			clientName: table.client.name,
			externalCampaignId: table.adOptimizationRecommendation.externalCampaignId,
			action: table.adOptimizationRecommendation.action,
			reason: table.adOptimizationRecommendation.reason,
			metricSnapshotJson: table.adOptimizationRecommendation.metricSnapshotJson,
			suggestedPayloadJson: table.adOptimizationRecommendation.suggestedPayloadJson,
			status: table.adOptimizationRecommendation.status,
			source: table.adOptimizationRecommendation.source,
			sourceWorkerId: table.adOptimizationRecommendation.sourceWorkerId,
			createdAt: table.adOptimizationRecommendation.createdAt,
			decidedAt: table.adOptimizationRecommendation.decidedAt,
			appliedAt: table.adOptimizationRecommendation.appliedAt,
			applyError: table.adOptimizationRecommendation.applyError
		})
		.from(table.adOptimizationRecommendation)
		.innerJoin(table.client, eq(table.client.id, table.adOptimizationRecommendation.clientId))
		.where(eq(table.adOptimizationRecommendation.tenantId, locals.tenant.id))
		.orderBy(desc(table.adOptimizationRecommendation.createdAt))
		.limit(50);

	// KPI summary fetched as separate API call from client (avoid bundling)
	const summaryRes = await fetch(`/${params.tenant}/api/ads-monitor/summary`);
	const summary = summaryRes.ok
		? await summaryRes.json()
		: { activeTargets: 0, pendingRecs: 0, spend7dCents: 0, avgCpl30dCents: null, avgTargetCplCents: null };

	return { targets, clients, recommendations, summary, tenantSlug: params.tenant };
};
```

- [ ] **Step 2: Type check**

Run: `cd /Users/augustin598/Projects/CRM/app && bunx tsc --noEmit -p tsconfig.json 2>&1 | grep "monitoring/\+page" | head`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/routes/[tenant]/reports/facebook-ads/monitoring/+page.server.ts
git commit -m "feat(ads-monitor-ui): extended load with ad-account join + 7d sparkline data"
```

---

### Task 3.12: Refactor `+page.svelte` to use new components

**Files:**
- Modify: `src/routes/[tenant]/reports/facebook-ads/monitoring/+page.svelte`

- [ ] **Step 1: Replace page with composition**

Replace the entire file with:

```svelte
<script lang="ts">
	import { Card } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import IconFacebook from '$lib/components/marketing/icon-facebook.svelte';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import TargetIcon from '@lucide/svelte/icons/target';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import LightbulbIcon from '@lucide/svelte/icons/lightbulb';
	import CheckIcon from '@lucide/svelte/icons/check';
	import XIcon from '@lucide/svelte/icons/x';
	import { toast } from 'svelte-sonner';
	import KpiStrip from './components/KpiStrip.svelte';
	import TargetFilters from './components/TargetFilters.svelte';
	import TargetRow from './components/TargetRow.svelte';
	import TargetDrawer from './components/TargetDrawer.svelte';
	import RejectRecModal from './components/RejectRecModal.svelte';
	import AddTargetForm from './components/AddTargetForm.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let targets = $state([...data.targets]);
	let recommendations = $state([...data.recommendations]);
	let runningRebuild = $state(false);
	let approvingId = $state<string | null>(null);
	let drawerTargetId = $state<string | null>(null);
	let drawerOpen = $state(false);
	let rejectRecId = $state<string | null>(null);
	let rejectModalOpen = $state(false);
	let showAddForm = $state(false);

	// Filters
	let filterClientId = $state('');
	let filterStatus = $state<'all' | 'active' | 'muted' | 'inactive'>('all');
	let filterDeviation = $state<'all' | 'over' | 'under' | 'ok'>('all');
	let filterSearch = $state('');

	const pendingRecs = $derived(recommendations.filter((r) => r.status === 'draft'));
	const decidedRecs = $derived(recommendations.filter((r) => r.status !== 'draft'));

	const filteredTargets = $derived(
		targets.filter((t) => {
			if (filterClientId && t.clientId !== filterClientId) return false;
			if (filterStatus === 'active' && (!t.isActive || t.isMuted)) return false;
			if (filterStatus === 'muted' && !t.isMuted) return false;
			if (filterStatus === 'inactive' && t.isActive) return false;
			if (filterSearch) {
				const q = filterSearch.toLowerCase();
				if (!t.clientName.toLowerCase().includes(q) && !t.externalCampaignId.toLowerCase().includes(q))
					return false;
			}
			if (filterDeviation !== 'all' && t.targetCplCents && (t as any).latestCplCents !== null) {
				const ratio = (t as any).latestCplCents / t.targetCplCents;
				if (filterDeviation === 'over' && ratio <= 1.1) return false;
				if (filterDeviation === 'under' && ratio >= 0.9) return false;
				if (filterDeviation === 'ok' && (ratio < 0.9 || ratio > 1.1)) return false;
			}
			return true;
		})
	);

	const ACTION_LABELS: Record<string, string> = {
		pause_ad: '⏸ Pauză campanie',
		resume_ad: '▶️ Reia campanie',
		increase_budget: '📈 Mărește buget',
		decrease_budget: '📉 Scade buget',
		refresh_creative: '🎨 Refresh creative',
		change_audience: '🎯 Schimbă audiență'
	};

	const STATUS_BADGES: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' }> = {
		draft: { label: 'În așteptare', variant: 'default' },
		approved: { label: 'Aprobat', variant: 'secondary' },
		rejected: { label: 'Respins', variant: 'outline' },
		applied: { label: 'Aplicat ✅', variant: 'secondary' },
		failed: { label: 'Eșuat ❌', variant: 'outline' }
	};

	function safeJsonParse(s: string): Record<string, unknown> {
		try { return JSON.parse(s) as Record<string, unknown>; } catch { return {}; }
	}

	async function approveRecommendation(id: string) {
		if (!confirm('Aprobi această recomandare? Acțiunea va fi aplicată imediat pe Meta.')) return;
		approvingId = id;
		try {
			const res = await fetch(`/${data.tenantSlug}/api/ads-monitor/recommendations/${id}/approve`, { method: 'POST' });
			const body = (await res.json()) as { ok: boolean; error?: string };
			if (!body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
			toast.success('Aprobată și aplicată pe Meta.');
			recommendations = recommendations.map((r) =>
				r.id === id ? { ...r, status: 'applied', appliedAt: new Date(), decidedAt: new Date() } : r
			);
		} catch (e) {
			toast.error(`Eroare: ${(e as Error).message}`);
		} finally { approvingId = null; }
	}

	function openReject(id: string) { rejectRecId = id; rejectModalOpen = true; }
	function onRecRejected() {
		if (rejectRecId) {
			recommendations = recommendations.map((r) =>
				r.id === rejectRecId ? { ...r, status: 'rejected', decidedAt: new Date() } : r
			);
		}
		rejectRecId = null;
	}

	function openDrawer(id: string) { drawerTargetId = id; drawerOpen = true; }
	function closeDrawer() { drawerOpen = false; drawerTargetId = null; }

	async function refreshAll() {
		const res = await fetch(`/${data.tenantSlug}/reports/facebook-ads/monitoring`, {
			headers: { 'sec-fetch-mode': 'navigate' }
		});
		// Simpler: full reload
		window.location.reload();
	}

	async function runMonitorNow() {
		if (runningRebuild) return;
		runningRebuild = true;
		try {
			const res = await fetch(`/${data.tenantSlug}/api/_debug-ads-monitor-run`, { method: 'POST' });
			const body = (await res.json().catch(() => null)) as
				| { ok: boolean; result?: { processed: number; alerted: number }; error?: string }
				| null;
			if (!res.ok || !body?.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
			const result = body.result ?? { processed: 0, alerted: 0 };
			toast.success(`Rulat: ${result.processed} target-uri, ${result.alerted} alerte.`);
		} catch (e) {
			toast.error(`Eroare: ${(e as Error).message}`);
		} finally { runningRebuild = false; }
	}
</script>

<svelte:head><title>Monitoring Meta Ads</title></svelte:head>

<div class="container mx-auto p-6 space-y-6">
	<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
		<div>
			<a href="/{data.tenantSlug}/reports/facebook-ads" class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
				<ArrowLeftIcon class="h-4 w-4" /> Înapoi la rapoarte
			</a>
			<h1 class="text-3xl font-bold flex items-center gap-3 mt-2">
				<TargetIcon class="h-7 w-7" /> Monitoring Meta Ads
			</h1>
		</div>
		<div class="flex items-center gap-2">
			<Button onclick={() => (showAddForm = !showAddForm)} variant="default" size="sm">
				<TargetIcon class="h-4 w-4 mr-2" />
				{showAddForm ? 'Închide' : 'Adaugă target'}
			</Button>
			<Button onclick={runMonitorNow} disabled={runningRebuild} variant="outline" size="sm">
				<RefreshCwIcon class="h-4 w-4 mr-2 {runningRebuild ? 'animate-spin' : ''}" /> Rulează acum
			</Button>
		</div>
	</div>

	<KpiStrip summary={data.summary} />

	{#if showAddForm}
		<AddTargetForm
			tenantSlug={data.tenantSlug}
			clients={data.clients}
			onClose={() => (showAddForm = false)}
			onSaved={refreshAll}
		/>
	{/if}

	{#if pendingRecs.length > 0}
		<Card class="p-6 border-amber-500/40 bg-amber-500/5">
			<h2 class="text-xl font-semibold flex items-center gap-2 mb-4">
				<LightbulbIcon class="h-5 w-5 text-amber-500" />
				Recomandări în așteptare ({pendingRecs.length})
			</h2>
			<div class="space-y-3">
				{#each pendingRecs as rec (rec.id)}
					{@const payload = safeJsonParse(rec.suggestedPayloadJson)}
					<div class="rounded-md border bg-background p-4">
						<div class="flex items-start justify-between gap-4">
							<div class="flex-1 min-w-0">
								<div class="flex items-center gap-2 mb-1 flex-wrap">
									<Badge>{ACTION_LABELS[rec.action] ?? rec.action}</Badge>
									<span class="text-sm text-muted-foreground">{rec.clientName}</span>
									<span class="text-xs font-mono text-muted-foreground">{rec.externalCampaignId}</span>
								</div>
								<p class="text-sm">{rec.reason}</p>
								{#if Object.keys(payload).length > 0}
									<details class="mt-2">
										<summary class="text-xs text-muted-foreground cursor-pointer">Payload propus</summary>
										<pre class="text-xs bg-muted/50 rounded p-2 mt-1">{JSON.stringify(payload, null, 2)}</pre>
									</details>
								{/if}
							</div>
							<div class="flex flex-col gap-2 min-w-[120px]">
								<Button size="sm" onclick={() => approveRecommendation(rec.id)} disabled={approvingId === rec.id}>
									<CheckIcon class="h-4 w-4 mr-1" /> {approvingId === rec.id ? 'Aplic…' : 'Aprobă'}
								</Button>
								<Button size="sm" variant="outline" onclick={() => openReject(rec.id)}>
									<XIcon class="h-4 w-4 mr-1" /> Respinge
								</Button>
							</div>
						</div>
					</div>
				{/each}
			</div>
		</Card>
	{/if}

	<Card class="p-6">
		<div class="flex items-center justify-between mb-4">
			<h2 class="text-xl font-semibold flex items-center gap-2">
				<IconFacebook class="h-5 w-5" /> Target-uri ({filteredTargets.length}/{targets.length})
			</h2>
		</div>
		<div class="mb-3">
			<TargetFilters
				clients={data.clients}
				bind:clientId={filterClientId}
				bind:status={filterStatus}
				bind:deviation={filterDeviation}
				bind:search={filterSearch}
				onChange={() => {}}
			/>
		</div>

		{#if filteredTargets.length === 0}
			<div class="text-center py-12 text-muted-foreground">
				<TargetIcon class="h-12 w-12 mx-auto mb-3 opacity-50" />
				<p>Niciun target nu se potrivește filtrelor.</p>
			</div>
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead class="border-b bg-muted/40">
						<tr class="text-left">
							<th class="px-3 py-2">Client</th>
							<th class="px-3 py-2">Ad Account</th>
							<th class="px-3 py-2">Campanie</th>
							<th class="px-3 py-2 text-right">CPL / Target</th>
							<th class="px-3 py-2">7d</th>
							<th class="px-3 py-2">Stare</th>
						</tr>
					</thead>
					<tbody>
						{#each filteredTargets as target (target.id)}
							<TargetRow {target} onSelect={openDrawer} />
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</Card>

	{#if decidedRecs.length > 0}
		<Card class="p-6">
			<h2 class="text-xl font-semibold mb-4">Istoric recomandări</h2>
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead class="border-b bg-muted/40">
						<tr class="text-left">
							<th class="px-3 py-2">Data</th>
							<th class="px-3 py-2">Client</th>
							<th class="px-3 py-2">Acțiune</th>
							<th class="px-3 py-2">Stare</th>
						</tr>
					</thead>
					<tbody>
						{#each decidedRecs as rec (rec.id)}
							{@const badge = STATUS_BADGES[rec.status] ?? STATUS_BADGES.draft}
							<tr class="border-b">
								<td class="px-3 py-2 text-xs text-muted-foreground">{new Date(rec.createdAt).toLocaleDateString('ro-RO')}</td>
								<td class="px-3 py-2">{rec.clientName}</td>
								<td class="px-3 py-2">{ACTION_LABELS[rec.action] ?? rec.action}</td>
								<td class="px-3 py-2"><Badge variant={badge.variant} class="text-xs">{badge.label}</Badge></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</Card>
	{/if}
</div>

<TargetDrawer
	bind:open={drawerOpen}
	targetId={drawerTargetId}
	tenantSlug={data.tenantSlug}
	onClose={closeDrawer}
	onUpdated={refreshAll}
/>

<RejectRecModal
	bind:open={rejectModalOpen}
	recId={rejectRecId}
	tenantSlug={data.tenantSlug}
	onClose={() => (rejectModalOpen = false)}
	onRejected={onRecRejected}
/>
```

- [ ] **Step 2: Type check**

Run: `cd /Users/augustin598/Projects/CRM/app && bunx tsc --noEmit -p tsconfig.json 2>&1 | grep "monitoring/\+page" | head`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/routes/[tenant]/reports/facebook-ads/monitoring/+page.svelte
git commit -m "feat(ads-monitor-ui): refactor page into composable components + drawer"
```

---

### Task 3.13: Create `AddTargetForm.svelte` (extracted with campaign picker)

**Files:**
- Create: `src/routes/[tenant]/reports/facebook-ads/monitoring/components/AddTargetForm.svelte`

- [ ] **Step 1: Implement extracted form with campaign picker**

```svelte
<script lang="ts">
	import { Card } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { toast } from 'svelte-sonner';

	interface Client { id: string; name: string }
	interface Props {
		tenantSlug: string;
		clients: Client[];
		onClose: () => void;
		onSaved: () => void;
	}
	let { tenantSlug, clients, onClose, onSaved }: Props = $props();

	let clientId = $state('');
	let campaignOptions = $state<Array<{ id: string; externalCampaignId: string; name: string }>>([]);
	let campaignId = $state(''); // free text fallback
	let useFreeText = $state(false);
	let objective = $state('OUTCOME_LEADS');
	let cpl = $state(''); let cpa = $state(''); let roas = $state(''); let ctr = $state('');
	let dailyBudget = $state(''); let threshold = $state('20');
	let notifyTelegram = $state(true); let notifyEmail = $state(true);
	let saving = $state(false);

	$effect(() => {
		if (clientId) {
			fetch(`/${tenantSlug}/api/campaigns?clientId=${clientId}&platform=meta&status=active,pending_approval`)
				.then((r) => r.json())
				.then((d) => { campaignOptions = d.items ?? []; })
				.catch(() => { campaignOptions = []; });
		} else {
			campaignOptions = [];
		}
	});

	const ronToCents = (v: string): number | null => {
		const t = v.trim(); if (!t) return null;
		const n = parseFloat(t); return isFinite(n) ? Math.round(n * 100) : null;
	};
	const numOrNull = (v: string): number | null => {
		const t = v.trim(); if (!t) return null;
		const n = parseFloat(t); return isFinite(n) ? n : null;
	};

	async function save() {
		const finalCampaignId = useFreeText ? campaignId.trim() : campaignId;
		if (!clientId || !finalCampaignId || !objective) {
			toast.error('Completează clientul, ID-ul campaniei și obiectivul');
			return;
		}
		saving = true;
		try {
			const res = await fetch(`/${tenantSlug}/api/ads-monitor/targets`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					clientId, externalCampaignId: finalCampaignId, objective,
					targetCplCents: ronToCents(cpl), targetCpaCents: ronToCents(cpa),
					targetRoas: numOrNull(roas), targetCtr: numOrNull(ctr),
					targetDailyBudgetCents: ronToCents(dailyBudget),
					deviationThresholdPct: parseInt(threshold, 10) || 20,
					notifyTelegram, notifyEmail, notifyInApp: true
				})
			});
			if (!res.ok) throw new Error(await res.text());
			toast.success('Target salvat.');
			onSaved();
			onClose();
		} catch (e) {
			toast.error(`Eroare: ${(e as Error).message}`);
		} finally { saving = false; }
	}
</script>

<Card class="p-6 border-primary/40">
	<h2 class="text-lg font-semibold mb-4">Target nou</h2>
	<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
		<label class="flex flex-col gap-1 text-sm">
			Client *
			<select bind:value={clientId} class="h-9 rounded-md border px-3 bg-background">
				<option value="">Alege…</option>
				{#each clients as c}<option value={c.id}>{c.name}</option>{/each}
			</select>
		</label>
		<label class="flex flex-col gap-1 text-sm sm:col-span-2">
			Campanie *
			{#if campaignOptions.length > 0 && !useFreeText}
				<select bind:value={campaignId} class="h-9 rounded-md border px-3 bg-background">
					<option value="">Alege campanie…</option>
					{#each campaignOptions as c}
						<option value={c.externalCampaignId}>{c.name} ({c.externalCampaignId})</option>
					{/each}
				</select>
				<button type="button" class="text-xs text-primary text-left" onclick={() => (useFreeText = true)}>
					sau introdu ID manual
				</button>
			{:else}
				<input bind:value={campaignId} placeholder="ex: 23854761234567890" class="h-9 rounded-md border px-3 font-mono text-xs bg-background" />
				{#if campaignOptions.length > 0}
					<button type="button" class="text-xs text-primary text-left" onclick={() => (useFreeText = false)}>
						revino la dropdown
					</button>
				{/if}
			{/if}
		</label>
		<label class="flex flex-col gap-1 text-sm">
			Obiectiv *
			<select bind:value={objective} class="h-9 rounded-md border px-3 bg-background">
				<option value="OUTCOME_LEADS">OUTCOME_LEADS</option>
				<option value="OUTCOME_SALES">OUTCOME_SALES</option>
				<option value="OUTCOME_TRAFFIC">OUTCOME_TRAFFIC</option>
				<option value="OUTCOME_AWARENESS">OUTCOME_AWARENESS</option>
				<option value="OUTCOME_ENGAGEMENT">OUTCOME_ENGAGEMENT</option>
				<option value="OUTCOME_APP_PROMOTION">OUTCOME_APP_PROMOTION</option>
			</select>
		</label>
		<label class="flex flex-col gap-1 text-sm">CPL țintă (RON)
			<input bind:value={cpl} type="number" step="0.01" class="h-9 rounded-md border px-3 bg-background" />
		</label>
		<label class="flex flex-col gap-1 text-sm">CPA țintă (RON)
			<input bind:value={cpa} type="number" step="0.01" class="h-9 rounded-md border px-3 bg-background" />
		</label>
		<label class="flex flex-col gap-1 text-sm">ROAS țintă
			<input bind:value={roas} type="number" step="0.1" class="h-9 rounded-md border px-3 bg-background" />
		</label>
		<label class="flex flex-col gap-1 text-sm">CTR țintă (zecimal)
			<input bind:value={ctr} type="number" step="0.001" class="h-9 rounded-md border px-3 bg-background" />
		</label>
		<label class="flex flex-col gap-1 text-sm">Buget zilnic (RON)
			<input bind:value={dailyBudget} type="number" step="0.01" class="h-9 rounded-md border px-3 bg-background" />
		</label>
		<label class="flex flex-col gap-1 text-sm">Prag deviație (%)
			<input bind:value={threshold} type="number" min="5" max="100" class="h-9 rounded-md border px-3 bg-background" />
		</label>
	</div>
	<div class="flex flex-wrap gap-4 mt-4">
		<label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={notifyTelegram} /> Telegram</label>
		<label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={notifyEmail} /> Email</label>
	</div>
	<div class="flex justify-end gap-2 mt-4">
		<Button variant="outline" size="sm" onclick={onClose}>Anulează</Button>
		<Button onclick={save} disabled={saving} size="sm">{saving ? 'Se salvează…' : 'Salvează'}</Button>
	</div>
</Card>
```

- [ ] **Step 2: Note: `/api/campaigns?...` endpoint may not exist yet**

Verify: `ls src/routes/[tenant]/api/campaigns/` — if no GET endpoint exists, the picker will silently fail (campaignOptions stays empty, falls back to free text). That's acceptable for v1; campaign picker is nice-to-have.

- [ ] **Step 3: Commit**

```bash
git add src/routes/[tenant]/reports/facebook-ads/monitoring/components/AddTargetForm.svelte
git commit -m "feat(ads-monitor-ui): AddTargetForm extracted with campaign picker"
```

---

### Task 3.14: PR3 final smoke test

- [ ] **Step 1: Type check**

```bash
cd /Users/augustin598/Projects/CRM/app && bunx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "(error|Error)" | head -10
```
Expected: no errors.

- [ ] **Step 2: Browser smoke**

Start dev server: `cd /Users/augustin598/Projects/CRM/app && bun run dev`

Visit `/<tenant>/reports/facebook-ads/monitoring`. Verify:
- [ ] KPI strip renders with 4 cards
- [ ] Filters work (client / status / deviation / search)
- [ ] Table shows ad-account column with name+id, or "(neasignat)" badge
- [ ] Sparklines render in last column
- [ ] Click on row → drawer opens with 4 tabs
- [ ] Performance tab loads sparklines + 30d aggregates
- [ ] Edit tab can change CPL → success toast → page refreshes
- [ ] Edit tab with concurrently-modified version → shows "modificat între timp" toast
- [ ] Overrides tab can suppress an action; warns when all 6 suppressed
- [ ] History tab shows audit timeline with diff display
- [ ] Drawer footer shows "Ultima modificare" line
- [ ] Pending recommendation: click "Respinge" → reject modal with structured reasons → submit → DB row in `ad_recommendation_feedback`
- [ ] Add target form works end-to-end

- [ ] **Step 3: Push branch**

User pushes branch and opens PR3.

---

# Self-Review

**Spec coverage:**

| Spec section | Tasks |
|---|---|
| §4.1 New columns on adMonitorTarget | 1.1 |
| §4.2 adMonitorTargetAudit | 1.2 |
| §4.3 adRecommendationFeedback | 1.3 |
| §4.4 Migrations | 1.4 |
| §5.1-5.5 UI architecture | 3.1–3.13 |
| §6.1 New internal endpoints | 2.3, 2.4, 2.5 |
| §6.2 Modified internal endpoints | 2.1, 2.2, 2.6 |
| §6.3 New external endpoints | 2.7, 2.8 |
| §6.4 Page load query | 3.11 |
| §7.1 PersonalOPS handler | 2.14 |
| §7.2 decision-engine | 2.11 |
| §7.3 Auto-suppress + TTL | 2.8, 2.9 |
| §7.4 Failure modes | 2.14 (try/catch) |
| §8 Multi-tenant security | All endpoints filter by tenant.id |
| §9 Validation rules | 2.2 (numeric bounds + enum + JSON array) |
| §10 Edge cases | 3.4 (no ad account), 3.6 (no snapshots), 3.8 (all suppressed warn) |
| §11.1 Unit tests decision-engine | 2.12 |
| §11.2 Integration tests | 2.16 (manual smoke), 1.5/1.7 unit |
| §11.3 Smoke tests UI | 3.14 |
| §11.4 Worker tests | 2.15 |
| §12 Accessibility | 3.5 (role/aria), 3.1 (aria-label sparkline) |
| §13 Rollout 3 PRs | Plan structure mirrors |

**Placeholder scan:** No "TBD/TODO" remain. Every code step contains the actual code.

**Type consistency:** `version`, `expectedVersion`, `suppressedActions` (always JSON array in API, string-typed column in DB), `auditNote`, `metadata` shape — consistent across PR1/PR2/PR3.

---

# Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-30-facebook-ads-monitoring-redesign.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
