# Keez Sync Notification Cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-clear `keez.sync_error` notifications after a successful Keez sync so users don't see stale errors.

**Architecture:** Add a reusable `clearNotificationsByType(tenantId, type)` function to `notifications.ts`, then call it from `sync.ts` after successful sync. Wrapped in try/catch so notification cleanup never breaks the sync.

**Tech Stack:** TypeScript, Drizzle ORM, libSQL (Turso)

---

### Task 1: Add `clearNotificationsByType` to notifications.ts

**Files:**
- Modify: `src/lib/server/notifications.ts:407` (after `deleteNotifications` function)

- [ ] **Step 1: Add the function after `deleteNotifications` (line 407)**

```typescript
/**
 * Clear all notifications of a specific type for a tenant.
 * Used to remove stale error notifications after a successful operation.
 */
export async function clearNotificationsByType(
	tenantId: string,
	type: NotificationType
): Promise<number> {
	const result = await db
		.delete(table.notification)
		.where(
			and(
				eq(table.notification.tenantId, tenantId),
				eq(table.notification.type, type)
			)
		);
	return result.rowsAffected;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/augustin598/Projects/CRM/app && npx tsc --noEmit 2>&1 | grep notifications.ts`
Expected: No errors related to `notifications.ts`

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/notifications.ts
git commit -m "feat: add clearNotificationsByType utility for tenant-scoped notification cleanup"
```

---

### Task 2: Call `clearNotificationsByType` from Keez sync

**Files:**
- Modify: `src/lib/server/plugins/keez/sync.ts:460` (after `lastSyncAt` update block)

- [ ] **Step 1: Add import at top of sync.ts**

At the top of `src/lib/server/plugins/keez/sync.ts`, add to imports:

```typescript
import { clearNotificationsByType } from '$lib/server/notifications';
```

- [ ] **Step 2: Add cleanup call after lastSyncAt update (after line 460)**

After the closing `}` of the `lastSyncAt` update block (line 460), add:

```typescript

	// Clear stale Keez sync error notifications after successful sync
	try {
		await clearNotificationsByType(tenantId, 'keez.sync_error');
	} catch {
		// Don't break sync for notification cleanup errors
	}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /Users/augustin598/Projects/CRM/app && npx tsc --noEmit 2>&1 | grep "keez/sync"`
Expected: No errors related to `keez/sync.ts`

- [ ] **Step 4: Commit**

```bash
git add src/lib/server/plugins/keez/sync.ts
git commit -m "feat: auto-clear Keez sync error notifications after successful sync"
```

---

### Task 3: Push

- [ ] **Step 1: Push to remote**

```bash
git push
```
