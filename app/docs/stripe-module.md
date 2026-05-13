# Stripe Module — OTS CRM

**Ultima actualizare:** 2026-05-13
**Branch / commits:** `main`
- `fb247f2` Sprint 9 per-tenant Stripe Connect plugin
- `9ece6ca` audit hardening + post-payment pipeline + debug endpoint
- `2194995` P0+P1 security & resilience fixes (cross-tenant replay, cleanup scheduling, isActive, VAT, stuck recovery)

---

## Overview

Plată online prin Stripe pentru pachete hosting publice (`/pachete-hosting/comanda`) cu:
- **Per-tenant credentials** stocate encrypted în DB (pattern aliniat cu Keez/SmartBill)
- **Idempotent webhook processing** cu lifecycle `processing → completed | failed`
- **Post-payment pipeline** cu 3 paşi independenți (magic-link, Keez invoice, DA provisioning)
- **Defense-in-depth** tenant filter în toate handler-ele recurring
- **Debug endpoint** admin pentru ping/replay/events visibility

**Current state:** Test mode 100% funcțional. Live mode necesită **fix Keez emission** (stub Sprint 8.2) pentru conformare ANAF.

---

## Arhitectură

### Stack per-tenant Stripe Connect

```
┌─────────────────────────────────────────────────────────────┐
│  src/lib/server/plugins/stripe/                              │
│    factory.ts     → getStripeForTenant / WebhookSecret /    │
│                     PublishableKey + cache + fallback env    │
│    crypto.ts      → re-export smartbill/crypto (DRY)         │
│    plugin.ts      → integration cu plugin registry           │
│    env-migration.ts → boot-time STRIPE_*_KEY → DB on first   │
│                       startup pentru tenant `ots`            │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│  src/lib/server/stripe/   (legacy thin shim + helpers)       │
│    client.ts      → @deprecated re-export getStripeForTenant │
│    customer.ts    → getOrCreateStripeCustomer (per-tenant)   │
│    price.ts       → getOrCreateStripePrice (per-tenant)      │
│    checkout.ts    → createHostingCheckoutSession             │
│    webhook-handlers.ts → 10 event handlers                   │
│    post-payment/                                              │
│      dispatcher.ts        → orchestrator 3 paşi idempotenți  │
│      send-magic-link.ts   → email portal access              │
│      provision-da.ts      → auto-create DA account           │
│      emit-keez-invoice.ts → STUB Sprint 8.2                  │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│  src/routes/api/stripe/webhook/+server.ts                    │
│  Public endpoint, per-tenant signature verify, idempotency   │
│  lifecycle, atomic dispatcher → DB updates                   │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│  src/routes/[tenant]/api/_debug-stripe-health/+server.ts     │
│  Admin-only debug: ping, events, replay, webhook-config,     │
│  post-payment-steps, pending-steps, client-duplicates        │
└─────────────────────────────────────────────────────────────┘
```

### Flow public checkout (happy path)

1. User pe `/pachete-hosting/comanda` selectează pachet + completează formularul (CUI, email, etc.)
2. `submitHostingOrder` (public-hosting.remote.ts):
   - Origin whitelist check (anti-open-redirect)
   - Rate limit per IP
   - Validare CUI + ANAF lookup
   - Check duplicate CUI (SELECT non-atomic + UNIQUE constraint backup)
   - INSERT `client` cu `.returning()` (cu retry pe Turso busy via `withTursoBusyRetry`)
   - INSERT `hostingInquiry` (cu retry)
   - `getOrCreateStripeCustomer(client)` → cache `stripe_customer_id`
   - `getOrCreateStripePrice(tenantId, product)` → cache `stripe_price_id`
   - `createHostingCheckoutSession({tenantId, customer, price, mode, metadata, successUrl, cancelUrl})`
   - UPDATE inquiry cu `stripe_checkout_session_id`
   - Return `checkoutUrl` → frontend redirect
3. User completează plata pe Stripe Checkout (SCA/3DS handled de Stripe)
4. Stripe webhook → `/api/stripe/webhook`:
   - Parse body raw, extract `metadata.crmTenantId`
   - `getWebhookSecretForTenant(tenantId)` (verifică `isActive`!)
   - `stripe.webhooks.constructEvent(rawBody, signature, secret)` verify
   - **Idempotency claim:** INSERT `processed_stripe_event` cu `status='processing'`
   - Pe PK violation: check status → 200 duplicate / 409 in flight / preluare retry
   - **Stuck recovery:** dacă `startedAt > 10min`, preia chiar dacă status='processing'
   - `dispatchStripeEvent(event)` → handler corespunzător
   - UPDATE `status='completed'` la final (sau `'failed'` + errorMessage)
5. `handleCheckoutSessionCompleted` execută atomic în transaction:
   - UPDATE `client` → `onboardingStatus='active', status='active'`
   - UPDATE `hostingInquiry` → `status='converted', contactedAt=now`
6. `runPostPaymentSteps(ctx)` → 3 paşi independenți, idempotenți pe `(stripe_session_id, step)`:
   - `magic_link` → creează token + trimite email
   - `keez_invoice` → STUB (Sprint 8.2)
   - `da_provision` → `createDAClient + createUserAccount` + INSERT `hostingAccount`

---

## DB schema (4 migrații aplicate)

| Migrație | Tabel/coloane |
|---|---|
| `0298_stripe_integration` | tabel `stripe_integration` (id, tenant_id UNIQUE, account_id, secret_key_encrypted, publishable_key, webhook_secret_encrypted, is_test_mode, is_active, last_tested_at) |
| `0299_stripe_event_status` | extinde `processed_stripe_event` cu `status` (`processing|completed|failed`), `started_at`, `completed_at`, `error_message`, `retry_count` + index pe status |
| `0300_client_unique_cui` | UNIQUE PARTIAL `client (tenant_id, cui) WHERE cui IS NOT NULL` |
| `0301_post_payment_steps` | tabel `post_payment_step` cu UNIQUE `(stripe_session_id, step)` + ALTER `hosting_account` ADD `stripe_subscription_id` + index |

### `processed_stripe_event` — webhook idempotency log

```
id              TEXT PK (Stripe evt_...)
event_type      TEXT NOT NULL
tenant_id       TEXT (nullable for untenanted events — neînregistrate de fapt)
status          TEXT NOT NULL DEFAULT 'completed'  -- 'processing'|'completed'|'failed'
started_at      TEXT     (ISO 8601, when processing began)
completed_at    TEXT     (ISO 8601)
error_message   TEXT
retry_count     INTEGER NOT NULL DEFAULT 0
processed_at    TEXT DEFAULT current_date  -- ⚠ DATE, nu ISO timestamp
```

⚠ **Notă:** `processed_at` e definit `text DEFAULT (current_date)` (= `YYYY-MM-DD`), nu ISO timestamp. Cleanup-ul compară cu Date obiect → string comparison funcționează accidental dar e fragil.

### `post_payment_step` — pipeline post-payment

```
id              TEXT PK
tenant_id       TEXT FK tenant
client_id       TEXT FK client
inquiry_id      TEXT FK hosting_inquiry
stripe_session_id TEXT
step            TEXT NOT NULL  -- 'magic_link'|'keez_invoice'|'da_provision'
status          TEXT DEFAULT 'pending'  -- 'pending'|'success'|'failed'|'skipped'
error           TEXT
attempts        INTEGER DEFAULT 0
completed_at    TEXT
payload         TEXT  -- JSON cu rezultatul (tokenId, daUsername, etc.)
created_at, updated_at  TEXT DEFAULT current_timestamp

UNIQUE (stripe_session_id, step)  -- idempotency garant
```

---

## Webhook handler dispatch (10 event types)

```typescript
case 'checkout.session.completed':  → handleCheckoutSessionCompleted
   atomic UPDATE client+inquiry + runPostPaymentSteps()
case 'checkout.session.expired':    → handleCheckoutSessionExpired
   inquiry.status='abandoned'
case 'invoice.paid' | 'invoice.payment_succeeded':  → handleInvoicePaid
   STUB: TODO Sprint 8.2 (Keez recurring emission)
case 'invoice.payment_failed':      → handlePaymentFailed
   logError + staff intervention flag
case 'payment_intent.payment_failed': → handlePaymentIntentFailed
   logError pentru mode='payment' (one-time)
case 'customer.subscription.deleted': → handleSubscriptionDeleted
   suspend hostingAccount-uri linked via stripeSubscriptionId
case 'charge.refunded':             → handleChargeRefunded
   invoice.status='refunded'
case 'charge.dispute.created':      → handleChargeDisputeCreated
   logError URGENT (staff email TODO)
case 'customer.updated':            → handleCustomerUpdated
   logWarning manual edit detectat
default:                            → 'ignored'
```

### Defense-in-depth tenant filter

Toate handler-ele `invoice.*`, `customer.subscription.deleted` etc. asertează că `metadata.crmTenantId` (din event) match-uiește `client.tenantId` (din DB) — via `resolveClientByStripeCustomer(customerId, expectedTenantId, ctx)`. Skip silent + logError dacă diverge.

---

## Per-tenant Stripe setup

### Configurare prima dată

1. Admin merge la `/[tenant]/settings/stripe`
2. Introduce: secret key (`sk_test_` / `sk_live_`), publishable key, webhook secret (din Stripe Dashboard → Developers → Webhooks)
3. Apasă "Test connection" → apel `stripe.accounts.retrieve()` → salvează `account_id/name/email` + `last_tested_at`
4. Credentials criptate cu AES-256-GCM per-tenant (key derived din `tenantId + ENCRYPTION_SECRET`)

### Env fallback (Sprint 8 compat)

Pentru tenant `ots` (slug = `PUBLIC_HOSTING_TENANT_SLUG`), `getStripeForTenant` + `getWebhookSecretForTenant` cad pe env vars dacă nu există row `stripe_integration`:
- `STRIPE_SECRET_KEY`
- `PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `STRIPE_WEBHOOK_SECRET`

`scripts/_migrate-stripe-env.ts` poate fi rulat manual pentru a face migrarea env→DB:
```bash
cd app && bun scripts/_migrate-stripe-env.ts
```
Idempotent — skip dacă row deja există.

### Stripe SDK config (toate apelurile)

În `factory.ts:buildClient`:
```typescript
new Stripe(secret, {
  apiVersion: '2026-04-22.dahlia',  // pin explicit pentru contract drift detection
  timeout: 10_000,                   // 10s — fără asta default e 80s
  maxNetworkRetries: 2,              // SDK retry pe 5xx/429/networking (3 total)
  typescript: true,
  appInfo: { name: 'OTS CRM', version: '1.0.0' }
});
```

---

## Debug endpoint `/[tenant]/api/_debug-stripe-health`

Admin-only (tenantUser.role === 'owner' | 'admin'). Tenant-scoped automat pe `locals.tenant`.

| Action | Use case |
|---|---|
| `ping` (default) | Test conexiune Stripe per-tenant (apel `balance.retrieve`) |
| `events&limit=20` | Listează ultimele N evenimente cu status + breakdown |
| `replay&eventId=evt_xxx` | Re-fetch event din Stripe + re-dispatch (cu **cross-tenant guard**) |
| `webhook-config` | Status integration + env fallback + 10 evenimente recomandate |
| `post-payment-steps&sessionId=cs_xxx` | Status cei 3 paşi pe o session |
| `pending-steps&limit=50` | Toți paşii failed/pending pe tenant |
| `client-duplicates` | Listare duplicate CUI (înainte de a aplica UNIQUE migration) |

### Securitate replay

`?action=replay&eventId=evt_xxx`:
1. SELECT `processed_stripe_event WHERE id = eventId`
2. Dacă `tenantId !== currentTenant` → **403** + logError
3. Toate UPDATE-urile filtrează pe `(id, tenant_id)` defense-in-depth
4. Apel `stripe.events.retrieve` pe Stripe-ul tenantului curent
5. Dispatch + final UPDATE status='completed' / 'failed'

---

## Scheduler tasks

| Task | Cron | Scop |
|---|---|---|
| `stripe_event_cleanup` | `15 2 * * *` Europe/Bucharest | Cleanup `processed_stripe_event`: completed/failed >90d + stuck 'processing' >1h |

---

## Verificare end-to-end

### Local dev

```bash
# Terminal 1 — dev server
cd app && bun run dev

# Terminal 2 — Stripe CLI listener
stripe listen --forward-to localhost:5173/api/stripe/webhook
# Note: webhook secret printat trebuie să match cu stripe_integration.webhook_secret_encrypted
# pentru tenant ots, sau fallback env STRIPE_WEBHOOK_SECRET.

# Terminal 3 — Trigger test events
stripe trigger checkout.session.completed \
  --add 'checkout_session:metadata.crmTenantId=<TENANT_ID>'
```

### Sanity SQL queries

```sql
-- 1. Stare stripe_integration pentru tenant
SELECT s.tenant_id, t.slug, s.is_test_mode, s.is_active,
       length(s.secret_key_encrypted) AS secret_len,
       (s.webhook_secret_encrypted IS NOT NULL) AS has_webhook,
       s.last_tested_at, s.last_error
FROM stripe_integration s JOIN tenant t ON s.tenant_id = t.id;

-- 2. Rows stuck 'processing' >10min — candidați recovery
SELECT id, event_type, status, started_at, retry_count, error_message
FROM processed_stripe_event
WHERE status = 'processing'
  AND started_at < datetime('now', '-10 minutes')
ORDER BY started_at DESC LIMIT 50;

-- 3. Statistici pe status (alarm dacă >1% failed)
SELECT status, COUNT(*) AS cnt,
       ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) AS pct
FROM processed_stripe_event GROUP BY status;

-- 4. Post-payment steps eșuate — staff replay candidates
SELECT stripe_session_id, step, status, attempts, error, updated_at
FROM post_payment_step
WHERE status IN ('failed', 'pending') AND attempts < 5
ORDER BY updated_at DESC LIMIT 50;

-- 5. Detect duplicate CUI înainte de migrarea UNIQUE (acum 0 — partial index activ)
SELECT tenant_id, cui, COUNT(*) AS n
FROM client WHERE cui IS NOT NULL
GROUP BY tenant_id, cui HAVING n > 1;

-- 6. Latest 10 events procesate
SELECT id, event_type, tenant_id, status, retry_count,
       (julianday(completed_at) - julianday(started_at)) * 86400 AS dur_sec
FROM processed_stripe_event
ORDER BY started_at DESC LIMIT 10;
```

### Test rezultate confirmate (2026-05-13)

| Test | Rezultat |
|---|---|
| `ping` apel `balance.retrieve` | ✅ 519ms, livemode false, balance returnat |
| 7 webhook events procesate (checkout.session.*, invoice.*) | ✅ toate `completed`, 0 failures, 52-103ms |
| Idempotency PRIMARY KEY violation pe re-INSERT | ✅ funcționează |
| Bad signature → 400 | ✅ |
| Missing `stripe-signature` header → 400 | ✅ |
| Missing `metadata.crmTenantId` → 200 untenanted | ✅ |
| Invalid JSON → 400 | ✅ |
| Cleanup stuck-processing >1h via SQL | ✅ 1 row → 0 |
| Cross-tenant replay protection | ✅ 403 dacă eventId nu aparține tenantului |

---

## Issues cunoscute / future work

### P2 (post-MVP, nu blocking pentru test mode)

| Issue | Locație | Plan |
|---|---|---|
| `emit-keez-invoice.ts` STUB | post-payment/ | Sprint 8.2 — creează CRM `invoice` + push Keez |
| Webhook fără `metadata.crmTenantId` → untenanted nu se înregistrează | webhook/+server.ts | Future: rezolvă tenant via `event.data.object.customer` → `client.stripeCustomerId` |
| `processed_at` e DATE nu timestamp | schema.ts:975 | Migrate la `current_timestamp` pentru consistență |
| Webhook folosește `new Stripe('sk_test_dummy_...')` pentru `constructEvent` | webhook/+server.ts:68 | Folosește o instanță reală cache-uită (orice key valid funcționează) |
| `migrationRanThisProcess` flag nu e atomic multi-pod | plugins/stripe/env-migration.ts | INSERT...ON CONFLICT DO NOTHING |
| `account_id` rămâne null după Test connection în UI | settings/stripe page | UI bug — verifică că salvarea include `account_id` din `accounts.retrieve` |
| Stripe Connect: `event.account` neutilizat | webhook-handlers.ts | Pentru `Direct charges` pattern actual e OK |
| `client_reference_id` nu e setat pe Checkout Session | checkout.ts | Util pentru reconciliere fără metadata |

### P3 (operations)

- Email staff URGENT pe `charge.dispute.created` — TODO în handler
- Hosted Invoice Page email client pe `invoice.payment_failed` — TODO
- Domain temp `${username}.hosting-temp.ots` pentru DA provisioning — UX cere staff să editeze domain real

---

## Utilități existente reutilizabile

| Helper | Locație | Folosit |
|---|---|---|
| `withTursoBusyRetry(op, {tenantId, label})` | `plugins/keez/db-retry.ts` | Toate INSERT/UPDATE-urile public-hosting + webhook |
| `serializeError(err)` | `logger.ts` | Toate catch-urile |
| `sendMagicLinkEmail(email, token, slug, name)` | `email.ts:1243` | post-payment/send-magic-link |
| `verifyMagicLinkToken(token, tenant)` | `client-auth.ts:54` | Portal login |
| `createDAClient(tenantId, server)` | `plugins/directadmin/factory.ts` | post-payment/provision-da + handleSubscriptionDeleted |
| `runWithAudit({tenantId, ...}, fn)` | `plugins/directadmin/audit.ts` | Toate apelurile DA |
| `withAccountLock(\`${tenantId}:${daUsername}\`, fn)` | `plugins/directadmin/audit.ts` | Concurrency per account |
| `encrypt(tenantId, jsonString)` | `plugins/smartbill/crypto.ts` | DA credentials, Stripe webhook secret |

---

## Pattern divergențe față de Keez/SmartBill

- ✅ **Aliniat:** crypto re-export, `getXForTenant` cache, plugin lifecycle, `_integration` table UNIQUE tenant
- ⚠ **Divergent:** webhook nu folosește `withTursoBusyRetry` în jurul INSERT idempotency (Keez/sync are pe orice DB call). Acceptabil — webhook are deja retry built-in (Stripe re-deliver pe 500)
- ⚠ **Divergent:** nu există `stripe/error-classification.ts` similar cu `keez/`. Acceptabil pentru moment — Stripe SDK + webhook retry suffices
- ⚠ **Divergent:** nu setăm `lastTestedAt` la fiecare apel — doar la Test Connection UI. Future: observability pasivă

---

## Comenzi rapide

```bash
# Aplicare migrații pe Turso
cd app && bun run db:migrate

# Verificare state migrații + schema
cd app && bun scripts/_apply-0298-direct.ts  # idempotent
cd app && bun scripts/_migrate-stripe-env.ts # idempotent

# svelte-check
cd app && NODE_OPTIONS="--max-old-space-size=8192" npx svelte-check --threshold warning

# Trigger test event (dev local)
stripe trigger checkout.session.completed \
  --add 'checkout_session:metadata.crmTenantId=k2yzj5bxxppatc57vxpoxfvn'

# Debug în browser (admin login required)
http://localhost:5173/<tenant-slug>/api/_debug-stripe-health?action=ping
http://localhost:5173/<tenant-slug>/api/_debug-stripe-health?action=events
http://localhost:5173/<tenant-slug>/api/_debug-stripe-health?action=webhook-config
http://localhost:5173/<tenant-slug>/api/_debug-stripe-health?action=client-duplicates
```

---

## Audit trail

- **Inițial audit (2026-05-13):** 3 agenți Explore în paralel — `Map Stripe module structure`, `Map Stripe integration in app flow`, `Stripe risk and quality review`
- **Second opinion:** Gemini agent — descoperit UNIQUE constraint lipsă pe `client(tenant_id, cui)`, contradicție pe "long Turso transaction" claim
- **Deep audit post-implementare:** API Tester agent — descoperit P0 cross-tenant replay + cleanup neprogramat + isActive bypass + VAT ID greșit la non-plătitori + stuck-processing forever

Toate findings-urile P0/P1 din audit-uri sunt rezolvate în commit `2194995`. P2/P3 sunt documentate dar nu blocking pentru producție test mode.
