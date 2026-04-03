# Facebook (Meta) Ads — Invoice/Receipt Download API

Reverse-engineered from Meta Business Suite Billing Hub (`business.facebook.com`).
All requests require authenticated Facebook session cookies.

Base URL: `https://business.facebook.com`

---

## Table of Contents

1. [Authentication & Cookies](#1-authentication--cookies)
2. [Navigation & URL Patterns](#2-navigation--url-patterns)
3. [Ad Accounts (Business ID: 264956774003853)](#3-ad-accounts-business-id-264956774003853)
4. [Account Details Page](#4-account-details-page)
5. [Transaction List (Payment Activity)](#5-transaction-list-payment-activity)
6. [Download Invoice PDF (Direct Link)](#6-download-invoice-pdf-direct-link)
7. [Transaction Data Schema](#7-transaction-data-schema)
8. [URL Parameters Reference](#8-url-parameters-reference)
9. [Comparison with TikTok Ads](#9-comparison-with-tiktok-ads)
10. [Example Flow](#10-example-flow)

---

## 1. Authentication & Cookies

Facebook uses **cookie-based session auth**. Key cookies after login:

| Cookie | Purpose |
|--------|---------|
| `c_user` | User ID (e.g., `100076674944353`) |
| `xs` | Session secret |
| `datr` | Browser fingerprint |
| `sb` | Session binding |
| `locale` | Language preference |
| `presence` | Online presence token |

**Required headers:**

```
Accept: text/html,application/xhtml+xml (for PDF download)
User-Agent: (standard browser UA)
Cookie: (full cookie jar from logged-in session)
```

---

## 2. Navigation & URL Patterns

All Billing Hub pages share the same base pattern. The key is swapping `asset_id` and `payment_account_id` with the target ad account ID.

### Page hierarchy

```
Billing Hub
├── Accounts list ............ /latest/billing_hub/accounts
│   └── Account details ...... /latest/billing_hub/accounts/details/?asset_id={id}
│       └── "View transaction history" link → Payment activity
├── Payment methods .......... /latest/billing_hub/payment_methods
├── Payment activity ......... /latest/billing_hub/payment_activity    ← INVOICES HERE
│   └── Transaction details .. /latest/billing_hub/payment_activity/transaction_details/?transaction_id={txid}
├── Credit lines ............. /latest/billing_hub/credit_lines
└── Invoices ................. /latest/billing_hub/invoices
```

### URL templates

All URLs require `business_id` + `asset_id` + `payment_account_id`:

| Page | URL |
|------|-----|
| **Accounts list** | `/latest/billing_hub/accounts?business_id={biz_id}&asset_id={act_id}&payment_account_id={act_id}` |
| **Account details** | `/latest/billing_hub/accounts/details/?business_id={biz_id}&asset_id={act_id}&payment_account_id={act_id}` |
| **Payment activity** | `/latest/billing_hub/payment_activity?business_id={biz_id}&asset_id={act_id}&payment_account_id={act_id}` |
| **Invoices** | `/latest/billing_hub/invoices?business_id={biz_id}&asset_id={act_id}&payment_account_id={act_id}` |

**Key rule:** `asset_id` = `payment_account_id` = ad account ID (always the same value).

### How to navigate to invoices for any account

1. Start from the **Accounts list** page
2. Click on an account name → opens **Account details**
3. Click "View transaction history" → opens **Payment activity**
4. Set date filter to **Lifetime** (or use `&date=1642284000_{current_unix}` in URL)
5. Click "See More" until all transactions are loaded
6. Each row has a **"Download PDF"** link

Or skip steps 1-3 by going directly to:
```
https://business.facebook.com/latest/billing_hub/payment_activity?
  business_id=264956774003853
  &asset_id={ad_account_id}
  &payment_account_id={ad_account_id}
  &placement=mbs_all_tools_menu
  &date=1642284000_1775250000
```

---

## 3. Ad Accounts (Business ID: 264956774003853)

### All accounts

| # | Account Name | Ad Account ID | Status | Payment Method | Currency | Balance |
|---|---|---|---|---|---|---|
| 1 | Wow - ADS | `198341315786439` | Active | Visa ···· 0270 | RON | 0.00 lei |
| 2 | Heylux - Agency | `479270316439307` | Disabled | Visa ···· 9651 | RON | 3,459.10 lei (failed) |
| 3 | Super Joburi Iași | `899474164132021` | Closed | — | RON | 0.00 lei |
| 4 | OTS - CHAT | `487146846015758` | Closed | — | RON | 0.00 lei |
| 5 | Team Wash Luxury | `750777705790255` | Active | Visa ···· 5452 | RON | 0.00 lei |
| 6 | Goldesa.ro | `379807819951523` | Closed | — | RON | 0.00 lei |
| 7 | Vladpeiu.ro | `3576696285722726` | Closed | — | RON | 0.00 lei |
| 8 | VIVINO CONSULT S.R.L | `604858467050397` | Disabled | — | RON | 0.00 lei |
| 9 | Charm Studios | `502203060451811` | Closed | — | RON | 0.00 lei |
| 10 | Casa lui Patrocle - ADS | `581072022704270` | Active | MasterCard ···· 5775 | RON | 0.00 lei |
| 11 | Remary.ro | `3297610730280638` | Disabled | — | RON | 8,709.83 lei (failed) |
| 12 | FLODO GSM | `437272720519106` | Active | Visa ···· 0801 | RON | 709.84 lei |
| 13 | IRepair | `340871916549797` | Closed | Visa ···· 3018 | RON | 0.00 lei |
| 14 | Glemis.ro | `1910602642362630` | Disabled | — | RON | 3,062.89 lei (failed) |
| 15 | Cosmoshop.ro | `329311634235033` | Closed | Visa ···· 3103 | RON | 0.00 lei |
| 16 | One Top Solution | `330682749` | Closed | — | RON | 0.00 lei |
| 17 | Casaelena.ro | `502663779755128` | Active | Visa ···· 6632 | RON | 166.37 lei |
| 18 | BeautyOne Ad Account-Primary | `1366414974116931` | Active | Visa ···· 8207 | EUR | € 42.66 |
| 19 | Eximia BG_NEW | `335356899499596` | Active | Visa ···· 7060 | EUR | € 44.90 |
| 20 | beonemedical.ro | `818842774503712` | Active | Visa ···· 1397 | RON | 498.88 lei |

**Notes:**
- Accounts 18 & 19 are **owned by BeautyOne Bulgaria** (external business)
- Account 20 is **owned by Beauty Medika** (external business)
- Closed/Disabled accounts may still have downloadable historical invoices

### Quick links — Payment Activity (invoices) per account

Base: `https://business.facebook.com/latest/billing_hub/payment_activity?business_id=264956774003853&placement=mbs_all_tools_menu&date=1642284000_1775250000`

Append `&asset_id={id}&payment_account_id={id}` with:

| Account | `asset_id` / `payment_account_id` |
|---------|-----------------------------------|
| Wow - ADS | `198341315786439` |
| Heylux - Agency | `479270316439307` |
| Team Wash Luxury | `750777705790255` |
| Casa lui Patrocle - ADS | `581072022704270` |
| FLODO GSM | `437272720519106` |
| Casaelena.ro | `502663779755128` |
| BeautyOne Ad Account-Primary | `1366414974116931` |
| Eximia BG_NEW | `335356899499596` |
| beonemedical.ro | `818842774503712` |
| Remary.ro | `3297610730280638` |
| Glemis.ro | `1910602642362630` |
| IRepair | `340871916549797` |
| Cosmoshop.ro | `329311634235033` |
| Super Joburi Iași | `899474164132021` |
| One Top Solution | `330682749` |

---

## 4. Account Details Page

Clicking an account name on the Accounts list opens the details page:

```
/latest/billing_hub/accounts/details/?
  asset_id={ad_account_id}
  &business_id=264956774003853
  &payment_account_id={ad_account_id}
  &placement=mbs_all_tools_menu
```

### Data available on this page

| Section | Fields |
|---------|--------|
| **Current balance** | Amount, currency |
| **Billing threshold** | Balance limit (e.g., `1,331.00 lei`), next billing date |
| **Payment method** | Card type, last 4 digits, expiry date, default status |
| **Daily spending limit** | Set by Meta (e.g., `1,206.47 lei`) |
| **Funds** | Prepaid balance |
| **Ad credits** | Available credits |
| **Business info** | Company name, address, currency, Tax ID (e.g., `RO43484761`) |
| **Payment history** | Link to "View transaction history" → Payment activity page |

### Example: Wow - ADS account details

```
Business name:  PROFESIONAL RENT ASSET S.R.
Address:        lfov, SNAGOV, PARTER, CAMERA, 077167 Tâncăbești, Romania
Currency:       Romanian Leu (RON)
Tax ID:         RO43484761 (verified)
Threshold:      1,331.00 lei
Daily limit:    1,206.47 lei (set by Meta)
Payment:        Visa ···· 0270, expires 12/27
```

---

## 5. Transaction List (Payment Activity)

### Page URL

```
https://business.facebook.com/latest/billing_hub/payment_activity?
  business_id={business_id}
  &asset_id={ad_account_id}
  &payment_account_id={ad_account_id}
  &placement=mbs_all_tools_menu
  &date={start_unix}_{end_unix}
```

**Lifetime filter:** `date=1642284000_1775250000` (or any wide range).

### Table columns

| Column | Example |
|--------|---------|
| Transaction ID | `8987286778048299-8987286791381631` |
| Date | `5 Mar 2025` |
| Amount | `RON844.54` |
| Payment method | `Visa ···· 0270` + reference `FANTEJLK32` |
| Payment status | `Paid` |
| VAT invoice ID | `FBADS-040-104208640` |
| Action | Download PDF (link) |

### Account selector dropdown

At the top of the Payment Activity page there's a **combobox** to switch between ad accounts without changing the URL manually. It shows `{Account Name} ({ad_account_id})`.

### GraphQL API

Facebook uses a Relay/GraphQL-based SPA. The transaction data is loaded via:

```
POST /api/graphql/
```

With form-encoded body including:
- `fb_api_req_friendly_name` — e.g., `useBizKitPageQueryQuery`
- `doc_id` — numeric GraphQL query document ID
- `variables` — JSON with `businessId`, `localScopes`, etc.
- `fb_dtsg` — CSRF token
- `lsd` — request signature

**Note:** The GraphQL queries use internal `doc_id` values that may change between deployments. Scraping the rendered HTML or using the direct download links is more reliable.

### Pagination: "See More" button

The transaction list loads ~10 items initially. Clicking **"See More"** loads more via additional GraphQL calls. The page uses cursor-based pagination internally. Keep clicking until the button disappears.

### "Download" button (bulk export)

There is a **"Download"** button at the top of the transaction table (expandable menu). This allows bulk CSV/PDF export — separate from individual PDF downloads per row.

---

## 6. Download Invoice PDF (Direct Link)

Unlike TikTok (which requires a 2-step async process), Facebook provides a **direct download URL** for each invoice.

### URL Pattern

```
https://business.facebook.com/ads/manage/billing_transaction/?
  act={ad_account_id}
  &pdf=true
  &print=false
  &source=billing_summary
  &tx_type=3
  &txid={transaction_id}
```

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `act` | string | Ad account ID (without `act_` prefix) |
| `pdf` | string | Always `true` — triggers PDF download |
| `print` | string | Always `false` |
| `source` | string | Always `billing_summary` |
| `tx_type` | number | Transaction type: `3` = payment/charge |
| `txid` | string | Transaction ID (format: `{id1}-{id2}`) |

### Optional Parameter

| Parameter | Type | Description |
|-----------|------|-------------|
| `upl_session_id` | string | Session tracking ID (optional, not required for download) |

### Example

```
GET https://business.facebook.com/ads/manage/billing_transaction/?act=198341315786439&pdf=true&print=false&source=billing_summary&tx_type=3&txid=8987286778048299-8987286791381631
```

**Response:** PDF file (binary) with `Content-Type: application/pdf`

### Key Points

- **Direct GET request** — no async task creation needed
- **Session cookies required** — must be logged in with access to the ad account
- **Returns PDF directly** — no intermediate signed URL
- **Transaction ID format** — always `{number}-{number}` (two IDs joined by dash)

---

## 7. Transaction Data Schema

Data extracted from the billing hub page for each transaction:

| Field | Type | Example | Description |
|-------|------|---------|-------------|
| `transaction_id` | string | `8987286778048299-8987286791381631` | Unique transaction ID |
| `date` | string | `5 Mar 2025` | Transaction date |
| `amount` | string | `RON844.54` | Amount with currency |
| `payment_method` | string | `Visa ···· 0270` | Card type + last 4 digits |
| `payment_reference` | string | `FANTEJLK32` | Bank reference code |
| `payment_status` | string | `Paid` | Payment status |
| `vat_invoice_id` | string | `FBADS-040-104208640` | VAT invoice serial |
| `download_url` | string | (see pattern above) | Direct PDF download link |

### VAT Invoice ID Format

```
FBADS-{entity_code}-{invoice_number}
```

Example: `FBADS-040-104208640`
- `FBADS` — Facebook Ads prefix
- `040` — Billing entity code (Ireland = 040)
- `104208640` — Sequential invoice number

### Transaction ID Format

```
{payment_group_id}-{charge_id}
```

Two numeric IDs joined by a dash. Both are needed for the download URL.

---

## 8. URL Parameters Reference

### Key IDs

| Parameter | Description | Example |
|-----------|-------------|---------|
| `business_id` | Meta Business Manager ID | `264956774003853` |
| `asset_id` | Ad account ID (= payment_account_id) | `198341315786439` |
| `payment_account_id` | Payment account (= asset_id) | `198341315786439` |
| `act` | Ad account ID (for download URLs) | `198341315786439` |

**Rule:** `asset_id` and `payment_account_id` are always the same value — the ad account ID.

### Date Range Filter

The `date` URL parameter uses **Unix timestamps** (seconds) separated by underscore:

```
date={start_timestamp}_{end_timestamp}
```

| Preset | Value |
|--------|-------|
| Lifetime | `1642284000_1775250000` (Jan 2022 – Apr 2026) |
| Last month | Calculate dynamically |
| Custom | Any two Unix timestamps |

### Common `placement` values

Always use `mbs_all_tools_menu` for Billing Hub pages.

---

## 9. Comparison with TikTok Ads

| Feature | Facebook Ads | TikTok Ads |
|---------|-------------|------------|
| **Auth** | Session cookies | Session cookies |
| **List accounts** | HTML page (`/billing_hub/accounts`) | `query_payment_account` API |
| **List invoices** | GraphQL + HTML table | REST API (`query_invoice_list`) |
| **Download** | Direct GET URL (1 step) | 2-step async (create → query → download) |
| **URL signing** | No (uses session) | Yes (signed temporary URL) |
| **Pagination** | "See More" button (cursor) | Page number + page size |
| **Invoice ID** | `FBADS-040-XXXXXXXXX` | Snowflake ID |
| **Transaction ID** | `{id1}-{id2}` | N/A (uses `invoice_id`) |
| **Steps to PDF** | 1 (direct GET) | 3 (create task → poll → GET signed URL) |
| **Needs `pa_id`** | No | Yes (`query_payment_account`) |
| **Multi-account** | Same `business_id`, swap `asset_id` | Different `adv_id` per advertiser |
| **Account details** | HTML page with business info, Tax ID | API response with `adv_info_vo` |

---

## 10. Example Flow

### Full scraping flow (all accounts, all invoices)

```
1. LOGIN to Facebook
   → Obtain session cookies (c_user, xs, datr, sb)

2. For EACH ad account in the business:

   a. NAVIGATE to Payment Activity
      → URL: /latest/billing_hub/payment_activity?
           business_id=264956774003853
           &asset_id={ad_account_id}
           &payment_account_id={ad_account_id}
           &date=1642284000_1775250000

   b. SET date filter to Lifetime (if not already via URL param)

   c. SCRAPE transaction table rows
      → Extract: transaction_id, date, amount, vat_invoice_id, download_url

   d. CLICK "See More" to load additional transactions
      → Repeat step (c) until no more "See More" button

   e. For EACH transaction, DOWNLOAD PDF:
      GET https://business.facebook.com/ads/manage/billing_transaction/
        ?act={ad_account_id}
        &pdf=true&print=false
        &source=billing_summary&tx_type=3
        &txid={transaction_id}
      → Save response as PDF file
```

### Quick single-account access

```
# Go directly to invoices for a specific account (e.g., Wow - ADS):
https://business.facebook.com/latest/billing_hub/payment_activity?business_id=264956774003853&asset_id=198341315786439&payment_account_id=198341315786439&placement=mbs_all_tools_menu&date=1642284000_1775250000

# Download a specific invoice PDF:
https://business.facebook.com/ads/manage/billing_transaction/?act=198341315786439&pdf=true&print=false&source=billing_summary&tx_type=3&txid=8987286778048299-8987286791381631
```

### Rate Limiting

- No explicit rate limits observed
- Recommended: 1-2 second delay between PDF downloads
- Facebook may rate-limit or block if too many requests too fast
- Use the same User-Agent and cookies consistently

---

## Notes

- The `act` parameter does NOT use the `act_` prefix (just the numeric ID)
- `asset_id` and `payment_account_id` are always the same value
- The `upl_session_id` parameter in download URLs is optional (analytics tracking only)
- Some transactions may not have a VAT invoice ID (e.g., ad credits with amount `RON0.04`)
- Payment methods include: Visa, MasterCard, Ad credit
- Amounts include currency prefix (e.g., `RON844.54` or `€ 44.90`)
- Closed/Disabled accounts can still have historical invoices available for download
- The "Download" button at the top of the page allows bulk CSV export (separate from individual PDFs)
- Transaction details page: `/latest/billing_hub/payment_activity/transaction_details/?transaction_id={txid}&...`
- External accounts (owned by other businesses like BeautyOne Bulgaria) may have limited access
