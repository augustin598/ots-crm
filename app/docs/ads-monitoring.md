# Ads Monitoring (MVP — Meta only, alerting only)

Worker zilnic care trage insights din Meta, persistă snapshots, detectează deviații față de target-uri configurate, și trimite alerte (in-app + email + Telegram).

**Scop MVP:** alerting curat. Recomandările auto (pause/budget/refresh) sunt amânate pentru Faza 2 după ce datele și engine-ul își câștigă credibilitatea.

---

## Componente

### 1. Schema (3 tabele noi)

| Tabel | Scop |
|---|---|
| `ad_monitor_target` | Configurare target per campanie (CPL/CPA/ROAS/CTR + buget zilnic + prag deviație). Un rând per (tenant, campanie, adset). |
| `ad_metric_snapshot` | Istoric zilnic metrici per campanie. Reținere 90 zile. UPSERT pe (tenant, campaign, adset, date). |
| `user_telegram_link` | Linking user → Telegram chatId via `/start <code>` deep-link. |

Migrații: `drizzle/0223_ad_monitor_target.sql`, `0224_ad_metric_snapshot.sql`, `0225_user_telegram_link.sql`.

### 2. Worker — `ads-performance-monitor`

Fișier: `src/lib/server/scheduler/tasks/ads-performance-monitor.ts`
Cron: `0 7 * * *` Europe/Bucharest, zilnic.
Task type: `ads_performance_monitor`.

**Per tenant** (cu stagger deterministic 0–60 min după hash-ul `tenantId`):
1. Citește toate `ad_monitor_target` active și ne-mute pentru tenant.
2. Pentru fiecare cont Meta activ al tenant-ului → fetch `listCampaignInsights` (server-side, **bypass cache** LRU 5-min).
3. Match insight ↔ target pe `externalCampaignId`.
4. Construiește seria last-7-day din date Meta + zile lipsă completate cu zerouri.
5. Calculează maturity (vezi mai jos) și UPSERT în `ad_metric_snapshot`.
6. Rulează `deviation-engine.detectDeviations`.
7. Pentru fiecare deviație detectată → emit `ad.target_deviation` notification (in-app + email digest cu fingerprint dedup) + opțional Telegram (high/urgent only, anti-spam).

**Circuit breaker** per tenant: 5 eșecuri consecutive → 15 min cooldown.

### 3. Deviation engine — `src/lib/server/ads/deviation-engine.ts`

Pură (no DB, no I/O). Toate regulile testate cu `bun test`.

**Maturity assessment** (Gemini fix #3):
- `learning` → campania rulează < 7 zile (fază de learning Meta).
- `sparse`   → < 50 conversii în ultimele 7 zile (atribuire instabilă).
- `mature`   → restul.

**Detection rules:**
- Anti-flap: deviația trebuie să persiste ≥ 2 zile consecutive.
- Skip dacă maturity ≠ 'mature'.
- Skip dacă target.isMuted (cu sau fără mutedUntil).
- Severity: `warning` (>20%), `high` (>50%), `urgent` (>100% sau ROAS < 0.5× target).

20 unit tests în `deviation-engine.test.ts`.

### 4. Retention — `ads-snapshot-retention`

Cron: `0 3 * * *` zilnic.
DELETE pe `ad_metric_snapshot WHERE date < (now - 90 days)`.

Mandatory pentru a controla creșterea Turso (fără asta, ~50 tenants × ~100 campanii × 365 zile/an = 1.8M rânduri/an).

### 5. Telegram — bot global cu /start linking

- Token: `TELEGRAM_BOT_TOKEN` (un singur secret la nivel de aplicație, nu per-tenant).
- Username: `TELEGRAM_BOT_USERNAME` (default: `OTSCRMBot`).
- Webhook secret (opțional): `TELEGRAM_WEBHOOK_SECRET`.

**Setup:**
```bash
TELEGRAM_BOT_TOKEN=... \
PUBLIC_BASE_URL=https://clients.onetopsolution.ro \
bun run app/scripts/setup-telegram-webhook.ts
```

**User flow:**
1. User merge la `/[tenant]/settings/telegram` → click "Conectează".
2. Server generează `linkCode` (TTL 10 min) și returnează deep-link `https://t.me/<bot>?start=<code>`.
3. User dă click, Telegram lansează bot cu `/start <code>`.
4. Webhook (`POST /api/telegram/webhook`) primește update, găsește row, salvează `telegramChatId`, marchează `linkedAt`.
5. Bot răspunde "Conectat ✅".

### 6. UI

**`/[tenant]/reports/facebook-ads/monitoring`** — pagină dedicată:
- Buton "Adaugă target" → form cu CPL/CPA/ROAS/CTR/buget + prag + canale notificare.
- Tabel target-uri active cu mute/unmute (7 zile) și ștergere.
- Buton "Rulează acum" pentru trigger manual (admin only).

**Buton "Monitoring"** adăugat în header-ul `/[tenant]/reports/facebook-ads` care deschide pagina dedicată.

**`/[tenant]/settings/telegram`** — pagină de pairing.

### 7. API Endpoints (toate sub `[tenant]`, cu excepția webhook)

| Method | Path | Scop |
|---|---|---|
| GET    | `/[tenant]/api/ads-monitor/targets` | Listă target-uri |
| POST   | `/[tenant]/api/ads-monitor/targets` | Creează target |
| PATCH  | `/[tenant]/api/ads-monitor/targets/[id]` | Update / mute / unmute |
| DELETE | `/[tenant]/api/ads-monitor/targets/[id]` | Șterge target |
| GET    | `/[tenant]/api/ads-monitor/snapshots?campaignId=&days=30` | Istoric metrici |
| POST   | `/[tenant]/api/_debug-ads-monitor-run` | Trigger manual (admin) |
| GET    | `/[tenant]/api/settings/telegram/link` | Status conectare |
| POST   | `/[tenant]/api/settings/telegram/link` | Generează cod nou |
| DELETE | `/[tenant]/api/settings/telegram/link` | Deconectează |
| PUT    | `/[tenant]/api/settings/telegram/link` | Trimite mesaj test |
| POST   | `/api/telegram/webhook` | Webhook Telegram (public, secret-checked) |

---

## Env variables

```
TELEGRAM_BOT_TOKEN=<bot token from BotFather>
TELEGRAM_BOT_USERNAME=<bot username, fără @>
TELEGRAM_WEBHOOK_SECRET=<random secret pentru anti-spam pe webhook>  # opțional
PUBLIC_BASE_URL=https://clients.onetopsolution.ro                      # pentru setup-telegram-webhook
META_APP_SECRET=<existing>
```

---

## Testing manual

1. **Migrații**: `bun run db:migrate` apoi pe Turso `PRAGMA table_info(ad_monitor_target)` etc.
2. **Engine**: `bun test src/lib/server/ads/deviation-engine.test.ts` — 20 tests.
3. **Trigger manual worker**: din UI buton "Rulează acum" sau `curl -X POST .../_debug-ads-monitor-run`.
4. **Telegram smoke**: setup webhook → `/[tenant]/settings/telegram` → conectează → "Trimite test".

---

## Limite cunoscute (post-Gemini)

- **Latență Meta**: cu N tenants × M campanii, fetch-ul live (skipCache) poate fi lent. Pentru >100 target-uri/tenant, se va impune rate-limiting (`p-limit`) în Faza 2.
- **Atribuire weekend**: campanii B2B cu pattern luni-vineri pot trigger pause în weekend. Mitigare MVP: filtru maturity (≥50 conv în 7 zile).
- **Definiție conversie**: Meta Custom Conversions diferă între campanii. MVP folosește metricile native Meta (CPL/CPA/ROAS computate de platformă).

---

## Roadmap

| Fază | Conținut |
|---|---|
| MVP (livrată) | Schema + worker + alerting + Telegram + UI |
| Faza 2 | `ad_optimization_recommendation` table + recomandări DRAFT (`pause_ad`, `increase_budget`, `decrease_budget`, `refresh_creative`) cu UI Approve/Reject |
| Faza 3 | Apply automat recomandări aprobate via Meta API |
| Faza 4 | Replicare Google Ads + TikTok |
| Faza 5 (exploratory) | Recomandări via Ollama qwen3 (motivare în limbaj natural) |
