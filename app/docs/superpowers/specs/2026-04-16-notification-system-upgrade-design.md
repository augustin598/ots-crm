# Notification System Upgrade - Design Spec

**Date:** 2026-04-16
**Status:** Draft
**Scope:** Expand notification types, add priority system, grouping, email channel

---

## Problem Statement

The current notification system covers basic CRM events (invoices, contracts, tasks, leads) but misses critical operational signals: sync failures, token expiration warnings, budget overages, overdue reminders, and system health. The admin (agency owner) has no visibility into integration health without manually checking each page.

Additionally, all notifications are treated equally (no priority), cannot be grouped (10 lead imports = 10 notifications), and there is no email fallback for urgent events.

## Goals

1. Add 13 new notification types covering sync, financial, client, and system events
2. Introduce priority levels (low/medium/high/urgent) with smart badge logic
3. Group repetitive notifications via fingerprinting (reduce noise 5-10x)
4. Send email for urgent/high notifications (deduped, max 1/day per group)
5. Redesign bell panel UI with priority-based visual hierarchy and tab filters
6. Auto-cleanup notifications older than 90 days

## Non-Goals

- Push notifications (browser Notification API) -- future phase
- Notification preferences per user (disable types) -- future phase
- Dedicated admin system-health page -- bell is the command center
- Success notifications for syncs -- status badge on integration pages instead

---

## Section 1: New Notification Types

### Existing types (unchanged, get priority assigned)

| Type | Priority |
|------|----------|
| task.assigned | medium |
| task.completed | low |
| invoice.created | medium |
| invoice.paid | low |
| invoice.overdue | high |
| contract.signed | medium |
| contract.activated | medium |
| contract.expired | high |
| lead.imported | low |
| lead.status_changed | low |
| ad.spending_synced | low |
| sync.error | urgent |
| integration.auth_expired | urgent |
| system | medium |

### New types

| Type | Trigger | Priority | Groupable | Email |
|------|---------|----------|-----------|-------|
| integration.auth_expiring | Token expires in 7 days | high | No | Yes |
| keez.sync_error | Keez sync failed | high | No | No |
| smartbill.sync_error | SmartBill sync failed | high | No | No |
| email.delivery_failed | Email not sent (sendWithPersistence fail) | high | Yes | No |
| invoice.reminder | Invoice unpaid 7/14/30 days past due date | high | Yes | Yes |
| budget.exceeded | Client ad spend > monthlyAdBudget | urgent | No | Yes |
| budget.warning | Client ad spend > budgetWarningThreshold% | medium | No | No |
| client.created | New client added to tenant | medium | No | No |
| contract.expiring | Contract expires in 14 days | high | Yes | Yes |
| task.overdue | Task unfinished > 3 days past deadline | medium | Yes | No |
| comment.mention | User @mentioned in a comment | high | No | Yes |
| approval.requested | Approval needed (budget, creative, contract) | high | No | Yes |
| system.db_error | Write lock / Turso connection issue | urgent | No | No |

### Groupable types summary

These types use fingerprint-based upsert (1 notification per type per user per day):
- `lead.imported` (existing, refactored)
- `ad.spending_synced` (existing, refactored)
- `email.delivery_failed`
- `invoice.reminder`
- `contract.expiring`
- `task.overdue`

### NotificationType union update

```typescript
export type NotificationType =
  // Existing
  | 'task.assigned' | 'task.completed'
  | 'invoice.created' | 'invoice.paid' | 'invoice.overdue'
  | 'contract.signed' | 'contract.activated' | 'contract.expired'
  | 'lead.imported' | 'lead.status_changed'
  | 'ad.spending_synced'
  | 'sync.error'
  | 'integration.auth_expired'
  | 'system'
  // New
  | 'integration.auth_expiring'
  | 'keez.sync_error' | 'smartbill.sync_error'
  | 'email.delivery_failed'
  | 'invoice.reminder'
  | 'budget.exceeded' | 'budget.warning'
  | 'client.created'
  | 'contract.expiring'
  | 'task.overdue'
  | 'comment.mention'
  | 'approval.requested'
  | 'system.db_error';
```

---

## Section 2: Database Schema Changes

### Migration 1: notification table additions

```sql
ALTER TABLE notification ADD COLUMN priority TEXT DEFAULT 'medium';
ALTER TABLE notification ADD COLUMN fingerprint TEXT UNIQUE;
ALTER TABLE notification ADD COLUMN count INTEGER DEFAULT 1;
ALTER TABLE notification ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE notification ADD COLUMN last_email_at TIMESTAMP;
```

Note: Turso requires one statement per migration file. This means 5 separate migration files.

### Migration 2: new indexes

```sql
CREATE INDEX notification_user_read_updated_idx ON notification(user_id, is_read, updated_at);
```

```sql
CREATE INDEX notification_user_priority_idx ON notification(user_id, priority);
```

```sql
CREATE UNIQUE INDEX notification_fingerprint_idx ON notification(fingerprint) WHERE fingerprint IS NOT NULL;
```

Note: 3 separate migration files.

### Migration 3: client budget columns

```sql
ALTER TABLE client ADD COLUMN budget_warning_threshold INTEGER DEFAULT 80;
```

```sql
ALTER TABLE client ADD COLUMN monthly_ad_budget INTEGER;
```

Note: 2 separate migration files. `monthly_ad_budget` is in RON (integer, no decimals needed for budget thresholds).

### Drizzle schema updates

```typescript
// In notification table definition, add:
priority: text('priority').notNull().default('medium'),
fingerprint: text('fingerprint').unique(),
count: integer('count').notNull().default(1),
updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
  .notNull()
  .default(sql`current_timestamp`),
lastEmailAt: timestamp('last_email_at', { withTimezone: true, mode: 'date' }),

// In client table definition, add:
budgetWarningThreshold: integer('budget_warning_threshold').default(80),
monthlyAdBudget: integer('monthly_ad_budget'),
```

### Total migration files: 10

(Turso single-statement rule: 5 ALTER notification + 3 CREATE INDEX + 2 ALTER client)

---

## Section 3: Grouping Mechanism

### Fingerprint formula

```
fingerprint = md5(tenantId + userId + type + clientId + YYYY-MM-DD)
```

- `clientId` is "global" when null (for non-client-scoped notifications)
- Date resets grouping daily (new group each day)
- Hash includes userId so each admin gets their own group

### createNotification refactor

```
function createNotification(params):
  if type is in GROUPABLE_TYPES:
    fingerprint = generateFingerprint(params)
    result = INSERT ... ON CONFLICT(fingerprint) DO UPDATE
      SET count = count + 1,
          updated_at = now(),
          is_read = false,
          title = buildGroupTitle(type, count + 1),
          message = buildGroupMessage(type, count + 1, params)
    
    // SSE: push updated notification to client
    broadcastSSE(userId, result)
  else:
    INSERT normally (fingerprint = null)
    broadcastSSE(userId, newNotification)
```

### Group title templates

```typescript
const GROUP_TITLES: Record<string, (count: number) => string> = {
  'lead.imported': (n) => `${n} leaduri importate azi`,
  'ad.spending_synced': (n) => `${n} conturi sincronizate`,
  'email.delivery_failed': (n) => `${n} emailuri esuate`,
  'invoice.reminder': (n) => `${n} facturi restante`,
  'contract.expiring': (n) => `${n} contracte expira curand`,
  'task.overdue': (n) => `${n} taskuri intarziate`,
};
```

### Query changes

```typescript
// Main feed query
.orderBy(desc(table.notification.updatedAt))

// Badge count query (urgent + high only)
.where(and(
  eq(table.notification.userId, userId),
  eq(table.notification.isRead, false),
  inArray(table.notification.priority, ['urgent', 'high'])
))
```

---

## Section 4: Hooks & Triggers

### New hooks to register in notification-hooks.ts

**integration.auth_expiring**
- Trigger: Scheduler token-refresh task detects token expires within 7 days
- File: `scheduler/tasks/token-refresh.ts`
- Logic: Check token expiry date, if < 7 days and no existing notification with same fingerprint today, create notification
- Priority: high, Email: yes

**keez.sync_error / smartbill.sync_error**
- Trigger: Respective sync tasks catch errors
- Files: `scheduler/tasks/keez-sync.ts`, `scheduler/tasks/smartbill-sync.ts` (or equivalent)
- Priority: high, Email: no

**email.delivery_failed**
- Trigger: `sendWithPersistence()` or `sendMailWithRetry()` fails after all retries
- File: `server/email.ts`
- Priority: high, Groupable: yes

**invoice.reminder**
- Trigger: New scheduler task runs daily, checks invoices where `status != 'paid'` AND `dueDate + N days < today`
- Intervals: 7, 14, 30 days past due date
- File: New scheduler task `scheduler/tasks/invoice-reminders.ts`
- Priority: high, Groupable: yes, Email: yes
- Dedup: fingerprint includes interval (7/14/30) so user gets max 3 reminders per invoice

**budget.exceeded / budget.warning**
- Trigger: After ad spending sync completes, compare total monthly spend vs `client.monthlyAdBudget`
- File: Ad spending sync tasks (meta/google/tiktok)
- Logic: If spend > budget -> budget.exceeded (urgent). If spend > threshold% -> budget.warning (medium)
- Dedup: Redis key `budget_alert:{clientId}:{month}` with 24h TTL to prevent repeated alerts same day

**client.created**
- Trigger: Client insert in clients remote/API
- File: Clients remote or hook on insert
- Priority: medium

**contract.expiring**
- Trigger: Existing `contract-lifecycle.ts` scheduler, add check for contracts expiring within 14 days
- Priority: high, Groupable: yes, Email: yes

**task.overdue**
- Trigger: New scheduler task runs daily, checks tasks where `status != 'completed'` AND `deadline + 3 days < today`
- File: New scheduler task `scheduler/tasks/task-overdue-check.ts`
- Priority: medium, Groupable: yes

**comment.mention**
- Trigger: Comment creation detects @mentions via regex
- File: Comments remote/API (wherever comments are created)
- Priority: high, Email: yes
- Note: Requires @mention detection in comment text

**approval.requested**
- Trigger: Manual action -- user requests approval on budget/creative/contract
- File: Respective action endpoints
- Priority: high, Email: yes
- Note: This requires an approval workflow to exist. If not yet built, defer this type.

**system.db_error**
- Trigger: Catch Turso connection/write errors in DB wrapper
- File: `server/db/index.ts` or error handler
- Priority: urgent
- Dedup: Max 1 per hour via Redis key

### Existing hooks to update

All existing hooks in `notification-hooks.ts` get a `priority` field added to their `createNotification()` calls based on the mapping in Section 1.

`lead.imported` hook refactored: instead of per-client loop, create one grouped notification with message "12 leaduri importate (3 clienti)".

---

## Section 5: Email Channel

### Which types send email

| Type | Email | Dedup strategy |
|------|-------|---------------|
| integration.auth_expiring | Yes | 1 per integration per day |
| integration.auth_expired | Yes | 1 per integration per day (existing Redis dedup) |
| budget.exceeded | Yes | 1 per client per day |
| invoice.reminder | Yes | 1 per group per day (lastEmailAt) |
| contract.expiring | Yes | 1 per group per day (lastEmailAt) |
| comment.mention | Yes | Every mention (no dedup) |
| approval.requested | Yes | Every request (no dedup) |

### Email dedup mechanism

For grouped notifications: check `lastEmailAt` column on the notification row.
- If NULL or > 24h ago: send email, update `lastEmailAt = now()`
- If < 24h: skip email, only update in-app notification

For non-grouped: use Redis key with 24h TTL.
- Key: `email_dedup:{type}:{targetIdentifier}:{YYYY-MM-DD}`
- If key exists: skip. If not: send email, set key.

### Email templates

Reuse existing `sendWithPersistence()` infrastructure. New templates:
- `notification-alert.ts` -- generic template for urgent/high notifications
- Subject: "[OTS CRM] {title}"
- Body: title, message, action link, unsubscribe note
- Language: Romanian

### Integration with createNotification

```
function createNotification(params):
  // ... existing insert/upsert logic ...
  
  if type is in EMAIL_TYPES:
    shouldEmail = checkEmailDedup(notification)
    if shouldEmail:
      await sendNotificationEmail(notification)
      await updateLastEmailAt(notification.id)
```

---

## Section 6: Bell Panel UI Redesign

### Visual hierarchy

Priority-based left border + background:
- **urgent**: 4px red border-left, subtle red background (bg-red-50 dark:bg-red-950/30)
- **high**: 4px amber border-left, subtle amber background (bg-amber-50 dark:bg-amber-950/30)
- **medium**: 4px blue border-left, no special background
- **low**: no border, muted text, compact height

### Tab filters in header

Two tabs replacing current header:
- "Importante" (default) -- shows urgent + high, counter shows unread count
- "Toate" -- shows all priorities, counter shows total unread

### Badge logic

```typescript
// Only urgent + high unread notifications trigger the red pulsing badge
const badgeCount = urgentHighUnreadCount;

// If only medium/low unread: small grey static dot (no number, no pulse)
// If zero unread: no badge at all
```

### Grouped notification rendering

Grouped notifications (count > 1) render as:
- Compact row with group title ("4 facturi restante")
- Subtitle: "ultima: acum 1h"
- Chevron icon to expand/collapse
- Expanded: sub-items listed with indent + dashed border-left
- Click on group header: mark all as read + navigate to relevant list page

### Action links per type

Each notification type has a contextual action:
- `integration.auth_expired` -> "Reconecteaza"
- `budget.exceeded` -> "Vezi cheltuieli"
- `invoice.reminder` -> "Vezi facturi restante"
- `contract.expiring` -> "Vezi contracte"
- `comment.mention` -> "Vezi comentariu"
- Default -> "Deschide"

### Animations

- New notification: slide-in from top, 200ms ease-out
- Badge update: scale 1.0 -> 1.2 -> 1.0, 300ms
- Group expand: height transition 150ms ease
- Delete: slide-out right with fade, 150ms
- Tab switch: crossfade content, 100ms

### Footer actions

- "Citit tot" -- marks all visible as read
- "Sterge tot" -- double-click confirmation (already implemented)

---

## Section 7: Cleanup & Maintenance

### Scheduler task: notification-cleanup

- Runs daily at 02:00
- File: `scheduler/tasks/notification-cleanup.ts`
- Rules:
  - Delete read notifications older than 30 days
  - Delete all notifications older than 90 days (even unread)
  - Log: "Notification cleanup: deleted {readCount} read, {expiredCount} expired"

### Activity icons update

Add icons for all new types in `activity-icons.svelte.ts`:
- `integration.auth_expiring` -> KeyIcon, amber
- `keez.sync_error` -> AlertCircleIcon, red
- `smartbill.sync_error` -> AlertCircleIcon, red
- `email.delivery_failed` -> MailXIcon, red
- `invoice.reminder` -> ClockAlertIcon, amber
- `budget.exceeded` -> TrendingUpIcon, red
- `budget.warning` -> TrendingUpIcon, amber
- `client.created` -> UserPlusIcon, green
- `contract.expiring` -> FileClockIcon, amber
- `task.overdue` -> ClockAlertIcon, amber
- `comment.mention` -> AtSignIcon, blue
- `approval.requested` -> CheckCircleIcon, purple
- `system.db_error` -> DatabaseIcon, red

### ACTIVITY_CATEGORIES update

Add to filter list:
```typescript
{ id: 'system', label: 'Sistem', prefixes: ['sync.', 'integration.', 'system.', 'scheduler.', 'email.'] },
{ id: 'financial', label: 'Financiar', prefixes: ['invoice.', 'budget.'] },
```

---

## Section 8: Implementation Phases

### Phase 1: Schema + Priority + Grouping (foundation)
- 10 migration files
- Update Drizzle schema
- Refactor createNotification() with upsert logic
- Update all existing hooks with priority field
- Update bell UI: priority borders, badge logic, tab filters
- Update activity icons for existing + new types
- Notification cleanup scheduler task

### Phase 2: New notification types (sync, financial)
- integration.auth_expiring hook (token-refresh task)
- keez.sync_error, smartbill.sync_error hooks
- email.delivery_failed hook (email.ts)
- invoice.reminder scheduler task
- budget.exceeded / budget.warning hooks (ad spending sync)
- client.created hook

### Phase 3: New notification types (client activity, system)
- contract.expiring hook (contract-lifecycle task)
- task.overdue scheduler task
- system.db_error handler
- comment.mention hook (if comments exist)
- approval.requested hook (if approval workflow exists)

### Phase 4: Email channel
- Email dedup mechanism (lastEmailAt + Redis)
- Notification email template
- Wire email sending into createNotification for EMAIL_TYPES
- Test dedup logic

### Phase 5: Bell UI polish
- Grouped notification expand/collapse UI
- Action links per notification type
- Animations (slide-in, badge bounce, expand)
- Mobile bottom sheet layout

---

## Dependencies & Assumptions

- `taskComment` table exists with `parentCommentId` (threaded comments). @mention detection needs regex parsing on comment text field -- no schema change needed.
- Task approval workflow exists (`status: 'pending-approval'` in task schema, `notifyTaskApprovedRejected` preference). `approval.requested` hooks into task status change to 'pending-approval'.
- Client table already has relevant fields for budget tracking
- Scheduler infrastructure exists and supports new tasks
- Redis is available for dedup keys
- Email sending via sendWithPersistence() is operational

## Open Questions

None -- all questions resolved during brainstorming with Gemini review.
