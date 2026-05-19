# Performance Audit — Task Module

**Date:** 2026-05-19
**Auditor:** Performance Benchmarker subagent
**Branch:** claude/practical-kilby-15341a (main)

---

## Executive Summary

The task module is architecturally sound for the current load (~50 tenants, hundreds of tasks). The `getTasks` list path uses proper `inArray` bulk-fetching for includes (no N+1 there). However, five distinct N+1 patterns exist in the write path, all in notification/activity loops. The schema has **zero custom indexes** on the seven core task-related tables, which currently adds ~5–15ms per Turso HTTP roundtrip per unindexed scan. The client portal task detail page fires 6 queries on mount but they are parallel — that is intentional and acceptable. The kanban optimistic update is correct but duplicates the entire active task array on every drag, costing O(n) array spread for 500+ cards. Bundle: `RichEditor` (TipTap) is statically imported in both admin and client comment components — it should be lazy-loaded.

---

## Findings

### P0 — Active perf bug (will degrade under load)

**#PERF-P0-1** | `tasks.remote.ts:1293–1314` | N+1 user lookup inside `updateTask` watcher notification loop

- **Evidence:** `updateTask` fetches all watchers in one query, then for every watcher runs a separate `db.select().from(table.user).where(eq(table.user.id, watcher.userId))` query. With a task watched by 10 users, that is 11 queries (1 for watchers list + 10 for user rows) before the first email is sent.
- **Impact:** At 10 watchers: 10 extra Turso roundtrips at ~15ms each = +150ms added to every `updateTask` call. At peak this holds the HTTP connection open and will cause the "write lock" timeouts documented in `reference_turso_db_troubleshooting.md`.
- **Fix:** Rewrite the watcher fetch to join `user` inline:
  ```ts
  const watchers = await db
    .select({ userId: table.taskWatcher.userId, email: table.user.email, firstName: table.user.firstName, lastName: table.user.lastName })
    .from(table.taskWatcher)
    .innerJoin(table.user, eq(table.taskWatcher.userId, table.user.id))
    .where(and(eq(table.taskWatcher.taskId, taskId), eq(table.taskWatcher.tenantId, event.locals.tenant.id)));
  ```
  This reduces N+1 to a single query.

---

**#PERF-P0-2** | `tasks.remote.ts:1769–1793` | `bulkUpdateTaskStatus` fires 3 sequential async calls per changed task: `recordTaskActivity` → `sendClientNotificationIfEnabled` (which itself issues 3 DB queries inside). For 50 tasks changed: 50 × (1 activity insert + 3 notification queries) = **200 DB roundtrips** at ~15ms each = ~3 seconds of serial I/O.

- **Evidence:** The loop at line 1769 iterates `changedTasks` with `await` inside. `sendClientNotificationIfEnabled` always calls `db.select().from(table.taskSettings)`, `db.select().from(table.task)`, and `db.select().from(table.client)` — 3 queries even when client notifications are disabled.
- **Impact:** 50-task bulk status update: estimated 3,000ms added latency. At 500 tasks (max): 30,000ms — will time out Turso write lock.
- **Fix (two parts):**
  1. Batch activity inserts: collect all activity rows, then do one `db.insert(table.taskActivity).values(rows)` after the loop.
  2. Pre-fetch `taskSettings` once before the loop (it does not change per task). Pass it into a lighter notification helper that skips re-fetching.

---

### P1 — Will become a problem at scale

**#PERF-P1-1** | `task-comments.remote.ts:317–368` | N+1 `db.select().from(table.user)` per @mention in `createTaskComment`

- **Evidence:** Lines 324–339: for each `mentionedId` that is not already a watcher, a separate `db.select().from(table.user).where(eq(table.user.id, mentionedId))` is issued. If a comment has 5 @mentions: 5 extra roundtrips.
- **Impact:** 5 mentions × 15ms = +75ms per comment. Uncommon but degrades the submit latency users feel directly.
- **Fix:** Pre-fetch all mentioned user IDs in one `inArray` query before the loop.

---

**#PERF-P1-2** | Schema — zero indexes on `task`, `taskActivity`, `taskComment`, `taskWatcher`, `subtask`, `taskTag`, `taskCommentReaction`

- **Evidence:** The `task` table at line 284 has no `(t) => [index(...)]` block. Every `getTasks` call with `tenantId` filter performs a full table scan in SQLite. At 500 tasks per tenant × 50 tenants = 25,000 rows, a full scan over HTTP to Turso takes ~30–80ms per query instead of <5ms with an index.
- **Impact:** The kanban page fires `getTasks` + `getCompletedTasks` on every filter change and page load. Two full-scans × 50ms each = 100ms of pure index-miss cost per page render. The `getTaskActivities` query on line 42 (`WHERE task_id = ?`) also scans all `taskActivity` rows if `task_id` lacks an index.
- **Fix:** See Index Recommendations section.

---

**#PERF-P1-3** | `getTask` fires 3 sequential queries: task, then subtasks, then tags, then assignees — 4 roundtrips per detail open

- **Evidence:** Lines 187–213 in `tasks.remote.ts`: `subtasks`, `tagRows`, and `assigneeRows` are three sequential `await db.select(...)` calls after the initial task fetch — 4 total, all sequential (no `Promise.all`).
- **Impact:** 4 × 15ms Turso HTTP = 60ms minimum latency on every task detail open. The client portal task page calls `getTask` and then child components call `getTaskComments`, `getTaskActivities`, `getTaskMaterials`, `getTaskWatchers` — but those are parallel via SvelteKit's query() reactive system. The 4 sequential queries inside `getTask` itself are the bottleneck.
- **Fix:**
  ```ts
  const [subtasks, tagRows, assigneeRows] = await Promise.all([
    db.select().from(table.subtask).where(...),
    db.select(...).from(table.taskToTag).innerJoin(...).where(...),
    db.select(...).from(table.taskAssignee).innerJoin(...).where(...)
  ]);
  ```

---

**#PERF-P1-4** | `tasks.remote.ts:1993–2012` | `bulkDuplicateTasks` activity loop: N sequential `await recordTaskActivity(...)` calls (1 per duplicated task)

- **Evidence:** Line 1993: sequential `await` inside `for` loop over `sourceTasks`. The data fetch and transaction before this are correctly batched — the activity logging loop undoes it. At 100 tasks: 100 sequential `INSERT INTO task_activity` calls at ~15ms each = +1,500ms post-transaction.
- **Fix:** `recordTaskActivity` should accept an array of rows, or build the insert values array and do one bulk insert after the loop. Alternatively, `Promise.allSettled` the activity inserts (they are non-critical for correctness).

---

**#PERF-P1-5** | `getTaskActivities` (task-activities.remote.ts:7) and `getTaskComments` (task-comments.remote.ts:77) each perform a full `task` lookup for tenant verification before the real query — 2 queries instead of 1 per call

- **Evidence:** Both query `db.select().from(table.task).where(and(eq(task.id, taskId), eq(task.tenantId, tenantId)))` then issue the main select. These are called on every task detail open, on every comment or reaction toggle.
- **Impact:** Adds one extra roundtrip (15ms) to every read and every command in these remotes. The client portal task detail fires `getTaskComments` + `getTaskActivities` in parallel — so the verification queries run concurrently, but each remote still makes one extra query it does not need.
- **Fix:** Push the tenant check into the main query via a JOIN or a sub-condition on the join, eliminating the preflight. For example, in `getTaskActivities`, join `task` on `taskActivity.taskId = task.id AND task.tenantId = tenantId` and select from there — one query covers both auth check and data.

---

### P2 — Optimization opportunity

**#PERF-P2-1** | `tasks.remote.ts:870–886` | `createTask` inserts subtasks in a sequential `for` loop inside the transaction

- **Evidence:** Line 872: `for (let i = 0; i < data.subtasks.length; i++) { await tx.insert(...) }`. At 10 subtasks this is 10 INSERT statements. The `bulkDuplicateTasks` path (correctly) builds all rows then does one `tx.insert(table.subtask).values(subtaskRows)` — `createTask` should follow the same pattern.
- **Impact:** Low at current usage (initial task creation). Degrades if users create tasks with many subtasks from templates.
- **Fix:** Build subtask row array, then single `tx.insert(table.subtask).values(rows)`.

---

**#PERF-P2-2** | `getStatsRefreshQueries()` in tasks page calls `getTasks` twice with slightly different args (lines 296–304), causing 2 separate server round-trips after every bulk operation

- **Evidence:**
  ```ts
  function getStatsRefreshQueries() {
    return [
      getTasks({ ...filterParams, excludeCompleted: ..., include: { subtasks: true, tags: true, assignees: true } }),
      getTasks({ ...filterParams })  // second call, no include
    ];
  }
  ```
  The second `getTasks` call is redundant — the list is already fetched via `$derived` bindings on the page. The `.updates()` mechanism triggers a re-fetch; calling it twice forces two roundtrips.
- **Fix:** Remove the second `getTasks({...filterParams})` from `getStatsRefreshQueries`. The page's reactive query will re-run automatically.

---

**#PERF-P2-3** | Kanban: `optimisticTasks` is spread-copied on every drag event (lines 313, 329, 344, etc.)

- **Evidence:** Every `handleDrop` call does `[...optimisticTasks]` which creates a new array of all active tasks. At 500 cards this allocates a 500-element array and triggers a Svelte reactivity diff across all 6 columns.
- **Impact:** Each drag = ~1ms GC pressure per 100 tasks. With 500 tasks: ~5ms per drop event (imperceptible at 1 drop; accumulates under fast repeated dragging on slow mobile CPUs).
- **Fix (low priority):** Use a `Map<id, task>` for optimistic state and rebuild derived arrays per-column. This converts O(n) array copy to O(1) map update.

---

**#PERF-P2-4** | `RichEditor` (TipTap) imported statically in `client-task-comments.svelte` (line 11) and `task-comment-thread.svelte` (line 14)

- **Evidence:** Static `import RichEditor from '$lib/components/RichEditor/RichEditor.svelte'`. TipTap pulls in ProseMirror core + extensions. The RichEditor is only needed when the user clicks "Reply" or "Comment" — it should not be part of the initial parse/hydration.
- **Impact:** Increases the chunk size for both the admin task detail and client task detail routes. Estimated TipTap bundle contribution: 80–120KB gzipped (ProseMirror core ~40KB + extensions). This delays Time to Interactive for the task detail page.
- **Fix:** Lazy-load the editor with `{#await import('./RichEditor.svelte') then {default: RichEditor}}` gated on a `showEditor` boolean that becomes true when the user taps the comment input.

---

**#PERF-P2-5** | `ClientTaskMeetModal` and `ClientTaskLightbox` are statically imported in `client-task-detail-body.svelte` (lines 12–13)

- **Evidence:** Both are always imported regardless of whether the user opens them. `ClientTaskMeetModal` (288 LOC) includes calendar logic; `ClientTaskLightbox` (124 LOC) includes image carousel. Both are rendered as `{#if open}` — correct — but the JS is parsed unconditionally.
- **Fix:** Gate the import: `{#if meetOpen}<svelte:component this={ClientTaskMeetModal} .../>` with `await import()` on the `meetOpen` state transition.

---

### P3 — Nitpick

**#PERF-P3-1** | `getTask` in `tasks.remote.ts:150` does `select *` (no column projection) on the full `task` row, including `description` (potentially long HTML), when called for list-level purposes (e.g., the `createTaskComment` call on line 194 only needs `task.clientId` and `task.tenantId`)

- **Fix:** Scope selects to only needed columns where the full row is not consumed downstream.

**#PERF-P3-2** | `getTaskComments` (line 77) issues both `attachments` and `reactions` queries unconditionally even when the task has zero comments (guards `if (comments.length === 0) return []` correctly, but the early return is already there — this is fine).

**#PERF-P3-3** | `client-task-comments.svelte:178–181` — attachment URL fetch caches in local `$state` (`attachmentUrls`). This is correct. The `getAttachmentUrl` remote uses `query()` which the project memory flags as a caching hazard for presigned URLs. Verify that `getAttachmentUrl` uses `command()` not `query()` — currently it is `query()` at line 539. If the URL expires (300s TTL), the cached URL in `query()`'s arg-keyed cache will be stale. The component's local `attachmentUrls` cache bypasses re-fetch correctly for the session lifetime, but browser restores or rehydration may serve stale cached query results.

---

## Index Recommendations

| Table | Missing Index | Columns | Reasoning |
|---|---|---|---|
| `task` | P1 | `(tenant_id, status)` | Every `getTasks` filter begins with `tenant_id`; adding `status` covers kanban column queries |
| `task` | P1 | `(tenant_id, client_id)` | Client portal and client filter use both |
| `task` | P1 | `(tenant_id, project_id)` | Project filter is the most common admin filter |
| `task` | P2 | `(tenant_id, assigned_to_user_id)` | Assignee filter + watcher lookups |
| `task` | P2 | `(tenant_id, due_date)` | `overdue`/`today`/`thisWeek` date filters |
| `taskActivity` | P1 | `(task_id, created_at DESC)` | `getTaskActivities` ORDER BY `created_at DESC` with no index full-scans the table |
| `taskComment` | P1 | `(task_id, created_at)` | `getTaskComments` WHERE `task_id` ORDER BY `created_at` |
| `taskCommentAttachment` | P2 | `(comment_id)` | Fetched with `inArray(commentId, commentIds)` |
| `taskCommentReaction` | P2 | `(comment_id, tenant_id)` | Fetched with `inArray(commentId) AND tenantId` |
| `taskWatcher` | P1 | `(task_id, tenant_id)` | Hit on every `updateTask` and `createTaskComment` notification path |
| `subtask` | P1 | `(task_id, position)` | `getTask` ORDER BY `position, createdAt` — covers both columns |
| `taskAssignee` | P1 | `(task_id, tenant_id)` | Alongside existing composite PK `(task_id, user_id)` — add for filtered access |
| `taskToTag` | P2 | `(task_id, tenant_id)` | Alongside existing `(task_id, tag_id)` PK — tenant scoping is currently not indexed |
| `taskMarketingMaterial` | P2 | `(task_id)` | `getTaskMaterials` WHERE `task_id` |

Migration pattern (Turso/libSQL, one statement per file per project memory):
```sql
CREATE INDEX IF NOT EXISTS task_tenant_status_idx ON task (tenant_id, status);
```

---

## Cache Invalidation Map

| Command | Currently invalidates | Should also invalidate | Missing / Over-invalidating |
|---|---|---|---|
| `createTaskComment` | `getTaskComments`, `getTaskActivities` | (correct) | OK — activity is correctly included |
| `updateTaskComment` | `getTaskComments`, `getTaskActivities` | `getTaskActivities` | Missing in admin `task-comment-thread.svelte:159` — `updateTaskComment.updates` only includes `getTaskComments`, not `getTaskActivities` |
| `deleteTaskComment` | `getTaskComments`, `getTaskActivities` | (correct) | OK |
| `toggleReaction` | `getTaskComments` | (correct) | OK — reactions are embedded in comments response |
| `toggleSubtask` | `getTask(taskId)` | (correct) | Does NOT invalidate `getTasks` list — intentional (subtask count badge updates via `getTask`, not list) — acceptable |
| `addSubtask` / `deleteSubtask` | `getTask(taskId)` | `getTasks` (for kanban subtask count badge) | Minor: the kanban card shows `subtaskCount` from the list query — adding a subtask will not update the badge until the list is refetched. Over-invalidating here would be expensive; consider local optimistic count update instead |
| `updateTask` | Handled inside dialogs; dialog calls `.updates(getTask, getTasks)` | (verify per dialog) | OK at dialog level |
| `bulkUpdateTaskStatus` | `getTasks` (×2 via `getStatsRefreshQueries`) | Should be ×1 | Over-invalidates — see P2-2 |
| `bulkDuplicateTasks` | Same as above | Same fix | Over-invalidates |
| `bulkDeleteTasks` | Same as above | Same fix | Over-invalidates |
| `updateTaskPosition` (kanban DnD) | `getTasks` + `getCompletedTasks` per loaded page | (correct) | OK — scoped to only completed pages already loaded |
| `scheduleMeet` | `getTask(taskId)` | (correct) | OK |

---

## Files Audited

- `src/lib/remotes/tasks.remote.ts` (2,645 lines)
- `src/lib/remotes/task-comments.remote.ts` (625 lines)
- `src/lib/remotes/task-activities.remote.ts` (57 lines)
- `src/lib/remotes/task-materials.remote.ts` (236 lines)
- `src/lib/server/db/schema.ts` (index review, task-related tables)
- `src/lib/components/task-kanban-board.svelte` (DnD + optimistic update pattern)
- `src/lib/components/client-task/client-task-detail-body.svelte`
- `src/lib/components/client-task/client-task-comments.svelte`
- `src/lib/components/client-task/client-task-rail.svelte`
- `src/lib/components/client-task/client-task-progress-card.svelte`
- `src/lib/components/client-task/client-task-meet-modal.svelte`
- `src/lib/components/client-task/client-task-lightbox.svelte`
- `src/lib/components/client-task/client-task-activity-card.svelte`
- `src/lib/components/client-task/client-task-materials-card.svelte`
- `src/lib/components/task-detail/task-comment-thread.svelte`
- `src/routes/client/[tenant]/(app)/tasks/[taskId]/+page.svelte`
- `src/routes/[tenant]/tasks/+page.svelte` (bulk ops + invalidation)

---

## Statistics

| Severity | Count |
|---|---|
| P0 (active degradation under load) | 2 |
| P1 (will become problem at scale) | 5 |
| P2 (optimization opportunity) | 5 |
| P3 (nitpick) | 3 |
| Missing indexes (P1) | 6 |
| Missing indexes (P2) | 8 |
| Cache invalidation gaps | 2 (updateTaskComment missing activities; bulk ops double-fetch) |

**Estimated query savings if P0+P1 fixed:**
- `updateTask` with 10 watchers: −10 roundtrips (~150ms)
- `bulkUpdateTaskStatus` at 50 tasks: −150 roundtrips (~2,250ms)
- `getTask` detail open: −2 roundtrips (~30ms)
- Index additions on `task(tenant_id, status)`: −scan of ~500 rows per query → <5ms vs ~50ms
