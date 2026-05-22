# Hosting + Checkout Email Notification Flow — Design Spec

**Date:** 2026-05-22
**Authors:** Claude + Gemini (3 rounds critique) + user decisions
**Status:** Design approved, pending user spec review

---

## Context

OTS CRM is a multi-tenant SvelteKit application used by a Romanian digital marketing agency
that resells DirectAdmin (DA) shared hosting. Today the app provisions DA accounts,
suspends them on overdue invoices, and unsuspends them on payment, but **sends zero
hosting-related emails** to customers or admins. Customers receive only a magic link
for portal access after Stripe checkout; they never receive their DA credentials, a
suspension notice, a renewal reminder, or a paid-invoice confirmation by email.

This spec defines a complete email notification flow covering 8 events across the
hosting lifecycle and Stripe checkout, built on top of the existing outbox/persistence
pattern in `src/lib/server/email.ts`.

## Goals

1. Customer receives DA credentials and welcome by email after provisioning succeeds.
2. Customer is notified when their hosting is suspended, reactivated, or about to expire.
3. Customer receives confirmation email + PDF invoice when any Stripe payment succeeds.
4. Admins are alerted internally on payment received and on provisioning failure.
5. All notifications are idempotent under retry/race conditions.
6. All notifications are tenant-scoped and audit-linked.

## Non-goals

- **Secure-link credential delivery** (one-time URL). User explicitly chose plaintext
  password in email for MVP velocity, accepting the inbox-retention security tradeoff.
  Mitigated by including a "Change Password" CTA in the welcome email.
- **Multi-locale templates.** Hardcoded Romanian (`locale: 'ro'`) for now; signature is
  future-proof but only `'ro'` is implemented.
- **Manual termination / password reset emails.** Out of scope for this iteration.
- **Backfill for existing suspended accounts.** Forward-only — accounts already in
  `status='suspended'` today will not receive a retroactive notice.

---

## Decisions

| Decision | Choice | Reasoning |
|---|---|---|
| Credential delivery | Plaintext password in welcome email | User decision, MVP speed |
| Scope | All 8 emails shipped together | User decision, complete flow |
| Grace period before suspension | 10 days from invoice overdue | User decision — gives clients enough margin for OP delays, holidays, vacation absences before any service interruption |
| Renewal cron cadence | Hourly 08-20 EET | Self-healing via dedupe table; survives missed runs |
| Auto-renewal customers | DO receive reminders (softer copy) | Customers want to know before card is charged |
| Unsuspend safety | Only if NO other hosting invoice unpaid for this account | Prevents premature reactivation on partial payment |
| Dedupe sub-1h windows | Rolling `sent_at` timestamp, NOT date buckets | Avoids midnight bucket flip |
| Orphan account email | Falls back to `inquiry.contactEmail` | Payment OK but client conversion failed |
| Admin recipient resolution | `tenantUser` role=owner/admin → `tenant.adminContactEmail` → `OPS_FALLBACK_EMAIL` env | 3-level fallback, never silent drop. `tenant.adminContactEmail` column added in this migration set (Gemini-validated decision) |
| `payment-succeeded` driver | Dispatcher calls `notifyPaymentSucceeded` directly (Option B); existing `invoice.paid` hook listener disabled | Explicit > implicit for payment-critical email; dedupe write co-located with send call (Gemini-validated decision) |
| Credential JSON structure | `{username, password}` (confirmed in code: `src/lib/server/hosting/create-account.ts:114-116` uses `encrypt(tenantId, JSON.stringify({username, password}))`) | Tenant-scoped encryption via `encrypt(tenantId, data)` from `src/lib/server/plugins/smartbill/crypto.ts:58` |

---

## Architecture

### Module layout

```
src/lib/server/hosting/
├── notifications.ts                # NEW: 6 hosting-specific notify functions
└── email-templates/                # NEW: 6 template modules
    ├── account-created.ts
    ├── suspended.ts
    ├── reactivated.ts
    ├── renewal-reminder.ts
    ├── payment-failed.ts
    └── provisioning-failed.ts

src/lib/server/stripe/
├── notifications.ts                # NEW: 2 checkout-generic notify functions
└── email-templates/                # NEW: 2 template modules
    ├── payment-succeeded.ts        # reuses sendInvoicePaidEmail
    └── admin-payment-received.ts

src/lib/server/scheduler/tasks/
└── hosting-renewal-reminder.ts     # NEW: hourly cron task

src/routes/[tenant]/api/
└── _debug-hosting-emails/+server.ts  # NEW: admin-gated debug endpoint

app/scripts/                          # demo preview scripts
├── demo-hosting-welcome-email.ts
├── demo-hosting-suspended-email.ts
├── demo-hosting-reactivated-email.ts
├── demo-hosting-renewal-reminder-email.ts
├── demo-hosting-payment-failed-email.ts
├── demo-hosting-provisioning-failed-email.ts
├── demo-payment-succeeded-email.ts
└── demo-admin-payment-received-email.ts
```

### Public API (notification functions)

All functions accept only IDs (no payloads). Data is fetched fresh from DB at send-time.
All wrap `sendWithPersistence()` from `src/lib/server/email.ts` and produce one row
in `hosting_email_event` for dedupe + one row in `email_log` for outbox.

```typescript
// src/lib/server/hosting/notifications.ts
export async function notifyHostingAccountCreated(tenantId: string, accountId: string): Promise<void>;
export async function notifyHostingSuspended(tenantId: string, accountId: string, invoiceId: string): Promise<void>;
export async function notifyHostingReactivated(tenantId: string, accountId: string, invoiceId: string): Promise<void>;
export async function notifyHostingRenewalReminder(tenantId: string, accountId: string, daysUntilDue: 1 | 7 | 14): Promise<void>;
export async function notifyHostingPaymentFailed(tenantId: string, accountId: string, invoiceId: string): Promise<void>;
export async function notifyHostingProvisioningFailed(tenantId: string, accountId: string, reason: string, attemptNumber: number): Promise<void>;

// src/lib/server/stripe/notifications.ts
export async function notifyPaymentSucceeded(tenantId: string, invoiceId: string): Promise<void>;
export async function notifyAdminPaymentReceived(tenantId: string, invoiceId: string): Promise<void>;
```

### Customer email resolver (private helper)

```typescript
// src/lib/server/hosting/notifications.ts
async function resolveCustomerEmail(account: HostingAccount): Promise<{
  email: string;
  name: string;
  source: 'client' | 'inquiry';
}> {
  // 1. account.clientId → client.email (preferred)
  if (account.clientId) {
    const client = await db.query.client.findFirst({
      where: and(eq(client.id, account.clientId), eq(client.tenantId, account.tenantId)),
    });
    if (client?.email) return { email: client.email, name: client.companyName, source: 'client' };
  }
  // 2. Fallback: inquiry where hostingAccountId = account.id
  const inquiry = await db.query.hostingInquiry.findFirst({
    where: and(eq(hostingInquiry.hostingAccountId, account.id), eq(hostingInquiry.tenantId, account.tenantId)),
  });
  if (inquiry?.contactEmail) return { email: inquiry.contactEmail, name: inquiry.contactName, source: 'inquiry' };
  // 3. No email available — orphan
  throw new OrphanAccountError(account.id);
}
```

Caller of any `notify*` function catches `OrphanAccountError` and dispatches
`notifyHostingProvisioningFailed(tenantId, accountId, 'orphan_no_customer', 1)` instead.

### Admin recipient resolver (private helper)

```typescript
// src/lib/server/hosting/notifications.ts
async function resolveAdminRecipients(tenantId: string): Promise<string[]> {
  // Level 1: tenantUser with role=owner or admin
  const users = await db.select({ email: user.email })
    .from(tenantUser)
    .innerJoin(user, eq(tenantUser.userId, user.id))
    .where(and(eq(tenantUser.tenantId, tenantId), inArray(tenantUser.role, ['owner', 'admin'])));
  if (users.length > 0) return users.map(u => u.email);

  // Level 2: tenant.adminContactEmail (column added in migration 0379)
  const t = await db.query.tenant.findFirst({ where: eq(tenant.id, tenantId) });
  if (t?.adminContactEmail) return [t.adminContactEmail];

  // Level 3: OPS_FALLBACK_EMAIL env var
  if (env.OPS_FALLBACK_EMAIL) return [env.OPS_FALLBACK_EMAIL];

  // No recipient — log critical and throw
  logCritical('admin recipient resolution failed', { tenantId });
  throw new NoAdminRecipientError(tenantId);
}
```

### Hook injection points

| Trigger (existing code) | File:approx-line | New notify call |
|---|---|---|
| Cont DA creat → status `'active'` | `src/lib/server/hosting/create-account.ts:142+` (after `UPDATE status='active'`) | `notifyHostingAccountCreated(tenantId, accountId)` (fire-and-forget, logged on error) |
| Cont DA provisioning failed → status `'failed'` | `src/lib/server/hosting/create-account.ts` (catch block) | `notifyHostingProvisioningFailed(tenantId, accountId, reason, attemptNumber)` |
| Stripe post-payment dispatcher: `da_provision` step OK | `src/lib/server/stripe/post-payment/provision-da.ts` (after link account) | (no separate call — create-account.ts already fired it) |
| Stripe post-payment dispatcher: `keez_invoice` step OK | `src/lib/server/stripe/post-payment/dispatcher.ts:200+` | `notifyPaymentSucceeded(tenantId, invoiceId)` |
| Stripe post-payment dispatcher: complete | `src/lib/server/stripe/post-payment/dispatcher.ts` (end of `runPostPaymentSteps`) | `notifyAdminPaymentReceived(tenantId, invoiceId)` |
| Invoice overdue + 10d grace → DA suspend OK | `src/lib/server/plugins/directadmin/hooks.ts:158+` | `notifyHostingSuspended(tenantId, accountId, invoiceId)` |
| Invoice paid + no other hosting invoice unpaid → DA unsuspend OK | `src/lib/server/plugins/directadmin/hooks.ts` (payment hook) | `notifyHostingReactivated(tenantId, accountId, invoiceId)` |
| Stripe `invoice.payment_failed` | `src/lib/server/stripe/webhook-handlers.ts` (new handler) | `notifyHostingPaymentFailed(tenantId, accountId, invoiceId)` |
| Cron daily 08-20 EET, due in {1,7,14}d | `src/lib/server/scheduler/tasks/hosting-renewal-reminder.ts` (NEW) | `notifyHostingRenewalReminder(tenantId, accountId, daysUntilDue)` |

All notification calls are **non-blocking** — wrapped in `try/catch` with structured log
on error. A failing notification must NOT break the underlying business operation
(provisioning, suspension, payment).

---

## Event matrix

### 1. `hosting-account-created` — welcome + credentials

| Field | Value |
|---|---|
| Trigger | `createHostingAccountInternal()` returns success with `status='active'` |
| Recipient | `resolveCustomerEmail(account)` |
| Subject | `Contul tău de hosting este activ — {domain}` |
| Content | Domain, server IP, DA username, **plaintext password**, DA panel URL `https://{serverHost}:2222`, "Schimbă parola acum" CTA → `https://{serverHost}:2222/CMD_PASSWD`, getting-started tips (FTP, MySQL, CMS install pointers) |
| Payload | `{ sendFn: 'sendHostingAccountCreatedEmail', args: [tenantId, accountId] }` |
| Dedupe key | `created` (no time component) |
| Window | Once-only |
| Category | TRANSACTIONAL critical, no List-Unsubscribe |
| Attachment | None |

### 2. `hosting-suspended`

| Field | Value |
|---|---|
| Trigger | Invoice overdue + 10-day grace + `daClient.suspendUser()` OK |
| Recipient | `resolveCustomerEmail(account)` |
| Subject | `⚠️ Contul de hosting suspendat — factură neachitată ({domain})` |
| Content | Domain, "factura {invoiceNumber} restantă din {date}", sumă datorată, **link plată directă** (Stripe Checkout pre-fill), termen reactivare automată după plată, contact support |
| Payload | `{ sendFn: 'sendHostingSuspendedEmail', args: [tenantId, accountId, invoiceId] }` |
| Dedupe key | `suspended:{invoiceId}:{dayBucketEET}` |
| Window | 24h |
| Category | TRANSACTIONAL critical |

### 3. `hosting-reactivated`

| Field | Value |
|---|---|
| Trigger | Invoice paid + NO other hosting invoice unpaid for this account + `daClient.unsuspendUser()` OK |
| Recipient | `resolveCustomerEmail(account)` |
| Subject | `✅ Hosting reactivat — {domain}` |
| Content | Confirmare plată primită ({amount} {currency}), domain disponibil din nou, link panou DA, mulțumire |
| Payload | `{ sendFn: 'sendHostingReactivatedEmail', args: [tenantId, accountId, invoiceId] }` |
| Dedupe key | `reactivated:{invoiceId}` (per-invoice; each suspend→pay cycle is independent) |
| Window | Once per invoice |
| Category | TRANSACTIONAL |

**Unsuspend safety check (must run BEFORE notify + DA unsuspend):**
```typescript
const otherUnpaid = await db.select({ id: invoice.id })
  .from(invoice)
  .innerJoin(invoiceLineItem, eq(invoice.id, invoiceLineItem.invoiceId))
  .where(and(
    eq(invoice.tenantId, tenantId),
    eq(invoiceLineItem.hostingAccountId, accountId),     // hosting-only scope
    inArray(invoice.status, ['overdue', 'sent']),
    ne(invoice.id, justPaidInvoiceId),
  ));
if (otherUnpaid.length > 0) return; // do NOT unsuspend, do NOT email
```

### 4. `hosting-renewal-reminder`

| Field | Value |
|---|---|
| Trigger | Hourly cron 08-20 EET, `nextDueDate` parses to date in {today+1d, today+7d, today+14d} (±12h tolerance), `status='active'`, no existing dedupe row |
| Recipient | `resolveCustomerEmail(account)` |
| Subject | `Hosting {domain} expiră în {daysUntilDue} {zile/zi}` |
| Content | Domain, dată exactă expirare, sumă renewal, **link plată proactivă**. Branch on `autoRenew`: |
| If `autoRenew=true` | "Vei fi taxat automat prin cardul salvat în {daysUntilDue} zile. Verifică detaliile de plată." |
| If `autoRenew=false` | "Plata manuală expiră în {daysUntilDue} zile. După această dată, hostingul va fi suspendat." |
| Payload | `{ sendFn: 'sendHostingRenewalReminderEmail', args: [tenantId, accountId, daysUntilDue] }` |
| Dedupe key | `renewal-reminder:{dueDateIso}:{daysUntilDue}d` |
| Window | Once per (account, due date, window label) |
| Category | NOTIFICATION (bulk-style) — **DOES** include `List-Unsubscribe` header per RFC 8058 |

**Scheduler query (self-healing via dedupe table):**
```sql
SELECT a.*, days_until_due
FROM hosting_account a
INNER JOIN LATERAL (
  SELECT
    CASE
      WHEN date(a.next_due_date) = date('now', '+1 day') THEN 1
      WHEN date(a.next_due_date) = date('now', '+7 days') THEN 7
      WHEN date(a.next_due_date) = date('now', '+14 days') THEN 14
    END AS days_until_due
) d ON d.days_until_due IS NOT NULL
WHERE a.status = 'active'
  AND a.next_due_date IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM hosting_email_event e
    WHERE e.hosting_account_id = a.id
      AND e.dedupe_key = 'renewal-reminder:' || a.next_due_date || ':' || d.days_until_due || 'd'
  );
```

### 5. `hosting-payment-failed`

| Field | Value |
|---|---|
| Trigger | Stripe webhook `invoice.payment_failed` (subscription invoice) with `account.stripeSubscriptionId` lookup |
| Recipient | `resolveCustomerEmail(account)` |
| Subject | `Plata pentru hosting {domain} a eșuat — acțiune necesară` |
| Content | Motiv eșec dacă disponibil (card expirat / fonduri insuficiente / etc.), termen până la suspendare (10 zile grație), **link Stripe customer portal** pentru actualizat metodă, link plată manuală OP |
| Payload | `{ sendFn: 'sendHostingPaymentFailedEmail', args: [tenantId, accountId, invoiceId] }` |
| Dedupe key | `payment-failed:{invoiceId}` |
| Window | 48h (Stripe retry storm protection) |
| Category | TRANSACTIONAL critical |

### 6. `hosting-provisioning-failed` (INTERNAL → admin)

| Field | Value |
|---|---|
| Trigger | `createHostingAccountInternal()` throws OR promotes status to `'failed'` OR `resolveCustomerEmail` throws `OrphanAccountError` |
| Recipient | `resolveAdminRecipients(tenantId)` |
| Subject | `🚨 Provisioning DA eșuat — {domain} ({tenantSlug}) — {reason}` |
| Content | Tenant, account ID, reason (`da_username_exists` / `da_create_failed` / `da_unreachable` / `orphan_no_customer`), link CRM panou hosting (deep link la cont), instrucțiuni manual reprovision |
| Payload | `{ sendFn: 'sendHostingProvisioningFailedEmail', args: [tenantId, accountId, reason, attemptNumber] }` |
| Dedupe | Rolling timestamp check: `WHERE event_type='provisioning-failed' AND hosting_account_id=? AND dedupe_key LIKE 'provisioning-failed:'||reason||':%' AND sent_at > datetime('now', '-5 minutes')` |
| Window | 5 minutes rolling |
| Category | INTERNAL, no List-Unsubscribe |

### 7. `payment-succeeded` (client)

| Field | Value |
|---|---|
| Trigger | Stripe post-payment dispatcher step `keez_invoice` returns success |
| Recipient | Client email from invoice (`invoice.client.email`) |
| Subject | `Plata confirmată — factura {invoiceNumber} ({amount} {currency})` |
| Content | Confirmare plată, sumă, dată, descriere produs/serviciu (din invoice line items), **PDF factură atașat** (de la Keez sau generator intern), link descărcare de rezervă |
| Implementation | Wire existing `sendInvoicePaidEmail(invoiceId, clientEmail)` from `src/lib/server/email.ts:1904` to dispatcher after `keez_invoice` step |
| Payload | `{ sendFn: 'sendInvoicePaidEmail', args: [invoiceId, clientEmail] }` |
| Dedupe key | `payment-succeeded:{invoiceId}` (stored in the separate `payment_email_event` table — see Schema section) |
| Window | Once per invoice |
| Category | TRANSACTIONAL, no List-Unsubscribe |

**Note**: This event is NOT hosting-specific. It fires for any Stripe payment that produced
a Keez fiscal invoice. The dedupe registry needs to accommodate non-hosting events.
**Decision** (see Schema): use a single shared `payment_email_event` table for `payment-succeeded`
and `admin-payment-received` (no hosting_account_id), keeping `hosting_email_event` strictly
for hosting events. This keeps each table's FK constraints clean.

### 8. `admin-payment-received` (INTERNAL)

| Field | Value |
|---|---|
| Trigger | Stripe post-payment dispatcher completes all steps (success OR partial) |
| Recipient | `resolveAdminRecipients(tenantId)` |
| Subject | `💰 Plată nouă: {amount} {currency} — {clientName} ({tenantSlug})` |
| Content | Tenant, client, descriere produs (line items), sumă, dată, link CRM la invoice, **status post-payment steps** (`magic_link: ok`, `keez_invoice: ok`, `da_provision: ok`) pentru triage rapid |
| Payload | `{ sendFn: 'sendAdminPaymentReceivedEmail', args: [tenantId, invoiceId] }` |
| Dedupe key | `admin-payment-received:{invoiceId}` |
| Window | Once per invoice |
| Category | INTERNAL, no List-Unsubscribe |

---

## Email types enum extension

Schema today: `email_log.email_type` is `text` column with no DB constraint. Validation
is enforced at application level via a const array.

Add to `src/lib/server/email-types.ts` (extract from `email.ts` if not extracted yet):

```typescript
export const EMAIL_TYPES = [
  // existing 16+ types
  'hosting-account-created',
  'hosting-suspended',
  'hosting-reactivated',
  'hosting-renewal-reminder',
  'hosting-payment-failed',
  'hosting-provisioning-failed',
  'payment-succeeded',
  'admin-payment-received',
] as const;

export type EmailType = typeof EMAIL_TYPES[number];
```

`sendWithPersistence()` already accepts `emailType: string` — no signature change needed.

---

## Schema changes

### New tables

#### `hosting_email_event` — hosting dedupe registry

```typescript
// src/lib/server/db/schema.ts
export const hostingEmailEvent = sqliteTable('hosting_email_event', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenant.id),
  hostingAccountId: text('hosting_account_id').notNull()
    .references(() => hostingAccount.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  dedupeKey: text('dedupe_key').notNull(),
  emailLogId: text('email_log_id').references(() => emailLog.id),
  attemptNumber: integer('attempt_number').notNull().default(1),
  sentAt: integer('sent_at', { mode: 'timestamp' }).notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});
```

#### `payment_email_event` — checkout dedupe registry (non-hosting)

```typescript
export const paymentEmailEvent = sqliteTable('payment_email_event', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenant.id),
  invoiceId: text('invoice_id').notNull().references(() => invoice.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),  // 'payment-succeeded' | 'admin-payment-received'
  dedupeKey: text('dedupe_key').notNull(),
  emailLogId: text('email_log_id').references(() => emailLog.id),
  sentAt: integer('sent_at', { mode: 'timestamp' }).notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});
```

### Coloane noi pe `hosting_account`

```typescript
// Adăugări în hostingAccount table:
suspendedAt: integer('suspended_at', { mode: 'timestamp' }),
reactivatedAt: integer('reactivated_at', { mode: 'timestamp' }),
```

### Coloană nouă pe `tenant`

```typescript
// Adăugare în tenant table:
adminContactEmail: text('admin_contact_email'),  // NULL default; fallback for ops/admin emails when no owner/admin user is configured
```

### Migrații (Drizzle, single-statement per file per Turso rule)

```
app/drizzle/0373_hosting_email_event_table.sql       → CREATE TABLE hosting_email_event
app/drizzle/0374_hosting_email_event_unique_idx.sql  → CREATE UNIQUE INDEX hosting_email_event_unique ON (tenant_id, hosting_account_id, dedupe_key)
app/drizzle/0375_payment_email_event_table.sql       → CREATE TABLE payment_email_event
app/drizzle/0376_payment_email_event_unique_idx.sql  → CREATE UNIQUE INDEX payment_email_event_unique ON (tenant_id, invoice_id, dedupe_key)
app/drizzle/0377_hosting_account_suspended_at.sql    → ALTER TABLE hosting_account ADD COLUMN suspended_at
app/drizzle/0378_hosting_account_reactivated_at.sql  → ALTER TABLE hosting_account ADD COLUMN reactivated_at
app/drizzle/0379_tenant_admin_contact_email.sql      → ALTER TABLE tenant ADD COLUMN admin_contact_email
```

7 fișiere, 7 statement-uri. `_journal.json` updated in same commit.

Post-migrate verification on Turso remote:
```sql
PRAGMA table_info(hosting_account);          -- expect suspended_at, reactivated_at
PRAGMA table_info(hosting_email_event);      -- expect 8 columns
PRAGMA table_info(payment_email_event);      -- expect 7 columns
PRAGMA table_info(tenant);                   -- expect admin_contact_email
PRAGMA index_info(hosting_email_event_unique);
PRAGMA index_info(payment_email_event_unique);
```

### Orphan FK protection (application-level, NOT DB FK)

In the `hostingInquiry` DELETE handler (find via `grep -rn "delete.*hostingInquiry\|hostingInquiry.*delete"`):
```typescript
const hasAccount = await db.select({ id: hostingAccount.id })
  .from(hostingAccount)
  .innerJoin(hostingInquiry, eq(hostingInquiry.hostingAccountId, hostingAccount.id))
  .where(eq(hostingInquiry.id, inquiryId));
if (hasAccount.length > 0) {
  throw new ApiError(409, 'Cannot delete inquiry while linked hosting account exists');
}
```

### No backfill

Existing suspended accounts → no retroactive email. Existing dedupe rows → zero (forward-only).

---

## Dedupe atomicity pattern

**Time helpers used in dedupe keys:**
- `dayBucketEET()` — returns the current date in `Europe/Bucharest` timezone as `YYYY-MM-DD`. Used for 24h dedupe windows where a midnight rollover into a new bucket is acceptable. Format: `'2026-05-22'`.

For each notify function:

```typescript
async function notifyHostingSuspended(tenantId: string, accountId: string, invoiceId: string) {
  const dedupeKey = `suspended:${invoiceId}:${dayBucketEET()}`;
  const dedupeRowId = nanoid();

  // ATOMIC insert: succeeds only if no row with same (tenantId, accountId, dedupeKey)
  const insertResult = await db.insert(hostingEmailEvent).values({
    id: dedupeRowId,
    tenantId,
    hostingAccountId: accountId,
    eventType: 'suspended',
    dedupeKey,
    sentAt: new Date(),
  }).onConflictDoNothing({
    target: [hostingEmailEvent.tenantId, hostingEmailEvent.hostingAccountId, hostingEmailEvent.dedupeKey],
  }).returning({ id: hostingEmailEvent.id });

  if (insertResult.length === 0) {
    logInfo('dedupe hit, skipping', { tenantId, accountId, dedupeKey });
    return; // already sent
  }

  // Insert succeeded → safe to send
  try {
    const { emailLogId } = await sendWithPersistence({...});
    // Backfill email_log_id on dedupe row
    await db.update(hostingEmailEvent)
      .set({ emailLogId })
      .where(eq(hostingEmailEvent.id, dedupeRowId));
  } catch (err) {
    // Send failed → leave dedupe row as marker; outbox will retry from emailLog
    // (dedupe table tracks intent-to-send, emailLog tracks actual send state)
    logError('notify failed', { dedupeRowId, err });
    throw err;
  }
}
```

For provisioning-failed (rolling window), `onConflictDoNothing` doesn't fit. Instead:
```typescript
const recent = await db.select({ id: hostingEmailEvent.id })
  .from(hostingEmailEvent)
  .where(and(
    eq(hostingEmailEvent.hostingAccountId, accountId),
    eq(hostingEmailEvent.eventType, 'provisioning-failed'),
    like(hostingEmailEvent.dedupeKey, `provisioning-failed:${reason}:%`),
    gt(hostingEmailEvent.sentAt, sql`datetime('now', '-5 minutes')`),
  ));
if (recent.length > 0) return; // recent send, skip
// else proceed with INSERT + send
```

This isn't fully atomic (TOCTOU window) but accepted for INTERNAL alert spam-prevention.
Worst case: 2 admin emails 100ms apart during a retry storm. Acceptable.

---

## Renewal scheduler implementation

```typescript
// src/lib/server/scheduler/tasks/hosting-renewal-reminder.ts
import { Queue, Worker } from 'bullmq';
// register hourly cron via existing scheduler infrastructure

export async function runHostingRenewalReminder() {
  const candidates = await db.select({
    accountId: hostingAccount.id,
    tenantId: hostingAccount.tenantId,
    nextDueDate: hostingAccount.nextDueDate,
    daysUntilDue: sql<number>`
      CASE
        WHEN date(${hostingAccount.nextDueDate}) = date('now', '+1 day') THEN 1
        WHEN date(${hostingAccount.nextDueDate}) = date('now', '+7 days') THEN 7
        WHEN date(${hostingAccount.nextDueDate}) = date('now', '+14 days') THEN 14
      END
    `.as('days_until_due'),
  })
    .from(hostingAccount)
    .where(and(
      eq(hostingAccount.status, 'active'),
      isNotNull(hostingAccount.nextDueDate),
    ));

  for (const c of candidates) {
    if (!c.daysUntilDue) continue;
    // Idempotent: notifyHostingRenewalReminder handles dedupe internally
    try {
      await notifyHostingRenewalReminder(c.tenantId, c.accountId, c.daysUntilDue as 1 | 7 | 14);
    } catch (err) {
      logError('renewal reminder failed for account', { accountId: c.accountId, err });
      // continue to next — don't abort batch
    }
  }
}
```

Schedule: `cron: '0 8-20 * * *'` in `Europe/Bucharest`. Per-run timeout: 5 min
(scheduler-level). Per-account dispatch: best-effort, structured log on error.

---

## Templates

Each template module: `src/lib/server/hosting/email-templates/{name}.ts`

```typescript
// Example: src/lib/server/hosting/email-templates/account-created.ts
import { renderBrandedEmail } from '$lib/server/email/branded-shell';

interface AccountCreatedTemplateInput {
  domain: string;
  daUsername: string;
  daPassword: string;          // plaintext, fetched fresh at send-time
  daServerHost: string;
  serverIp: string;
  clientName: string;
  locale?: 'ro';
}

export function render(input: AccountCreatedTemplateInput): { subject: string; html: string } {
  const subject = `Contul tău de hosting este activ — ${input.domain}`;
  const html = renderBrandedEmail({
    title: 'Bun venit la OTS Hosting',
    body: `
      <p>Salut ${input.clientName},</p>
      <p>Contul tău de hosting pentru <strong>${input.domain}</strong> este activ.</p>
      <h3>Date de acces</h3>
      <ul>
        <li>Domeniu: ${input.domain}</li>
        <li>IP server: ${input.serverIp}</li>
        <li>Utilizator DA: <code>${input.daUsername}</code></li>
        <li>Parolă DA: <code>${input.daPassword}</code></li>
        <li>Panou DA: <a href="https://${input.daServerHost}:2222">https://${input.daServerHost}:2222</a></li>
      </ul>
      <p>
        <strong>Recomandat:</strong> schimbă parola imediat după primul login.
        <a href="https://${input.daServerHost}:2222/CMD_PASSWD"
           style="display:inline-block;background:#0ea5e9;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;">
          Schimbă parola acum
        </a>
      </p>
      <h3>Ce urmează</h3>
      <ul>
        <li>FTP: folosește utilizatorul DA și parola de mai sus pe portul 21</li>
        <li>MySQL: creează baze de date prin panoul DA</li>
        <li>Instalare CMS (WordPress etc.): folosește Installatron din panoul DA</li>
      </ul>
    `,
  });
  return { subject, html };
}
```

Pattern identical for the other 7 templates. Subjects and copy are all Romanian per
default locale. All templates accept a `locale?: 'ro'` for future-proofing.

### Demo preview scripts

Per memoria `feedback_email_demo_preview.md`, each template gets a demo script:

```typescript
// app/scripts/demo-hosting-welcome-email.ts
import { render } from '$lib/server/hosting/email-templates/account-created';

const { subject, html } = render({
  domain: 'example.ro',
  daUsername: 'exampleus',
  daPassword: 'Demo!Pass123',
  daServerHost: 'srv1.onetopsolution.ro',
  serverIp: '185.247.117.10',
  clientName: 'Ion Popescu',
});

console.log(`<!-- Subject: ${subject} -->`);
console.log(html);
```

Run: `bun app/scripts/demo-hosting-welcome-email.ts > /tmp/preview.html && open /tmp/preview.html`.

---

## Debug endpoint

`src/routes/[tenant]/api/_debug-hosting-emails/+server.ts` — admin-gated.

```typescript
export async function GET({ url, locals }) {
  // Hard guard — admin only
  if (!locals.user || !['owner', 'admin'].includes(locals.tenantUser.role)) {
    return new Response('forbidden', { status: 403 });
  }

  const action = url.searchParams.get('action');
  switch (action) {
    case 'resend':       /* re-trigger last notify for accountId */
    case 'preview':      /* render template HTML for accountId without sending */
    case 'force-renewal-check':  /* run scheduler logic synchronously */
    case 'dedupe-table': /* dump recent hosting_email_event rows */
    default:             return new Response('unknown action', { status: 400 });
  }
}
```

Keep this endpoint forever per memoria `feedback_keep_debug_endpoints.md`.

---

## Audit, error handling, observability

- **`hosting_email_event.emailLogId`** FK to `emailLog.id` — when support hears "I never
  got my credentials," trace via: `dedupe row → email_log → smtpMessageId`.
- **`daAuditLog`** continues to track DA-side actions (create/suspend/unsuspend).
  An audit entry that produces an email gets the `emailLogId` referenced via the dedupe
  table.
- **Structured logging**: every `notify*` call uses `logInfo` on dedupe-hit (visible to
  ops via existing dashboard), `logError` on send failure.
- **Decryption retry**: `daCredentialsEncrypted` decrypt uses existing retry helper per
  memoria `feedback_decrypt_retry_pattern.md` (3 retries on `DecryptionError` with fresh
  DB read).
- **External fetch timeouts**: any HTTP call (e.g., Stripe API for invoice details)
  uses `AbortSignal.timeout(...)` per memoria `feedback_external_fetch_timeout.md`.
- **GDPR retention**: `emailLog.htmlBody` stores rendered email for admin preview. The
  plaintext password is therefore stored in `email_log.html_body` and `email_log.payload`
  values are computed on send. **Accepted risk** per user decision (plaintext MVP).
  Future: scrub `html_body` after 30 days via scheduled job (not in this scope).

---

## Testing

### Unit tests (`*.test.ts` next to source)
- **Template render**: snapshot HTML output for each of 8 templates with fixed input.
  Verify Romanian text, CTA links, password placement, branded shell wrapping.

### Integration tests (`tests/integration/hosting-notifications.test.ts`)
- For each notify function:
  - Happy path: fixture account/invoice → call → assert 1 `email_log` row + 1
    `hosting_email_event`/`payment_email_event` row + mock SMTP called with right
    subject/recipient.
  - Dedupe: call twice → assert 1 email_log row (second call returns early).
  - Recipient resolver: account without client → falls back to inquiry; without both →
    `OrphanAccountError` → `notifyHostingProvisioningFailed` is called instead.
  - Admin resolver: no tenantUser owners → falls back to `tenant.adminContactEmail` →
    then to `OPS_FALLBACK_EMAIL` env → throws `NoAdminRecipientError` if all empty.
  - Unsuspend safety: account has 2 unpaid hosting invoices; pay 1 → unsuspend is
    skipped, no reactivated email.

### Negative tests (priority — per memoria `multi-tenant` skill)
- **Cross-tenant**: tenant A calls `notifyHostingSuspended` with tenant B's accountId
  → 403 or empty result, never sends.
- **Concurrent dedupe**: 2 parallel calls with same (account, dedupe_key) → exactly 1
  email_log row created.
- **Orphan**: account with no client and no inquiry → admin alert fires, no customer
  email leaks.

### Scheduler test
- Fixture: 3 accounts with `nextDueDate` at +1d, +7d, +14d. Run scheduler twice → first
  run inserts 3 dedupe rows + 3 emails; second run inserts 0 (self-healing).

---

## Migration & rollout

1. **Schema migrations** (6 SQL files) — generate via `bun run drizzle-kit generate`,
   verify `_journal.json`, deploy via existing migration pipeline.
2. **Code changes**: notifications module, templates, hook injections, scheduler, debug
   endpoint, demo scripts, tests.
3. **Verify on Turso remote** post-migration: `PRAGMA table_info` for new tables and
   columns.
4. **Smoke test in staging tenant**:
   - Manually trigger a fresh DA provision → assert welcome email lands in test inbox
     with correct credentials and "Schimbă parola" CTA.
   - Manually mark an invoice overdue → assert suspended email fires after grace + DA
     suspend.
   - Mark invoice paid → assert reactivated email + DA unsuspend.
   - Force renewal scheduler via debug endpoint → assert 14d/7d/1d emails for fixture
     accounts.
   - Stripe test card payment → assert payment-succeeded (client) + admin-payment-received
     (admin) emails.
   - Simulate orphan: account with no client + no inquiry → assert provisioning-failed
     admin alert.
5. **Production rollout**: deploy via `hosted-cli deploy app-config.json` (per memoria
   `reference_deploy_command.md`), wait for explicit user "deploy" go-ahead.

---

## Resolved questions (decided 2026-05-22 with Gemini)

1. **`tenant.adminContactEmail` column** — **ADDED NOW** as migration `0379_tenant_admin_contact_email.sql`. Cleaner 3-tier fallback, supports non-technical owner case. Migration count: 7 (up from 6).

2. **`payment-succeeded` driver** — **OPTION B**: dispatcher calls `notifyPaymentSucceeded(tenantId, invoiceId)` directly after the `keez_invoice` step. The existing `invoice.paid` hook listener in `src/lib/server/hooks/email-notifications.ts:19-70` will be **disabled** (commented out with TODO + reason) to prevent double-send. Rationale: payment-critical email needs explicit, traceable wiring; dedupe write must be co-located with the send call.

3. **Credential JSON structure** — **CONFIRMED `{username, password}`**. Verified in code:
   - `src/lib/server/hosting/create-account.ts:114-116` — `encrypt(tenantId, JSON.stringify({username: daUsername, password: daPassword}))`
   - `src/lib/server/stripe/post-payment/provision-da.ts:200` — same pattern
   - Encryption helper: `src/lib/server/plugins/smartbill/crypto.ts:58` — `encrypt(tenantId, data)` is tenant-scoped (key derived from tenantId)
   - Decrypt at send-time: `JSON.parse(decrypt(account.tenantId, account.daCredentialsEncrypted))` → extract `.password` → embed in HTML
   - No memory-zeroing required (JS limitation, not a real concern for this risk profile)

---

## Files to touch / create

### New files
```
src/lib/server/hosting/notifications.ts
src/lib/server/hosting/email-templates/account-created.ts
src/lib/server/hosting/email-templates/suspended.ts
src/lib/server/hosting/email-templates/reactivated.ts
src/lib/server/hosting/email-templates/renewal-reminder.ts
src/lib/server/hosting/email-templates/payment-failed.ts
src/lib/server/hosting/email-templates/provisioning-failed.ts
src/lib/server/stripe/notifications.ts
src/lib/server/stripe/email-templates/payment-succeeded.ts        (or reuse existing)
src/lib/server/stripe/email-templates/admin-payment-received.ts
src/lib/server/scheduler/tasks/hosting-renewal-reminder.ts
src/routes/[tenant]/api/_debug-hosting-emails/+server.ts
app/scripts/demo-hosting-welcome-email.ts
app/scripts/demo-hosting-suspended-email.ts
app/scripts/demo-hosting-reactivated-email.ts
app/scripts/demo-hosting-renewal-reminder-email.ts
app/scripts/demo-hosting-payment-failed-email.ts
app/scripts/demo-hosting-provisioning-failed-email.ts
app/scripts/demo-payment-succeeded-email.ts
app/scripts/demo-admin-payment-received-email.ts
app/drizzle/0373_hosting_email_event_table.sql
app/drizzle/0374_hosting_email_event_unique_idx.sql
app/drizzle/0375_payment_email_event_table.sql
app/drizzle/0376_payment_email_event_unique_idx.sql
app/drizzle/0377_hosting_account_suspended_at.sql
app/drizzle/0378_hosting_account_reactivated_at.sql
app/drizzle/0379_tenant_admin_contact_email.sql
tests/integration/hosting-notifications.test.ts
```

### Modified files
```
src/lib/server/db/schema.ts                         (+ 2 tables, + 2 columns on hostingAccount, + 1 column on tenant)
src/lib/server/email.ts OR src/lib/server/email-types.ts (+ 8 email types in const array)
src/lib/server/hosting/create-account.ts            (+ notify hooks on success and failure)
src/lib/server/plugins/directadmin/hooks.ts         (+ notify hooks + unsuspend safety check + 10-day grace check)
src/lib/server/stripe/post-payment/dispatcher.ts    (+ notifyPaymentSucceeded + notifyAdminPaymentReceived)
src/lib/server/stripe/webhook-handlers.ts           (+ invoice.payment_failed handler)
src/routes/[tenant]/...inquiry DELETE handler        (+ block delete if account exists)
src/lib/server/hooks/email-notifications.ts          (DISABLE invoice.paid listener — dispatcher is now sole driver per Q2 decision)
app/drizzle/meta/_journal.json                       (+ 7 entries)
docs/superpowers/specs/2026-05-22-hosting-email-flow-design.md (this file)
```

---

## Acceptance criteria

- [ ] All 8 email types fire at the right trigger, to the right recipient, with the
  right content.
- [ ] All 8 emails are idempotent under concurrent calls (unique constraint enforced
  at DB level).
- [ ] All 8 emails are retry-safe via existing outbox replay (no plaintext in
  `email_log.payload` — only IDs).
- [ ] Customer never sees admin emails; admin never accidentally gets customer emails.
- [ ] No email fires on the wrong tenant (negative cross-tenant tests pass).
- [ ] Renewal scheduler is self-healing — missed runs don't double-send and don't
  drop reminders.
- [ ] Welcome email contains plaintext password AND "Schimbă parola acum" CTA.
- [ ] All emails are Romanian with branded shell.
- [ ] Demo scripts render previewable HTML for all 8 templates.
- [ ] Debug endpoint requires admin role.
- [ ] Migration verified on Turso remote (`PRAGMA table_info`).
- [ ] All unit + integration + negative tests green.
- [ ] Manual smoke test in staging completes all 8 flows end-to-end.

---

## Out of scope (explicit non-goals confirmed)

- Secure-link credential delivery (one-time URL with reveal page).
- DA password reset email.
- Account expired / terminated email.
- Multi-locale (only `ro` for now).
- Auto-terminate after N days suspended.
- Backfill emails for accounts already in suspended state.
- Replacement of `sendInvoicePaidEmail` — we reuse it as-is.
- PDF watermarking, digital signature on invoice.
- GDPR scrub job for `email_log.html_body` (planned for future iteration).
