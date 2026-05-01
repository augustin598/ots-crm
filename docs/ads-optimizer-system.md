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
│  │     ├── ads-optimization-task-creator (00:15 RO daily)         │
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
1. **00:15 RO** CRM cron creează task per target activ (UNIQUE constraint per zi → idempotent)
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

### 11.3 Local dev server vs prod URL
Dacă PersonalOPS pointează la `http://localhost:5173`, drafts se postează pe Turso DB shared cu prod. Nu confunda — prod-uri și local-uri văd aceeași bază.

## 12. Sprint History

### Sprint 0 — Task Queue (anterior)
- Schema ads_optimization_task + 3 endpoints externe
- Cron creator daily 00:15 RO + reaper 02:00 RO
- PersonalOPS poller every 12h + catch-up on startup

### Sprint 1 — BLOCKERS (1 mai 2026, commit cc75094)
- B1+B2: ABO/CBO detection în apply layer + adset routing (Hybrid Option C)
- B3: Cumulative drift gate (-50%/+50% în 14d window)
- B4: Action-priority refactor (DECREASE_BUDGET wins over REFRESH_CREATIVE)
- B6: Full Meta error JSON (code + subcode + fbtrace_id)
- Migration 0234: decision_rationale_json column
- Validated end-to-end: DOUBLO GOLD adset budget 35→25 RON applied real pe Meta

### Sprint 2 — UX + Outcomes (urmează)
- B5: Outcome measurement post-apply CPL @ 7d
- B7: Pause weekend false positive guard
- B11: Min budget floor enforcement (5 RON)
- (Optional) B3: Recommendation card UI cu adset preview

### Sprint 3+ — Polish (later)
- B8: Increase budget gradual decay
- B9: Delivery_issue rule
- B10: Per-target rejection tracking
- B12: Partial failure handling pe multi-adset apply
- B13: Apply timing (defer until low-spend window)
- B14: Snooze button "all good today"

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

---
**Last updated:** 2026-05-01 după Sprint 1 commit cc75094 + deploy 82d165c2.
