# Notification System Upgrade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the notification system with 13 new event types, priority levels, fingerprint-based grouping, email channel for urgent notifications, and a redesigned bell UI.

**Architecture:** Add priority/fingerprint/count/updatedAt columns to notification table. Refactor createNotification() to support upsert-based grouping via fingerprints. New scheduler tasks emit notifications for overdue invoices, expiring contracts, overdue tasks. Bell UI gets priority-based visual hierarchy and tab filters.

**Tech Stack:** SvelteKit 5, Drizzle ORM, Turso/libSQL, Redis (dedup), SSE (real-time)

**Spec:** `docs/superpowers/specs/2026-04-16-notification-system-upgrade-design.md`

---

## File Map

### New files
- `drizzle/0116_notification_priority.sql`
- `drizzle/0117_notification_fingerprint.sql`
- `drizzle/0118_notification_count.sql`
- `drizzle/0119_notification_updated_at.sql`
- `drizzle/0120_notification_last_email_at.sql`
- `drizzle/0121_idx_notification_user_read_updated.sql`
- `drizzle/0122_idx_notification_user_priority.sql`
- `drizzle/0123_idx_notification_fingerprint.sql`
- `drizzle/0124_client_budget_warning_threshold.sql`
- `src/lib/server/scheduler/tasks/invoice-reminder-notifications.ts`
- `src/lib/server/scheduler/tasks/task-overdue-notifications.ts`
- `src/lib/server/scheduler/tasks/notification-cleanup.ts`

### Modified files
- `src/lib/server/db/schema.ts` — Add columns to notification + client tables
- `src/lib/server/notifications.ts` — Add priority to type, refactor createNotification for upsert
- `src/lib/server/hooks/notification-hooks.ts` — Add priority to all hooks + new hooks
- `src/lib/utils/activity-icons.svelte.ts` — Add icons for new types
- `src/lib/remotes/notifications.remote.ts` — Update query ordering + badge query
- `src/lib/components/app/notification-bell/NotificationBell.svelte` — UI redesign
- `src/lib/components/client/ClientActivityFeed.svelte` — Support priority display
- `src/lib/server/scheduler/tasks/contract-lifecycle.ts` — Add contract.expiring check
- `src/lib/server/scheduler/tasks/token-refresh.ts` — Add auth_expiring warning
- `src/lib/server/email.ts` — Add hook for email.delivery_failed

---

## Phase 1: Schema + Priority + Grouping Foundation

### Task 1: Migration files for notification table

**Files:**
- Create: `drizzle/0116_notification_priority.sql`
- Create: `drizzle/0117_notification_fingerprint.sql`
- Create: `drizzle/0118_notification_count.sql`
- Create: `drizzle/0119_notification_updated_at.sql`
- Create: `drizzle/0120_notification_last_email_at.sql`

- [ ] **Step 1: Create migration 0116 — priority column**

```sql
ALTER TABLE notification ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium';
```

- [ ] **Step 2: Create migration 0117 — fingerprint column**

```sql
ALTER TABLE notification ADD COLUMN fingerprint TEXT;
```

- [ ] **Step 3: Create migration 0118 — count column**

```sql
ALTER TABLE notification ADD COLUMN count INTEGER NOT NULL DEFAULT 1;
```

- [ ] **Step 4: Create migration 0119 — updated_at column**

```sql
ALTER TABLE notification ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
```

- [ ] **Step 5: Create migration 0120 — last_email_at column**

```sql
ALTER TABLE notification ADD COLUMN last_email_at TIMESTAMP;
```

- [ ] **Step 6: Run migrations**

```bash
cd /Users/augustin598/Projects/CRM/app && bun run db:migrate
```

Verify with: `PRAGMA table_info(notification)` — should show priority, fingerprint, count, updated_at, last_email_at columns.

- [ ] **Step 7: Commit**

```bash
git add drizzle/0116_notification_priority.sql drizzle/0117_notification_fingerprint.sql drizzle/0118_notification_count.sql drizzle/0119_notification_updated_at.sql drizzle/0120_notification_last_email_at.sql
git commit -m "feat(notifications): add priority, fingerprint, count, updatedAt, lastEmailAt columns"
```

---

### Task 2: Migration files for indexes + client budget

**Files:**
- Create: `drizzle/0121_idx_notification_user_read_updated.sql`
- Create: `drizzle/0122_idx_notification_user_priority.sql`
- Create: `drizzle/0123_idx_notification_fingerprint.sql`
- Create: `drizzle/0124_client_budget_warning_threshold.sql`

- [ ] **Step 1: Create migration 0121 — user+read+updated index**

```sql
CREATE INDEX notification_user_read_updated_idx ON notification(user_id, is_read, updated_at);
```

- [ ] **Step 2: Create migration 0122 — user+priority index**

```sql
CREATE INDEX notification_user_priority_idx ON notification(user_id, priority);
```

- [ ] **Step 3: Create migration 0123 — fingerprint unique index**

```sql
CREATE UNIQUE INDEX notification_fingerprint_idx ON notification(fingerprint) WHERE fingerprint IS NOT NULL;
```

- [ ] **Step 4: Create migration 0124 — client budget_warning_threshold**

Note: `monthlyBudget` already exists on client table (schema.ts:132). Only add the threshold column.

```sql
ALTER TABLE client ADD COLUMN budget_warning_threshold INTEGER DEFAULT 80;
```

- [ ] **Step 5: Run migrations**

```bash
cd /Users/augustin598/Projects/CRM/app && bun run db:migrate
```

Verify indexes: `PRAGMA index_list(notification)` — should show the 3 new indexes.
Verify client: `PRAGMA table_info(client)` — should show budget_warning_threshold.

- [ ] **Step 6: Commit**

```bash
git add drizzle/0121_idx_notification_user_read_updated.sql drizzle/0122_idx_notification_user_priority.sql drizzle/0123_idx_notification_fingerprint.sql drizzle/0124_client_budget_warning_threshold.sql
git commit -m "feat(notifications): add performance indexes + client budget threshold"
```

---

### Task 3: Update Drizzle schema definition

**Files:**
- Modify: `src/lib/server/db/schema.ts:1860-1879` (notification table)
- Modify: `src/lib/server/db/schema.ts:104-139` (client table)

- [ ] **Step 1: Add new columns to notification table definition**

In `schema.ts`, find the notification table (line ~1860). Add after `createdAt`:

```typescript
priority: text('priority').notNull().default('medium'),
fingerprint: text('fingerprint').unique(),
count: integer('count').notNull().default(1),
updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
	.notNull()
	.default(sql`current_timestamp`),
lastEmailAt: timestamp('last_email_at', { withTimezone: true, mode: 'date' }),
```

- [ ] **Step 2: Add budgetWarningThreshold to client table**

In `schema.ts`, find the client table (line ~104). Add after `monthlyBudget`:

```typescript
budgetWarningThreshold: integer('budget_warning_threshold').default(80),
```

- [ ] **Step 3: Run svelte-check to verify types**

```bash
cd /Users/augustin598/Projects/CRM/app && npx svelte-check --threshold warning 2>&1 | tail -5
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/server/db/schema.ts
git commit -m "feat(schema): add notification priority/grouping + client budget threshold columns"
```

---

### Task 4: Update NotificationType and createNotification for priority + grouping

**Files:**
- Modify: `src/lib/server/notifications.ts:9-36` (type union), `72-101` (createNotification)

- [ ] **Step 1: Update NotificationType union (line 9-23)**

Replace the existing type with:

```typescript
export type NotificationType =
	// Tasks
	| 'task.assigned'
	| 'task.completed'
	| 'task.overdue'
	// Invoices
	| 'invoice.created'
	| 'invoice.paid'
	| 'invoice.overdue'
	| 'invoice.reminder'
	// Contracts
	| 'contract.signed'
	| 'contract.activated'
	| 'contract.expired'
	| 'contract.expiring'
	// Leads & Marketing
	| 'lead.imported'
	| 'lead.status_changed'
	| 'ad.spending_synced'
	// Budget
	| 'budget.exceeded'
	| 'budget.warning'
	// Integrations
	| 'sync.error'
	| 'integration.auth_expired'
	| 'integration.auth_expiring'
	| 'keez.sync_error'
	| 'smartbill.sync_error'
	// Communication
	| 'email.delivery_failed'
	| 'comment.mention'
	| 'approval.requested'
	// Clients
	| 'client.created'
	// System
	| 'system'
	| 'system.db_error'
	| 'scheduler.job_failed';
```

- [ ] **Step 2: Add priority to CreateNotificationParams (line 25-36)**

Add to the interface:

```typescript
priority?: 'low' | 'medium' | 'high' | 'urgent';
```

- [ ] **Step 3: Add grouping constants and helper**

Add after the type definitions, before the SSE section:

```typescript
// ---- Grouping ----

const GROUPABLE_TYPES: Set<NotificationType> = new Set([
	'lead.imported',
	'ad.spending_synced',
	'email.delivery_failed',
	'invoice.reminder',
	'contract.expiring',
	'task.overdue',
]);

const GROUP_TITLES: Partial<Record<NotificationType, (count: number) => string>> = {
	'lead.imported': (n) => `${n} leaduri importate azi`,
	'ad.spending_synced': (n) => `${n} conturi sincronizate`,
	'email.delivery_failed': (n) => `${n} emailuri esuate`,
	'invoice.reminder': (n) => `${n} facturi restante`,
	'contract.expiring': (n) => `${n} contracte expira curand`,
	'task.overdue': (n) => `${n} taskuri intarziate`,
};

function generateFingerprint(tenantId: string, userId: string, type: string, clientId: string | null): string {
	const dateKey = new Date().toISOString().split('T')[0];
	const raw = `${tenantId}:${userId}:${type}:${clientId ?? 'global'}:${dateKey}`;
	// Simple hash — no crypto needed for grouping key
	let hash = 0;
	for (let i = 0; i < raw.length; i++) {
		const char = raw.charCodeAt(i);
		hash = ((hash << 5) - hash) + char;
		hash |= 0;
	}
	return `fp_${Math.abs(hash).toString(36)}`;
}
```

- [ ] **Step 4: Refactor createNotification to support upsert grouping**

Replace the existing `createNotification` function (line 72-101) with:

```typescript
export async function createNotification(params: CreateNotificationParams): Promise<void> {
	const id = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
	const now = params.createdAt ?? new Date();
	const priority = params.priority ?? 'medium';
	const isGroupable = GROUPABLE_TYPES.has(params.type);

	if (isGroupable) {
		const fingerprint = generateFingerprint(params.tenantId, params.userId, params.type, params.clientId ?? null);

		// Try upsert: increment existing group or create new
		const [existing] = await db
			.select({ id: table.notification.id, count: table.notification.count })
			.from(table.notification)
			.where(eq(table.notification.fingerprint, fingerprint))
			.limit(1);

		if (existing) {
			const newCount = existing.count + 1;
			const titleFn = GROUP_TITLES[params.type];
			const newTitle = titleFn ? titleFn(newCount) : params.title;

			await db.update(table.notification)
				.set({
					count: newCount,
					title: newTitle,
					message: params.message,
					updatedAt: now,
					isRead: false,
					priority,
				})
				.where(eq(table.notification.id, existing.id));

			// Push updated notification via SSE
			const controller = sseControllers.get(params.userId);
			if (controller) {
				try {
					const updatedNotif = {
						id: existing.id,
						tenantId: params.tenantId,
						userId: params.userId,
						clientId: params.clientId ?? null,
						type: params.type,
						title: newTitle,
						message: params.message,
						link: params.link ?? null,
						isRead: false,
						metadata: params.metadata ?? null,
						createdAt: now,
						priority,
						fingerprint,
						count: newCount,
						updatedAt: now,
						lastEmailAt: null,
					};
					controller.enqueue(formatSSEEvent('notification', updatedNotif));
				} catch {
					sseControllers.delete(params.userId);
				}
			}
			return;
		}
		// No existing group — fall through to normal insert with fingerprint
		const newNotification: table.NewNotification = {
			id,
			tenantId: params.tenantId,
			userId: params.userId,
			clientId: params.clientId ?? null,
			type: params.type,
			title: params.title,
			message: params.message,
			link: params.link ?? null,
			isRead: false,
			metadata: params.metadata ?? null,
			createdAt: now,
			priority,
			fingerprint,
			count: 1,
			updatedAt: now,
			lastEmailAt: null,
		};

		await db.insert(table.notification).values(newNotification);
		broadcastNewNotification(params.userId, newNotification);
		return;
	}

	// Non-groupable: standard insert
	const newNotification: table.NewNotification = {
		id,
		tenantId: params.tenantId,
		userId: params.userId,
		clientId: params.clientId ?? null,
		type: params.type,
		title: params.title,
		message: params.message,
		link: params.link ?? null,
		isRead: false,
		metadata: params.metadata ?? null,
		createdAt: now,
		priority,
		fingerprint: null,
		count: 1,
		updatedAt: now,
		lastEmailAt: null,
	};

	await db.insert(table.notification).values(newNotification);
	broadcastNewNotification(params.userId, newNotification);
}

/** Push a new notification to the user via SSE if they are connected. */
function broadcastNewNotification(userId: string, notif: table.NewNotification): void {
	const controller = sseControllers.get(userId);
	if (!controller) return;
	try {
		const payload = {
			...notif,
			clientId: notif.clientId ?? null,
			link: notif.link ?? null,
			isRead: notif.isRead ?? false,
			metadata: notif.metadata ?? null,
			createdAt: notif.createdAt ?? new Date(),
		} satisfies table.Notification;
		controller.enqueue(formatSSEEvent('notification', payload));
	} catch {
		sseControllers.delete(userId);
	}
}
```

- [ ] **Step 5: Run svelte-check**

```bash
cd /Users/augustin598/Projects/CRM/app && npx svelte-check --threshold warning 2>&1 | tail -5
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/notifications.ts
git commit -m "feat(notifications): add priority, grouping via fingerprint upsert, new notification types"
```

---

### Task 5: Add priority to all existing hooks

**Files:**
- Modify: `src/lib/server/hooks/notification-hooks.ts`

- [ ] **Step 1: Add priority field to every existing createNotification call**

For each hook, add the `priority` field based on the mapping:

| Hook | Priority |
|------|----------|
| `invoice.paid` (line ~61) | `priority: 'low'` |
| `task.assigned` (line ~84) | `priority: 'medium'` |
| `contract.signed` (line ~114) | `priority: 'medium'` |
| `sync.error` (line ~148) | `priority: 'urgent'` |
| `leads.imported` (line ~190) | `priority: 'low'` |
| `invoice.created` (line ~237) | `priority: 'medium'` |
| `invoice.status.changed` (overdue, line ~275) | `priority: 'high'` |
| `contract.activated` (line ~301) | `priority: 'medium'` |
| `contract.expired` (line ~331) | `priority: 'high'` |

In each `createNotification({...})` call, add the `priority` field. Example for invoice.paid:

```typescript
await createNotification({
	tenantId: event.tenantId,
	userId,
	clientId: event.invoice.clientId,
	type: 'invoice.paid',
	title: 'Factura platita',
	message: `Factura ${invoiceNumber} a fost marcata ca platita`,
	link: link ?? undefined,
	metadata: { invoiceId: event.invoice.id },
	priority: 'low',
})
```

Repeat for all 9 hooks. Each one just adds the `priority` field.

- [ ] **Step 2: Simplify leads.imported hook — remove per-client loop**

Replace the leads.imported handler (lines ~167-220). Instead of looping per clientId, create one grouped notification per admin:

```typescript
hooks.on('leads.imported', async (event: LeadsImportedEvent) => {
	try {
		if (event.imported === 0) return;

		const adminUserIds = await getTenantAdminUserIds(event.tenantId);

		const [tenant] = await db
			.select({ slug: table.tenant.slug })
			.from(table.tenant)
			.where(eq(table.tenant.id, event.tenantId))
			.limit(1);

		const link = tenant ? `/${tenant.slug}/leads/facebook-ads` : undefined;
		const sourceLabel = event.source === 'scheduled' ? 'automat' : 'manual';
		const clientCount = event.clientIds?.length ?? 0;

		await Promise.all(
			adminUserIds.map((userId) =>
				createNotification({
					tenantId: event.tenantId,
					userId,
					type: 'lead.imported',
					title: `${event.imported} leaduri importate`,
					message: `Sync ${sourceLabel}: ${event.imported} noi${clientCount > 0 ? ` (${clientCount} clienti)` : ''}${event.errors > 0 ? `, ${event.errors} erori` : ''}`,
					link,
					priority: 'low',
				})
			)
		);
	} catch (error) {
		logError('server', 'notification-hooks: failed to create leads.imported notification', {
			tenantId: event.tenantId
		});
	}
});
```

- [ ] **Step 3: Run svelte-check**

```bash
cd /Users/augustin598/Projects/CRM/app && npx svelte-check --threshold warning 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/server/hooks/notification-hooks.ts
git commit -m "feat(notifications): add priority to all existing hooks, simplify leads grouping"
```

---

### Task 6: Update activity icons for all types

**Files:**
- Modify: `src/lib/utils/activity-icons.svelte.ts`

- [ ] **Step 1: Add new icon imports**

Add after the existing imports (line 12):

```typescript
import KeyIcon from '@lucide/svelte/icons/key';
import MailXIcon from '@lucide/svelte/icons/mail-x';
import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
import AtSignIcon from '@lucide/svelte/icons/at-sign';
import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
import DatabaseIcon from '@lucide/svelte/icons/database';
import TimerIcon from '@lucide/svelte/icons/timer';
```

- [ ] **Step 2: Add new cases to getActivityIcon switch**

Add before the `default` case:

```typescript
case 'integration.auth_expiring':
case 'integration.auth_expired':
	return KeyIcon;
case 'keez.sync_error':
case 'smartbill.sync_error':
	return AlertCircleIcon;
case 'email.delivery_failed':
	return MailXIcon;
case 'invoice.reminder':
	return ClockAlertIcon;
case 'budget.exceeded':
case 'budget.warning':
	return TrendingUpIcon;
case 'client.created':
	return UserPlusIcon;
case 'contract.expiring':
	return TimerIcon;
case 'task.overdue':
	return ClockAlertIcon;
case 'comment.mention':
	return AtSignIcon;
case 'approval.requested':
	return CircleCheckIcon;
case 'system.db_error':
case 'scheduler.job_failed':
	return DatabaseIcon;
```

- [ ] **Step 3: Add new cases to getActivityColor switch**

Add before the `default` case:

```typescript
case 'integration.auth_expiring':
case 'keez.sync_error':
case 'smartbill.sync_error':
case 'budget.warning':
case 'invoice.reminder':
case 'contract.expiring':
case 'task.overdue':
	return 'text-amber-600 dark:text-amber-400';
case 'integration.auth_expired':
case 'email.delivery_failed':
case 'budget.exceeded':
case 'system.db_error':
case 'scheduler.job_failed':
	return 'text-destructive';
case 'comment.mention':
case 'approval.requested':
	return 'text-blue-600 dark:text-blue-400';
case 'client.created':
	return 'text-green-600 dark:text-green-400';
```

- [ ] **Step 4: Add 'system.db_error' to getActivityCategory**

Add before the `return 'Altele'`:

```typescript
if (type.startsWith('budget.')) return 'Financiar';
if (type.startsWith('keez.') || type.startsWith('smartbill.')) return 'Sistem';
if (type === 'email.delivery_failed') return 'Sistem';
if (type === 'comment.mention' || type === 'approval.requested') return 'Comunicare';
if (type === 'client.created') return 'Clienti';
if (type === 'system.db_error' || type === 'scheduler.job_failed') return 'Sistem';
```

- [ ] **Step 5: Add new categories to ACTIVITY_CATEGORIES**

```typescript
export const ACTIVITY_CATEGORIES = [
	{ id: 'all', label: 'Toate', prefixes: [] },
	{ id: 'invoices', label: 'Facturi', prefixes: ['invoice.', 'budget.'] },
	{ id: 'leads', label: 'Leaduri', prefixes: ['lead.'] },
	{ id: 'contracts', label: 'Contracte', prefixes: ['contract.'] },
	{ id: 'tasks', label: 'Taskuri', prefixes: ['task.'] },
	{ id: 'marketing', label: 'Marketing', prefixes: ['ad.'] },
	{ id: 'system', label: 'Sistem', prefixes: ['sync.', 'integration.', 'system.', 'scheduler.', 'keez.', 'smartbill.', 'email.'] },
	{ id: 'communication', label: 'Comunicare', prefixes: ['comment.', 'approval.'] },
] as const;
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/utils/activity-icons.svelte.ts
git commit -m "feat(notifications): add icons, colors, and categories for all new notification types"
```

---

### Task 7: Update notifications remote — ordering + badge query

**Files:**
- Modify: `src/lib/remotes/notifications.remote.ts`

- [ ] **Step 1: Update getNotifications ordering**

Change the `orderBy` in getNotifications (line ~50) from:

```typescript
.orderBy(desc(table.notification.createdAt))
```

to:

```typescript
.orderBy(desc(table.notification.updatedAt))
```

- [ ] **Step 2: Update cursor pagination to use updatedAt**

Change the cursor condition (line ~43) from:

```typescript
conditions.push(lt(table.notification.createdAt, new Date(cursor)));
```

to:

```typescript
conditions.push(lt(table.notification.updatedAt, new Date(cursor)));
```

And update nextCursor (line ~55) from:

```typescript
const nextCursor = hasMore ? results[results.length - 1].createdAt.toISOString() : null;
```

to:

```typescript
const nextCursor = hasMore ? results[results.length - 1].updatedAt.toISOString() : null;
```

- [ ] **Step 3: Add getUrgentUnreadCount function**

Add after `getUnreadCount`:

```typescript
/**
 * Get count of unread urgent+high priority notifications (for badge).
 */
export const getUrgentUnreadCount = command(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	const [result] = await db
		.select({ count: sql<number>`count(*)`.as('count') })
		.from(table.notification)
		.where(and(
			getNotificationConditions(event),
			eq(table.notification.isRead, false),
			inArray(table.notification.priority, ['urgent', 'high'])
		));

	return { count: Number(result?.count) || 0 };
});
```

Add `inArray` to imports from drizzle-orm.

- [ ] **Step 4: Commit**

```bash
git add src/lib/remotes/notifications.remote.ts
git commit -m "feat(notifications): update ordering to updatedAt, add urgent badge count query"
```

---

### Task 8: Redesign NotificationBell UI

**Files:**
- Modify: `src/lib/components/app/notification-bell/NotificationBell.svelte`

- [ ] **Step 1: Update imports and add getUrgentUnreadCount**

Add to imports:

```typescript
import { getNotifications, getUnreadCount, getUrgentUnreadCount } from '$lib/remotes/notifications.remote';
import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
```

- [ ] **Step 2: Add state for tabs and badge**

Replace the state section with:

```typescript
// ---- State ----
let notifications = $state<Notification[]>([]);
let unreadCount = $state(0);
let urgentUnreadCount = $state(0);
let open = $state(false);
let loading = $state(true);
let loadingMore = $state(false);
let nextCursor = $state<string | null>(null);
let confirmDeleteAll = $state(false);
let confirmDeleteTimeout: ReturnType<typeof setTimeout> | null = null;
let activeTab = $state<'important' | 'all'>('important');
let expandedGroups = $state<Set<string>>(new Set());
```

- [ ] **Step 3: Add filtered notifications derived**

```typescript
const filteredNotifications = $derived(
	activeTab === 'important'
		? notifications.filter((n) => n.priority === 'urgent' || n.priority === 'high')
		: notifications
);

const importantCount = $derived(
	notifications.filter((n) => !n.isRead && (n.priority === 'urgent' || n.priority === 'high')).length
);
```

- [ ] **Step 4: Add priority border helper**

```typescript
function getPriorityClasses(priority: string, isRead: boolean): string {
	if (isRead) return 'hover:bg-muted/50';
	switch (priority) {
		case 'urgent':
			return 'border-l-4 border-l-red-500 bg-red-50/50 dark:bg-red-950/20';
		case 'high':
			return 'border-l-4 border-l-amber-500 bg-amber-50/50 dark:bg-amber-950/20';
		case 'medium':
			return 'border-l-4 border-l-blue-400 bg-accent/30';
		default:
			return 'bg-muted/20';
	}
}
```

- [ ] **Step 5: Add group expand/collapse toggle**

```typescript
function toggleGroup(id: string) {
	const next = new Set(expandedGroups);
	if (next.has(id)) next.delete(id);
	else next.add(id);
	expandedGroups = next;
}
```

- [ ] **Step 6: Update onMount to fetch urgentUnreadCount**

Change the Promise.all in onMount:

```typescript
const [result, countData, urgentData] = await Promise.all([
	getNotifications({ limit: PAGE_SIZE }),
	getUnreadCount(),
	getUrgentUnreadCount()
]);
notifications = result.items;
nextCursor = result.nextCursor;
unreadCount = countData.count;
urgentUnreadCount = urgentData.count;
```

- [ ] **Step 7: Update badge rendering**

Replace the badge section in the trigger button. Use `urgentUnreadCount` for the red pulsing badge, and show a grey dot for medium/low:

```svelte
{#if urgentUnreadCount > 0}
	<span class="relative flex h-5 min-w-5 items-center justify-center px-1">
		<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75"></span>
		<span class="relative inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
			{urgentUnreadCount > 99 ? '99+' : urgentUnreadCount}
		</span>
	</span>
{:else if unreadCount > 0}
	<span class="relative flex h-3 w-3 items-center justify-center">
		<span class="inline-flex h-2 w-2 rounded-full bg-muted-foreground/50"></span>
	</span>
{/if}
```

- [ ] **Step 8: Add tab filters in panel header**

Replace the header section with tabs:

```svelte
<div class="flex shrink-0 items-center justify-between border-b px-4 py-3">
	<div class="flex items-center gap-2">
		<button
			class={cn('text-xs font-medium px-2 py-1 rounded-md transition-colors',
				activeTab === 'important' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
			)}
			onclick={() => { activeTab = 'important'; }}
		>
			Importante {importantCount > 0 ? `(${importantCount})` : ''}
		</button>
		<button
			class={cn('text-xs font-medium px-2 py-1 rounded-md transition-colors',
				activeTab === 'all' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
			)}
			onclick={() => { activeTab = 'all'; }}
		>
			Toate {unreadCount > 0 ? `(${unreadCount})` : ''}
		</button>
	</div>
	<div class="flex items-center gap-1">
		{#if notifications.length > 0}
			<Button
				variant="ghost"
				size="sm"
				class={cn(
					'h-7 gap-1 px-2 text-xs',
					confirmDeleteAll
						? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
						: 'text-destructive hover:text-destructive'
				)}
				onclick={() => {
					if (confirmDeleteAll) {
						deleteAll();
						confirmDeleteAll = false;
						if (confirmDeleteTimeout) clearTimeout(confirmDeleteTimeout);
					} else {
						confirmDeleteAll = true;
						confirmDeleteTimeout = setTimeout(() => { confirmDeleteAll = false; }, 3000);
					}
				}}
				title={confirmDeleteAll ? 'Click din nou pentru a confirma' : 'Sterge toate notificarile'}
			>
				<Trash2Icon class="size-3" />
				{confirmDeleteAll ? 'Confirmi?' : ''}
			</Button>
		{/if}
		{#if unreadCount > 0}
			<Button variant="ghost" size="sm" class="h-7 gap-1 px-2 text-xs" onclick={markAllRead}>
				<CheckCheckIcon class="size-3" />
			</Button>
		{/if}
		<button class="rounded-sm p-1 opacity-70 hover:opacity-100" onclick={() => (open = false)}>
			<XIcon class="size-4" />
		</button>
	</div>
</div>
```

- [ ] **Step 9: Update notification row rendering with priority borders and grouping**

Replace the `{#each notifications as notif}` section. Use `filteredNotifications` and add priority classes + group expand:

```svelte
{#each filteredNotifications as notif (notif.id)}
	{@const Icon = getActivityIcon(notif.type)}
	{@const iconColor = getActivityColor(notif.type)}
	{@const isGroup = (notif.count ?? 1) > 1}
	{@const isExpanded = expandedGroups.has(notif.id)}
	<div
		class={cn(
			'group flex gap-3 border-b px-4 py-3 last:border-b-0 transition-colors',
			getPriorityClasses(notif.priority ?? 'medium', notif.isRead)
		)}
		style="cursor: pointer;"
		onclick={() => {
			if (isGroup) {
				toggleGroup(notif.id);
			} else {
				const link = resolveLink(notif.link);
				if (link) {
					if (!notif.isRead) markOneRead(notif.id);
					open = false;
					goto(link);
				}
			}
		}}
		onkeydown={(e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				if (isGroup) {
					toggleGroup(notif.id);
				} else {
					const link = resolveLink(notif.link);
					if (link) {
						if (!notif.isRead) markOneRead(notif.id);
						open = false;
						goto(link);
					}
				}
			}
		}}
		role="button"
		tabindex="0"
	>
		<div class="mt-0.5 shrink-0">
			<Icon class={cn('size-4', iconColor)} />
		</div>

		<div class="min-w-0 flex-1">
			<p class={cn('text-xs text-foreground', !notif.isRead ? 'font-semibold' : 'font-medium')}>
				{notif.title}
			</p>
			<p class="mt-0.5 text-xs text-muted-foreground">{notif.message}</p>
			<div class="mt-1 flex items-center gap-2">
				<span class="text-[10px] text-muted-foreground/70">{formatDate(notif.updatedAt ?? notif.createdAt)}</span>
				{#if isGroup}
					<button
						class="flex items-center gap-0.5 text-[10px] font-medium text-primary hover:underline"
						onclick|stopPropagation={() => toggleGroup(notif.id)}
					>
						{#if isExpanded}
							<ChevronUpIcon class="size-2.5" />
							Ascunde
						{:else}
							<ChevronDownIcon class="size-2.5" />
							Detalii
						{/if}
					</button>
				{:else if resolveLink(notif.link)}
					<a
						href={resolveLink(notif.link)!}
						class="flex items-center gap-0.5 text-[10px] font-medium text-primary hover:underline"
						onclick={() => { if (!notif.isRead) markOneRead(notif.id); open = false; }}
					>
						<ExternalLinkIcon class="size-2.5" />
						Deschide
					</a>
				{/if}
				{#if !notif.isRead && !isGroup}
					<button
						class="text-[10px] text-muted-foreground hover:text-foreground hover:underline"
						onclick|stopPropagation={() => markOneRead(notif.id)}
					>
						Citit
					</button>
				{/if}
			</div>
		</div>

		<button
			class="mt-0.5 shrink-0 rounded-sm p-0.5 opacity-0 transition-opacity group-hover:opacity-70 hover:!opacity-100 hover:text-destructive"
			onclick|stopPropagation={() => deleteOne(notif.id)}
			title="Sterge notificarea"
		>
			<Trash2Icon class="size-3.5" />
		</button>
	</div>
{/each}
```

- [ ] **Step 10: Run svelte-check + svelte-autofixer**

```bash
cd /Users/augustin598/Projects/CRM/app && npx svelte-check --threshold warning 2>&1 | tail -10
```

Then run svelte-autofixer MCP tool on the component.

- [ ] **Step 11: Commit**

```bash
git add src/lib/components/app/notification-bell/NotificationBell.svelte
git commit -m "feat(notifications): redesign bell UI with priority hierarchy, tab filters, group expand"
```

---

### Task 9: Notification cleanup scheduler task

**Files:**
- Create: `src/lib/server/scheduler/tasks/notification-cleanup.ts`

- [ ] **Step 1: Create the cleanup task**

```typescript
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, lt, eq } from 'drizzle-orm';
import { logInfo, logError } from '$lib/server/logger';

/**
 * Delete old notifications:
 * - Read notifications older than 30 days
 * - All notifications older than 90 days
 */
export async function cleanupOldNotifications(): Promise<void> {
	try {
		const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
		const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

		const deletedRead = await db
			.delete(table.notification)
			.where(
				and(
					eq(table.notification.isRead, true),
					lt(table.notification.createdAt, thirtyDaysAgo)
				)
			);

		const deletedExpired = await db
			.delete(table.notification)
			.where(lt(table.notification.createdAt, ninetyDaysAgo));

		logInfo('scheduler', 'Notification cleanup completed', {
			deletedRead: deletedRead.rowsAffected,
			deletedExpired: deletedExpired.rowsAffected,
		});
	} catch (error) {
		logError('scheduler', 'Notification cleanup failed', {
			error: error instanceof Error ? error.message : String(error),
		});
	}
}
```

- [ ] **Step 2: Register in scheduler**

Find where scheduler tasks are registered and add:

```typescript
// Daily at 02:00 — cleanup old notifications
scheduler.register('notification-cleanup', '0 2 * * *', cleanupOldNotifications);
```

The exact registration pattern depends on the scheduler implementation — match the existing pattern.

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/scheduler/tasks/notification-cleanup.ts
git commit -m "feat(notifications): add daily cleanup task (30d read, 90d all)"
```

---

## Phase 2: New Notification Types — Sync, Financial, Client

### Task 10: integration.auth_expiring hook

**Files:**
- Modify: `src/lib/server/scheduler/tasks/token-refresh.ts`

- [ ] **Step 1: Add expiry warning logic**

In the token-refresh task, after the token refresh logic, add a check for tokens expiring within 7 days. Find where token expiry is checked and add:

```typescript
import { createNotification } from '$lib/server/notifications';

// After checking token validity, before returning:
// If token is valid but expires within 7 days, warn
const expiresAt = integration.tokenExpiresAt; // adjust field name to match schema
if (expiresAt) {
	const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
	if (new Date(expiresAt) <= sevenDaysFromNow) {
		const adminUserIds = await getTenantAdminUserIds(integration.tenantId);
		const [tenant] = await db
			.select({ slug: table.tenant.slug })
			.from(table.tenant)
			.where(eq(table.tenant.id, integration.tenantId))
			.limit(1);

		for (const userId of adminUserIds) {
			await createNotification({
				tenantId: integration.tenantId,
				userId,
				type: 'integration.auth_expiring',
				title: `Token ${integration.provider} expira curand`,
				message: `Token-ul de acces ${integration.provider} expira pe ${new Date(expiresAt).toLocaleDateString('ro-RO')}. Reconecteaza integrarea.`,
				link: tenant ? `/${tenant.slug}/settings/integrations` : undefined,
				priority: 'high',
				metadata: { integrationId: integration.id, provider: integration.provider },
			});
		}
	}
}
```

Adapt field names (`tokenExpiresAt`, `provider`, etc.) to match the actual schema.

- [ ] **Step 2: Commit**

```bash
git add src/lib/server/scheduler/tasks/token-refresh.ts
git commit -m "feat(notifications): add integration.auth_expiring warning (7 days before expiry)"
```

---

### Task 11: email.delivery_failed hook

**Files:**
- Modify: `src/lib/server/email.ts:380+`

- [ ] **Step 1: Add notification on email failure**

In `sendWithPersistence()`, find the final catch/failure block (after all retries exhausted). Add:

```typescript
import { createNotification } from '$lib/server/notifications';

// After final retry failure, before returning/throwing:
// Only notify if we have tenant context
if (ctx.tenantId) {
	const adminUserIds = await getTenantAdminUserIds(ctx.tenantId);
	for (const userId of adminUserIds) {
		await createNotification({
			tenantId: ctx.tenantId,
			userId,
			type: 'email.delivery_failed',
			title: 'Email netrimis',
			message: `Email catre ${ctx.to} a esuat: ${error.message}`,
			priority: 'high',
			metadata: { to: ctx.to, subject: ctx.subject },
		}).catch(() => {}); // Don't let notification failure break email flow
	}
}
```

Adapt `ctx` fields to match actual EmailSendContext interface.

- [ ] **Step 2: Commit**

```bash
git add src/lib/server/email.ts
git commit -m "feat(notifications): notify admins on email delivery failure"
```

---

### Task 12: invoice.reminder scheduler task

**Files:**
- Create: `src/lib/server/scheduler/tasks/invoice-reminder-notifications.ts`

- [ ] **Step 1: Create the reminder task**

```typescript
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, lt, ne, isNotNull } from 'drizzle-orm';
import { createNotification } from '$lib/server/notifications';
import { logInfo, logError } from '$lib/server/logger';

/**
 * Check for unpaid invoices past due date and create reminder notifications.
 * Runs daily. Creates grouped notifications per admin user.
 */
export async function checkInvoiceReminders(): Promise<void> {
	try {
		const now = new Date();

		// Find invoices that are unpaid and past due date
		const overdueInvoices = await db
			.select({
				id: table.invoice.id,
				tenantId: table.invoice.tenantId,
				clientId: table.invoice.clientId,
				invoiceNumber: table.invoice.invoiceNumber,
				dueDate: table.invoice.dueDate,
			})
			.from(table.invoice)
			.where(
				and(
					ne(table.invoice.status, 'paid'),
					ne(table.invoice.status, 'cancelled'),
					isNotNull(table.invoice.dueDate),
					lt(table.invoice.dueDate, now)
				)
			);

		if (overdueInvoices.length === 0) return;

		// Group by tenant
		const byTenant = new Map<string, typeof overdueInvoices>();
		for (const inv of overdueInvoices) {
			const list = byTenant.get(inv.tenantId) ?? [];
			list.push(inv);
			byTenant.set(inv.tenantId, list);
		}

		for (const [tenantId, invoices] of byTenant) {
			const adminUserIds = await getTenantAdminUserIds(tenantId);
			const [tenant] = await db
				.select({ slug: table.tenant.slug })
				.from(table.tenant)
				.where(eq(table.tenant.id, tenantId))
				.limit(1);

			const link = tenant ? `/${tenant.slug}/invoices?status=overdue` : undefined;
			const oldestDays = Math.max(...invoices.map((i) => {
				const diff = now.getTime() - new Date(i.dueDate!).getTime();
				return Math.floor(diff / (24 * 60 * 60 * 1000));
			}));

			for (const userId of adminUserIds) {
				await createNotification({
					tenantId,
					userId,
					type: 'invoice.reminder',
					title: `${invoices.length} facturi restante`,
					message: `${invoices.length} facturi neplatite, cea mai veche de ${oldestDays} zile`,
					link,
					priority: 'high',
					metadata: { invoiceCount: invoices.length, oldestDays },
				});
			}
		}

		logInfo('scheduler', `Invoice reminders: ${overdueInvoices.length} overdue invoices notified`);
	} catch (error) {
		logError('scheduler', 'Invoice reminder notifications failed', {
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

async function getTenantAdminUserIds(tenantId: string): Promise<string[]> {
	const tenantUsers = await db
		.select({ userId: table.tenantUser.userId })
		.from(table.tenantUser)
		.where(
			and(
				eq(table.tenantUser.tenantId, tenantId),
				or(eq(table.tenantUser.role, 'owner'), eq(table.tenantUser.role, 'admin'))
			)
		);
	return tenantUsers.map((tu) => tu.userId);
}
```

Add missing `or` import from drizzle-orm.

- [ ] **Step 2: Register in scheduler**

```typescript
// Daily at 08:00 — check overdue invoices
scheduler.register('invoice-reminder-notifications', '0 8 * * *', checkInvoiceReminders);
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/scheduler/tasks/invoice-reminder-notifications.ts
git commit -m "feat(notifications): add daily invoice reminder notifications for overdue invoices"
```

---

### Task 13: contract.expiring hook

**Files:**
- Modify: `src/lib/server/scheduler/tasks/contract-lifecycle.ts`

- [ ] **Step 1: Add expiring check after the existing activated/expired logic**

Add at the end of `processContractLifecycle()`, before the final return:

```typescript
// Check for contracts expiring within 14 days
const fourteenDaysFromNow = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
const today = new Date();

const expiringContracts = await db
	.select({
		id: table.contract.id,
		tenantId: table.contract.tenantId,
		clientId: table.contract.clientId,
		title: table.contract.title,
	})
	.from(table.contract)
	.where(
		and(
			eq(table.contract.status, 'active'),
			isNotNull(table.contract.endDate),
			lt(table.contract.endDate, fourteenDaysFromNow),
			// Don't include already expired (endDate > today)
			// Adjust based on actual field names
		)
	);

if (expiringContracts.length > 0) {
	// Group by tenant
	const byTenant = new Map<string, typeof expiringContracts>();
	for (const c of expiringContracts) {
		const list = byTenant.get(c.tenantId) ?? [];
		list.push(c);
		byTenant.set(c.tenantId, list);
	}

	for (const [tenantId, contracts] of byTenant) {
		const adminUserIds = await getTenantAdminUserIds(tenantId);
		const [tenant] = await db
			.select({ slug: table.tenant.slug })
			.from(table.tenant)
			.where(eq(table.tenant.id, tenantId))
			.limit(1);

		for (const userId of adminUserIds) {
			await createNotification({
				tenantId,
				userId,
				type: 'contract.expiring',
				title: `${contracts.length} contracte expira curand`,
				message: contracts.length === 1
					? `Contractul "${contracts[0].title}" expira in mai putin de 14 zile`
					: `${contracts.length} contracte expira in mai putin de 14 zile`,
				link: tenant ? `/${tenant.slug}/contracts` : undefined,
				priority: 'high',
			});
		}
	}
}
```

Adapt field names (`endDate`, `title`, `status`) to match actual schema.

- [ ] **Step 2: Commit**

```bash
git add src/lib/server/scheduler/tasks/contract-lifecycle.ts
git commit -m "feat(notifications): add contract.expiring warning (14 days before expiry)"
```

---

### Task 14: task.overdue scheduler task

**Files:**
- Create: `src/lib/server/scheduler/tasks/task-overdue-notifications.ts`

- [ ] **Step 1: Create the task**

```typescript
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, lt, ne, isNotNull, or } from 'drizzle-orm';
import { createNotification } from '$lib/server/notifications';
import { logInfo, logError } from '$lib/server/logger';

/**
 * Check for tasks overdue by more than 3 days and notify.
 */
export async function checkOverdueTasks(): Promise<void> {
	try {
		const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

		const overdueTasks = await db
			.select({
				id: table.task.id,
				tenantId: table.task.tenantId,
				clientId: table.task.clientId,
				title: table.task.title,
				assignedTo: table.task.assignedTo,
				deadline: table.task.deadline,
			})
			.from(table.task)
			.where(
				and(
					ne(table.task.status, 'done'),
					ne(table.task.status, 'cancelled'),
					isNotNull(table.task.deadline),
					lt(table.task.deadline, threeDaysAgo)
				)
			);

		if (overdueTasks.length === 0) return;

		// Group by tenant
		const byTenant = new Map<string, typeof overdueTasks>();
		for (const t of overdueTasks) {
			const list = byTenant.get(t.tenantId) ?? [];
			list.push(t);
			byTenant.set(t.tenantId, list);
		}

		for (const [tenantId, tasks] of byTenant) {
			const adminUserIds = await getTenantAdminUserIds(tenantId);
			const [tenant] = await db
				.select({ slug: table.tenant.slug })
				.from(table.tenant)
				.where(eq(table.tenant.id, tenantId))
				.limit(1);

			for (const userId of adminUserIds) {
				await createNotification({
					tenantId,
					userId,
					type: 'task.overdue',
					title: `${tasks.length} taskuri intarziate`,
					message: `${tasks.length} taskuri au depasit deadline-ul cu mai mult de 3 zile`,
					link: tenant ? `/${tenant.slug}/tasks?status=overdue` : undefined,
					priority: 'medium',
				});
			}
		}

		logInfo('scheduler', `Task overdue notifications: ${overdueTasks.length} overdue tasks`);
	} catch (error) {
		logError('scheduler', 'Task overdue notifications failed', {
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

async function getTenantAdminUserIds(tenantId: string): Promise<string[]> {
	const tenantUsers = await db
		.select({ userId: table.tenantUser.userId })
		.from(table.tenantUser)
		.where(
			and(
				eq(table.tenantUser.tenantId, tenantId),
				or(eq(table.tenantUser.role, 'owner'), eq(table.tenantUser.role, 'admin'))
			)
		);
	return tenantUsers.map((tu) => tu.userId);
}
```

- [ ] **Step 2: Register in scheduler**

```typescript
// Daily at 09:00 — check overdue tasks
scheduler.register('task-overdue-notifications', '0 9 * * *', checkOverdueTasks);
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/scheduler/tasks/task-overdue-notifications.ts
git commit -m "feat(notifications): add daily task overdue notifications (>3 days past deadline)"
```

---

### Task 15: client.created hook

**Files:**
- Modify: `src/lib/server/hooks/notification-hooks.ts`

- [ ] **Step 1: Add client.created hook**

Add at the end of `registerNotificationHooks()`, before the logInfo line:

```typescript
// ---- Client Created ----
hooks.on('client.created', async (event: { tenantId: string; tenantSlug: string; client: { id: string; name: string } }) => {
	try {
		const adminUserIds = await getTenantAdminUserIds(event.tenantId);

		await Promise.all(
			adminUserIds.map((userId) =>
				createNotification({
					tenantId: event.tenantId,
					userId,
					clientId: event.client.id,
					type: 'client.created',
					title: 'Client nou adaugat',
					message: `Clientul "${event.client.name}" a fost adaugat`,
					link: `/${event.tenantSlug}/clients/${event.client.id}`,
					priority: 'medium',
				})
			)
		);
	} catch (error) {
		logError('server', 'notification-hooks: failed to create client.created notification', {
			tenantId: event.tenantId
		});
	}
});
```

- [ ] **Step 2: Emit hook from client creation**

Find where clients are created (likely in a clients remote or API route). Add after successful insert:

```typescript
const hooks = getHooksManager();
await hooks.emit('client.created', {
	tenantId,
	tenantSlug: tenant.slug,
	client: { id: newClient.id, name: newClient.name },
});
```

Check if the `client.created` event type needs to be added to the hooks type definitions.

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/hooks/notification-hooks.ts
git commit -m "feat(notifications): add client.created notification hook"
```

---

### Task 16: Final Phase 1+2 verification

- [ ] **Step 1: Run full svelte-check**

```bash
cd /Users/augustin598/Projects/CRM/app && npx svelte-check --threshold warning 2>&1 | tail -10
```

Expected: 0 errors.

- [ ] **Step 2: Run svelte-autofixer on NotificationBell**

Use MCP svelte-autofixer tool on the updated NotificationBell.svelte.

- [ ] **Step 3: Verify migrations on remote DB**

```bash
cd /Users/augustin598/Projects/CRM/app && bun run db:migrate
```

Then verify: `PRAGMA table_info(notification)` should show all new columns.

- [ ] **Step 4: Test bell UI in browser**

Open the app, check:
- Badge shows only urgent+high count
- Tab filters work (Importante / Toate)
- Priority borders render correctly
- Grouped notifications show count in title

- [ ] **Step 5: Commit any fixes from verification**

```bash
git add -A
git commit -m "fix(notifications): verification fixes for Phase 1+2"
```

---

## Phase 3-5: Deferred Tasks

### Phase 3: comment.mention, approval.requested, system.db_error, keez/smartbill sync errors
- Hook into task-comments.remote.ts mention extraction (lines 50-70)
- Hook into task status change to 'pending-approval'
- Wrap DB connection errors in try/catch
- Hook into Keez/SmartBill sync task failures

### Phase 4: Email channel
- Add email dedup via lastEmailAt column
- Create notification-alert email template
- Wire email sending into createNotification for EMAIL_TYPES
- Test dedup: same notification type should send max 1 email per 24h

### Phase 5: UI polish
- Group expand/collapse animation (height transition 150ms)
- New notification slide-in animation
- Badge scale bounce on update
- Mobile bottom sheet layout

These phases can be planned in detail after Phase 1+2 are verified and working.
