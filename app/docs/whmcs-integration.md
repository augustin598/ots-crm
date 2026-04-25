# WHMCS ↔ OTS CRM Connector

> **Status**: 📋 Plan approved, implementation in progress on branch `claude/whmcs-crm-connector`.
> Detailed plan: `~/.claude/plans/vreau-sa-facem-un-buzzing-cray.md`

## Scop

Înlocuiește modulul PHP existent `keez_integration` (WHMCS → Keez direct) cu un flux prin CRM:

```
WHMCS → [HMAC webhook] → CRM /api/webhooks/whmcs/* → BullMQ worker → createInvoice() → syncInvoiceToKeez() → Keez
```

CRM devine **source-of-truth** pentru facturile hosting: primește datele raw de la WHMCS, face client matching (CUI → email → create), creează `invoice` cu **seria dedicată de hosting** (ex. `HOST`), păstrează Transaction ID-ul Stripe, apoi pushează automat la Keez.

## Principii arhitecturale

- **Endpoint thin + BullMQ async** — webhook doar face HMAC verify + enqueue (zero business logic sincronă)
- **Deterministic jobId** `whmcs:{tenantId}:{invoiceId}:{event}` — dedupe nativ BullMQ pe concurrent webhooks
- **State machine** `PENDING → CLIENT_MATCHED → INVOICE_CREATED → KEEZ_PUSHED` cu retry doar pe step-ul eșuat
- **TenantId + nonce în HMAC canonical** — blochează cross-tenant replay attacks
- **Dry-run implicit** (`enableKeezPush=false`) — primele zile doar CRM side, fără duplicate în Keez

## Faze rollout

| Fază | Ce conține | Blast radius |
|------|-----------|--------------|
| 1 | DDL + UI config (`isActive=false`) | Zero |
| 2 | Shadow mode (CRM primește, nu push Keez) — modulul vechi încă activ | Zero |
| 3 | Pilot switchover (un singur tenant, `keez_integration` vechi dezactivat) | 1 tenant |
| 4 | Rollout per tenant, 1/zi | Gradual |
| 5 | Decomisionare `keez_integration` (după 7 zile stabil) | Final |

**Rollback**: la orice eroare în faza 3+, `isActive=false` + re-activate `keez_integration` în WHMCS admin — minute, nu ore.

## Componente majore

### CRM TypeScript
- Schema: 5 tabele sync noi (`whmcs_integration`, `whmcs_invoice_sync`, `whmcs_client_sync`, `whmcs_product_sync`, `whmcs_transaction_sync`) + 8 coloane noi pe `client`/`invoice`/`invoice_settings`
- `app/src/lib/server/whmcs/*` — verify, client-matching, receiver, redact
- `app/src/lib/server/workers/whmcs-sync-worker.ts` — BullMQ worker cu state machine
- `app/src/routes/[tenant]/api/webhooks/whmcs/*` — 5 endpoint-uri (invoices, clients, products, transactions, health)
- `app/src/routes/[tenant]/settings/whmcs/` — UI setări + event log + match stats

### WHMCS PHP (la `/Users/augustin598/Projects/Whmcs/host/modules/addons/ots_crm_connector/`)
- Addon Module cu config UI + activation hook
- Hook files pentru: `InvoiceCreated`, `InvoicePaid`, `InvoiceCancelled`, `InvoiceRefunded`, `ClientAdd/Edit`, `ProductCreate/Edit`, `TransactionAdded`
- Retry queue local (`mod_ots_retry_queue`) cu cron 5 min
- `Extractors/TransactionIdExtractor.php` — portat din `getTransactionIdForInvoice()` al modulului vechi

## Securitate

HMAC-SHA256 cu canonical payload = `timestamp + method + urlPath + tenantId + nonce + body`. Fiecare request are:
- `X-OTS-Timestamp` (±65s window — 60s + 5s Turso buffer)
- `X-OTS-Signature`
- `X-OTS-Tenant`
- `X-OTS-Nonce` (anti-replay via Redis key `{tenantId}:whmcs:nonce:{nonce}` TTL 5 min)

Shared secret criptat per tenant cu `encrypt()`/`decrypt()` existente, retry 2-3x pe `DecryptionError`.

## Testing

6 layers, date realiste românești (CUI `40015841`, diacritice, Transaction ID Stripe real):
- **Unit**: HMAC canonical, nonce replay, mapper, client match cascade
- **Integration**: webhook E2E, state machine resume, amount mutation guard
- **Replay**: fixtures din producție (`fixtures/whmcs/invoice-*.json`)
- **Negative**: cross-tenant 401, signature invalid, timestamp stale, inactive integration
- **Smoke**: `scripts/smoke-whmcs-health.ts` post-deploy pe toți tenanții
- **Golden**: snapshot JSON payload → CRM invoice shape

## Limitări cunoscute (v1 exclusions)

- Event `refunded` → DEAD_LETTER cu flag `needs_credit_note_creation` (credit note automat în v2)
- Endpoint `/products` și `/transactions` — v1 just log & ignore (implementare completă în v2)
- Multi-currency (RON/EUR/USD cu exchangeRate) — v1 assumă RON dominant
- Migrare istorică facturi vechi — separat, script batch dedicat

## Resilience (v1.1 — branch `feat/whmcs-resilience-debug`)

Înainte: push-ul Keez declanșat din webhook era **fire-and-forget**; un singur 502 transient la upstream
înseamna factură pierdută până la replay manual. Acum:

### Per-invoice retry chain

| Modul | Rol |
|-------|-----|
| `whmcs/errors.ts` | `WhmcsKeezPushAbortedError`, `WhmcsPushBackError` (status-based) |
| `whmcs/error-classification.ts` | `classifyWhmcsPushError(err) → 'transient' \| 'permanent'` (deferă la Keez classifier pentru shape-uri Keez) |
| `whmcs/retry-policy.ts` | Backoff `[2m, 10m, 30m, 2h]`, `MAX_PUSH_ATTEMPTS=5`, jitter ±10% |
| `whmcs/failure-handler.ts` | `handleWhmcsKeezPushFailure(...)` — citește `retryCount`, decide retry vs FAILED, persistă pe `whmcs_invoice_sync` (`nextRetryAt`, `keezPushStatus`, `lastPushAttemptAt`), bumpează `consecutiveFailures` la nivel de integration |
| `scheduler/tasks/whmcs-keez-push-retry.ts` | BullMQ delayed job; `jobId = whmcs-keez-push-retry-{tenant}-{invoice}-{attempt}` (attempt-suffix anti-dedup, identic Keez) |
| `scheduler/tasks/whmcs-invoice-reconcile.ts` | Cron 10 min — recuperează rândurile orfane (`in_flight` >15 min sau `retrying` cu `nextRetryAt` în trecut + 5 min) |

### Concurrent dedup

`activeKeezPushes: Set<"${tenantId}:${invoiceId}">` în `invoice-handler.ts` — previne push-uri paralele
pentru aceeași factură când `created` și `paid` ajung back-to-back.

### Coloane noi pe `whmcs_invoice_sync`

| Coloană | Tip | Rol |
|---------|-----|-----|
| `keez_push_status` | text | `null` \| `in_flight` \| `retrying` \| `failed` \| `success` |
| `next_retry_at` | timestamp | Când va rula următorul hop BullMQ |
| `last_push_attempt_at` | timestamp | Pentru detectarea rândurilor orfane |

Migrate-uri: `0201..0203`.

### Correlation ID

Webhook stamps `correlationId = whk_<6 hex>` care e propagat la fiecare log line subsecvent
(push, retry hops, validate, push-back). Răspunsul HTTP îl returnează ca `correlationId`
pentru ca administratorul să poată face grep complet în loguri.

## Debug & observabilitate

### `GET /[tenant]/api/_debug-whmcs-health`

Endpoint admin-only cu mai multe moduri. Toate răspunsurile sunt JSON.

| Mode | Ce face |
|------|---------|
| `?mode=summary` (default) | integration state + queue summary + callback round-trip probe |
| `?mode=callback` | Doar HMAC POST round-trip la `callback.php` (latency + status) |
| `?mode=queue` | Histograme: `state`, `keezPushStatus`, count BullMQ retry-jobs, scheduled retries |
| `?mode=stuck&minutes=N` | Rânduri `in_flight` mai vechi de N min (default 15) |
| `?syncId=<id>` | Deep inspect un sync row + jobs BullMQ asociate |
| `?invoiceId=<id>&action=trigger` | Anulează retry-urile pendinte și re-enqueue cu delay=0 |

### UI admin

- **Coloana "Push Keez"** în Event log + Dead Letters — badge cu status + retryCount + ETA reîncercare
- **Buton "Retry now"** pe rândurile cu push eșuat / în reîncercare — anulează hop-ul programat și forțează un retry imediat
- **Buton "Reîncearcă toate push-urile eșuate"** — batch replay (max 100/run) doar pentru `keezPushStatus='failed'`, NU pentru `DEAD_LETTER` (acelea necesită review manual)

### Replay command updates

`replayWhmcsSync(syncId)` are acum două moduri:
- `push_retry_enqueued` — dacă invoice există + push e failed/retrying/in_flight → cancel pending retries, reset error state, enqueue retry imediat
- `reset_to_pending` — fallback (DEAD_LETTER fără invoice creat) → reset state, așteaptă următorul webhook

## Referințe

- Plan complet: `~/.claude/plans/vreau-sa-facem-un-buzzing-cray.md`
- Pattern HMAC reutilizat: [ots-wp-connector/ots-connector.php](../../ots-wp-connector/ots-connector.php)
- Modul vechi de decomisionat: `/Users/augustin598/Projects/Whmcs/host/modules/addons/keez_integration/`
- Funcții reutilizate:
  - [`createInvoice()`](../src/lib/remotes/invoices.remote.ts) — creare invoice din payload
  - [`syncInvoiceToKeez()`](../src/lib/remotes/keez.remote.ts) — auto-push fiscal
  - `encrypt()` / `decrypt()` — shared secret
