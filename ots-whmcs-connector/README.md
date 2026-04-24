# OTS CRM Connector — WHMCS Addon Module

Sends invoice + client lifecycle events from WHMCS to the OTS CRM via
HMAC-signed webhooks. Replaces the legacy `keez_integration` module (which
sent directly to Keez, bypassing the CRM).

## Architecture

```
WHMCS ──[HMAC webhook]──► OTS CRM ──(later)──► Keez
```

- WHMCS is the source of hosting invoices.
- OTS CRM is source of truth: matches clients (by CUI/email), creates invoices
  with a dedicated hosting series, optionally pushes to Keez for fiscal.
- This module is a **thin sender** — all business logic (numbering, matching,
  Keez push) lives on the CRM side.

## Install

1. Upload the entire `ots_crm_connector/` folder to `/modules/addons/` on
   your WHMCS installation. On this hosting setup the final path is:
   `public_html/hosting/modules/addons/ots_crm_connector/`
2. In WHMCS admin: **Setup → Addon Modules → OTS CRM Connector → Activate**.
3. Set access control (Full Administrator is usually enough).
4. Open the module config tab:
   - **CRM Base URL**: e.g. `https://clients.onetopsolution.ro`
   - **Tenant Slug**: e.g. `ots`
   - **Shared Secret**: paste the 64-hex-char secret from the CRM
     (Setări → Integrare WHMCS → „Configurează").
   - **Events invoices / clients**: yes
   - **Dry-run**: no (yes only for debugging)
5. Save, then open the module page and click **🔗 Test Connection**.
   You should see a green "Conexiune reușită" box.
6. **Disable the old `keez_integration` module** before going live — or both
   will post to Keez and you'll get duplicates.

## Hook coverage

| WHMCS hook        | CRM event  | Endpoint                  |
|-------------------|------------|---------------------------|
| `InvoiceCreated`  | `created`  | `/<tenant>/api/webhooks/whmcs/invoices` |
| `InvoicePaid`     | `paid`     | same |
| `InvoiceCancelled`| `cancelled`| same |
| `InvoiceRefunded` | `refunded` | same |
| `ClientAdd`       | `added`    | `/<tenant>/api/webhooks/whmcs/clients` |
| `ClientEdit`      | `updated`  | same |
| `DailyCronJob`    | —          | drains the retry queue |

## Security

Every request carries these headers; the CRM verifies them before any DB work:

- `X-OTS-Timestamp` — Unix seconds. Rejected if more than 65 s off.
- `X-OTS-Signature` — HMAC-SHA256 hex of the canonical payload.
- `X-OTS-Tenant`    — tenant slug; **also baked into the signature** so a
                       header swap cannot replay against another tenant.
- `X-OTS-Nonce`     — UUID per request; CRM remembers nonces for 5 min in
                       Redis to block replays.

Canonical payload (must match the CRM side byte-for-byte):

```
<timestamp>\n<METHOD>\n<path>\n<tenant-slug>\n<nonce>\n<raw-body>
```

## Retry queue

Transient failures (network errors, 5xx) land in `mod_otscrm_retry_queue`.
The module UI shows counts and a **Flush queue now** button.
WHMCS's `DailyCronJob` also drains the queue automatically.

Permanent 4xx responses (bad signature, malformed payload) are logged and
dropped — they will never succeed on retry.

## Transaction ID extraction

WHMCS stores the gateway transaction id (e.g. Stripe `txn_…`) in 5+ places
depending on the payment method. The extractor tries each in order; see
`lib/Extractors/TransactionIdExtractor.php`. Returns empty string if none
found — the CRM logs a WARN but still creates the invoice.

## Files

```
ots_crm_connector/
├── ots_crm_connector.php           # addon entry (config, UI, lifecycle)
├── hooks.php                        # WHMCS hook registrations
├── README.md                        # this file
└── lib/
    ├── Hmac.php                     # canonical payload + sign + UUID v4
    ├── Api.php                      # cURL client + retry-queue logic
    ├── RetryQueue.php               # Capsule-backed persistent queue
    ├── Mappers/
    │   ├── ClientMapper.php         # WHMCS client → CRM payload
    │   └── InvoiceMapper.php        # WHMCS invoice → CRM payload
    └── Extractors/
        └── TransactionIdExtractor.php
```

## Troubleshooting

| Symptom | Probable cause | Fix |
|---------|----------------|-----|
| Test Connection → `signature_mismatch` | Shared secret mismatch. | Rotate secret from CRM → paste new one in WHMCS. |
| `tenant_slug_mismatch` | Typo in Tenant Slug field, or URL slug differs. | Make sure slug here matches `locals.tenant.slug` in CRM. |
| `tenant_not_found` | Slug not in CRM's `tenant` table. | Check slug spelling. |
| `stale_timestamp` | Server clock drift > 65 s. | Sync WHMCS server time (NTP). |
| `whmcs_integration_inactive` | `isActive=false` in CRM. | Turn on in CRM → Setări → WHMCS. |
| `circuit_breaker_open` | CRM tripped after 5 consecutive failures. | Fix the root cause; breaker auto-resets. |
| Retry queue growing | CRM unreachable. | Check CRM URL + firewall/TLS. |

Version: 1.0.0
