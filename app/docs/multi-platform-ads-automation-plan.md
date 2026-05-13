# Multi-Platform Ads Automation Plan

**Status:** DRAFT v1 (plan-mode, no execution)
**Author:** Piticu (CEO agent) + Gemini consult + read-only investigation worker `w_mot46koh_c`
**Date:** 2026-05-06
**Scope:** Meta Ads + Google Ads + TikTok Ads automation — agency-level
**Audience:** Augustin (decision owner), CRM eng team

---

## 0. TL;DR

We already automate Meta end-to-end (campaign creation + optimizer with apply/approve loop). Google Ads and TikTok are **read-only**: we ingest insights/invoices/spending but cannot create or mutate campaigns. The agency runs **8 Meta clients / 38 ad-accounts**, **7 Google clients / 41 ad-accounts**, **3 TikTok clients / 8 advertisers** — Google is the largest *unautomated* surface and the highest ROI delta.

**Recommended path:** stay on the current architecture (CRM owns platform connections + business logic; PersonalOPS workers consume CRM via internal HTTP). Do **not** adopt Ryze MCP or gomarble as the production data plane — both fragment ownership. Use them only as ad-hoc analysis tools.

**Phasing:**
- **Phase 0 (1 week):** unified read-only dashboard + monitoring extended to Google & TikTok (we already have schema, only worker logic missing).
- **Phase 1 (3–4 weeks):** Google Ads write — campaign/adgroup/ad creation + optimizer.
- **Phase 2 (3–4 weeks):** TikTok write — campaign/adgroup/ad creation + optimizer.
- **Phase 3 (2 weeks):** cross-platform optimizer (budget reallocation, attribution-aware suggestions).
- **Phase 4 (continuous):** agency-level AI insights (cross-client benchmarks, anomaly detection, weekly digest).

---

## 1. Current State (verified 2026-05-06)

### 1.1 Capability matrix

| Capability | Meta | Google Ads | TikTok |
|---|---|---|---|
| OAuth + token refresh | ✅ | ✅ | ✅ |
| Session cookies (AES-256-GCM) | ✅ | ✅ | ✅ |
| Insights read (campaign/adgroup/demo/geo) | ✅ | ✅ | ✅ |
| Invoice sync | ✅ | ✅ | ❌ |
| Spending sync | ✅ | ✅ | ✅ |
| Lead sync | ✅ | ❌ | partial |
| **Campaign create/update/delete** | ✅ | ❌ | ❌ |
| **Adset/AdGroup create/update** | ✅ | ❌ | ❌ |
| **Ad create + creative attach** | ✅ | ❌ | ❌ |
| Targeting cache | ✅ (24h DB) | ❌ | ❌ |
| Monitoring snapshots + recs | ✅ (active) | schema-ready | schema-ready |
| Optimizer (apply/feedback loop) | ✅ (PersonalOPS) | ❌ | ❌ |
| Approve/reject UI | ✅ | n/a | n/a |

### 1.2 Active fleet

| Platform | Clients | Ad accounts | Campaigns via system |
|---|---|---|---|
| Meta | 8 | 38 | 3 (1 active) |
| Google Ads | 7 | 41 | 0 |
| TikTok | 3 | 8 | 0 |

Per-client breakdown: see `live_stats_2026_05_06` in memory `multi_platform_ads_state_snapshot_2026_05_06`.

### 1.3 Existing schema (cross-platform ready)

The `campaign` table already supports `platform IN ('meta','tiktok','google')`, status flow `draft|building|pending_approval|active|paused|archived|failed`, and build steps `none|campaign|adset|creative|ad|done`. The `ad_monitor_target`, `ad_metric_snapshot`, `ad_optimization_recommendation`, and `ad_recommendation_feedback` tables are platform-agnostic. **The schema work is already done — only platform-specific clients and worker branches are missing.**

### 1.4 Current PersonalOPS workers

- `ads_campaign_creator` — explicit `if (platform !== 'meta') throw "MVP supports only Meta"`.
- `ads_optimizer` — Meta-only handler, decision engine, budget-drift detection, 7d outcome tracking, auto-pause after 5 worsened recs.
- `ads_crm_client` — generic HTTP client to CRM internal API (already platform-agnostic at the transport level).

---

## 2. Architectural Decision (locked)

### 2.1 Data plane: CRM owns the integrations

**Decision:** keep CRM as the single source of truth for platform connections, OAuth tokens, session cookies, billing data, and recommendation lifecycle. PersonalOPS workers call CRM via internal HTTP API.

**Rationale (cross-checked with Gemini):**
1. We already store tokens + AES-256-GCM session cookies in CRM DB; moving them to PersonalOPS would duplicate secrets.
2. CRM is multi-tenant via `tenantId`; PersonalOPS is single-user. Permissions logic lives in CRM.
3. Recommendations need approve/reject UI — UI lives in CRM, so the lifecycle owner must be CRM.
4. Approve cascade (campaign+adset+ad ACTIVE flip) is an atomic transaction → must run in the system that owns the DB.

### 2.2 Why NOT Ryze MCP or gomarble in production

| Concern | Ryze MCP | gomarble | Our current path |
|---|---|---|---|
| Multi-tenant token isolation | shared per-MCP-instance | none | per-tenant in DB ✅ |
| Session cookies (FB/Google/TT business UI features) | not supported | not supported | AES-256-GCM ✅ |
| Audit trail | external SaaS logs | none | full DB audit ✅ |
| Approve cascade atomicity | impossible (HTTP-only) | impossible | Drizzle txn ✅ |
| Vendor lock-in | high (250+ tools) | medium | none |
| Cost predictability | per-call billing | OSS but Python sidecar | zero variable cost |

**Allowed use:** ad-hoc exploration in PersonalOPS sessions when Augustin asks "find me X across all clients fast" and the data isn't in our DB yet. Not in the production data plane.

### 2.3 Unified abstraction layer

Create `src/lib/server/ads/platform-adapter.ts` with a single interface every platform module implements:

```ts
export interface AdsPlatformAdapter {
  platform: 'meta' | 'google' | 'tiktok'
  // Read
  listCampaigns(accountId: string, opts?: ListOpts): Promise<Campaign[]>
  listInsights(accountId: string, level: 'campaign'|'adset'|'ad', opts: InsightsOpts): Promise<Insight[]>
  // Write
  createCampaign(spec: CampaignSpec): Promise<{ campaignId: string }>
  createAdset(spec: AdsetSpec): Promise<{ adsetId: string }>
  createAd(spec: AdSpec): Promise<{ adId: string }>
  updateBudget(level: 'campaign'|'adset', id: string, micros: bigint): Promise<void>
  toggleStatus(level, id, status: 'ACTIVE'|'PAUSED'): Promise<void>
  // Targeting
  searchTargeting(query: string, kind: 'interest'|'location'|'behavior'): Promise<TargetingOption[]>
}
```

**Currency normalization:** all monetary values flow through the API as `micros` (BIGINT), platform-agnostic. Adapters convert to/from platform native units (Meta uses cents, Google uses micros natively, TikTok uses string decimals).

**Targeting heterogeneity:** store platform-specific targeting in `extended_attributes JSONB` on the campaign/adset row. The adapter is responsible for serialization. **Do not invent a unified targeting schema** — Meta interests don't map cleanly to Google keywords or TikTok categories.

---

## 3. Roadmap (4 phases)

### Phase 0 — Unified read-only dashboard + monitoring extension (~1 week)

**Goal:** unblock the Google + TikTok read paths through the same UI/worker pipeline as Meta. **Zero write risk.**

**Tasks:**
1. Extend `ads_optimizer` decision-engine to read Google + TikTok snapshots.
2. Implement `ads_optimizer/handler.ts` branch for `platform='google'` and `platform='tiktok'` — recommendations only of type: `pause_ad`, `decrease_budget`, `refresh_creative`. NO write apply yet (apply route returns 501).
3. Build `[tenant]/campaigns-ads/all/+page.svelte` — unified dashboard pulling from all 3 platforms.
4. Add cross-platform digest builder in PersonalOPS (already 80% of the code in `ads-optimizer/digest-builder.ts`).
5. Add Google Ads + TikTok rows to `ad_monitor_target` ingest worker.

**Definition of Done:**
- Augustin sees 1 list of recommendations across 3 platforms in CRM UI.
- Recommendations for Google/TikTok have status `read_only_suggestion` (cannot approve, only acknowledge).
- Daily digest shows platform breakdown.

**Effort:** 4–6 dev-days.
**Risk:** low (no write paths touched).

---

### Phase 1 — Google Ads write capabilities (~3–4 weeks)

**Goal:** create + optimize Google Ads campaigns end-to-end via the system.

**Why first:** 41 ad-accounts vs Meta's 38 — largest unautomated surface. Google API is the most stable and best-documented of the three.

**Tasks:**
1. **Targeting cache for Google** (`google_targeting_cache` table): keywords, audiences, geo, demographics — 24h TTL pattern from Meta.
2. **Google adapter implementation** in `src/lib/server/google-ads/campaign-create.ts`:
   - `buildGoogleCampaign()` mirrors `buildMetaCampaign` flow: campaign → adgroup → ad → keywords/audiences.
   - Rollback `deleteGoogleCampaignEntities()` in reverse order.
3. **AI campaign generator** in PersonalOPS: extend `ads_campaign_creator` to handle `platform='google'` — Claude generates `GoogleCampaignSpec` (network=SEARCH/PMAX/DISPLAY, bidding_strategy, conversion_action_id, budget_micros, etc.).
4. **Approve cascade** for Google — Google API has different status enum (`ENABLED|PAUSED|REMOVED`); adapter maps to our `'ACTIVE'|'PAUSED'`.
5. **Optimizer extension** for Google: budget update via `customer_budget_service`, status toggle via `campaign_service.mutate`.
6. **UI:** extend existing `[tenant]/campaigns-ads/google/+page.svelte` with "+ Create campaign" button + spec preview drawer.
7. **Tests:** unit tests for adapter; integration test against Google sandbox account.

**Definition of Done:**
- 1 real Google Search campaign created via system in DRAFT, approved, ACTIVE on real Google.
- Optimizer can pause + resume + budget-update Google campaigns.
- UI shows live status mirror.

**Effort:** 12–16 dev-days.
**Risks:**
- Google API quota tier — verify our developer token tier supports our campaign volume (currently READ-only access tested; WRITE quota ≠ READ quota).
- MCC structure — confirm sub-account access scope per OAuth grant.
- PMAX vs Search vs Shopping — initial MVP supports **Search only**; PMAX requires asset-group complexity.

---

### Phase 2 — TikTok write capabilities (~3–4 weeks)

**Goal:** create + optimize TikTok campaigns end-to-end.

**Why second:** lower surface (8 advertisers) but rapidly growing for our agency. Architecture pattern from Phase 1 reused.

**Tasks:**
1. **Targeting cache for TikTok** (`tiktok_targeting_cache`): interests, behaviors, hashtags, regions.
2. **TikTok adapter** in `src/lib/server/tiktok-ads/campaign-create.ts`:
   - `buildTikTokCampaign()` follows TikTok's hierarchy: campaign → adgroup → ad with creative.
   - TikTok requires `identity_id` (Spark Ads vs custom identity) — store on `tiktok_ads_account`.
3. **AI campaign generator extension** for TikTok specs (`objective: TRAFFIC|CONVERSIONS|REACH|VIDEO_VIEWS`).
4. **Optimizer extension** for TikTok with status mapping (`ENABLE|DISABLE|DELETE`).
5. **Creative upload** — TikTok requires video assets uploaded to library first. Add `tiktok_creative_library` table + upload flow.
6. **UI** extend `[tenant]/campaigns-ads/tiktok/+page.svelte`.

**Definition of Done:**
- 1 real TikTok TRAFFIC campaign created via system, approved, ACTIVE.
- Optimizer can pause/resume/budget-update.
- Creative library functional.

**Effort:** 12–16 dev-days.
**Risks:**
- TikTok refresh-token expires (we already track `refreshTokenExpiresAt`) — alert 7d before.
- Creative upload failures — large video files; add resumable upload.
- Spark Ads vs custom identity — clarify per-client preference.

---

### Phase 3 — Cross-platform optimizer (~2 weeks)

**Goal:** the optimizer reasons across all 3 platforms simultaneously per client.

**Tasks:**
1. **Per-client portfolio view** — given client X with Meta+Google+TikTok active, compute per-platform CPL/CPA/ROAS with shared attribution window.
2. **Budget reallocation suggestions:** if Google CPL = 30 RON and Meta CPL = 80 RON for same goal, suggest "shift 200 RON/day Meta → Google".
3. **Cross-platform anomaly detection** — sudden spend spike on any platform triggers a single recommendation.
4. **Attribution disclaimer** — every cross-platform suggestion includes an "attribution-fragmented" note (we cannot deduplicate users between Meta and Google without a unified attribution layer like a CDP — explicitly NOT in scope).

**Definition of Done:**
- Daily digest contains cross-platform reallocation suggestions.
- Approve/reject works per-platform (no global "approve all").

**Effort:** 8–10 dev-days.
**Risk:** attribution illusion — must be VERY clear with the user that "shift budget" is a heuristic, not data-driven causal inference.

---

### Phase 4 — Agency-level AI insights (continuous)

**Goal:** features that justify "agency platform" positioning.

**Candidate features (prioritize per quarter):**
1. **Cross-client benchmarks** — "your Beauty One CPL is 30 RON; salon-vertical median across our portfolio is 45 RON" (anonymized).
2. **Creative fatigue detector** — frequency > 3 + CPC rising → auto-suggest refresh.
3. **Weekly client-facing report PDF** — auto-generated, brand-customized.
4. **Predictive budget pacing** — "at current spend rate, Heylux Suceava will exhaust monthly budget by day 23, suggest decrease 15%".
5. **Negative-keyword harvester** (Google) — auto-suggest negatives from search terms report.
6. **Bid-strategy recommender** — switch between MaxConversions / MaxConversionValue / Manual CPC based on data volume.

**Effort:** 1–2 features per sprint, ongoing.

---

## 4. Risk Register

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Google Ads write quota insufficient for agency scale | High | Verify quota tier *before* Phase 1 starts; have fallback plan to apply for higher tier. |
| R2 | Attribution fragmentation across platforms misleads optimizer | High | Phase 3 ships with explicit "heuristic, not causal" labels on every cross-platform suggestion. |
| R3 | TikTok refresh-token expiration (silent fail) | Medium | Already tracked; add 7-day-before alert in Phase 0. |
| R4 | Multi-tenant token leakage | Critical | Audit on every PR that touches token code; current Sprint 4 audit verified clean. |
| R5 | Creative copy compliance (Meta/Google policies differ) | Medium | AI generator runs creative through platform-specific policy linter pre-submit; surface warnings to user. |
| R6 | Approve cascade not atomic across platforms | High | Each platform approve stays per-platform; no "approve everywhere" button. |
| R7 | Vendor lock-in to Anthropic for AI generator | Low | Generator output is deterministic JSON spec; can swap to local model later. |
| R8 | PersonalOPS single-user model breaks if other people approve recs | Medium | Approve UI is in CRM (multi-tenant); PersonalOPS only generates suggestions. |

---

## 5. Open Decisions (BLOCKERS — need Augustin)

These were the 8 questions before context compaction. Plan ships once decided:

1. **Scope per client:** "all clients on all platforms" or "per-client opt-in"? Default proposed: per-client opt-in via `ads_automation_enabled` flag on `tenant` row.
2. **Volume per month (campaigns created via system):** drives Google API quota tier choice. Estimate: 10–30/month at current pace?
3. **Phase 0 read-only dashboard first, or skip straight to Phase 1 write?** Default proposed: ship Phase 0 (1 week, low risk, immediate value).
4. **Cross-platform budget moves require human approval per platform, or one approve cascades?** Default proposed: per-platform approval (safer; forces deliberate review).
5. **Approval gate granularity:** approve every recommendation, or auto-approve below threshold (e.g. budget change <10%)? Default proposed: every rec needs approval until 30 successful auto-applies, then introduce auto-approve threshold.
6. **Audience overlap strategy across platforms:** out of scope or in scope? Default proposed: out of scope; revisit in Phase 4.
7. **Ryze MCP usage final call:** discard, or keep as ad-hoc analysis tool? Default proposed: keep for ad-hoc CEO-session analysis; not in production.
8. **Time budget for Phase 1 + 2:** can we commit ~6 weeks of focused dev or fragmented across other priorities? Default proposed: Phase 0 immediate, then 1 sprint Phase 1, parallel Phase 2 if Augustin can dual-track.

**Until decided, defaults above are assumed in this plan.**

---

## 6. Metrics of Success

Per phase:

| Phase | Metric | Target | Measurement |
|---|---|---|---|
| 0 | Unified dashboard adoption | 100% of active clients visible in 1 view | manual check |
| 0 | Google + TikTok recommendations generated | ≥ 5/day across all clients | `ad_optimization_recommendation` count |
| 1 | Google campaigns created via system | ≥ 5 in first month | `campaign WHERE platform='google' AND created_via='system'` |
| 1 | Google optimizer apply success rate | > 95% | `ad_optimization_recommendation` outcome |
| 2 | TikTok campaigns created via system | ≥ 3 in first month | same query, platform='tiktok' |
| 3 | Cross-platform reallocation suggestions accepted | ≥ 30% accept rate | `ad_recommendation_feedback` |
| 4 | Time saved per agency client per week | ≥ 3 hours | manual survey |

---

## 7. Implementation Order — Concrete Next Sprint

If Augustin says "go" (and answers Q3 = "Phase 0 first"), Sprint 5 = Phase 0:

**Sprint 5 (1 week):**
- D1: extend `ads_optimizer/handler.ts` for Google read path. Generate `pause_ad`/`decrease_budget` recs only.
- D2: same for TikTok.
- D3: `[tenant]/campaigns-ads/all/+page.svelte` unified table.
- D4: cross-platform digest builder.
- D5: tests + production deploy + verify-recent-migrations.
- D6–7: monitor in prod, tune deviation thresholds per platform.

Sprint 6+ = Phase 1 Google write.

---

## 8. Reference Files (existing)

- Meta optimizer: `src/services/workers/ads-optimizer/` (PersonalOPS)
- Meta campaign creator: `src/lib/server/meta-ads/campaign-create.ts:481` (`buildMetaCampaign`)
- Meta client: `src/lib/server/meta-ads/client.ts`
- Google client (read-only): `src/lib/server/google-ads/client.ts`
- TikTok client (read-only): `src/lib/server/tiktok-ads/client.ts`
- Cross-platform schema: `src/lib/server/db/schema.ts` (`campaign`, `ad_monitor_target`, `ad_optimization_recommendation`)
- AI campaign creator (Meta-only): `PersonalOPS/src/services/workers/ads-campaign-creator.ts`
- CRM HTTP client: `PersonalOPS/src/services/workers/ads-crm-client.ts`
- Documentation: `docs/ads-optimizer-system.md`, `docs/ads-status-mappings.md`, `docs/ads-monitoring.md`

---

## 9. Versioning

- v1 (2026-05-06): initial draft, post-investigation, plan-mode
- v2 (TBD): post-Augustin-decisions on Q1–Q8
- v3 (TBD): post-Phase-0 retro
