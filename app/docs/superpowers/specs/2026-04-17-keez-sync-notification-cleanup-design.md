# Auto-clear Keez Sync Error Notifications After Successful Sync

**Date:** 2026-04-17
**Status:** Approved

## Problem

When the Keez API returns a transient error (e.g., 502 Bad Gateway), a `keez.sync_error` notification is created for all tenant admins. When the next scheduled sync succeeds, the old error notification persists, showing users an error for a problem that no longer exists.

## Solution

Add a reusable `clearNotificationsByType(tenantId, type)` function to `notifications.ts` and call it from `sync.ts` after a successful Keez sync.

## Changes

### 1. `src/lib/server/notifications.ts` — new function

```typescript
export async function clearNotificationsByType(
  tenantId: string,
  type: NotificationType
): Promise<number>
```

- Deletes all notifications matching `tenantId + type`, regardless of `userId`
- Returns the number of deleted notifications
- Reusable for SmartBill and future integrations

### 2. `src/lib/server/plugins/keez/sync.ts` — call after successful sync

- After the block that updates `lastSyncAt` (~line 460), call `clearNotificationsByType(tenantId, 'keez.sync_error')`
- Called regardless of partial errors (the sync succeeded, API connectivity is restored)
- Wrapped in try/catch — notification cleanup failure must not break the sync

## What does NOT change

- Error notification creation in `keez-invoice-sync.ts` — unchanged
- `notification` table schema — no modifications needed
- Existing `deleteNotifications()` / `markNotificationsRead()` functions — untouched

## Error Handling

- `clearNotificationsByType` call in `sync.ts` is wrapped in try/catch — sync is never interrupted by notification cleanup failures

## Testing

- Manual verification: trigger Keez sync → old error notifications are cleared
