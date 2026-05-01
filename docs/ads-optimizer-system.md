# OTS Ads Optimization System — Complete Reference
> Document creat după Sprint 1 (mai 2026). Sursa de adevăr pentru workflow ads optimization end-to-end.

## 1. Overview
Sistem advisory-only de optimizare Meta Ads:
- CRM (production, always-on) — orchestrator + apply layer + UI
- PersonalOPS (local Mac) — decision engine + worker dispatch

User flow: cron CRM creează tasks → PersonalOPS poller procesează → drafts în CRM → user approves manual → CRM aplică pe Meta.

## 2. Arhitectura

### 2.1 Diagrama componente
```
┌────────────────────────────────────────────────────────────────────┐
│ CRM (clients.onetopsolution.ro)                                   │
│  ├── BullMQ Cron Schedulers                                       │
│  │     ├── ads-performance-monitor (07:00 RO daily)               │
│  │     ├── ads-status-monitor (hourly)                            │
│  │     ├── ads-snapshot-retention (daily)                         │
│  │     ├── ads-optimization-task-creator (07:30 RO daily)         │
│  │     └── ads-optimization-task-reaper (02:00 RO daily)          │
│  ├── External API endpoints (X-API-Key auth)                      │
│  │     ├── /api/external/ads-monitor/{targets,deviations,...}     │
│  │     ├── /api/external/ads-optimization-tasks/...               │
│  │     ├── /api/external/telegram/link-from-bot                   │
│  │     └── /api/external/campaigns/...                            │
│  ├── DB tables (Turso)                                            │
│  │     ├── ad_monitor_target                                      │
│  │     ├── ad_metric_snapshot (90d retention)                     │
│  │     ├── ad_optimization_recommendation                         │
│  │     ├── ad_optimization_task                                   │
│  │     ├── ad_recommendation_feedback                             │
│  │     ├── ad_monitor_target_audit                                │
│  │     └── user_telegram_link                                     │
│  └── Apply layer                                                  │
│        └── apply-recommendation.ts (CBO/ABO routing)              │
└────────────────────────────────────────────────────────────────────┘
                                ↑↓
┌────────────────────────────────────────────────────────────────────┐
│ PersonalOPS (local)                                               │
│  ├── Worker registry                                              │
│  │     └── ads_optimizer (kind)                                   │
│  ├── Cron Schedulers                                              │
│  │     └── ads-optimizer-poller (00:05 + 12:05 RO + catch-up)     │
│  ├── Decision engine (deterministic rules)                        │
│  │     ├── Pause Emergency                                        │
│  │     ├── Aggregate CPL Over (priority 1)                        │
│  │     ├── Dry Spell (priority 2)                                 │
│  │     ├── Refresh Creative (warning)                             │
│  │     └── Increase Budget (opportunity)                          │
│  ├── Telegram                                                     │
│  │     └── Piticu /start <code> → CRM forwarding                  │
│  └── MCP Tool                                                     │
│        └── spawn_ads_optimizer (manual trigger)                   │
└────────────────────────────────────────────────────────────────────┘
```

### 2.2 Flow zilnic (production)
1. **07:30 RO** CRM cron creează task per target activ (UNIQUE constraint per zi → idempotent)
2. **02:00 RO** CRM cron revertează tasks `claimed > 1h` → pending (reaper)
3. **00:05 / 12:05 RO + startup catch-up** PersonalOPS poller polls pending tasks
4. **Per task** PersonalOPS:
   - POST /claim → atomic UPDATE pending → claimed
   - Spawn ads_optimizer worker cu taskId
   - Worker execută decision engine pe target singur
   - PATCH /tasks/:id status=done|failed cu result
5. **La finalul poller-ului** Telegram digest agregat
6. **User în CRM UI** primește draft → approve/reject manual
7. **Approve →** CRM apply-recommendation (ABO/CBO detection) → Meta API

## 3. Decision Engine

### 3.1 Reguli + priorități (post-Sprint 1)
Action priority (highest wins on conflict):
| Priority | Action | Severity | Trigger |
|---|---|---|---|
| 1 | pause_ad | urgent | CPL > target*1.5 + spend > 3*target + conv=0 + 2 zile |
| 2 | decrease_budget | high | CPL_30d > target*1.25 + conv30d ≥ 5 |
| 3 | refresh_creative | urgent (dry spell) / warning (CTR) | Dry spell 5+ zile sau CTR<0.6*target |
| 4 | change_audience | warning | Manual close, advisory only |
| 5 | increase_budget | opportunity | CPL_30d < target*0.7 + ROAS ok |

### 3.2 Gates (skip absolute)
- maturity == 'learning' → skip learning_phase
- conversions7d < 5 → skip insufficient_conversions (excepție: pause emergency dacă conv=0 + spend mare)
- hasOpenRec on campaign → skip
- cooldown < 72h after applied → skip
- suppressedActions includes proposed action → fall through (nu skip definitiv)
- recentRejectionRates[action] > 0.5 → fall through
- cumulativeBudgetDelta14dPct ≤ -50% pentru decrease_budget → skip cumulative_decrease_limit_hit
- cumulativeBudgetDelta14dPct ≥ +50% pentru increase_budget → skip cumulative_increase_limit_hit

### 3.3 Fall-through logic (Sprint 1)
Când o acțiune e gated (suppressed/rejection_rate/cumulative), engine-ul evaluează regula următoare în ordine de priority. Dacă nicio regulă nu trece gate → return skip cu reason `all_matching_actions_gated`.

## 4. Apply Layer (Sprint 1)

### 4.1 ABO/CBO detection
```ts
// CRM apply-recommendation.ts
const campaignInfo = await getCampaignWithAdsets(rec.externalCampaignId);
const isCBO = campaignInfo.daily_budget != null;

if (isCBO) {
  // POST campaign daily_budget direct
} else {
  // ABO — fetch active adsets, decide strategy:
  if (adsetCount === 1) → single_adset (apply pe acel adset)
  else if (worst.cpl >= 1.5*avg && worst.spend ≥ 20%) → cut_worst_adset
  else if (all_tied) → proportional_cut_all_adsets
  else → throw multi_adset_ambiguous (manual review needed)
}
```

### 4.2 Decision rationale persistence
Fiecare apply scrie `decision_rationale_json` în recommendation row:
```json
{
  "strategy": "single_adset|cut_worst_adset|proportional_cut|cbo",
  "isCBO": bool,
  "adset_count": N,
  "changes": [{"adsetId", "name", "oldBudget", "newBudget"}],
  "partial": bool
}
```

## 5. Schema DB (CRM)

### 5.1 ad_monitor_target
KPI-uri per campanie + flags + overrides per-target.
Câmpuri cheie: targetCplCents, targetCpaCents, targetRoas, targetCtr, deviationThresholdPct, isActive, isMuted, suppressedActions[], severityOverride, customCooldownHours, version (OCC).

### 5.2 ad_optimization_recommendation
Lifecycle: draft → approved → applied | rejected | failed.
Câmpuri: action, reason, metricSnapshotJson, suggestedPayloadJson, decisionRationaleJson (Sprint 1, migration 0234).

### 5.3 ad_optimization_task (Sprint 0)
Queue tasks între CRM și PersonalOPS.
Câmpuri: status (pending|claimed|done|failed|expired), scheduledFor, claimedAt, claimedBy, completedAt, resultJson, expiresAt (+7d).
UNIQUE(tenantId, targetId, scheduledFor) → idempotent.

### 5.4 Migrations relevante
- 0220 api_keys
- 0221 campaigns (state machine)
- 0222 meta_ads_account.is_primary
- 0223-0226 ad_monitor_* tables
- 0227 audit + feedback + overrides
- 0228 backfill is_primary
- 0230-0233 ads_optimization_task + indexes
- 0234 decision_rationale_json column

## 6. PersonalOPS Worker

### 6.1 ads_optimizer
File structure:
- `types.ts` — AdsOptimizerInput, CampaignAggregates
- `crm-client.ts` — wrapper API CRM cu X-API-Key (snapshots, targets, recs, tasks)
- `decision-engine.ts` — pure functions, action-priority + gating
- `digest-builder.ts` — Telegram digest construction
- `handler.ts` — orchestrator (compute aggregates, fetch overrides, decide, submit)
- `__tests__/` — 44+ unit tests

### 6.2 Spawn modes
- `spawn_ads_optimizer({})` — iterate all active targets
- `spawn_ads_optimizer({clientIdFilter: 'X'})` — filter per client
- `spawn_ads_optimizer({taskId: 'X'})` — process single target via task (auto-PATCH la final)
- `spawn_ads_optimizer({targetIdOverride: 'X'})` — single target without task management
- `spawn_ads_optimizer({dryRun: true})` — analyze without posting drafts

## 7. Telegram Integration

### 7.1 Bot Piticu (@Augustin598_bot)
Token shared între CRM și PersonalOPS (același bot, ambele server-side trimit fără webhook conflict).
- CRM trimite: ads alerts, test messages, digest agregat
- PersonalOPS Piticu: webhook handler pentru /start <code> + Piticu commands

### 7.2 OTP linking flow
1. User → CRM UI → settings/telegram → generează cod
2. User → @Augustin598_bot → /start <code>
3. Webhook ajunge la PersonalOPS Piticu
4. Piticu detectează /start cu cod → POST /api/external/telegram/link-from-bot la CRM
5. CRM verifică cod în user_telegram_link → persistă chat_id
6. Piticu reply: "✅ OTS CRM connected!"

## 8. Configurarea

### 8.1 CRM env vars (app-config.json)
- `TELEGRAM_BOT_TOKEN` — token Piticu
- `TELEGRAM_BOT_USERNAME` — Augustin598_bot
- `TELEGRAM_WEBHOOK_SECRET` — secret pentru webhook auth (deși Piticu webhook e pe PersonalOPS, secret-ul e validat la nivel de Telegram update push)

### 8.2 PersonalOPS settings (SQLite local)
- `ots_crm:base_url` — `https://clients.onetopsolution.ro` (prod) sau `http://localhost:5173` (dev)
- `ots_crm:api_key` — `ots_ots_...` (scopes: ads_monitor:read, ads_monitor:write, telegram:link)
- `telegram:user_id` — chat_id Telegram al ownerului PersonalOPS

### 8.3 API key scopes
- `ads_monitor:read` — list targets/deviations/recommendations/snapshots/tasks
- `ads_monitor:write` — create/update recommendations, claim/PATCH tasks, auto-suppress
- `telegram:link` — link-from-bot endpoint
- `campaigns:read|write` — campaign management

## 9. Cum operezi

### 9.1 Trigger manual creator (forțează crearea tasks fără să aștepți cron)
```bash
curl -X POST -H "X-API-Key: $KEY" \
  https://clients.onetopsolution.ro/api/external/ads-optimization-tasks/_trigger-creator
```

### 9.2 Run optimizer manual
```
spawn_ads_optimizer({})
```
Sau cu filter: `spawn_ads_optimizer({clientIdFilter: 'X'})`.

### 9.3 Mark task done manual (claim + PATCH)
```bash
curl -X POST -H "X-API-Key: $KEY" -d '{"workerId":"manual"}' \
  https://clients.onetopsolution.ro/api/external/ads-optimization-tasks/$TASK_ID/claim

curl -X PATCH -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"status":"done","result":{"drafts_created":0,"note":"manual"}}' \
  https://clients.onetopsolution.ro/api/external/ads-optimization-tasks/$TASK_ID
```

### 9.4 Re-run backfill snapshots (pentru un campaign)
Editează `scripts/backfill-doublo-gold-snapshots.ts` cu campaign ID nou + dates → `bun scripts/backfill-doublo-gold-snapshots.ts`.

### 9.5 Restart serverele
```bash
bash /Users/augustin598/Projects/PersonalOPS/scripts/restart-all.sh
```

## 10. Deploy

### 10.1 CRM
```bash
cd /Users/augustin598/Projects/CRM
hosted-cli deploy app-config.json
```
Aplicare automată migrations Turso + propagare cod la `clients.onetopsolution.ro`.

### 10.2 PersonalOPS
Local-only. Cmd+Q app + redeschide.

## 11. Bugs known + workarounds

### 11.1 Meta `action_attribution_windows` (Fix Sprint 1 — needs cron rerun)
Cron-ul `ads-performance-monitor` și backfill scripts trebuie să trimită `action_attribution_windows=['1d_click','1d_view']` la Meta Insights, altfel Meta returnează lifetime aggregate cross-day → snapshot-uri inflate.
Fix aplicat în `client.ts`. Cron tomorrow rulează cu fix.

### 11.2 Migration 0234 must be applied locally (Sprint 1)
Local CRM dev nu rulează auto migrations. După `git pull` sau modificări schema, rulează `bun run db:migrate`.

### 11.4 Sprint 1 attribution-window cron-rerun (rezolvat post-deploy 1 mai 2026)
Cron `ads-performance-monitor` rulase la 07:00 RO ÎNAINTE de deploy-ul Sprint 1 (~12:32 RO) → snapshot-uri Apr 29 + Apr 30 inserate cu cumulative attribution → fals positive (109+ conversii zilnic).
Fix manual: backfill rerun pe DOUBLO GOLD overwrite snapshot-uri corupte. Cron de a doua zi (07:00) folosește deja codul corect.
Lesson learned: după deploy schimbări la cron, verifică prima rulare următoare a cron-ului afectat + corectează manual day(s) afectate.

### 11.5 Migration 0234+ trebuie aplicate local cu db:migrate
Local CRM dev nu rulează auto migrations la pornire. După git pull cu modificări schema, rulează:
```
cd /Users/augustin598/Projects/CRM/app && bun run db:migrate
```
Production (hosted) aplică automat migrations la deploy.

### 11.6 Sprint 4 incidents (rezolvate)

**Heartbeat false-positive `test-12345`**: instanceId folosit la testarea manuală cu curl s-a persistat în `personalops_instance` table. Cron monitor a alertat după 30min silence. Fix: șters manual + adaugat UUID validation pe POST /heartbeat (Sprint 4b).

**Migration 0229 + 0235-0239 silent fail**: descoperit la audit Sprint 3.5. 6 coloane lipseau live pe Turso pentru Sprint 2+3 features (outcome measurement, baseline, snooze). Aplicate idempotent. Pattern documentat în 11.4.

### 11.3 Local dev server vs prod URL
Dacă PersonalOPS pointează la `http://localhost:5173`, drafts se postează pe Turso DB shared cu prod. Nu confunda — prod-uri și local-uri văd aceeași bază.

## 12. Sprint History

### Sprint 0 — Task Queue (anterior)
- Schema ads_optimization_task + 3 endpoints externe
- Cron creator daily 07:30 RO + reaper 02:00 RO
- PersonalOPS poller every 12h + catch-up on startup

### Sprint 1 — BLOCKERS (1 mai 2026, commit cc75094)
- B1+B2: ABO/CBO detection în apply layer + adset routing (Hybrid Option C)
- B3: Cumulative drift gate (-50%/+50% în 14d window)
- B4: Action-priority refactor (DECREASE_BUDGET wins over REFRESH_CREATIVE)
- B6: Full Meta error JSON (code + subcode + fbtrace_id)
- Migration 0234: decision_rationale_json column
- Validated end-to-end: DOUBLO GOLD adset budget 35→25 RON applied real pe Meta

### Sprint 2 — Outcomes + UX (1 mai 2026, commit ba8f8bd, deploy 8ba9ca49)
- B5: Outcome measurement — 4 cols noi (baseline_cpl_cents, outcome_cpl_cents_7d, outcome_verdict, outcome_evaluated_at)
- B5: Cron `ads-optimizer-outcome-evaluator` daily 03:00 RO compare baseline vs current 7d post-apply (improved/worsened/neutral/insufficient_data/no_baseline)
- B5: PersonalOPS handler trimite baseline_cpl_cents la create time
- B7: Pause emergency skip weekend (Sat/Sun) + 2 zile consecutive minimum în loc de 1
- B11: Min budget floor 500 cents (5 RON) — clamp în CRM apply layer + fail-fast în decision engine
- 51/51 tests pass în decision-engine
- Migrations 0235-0238 (1 statement per file per skill)

### Sprint 3 — Polish (planificat, urmează)
**Scope:**
- B8: Increase budget gradual decay — limit max +50%/14d window + decay multiplier dacă consecutive_increases_7d > 1 → 1.1× în loc de 1.2×
- B9: Delivery issue detection — rule nouă (spend>0 + impressions=0 timp de 2 zile) → action='investigate' (manual review only)
- B10: Per-target rejection rate tracking — schema `recentRejectionRates: Record<targetId, Record<action, rate>>` în loc de global
- B12: Partial failure handling pe multi-adset apply — per-adset try/catch, persist `partial_apply_state` cu listă succes/fail, retry button în UI
- B13: Apply timing — defer budget changes until window 02:00-06:00 cont local (low-spend window) sau flag `defer_until_next_window`
- B14: Snooze button — `target.snooze_until` în DB, gate suplimentar în decision engine

**Estimare:** ~6-8h muncă peste sprint 1+2.

**Validare strategy:** după Sprint 3, propus shadow run 14 zile (optimizer logs decisions but NU postează în CRM). Skip dacă tu te simți confortabil să verifici manual deciziile pentru 1-2 săptămâni live.

### Sprint 4a — Foundation: trust + safety + scale (1 mai 2026, commit b7f33a7, deploy a51b87fd)
- **Outcome verdict UI**: badge colorat (improved/worsened/neutral/insufficient_data/no_baseline/pending) cu delta_pct calculat din baseline_cpl_cents vs outcome_cpl_cents_7d
- **Filter dropdown "Outcome"**: 5 opțiuni (All / Improved / Worsened / Neutral / Pending) cu URL param sync
- **Atomic transactions pe apply**: Meta API call OUTSIDE tx + DB write INSIDE `db.transaction()` → dacă DB write fail, rec stays 'approved' pentru retry, applyError populated (rezolvă Sprint 1 incident migration 0234)
- **Multi-currency min budget floor**: RON 500, EUR/USD/GBP 100 (default fallback 100)
- 34/34 tests pass (16 outcome filter + 3 atomic + 10 multicurrency + 5 concurrent setup)
- Per audit PPC Strategist + Gemini cross-validation: foundation = trust loop + data integrity + scale prep

### Sprint 4b — Data integrity: live Meta source-of-truth (1 mai 2026, commits 63e70d9 + 12e1ddf, deploy 93a121b3)
- **Endpoint nou** `GET /api/external/ads-monitor/budget-snapshot?campaignId=X`: live Meta budget (CBO returnează campaign daily_budget; ABO sums adsets daily_budget); cache in-memory 60s per (tenantId, campaignId)
- **PersonalOPS budget-drift.ts** (new): `computeCumulativeDrift` folosește live Meta budget vs baseline (din previous_budget al primei applied rec). REPLACES suma delta-uri DB-stored. Reflectă imediat manual reverts în Meta UI.
- **Concurrent claim stress test**: 5 tests în CRM — atomic claim guarantee, already-claimed/done rejections, race condition validation
- **Heartbeat UUID hardening**: endpoint reject non-UUID instanceId (400 invalid_instance_id); cron `personalops-heartbeat-monitor` filter version='test' + non-UUID din silent alerts
- 12 tests added (5 concurrent + 4 heartbeat + 3 drift)

**Production-readiness final score: 9/10** (de la 4/10 inițial → 8/10 post 3.5 → 9/10 post 4)

### CUT din Sprint 4 (per audit, NU vom face)
- ❌ **Worsened streak auto-pause**: redundant cu suppressed_actions după 1 reject + zero auto-apply path. Defer Sprint 5+ doar când avem 100+ recs reali pentru calibrare.
- ⏳ **B13 apply timing window 02-06 RO**: premature optimization la 8 targets. Threshold mandatory: 25+ targets.
- ⏳ **DLQ Meta rate limit + exponential backoff**: nu e problemă la 8 targets / 1 client. Sprint 5+.
- ⏳ **Metrics dashboard agregat**: verdict-pe-card sufficient la <20 targets. Threshold: 20+ targets.
- ⏳ **E2E nock mock tests**: unit + manual smoke sufficient. Sprint 5+ când arhitectura se stabilizează.

### Sprint 5 — Backlog (când scalezi la 20-25+ targets)

**Robustness:**
- B13: Apply timing defer 02-06 RO low-spend window
- DLQ pentru Meta rate limit cu exponential backoff per-target
- Worsened streak auto-pause (cu calibrare reală pe 100+ recs)

**Observability:**
- Metrics dashboard: recs/day, approval rate, apply success, verdict distribution per client/tenant
- Audit trail history view per target

**Quality:**
- E2E nock layer pentru graph.facebook.com (5 scenarii: success, rate_limit, token_expired, partial_fail, code=100)
- Coverage% reporting (target ≥85% pe decision-engine.ts)

**Multi-platform extension:**
- Engine support pentru Google Ads + TikTok Ads (schema deja gata)
- Rule sets per-platform (CTR/CPC/CPM thresholds diferite)

**Multi-tenant scale:**
- Worker concurrency per-tenant configurable
- Rate limiting fine-grained pe tenant

## 13. Limitări actuale

### 13.1 Per-adset metrics
Decision engine folosește campaign-level aggregates. Pentru ABO multi-adset, recomandările pot fi sub-optimale. Apply layer compensează parțial prin Hybrid Option C policy.

### 13.2 Outcome feedback
Sistemul nu măsoară IMPACT-ul recomandărilor aplicate (înainte vs după). Nu poți tuna rules pe baza efectului real. Sprint 2 va adresa.

### 13.3 PersonalOPS uptime
Mac nu e mereu online. Tasks acumulează în queue și sunt procesate la pornire (catch-up). Pentru tasks critice, deviation engine CRM emite alerte separat.

## 14. Contacts + Ownership

- Owner: Augustin (office@onetopsolution.ro)
- Bot Telegram: @Augustin598_bot
- Production: clients.onetopsolution.ro
- Local dev CRM: http://localhost:5173 (varies)
- Local dev PersonalOPS: http://localhost:3737

## 15. Migration Verification (post-deploy)

Per `database-migrations` skill rule 19, după FIECARE deploy CRM cu migrations noi:

```bash
cd /Users/augustin598/Projects/CRM/app
bun run scripts/verify-recent-migrations.ts
```

Output:
- Listă tabele/coloane verificate (0220–0242+)
- Status ✅ ok / ❌ MISSING per migration
- Exit 0 dacă toate OK, 1 dacă lipsesc

### Pattern de remediere pentru MISSING_COLUMN

```ts
// Aplică idempotent cu catch pe "already exists":
try {
  await client.execute('ALTER TABLE `t` ADD `col` text');
} catch(e: any) {
  if (!e.message?.includes('already exists')) throw e;
}
```

### Diagnostic queries

```sql
-- Verifică coloane tabelă:
PRAGMA table_info(ads_optimization_task);
PRAGMA table_info(personalops_instance);
PRAGMA table_info(meta_ads_integration);
PRAGMA table_info(ad_monitor_target);
PRAGMA table_info(ad_optimization_recommendation);

-- Verifică că migration e înregistrată:
SELECT * FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 10;
```

### KNOWN PATTERN: Silent migration drift

Migrations înregistrate în `__drizzle_migrations` dar SQL nu execută silent (cauză: Turso write lock în momentul migrării). Fix: rulează scriptul de verify + pentru orice missing, aplică SQL-ul direct cu try/catch pe "already exists".

**Occurrences istorice:**
- 0093 (apr 2026) — gmail/google_ads/meta_ads_integration refresh tracking columns
- 0229/0235-0239 (mai 2026) — Sprint 3/3.5 drift: `external_campaign_name`, outcome metrics, `snooze_until` (resolved 2026-05-01)

---
**Last updated:** 2026-05-01 după Sprint 4 (4a commit b7f33a7 deploy a51b87fd, 4b commit 63e70d9 deploy 93a121b3, PersonalOPS commit 12e1ddf).
