# Security & Multi-Tenant Audit — Task Module

**Date:** 2026-05-19
**Scope:** Admin task module (Faza 1-5) + Client portal task surface (just shipped)
**Auditor:** Security Engineer subagent

---

## Executive Summary

4 P1 findings and 3 P2 findings were identified. No P0 (direct tenant data leak) exists — all `SELECT/UPDATE/DELETE` on the `task` table correctly include a `tenantId` WHERE clause, and bulk operations (`bulkUpdateTaskStatus`, `bulkDeleteTasks`, `bulkDuplicateTasks`) correctly pre-fetch a tenant-scoped whitelist before operating. The most serious finding is that client portal users can invoke `scheduleMeet`, `toggleSubtask`, `addSubtask`, and `deleteSubtask` — server-side mutations with no `isClientUser` guard — allowing them to overwrite meeting links and manage subtasks on any task belonging to their client, including tasks created by the tenant admin where the client should have read-only access. Secondary findings are bare-ID final UPDATE/DELETE statements in 3 functions that rely on prior verification rather than defense-in-depth WHERE clauses.

---

## Findings

### P1 — Defense in Depth / Audit Gap

---

#### #P1-1 | `src/lib/remotes/tasks.remote.ts:2619-2645` | `scheduleMeet` — No client-user guard; client can overwrite meeting link/time on any of their tasks

**Evidence:**
```ts
// tasks.remote.ts:2626-2633
async ({ taskId, meetLink, meetTime, meetDurationMinutes }) => {
    const event = getRequestEvent();
    if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');

    const [task] = await db.select({ id: table.task.id })
        .from(table.task)
        .where(and(eq(table.task.id, taskId), eq(table.task.tenantId, event.locals.tenant.id)))
        .limit(1);
    if (!task) throw new Error('Task not found');
    // NO isClientUser check — falls through to UPDATE
```

**Risk:** The `client-task-meet-modal.svelte` component imports and calls `scheduleMeet` from the client portal. A primary or secondary contact with tasks access can POST a `scheduleMeet` command for any task linked to their client, overwriting `meetLink`, `meetTime`, and `meetDurationMinutes` without tenant approval. This is an admin-level field (Meet integration) that clients should not control.

**Reproduction:** Log in as a client portal user with `tasks` access. Open the meet modal on a task. Observe that the POST succeeds and updates the task's `meetLink` in the DB. The server does not check `event.locals.isClientUser`.

**Fix:**
```ts
if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
// Add immediately after:
if (event.locals.isClientUser) {
    throw new Error('Unauthorized — only administrators can schedule meetings');
}
```

---

#### #P1-2 | `src/lib/remotes/tasks.remote.ts:2364-2438` | `toggleSubtask`, `addSubtask`, `deleteSubtask` — No client-user guard; client portal component calls all three

**Evidence:**
```ts
// client-task-progress-card.svelte:3-8
import {
    toggleSubtask,
    addSubtask,
    deleteSubtask,
    getTask
} from '$lib/remotes/tasks.remote';
```
```ts
// tasks.remote.ts:2366-2378 — toggleSubtask
if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
// No isClientUser gate. Proceeds directly to:
.where(and(eq(table.subtask.id, subtaskId), eq(table.subtask.tenantId, event.locals.tenant.id)))
```

**Risk:** A client user can toggle, add, and delete subtasks on tasks belonging to their client. `toggleSubtask` checks only `subtask.tenantId`, not whether the client owns the task. `addSubtask` verifies `task.tenantId` but not `task.clientId`. Both mutations are admin operations — subtask management should not be available to client contacts. Additionally, `deleteSubtask` uses `subtask.tenantId` scope but has no client ownership check at all.

**Reproduction:** From a client portal session, call `addSubtask` with any valid `taskId` belonging to the client's tenant. The subtask is created. No server-side block exists.

**Fix:** Add at the top of each handler:
```ts
if (event.locals.isClientUser) throw new Error('Unauthorized');
```
For `toggleSubtask` specifically, if intentional read-only progress visibility is desired, the toggle should be blocked too — clients seeing subtask progress is fine, but modifying it is an admin action.

---

#### #P1-3 | `src/lib/remotes/tasks.remote.ts:1141-1150` | `updateTask` final `db.update` has no tenantId in WHERE clause

**Evidence:**
```ts
// tasks.remote.ts:1141-1150
await db
    .update(table.task)
    .set({ ...restUpdateData, ...recurringPatch, ... })
    .where(eq(table.task.id, taskId));  // bare ID — no tenantId
```

**Risk:** The task existence is verified with a tenant-scoped SELECT before this point (lines 1042-1065), so a genuine cross-tenant UPDATE is prevented by the early-exit guard. However, this breaks defense-in-depth: if the prior SELECT is ever refactored or bypassed (e.g., a future fast path), the UPDATE would operate on any task with that ID across all tenants. The same pattern exists in `reopenTask` (line 1435-1443) where the conditional UPDATE uses only `task.id` + status check but not `tenantId`.

**Reproduction:** Not directly exploitable today, but a single refactoring of the pre-check path would make it a P0.

**Fix:**
```ts
.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, existing.tenantId)));
```
Apply to: `updateTask` (line 1150), `reopenTask` (line 1437, 1441), `approveTask` (line 2276), `rejectTask` (line 2327).

---

#### #P1-4 | `src/lib/remotes/task-comments.remote.ts:447-453` + `src/lib/remotes/client-secondary-emails.remote.ts:216-218` | Final UPDATE/DELETE statements are bare-ID without tenantId

**Evidence:**
```ts
// task-comments.remote.ts:447-453 — updateTaskComment
await db.update(table.taskComment)
    .set({ content: sanitizeCommentHtml(data.content), updatedAt: new Date() })
    .where(eq(table.taskComment.id, data.commentId));  // bare ID

// client-secondary-emails.remote.ts:216-218 — deleteClientSecondaryEmail
await db.delete(table.clientSecondaryEmail)
    .where(eq(table.clientSecondaryEmail.id, secondaryEmailId));  // bare ID

// client-secondary-emails.remote.ts:183-190 — updateClientSecondaryEmailAccess
await db.update(table.clientSecondaryEmail)
    .set({ ... })
    .where(eq(table.clientSecondaryEmail.id, data.secondaryEmailId));  // bare ID
```

**Risk:** Same defense-in-depth concern as P1-3. In `updateTaskComment`, the final UPDATE is preceded by a tenant-scoped JOIN lookup (lines 419-430) confirming ownership. In both secondary-email mutations, the record is pre-fetched with `tenantHint` scope. The bare-ID DML statements are safe today but become unsafe if the pre-check is ever decoupled.

**Fix:** Add `tenantId` to the final DML `WHERE` clause in each case. For `updateTaskComment`: `.where(and(eq(table.taskComment.id, data.commentId), eq(table.task.tenantId, event.locals.tenant.id)))` — or more practically, join via task as already verified. For secondary emails: pass `tenantHint` into the `.where()`.

---

### P2 — Hygiene / Best Practice

---

#### #P2-1 | `src/routes/[tenant]/task-comments/upload/+server.ts` — Client portal component POSTs to admin-path upload endpoint; no `isClientUser` check in the endpoint

**Evidence:**
```ts
// client-task-comments.svelte:74
const response = await fetch(`/${tenantSlug}/task-comments/upload`, { ... });

// [tenant]/task-comments/upload/+server.ts:32-34
const user = event.locals.user;
const tenant = event.locals.tenant;
if (!user || !tenant) { throw error(401, 'Unauthorized'); }
// No check for event.locals.isClientUser
```

**Risk:** The upload endpoint lives under `/[tenant]/task-comments/upload` (admin route tree). The middleware sets `isClientUser = true` only for `/client/[tenant]/...` paths; when a client portal component POSTs to `/${tenantSlug}/task-comments/upload`, the middleware processes it as a regular tenant route — `isClientUser` stays `false`. This means `event.locals.tenantUser` will be `null` (client users don't get tenantUser) but the endpoint only checks for `user` and `tenant`, both of which are present. The upload succeeds and the file lands under the tenant's MinIO namespace. The `taskId` ownership is verified (line 47-54), so the file is constrained to a task the client can see — but the client is uploading via an admin endpoint with no portal-access-flag check (`tasks` access flag is not verified here).

**Risk level:** Medium. File content is constrained to images with magic byte validation. The client cannot upload to a task they don't own. The missing check is the portal access flag verification.

**Fix:** Add portal access flag check or move the upload handler to a dedicated `/client/[tenant]/task-comments/upload` route that mirrors the admin one and enforces `isClientUser` + access flag.

---

#### #P2-2 | `src/lib/remotes/task-activities.remote.ts:26-42` | `getTaskActivities` inner SELECT has no tenantId filter on `taskActivity`

**Evidence:**
```ts
// task-activities.remote.ts:26-42
const activities = await db
    .select({ ... })
    .from(table.taskActivity)
    .innerJoin(table.user, eq(table.taskActivity.userId, table.user.id))
    .where(eq(table.taskActivity.taskId, taskId));  // no tenantId on taskActivity
```

**Risk:** The task is pre-verified to belong to the tenant (lines 14-23), so the `taskId` is already tenant-scoped. However `taskActivity.tenantId` exists as a column and is not used in the filter. This is the JOIN-to-task indirect scoping pattern — it is safe because `taskId` is itself tenant-validated — but it deviates from the multi-tenant skill's explicit requirement that both sides of a JOIN be tenant-filtered where applicable. If `taskId` handling ever changes, activities from another tenant with the same task ID would leak.

**Fix:** Add `eq(table.taskActivity.tenantId, event.locals.tenant.id)` to the WHERE clause alongside `taskId`.

---

#### #P2-3 | `src/lib/remotes/tasks.remote.ts:2461-2464` | `updateSubtask` final UPDATE is bare-ID after pre-check

**Evidence:**
```ts
// tasks.remote.ts:2461-2464
await db.update(table.subtask).set({
    ...(done !== undefined ? { done: done ? 1 : 0 } : {}),
    ...(title !== undefined ? { title } : {}),
    updatedAt: Date.now()
}).where(eq(table.subtask.id, subtaskId));  // bare ID, no tenantId
```

**Risk:** The subtask is pre-verified at lines 2450-2455 with `subtask.tenantId`. Same defense-in-depth pattern as P1-3/P1-4. No immediate exploit path.

**Fix:** `.where(and(eq(table.subtask.id, subtaskId), eq(table.subtask.tenantId, event.locals.tenant.id)))`.

---

## Patterns Observed

**Strengths:** The codebase demonstrates a disciplined "verify-then-act" pattern in every read and most writes. The `task` table's `tenantId` filter is present on all SELECTs. The three bulk operations (`bulkUpdateTaskStatus`, `bulkDeleteTasks`, `bulkDuplicateTasks`) correctly implement the whitelist pre-fetch pattern — user-supplied IDs are intersected with a tenant-scoped query before any DML runs. The `createTaskComment`, `getCommentAttachmentUrl`, `getAttachmentUrl`, and `toggleReaction` functions all properly join through the `task` table to verify tenant ownership of `taskComment` rows (which have no direct `tenantId` column). The `authorizeSecondaryEmailAccess` helper cleanly enforces that client users can only operate on their own client record.

**Weaknesses:** A systemic pattern of bare-ID final DML statements exists across tasks, subtasks, task comments, and secondary emails — 5 instances in total (P1-3, P1-4, P2-3). These are all currently protected by pre-checks but violate defense-in-depth. The client portal boundary has a partial gap: `scheduleMeet`, `toggleSubtask`, `addSubtask`, and `deleteSubtask` are callable from the client portal via shared remote functions but lack `isClientUser` guards (P1-1, P1-2). The upload endpoint cross-usage (P2-1) is an architectural gap that should be resolved by route duplication rather than a flag check in the shared handler.

---

## Files Audited

- `src/lib/server/db/schema.ts` (task-related tables: lines 284–577)
- `src/lib/remotes/tasks.remote.ts` (2646 lines, 30 exported functions)
- `src/lib/remotes/task-comments.remote.ts` (625 lines, 7 exported functions)
- `src/lib/remotes/task-activities.remote.ts` (56 lines, 1 exported function)
- `src/lib/remotes/task-materials.remote.ts` (235 lines, 4 exported functions)
- `src/lib/remotes/client-secondary-emails.remote.ts` (222 lines, 4 exported functions)
- `src/lib/remotes/users.remote.ts` (339 lines, 9 exported functions)
- `src/routes/[tenant]/task-comments/upload/+server.ts`
- `src/lib/server/task-activity.ts`
- `src/lib/server/portal-access.ts`
- `src/lib/server/team-access.ts`
- `src/hooks.server.ts` (middleware, tenant/client resolution)
- `src/lib/components/client-task/client-task-comments.svelte` (upload path)
- `src/lib/components/client-task/client-task-progress-card.svelte` (subtask mutations)
- `src/lib/components/client-task/client-task-meet-modal.svelte` (scheduleMeet)

---

## Statistics

- Total functions audited: 56
- P0 findings: 0
- P1 findings: 4
- P2 findings: 3
