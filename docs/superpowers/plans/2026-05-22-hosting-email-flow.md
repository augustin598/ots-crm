# Hosting + Checkout Email Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 8 emails covering full hosting lifecycle + Stripe checkout (welcome with DA credentials, suspend, reactivate, renewal reminders 14/7/1d, payment-failed, provisioning-failed admin alert, payment-succeeded with PDF, admin-payment-received).

**Architecture:** Notification functions wrap `sendWithPersistence()` (existing outbox). Per-event dedupe via new `hosting_email_event` + `payment_email_event` tables with unique constraints. Templates in dedicated `email-templates/` folders. Hook injections at provisioning success/failure, DA suspend/unsuspend hooks, Stripe webhook + post-payment dispatcher, and a new hourly cron task for renewal reminders.

**Tech Stack:** SvelteKit + Bun + TypeScript + Drizzle ORM + libSQL/Turso + BullMQ + nodemailer/Gmail + Stripe SDK.

**Spec reference:** [docs/superpowers/specs/2026-05-22-hosting-email-flow-design.md](../specs/2026-05-22-hosting-email-flow-design.md) — read before starting.

**Working dir:** All paths below assume `cd /Users/augustin598/Projects/CRM/app` for app code, `/Users/augustin598/Projects/CRM` for git operations.

**Test runner:** `bun test <path>` from `/Users/augustin598/Projects/CRM/app`.

---

## Task 1: Schema migrations (7 files) + verify on Turso

**Files:**
- Create: `app/drizzle/0373_hosting_email_event_table.sql`
- Create: `app/drizzle/0374_hosting_email_event_unique_idx.sql`
- Create: `app/drizzle/0375_payment_email_event_table.sql`
- Create: `app/drizzle/0376_payment_email_event_unique_idx.sql`
- Create: `app/drizzle/0377_hosting_account_suspended_at.sql`
- Create: `app/drizzle/0378_hosting_account_reactivated_at.sql`
- Create: `app/drizzle/0379_tenant_admin_contact_email.sql`
- Modify: `app/drizzle/meta/_journal.json` (add 7 entries)
- Modify: `app/src/lib/server/db/schema.ts` (add tables + columns)

- [ ] **Step 1: Write migration 0373 (hosting_email_event table)**

```sql
-- File: app/drizzle/0373_hosting_email_event_table.sql
CREATE TABLE `hosting_email_event` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL,
  `hosting_account_id` text NOT NULL,
  `event_type` text NOT NULL,
  `dedupe_key` text NOT NULL,
  `email_log_id` text,
  `attempt_number` integer DEFAULT 1 NOT NULL,
  `sent_at` integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
  FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`),
  FOREIGN KEY (`hosting_account_id`) REFERENCES `hosting_account`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`email_log_id`) REFERENCES `email_log`(`id`)
);
```

- [ ] **Step 2: Write migration 0374 (unique index)**

```sql
-- File: app/drizzle/0374_hosting_email_event_unique_idx.sql
CREATE UNIQUE INDEX `hosting_email_event_unique` ON `hosting_email_event` (`tenant_id`, `hosting_account_id`, `dedupe_key`);
```

- [ ] **Step 3: Write migration 0375 (payment_email_event table)**

```sql
-- File: app/drizzle/0375_payment_email_event_table.sql
CREATE TABLE `payment_email_event` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL,
  `invoice_id` text NOT NULL,
  `event_type` text NOT NULL,
  `dedupe_key` text NOT NULL,
  `email_log_id` text,
  `sent_at` integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
  FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`),
  FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`email_log_id`) REFERENCES `email_log`(`id`)
);
```

- [ ] **Step 4: Write migration 0376 (unique index)**

```sql
-- File: app/drizzle/0376_payment_email_event_unique_idx.sql
CREATE UNIQUE INDEX `payment_email_event_unique` ON `payment_email_event` (`tenant_id`, `invoice_id`, `dedupe_key`);
```

- [ ] **Step 5: Write migration 0377 (hosting_account.suspended_at)**

```sql
-- File: app/drizzle/0377_hosting_account_suspended_at.sql
ALTER TABLE `hosting_account` ADD COLUMN `suspended_at` integer;
```

- [ ] **Step 6: Write migration 0378 (hosting_account.reactivated_at)**

```sql
-- File: app/drizzle/0378_hosting_account_reactivated_at.sql
ALTER TABLE `hosting_account` ADD COLUMN `reactivated_at` integer;
```

- [ ] **Step 7: Write migration 0379 (tenant.admin_contact_email)**

```sql
-- File: app/drizzle/0379_tenant_admin_contact_email.sql
ALTER TABLE `tenant` ADD COLUMN `admin_contact_email` text;
```

- [ ] **Step 8: Update `app/drizzle/meta/_journal.json`**

Read the current file, find the last entry's `idx`, then append 7 new entries. Each entry follows existing pattern:

```json
{
  "idx": <last_idx + 1>,
  "version": "6",
  "when": <Date.now() in ms>,
  "tag": "0373_hosting_email_event_table",
  "breakpoints": true
}
```

Add one per migration (0373 through 0379) with sequential `idx` values and increasing `when` timestamps (use `Date.now()` from `bun -e 'console.log(Date.now())'`).

Run: `cd /Users/augustin598/Projects/CRM/app && bun -e 'console.log(Date.now())'` to get a base timestamp; increment by 1000 per entry.

- [ ] **Step 9: Update `schema.ts` — add new tables + columns**

In `src/lib/server/db/schema.ts`:

(a) Add to existing `hostingAccount` table definition (find `export const hostingAccount = sqliteTable('hosting_account', {`):

```typescript
suspendedAt: integer('suspended_at', { mode: 'timestamp' }),
reactivatedAt: integer('reactivated_at', { mode: 'timestamp' }),
```

Insert these next to other timestamp columns (after `updatedAt` or similar).

(b) Add to existing `tenant` table definition:

```typescript
adminContactEmail: text('admin_contact_email'),
```

(c) Add two new tables at the end of the schema (before any final exports):

```typescript
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
}, (t) => ({
  uniq: uniqueIndex('hosting_email_event_unique').on(t.tenantId, t.hostingAccountId, t.dedupeKey),
}));

export const paymentEmailEvent = sqliteTable('payment_email_event', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => tenant.id),
  invoiceId: text('invoice_id').notNull()
    .references(() => invoice.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  dedupeKey: text('dedupe_key').notNull(),
  emailLogId: text('email_log_id').references(() => emailLog.id),
  sentAt: integer('sent_at', { mode: 'timestamp' }).notNull()
    .default(sql`CURRENT_TIMESTAMP`),
}, (t) => ({
  uniq: uniqueIndex('payment_email_event_unique').on(t.tenantId, t.invoiceId, t.dedupeKey),
}));
```

If `uniqueIndex` is not imported, add it: `import { ..., uniqueIndex, sql } from 'drizzle-orm/sqlite-core';`. If `sql` is not imported, add `import { sql } from 'drizzle-orm';`.

- [ ] **Step 10: Run migrations locally**

Run: `cd /Users/augustin598/Projects/CRM/app && bun run db:migrate`
Expected: 7 new migrations applied, no errors.

- [ ] **Step 11: Verify on Turso remote**

Per memory `feedback_migration_flow.md`, verify the columns exist on the remote DB. Use the existing turso connection (already configured for the project):

Run: `cd /Users/augustin598/Projects/CRM/app && bun -e "import { db } from './src/lib/server/db'; const r = await db.run('PRAGMA table_info(hosting_email_event)'); console.log(r.rows);"`

Expected: 8 columns listed (id, tenant_id, hosting_account_id, event_type, dedupe_key, email_log_id, attempt_number, sent_at).

Repeat for `payment_email_event`, `hosting_account` (verify suspended_at + reactivated_at), `tenant` (verify admin_contact_email).

- [ ] **Step 12: Commit**

```bash
cd /Users/augustin598/Projects/CRM
git add app/drizzle/0373_*.sql app/drizzle/0374_*.sql app/drizzle/0375_*.sql app/drizzle/0376_*.sql app/drizzle/0377_*.sql app/drizzle/0378_*.sql app/drizzle/0379_*.sql app/drizzle/meta/_journal.json app/src/lib/server/db/schema.ts
git commit -m "$(cat <<'EOF'
feat(hosting-email-flow): schema for email dedupe registry + tenant admin contact

- 2 new tables: hosting_email_event, payment_email_event (with unique indexes)
- hosting_account: + suspended_at, reactivated_at
- tenant: + admin_contact_email

Migrations 0373-0379 (single-statement per Turso rule).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Email types extension + locale type

**Files:**
- Modify: `app/src/lib/server/email.ts` (find existing `EMAIL_TYPES` const or `emailType` validation; if absent, create a new file)
- Create: `app/src/lib/server/email-types.ts` (only if no central const exists today)
- Create: `app/src/lib/server/email-types.test.ts`

- [ ] **Step 1: Locate the email type registry**

Run: `cd /Users/augustin598/Projects/CRM/app && grep -n "EMAIL_TYPES\|emailType.*=.*\[" src/lib/server/email.ts | head -10`

If an `EMAIL_TYPES` const array exists, modify it in place. If not, create the file in Step 2.

- [ ] **Step 2: Create or extend `EMAIL_TYPES`**

If creating new file `src/lib/server/email-types.ts`:

```typescript
export const EMAIL_TYPES = [
  'invitation',
  'invoice',
  'magic-link',
  'admin-magic-link',
  'password-reset',
  'task-assignment',
  'task-update',
  'task-reminder',
  'task-client-notification',
  'daily-reminder',
  'contract-signing',
  'invoice-paid',
  'invoice-overdue-reminder',
  'ad-payment-alert',
  'ad-payment-digest',
  'package-request',
  'report',
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

export function isEmailType(value: string): value is EmailType {
  return (EMAIL_TYPES as readonly string[]).includes(value);
}
```

If `EMAIL_TYPES` already exists in `email.ts`, append the 8 new values to the existing array literal and export `EmailType`.

- [ ] **Step 3: Write the failing test**

```typescript
// File: app/src/lib/server/email-types.test.ts
import { describe, test, expect } from 'bun:test';
import { EMAIL_TYPES, isEmailType } from './email-types';

describe('EMAIL_TYPES', () => {
  test('includes all 8 hosting + checkout types', () => {
    expect(EMAIL_TYPES).toContain('hosting-account-created');
    expect(EMAIL_TYPES).toContain('hosting-suspended');
    expect(EMAIL_TYPES).toContain('hosting-reactivated');
    expect(EMAIL_TYPES).toContain('hosting-renewal-reminder');
    expect(EMAIL_TYPES).toContain('hosting-payment-failed');
    expect(EMAIL_TYPES).toContain('hosting-provisioning-failed');
    expect(EMAIL_TYPES).toContain('payment-succeeded');
    expect(EMAIL_TYPES).toContain('admin-payment-received');
  });

  test('isEmailType narrows correctly', () => {
    expect(isEmailType('hosting-account-created')).toBe(true);
    expect(isEmailType('not-a-real-type')).toBe(false);
  });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/lib/server/email-types.test.ts`
Expected: 2 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/server/email-types.ts app/src/lib/server/email-types.test.ts
git commit -m "feat(email): extend EMAIL_TYPES with 8 hosting + checkout types"
```

---

## Task 3: Time helper `dayBucketEET`

**Files:**
- Create: `app/src/lib/server/hosting/notifications-helpers.ts`
- Create: `app/src/lib/server/hosting/__tests__/notifications-helpers.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// File: app/src/lib/server/hosting/__tests__/notifications-helpers.test.ts
import { describe, test, expect } from 'bun:test';
import { dayBucketEET } from '../notifications-helpers';

describe('dayBucketEET', () => {
  test('returns YYYY-MM-DD format for current date in Europe/Bucharest', () => {
    const result = dayBucketEET(new Date('2026-05-22T10:00:00Z'));
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('returns same bucket for dates within same EET calendar day', () => {
    // 2026-05-22 01:00 EET = 2026-05-21 23:00 UTC (EET = UTC+3 in May)
    const a = dayBucketEET(new Date('2026-05-21T23:00:00Z'));
    // 2026-05-22 22:00 EET = 2026-05-22 19:00 UTC
    const b = dayBucketEET(new Date('2026-05-22T19:00:00Z'));
    expect(a).toBe('2026-05-22');
    expect(b).toBe('2026-05-22');
  });

  test('handles DST transition correctly', () => {
    // Romania uses Europe/Bucharest: EET (UTC+2) winter, EEST (UTC+3) summer
    const summer = dayBucketEET(new Date('2026-07-15T22:00:00Z'));
    expect(summer).toBe('2026-07-16'); // already next day in EEST
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/server/hosting/__tests__/notifications-helpers.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `dayBucketEET`**

```typescript
// File: app/src/lib/server/hosting/notifications-helpers.ts
/**
 * Returns the calendar date in Europe/Bucharest as YYYY-MM-DD.
 * Used as a 24h dedupe bucket where midnight rollover into a new bucket is
 * acceptable.
 */
export function dayBucketEET(now: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Bucharest',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(now); // sv-SE locale gives YYYY-MM-DD format
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/lib/server/hosting/__tests__/notifications-helpers.test.ts`
Expected: 3 pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/server/hosting/notifications-helpers.ts app/src/lib/server/hosting/__tests__/notifications-helpers.test.ts
git commit -m "feat(hosting): add dayBucketEET time helper for dedupe keys"
```

---

## Task 4: `resolveCustomerEmail` + `resolveAdminRecipients` helpers

**Files:**
- Modify: `app/src/lib/server/hosting/notifications-helpers.ts`
- Modify: `app/src/lib/server/hosting/__tests__/notifications-helpers.test.ts`

- [ ] **Step 1: Add error classes + types to helpers file**

Append to `notifications-helpers.ts`:

```typescript
import { db } from '$lib/server/db';
import { eq, and, inArray } from 'drizzle-orm';
import {
  client as clientTable,
  hostingInquiry,
  tenantUser,
  user as userTable,
  tenant as tenantTable,
  hostingAccount as hostingAccountTable,
} from '$lib/server/db/schema';
import { env } from '$env/dynamic/private';

export class OrphanAccountError extends Error {
  constructor(public readonly accountId: string) {
    super(`hosting account ${accountId} has no client and no inquiry`);
  }
}

export class NoAdminRecipientError extends Error {
  constructor(public readonly tenantId: string) {
    super(`no admin recipient resolvable for tenant ${tenantId}`);
  }
}

export interface ResolvedCustomer {
  email: string;
  name: string;
  source: 'client' | 'inquiry';
}

export async function resolveCustomerEmail(account: {
  id: string;
  tenantId: string;
  clientId: string | null;
}): Promise<ResolvedCustomer> {
  if (account.clientId) {
    const [client] = await db.select({
      email: clientTable.email,
      name: clientTable.companyName,
    })
      .from(clientTable)
      .where(and(
        eq(clientTable.id, account.clientId),
        eq(clientTable.tenantId, account.tenantId),
      ))
      .limit(1);
    if (client?.email) {
      return { email: client.email, name: client.name ?? client.email, source: 'client' };
    }
  }
  const [inquiry] = await db.select({
    email: hostingInquiry.contactEmail,
    name: hostingInquiry.contactName,
  })
    .from(hostingInquiry)
    .where(and(
      eq(hostingInquiry.hostingAccountId, account.id),
      eq(hostingInquiry.tenantId, account.tenantId),
    ))
    .limit(1);
  if (inquiry?.email) {
    return { email: inquiry.email, name: inquiry.name ?? inquiry.email, source: 'inquiry' };
  }
  throw new OrphanAccountError(account.id);
}

export async function resolveAdminRecipients(tenantId: string): Promise<string[]> {
  const users = await db.select({ email: userTable.email })
    .from(tenantUser)
    .innerJoin(userTable, eq(tenantUser.userId, userTable.id))
    .where(and(
      eq(tenantUser.tenantId, tenantId),
      inArray(tenantUser.role, ['owner', 'admin']),
    ));
  if (users.length > 0) return users.map((u) => u.email).filter((e): e is string => !!e);

  const [t] = await db.select({ email: tenantTable.adminContactEmail })
    .from(tenantTable)
    .where(eq(tenantTable.id, tenantId))
    .limit(1);
  if (t?.email) return [t.email];

  if (env.OPS_FALLBACK_EMAIL) return [env.OPS_FALLBACK_EMAIL];

  throw new NoAdminRecipientError(tenantId);
}
```

- [ ] **Step 2: Add tests for resolvers**

Append to `notifications-helpers.test.ts`:

```typescript
import { resolveCustomerEmail, resolveAdminRecipients, OrphanAccountError, NoAdminRecipientError } from '../notifications-helpers';
import { db } from '$lib/server/db';
import * as schema from '$lib/server/db/schema';
import { nanoid } from 'nanoid';

describe('resolveCustomerEmail', () => {
  let tenantId: string;

  test('prefers client.email when clientId present', async () => {
    tenantId = nanoid();
    const clientId = nanoid();
    const accountId = nanoid();
    await db.insert(schema.tenant).values({ id: tenantId, slug: `t-${tenantId.slice(0, 8)}`, name: 'T' });
    await db.insert(schema.client).values({ id: clientId, tenantId, email: 'client@example.ro', companyName: 'Acme SRL' });
    const result = await resolveCustomerEmail({ id: accountId, tenantId, clientId });
    expect(result.email).toBe('client@example.ro');
    expect(result.source).toBe('client');
  });

  test('falls back to inquiry.contactEmail when client has no email', async () => {
    const t2 = nanoid();
    const accountId = nanoid();
    await db.insert(schema.tenant).values({ id: t2, slug: `t-${t2.slice(0, 8)}`, name: 'T' });
    await db.insert(schema.hostingInquiry).values({
      id: nanoid(), tenantId: t2, hostingAccountId: accountId,
      contactName: 'Ion Popescu', contactEmail: 'ion@example.ro',
      status: 'converted', paymentStatus: 'paid',
    });
    const result = await resolveCustomerEmail({ id: accountId, tenantId: t2, clientId: null });
    expect(result.email).toBe('ion@example.ro');
    expect(result.source).toBe('inquiry');
  });

  test('throws OrphanAccountError when no client and no inquiry', async () => {
    const t3 = nanoid();
    const accountId = nanoid();
    await db.insert(schema.tenant).values({ id: t3, slug: `t-${t3.slice(0, 8)}`, name: 'T' });
    expect(resolveCustomerEmail({ id: accountId, tenantId: t3, clientId: null }))
      .rejects.toThrow(OrphanAccountError);
  });
});

describe('resolveAdminRecipients', () => {
  test('prefers tenantUser owners + admins', async () => {
    const t = nanoid();
    const u = nanoid();
    await db.insert(schema.tenant).values({ id: t, slug: `t-${t.slice(0,8)}`, name: 'T' });
    await db.insert(schema.user).values({ id: u, email: 'owner@example.ro', name: 'Owner' });
    await db.insert(schema.tenantUser).values({ tenantId: t, userId: u, role: 'owner' });
    const result = await resolveAdminRecipients(t);
    expect(result).toContain('owner@example.ro');
  });

  test('falls back to tenant.adminContactEmail when no owner/admin users', async () => {
    const t = nanoid();
    await db.insert(schema.tenant).values({ id: t, slug: `t-${t.slice(0,8)}`, name: 'T', adminContactEmail: 'fallback@example.ro' });
    const result = await resolveAdminRecipients(t);
    expect(result).toEqual(['fallback@example.ro']);
  });

  test('falls back to OPS_FALLBACK_EMAIL env when no owners and no column', async () => {
    process.env.OPS_FALLBACK_EMAIL = 'ops@example.ro';
    const t = nanoid();
    await db.insert(schema.tenant).values({ id: t, slug: `t-${t.slice(0,8)}`, name: 'T' });
    const result = await resolveAdminRecipients(t);
    expect(result).toEqual(['ops@example.ro']);
    delete process.env.OPS_FALLBACK_EMAIL;
  });

  test('throws NoAdminRecipientError when all fallbacks empty', async () => {
    delete process.env.OPS_FALLBACK_EMAIL;
    const t = nanoid();
    await db.insert(schema.tenant).values({ id: t, slug: `t-${t.slice(0,8)}`, name: 'T' });
    expect(resolveAdminRecipients(t)).rejects.toThrow(NoAdminRecipientError);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `bun test src/lib/server/hosting/__tests__/notifications-helpers.test.ts`
Expected: 3 pass for dayBucketEET + 7 pass for resolvers = 10 total.

- [ ] **Step 4: Commit**

```bash
git add app/src/lib/server/hosting/notifications-helpers.ts app/src/lib/server/hosting/__tests__/notifications-helpers.test.ts
git commit -m "feat(hosting): resolveCustomerEmail + resolveAdminRecipients with 3-tier fallback"
```

---

## Task 5: Welcome email template (`account-created`)

**Files:**
- Create: `app/src/lib/server/hosting/email-templates/account-created.ts`
- Create: `app/src/lib/server/hosting/email-templates/__tests__/account-created.test.ts`
- Create: `app/scripts/demo-hosting-welcome-email.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// File: app/src/lib/server/hosting/email-templates/__tests__/account-created.test.ts
import { describe, test, expect } from 'bun:test';
import { render } from '../account-created';

describe('account-created template', () => {
  const fixture = {
    domain: 'example.ro',
    daUsername: 'exampleus',
    daPassword: 'Demo!Pass123',
    daServerHost: 'srv1.onetopsolution.ro',
    serverIp: '185.247.117.10',
    clientName: 'Ion Popescu',
  };

  test('subject contains domain', () => {
    const { subject } = render(fixture);
    expect(subject).toContain('example.ro');
  });

  test('html contains plaintext password and Change Password CTA', () => {
    const { html } = render(fixture);
    expect(html).toContain('Demo!Pass123');
    expect(html).toContain('Schimbă parola');
    expect(html).toContain('CMD_PASSWD');
  });

  test('html contains DA panel URL with :2222 port', () => {
    const { html } = render(fixture);
    expect(html).toContain('https://srv1.onetopsolution.ro:2222');
  });

  test('html addresses customer by name', () => {
    const { html } = render(fixture);
    expect(html).toContain('Ion Popescu');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/server/hosting/email-templates/__tests__/account-created.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement template**

First locate the branded shell helper:

Run: `grep -n "renderBrandedEmail\|export function renderBranded" src/lib/server/email.ts | head -3`

Note the import path — use the same import pattern existing templates use.

```typescript
// File: app/src/lib/server/hosting/email-templates/account-created.ts
import { renderBrandedEmail } from '$lib/server/email'; // adjust import path to match codebase

export interface AccountCreatedInput {
  domain: string;
  daUsername: string;
  daPassword: string;
  daServerHost: string;
  serverIp: string;
  clientName: string;
  locale?: 'ro';
}

export function render(input: AccountCreatedInput): { subject: string; html: string } {
  const subject = `Contul tău de hosting este activ — ${input.domain}`;
  const panelUrl = `https://${input.daServerHost}:2222`;
  const changePasswordUrl = `${panelUrl}/CMD_PASSWD`;

  const body = `
    <p>Salut <strong>${escapeHtml(input.clientName)}</strong>,</p>
    <p>Contul tău de hosting pentru <strong>${escapeHtml(input.domain)}</strong> este activ și gata de folosit.</p>

    <h3 style="margin-top:24px;">Date de acces</h3>
    <table style="border-collapse:collapse;width:100%;max-width:480px;">
      <tr><td style="padding:6px 0;color:#666;">Domeniu</td><td style="padding:6px 0;"><strong>${escapeHtml(input.domain)}</strong></td></tr>
      <tr><td style="padding:6px 0;color:#666;">IP server</td><td style="padding:6px 0;"><code>${escapeHtml(input.serverIp)}</code></td></tr>
      <tr><td style="padding:6px 0;color:#666;">Utilizator DA</td><td style="padding:6px 0;"><code>${escapeHtml(input.daUsername)}</code></td></tr>
      <tr><td style="padding:6px 0;color:#666;">Parolă DA</td><td style="padding:6px 0;"><code>${escapeHtml(input.daPassword)}</code></td></tr>
      <tr><td style="padding:6px 0;color:#666;">Panou DA</td><td style="padding:6px 0;"><a href="${panelUrl}">${panelUrl}</a></td></tr>
    </table>

    <p style="margin-top:24px;">
      <strong>Recomandat:</strong> schimbă parola imediat după primul login.
    </p>
    <p>
      <a href="${changePasswordUrl}"
         style="display:inline-block;background:#0ea5e9;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">
        Schimbă parola acum
      </a>
    </p>

    <h3 style="margin-top:32px;">Ce urmează</h3>
    <ul>
      <li><strong>FTP:</strong> folosește utilizatorul DA și parola de mai sus pe portul 21</li>
      <li><strong>MySQL:</strong> creează baze de date prin panoul DA → MySQL Management</li>
      <li><strong>Instalare CMS (WordPress etc.):</strong> folosește Installatron din panoul DA</li>
    </ul>

    <p style="margin-top:32px;color:#666;font-size:13px;">
      Dacă ai întrebări, răspunde direct la acest email.
    </p>
  `;

  const html = renderBrandedEmail({ title: 'Bun venit la OTS Hosting', body });
  return { subject, html };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] as string));
}
```

If `renderBrandedEmail` has a different signature or location in this codebase, adapt the call accordingly (run the grep from Step 3 first).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/lib/server/hosting/email-templates/__tests__/account-created.test.ts`
Expected: 4 pass.

- [ ] **Step 5: Create demo preview script**

```typescript
// File: app/scripts/demo-hosting-welcome-email.ts
import { render } from '../src/lib/server/hosting/email-templates/account-created';

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

Run: `bun app/scripts/demo-hosting-welcome-email.ts > /tmp/welcome-preview.html && open /tmp/welcome-preview.html`
Expected: HTML opens in browser, shows welcome email with credentials and CTA.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/server/hosting/email-templates/account-created.ts app/src/lib/server/hosting/email-templates/__tests__/account-created.test.ts app/scripts/demo-hosting-welcome-email.ts
git commit -m "feat(hosting): welcome email template (account-created) with plaintext credentials + Change Password CTA"
```

---

## Task 6: `notifyHostingAccountCreated` function with atomic dedupe

**Files:**
- Create: `app/src/lib/server/hosting/notifications.ts`
- Create: `app/src/lib/server/hosting/__tests__/notifications.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// File: app/src/lib/server/hosting/__tests__/notifications.test.ts
import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { db } from '$lib/server/db';
import * as schema from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { notifyHostingAccountCreated } from '../notifications';

describe('notifyHostingAccountCreated', () => {
  let tenantId: string;
  let accountId: string;
  let clientId: string;
  let daServerId: string;

  beforeEach(async () => {
    tenantId = nanoid();
    accountId = nanoid();
    clientId = nanoid();
    daServerId = nanoid();
    await db.insert(schema.tenant).values({ id: tenantId, slug: `t-${tenantId.slice(0,8)}`, name: 'T' });
    await db.insert(schema.client).values({ id: clientId, tenantId, email: 'client@example.ro', companyName: 'Acme' });
    await db.insert(schema.daServer).values({
      id: daServerId, tenantId, name: 'srv1', host: 'srv1.example.ro',
      port: 2222, apiUsername: 'admin', apiPasswordEncrypted: 'enc',
    });
    await db.insert(schema.hostingAccount).values({
      id: accountId, tenantId, clientId, daServerId,
      daUsername: 'exampleus', domain: 'example.ro', status: 'active',
      daCredentialsEncrypted: null, // see below — test sets it via encrypt helper
    });
  });

  test('writes exactly 1 email_log + 1 hosting_email_event row on success', async () => {
    // Pre-condition: encrypt and store credentials so notify can decrypt them
    const { encrypt } = await import('$lib/server/plugins/smartbill/crypto');
    const credentialsEncrypted = encrypt(tenantId, JSON.stringify({ username: 'exampleus', password: 'Demo!Pass123' }));
    await db.update(schema.hostingAccount)
      .set({ daCredentialsEncrypted: credentialsEncrypted })
      .where(eq(schema.hostingAccount.id, accountId));

    await notifyHostingAccountCreated(tenantId, accountId);

    const logs = await db.select().from(schema.emailLog)
      .where(and(eq(schema.emailLog.tenantId, tenantId), eq(schema.emailLog.emailType, 'hosting-account-created')));
    expect(logs.length).toBe(1);
    expect(logs[0]!.toEmail).toBe('client@example.ro');

    const events = await db.select().from(schema.hostingEmailEvent)
      .where(and(eq(schema.hostingEmailEvent.hostingAccountId, accountId), eq(schema.hostingEmailEvent.eventType, 'created')));
    expect(events.length).toBe(1);
    expect(events[0]!.emailLogId).toBe(logs[0]!.id);
  });

  test('dedupe: second call is a no-op (still exactly 1 email_log)', async () => {
    const { encrypt } = await import('$lib/server/plugins/smartbill/crypto');
    await db.update(schema.hostingAccount)
      .set({ daCredentialsEncrypted: encrypt(tenantId, JSON.stringify({ username: 'exampleus', password: 'Demo!Pass123' })) })
      .where(eq(schema.hostingAccount.id, accountId));

    await notifyHostingAccountCreated(tenantId, accountId);
    await notifyHostingAccountCreated(tenantId, accountId);

    const logs = await db.select().from(schema.emailLog)
      .where(and(eq(schema.emailLog.tenantId, tenantId), eq(schema.emailLog.emailType, 'hosting-account-created')));
    expect(logs.length).toBe(1);
  });

  test('cross-tenant: throws if account belongs to different tenant', async () => {
    const otherTenant = nanoid();
    await db.insert(schema.tenant).values({ id: otherTenant, slug: `o-${otherTenant.slice(0,8)}`, name: 'O' });
    expect(notifyHostingAccountCreated(otherTenant, accountId))
      .rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/server/hosting/__tests__/notifications.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `notifyHostingAccountCreated`**

```typescript
// File: app/src/lib/server/hosting/notifications.ts
import { db } from '$lib/server/db';
import { eq, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import {
  hostingAccount,
  hostingEmailEvent,
  daServer,
} from '$lib/server/db/schema';
import { decrypt } from '$lib/server/plugins/smartbill/crypto';
import { sendWithPersistence } from '$lib/server/email';
import { resolveCustomerEmail, OrphanAccountError } from './notifications-helpers';
import { render as renderAccountCreated } from './email-templates/account-created';
import { logInfo, logError, logCritical } from '$lib/server/logger';

export async function notifyHostingAccountCreated(
  tenantId: string,
  accountId: string,
): Promise<void> {
  const [account] = await db.select()
    .from(hostingAccount)
    .where(and(eq(hostingAccount.id, accountId), eq(hostingAccount.tenantId, tenantId)))
    .limit(1);
  if (!account) {
    throw new Error(`hosting account ${accountId} not found for tenant ${tenantId}`);
  }
  if (!account.daCredentialsEncrypted) {
    throw new Error(`hosting account ${accountId} has no encrypted credentials`);
  }

  const dedupeKey = 'created';
  const dedupeRowId = nanoid();
  const inserted = await db.insert(hostingEmailEvent).values({
    id: dedupeRowId,
    tenantId,
    hostingAccountId: accountId,
    eventType: 'created',
    dedupeKey,
    sentAt: new Date(),
  }).onConflictDoNothing({
    target: [hostingEmailEvent.tenantId, hostingEmailEvent.hostingAccountId, hostingEmailEvent.dedupeKey],
  }).returning({ id: hostingEmailEvent.id });

  if (inserted.length === 0) {
    logInfo('notifyHostingAccountCreated dedupe hit', { tenantId, accountId });
    return;
  }

  try {
    const customer = await resolveCustomerEmail({
      id: account.id, tenantId: account.tenantId, clientId: account.clientId,
    });

    const [server] = await db.select({ host: daServer.host, ip: daServer.host })
      .from(daServer)
      .where(eq(daServer.id, account.daServerId))
      .limit(1);
    if (!server) throw new Error(`daServer ${account.daServerId} not found`);

    let creds: { username: string; password: string };
    try {
      creds = JSON.parse(decrypt(tenantId, account.daCredentialsEncrypted));
    } catch (err) {
      logError('decrypt credentials failed', { accountId, err });
      throw err;
    }

    const { subject, html } = renderAccountCreated({
      domain: account.domain,
      daUsername: creds.username,
      daPassword: creds.password,
      daServerHost: server.host,
      serverIp: server.ip,
      clientName: customer.name,
    });

    const emailLogId = await sendWithPersistence({
      tenantId,
      toEmail: customer.email,
      subject,
      html,
      emailType: 'hosting-account-created',
      payload: { sendFn: 'sendHostingAccountCreatedEmail', args: [tenantId, accountId] },
    });

    await db.update(hostingEmailEvent)
      .set({ emailLogId })
      .where(eq(hostingEmailEvent.id, dedupeRowId));
  } catch (err) {
    if (err instanceof OrphanAccountError) {
      logCritical('orphan account on welcome email', { tenantId, accountId });
      // Caller should trigger notifyHostingProvisioningFailed in this case;
      // we leave the dedupe row in place so we don't retry forever.
    } else {
      logError('notifyHostingAccountCreated failed', { tenantId, accountId, err });
    }
    throw err;
  }
}
```

**Note**: `sendWithPersistence` is the existing function in `email.ts`. Adapt its argument shape to the actual signature — check via `grep -n "function sendWithPersistence\|sendWithPersistence(ctx" src/lib/server/email.ts | head -3`. The function returns the `emailLog` row ID; if it returns something different (e.g., the full row), adapt the assignment.

Also adapt logger imports — check `grep -n "logInfo\|logError\|logCritical" src/lib/server/logger.ts | head -5`. If the logger module has different exports, adjust.

- [ ] **Step 4: Run tests**

Run: `bun test src/lib/server/hosting/__tests__/notifications.test.ts`
Expected: 3 pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/server/hosting/notifications.ts app/src/lib/server/hosting/__tests__/notifications.test.ts
git commit -m "feat(hosting): notifyHostingAccountCreated with atomic dedupe"
```

---

## Task 7: Hook welcome notification into `create-account.ts` (success path)

**Files:**
- Modify: `app/src/lib/server/hosting/create-account.ts`

- [ ] **Step 1: Locate the success branch**

Run: `grep -n "status.*=.*'active'\|status.*active.*UPDATE\|UPDATE.*status.*active" src/lib/server/hosting/create-account.ts | head -5`

Identify the line where the row is updated from `status='pending'` to `status='active'` after DA `createUserAccount` returns.

- [ ] **Step 2: Add the notify call after status promotion**

After the `db.update(hostingAccount).set({ status: 'active', ... })` block (and after `runWithAudit` resolves successfully), inject:

```typescript
// Fire welcome email — best-effort, never block the provisioning return value.
notifyHostingAccountCreated(tenantId, id).catch((err) => {
  logError('welcome email failed to dispatch', { tenantId, accountId: id, err });
});
```

Add the import at top of file:

```typescript
import { notifyHostingAccountCreated } from './notifications';
```

If `logError` isn't already imported here, add it from `$lib/server/logger`.

- [ ] **Step 3: Manual verification (no automated test for this hook)**

The unit test for `notifyHostingAccountCreated` already covers the function itself. This task only wires it into the create flow; full coverage comes from the smoke test (Task 13).

Run: `cd /Users/augustin598/Projects/CRM/app && bunx --bun svelte-check --threshold warning src/lib/server/hosting/create-account.ts 2>&1 | tail -10`
Expected: 0 errors, 0 warnings on that file.

- [ ] **Step 4: Commit**

```bash
git add app/src/lib/server/hosting/create-account.ts
git commit -m "feat(hosting): dispatch welcome email after DA provision success"
```

---

## Task 8: `hosting-provisioning-failed` template + notify + hook fail path

**Files:**
- Create: `app/src/lib/server/hosting/email-templates/provisioning-failed.ts`
- Create: `app/src/lib/server/hosting/email-templates/__tests__/provisioning-failed.test.ts`
- Create: `app/scripts/demo-hosting-provisioning-failed-email.ts`
- Modify: `app/src/lib/server/hosting/notifications.ts` (add `notifyHostingProvisioningFailed`)
- Modify: `app/src/lib/server/hosting/__tests__/notifications.test.ts` (add tests)
- Modify: `app/src/lib/server/hosting/create-account.ts` (catch block dispatch)

- [ ] **Step 1: Write failing template test**

```typescript
// File: app/src/lib/server/hosting/email-templates/__tests__/provisioning-failed.test.ts
import { describe, test, expect } from 'bun:test';
import { render } from '../provisioning-failed';

describe('provisioning-failed template', () => {
  const fixture = {
    tenantSlug: 'ots',
    accountId: 'acc_abc123',
    domain: 'broken.ro',
    reason: 'da_username_exists',
    attemptNumber: 2,
    adminCrmUrl: 'https://clients.onetopsolution.ro/ots/hosting/accounts/acc_abc123',
  };

  test('subject includes reason and tenant slug', () => {
    const { subject } = render(fixture);
    expect(subject).toContain('ots');
    expect(subject).toContain('da_username_exists');
  });

  test('html contains attempt number and CRM deep link', () => {
    const { html } = render(fixture);
    expect(html).toContain('Încercarea 2');
    expect(html).toContain(fixture.adminCrmUrl);
  });
});
```

- [ ] **Step 2: Run test (verify fail)**

Run: `bun test src/lib/server/hosting/email-templates/__tests__/provisioning-failed.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement template**

```typescript
// File: app/src/lib/server/hosting/email-templates/provisioning-failed.ts
import { renderBrandedEmail } from '$lib/server/email';

export interface ProvisioningFailedInput {
  tenantSlug: string;
  accountId: string;
  domain: string;
  reason: string;
  attemptNumber: number;
  adminCrmUrl: string;
  locale?: 'ro';
}

export function render(input: ProvisioningFailedInput): { subject: string; html: string } {
  const subject = `🚨 Provisioning DA eșuat — ${input.domain} (${input.tenantSlug}) — ${input.reason}`;
  const body = `
    <p>Provisioning-ul DirectAdmin pentru un cont nou a eșuat.</p>
    <table style="border-collapse:collapse;">
      <tr><td style="padding:6px 0;color:#666;">Tenant</td><td style="padding:6px 0;"><strong>${input.tenantSlug}</strong></td></tr>
      <tr><td style="padding:6px 0;color:#666;">Domeniu</td><td style="padding:6px 0;"><strong>${input.domain}</strong></td></tr>
      <tr><td style="padding:6px 0;color:#666;">Account ID</td><td style="padding:6px 0;"><code>${input.accountId}</code></td></tr>
      <tr><td style="padding:6px 0;color:#666;">Motiv</td><td style="padding:6px 0;"><code>${input.reason}</code></td></tr>
      <tr><td style="padding:6px 0;color:#666;">Încercarea</td><td style="padding:6px 0;">Încercarea ${input.attemptNumber}</td></tr>
    </table>
    <p style="margin-top:24px;">
      <a href="${input.adminCrmUrl}"
         style="display:inline-block;background:#0ea5e9;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;">
        Deschide contul în CRM
      </a>
    </p>
    <h3>Pași recomandați</h3>
    <ul>
      <li><strong>da_username_exists:</strong> verifică pe DA dacă username-ul există; redenumește accountul în CRM și retry</li>
      <li><strong>da_create_failed:</strong> verifică logul DA + ping server</li>
      <li><strong>da_unreachable:</strong> verifică conectivitatea către serverul DA</li>
      <li><strong>orphan_no_customer:</strong> verifică legătura inquiry → client; relink manual</li>
    </ul>
  `;
  return { subject, html: renderBrandedEmail({ title: 'Provisioning DA eșuat', body }) };
}
```

- [ ] **Step 4: Run test (verify pass)**

Run: `bun test src/lib/server/hosting/email-templates/__tests__/provisioning-failed.test.ts`
Expected: 2 pass.

- [ ] **Step 5: Add demo script**

```typescript
// File: app/scripts/demo-hosting-provisioning-failed-email.ts
import { render } from '../src/lib/server/hosting/email-templates/provisioning-failed';

const { subject, html } = render({
  tenantSlug: 'ots',
  accountId: 'acc_abc123',
  domain: 'broken.ro',
  reason: 'da_username_exists',
  attemptNumber: 2,
  adminCrmUrl: 'https://clients.onetopsolution.ro/ots/hosting/accounts/acc_abc123',
});
console.log(`<!-- Subject: ${subject} -->`);
console.log(html);
```

- [ ] **Step 6: Add `notifyHostingProvisioningFailed` to notifications.ts**

Append to `notifications.ts`:

```typescript
import { gt, like } from 'drizzle-orm';
import { tenant as tenantTable } from '$lib/server/db/schema';
import { resolveAdminRecipients } from './notifications-helpers';
import { render as renderProvisioningFailed } from './email-templates/provisioning-failed';

export async function notifyHostingProvisioningFailed(
  tenantId: string,
  accountId: string,
  reason: string,
  attemptNumber: number,
): Promise<void> {
  // Rolling 5-min dedupe by reason
  const recent = await db.select({ id: hostingEmailEvent.id })
    .from(hostingEmailEvent)
    .where(and(
      eq(hostingEmailEvent.hostingAccountId, accountId),
      eq(hostingEmailEvent.eventType, 'provisioning-failed'),
      like(hostingEmailEvent.dedupeKey, `provisioning-failed:${reason}:%`),
      gt(hostingEmailEvent.sentAt, new Date(Date.now() - 5 * 60 * 1000)),
    ));
  if (recent.length > 0) {
    logInfo('notifyHostingProvisioningFailed dedupe hit (5min rolling)', { accountId, reason });
    return;
  }

  const dedupeKey = `provisioning-failed:${reason}:attempt-${attemptNumber}-${Date.now()}`;
  const dedupeRowId = nanoid();
  await db.insert(hostingEmailEvent).values({
    id: dedupeRowId,
    tenantId,
    hostingAccountId: accountId,
    eventType: 'provisioning-failed',
    dedupeKey,
    attemptNumber,
    sentAt: new Date(),
  });

  try {
    const [account] = await db.select().from(hostingAccount)
      .where(and(eq(hostingAccount.id, accountId), eq(hostingAccount.tenantId, tenantId)))
      .limit(1);
    const [t] = await db.select({ slug: tenantTable.slug }).from(tenantTable)
      .where(eq(tenantTable.id, tenantId)).limit(1);
    if (!account || !t) throw new Error('account or tenant not found');

    const recipients = await resolveAdminRecipients(tenantId);
    const adminCrmUrl = `https://clients.onetopsolution.ro/${t.slug}/hosting/accounts/${accountId}`;
    const { subject, html } = renderProvisioningFailed({
      tenantSlug: t.slug,
      accountId,
      domain: account.domain,
      reason,
      attemptNumber,
      adminCrmUrl,
    });

    for (const email of recipients) {
      const emailLogId = await sendWithPersistence({
        tenantId,
        toEmail: email,
        subject,
        html,
        emailType: 'hosting-provisioning-failed',
        payload: { sendFn: 'sendHostingProvisioningFailedEmail', args: [tenantId, accountId, reason, attemptNumber] },
      });
      // Last writer wins for emailLogId — acceptable for INTERNAL multi-recipient
      await db.update(hostingEmailEvent).set({ emailLogId }).where(eq(hostingEmailEvent.id, dedupeRowId));
    }
  } catch (err) {
    logError('notifyHostingProvisioningFailed failed', { tenantId, accountId, reason, err });
    throw err;
  }
}
```

- [ ] **Step 7: Add tests**

Append to `notifications.test.ts`:

```typescript
import { notifyHostingProvisioningFailed } from '../notifications';

describe('notifyHostingProvisioningFailed', () => {
  test('sends to all owner/admin users', async () => {
    const t = nanoid();
    const u = nanoid();
    const a = nanoid();
    const srv = nanoid();
    await db.insert(schema.tenant).values({ id: t, slug: `t-${t.slice(0,8)}`, name: 'T' });
    await db.insert(schema.user).values({ id: u, email: 'admin@example.ro', name: 'Adm' });
    await db.insert(schema.tenantUser).values({ tenantId: t, userId: u, role: 'admin' });
    await db.insert(schema.daServer).values({
      id: srv, tenantId: t, name: 'srv', host: 'srv.example.ro', port: 2222,
      apiUsername: 'admin', apiPasswordEncrypted: 'enc',
    });
    await db.insert(schema.hostingAccount).values({
      id: a, tenantId: t, clientId: null, daServerId: srv,
      daUsername: 'u', domain: 'broken.ro', status: 'failed',
    });

    await notifyHostingProvisioningFailed(t, a, 'da_username_exists', 1);

    const logs = await db.select().from(schema.emailLog)
      .where(eq(schema.emailLog.emailType, 'hosting-provisioning-failed'));
    expect(logs.length).toBe(1);
    expect(logs[0]!.toEmail).toBe('admin@example.ro');
  });

  test('rolling 5-min dedupe blocks same reason within window', async () => {
    const t = nanoid();
    const u = nanoid();
    const a = nanoid();
    const srv = nanoid();
    await db.insert(schema.tenant).values({ id: t, slug: `t-${t.slice(0,8)}`, name: 'T' });
    await db.insert(schema.user).values({ id: u, email: 'admin@example.ro', name: 'Adm' });
    await db.insert(schema.tenantUser).values({ tenantId: t, userId: u, role: 'admin' });
    await db.insert(schema.daServer).values({
      id: srv, tenantId: t, name: 'srv', host: 'srv.example.ro', port: 2222,
      apiUsername: 'admin', apiPasswordEncrypted: 'enc',
    });
    await db.insert(schema.hostingAccount).values({
      id: a, tenantId: t, clientId: null, daServerId: srv,
      daUsername: 'u', domain: 'broken.ro', status: 'failed',
    });

    await notifyHostingProvisioningFailed(t, a, 'da_unreachable', 1);
    await notifyHostingProvisioningFailed(t, a, 'da_unreachable', 2); // within 5min

    const logs = await db.select().from(schema.emailLog)
      .where(eq(schema.emailLog.emailType, 'hosting-provisioning-failed'));
    expect(logs.length).toBe(1); // second was deduped
  });
});
```

- [ ] **Step 8: Run all notifications tests**

Run: `bun test src/lib/server/hosting/__tests__/notifications.test.ts`
Expected: 3 + 2 = 5 pass.

- [ ] **Step 9: Hook into `create-account.ts` catch path**

In `src/lib/server/hosting/create-account.ts`, find the catch block where status is set to `'failed'`. After the status update, inject:

```typescript
import { notifyHostingProvisioningFailed } from './notifications';

// Inside the catch block, after updating status to 'failed':
notifyHostingProvisioningFailed(
  tenantId, id,
  suspendReason ?? 'da_create_failed',
  attempt + 1, // current attempt count
).catch((notifyErr) => {
  logError('admin alert failed to dispatch', { tenantId, accountId: id, notifyErr });
});
```

Adjust `suspendReason` to the actual variable name used in this code branch; check via `grep -n "suspendReason\s*=\|setReason\|reason" src/lib/server/hosting/create-account.ts | head -5`.

- [ ] **Step 10: Commit**

```bash
git add app/src/lib/server/hosting/email-templates/provisioning-failed.ts \
        app/src/lib/server/hosting/email-templates/__tests__/provisioning-failed.test.ts \
        app/scripts/demo-hosting-provisioning-failed-email.ts \
        app/src/lib/server/hosting/notifications.ts \
        app/src/lib/server/hosting/__tests__/notifications.test.ts \
        app/src/lib/server/hosting/create-account.ts
git commit -m "feat(hosting): provisioning-failed admin alert + 5-min rolling dedupe + create-account catch hook"
```

---

## Task 9: `hosting-suspended` flow (template + notify + DA hook + 10d grace)

**Files:**
- Create: `app/src/lib/server/hosting/email-templates/suspended.ts`
- Create: `app/src/lib/server/hosting/email-templates/__tests__/suspended.test.ts`
- Create: `app/scripts/demo-hosting-suspended-email.ts`
- Modify: `app/src/lib/server/hosting/notifications.ts` (add `notifyHostingSuspended`)
- Modify: `app/src/lib/server/hosting/__tests__/notifications.test.ts` (add tests)
- Modify: `app/src/lib/server/plugins/directadmin/hooks.ts` (add grace + notify after suspend)

- [ ] **Step 1: Template test**

```typescript
// File: app/src/lib/server/hosting/email-templates/__tests__/suspended.test.ts
import { describe, test, expect } from 'bun:test';
import { render } from '../suspended';

describe('suspended template', () => {
  const fixture = {
    domain: 'example.ro',
    clientName: 'Ion Popescu',
    invoiceNumber: 'INV-2026-0042',
    invoiceDate: '15.04.2026',
    amountDue: 99,
    currency: 'RON' as const,
    payUrl: 'https://clients.onetopsolution.ro/ots/invoices/inv_abc/pay',
    supportEmail: 'office@onetopsolution.ro',
  };

  test('subject contains warning + domain', () => {
    const { subject } = render(fixture);
    expect(subject).toContain('⚠️');
    expect(subject).toContain('example.ro');
  });

  test('html contains invoice number and pay link', () => {
    const { html } = render(fixture);
    expect(html).toContain('INV-2026-0042');
    expect(html).toContain(fixture.payUrl);
    expect(html).toContain('99');
  });
});
```

- [ ] **Step 2: Run test (fail)**

Run: `bun test src/lib/server/hosting/email-templates/__tests__/suspended.test.ts`

- [ ] **Step 3: Implement template**

```typescript
// File: app/src/lib/server/hosting/email-templates/suspended.ts
import { renderBrandedEmail } from '$lib/server/email';

export interface SuspendedInput {
  domain: string;
  clientName: string;
  invoiceNumber: string;
  invoiceDate: string;
  amountDue: number;
  currency: 'RON' | 'EUR' | 'USD';
  payUrl: string;
  supportEmail: string;
  locale?: 'ro';
}

export function render(input: SuspendedInput): { subject: string; html: string } {
  const subject = `⚠️ Contul de hosting suspendat — factură neachitată (${input.domain})`;
  const body = `
    <p>Salut <strong>${input.clientName}</strong>,</p>
    <p>Contul de hosting pentru <strong>${input.domain}</strong> a fost suspendat din cauza unei facturi neachitate.</p>
    <table>
      <tr><td style="padding:6px 0;color:#666;">Factura</td><td style="padding:6px 0;"><strong>${input.invoiceNumber}</strong></td></tr>
      <tr><td style="padding:6px 0;color:#666;">Data emiterii</td><td style="padding:6px 0;">${input.invoiceDate}</td></tr>
      <tr><td style="padding:6px 0;color:#666;">Sumă datorată</td><td style="padding:6px 0;"><strong>${input.amountDue} ${input.currency}</strong></td></tr>
    </table>
    <p style="margin-top:20px;">După plată, contul va fi reactivat automat în câteva minute.</p>
    <p>
      <a href="${input.payUrl}"
         style="display:inline-block;background:#dc2626;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">
        Plătește acum
      </a>
    </p>
    <p style="margin-top:24px;color:#666;">Întrebări? Scrie-ne la <a href="mailto:${input.supportEmail}">${input.supportEmail}</a>.</p>
  `;
  return { subject, html: renderBrandedEmail({ title: 'Hosting suspendat', body }) };
}
```

- [ ] **Step 4: Run test (pass)**

Run: `bun test src/lib/server/hosting/email-templates/__tests__/suspended.test.ts`
Expected: 2 pass.

- [ ] **Step 5: Demo script**

```typescript
// File: app/scripts/demo-hosting-suspended-email.ts
import { render } from '../src/lib/server/hosting/email-templates/suspended';
const { subject, html } = render({
  domain: 'example.ro', clientName: 'Ion Popescu',
  invoiceNumber: 'INV-2026-0042', invoiceDate: '15.04.2026',
  amountDue: 99, currency: 'RON',
  payUrl: 'https://clients.onetopsolution.ro/ots/invoices/inv_abc/pay',
  supportEmail: 'office@onetopsolution.ro',
});
console.log(`<!-- Subject: ${subject} -->`);
console.log(html);
```

- [ ] **Step 6: Add `notifyHostingSuspended` to notifications.ts**

Append:

```typescript
import { invoice } from '$lib/server/db/schema';
import { render as renderSuspended } from './email-templates/suspended';
import { dayBucketEET } from './notifications-helpers';

export async function notifyHostingSuspended(
  tenantId: string,
  accountId: string,
  invoiceId: string,
): Promise<void> {
  const dedupeKey = `suspended:${invoiceId}:${dayBucketEET()}`;
  const dedupeRowId = nanoid();
  const inserted = await db.insert(hostingEmailEvent).values({
    id: dedupeRowId, tenantId, hostingAccountId: accountId,
    eventType: 'suspended', dedupeKey, sentAt: new Date(),
  }).onConflictDoNothing({
    target: [hostingEmailEvent.tenantId, hostingEmailEvent.hostingAccountId, hostingEmailEvent.dedupeKey],
  }).returning({ id: hostingEmailEvent.id });

  if (inserted.length === 0) {
    logInfo('notifyHostingSuspended dedupe hit', { tenantId, accountId, invoiceId });
    return;
  }

  try {
    const [account] = await db.select().from(hostingAccount)
      .where(and(eq(hostingAccount.id, accountId), eq(hostingAccount.tenantId, tenantId)))
      .limit(1);
    const [inv] = await db.select().from(invoice)
      .where(and(eq(invoice.id, invoiceId), eq(invoice.tenantId, tenantId)))
      .limit(1);
    if (!account || !inv) throw new Error('account or invoice not found');

    const customer = await resolveCustomerEmail({ id: account.id, tenantId, clientId: account.clientId });
    const [t] = await db.select({ slug: tenantTable.slug }).from(tenantTable)
      .where(eq(tenantTable.id, tenantId)).limit(1);

    const payUrl = `https://clients.onetopsolution.ro/${t!.slug}/invoices/${invoiceId}/pay`;
    const invoiceDate = inv.issueDate ? formatDateRo(inv.issueDate) : '—';

    const { subject, html } = renderSuspended({
      domain: account.domain,
      clientName: customer.name,
      invoiceNumber: inv.invoiceNumber ?? inv.id,
      invoiceDate,
      amountDue: Number(inv.totalAmount ?? 0),
      currency: (inv.currency as 'RON' | 'EUR' | 'USD') ?? 'RON',
      payUrl,
      supportEmail: 'office@onetopsolution.ro',
    });

    const emailLogId = await sendWithPersistence({
      tenantId, toEmail: customer.email, subject, html,
      emailType: 'hosting-suspended',
      payload: { sendFn: 'sendHostingSuspendedEmail', args: [tenantId, accountId, invoiceId] },
    });
    await db.update(hostingEmailEvent).set({ emailLogId }).where(eq(hostingEmailEvent.id, dedupeRowId));
  } catch (err) {
    logError('notifyHostingSuspended failed', { tenantId, accountId, invoiceId, err });
    throw err;
  }
}

function formatDateRo(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
```

- [ ] **Step 7: Add notify test**

Append to `notifications.test.ts`:

```typescript
import { notifyHostingSuspended } from '../notifications';

describe('notifyHostingSuspended', () => {
  test('sends suspension email with invoice details and dedupes within 24h bucket', async () => {
    const t = nanoid(), c = nanoid(), srv = nanoid(), a = nanoid(), i = nanoid();
    await db.insert(schema.tenant).values({ id: t, slug: `t-${t.slice(0,8)}`, name: 'T' });
    await db.insert(schema.client).values({ id: c, tenantId: t, email: 'c@ex.ro', companyName: 'Acme' });
    await db.insert(schema.daServer).values({
      id: srv, tenantId: t, name: 'srv', host: 'srv.ex.ro', port: 2222,
      apiUsername: 'admin', apiPasswordEncrypted: 'enc',
    });
    await db.insert(schema.hostingAccount).values({
      id: a, tenantId: t, clientId: c, daServerId: srv,
      daUsername: 'u', domain: 'ex.ro', status: 'suspended',
    });
    await db.insert(schema.invoice).values({
      id: i, tenantId: t, clientId: c, invoiceNumber: 'INV-0042',
      totalAmount: 99, currency: 'RON', status: 'overdue', issueDate: new Date('2026-04-15'),
    });

    await notifyHostingSuspended(t, a, i);
    await notifyHostingSuspended(t, a, i); // dedupe

    const logs = await db.select().from(schema.emailLog)
      .where(eq(schema.emailLog.emailType, 'hosting-suspended'));
    expect(logs.length).toBe(1);
  });
});
```

- [ ] **Step 8: Hook into `directadmin/hooks.ts` with 10-day grace + notify**

Run: `grep -n "suspendUser\|status.*suspended\|autoSuspendedByInvoiceId" src/lib/server/plugins/directadmin/hooks.ts | head -10`

Locate the function that handles invoice-status-changed → suspend. Inject grace check + notify:

```typescript
// In src/lib/server/plugins/directadmin/hooks.ts, inside the suspend handler:

// Add at top of file:
import { notifyHostingSuspended } from '$lib/server/hosting/notifications';

// In the function, BEFORE calling suspendUser:
const daysOverdue = computeDaysOverdue(invoice.dueDate, new Date());
if (daysOverdue < 10) {
  logInfo('suspend skipped — within 10-day grace', { invoiceId: invoice.id, daysOverdue });
  return;
}

// AFTER suspendUser() succeeds and status is set to 'suspended':
await db.update(hostingAccount)
  .set({ status: 'suspended', suspendedAt: new Date(), autoSuspendedByInvoiceId: invoice.id })
  .where(eq(hostingAccount.id, account.id));

notifyHostingSuspended(tenantId, account.id, invoice.id).catch((err) => {
  logError('suspended email dispatch failed', { accountId: account.id, err });
});
```

Add helper if not present:

```typescript
function computeDaysOverdue(dueDate: Date | string | null, now: Date): number {
  if (!dueDate) return 0;
  const d = typeof dueDate === 'string' ? new Date(dueDate) : dueDate;
  return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}
```

- [ ] **Step 9: Run all tests**

Run: `bun test src/lib/server/hosting/__tests__/notifications.test.ts src/lib/server/hosting/email-templates/__tests__/suspended.test.ts`
Expected: prior tests still pass + 1 new suspend test pass.

- [ ] **Step 10: Commit**

```bash
git add app/src/lib/server/hosting/email-templates/suspended.ts \
        app/src/lib/server/hosting/email-templates/__tests__/suspended.test.ts \
        app/scripts/demo-hosting-suspended-email.ts \
        app/src/lib/server/hosting/notifications.ts \
        app/src/lib/server/hosting/__tests__/notifications.test.ts \
        app/src/lib/server/plugins/directadmin/hooks.ts
git commit -m "feat(hosting): suspended notification + 10-day grace before DA suspend"
```

---

## Task 10: `hosting-reactivated` flow (template + notify + unsuspend safety)

**Files:**
- Create: `app/src/lib/server/hosting/email-templates/reactivated.ts`
- Create: `app/src/lib/server/hosting/email-templates/__tests__/reactivated.test.ts`
- Create: `app/scripts/demo-hosting-reactivated-email.ts`
- Modify: `app/src/lib/server/hosting/notifications.ts` (add `notifyHostingReactivated`)
- Modify: `app/src/lib/server/hosting/__tests__/notifications.test.ts`
- Modify: `app/src/lib/server/plugins/directadmin/hooks.ts` (safety check + notify after unsuspend)

- [ ] **Step 1: Template test + implement + demo (same pattern as Task 9)**

```typescript
// File: app/src/lib/server/hosting/email-templates/__tests__/reactivated.test.ts
import { describe, test, expect } from 'bun:test';
import { render } from '../reactivated';

describe('reactivated template', () => {
  const fixture = {
    domain: 'example.ro', clientName: 'Ion Popescu',
    invoiceNumber: 'INV-2026-0042', amountPaid: 99, currency: 'RON' as const,
    daPanelUrl: 'https://srv1.example.ro:2222',
  };
  test('subject contains check mark + domain', () => {
    expect(render(fixture).subject).toMatch(/✅.*example\.ro/);
  });
  test('html confirms payment received', () => {
    expect(render(fixture).html).toContain('INV-2026-0042');
    expect(render(fixture).html).toContain('99');
  });
});
```

```typescript
// File: app/src/lib/server/hosting/email-templates/reactivated.ts
import { renderBrandedEmail } from '$lib/server/email';

export interface ReactivatedInput {
  domain: string; clientName: string;
  invoiceNumber: string; amountPaid: number; currency: 'RON'|'EUR'|'USD';
  daPanelUrl: string; locale?: 'ro';
}

export function render(input: ReactivatedInput): { subject: string; html: string } {
  const subject = `✅ Hosting reactivat — ${input.domain}`;
  const body = `
    <p>Salut <strong>${input.clientName}</strong>,</p>
    <p>Am primit plata pentru factura <strong>${input.invoiceNumber}</strong> (${input.amountPaid} ${input.currency}).</p>
    <p>Contul de hosting pentru <strong>${input.domain}</strong> a fost reactivat și este din nou disponibil.</p>
    <p>
      <a href="${input.daPanelUrl}"
         style="display:inline-block;background:#0ea5e9;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;">
        Deschide panoul DA
      </a>
    </p>
    <p style="margin-top:24px;">Mulțumim pentru încredere!</p>
  `;
  return { subject, html: renderBrandedEmail({ title: 'Hosting reactivat', body }) };
}
```

```typescript
// File: app/scripts/demo-hosting-reactivated-email.ts
import { render } from '../src/lib/server/hosting/email-templates/reactivated';
const { subject, html } = render({
  domain: 'example.ro', clientName: 'Ion Popescu',
  invoiceNumber: 'INV-2026-0042', amountPaid: 99, currency: 'RON',
  daPanelUrl: 'https://srv1.example.ro:2222',
});
console.log(`<!-- Subject: ${subject} -->`); console.log(html);
```

- [ ] **Step 2: Run template test**

Run: `bun test src/lib/server/hosting/email-templates/__tests__/reactivated.test.ts`
Expected: 2 pass.

- [ ] **Step 3: Add `notifyHostingReactivated` to notifications.ts (with unsuspend safety check inside)**

```typescript
import { render as renderReactivated } from './email-templates/reactivated';
import { invoiceLineItem, daServer as daServerT } from '$lib/server/db/schema';
import { ne } from 'drizzle-orm';

export async function notifyHostingReactivated(
  tenantId: string,
  accountId: string,
  invoiceId: string,
): Promise<void> {
  // Safety: don't email reactivation if another hosting invoice for this account is still unpaid
  const otherUnpaid = await db.select({ id: invoice.id })
    .from(invoice)
    .innerJoin(invoiceLineItem, eq(invoice.id, invoiceLineItem.invoiceId))
    .where(and(
      eq(invoice.tenantId, tenantId),
      eq(invoiceLineItem.hostingAccountId, accountId),
      inArray(invoice.status, ['overdue', 'sent']),
      ne(invoice.id, invoiceId),
    ))
    .limit(1);
  if (otherUnpaid.length > 0) {
    logInfo('reactivated email skipped — other hosting invoice still unpaid', { accountId });
    return;
  }

  const dedupeKey = `reactivated:${invoiceId}`;
  const dedupeRowId = nanoid();
  const inserted = await db.insert(hostingEmailEvent).values({
    id: dedupeRowId, tenantId, hostingAccountId: accountId,
    eventType: 'reactivated', dedupeKey, sentAt: new Date(),
  }).onConflictDoNothing({
    target: [hostingEmailEvent.tenantId, hostingEmailEvent.hostingAccountId, hostingEmailEvent.dedupeKey],
  }).returning({ id: hostingEmailEvent.id });
  if (inserted.length === 0) return;

  try {
    const [account] = await db.select().from(hostingAccount)
      .where(and(eq(hostingAccount.id, accountId), eq(hostingAccount.tenantId, tenantId)))
      .limit(1);
    const [inv] = await db.select().from(invoice).where(eq(invoice.id, invoiceId)).limit(1);
    if (!account || !inv) throw new Error('account or invoice missing');
    const customer = await resolveCustomerEmail({ id: account.id, tenantId, clientId: account.clientId });
    const [srv] = await db.select({ host: daServerT.host }).from(daServerT)
      .where(eq(daServerT.id, account.daServerId)).limit(1);

    const { subject, html } = renderReactivated({
      domain: account.domain, clientName: customer.name,
      invoiceNumber: inv.invoiceNumber ?? inv.id,
      amountPaid: Number(inv.totalAmount ?? 0),
      currency: (inv.currency as 'RON'|'EUR'|'USD') ?? 'RON',
      daPanelUrl: `https://${srv?.host ?? ''}:2222`,
    });
    const emailLogId = await sendWithPersistence({
      tenantId, toEmail: customer.email, subject, html,
      emailType: 'hosting-reactivated',
      payload: { sendFn: 'sendHostingReactivatedEmail', args: [tenantId, accountId, invoiceId] },
    });
    await db.update(hostingEmailEvent).set({ emailLogId }).where(eq(hostingEmailEvent.id, dedupeRowId));
  } catch (err) {
    logError('notifyHostingReactivated failed', { tenantId, accountId, invoiceId, err });
    throw err;
  }
}
```

- [ ] **Step 4: Test for safety check**

Append to `notifications.test.ts`:

```typescript
import { notifyHostingReactivated } from '../notifications';

describe('notifyHostingReactivated', () => {
  test('skips email when other hosting invoice still unpaid', async () => {
    const t = nanoid(), c = nanoid(), srv = nanoid(), a = nanoid();
    const inv1 = nanoid(), inv2 = nanoid();
    await db.insert(schema.tenant).values({ id: t, slug: `t-${t.slice(0,8)}`, name: 'T' });
    await db.insert(schema.client).values({ id: c, tenantId: t, email: 'c@ex.ro', companyName: 'A' });
    await db.insert(schema.daServer).values({ id: srv, tenantId: t, name: 's', host: 'h', port: 2222, apiUsername: 'a', apiPasswordEncrypted: 'e' });
    await db.insert(schema.hostingAccount).values({ id: a, tenantId: t, clientId: c, daServerId: srv, daUsername: 'u', domain: 'ex.ro', status: 'active' });
    // Two hosting invoices, both linked via lineItem
    for (const id of [inv1, inv2]) {
      await db.insert(schema.invoice).values({ id, tenantId: t, clientId: c, totalAmount: 99, currency: 'RON', status: id === inv1 ? 'paid' : 'overdue' });
      await db.insert(schema.invoiceLineItem).values({ id: nanoid(), invoiceId: id, hostingAccountId: a, description: 'hosting', quantity: 1, unitPrice: 99 });
    }
    await notifyHostingReactivated(t, a, inv1); // paid invoice; other still overdue
    const logs = await db.select().from(schema.emailLog)
      .where(eq(schema.emailLog.emailType, 'hosting-reactivated'));
    expect(logs.length).toBe(0); // skipped due to other unpaid
  });
});
```

- [ ] **Step 5: Hook into unsuspend path in `directadmin/hooks.ts`**

```typescript
// In src/lib/server/plugins/directadmin/hooks.ts, the on-invoice-paid handler:
import { notifyHostingReactivated } from '$lib/server/hosting/notifications';

// BEFORE calling unsuspendUser, check there are no other unpaid hosting invoices:
const otherUnpaid = await db.select({ id: invoice.id })
  .from(invoice)
  .innerJoin(invoiceLineItem, eq(invoice.id, invoiceLineItem.invoiceId))
  .where(and(
    eq(invoice.tenantId, tenantId),
    eq(invoiceLineItem.hostingAccountId, account.id),
    inArray(invoice.status, ['overdue', 'sent']),
    ne(invoice.id, paidInvoiceId),
  ))
  .limit(1);
if (otherUnpaid.length > 0) {
  logInfo('unsuspend skipped — other hosting invoice still unpaid', { accountId: account.id });
  return;
}

// AFTER unsuspendUser() succeeds:
await db.update(hostingAccount)
  .set({ status: 'active', reactivatedAt: new Date(), autoSuspendedByInvoiceId: null })
  .where(eq(hostingAccount.id, account.id));

notifyHostingReactivated(tenantId, account.id, paidInvoiceId).catch((err) => {
  logError('reactivated email dispatch failed', { accountId: account.id, err });
});
```

- [ ] **Step 6: Run all hosting tests**

Run: `bun test src/lib/server/hosting/`
Expected: all previous + 1 new pass.

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/server/hosting/email-templates/reactivated.ts \
        app/src/lib/server/hosting/email-templates/__tests__/reactivated.test.ts \
        app/scripts/demo-hosting-reactivated-email.ts \
        app/src/lib/server/hosting/notifications.ts \
        app/src/lib/server/hosting/__tests__/notifications.test.ts \
        app/src/lib/server/plugins/directadmin/hooks.ts
git commit -m "feat(hosting): reactivated notification + multi-invoice unsuspend safety check"
```

---

## Task 11: `hosting-renewal-reminder` + scheduler task

**Files:**
- Create: `app/src/lib/server/hosting/email-templates/renewal-reminder.ts`
- Create: `app/src/lib/server/hosting/email-templates/__tests__/renewal-reminder.test.ts`
- Create: `app/scripts/demo-hosting-renewal-reminder-email.ts`
- Modify: `app/src/lib/server/hosting/notifications.ts`
- Modify: `app/src/lib/server/hosting/__tests__/notifications.test.ts`
- Create: `app/src/lib/server/scheduler/tasks/hosting-renewal-reminder.ts`
- Modify: existing scheduler registration file (locate via `grep -n "hostingRenewal\|scheduler/tasks\|registerTask" src/lib/server/scheduler/`)

- [ ] **Step 1: Template test + implement**

```typescript
// File: app/src/lib/server/hosting/email-templates/__tests__/renewal-reminder.test.ts
import { describe, test, expect } from 'bun:test';
import { render } from '../renewal-reminder';

describe('renewal-reminder template', () => {
  const base = {
    domain: 'example.ro', clientName: 'Ion Popescu',
    dueDate: '05.06.2026', amountDue: 99, currency: 'RON' as const,
    payUrl: 'https://clients.onetopsolution.ro/ots/hosting/accounts/acc/renew',
  };
  test('subject shows correct days for daysUntilDue=1 (singular zi)', () => {
    expect(render({ ...base, daysUntilDue: 1, autoRenew: false }).subject).toContain('1 zi');
  });
  test('subject shows correct days for daysUntilDue=7 (plural zile)', () => {
    expect(render({ ...base, daysUntilDue: 7, autoRenew: false }).subject).toContain('7 zile');
  });
  test('autoRenew=true copy mentions automatic charge', () => {
    expect(render({ ...base, daysUntilDue: 14, autoRenew: true }).html).toMatch(/taxat automat/i);
  });
  test('autoRenew=false copy warns about suspension', () => {
    expect(render({ ...base, daysUntilDue: 1, autoRenew: false }).html).toMatch(/suspendat/i);
  });
});
```

```typescript
// File: app/src/lib/server/hosting/email-templates/renewal-reminder.ts
import { renderBrandedEmail } from '$lib/server/email';

export interface RenewalReminderInput {
  domain: string; clientName: string;
  dueDate: string; amountDue: number; currency: 'RON'|'EUR'|'USD';
  daysUntilDue: 1 | 7 | 14;
  autoRenew: boolean;
  payUrl: string;
  locale?: 'ro';
}

export function render(input: RenewalReminderInput): { subject: string; html: string } {
  const dayWord = input.daysUntilDue === 1 ? '1 zi' : `${input.daysUntilDue} zile`;
  const subject = `Hosting ${input.domain} expiră în ${dayWord}`;

  const autoRenewBlock = input.autoRenew
    ? `<p>Vei fi taxat automat prin cardul salvat în <strong>${dayWord}</strong>. Verifică detaliile de plată dacă vrei să eviți surprize.</p>`
    : `<p>Plata manuală expiră în <strong>${dayWord}</strong>. După această dată, hostingul va fi suspendat.</p>`;

  const body = `
    <p>Salut <strong>${input.clientName}</strong>,</p>
    <p>Hostingul pentru <strong>${input.domain}</strong> se reînnoiește în curând.</p>
    <table>
      <tr><td style="padding:6px 0;color:#666;">Data scadenței</td><td style="padding:6px 0;"><strong>${input.dueDate}</strong></td></tr>
      <tr><td style="padding:6px 0;color:#666;">Sumă reînnoire</td><td style="padding:6px 0;"><strong>${input.amountDue} ${input.currency}</strong></td></tr>
    </table>
    ${autoRenewBlock}
    <p>
      <a href="${input.payUrl}"
         style="display:inline-block;background:#0ea5e9;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;">
        ${input.autoRenew ? 'Vezi detalii plată' : 'Plătește acum'}
      </a>
    </p>
  `;
  return { subject, html: renderBrandedEmail({ title: 'Renewal hosting', body }) };
}
```

```typescript
// File: app/scripts/demo-hosting-renewal-reminder-email.ts
import { render } from '../src/lib/server/hosting/email-templates/renewal-reminder';
for (const d of [14, 7, 1] as const) {
  for (const ar of [true, false]) {
    const { subject, html } = render({
      domain: 'example.ro', clientName: 'Ion Popescu',
      dueDate: '05.06.2026', amountDue: 99, currency: 'RON',
      daysUntilDue: d, autoRenew: ar,
      payUrl: 'https://clients.onetopsolution.ro/ots/hosting/accounts/acc/renew',
    });
    console.log(`<!-- ${d}d / autoRenew=${ar} / Subject: ${subject} -->`);
    console.log(html);
    console.log('<hr>');
  }
}
```

- [ ] **Step 2: Run template test (4 pass)**

Run: `bun test src/lib/server/hosting/email-templates/__tests__/renewal-reminder.test.ts`

- [ ] **Step 3: Add `notifyHostingRenewalReminder`**

```typescript
import { render as renderRenewal } from './email-templates/renewal-reminder';

export async function notifyHostingRenewalReminder(
  tenantId: string,
  accountId: string,
  daysUntilDue: 1 | 7 | 14,
): Promise<void> {
  const [account] = await db.select().from(hostingAccount)
    .where(and(eq(hostingAccount.id, accountId), eq(hostingAccount.tenantId, tenantId)))
    .limit(1);
  if (!account || !account.nextDueDate) {
    throw new Error(`account ${accountId} missing or has no nextDueDate`);
  }

  const dueDateIso = account.nextDueDate; // stored as text 'YYYY-MM-DD'
  const dedupeKey = `renewal-reminder:${dueDateIso}:${daysUntilDue}d`;
  const dedupeRowId = nanoid();
  const inserted = await db.insert(hostingEmailEvent).values({
    id: dedupeRowId, tenantId, hostingAccountId: accountId,
    eventType: 'renewal-reminder', dedupeKey, sentAt: new Date(),
  }).onConflictDoNothing({
    target: [hostingEmailEvent.tenantId, hostingEmailEvent.hostingAccountId, hostingEmailEvent.dedupeKey],
  }).returning({ id: hostingEmailEvent.id });
  if (inserted.length === 0) return;

  try {
    const customer = await resolveCustomerEmail({ id: account.id, tenantId, clientId: account.clientId });
    const [t] = await db.select({ slug: tenantTable.slug }).from(tenantTable)
      .where(eq(tenantTable.id, tenantId)).limit(1);
    const dueDateRo = new Date(dueDateIso).toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const payUrl = `https://clients.onetopsolution.ro/${t!.slug}/hosting/accounts/${accountId}/renew`;

    const { subject, html } = renderRenewal({
      domain: account.domain,
      clientName: customer.name,
      dueDate: dueDateRo,
      amountDue: Number(account.recurringAmount ?? 0),
      currency: (account.currency as 'RON'|'EUR'|'USD') ?? 'RON',
      daysUntilDue,
      autoRenew: Boolean(account.autoRenew),
      payUrl,
    });

    const emailLogId = await sendWithPersistence({
      tenantId, toEmail: customer.email, subject, html,
      emailType: 'hosting-renewal-reminder',
      payload: { sendFn: 'sendHostingRenewalReminderEmail', args: [tenantId, accountId, daysUntilDue] },
      includeUnsubscribeHeader: true, // RFC 8058 — bulk-style notification
    });
    await db.update(hostingEmailEvent).set({ emailLogId }).where(eq(hostingEmailEvent.id, dedupeRowId));
  } catch (err) {
    logError('notifyHostingRenewalReminder failed', { tenantId, accountId, daysUntilDue, err });
    throw err;
  }
}
```

If `sendWithPersistence` does not accept `includeUnsubscribeHeader`, add it as an option or set the header in another supported way; check the existing signature.

- [ ] **Step 4: Add notify test**

Append to `notifications.test.ts`:

```typescript
import { notifyHostingRenewalReminder } from '../notifications';

describe('notifyHostingRenewalReminder', () => {
  test('sends once per (dueDate, window); second call dedupes', async () => {
    const t = nanoid(), c = nanoid(), srv = nanoid(), a = nanoid();
    await db.insert(schema.tenant).values({ id: t, slug: `t-${t.slice(0,8)}`, name: 'T' });
    await db.insert(schema.client).values({ id: c, tenantId: t, email: 'c@ex.ro', companyName: 'A' });
    await db.insert(schema.daServer).values({ id: srv, tenantId: t, name: 's', host: 'h', port: 2222, apiUsername: 'a', apiPasswordEncrypted: 'e' });
    await db.insert(schema.hostingAccount).values({
      id: a, tenantId: t, clientId: c, daServerId: srv, daUsername: 'u',
      domain: 'ex.ro', status: 'active', recurringAmount: 99, currency: 'RON',
      nextDueDate: '2026-06-05', autoRenew: true,
    });

    await notifyHostingRenewalReminder(t, a, 7);
    await notifyHostingRenewalReminder(t, a, 7); // dedupe

    const logs = await db.select().from(schema.emailLog)
      .where(eq(schema.emailLog.emailType, 'hosting-renewal-reminder'));
    expect(logs.length).toBe(1);
  });
});
```

- [ ] **Step 5: Create scheduler task**

First locate the scheduler registration pattern:

Run: `grep -rn "registerTask\|scheduler.add\|cron" src/lib/server/scheduler/ --include="*.ts" | head -10`

Adapt the new task to that pattern. Example assuming a `Worker`+ `Queue` pattern with cron:

```typescript
// File: app/src/lib/server/scheduler/tasks/hosting-renewal-reminder.ts
import { db } from '$lib/server/db';
import { eq, and, isNotNull, sql } from 'drizzle-orm';
import { hostingAccount, hostingEmailEvent } from '$lib/server/db/schema';
import { notifyHostingRenewalReminder } from '$lib/server/hosting/notifications';
import { logInfo, logError } from '$lib/server/logger';

const WINDOWS = [1, 7, 14] as const;

export async function runHostingRenewalReminder(): Promise<{ checked: number; sent: number; skipped: number }> {
  let checked = 0, sent = 0, skipped = 0;
  for (const days of WINDOWS) {
    const candidates = await db.select({
      id: hostingAccount.id,
      tenantId: hostingAccount.tenantId,
      nextDueDate: hostingAccount.nextDueDate,
    })
      .from(hostingAccount)
      .where(and(
        eq(hostingAccount.status, 'active'),
        isNotNull(hostingAccount.nextDueDate),
        sql`date(${hostingAccount.nextDueDate}) = date('now', '+${sql.raw(String(days))} days')`,
      ));

    for (const acc of candidates) {
      checked++;
      // Self-healing: notify dedupes internally; skip-with-warning is normal
      try {
        await notifyHostingRenewalReminder(acc.tenantId, acc.id, days);
        sent++;
      } catch (err) {
        logError('renewal reminder dispatch failed', { accountId: acc.id, days, err });
        skipped++;
      }
    }
  }
  logInfo('hosting renewal reminder run complete', { checked, sent, skipped });
  return { checked, sent, skipped };
}
```

- [ ] **Step 6: Register scheduler task hourly 08-20 EET**

Find the file that registers other scheduled tasks (e.g., `src/lib/server/scheduler/index.ts` or `register.ts`). Add:

```typescript
import { runHostingRenewalReminder } from './tasks/hosting-renewal-reminder';

// Register hourly 08-20 EET
scheduler.register({
  name: 'hosting-renewal-reminder',
  cron: '0 8-20 * * *',
  timezone: 'Europe/Bucharest',
  handler: runHostingRenewalReminder,
});
```

Adapt to actual registration API of this codebase.

- [ ] **Step 7: Run all hosting tests**

Run: `bun test src/lib/server/hosting/`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add app/src/lib/server/hosting/email-templates/renewal-reminder.ts \
        app/src/lib/server/hosting/email-templates/__tests__/renewal-reminder.test.ts \
        app/scripts/demo-hosting-renewal-reminder-email.ts \
        app/src/lib/server/hosting/notifications.ts \
        app/src/lib/server/hosting/__tests__/notifications.test.ts \
        app/src/lib/server/scheduler/
git commit -m "feat(hosting): renewal-reminder template + hourly cron 08-20 EET self-healing"
```

---

## Task 12: `hosting-payment-failed` flow + Stripe webhook

**Files:**
- Create: `app/src/lib/server/hosting/email-templates/payment-failed.ts`
- Create: `app/src/lib/server/hosting/email-templates/__tests__/payment-failed.test.ts`
- Create: `app/scripts/demo-hosting-payment-failed-email.ts`
- Modify: `app/src/lib/server/hosting/notifications.ts`
- Modify: `app/src/lib/server/hosting/__tests__/notifications.test.ts`
- Modify: `app/src/lib/server/stripe/webhook-handlers.ts`

- [ ] **Step 1: Template + test + demo (same pattern)**

```typescript
// File: app/src/lib/server/hosting/email-templates/__tests__/payment-failed.test.ts
import { describe, test, expect } from 'bun:test';
import { render } from '../payment-failed';

describe('payment-failed template', () => {
  const fixture = {
    domain: 'example.ro', clientName: 'Ion Popescu',
    invoiceNumber: 'INV-2026-0042', amountDue: 99, currency: 'RON' as const,
    failureReason: 'Card expired',
    updateMethodUrl: 'https://billing.stripe.com/p/session/...',
    manualPayUrl: 'https://clients.onetopsolution.ro/ots/invoices/inv_abc/pay',
    daysUntilSuspend: 10,
  };
  test('subject contains domain', () => {
    expect(render(fixture).subject).toContain('example.ro');
  });
  test('html shows failure reason and update method link', () => {
    expect(render(fixture).html).toContain('Card expired');
    expect(render(fixture).html).toContain(fixture.updateMethodUrl);
    expect(render(fixture).html).toContain('10');
  });
});
```

```typescript
// File: app/src/lib/server/hosting/email-templates/payment-failed.ts
import { renderBrandedEmail } from '$lib/server/email';

export interface PaymentFailedInput {
  domain: string; clientName: string;
  invoiceNumber: string; amountDue: number; currency: 'RON'|'EUR'|'USD';
  failureReason: string;
  updateMethodUrl: string; manualPayUrl: string;
  daysUntilSuspend: number;
  locale?: 'ro';
}

export function render(input: PaymentFailedInput): { subject: string; html: string } {
  const subject = `Plata pentru hosting ${input.domain} a eșuat — acțiune necesară`;
  const body = `
    <p>Salut <strong>${input.clientName}</strong>,</p>
    <p>Plata pentru factura <strong>${input.invoiceNumber}</strong> (${input.amountDue} ${input.currency}) a eșuat.</p>
    <p><strong>Motiv:</strong> ${input.failureReason}</p>
    <p>Dacă nu rezolvi situația în ${input.daysUntilSuspend} zile, hostingul va fi suspendat.</p>
    <p style="margin-top:20px;">
      <a href="${input.updateMethodUrl}"
         style="display:inline-block;background:#0ea5e9;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;">
        Actualizează metoda de plată
      </a>
      &nbsp;
      <a href="${input.manualPayUrl}"
         style="display:inline-block;background:#fff;color:#0ea5e9;border:1px solid #0ea5e9;padding:10px 18px;border-radius:6px;text-decoration:none;">
        Plătește manual
      </a>
    </p>
  `;
  return { subject, html: renderBrandedEmail({ title: 'Plată hosting eșuată', body }) };
}
```

- [ ] **Step 2: Run template test (2 pass)**

- [ ] **Step 3: Add `notifyHostingPaymentFailed` to notifications.ts**

```typescript
import { render as renderPaymentFailed } from './email-templates/payment-failed';

export async function notifyHostingPaymentFailed(
  tenantId: string,
  accountId: string,
  invoiceId: string,
  failureReason: string = 'plată eșuată',
): Promise<void> {
  const dedupeKey = `payment-failed:${invoiceId}`;
  const dedupeRowId = nanoid();
  const inserted = await db.insert(hostingEmailEvent).values({
    id: dedupeRowId, tenantId, hostingAccountId: accountId,
    eventType: 'payment-failed', dedupeKey, sentAt: new Date(),
  }).onConflictDoNothing({
    target: [hostingEmailEvent.tenantId, hostingEmailEvent.hostingAccountId, hostingEmailEvent.dedupeKey],
  }).returning({ id: hostingEmailEvent.id });
  if (inserted.length === 0) return;

  try {
    const [account] = await db.select().from(hostingAccount)
      .where(and(eq(hostingAccount.id, accountId), eq(hostingAccount.tenantId, tenantId)))
      .limit(1);
    const [inv] = await db.select().from(invoice).where(eq(invoice.id, invoiceId)).limit(1);
    if (!account || !inv) throw new Error('account or invoice missing');
    const customer = await resolveCustomerEmail({ id: account.id, tenantId, clientId: account.clientId });
    const [t] = await db.select({ slug: tenantTable.slug }).from(tenantTable)
      .where(eq(tenantTable.id, tenantId)).limit(1);

    const { subject, html } = renderPaymentFailed({
      domain: account.domain, clientName: customer.name,
      invoiceNumber: inv.invoiceNumber ?? inv.id,
      amountDue: Number(inv.totalAmount ?? 0),
      currency: (inv.currency as 'RON'|'EUR'|'USD') ?? 'RON',
      failureReason,
      updateMethodUrl: `https://billing.stripe.com/p/session/...`, // create on demand in handler
      manualPayUrl: `https://clients.onetopsolution.ro/${t!.slug}/invoices/${invoiceId}/pay`,
      daysUntilSuspend: 10,
    });

    const emailLogId = await sendWithPersistence({
      tenantId, toEmail: customer.email, subject, html,
      emailType: 'hosting-payment-failed',
      payload: { sendFn: 'sendHostingPaymentFailedEmail', args: [tenantId, accountId, invoiceId, failureReason] },
    });
    await db.update(hostingEmailEvent).set({ emailLogId }).where(eq(hostingEmailEvent.id, dedupeRowId));
  } catch (err) {
    logError('notifyHostingPaymentFailed failed', { tenantId, accountId, invoiceId, err });
    throw err;
  }
}
```

- [ ] **Step 4: Hook into Stripe webhook handler**

Run: `grep -n "invoice.payment_failed\|payment_failed" src/lib/server/stripe/webhook-handlers.ts | head -5`

If the event type isn't handled today, add a new branch:

```typescript
// In src/lib/server/stripe/webhook-handlers.ts:
case 'invoice.payment_failed': {
  const stripeInvoice = event.data.object as Stripe.Invoice;
  const subscriptionId = typeof stripeInvoice.subscription === 'string'
    ? stripeInvoice.subscription : stripeInvoice.subscription?.id;
  if (!subscriptionId) break;

  // Find hosting account via stripeSubscriptionId
  const [account] = await db.select().from(hostingAccount)
    .where(eq(hostingAccount.stripeSubscriptionId, subscriptionId)).limit(1);
  if (!account) break;

  // Find or create the matching internal invoice row
  const internalInvoiceId = stripeInvoice.metadata?.internalInvoiceId; // adapt if you store it differently
  if (!internalInvoiceId) {
    logError('cannot map stripe invoice to internal invoice', { stripeInvoiceId: stripeInvoice.id });
    break;
  }

  const failureReason = stripeInvoice.last_finalization_error?.message
    ?? stripeInvoice.charges?.data?.[0]?.failure_message
    ?? 'plată eșuată';

  await notifyHostingPaymentFailed(account.tenantId, account.id, internalInvoiceId, failureReason)
    .catch((err) => logError('payment-failed notify failed', { err }));
  break;
}
```

Add the import:

```typescript
import { notifyHostingPaymentFailed } from '$lib/server/hosting/notifications';
import { hostingAccount } from '$lib/server/db/schema';
```

- [ ] **Step 5: Add notify test**

Append to `notifications.test.ts`:

```typescript
import { notifyHostingPaymentFailed } from '../notifications';

describe('notifyHostingPaymentFailed', () => {
  test('writes 1 email_log row + dedupes 48h on same invoice', async () => {
    const t = nanoid(), c = nanoid(), srv = nanoid(), a = nanoid(), i = nanoid();
    await db.insert(schema.tenant).values({ id: t, slug: `t-${t.slice(0,8)}`, name: 'T' });
    await db.insert(schema.client).values({ id: c, tenantId: t, email: 'c@ex.ro', companyName: 'A' });
    await db.insert(schema.daServer).values({ id: srv, tenantId: t, name: 's', host: 'h', port: 2222, apiUsername: 'a', apiPasswordEncrypted: 'e' });
    await db.insert(schema.hostingAccount).values({ id: a, tenantId: t, clientId: c, daServerId: srv, daUsername: 'u', domain: 'ex.ro', status: 'active' });
    await db.insert(schema.invoice).values({ id: i, tenantId: t, clientId: c, totalAmount: 99, currency: 'RON', status: 'overdue' });

    await notifyHostingPaymentFailed(t, a, i, 'Card expired');
    await notifyHostingPaymentFailed(t, a, i, 'Card expired'); // dedupe
    const logs = await db.select().from(schema.emailLog)
      .where(eq(schema.emailLog.emailType, 'hosting-payment-failed'));
    expect(logs.length).toBe(1);
  });
});
```

- [ ] **Step 6: Run all hosting tests + commit**

```bash
bun test src/lib/server/hosting/
git add app/src/lib/server/hosting/email-templates/payment-failed.ts \
        app/src/lib/server/hosting/email-templates/__tests__/payment-failed.test.ts \
        app/scripts/demo-hosting-payment-failed-email.ts \
        app/src/lib/server/hosting/notifications.ts \
        app/src/lib/server/hosting/__tests__/notifications.test.ts \
        app/src/lib/server/stripe/webhook-handlers.ts
git commit -m "feat(hosting): payment-failed notification + Stripe invoice.payment_failed handler"
```

---

## Task 13: `payment-succeeded` — wire dispatcher + disable existing `invoice.paid` hook

**Files:**
- Create: `app/src/lib/server/stripe/notifications.ts`
- Create: `app/src/lib/server/stripe/__tests__/notifications.test.ts`
- Modify: `app/src/lib/server/stripe/post-payment/dispatcher.ts`
- Modify: `app/src/lib/server/hooks/email-notifications.ts` (disable existing listener)

- [ ] **Step 1: Locate existing `invoice.paid` hook**

Run: `grep -n "invoice.paid\|sendInvoicePaidEmail\|registerEmailNotificationHooks" src/lib/server/hooks/email-notifications.ts | head -10`

Note the function or listener registration that fires on `invoice.paid` event.

- [ ] **Step 2: Create `notifyPaymentSucceeded` wrapper**

```typescript
// File: app/src/lib/server/stripe/notifications.ts
import { db } from '$lib/server/db';
import { eq, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { paymentEmailEvent, invoice as invoiceTable } from '$lib/server/db/schema';
import { sendInvoicePaidEmail } from '$lib/server/email';
import { logInfo, logError } from '$lib/server/logger';

export async function notifyPaymentSucceeded(
  tenantId: string,
  invoiceId: string,
): Promise<void> {
  const dedupeKey = `payment-succeeded:${invoiceId}`;
  const dedupeRowId = nanoid();
  const inserted = await db.insert(paymentEmailEvent).values({
    id: dedupeRowId, tenantId, invoiceId,
    eventType: 'payment-succeeded', dedupeKey, sentAt: new Date(),
  }).onConflictDoNothing({
    target: [paymentEmailEvent.tenantId, paymentEmailEvent.invoiceId, paymentEmailEvent.dedupeKey],
  }).returning({ id: paymentEmailEvent.id });
  if (inserted.length === 0) {
    logInfo('notifyPaymentSucceeded dedupe hit', { tenantId, invoiceId });
    return;
  }

  try {
    const [inv] = await db.select()
      .from(invoiceTable)
      .where(and(eq(invoiceTable.id, invoiceId), eq(invoiceTable.tenantId, tenantId)))
      .limit(1);
    if (!inv) throw new Error(`invoice ${invoiceId} not found`);
    if (!inv.clientEmail) throw new Error(`invoice ${invoiceId} has no clientEmail`);

    // Delegate to existing function; it handles persistence + PDF attach
    await sendInvoicePaidEmail(invoiceId, inv.clientEmail);
    // sendInvoicePaidEmail writes its own emailLog row; we don't need to track emailLogId here
  } catch (err) {
    logError('notifyPaymentSucceeded failed', { tenantId, invoiceId, err });
    throw err;
  }
}
```

If `invoice` table doesn't have a `clientEmail` column directly, derive it from `invoice.clientId → client.email` and adapt accordingly. Confirm via `grep -n "clientEmail\|invoiceTable.*email\|recipient" src/lib/server/db/schema.ts | head -5`.

- [ ] **Step 3: Wire dispatcher**

Run: `grep -n "keez_invoice\|emitKeezFiscalInvoice\|runPostPaymentSteps" src/lib/server/stripe/post-payment/dispatcher.ts | head -10`

After the step `keez_invoice` returns success in the dispatcher, add:

```typescript
import { notifyPaymentSucceeded } from '$lib/server/stripe/notifications';

// In dispatcher.ts, after keez_invoice step success:
if (keezStepResult.status === 'success') {
  notifyPaymentSucceeded(tenantId, invoiceId).catch((err) => {
    logError('payment-succeeded notify failed', { tenantId, invoiceId, err });
  });
}
```

- [ ] **Step 4: Disable existing `invoice.paid` listener**

In `src/lib/server/hooks/email-notifications.ts`, find the function `registerEmailNotificationHooks` (or whatever name registers the `invoice.paid` listener) and comment out the listener registration with explicit reason:

```typescript
// DISABLED 2026-05-22: Stripe post-payment dispatcher is now the sole driver of
// payment-succeeded emails (via notifyPaymentSucceeded). Re-enabling this listener
// would cause double-send. See docs/superpowers/specs/2026-05-22-hosting-email-flow-design.md
// (resolved question Q2).
//
// emitter.on('invoice.paid', async (event) => { ... });
```

If the listener does ONLY invoice.paid email and nothing else, comment out the whole block. If it does other side-effects, narrow the comment-out to just the email-send call inside.

- [ ] **Step 5: Test notifyPaymentSucceeded**

```typescript
// File: app/src/lib/server/stripe/__tests__/notifications.test.ts
import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { db } from '$lib/server/db';
import * as schema from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { notifyPaymentSucceeded } from '../notifications';

describe('notifyPaymentSucceeded', () => {
  test('first call invokes sendInvoicePaidEmail; second is deduped', async () => {
    // Note: this test assumes sendInvoicePaidEmail handles its own emailLog;
    // we verify dedupe via payment_email_event count.
    const t = nanoid(), c = nanoid(), i = nanoid();
    await db.insert(schema.tenant).values({ id: t, slug: `t-${t.slice(0,8)}`, name: 'T' });
    await db.insert(schema.client).values({ id: c, tenantId: t, email: 'c@ex.ro', companyName: 'A' });
    await db.insert(schema.invoice).values({ id: i, tenantId: t, clientId: c, clientEmail: 'c@ex.ro', totalAmount: 99, currency: 'RON', status: 'paid' });

    await notifyPaymentSucceeded(t, i);
    await notifyPaymentSucceeded(t, i); // dedupe

    const events = await db.select().from(schema.paymentEmailEvent)
      .where(eq(schema.paymentEmailEvent.invoiceId, i));
    expect(events.length).toBe(1);
  });
});
```

- [ ] **Step 6: Run + commit**

```bash
bun test src/lib/server/stripe/
git add app/src/lib/server/stripe/notifications.ts \
        app/src/lib/server/stripe/__tests__/notifications.test.ts \
        app/src/lib/server/stripe/post-payment/dispatcher.ts \
        app/src/lib/server/hooks/email-notifications.ts
git commit -m "feat(stripe): notifyPaymentSucceeded driven by dispatcher; disable legacy invoice.paid hook to prevent double-send"
```

---

## Task 14: `admin-payment-received` flow

**Files:**
- Create: `app/src/lib/server/stripe/email-templates/admin-payment-received.ts`
- Create: `app/src/lib/server/stripe/email-templates/__tests__/admin-payment-received.test.ts`
- Create: `app/scripts/demo-admin-payment-received-email.ts`
- Modify: `app/src/lib/server/stripe/notifications.ts`
- Modify: `app/src/lib/server/stripe/post-payment/dispatcher.ts`

- [ ] **Step 1: Template**

```typescript
// File: app/src/lib/server/stripe/email-templates/__tests__/admin-payment-received.test.ts
import { describe, test, expect } from 'bun:test';
import { render } from '../admin-payment-received';

describe('admin-payment-received template', () => {
  const fixture = {
    tenantSlug: 'ots',
    clientName: 'Acme SRL',
    amount: 99, currency: 'RON' as const,
    invoiceNumber: 'INV-2026-0042',
    productDescriptions: ['Hosting WP Pro 1 lună', 'SSL certificate'],
    crmInvoiceUrl: 'https://clients.onetopsolution.ro/ots/invoices/inv_abc',
    stepStatuses: { magic_link: 'ok', keez_invoice: 'ok', da_provision: 'ok' },
  };
  test('subject contains amount + tenant slug', () => {
    expect(render(fixture).subject).toContain('99');
    expect(render(fixture).subject).toContain('ots');
  });
  test('html lists post-payment step statuses', () => {
    const h = render(fixture).html;
    expect(h).toContain('magic_link');
    expect(h).toContain('keez_invoice');
    expect(h).toContain('da_provision');
  });
});
```

```typescript
// File: app/src/lib/server/stripe/email-templates/admin-payment-received.ts
import { renderBrandedEmail } from '$lib/server/email';

export interface AdminPaymentReceivedInput {
  tenantSlug: string;
  clientName: string;
  amount: number; currency: 'RON'|'EUR'|'USD';
  invoiceNumber: string;
  productDescriptions: string[];
  crmInvoiceUrl: string;
  stepStatuses: Record<string, 'ok' | 'failed' | 'skipped' | string>;
  locale?: 'ro';
}

export function render(input: AdminPaymentReceivedInput): { subject: string; html: string } {
  const subject = `💰 Plată nouă: ${input.amount} ${input.currency} — ${input.clientName} (${input.tenantSlug})`;
  const stepsHtml = Object.entries(input.stepStatuses).map(([step, status]) => {
    const color = status === 'ok' ? '#10b981' : '#dc2626';
    return `<li><code>${step}</code>: <span style="color:${color};">${status}</span></li>`;
  }).join('');
  const body = `
    <p>O plată nouă a fost procesată.</p>
    <table>
      <tr><td style="padding:6px 0;color:#666;">Tenant</td><td style="padding:6px 0;"><strong>${input.tenantSlug}</strong></td></tr>
      <tr><td style="padding:6px 0;color:#666;">Client</td><td style="padding:6px 0;"><strong>${input.clientName}</strong></td></tr>
      <tr><td style="padding:6px 0;color:#666;">Sumă</td><td style="padding:6px 0;"><strong>${input.amount} ${input.currency}</strong></td></tr>
      <tr><td style="padding:6px 0;color:#666;">Factura</td><td style="padding:6px 0;"><strong>${input.invoiceNumber}</strong></td></tr>
    </table>
    <h3 style="margin-top:24px;">Produse</h3>
    <ul>${input.productDescriptions.map((p) => `<li>${p}</li>`).join('')}</ul>
    <h3>Post-payment steps</h3>
    <ul>${stepsHtml}</ul>
    <p style="margin-top:24px;">
      <a href="${input.crmInvoiceUrl}"
         style="display:inline-block;background:#0ea5e9;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;">
        Deschide factura în CRM
      </a>
    </p>
  `;
  return { subject, html: renderBrandedEmail({ title: 'Plată nouă primită', body }) };
}
```

```typescript
// File: app/scripts/demo-admin-payment-received-email.ts
import { render } from '../src/lib/server/stripe/email-templates/admin-payment-received';
const { subject, html } = render({
  tenantSlug: 'ots', clientName: 'Acme SRL',
  amount: 99, currency: 'RON', invoiceNumber: 'INV-2026-0042',
  productDescriptions: ['Hosting WP Pro 1 lună', 'SSL certificate'],
  crmInvoiceUrl: 'https://clients.onetopsolution.ro/ots/invoices/inv_abc',
  stepStatuses: { magic_link: 'ok', keez_invoice: 'ok', da_provision: 'ok' },
});
console.log(`<!-- Subject: ${subject} -->`); console.log(html);
```

- [ ] **Step 2: Add notify function**

Append to `src/lib/server/stripe/notifications.ts`:

```typescript
import { sendWithPersistence } from '$lib/server/email';
import { resolveAdminRecipients } from '$lib/server/hosting/notifications-helpers';
import { tenant as tenantTable, invoiceLineItem } from '$lib/server/db/schema';
import { render as renderAdminPayment } from './email-templates/admin-payment-received';

export interface PostPaymentStepStatus {
  [stepName: string]: 'ok' | 'failed' | 'skipped' | string;
}

export async function notifyAdminPaymentReceived(
  tenantId: string,
  invoiceId: string,
  stepStatuses: PostPaymentStepStatus = {},
): Promise<void> {
  const dedupeKey = `admin-payment-received:${invoiceId}`;
  const dedupeRowId = nanoid();
  const inserted = await db.insert(paymentEmailEvent).values({
    id: dedupeRowId, tenantId, invoiceId,
    eventType: 'admin-payment-received', dedupeKey, sentAt: new Date(),
  }).onConflictDoNothing({
    target: [paymentEmailEvent.tenantId, paymentEmailEvent.invoiceId, paymentEmailEvent.dedupeKey],
  }).returning({ id: paymentEmailEvent.id });
  if (inserted.length === 0) return;

  try {
    const [inv] = await db.select().from(invoiceTable)
      .where(eq(invoiceTable.id, invoiceId)).limit(1);
    if (!inv) throw new Error('invoice not found');
    const [t] = await db.select({ slug: tenantTable.slug }).from(tenantTable)
      .where(eq(tenantTable.id, tenantId)).limit(1);
    const lineItems = await db.select({ description: invoiceLineItem.description })
      .from(invoiceLineItem).where(eq(invoiceLineItem.invoiceId, invoiceId));

    const recipients = await resolveAdminRecipients(tenantId);
    const { subject, html } = renderAdminPayment({
      tenantSlug: t!.slug,
      clientName: inv.clientName ?? inv.clientEmail ?? 'client',
      amount: Number(inv.totalAmount ?? 0),
      currency: (inv.currency as 'RON'|'EUR'|'USD') ?? 'RON',
      invoiceNumber: inv.invoiceNumber ?? inv.id,
      productDescriptions: lineItems.map((li) => li.description ?? '').filter(Boolean),
      crmInvoiceUrl: `https://clients.onetopsolution.ro/${t!.slug}/invoices/${invoiceId}`,
      stepStatuses,
    });

    for (const email of recipients) {
      const emailLogId = await sendWithPersistence({
        tenantId, toEmail: email, subject, html,
        emailType: 'admin-payment-received',
        payload: { sendFn: 'sendAdminPaymentReceivedEmail', args: [tenantId, invoiceId, stepStatuses] },
      });
      await db.update(paymentEmailEvent).set({ emailLogId }).where(eq(paymentEmailEvent.id, dedupeRowId));
    }
  } catch (err) {
    logError('notifyAdminPaymentReceived failed', { tenantId, invoiceId, err });
    throw err;
  }
}
```

- [ ] **Step 3: Wire dispatcher (call after all steps complete)**

In `dispatcher.ts`, at the end of `runPostPaymentSteps()` (after the loop that runs all 3 steps), collect step statuses into an object and dispatch:

```typescript
const stepStatuses: PostPaymentStepStatus = {};
for (const step of completedSteps) {
  stepStatuses[step.name] = step.status; // 'ok' / 'failed' / 'skipped'
}
notifyAdminPaymentReceived(tenantId, invoiceId, stepStatuses).catch((err) => {
  logError('admin-payment-received notify failed', { tenantId, invoiceId, err });
});
```

Adapt to the actual shape of `completedSteps` in this codebase.

- [ ] **Step 4: Run tests + commit**

```bash
bun test src/lib/server/stripe/
git add app/src/lib/server/stripe/email-templates/admin-payment-received.ts \
        app/src/lib/server/stripe/email-templates/__tests__/admin-payment-received.test.ts \
        app/scripts/demo-admin-payment-received-email.ts \
        app/src/lib/server/stripe/notifications.ts \
        app/src/lib/server/stripe/post-payment/dispatcher.ts
git commit -m "feat(stripe): admin-payment-received notification + dispatcher wiring with step statuses"
```

---

## Task 15: Wire `payment-succeeded` template (for client) into existing `sendInvoicePaidEmail`

This task is intentional housekeeping. `sendInvoicePaidEmail` already exists and is invoked by `notifyPaymentSucceeded` from Task 13. We don't need a new template module — `sendInvoicePaidEmail` renders its own HTML. But we DO need a demo script + a sanity check.

**Files:**
- Create: `app/scripts/demo-payment-succeeded-email.ts`

- [ ] **Step 1: Demo script for existing email**

Find a real (or representative) `invoice.id` in the dev DB:

Run: `bun -e "import { db } from './src/lib/server/db'; import { invoice } from './src/lib/server/db/schema'; const r = await db.select({id: invoice.id, clientEmail: invoice.clientEmail}).from(invoice).limit(3); console.log(r);"`

Then:

```typescript
// File: app/scripts/demo-payment-succeeded-email.ts
// Renders the existing sendInvoicePaidEmail output for a sample invoice.
// Usage: bun app/scripts/demo-payment-succeeded-email.ts <invoiceId>
// Note: this calls the real send function in DRY-RUN mode if such mode exists,
// or you can comment out the send and just log the rendered HTML.

const invoiceId = process.argv[2];
if (!invoiceId) {
  console.error('Usage: bun app/scripts/demo-payment-succeeded-email.ts <invoiceId>');
  process.exit(1);
}
// Adapt: most demo scripts in this repo render to stdout WITHOUT sending.
// Find the renderer used by sendInvoicePaidEmail and call it directly here.
// For now, just log the function would be invoked:
console.log(`Would invoke sendInvoicePaidEmail('${invoiceId}', '<clientEmail from DB>')`);
console.log('See src/lib/server/email.ts:1904 for the actual template rendering.');
```

This script's purpose is operational — it lets the user quickly inspect the actual `sendInvoicePaidEmail` rendering. If a render-only helper exists in the codebase (separate from send), call it directly here for true HTML preview.

- [ ] **Step 2: Commit**

```bash
git add app/scripts/demo-payment-succeeded-email.ts
git commit -m "chore(stripe): demo script for payment-succeeded client email preview"
```

---

## Task 16: Inquiry DELETE safety check

**Files:**
- Modify: existing route/remote that deletes `hostingInquiry` rows
- Add: a small integration test

- [ ] **Step 1: Locate inquiry DELETE endpoint**

Run: `grep -rn "delete.*hostingInquiry\|hostingInquiry.*delete\|DELETE.*inquiry" src/ --include="*.ts" | head -10`

Identify the function or route handler.

- [ ] **Step 2: Add safety guard**

```typescript
// In the DELETE handler, BEFORE the actual delete:
const linkedAccount = await db.select({ id: hostingAccount.id })
  .from(hostingAccount)
  .innerJoin(hostingInquiry, eq(hostingInquiry.hostingAccountId, hostingAccount.id))
  .where(eq(hostingInquiry.id, inquiryId))
  .limit(1);
if (linkedAccount.length > 0) {
  throw error(409, 'Cannot delete inquiry while linked hosting account exists');
}
```

If the handler uses a different error shape (return `Response`, throw `ApiError`, etc.), adapt to match.

- [ ] **Step 3: Add test**

```typescript
// Add to nearest relevant test file or create app/src/lib/server/hosting/__tests__/inquiry-delete-safety.test.ts
import { describe, test, expect } from 'bun:test';
import { db } from '$lib/server/db';
import * as schema from '$lib/server/db/schema';
import { nanoid } from 'nanoid';
// Adapt the import to the actual delete handler being modified:
import { deleteHostingInquiry } from '$lib/remotes/hosting-inquiries.remote';

describe('hostingInquiry delete safety', () => {
  test('refuses delete when a hosting account references the inquiry', async () => {
    const t = nanoid(), inq = nanoid(), a = nanoid(), srv = nanoid();
    await db.insert(schema.tenant).values({ id: t, slug: `t-${t.slice(0,8)}`, name: 'T' });
    await db.insert(schema.daServer).values({ id: srv, tenantId: t, name: 's', host: 'h', port: 2222, apiUsername: 'a', apiPasswordEncrypted: 'e' });
    await db.insert(schema.hostingAccount).values({ id: a, tenantId: t, clientId: null, daServerId: srv, daUsername: 'u', domain: 'ex.ro', status: 'active' });
    await db.insert(schema.hostingInquiry).values({
      id: inq, tenantId: t, hostingAccountId: a,
      contactName: 'X', contactEmail: 'x@ex.ro',
      status: 'converted', paymentStatus: 'paid',
    });
    expect(deleteHostingInquiry(inq)).rejects.toThrow(/linked hosting account/i);
  });
});
```

- [ ] **Step 4: Run + commit**

```bash
bun test src/lib/server/hosting/
git add app/src/lib/remotes/hosting-inquiries.remote.ts \
        app/src/lib/server/hosting/__tests__/inquiry-delete-safety.test.ts
git commit -m "feat(hosting): guard against deleting inquiry while linked account exists"
```

---

## Task 17: Admin debug endpoint

**Files:**
- Create: `app/src/routes/[tenant]/api/_debug-hosting-emails/+server.ts`

- [ ] **Step 1: Locate existing admin guard pattern**

Run: `grep -rn "_debug-stripe-health\|_debug-keez-health\|_debug-directadmin-health" src/routes/ --include="+server.ts" | head -3`

Read one of them to copy the auth/admin-check pattern.

- [ ] **Step 2: Implement endpoint**

```typescript
// File: app/src/routes/[tenant]/api/_debug-hosting-emails/+server.ts
import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { eq, and, desc } from 'drizzle-orm';
import { hostingAccount, hostingEmailEvent, emailLog } from '$lib/server/db/schema';
import {
  notifyHostingAccountCreated,
  notifyHostingSuspended,
  notifyHostingReactivated,
  notifyHostingRenewalReminder,
  notifyHostingPaymentFailed,
  notifyHostingProvisioningFailed,
} from '$lib/server/hosting/notifications';
import { runHostingRenewalReminder } from '$lib/server/scheduler/tasks/hosting-renewal-reminder';
import { render as renderAccountCreated } from '$lib/server/hosting/email-templates/account-created';
// import other templates similarly...

export const GET: RequestHandler = async ({ params, url, locals }) => {
  // Admin guard
  if (!locals.user || !['owner', 'admin'].includes(locals.tenantUser?.role ?? '')) {
    throw error(403, 'admin only');
  }
  const tenantId = locals.tenantId;
  const action = url.searchParams.get('action');

  switch (action) {
    case 'resend': {
      const accountId = url.searchParams.get('accountId');
      const type = url.searchParams.get('type');
      if (!accountId || !type) throw error(400, 'accountId and type required');
      // Map type -> notify fn
      if (type === 'welcome') await notifyHostingAccountCreated(tenantId, accountId);
      // ... other types
      return json({ ok: true });
    }
    case 'preview': {
      const accountId = url.searchParams.get('accountId');
      if (!accountId) throw error(400, 'accountId required');
      const [account] = await db.select().from(hostingAccount)
        .where(and(eq(hostingAccount.id, accountId), eq(hostingAccount.tenantId, tenantId))).limit(1);
      if (!account) throw error(404);
      // Render but DO NOT send
      const html = '<p>Preview not implemented for all types — adapt as needed</p>';
      return new Response(html, { headers: { 'content-type': 'text/html' } });
    }
    case 'force-renewal-check': {
      const result = await runHostingRenewalReminder();
      return json(result);
    }
    case 'dedupe-table': {
      const rows = await db.select().from(hostingEmailEvent)
        .where(eq(hostingEmailEvent.tenantId, tenantId))
        .orderBy(desc(hostingEmailEvent.sentAt))
        .limit(50);
      return json(rows);
    }
    default:
      throw error(400, `unknown action: ${action}`);
  }
};
```

- [ ] **Step 3: Test endpoint locally**

Start dev server: `cd /Users/augustin598/Projects/CRM/app && bun run dev`

In another terminal:
```bash
curl -i 'http://localhost:5173/ots/api/_debug-hosting-emails?action=force-renewal-check' \
  -H 'cookie: <session-cookie-from-dev-login>'
```
Expected: `{ checked: N, sent: M, skipped: K }`.

- [ ] **Step 4: Commit**

```bash
git add app/src/routes/[tenant]/api/_debug-hosting-emails/
git commit -m "feat(hosting): admin debug endpoint for resend/preview/force-renewal/dedupe-table"
```

---

## Task 18: Smoke test in staging tenant

**Files:**
- None (manual test)

- [ ] **Step 1: Deploy current branch to staging**

Confirm with user before running. Then per memory `reference_deploy_command.md`:

```bash
cd /Users/augustin598/Projects/CRM
hosted-cli deploy app-config.json
```

- [ ] **Step 2: Smoke test welcome email**

1. Log in as admin to the dev tenant.
2. Trigger a fresh DA provision via `/[tenant]/hosting/accounts` → "New account".
3. Verify the welcome email arrives in the test inbox with credentials + "Schimbă parola acum" CTA.

- [ ] **Step 3: Smoke test suspension + reactivation**

1. Mark a hosting invoice as `overdue` with `dueDate = today - 11 days` (past 10d grace).
2. Manually trigger the suspend hook (or wait for cron if it runs frequently).
3. Verify `hosting-suspended` email arrives.
4. Mark the invoice as `paid`.
5. Verify DA unsuspend executes (if no other unpaid hosting invoices).
6. Verify `hosting-reactivated` email arrives.

- [ ] **Step 4: Smoke test renewal scheduler**

1. Create a hosting account with `nextDueDate = today + 7 days` (one of the windows).
2. Hit debug endpoint: `GET /[tenant]/api/_debug-hosting-emails?action=force-renewal-check`
3. Verify `hosting-renewal-reminder` email arrives.
4. Call the same endpoint again immediately. Verify no second email (dedupe works).

- [ ] **Step 5: Smoke test payment-failed**

1. Use Stripe test card `4000 0000 0000 0341` (card_declined) on a subscription invoice.
2. Verify `hosting-payment-failed` email arrives.

- [ ] **Step 6: Smoke test payment-succeeded + admin-payment-received**

1. Use Stripe test card `4242 4242 4242 4242` for a fresh checkout.
2. Verify `payment-succeeded` email (with Keez PDF) arrives to client.
3. Verify `admin-payment-received` email arrives to owner/admin user.

- [ ] **Step 7: Smoke test orphan provisioning-failed**

1. In dev DB, create a hosting account with `clientId = null` AND no matching `hostingInquiry`.
2. Trigger a provisioning failure (e.g., bad DA credentials in tenant config).
3. Verify `hosting-provisioning-failed` admin email arrives with `reason: orphan_no_customer` or `da_create_failed`.

- [ ] **Step 8: Verify dedupe tables**

```sql
-- Via debug endpoint or direct SQL:
SELECT event_type, dedupe_key, sent_at, email_log_id
  FROM hosting_email_event
  ORDER BY sent_at DESC LIMIT 20;

SELECT event_type, dedupe_key, sent_at, email_log_id
  FROM payment_email_event
  ORDER BY sent_at DESC LIMIT 10;
```

Verify each event has exactly one dedupe row, each linked to an `email_log.id`.

- [ ] **Step 9: Update memory with project completion**

Per memory convention, save a new project memory file documenting key files + lessons:

```bash
# After successful smoke test, add a memory entry:
# ~/.claude/projects/-Users-augustin598-Projects-CRM/memory/project_hosting_email_flow_2026_05.md
```

Content: short summary of what shipped, key files, gotchas encountered during smoke test.

---

## Final Self-Review Checklist

Before declaring done:

- [ ] All 8 emails verified working end-to-end in staging
- [ ] All unit + integration tests pass: `bun test src/lib/server/hosting/ src/lib/server/stripe/ src/lib/server/email-types.test.ts`
- [ ] `bunx --bun svelte-check --threshold warning` — 0 errors
- [ ] All 7 migrations applied on Turso remote (`PRAGMA table_info` verified)
- [ ] No `TBD` / `TODO` in committed code
- [ ] Demo scripts render previewable HTML for all 8 templates
- [ ] Debug endpoint requires admin role (returns 403 for non-admin)
- [ ] Existing `invoice.paid` listener disabled in `hooks/email-notifications.ts`
- [ ] No double-send observed for any test payment
- [ ] Spec doc still matches implementation (no drift)

---

## Notes on adapting to actual codebase

This plan references several functions and column names that come from the spec/research phase. During implementation, **always verify by grep first** before writing the integration code:

1. **`renderBrandedEmail`** — exact import path and signature in `src/lib/server/email.ts`
2. **`sendWithPersistence`** — exact return type (does it return `emailLogId` string, or the row, or void?) and arguments
3. **`logInfo/logError/logCritical`** — exact module location
4. **`encrypt/decrypt`** — confirmed at `src/lib/server/plugins/smartbill/crypto.ts:58/89`
5. **`tenantUser.role` enum values** — verify `'owner'` and `'admin'` are the actual strings used
6. **`invoice.clientEmail` column** — verify the invoice table has this column; if not, JOIN to `client.email`
7. **`invoiceLineItem.hostingAccountId` column** — verify it exists; if not, the unsuspend-safety query needs a different linkage
8. **BullMQ scheduler registration API** — adapt the renewal task registration to the codebase's actual pattern
9. **Stripe `invoice.payment_failed` mapping** — confirm how `stripe.invoice.subscription` maps to `hostingAccount.stripeSubscriptionId`; metadata `internalInvoiceId` is hypothetical

If any of these don't match reality, adapt inline and document the deviation in the relevant task's commit message.
