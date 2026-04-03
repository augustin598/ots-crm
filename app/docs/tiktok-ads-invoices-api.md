# TikTok Ads Manager — Invoice Download API

Reverse-engineered from TikTok Ads Manager web UI (`ads.tiktok.com`).
All endpoints require authenticated session cookies (cookie-based auth, no Bearer token).

Base URL: `https://ads.tiktok.com`

---

## Table of Contents

1. [Authentication & Headers](#1-authentication--headers)
2. [Get Payment Account (pa_id)](#2-get-payment-account-paid)
3. [List Invoices](#3-list-invoices)
4. [Download Invoice (2-step)](#4-download-invoice-2-step)
5. [Invoice Data Schema](#5-invoice-data-schema)
6. [Context Object](#6-context-object)
7. [Status Codes](#7-status-codes)
8. [Example Flow](#8-example-flow)

---

## 1. Authentication & Headers

All requests use **cookie-based session auth**. Required cookies (obtained after TikTok Ads login):

| Cookie | Purpose |
|--------|---------|
| `sessionid_ads` | Main session ID |
| `sid_tt_ads` | Session token |
| `csrftoken` | CSRF protection |
| `ac_csrftoken` | Additional CSRF token |
| `msToken` | Anti-bot token (rotates) |

**Required headers:**

```
Content-Type: application/json
Accept: application/json, text/plain, */*
X-Requested-With: XMLHttpRequest
Referer: https://ads.tiktok.com/i18n/account/payment_invoice?aadvid={adv_id}
```

---

## 2. Get Payment Account (`pa_id`)

The `pa_id` (Payment Account ID) is required for download operations. It is NOT the same as `adv_id`.

### `POST /pa/api/spider/query_payment_account`

**Request:**
```json
{
  "Context": {
    "platform": 1,
    "adv_id": "7566621400111317009",
    "bc_id": ""
  },
  "module_list": [0, 3]
}
```

**Response:**
```json
{
  "code": 0,
  "msg": "operate success",
  "data": {
    "pa_info": {
      "pa_id": "7568783775488901905",
      "name": "Payment Portfolio 1905",
      "type": 1,
      "account_id": "7566621442813526017",
      "subject_id": 8,
      "status": 4,
      "is_cash_collecting": false
    },
    "pa_version": 2,
    "currency_format": { "code": "RON", "precision": 2 },
    "adv_info_vo": {
      "id": "7566621400111317009",
      "name": "Meduza Agency1029",
      "currency": "RON",
      "timezone": "Europe/Bucharest",
      "role": 0,
      "country": "RO"
    },
    "crm_account_id": "7566621442813526017",
    "crm_account_name": "Surie invest management srl",
    "country": "RO"
  }
}
```

**Key fields:**
- `data.pa_info.pa_id` — needed for download Context
- `data.adv_info_vo.timezone` — needed for download create
- `data.pa_info.subject_id` — billing entity identifier

---

## 3. List Invoices

### `POST /pa/api/common/show/invoice/query_invoice_list`

**Request (All Invoices):**
```json
{
  "pagination": {
    "page_no": 1,
    "page_size": 12
  },
  "Context": {
    "platform": 1,
    "adv_id": "7566621400111317009"
  }
}
```

**Request (Unpaid only):**
```json
{
  "dispatch_status_list": [1, 3],
  "pagination": {
    "page_no": 1,
    "page_size": 12
  },
  "Context": {
    "platform": 1,
    "adv_id": "7566621400111317009"
  }
}
```

**Response:**
```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "pagination": {
      "total": 48,
      "page_no": 1,
      "page_size": 12
    },
    "data": [
      {
        "invoice_id": "7624158953626321682",
        "invoice_serial": "BDUK20262070786",
        "invoice_title": "Surie invest management srl",
        "account_name": "Surie invest management srl",
        "send_date": "2026-04-02",
        "due_date": "",
        "amount": "157.30",
        "amount_without_tax": "130.00",
        "total_tax_amount": "27.30",
        "currency": "RON",
        "country_code": "RO",
        "detail_address": "Str. Branduselor 84, etaj 4,Brasov,Romania 500397",
        "receive_email": "meduza.agency.st@gmail.com",
        "entity_serials": "ST7624151516930130183",
        "bill_id_list": ["7624151516930130183"],
        "tax_info_list": [
          {
            "tax_amount": "27.30",
            "tax_type": "VAT",
            "tax_rate": "0.21"
          }
        ],
        "status": 3,
        "display_status": 2,
        "dispatch_status": 2,
        "due_status": 0,
        "classify": 3,
        "subject_id": 8,
        "bg_id": "7566621398299312903",
        "bg_name": "Meduza Agency-RON",
        "bc_id": "0",
        "adv_id_list": ["7566621400111317009"],
        "send_time_stamp": "1775088000000",
        "due_time_stamp": "0",
        "po_number": "",
        "unpaid_amount": "0.00",
        "show_pay_now": false,
        "positive_note_info_list": [],
        "negative_note_info_list": []
      }
    ]
  }
}
```

**Pagination:** Use `page_no` (1-based) and `page_size` (max 12 per page observed). Iterate until all `pagination.total` invoices are fetched.

---

## 4. Download Invoice (2-step)

Downloading an invoice PDF is a **two-step async process**.

### Step 1: Create Download Task

#### `POST /pa/api/download/create`

**Request:**
```json
{
  "download_task_type": 136,
  "query_param": "{\"invoice_id\":\"7624158953626321682\"}",
  "timezone": "Europe/Bucharest",
  "Context": {
    "platform": 1,
    "pa_id": "7568783775488901905",
    "adv_id": "7566621400111317009"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `download_task_type` | number | Always `136` for invoice download |
| `query_param` | string (JSON) | JSON-stringified object with `invoice_id` |
| `timezone` | string | IANA timezone (from `query_payment_account`) |
| `Context.pa_id` | string | Payment Account ID (from `query_payment_account`) |
| `Context.adv_id` | string | Advertiser ID |

**Response:**
```json
{
  "code": 0,
  "msg": "Success",
  "data": {
    "task_id": "7624398278230164231"
  }
}
```

### Step 2: Query Download URL

#### `POST /pa/api/download/query`

**Request:**
```json
{
  "task_id": "7624398278230164231",
  "Context": {
    "platform": 1,
    "pa_id": "7568783775488901905",
    "adv_id": "7566621400111317009"
  }
}
```

**Response (ready):**
```json
{
  "code": 0,
  "msg": "Success",
  "data": {
    "download_url": "https://ads.tiktok.com/wsos_v2/cg_settlement/object/wsos69cf8c065adb4b11?expire=1775213085&timeStamp=1775209485&uid=7475309909325038593&sign=946603be830b3e50bb99c124c6d6643af7baf4fb0bb4b76e6e945bf774d19676",
    "status": 1
  }
}
```

| `status` | Meaning |
|----------|---------|
| `0` | Pending / processing |
| `1` | Ready — `download_url` is available |

**Download URL format:**
```
https://ads.tiktok.com/wsos_v2/cg_settlement/object/{objectId}?expire={timestamp}&timeStamp={timestamp}&uid={user_id}&sign={signature}
```

- URL is **temporary** (signed, has `expire` param)
- Returns PDF file when fetched with GET
- No additional auth needed for the download URL itself (signature is in URL params)

**Polling:** If `status` is `0`, poll `/pa/api/download/query` with the same body until `status` becomes `1`. Typical wait: < 2 seconds.

---

## 5. Invoice Data Schema

| Field | Type | Description |
|-------|------|-------------|
| `invoice_id` | string | Unique invoice ID (use for download) |
| `invoice_serial` | string | Invoice serial number (e.g., `BDUK20262070786`) |
| `invoice_title` | string | Billed-to entity name |
| `account_name` | string | Account/company name |
| `send_date` | string | Issue date (`YYYY-MM-DD`) |
| `due_date` | string | Due date (empty if paid) |
| `amount` | string | Total amount including tax |
| `amount_without_tax` | string | Amount excluding tax |
| `total_tax_amount` | string | Total tax amount |
| `currency` | string | Currency code (`RON`, `EUR`, `USD`, etc.) |
| `country_code` | string | Country code (`RO`) |
| `detail_address` | string | Billing address |
| `receive_email` | string | Invoice recipient email |
| `entity_serials` | string | Entity serial(s), comma-separated |
| `bill_id_list` | string[] | Associated bill IDs |
| `tax_info_list` | object[] | Tax breakdown (rate, type, amount) |
| `status` | number | Invoice status |
| `display_status` | number | Display status |
| `dispatch_status` | number | Dispatch/send status |
| `due_status` | number | Payment due status |
| `bg_name` | string | Business Group name |
| `send_time_stamp` | string | Issue timestamp (ms) |
| `unpaid_amount` | string | Remaining unpaid amount |
| `show_pay_now` | boolean | Whether "Pay Now" button shows |
| `po_number` | string | Purchase order number |

---

## 6. Context Object

The `Context` object is required in every request:

```json
{
  "platform": 1,
  "adv_id": "7566621400111317009"
}
```

For download endpoints, `pa_id` is also required:

```json
{
  "platform": 1,
  "pa_id": "7568783775488901905",
  "adv_id": "7566621400111317009"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `platform` | number | Always `1` (TikTok Ads) |
| `adv_id` | string | Advertiser ID (from URL `aadvid` param) |
| `pa_id` | string | Payment Account ID (from `query_payment_account`) |
| `bc_id` | string | Business Center ID (optional, `""` if not applicable) |

---

## 7. Status Codes

### Invoice `status`

| Value | Meaning |
|-------|---------|
| `3` | Paid |

### Invoice `dispatch_status`

| Value | Meaning |
|-------|---------|
| `1` | Pending |
| `2` | Dispatched/Sent |
| `3` | Unknown (appears in unpaid filter) |

### Invoice `display_status`

| Value | Meaning |
|-------|---------|
| `2` | Normal/visible |

### Download task `status`

| Value | Meaning |
|-------|---------|
| `0` | Processing |
| `1` | Ready (URL available) |

### API response `code`

| Value | Meaning |
|-------|---------|
| `0` | Success |

---

## 8. Example Flow

Complete flow to download all invoices for an advertiser:

```
1. GET pa_id
   POST /pa/api/spider/query_payment_account
   → Extract: pa_id, timezone

2. LIST invoices (paginated)
   POST /pa/api/common/show/invoice/query_invoice_list
   → page_no=1, page_size=12
   → Repeat for page_no=2,3,4... until all fetched
   → Extract: invoice_id, invoice_serial, send_date, amount, etc.

3. For EACH invoice:
   a. CREATE download task
      POST /pa/api/download/create
      → body: { download_task_type: 136, query_param: JSON.stringify({invoice_id}), timezone, Context: {platform:1, pa_id, adv_id} }
      → Extract: task_id

   b. POLL download URL
      POST /pa/api/download/query
      → body: { task_id, Context: {platform:1, pa_id, adv_id} }
      → Wait until status=1
      → Extract: download_url

   c. DOWNLOAD PDF
      GET {download_url}
      → Save as PDF file
```

### Rate Limiting

No explicit rate limits observed, but recommended:
- Add 500ms-1s delay between download/create calls
- Add 200ms delay between download/query polls
- Process invoices sequentially, not in parallel burst

---

## Notes

- All IDs are **snowflake-style strings** (large numeric strings)
- `query_param` in download/create is a **JSON-stringified** string, not a nested object
- The invoice page URL pattern: `https://ads.tiktok.com/i18n/account/payment_invoice?aadvid={adv_id}`
- `send_time_stamp` is in **milliseconds** (divide by 1000 for Unix seconds)
- Invoices are ordered by `send_date` descending (newest first)
- `page_size` of 12 matches the UI grid layout (observed max)
