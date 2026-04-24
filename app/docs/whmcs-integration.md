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

## Referințe

- Plan complet: `~/.claude/plans/vreau-sa-facem-un-buzzing-cray.md`
- Pattern HMAC reutilizat: [ots-wp-connector/ots-connector.php](../../ots-wp-connector/ots-connector.php)
- Modul vechi de decomisionat: `/Users/augustin598/Projects/Whmcs/host/modules/addons/keez_integration/`
- Funcții reutilizate:
  - [`createInvoice()`](../src/lib/remotes/invoices.remote.ts) — creare invoice din payload
  - [`syncInvoiceToKeez()`](../src/lib/remotes/keez.remote.ts) — auto-push fiscal
  - `encrypt()` / `decrypt()` — shared secret
