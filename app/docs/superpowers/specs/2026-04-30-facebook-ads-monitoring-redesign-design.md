# Facebook Ads Monitoring — Redesign & Worker Training Loop

**Status:** approved (brainstorming) → pending writing-plans
**Author:** assistant @ session 2026-04-30
**Affected pages:** `/ots/reports/facebook-ads/monitoring`
**Affected workers:** `ads-optimizer` in PersonalOPS
**Repos touched:** `CRM/app` (primary), `PersonalOPS` (worker integration)

---

## 1. Problem statement

The current monitoring page is functional but minimal:

- Shows client name but **not the Meta ad account name/ID** the campaign belongs to.
- **No way to edit a target** after creation — only mute/unmute/delete. Forces delete + recreate to change a CPL/budget target.
- **No modification history** — when CPL target was changed from 30 to 25, who/when/why is lost.
- **No way to "train" the worker** to respect human judgment (e.g., suppress `increase_budget` for a campaign with fixed budget; ignore `pause_ad` for brand campaigns).
- No live performance context (current CPL vs target, last snapshot date, sparkline trend).
- No filters (by client, status, deviation level).
- KPIs not surfaced (total active, pending recs, weekly spend).

The user's request, summarized: redesign the page so it surfaces missing context (ad account name, history, performance), exposes per-target overrides for the worker, and persists human-edit signals so the optimizer worker can become smarter over time without going to ML.

## 2. Goals & non-goals

**Goals**
- Surface ad account name/ID alongside client.
- Inline editing of all target fields (CPL/CPA/ROAS/CTR/budget/threshold/notify flags/notes), with optional `auditNote`.
- Modification history per target (immutable audit trail).
- Per-target worker overrides (cooldown, suppressed actions, severity override, min conversions).
- Recommendation rejection feedback signals → auto-suppress repeatedly-rejected actions.
- Live performance context: 7d sparklines, 30d aggregates, last snapshot.
- Filters: client / status / deviation, plus search.
- KPI strip at top.
- Single-page UX with a side drawer for per-target detail.

**Non-goals**
- ML / probabilistic recommendation models.
- Bulk operations on multiple recommendations.
- Real-time websocket notifications.
- PDF export of history.
- Side-by-side target comparison.

## 3. Approach

Single-page redesign with collapsible side drawer (480px) per target row. Drawer has 4 tabs: Performance / Edit target / Overrides / Istoric.

The "training" loop is **deterministic**, not ML:
- Every user edit creates an audit row with structured `changesJson` diff.
- Every recommendation rejection captures a structured reason + free-form note.
- Worker reads recent rejection rate per `(action, clientId)` before deciding; >50% → auto-suppress with audit row.
- Per-target overrides (cooldown, suppressed actions, severity, min conversions) are first-class fields the decision engine reads.

## 4. Data model

### 4.1 New columns on `adMonitorTarget`

```ts
externalAdAccountId: text('external_ad_account_id'),         // 'act_XXX' denormalized at create-time
notes: text('notes'),                                         // user-facing free notes (max 500 char)
customCooldownHours: integer('custom_cooldown_hours'),        // null = use default 72
suppressedActions: text('suppressed_actions'),                // CSV of AdRecommendationAction values, ordered alphabetically
severityOverride: text('severity_override'),                  // 'urgent'|'high'|'warning'|'opportunity' or null
minConversionsThreshold: integer('min_conversions_threshold'), // null = use default 5
```

All nullable → backwards compatible. Existing rows get all NULLs and continue to behave with default rules.

### 4.2 New table `adMonitorTargetAudit`

```ts
id: text primaryKey,
tenantId: text NOT NULL → tenant.id,
targetId: text NOT NULL → adMonitorTarget.id ON DELETE CASCADE,
actorType: text NOT NULL,    // 'user' | 'worker' | 'system'
actorId: text NOT NULL,      // user.id, worker_id string, or 'system'
action: text NOT NULL,       // 'created'|'updated'|'muted'|'unmuted'|'deactivated'|'reactivated'
changesJson: text NOT NULL DEFAULT '{}',  // {field: {from, to}} structured diff
note: text,                                // free-form, max 200 char
at: timestamp NOT NULL DEFAULT current_timestamp

INDEX (targetId, at DESC)
INDEX (tenantId, at DESC)
```

### 4.3 New table `adRecommendationFeedback`

```ts
id: text primaryKey,
tenantId: text NOT NULL → tenant.id,
recommendationId: text NOT NULL → adOptimizationRecommendation.id ON DELETE CASCADE,
userId: text → user.id,
rejectionReason: text NOT NULL,  // 'false_positive'|'wrong_action'|'bad_timing'|'manually_handled'|'other'
note: text,                       // free-form, max 200 char
at: timestamp NOT NULL DEFAULT current_timestamp

INDEX (recommendationId)
INDEX (tenantId, at DESC)
```

### 4.4 Migrations

Three migrations in `drizzle/`:

1. `XXXX_alter_ad_monitor_target_overrides.sql` — ALTER TABLE adding 6 nullable columns
2. `XXXX_create_ad_monitor_target_audit.sql` — CREATE TABLE + indexes
3. `XXXX_create_ad_recommendation_feedback.sql` — CREATE TABLE + indexes

Backfill: none required. Existing targets get NULL overrides (= default behavior). Existing recommendations get no feedback rows.

### 4.5 Type exports

```ts
export type AdMonitorTargetAudit = typeof adMonitorTargetAudit.$inferSelect;
export type NewAdMonitorTargetAudit = typeof adMonitorTargetAudit.$inferInsert;
export type AdRecommendationFeedback = typeof adRecommendationFeedback.$inferSelect;
export type NewAdRecommendationFeedback = typeof adRecommendationFeedback.$inferInsert;

export const AD_AUDIT_ACTOR_TYPES = ['user','worker','system'] as const;
export const AD_AUDIT_ACTIONS = ['created','updated','muted','unmuted','deactivated','reactivated'] as const;
export const AD_REJECTION_REASONS = ['false_positive','wrong_action','bad_timing','manually_handled','other'] as const;
```

## 5. UI architecture

### 5.1 Page layout

```
[Back link]
Monitoring Meta Ads                                  [Adaugă target] [Rulează acum]
─────────────────────────────────────────────────────────────────────────
KPI strip: 4 cards (active count | pending recs | spend 7d | avg CPL vs target)

Filters: [Client ▾] [Status ▾] [Deviation ▾] [Search…]

⚠ Recomandări în așteptare (n)  — existing card
   {existing per-rec block}

Target-uri active (n)
┌──────────────────────────────────────────────────────────────────┐
│ Client | Ad Account | Campaign | CPL/Target | 7d ▂▃▅ | Status   │
└──────────────────────────────────────────────────────────────────┘
                          ↑ click row → side drawer

Istoric recomandări (decise)  — existing table
```

### 5.2 Component tree

```
src/routes/[tenant]/reports/facebook-ads/monitoring/
  +page.server.ts              (extended load query)
  +page.svelte                 (orchestrates sub-components)
  components/
    KpiStrip.svelte
    TargetFilters.svelte
    TargetRow.svelte
    Sparkline.svelte           (pure SVG, 60×16px, no deps)
    TargetDrawer.svelte        (Sheet from UI lib, 4 tabs)
    drawer/
      PerformanceTab.svelte
      EditTargetTab.svelte
      OverridesTab.svelte
      HistoryTab.svelte
    RejectRecModal.svelte
    AddTargetForm.svelte
```

### 5.3 Drawer tabs spec

**Performance** — fetches `/api/ads-monitor/snapshots?campaignId=...&days=30` on drawer open. Renders:
- 7d row: 4 sparklines (CPL / spend / conversions / CTR) with delta vs target where applicable
- 30d aggregate: avg CPL vs target with Δ%, total spend, conversions, ROAS
- Last snapshot timestamp + maturity badge

**Edit target** — form prepopulated from target. Submit → PATCH with optional `auditNote`. Read-only: `objective`, `externalCampaignId`, `externalAdsetId`. Editable: CPL/CPA/ROAS/CTR/budget/threshold/notify*/notes.

**Overrides** — form for the 4 override fields. "Suprimă acțiuni" is a 6-checkbox group (one per `AdRecommendationAction`). If all 6 are checked, show inline warning + confirm modal on save.

**Istoric** — paginated audit list (20 per page). Each row: timestamp (ro-RO format), actor name, action badge, structured diff rendered field-by-field, optional note. Filter dropdown for action type. Optional CSV export (nice-to-have).

### 5.4 KPI strip data source

Single endpoint `GET /api/ads-monitor/summary` returning:

```json
{
  "activeTargets": 12,
  "pendingRecs": 3,
  "spend7dCents": 234500,
  "avgCpl30dCents": 2820,
  "avgTargetCplCents": 3000
}
```

Computed by aggregating `adMetricSnapshot` last 30 days × active targets, joined with target CPL targets.

### 5.5 Add target form — campaign picker

Replace free-text campaign-ID input with a dropdown sourced from `campaign` table for the chosen client (filter `clientId, platform='meta', status IN ('active','pending_approval')`). Falls back to free text if no matching campaigns. Reduces typo errors.

## 6. Server endpoints

### 6.1 New (internal, tenant-scoped)

```
GET    /[tenant]/api/ads-monitor/targets/[id]
GET    /[tenant]/api/ads-monitor/targets/[id]/audit?limit=20&offset=0
GET    /[tenant]/api/ads-monitor/summary
```

### 6.2 Modified (internal)

**`PATCH /api/ads-monitor/targets/[id]`** — accept new fields:
- `notes`, `customCooldownHours`, `suppressedActions` (array, server serializes to CSV), `severityOverride`, `minConversionsThreshold`
- `auditNote` (max 200 char)

Behavior: load current target, compute structured diff vs body, write target update + audit row in a single transaction. Skip audit row if no actual changes (no-op patch).

**`POST /api/ads-monitor/targets`** — extended:
- Resolve `externalAdAccountId` from `metaAdsAccount` (clientId + isPrimary=true) when not provided in body.
- Insert audit row `'created'` with `changesJson` containing the initial values.

**`POST /api/ads-monitor/recommendations/[id]/reject`** — accept body `{ reason?, note? }`. If `reason` is provided, write a row in `adRecommendationFeedback`.

### 6.3 New (external, worker-facing)

`/api/external/ads-monitor/targets/[id]` extended with `?withOverrides=true` query param. When true, response includes:

```json
{
  ...existingTargetFields,
  "overrides": {
    "customCooldownHours": 24,
    "suppressedActions": ["increase_budget"],
    "severityOverride": null,
    "minConversionsThreshold": 5
  },
  "feedback": {
    "rejectionRateLast30d": {
      "pause_ad": 0.0,
      "increase_budget": 0.6,
      ...
    }
  }
}
```

### 6.4 Page load query

`+page.server.ts` `load()` does a single SELECT with:
- LEFT JOIN `metaAdsAccount` ON `(clientId AND isPrimary=true)` → `accountName`, `metaAdAccountId` (fallback if `target.externalAdAccountId` is null)
- LEFT JOIN aggregated subquery for last 7d snapshots per `(externalCampaignId)` → 7d sparkline data points + last snapshot summary
- LEFT JOIN count of pending recs per target

## 7. Worker integration

### 7.1 PersonalOPS `ads-optimizer/handler.ts`

Before calling `decideAction()`, fetch overrides via `adsCrmClient.getTargetWithOverrides(targetId)`. Compute `recentRejectionRate` for `(action, clientId)` from the feedback aggregate.

Pass overrides into `DecideInput`:

```ts
interface DecideInput {
  // existing fields
  customCooldownHours?: number | null;
  suppressedActions?: string[];
  severityOverride?: 'urgent'|'high'|'warning'|'opportunity' | null;
  minConversionsThreshold?: number | null;
  recentRejectionRates?: Partial<Record<AdAction, number>>;
}
```

### 7.2 `ads-optimizer/decision-engine.ts` changes

Inject overrides at the top of `decideAction`:

```ts
const cooldownMs = (input.customCooldownHours ?? 72) * 3600_000;
const minConv = input.minConversionsThreshold ?? 5;
const suppressed = new Set(input.suppressedActions ?? []);
const rejectionRates = input.recentRejectionRates ?? {};

// After determining action but before returning skip:false:
if (suppressed.has(action)) return { skip: true, skipReason: 'action_suppressed_by_user' };
if ((rejectionRates[action] ?? 0) > 0.5) return { skip: true, skipReason: 'high_rejection_rate_auto_suppress' };

// Severity returned: input.severityOverride ?? computedSeverity
```

Use `cooldownMs` instead of constant `COOLDOWN_MS`. Use `minConv` instead of constant `5` in `s.conversions < 5`.

### 7.3 Worker auto-suppress audit

When the handler observes `rejectionRate > 0.5` AND the action isn't already in `suppressedActions`, write an audit row via the external CRM API:

```
POST /api/external/ads-monitor/targets/[id]/auto-suppress
{ action: 'increase_budget', reason: 'rejection_rate_0.6_in_5_recs' }
```

Server-side: append action to `suppressedActions` CSV + insert audit row with `actorType='worker'`, `actorId='ads_optimizer'`, `action='updated'`, `note='Auto-suppress: rata respingere 60% pe ultimele 5 propuneri'`.

### 7.4 Failure modes

If `getTargetWithOverrides` fails (network/404/500), the worker falls back to default rules (no overrides) and logs a warning. Never blocks the cron.

## 8. Multi-tenant & security

- Every query and mutation includes `tenantId = locals.tenant.id` in WHERE.
- Audit/feedback writes verify the parent record's `tenantId` matches before insert.
- External API uses existing `apiKey.tenantId` middleware; new auto-suppress endpoint requires scope `ads_monitor:write`.
- No role gating beyond authenticated user-in-tenant (same as today).

## 9. Validation rules

| Field | Rule |
|---|---|
| `customCooldownHours` | int, 1..720 |
| `minConversionsThreshold` | int, 0..100 |
| `severityOverride` | one of `urgent`/`high`/`warning`/`opportunity` or null |
| `suppressedActions` | array of strings, each in `AD_RECOMMENDATION_ACTIONS`; serialized as CSV ordered alphabetically (idempotent diff) |
| `notes` | string ≤ 500 char (server trim) |
| `auditNote` | string ≤ 200 char |
| `rejectionReason` | one of `AD_REJECTION_REASONS` |

400 on any violation with field-specific message.

## 10. Edge cases

| Case | Behavior |
|---|---|
| Client has no primary `metaAdsAccount` | Show `act_? (neasignat)` with gray badge + tooltip pointing to client settings |
| Target has no snapshots yet | Performance tab shows empty state copy with hint to run snapshots-fetcher |
| Target `isActive=false` | Row dimmed (30% opacity) + `Inactiv` badge; drawer offers reactivate toggle |
| Audit empty (just created) | History tab shows only the `created` row |
| Concurrent worker + user update | Last-write-wins; both audit rows persist |
| All 6 actions suppressed | Inline warning + confirm modal on save |
| Pending rec exists when editing target | Toast warning "Există N recomandări pending — verifică-le înainte" |
| `getTargetWithOverrides` 404 (deploy lag) | Worker falls back to default rules + warns |

## 11. Testing strategy

### 11.1 Unit (Vitest, decision-engine)

Existing tests stay green (overrides are optional). Add:

1. `customCooldownHours=24` respected vs default 72 (cooldown skip kicks in earlier)
2. `suppressedActions` includes 'pause_ad' → skip with `action_suppressed_by_user`
3. `severityOverride='urgent'` propagates to result
4. `minConversionsThreshold=10` blocks when `s.conversions=8`
5. `recentRejectionRates['increase_budget']=0.6` → skip with `high_rejection_rate_auto_suppress`
6. All overrides null → behavior identical to existing tests (regression)

Plus pure-function tests for the diff builder used in PATCH.

### 11.2 Integration (DB)

- POST target → audit row `created` inserted with `changesJson` containing initial values
- PATCH CPL 30→25 → audit row `updated` with `changesJson.targetCplCents = {from: 3000, to: 2500}`
- Reject rec with `reason='false_positive'` → feedback row inserted
- Tenant A user cannot read/edit tenant B target (404)
- No-op PATCH (same values) → no audit row

### 11.3 Smoke (manual)

Browser test on `/ots/reports/facebook-ads/monitoring` against a tenant with seed data:
- KPI strip populated
- Click row → drawer opens with 4 tabs and correct data
- Edit CPL with `auditNote` → toast success + reload + appears in History
- Suppress all 6 actions → confirm modal → save persists
- Reject rec with reason → feedback row visible in DB
- Filter by client → table updates without reload

### 11.4 Worker (PersonalOPS)

- Mock `getTargetWithOverrides` returning various override shapes; assert `decideAction` honors them
- Failure of `getTargetWithOverrides` → falls back to default rules
- Auto-suppress endpoint POST → CRM audit row created

## 12. Accessibility

- Drawer: `role="dialog"`, focus trap, ESC closes
- Sparkline: `aria-label="CPL ultimele 7 zile, tendință {up|down|stable}"`
- Table rows with open drawer: `aria-expanded="true"`
- Drawer tabs: keyboard arrow navigation
- All form fields have associated `<label>`
- Color-coded badges include text label (not color-only)

## 13. Rollout plan

1. Land migrations (schema + 2 new tables) behind no flag — additive only.
2. Land server endpoints + extended PATCH — kept backwards compatible.
3. Land Svelte UI in same PR (or sibling PR if too large).
4. Deploy worker changes (PersonalOPS) **after** CRM is live, since worker reads new endpoints.
5. No data backfill required.

## 14. Open questions

None at brainstorming close. To revisit during writing-plans:
- Exact UI library for Sheet/drawer (already used elsewhere — confirm import path).
- CSV export for history: include in v1 or defer? Default: defer, mark as optional in plan.
- Whether to also expose feedback aggregate stats in UI (e.g., "this rule has 60% rejection rate") — defer to v2.
