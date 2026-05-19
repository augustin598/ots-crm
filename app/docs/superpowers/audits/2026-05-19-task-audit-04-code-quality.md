# Code Quality + Tests + Regressions Audit — Task Module

**Date:** 2026-05-19
**Auditor:** Code Reviewer subagent
**Branch:** claude/practical-kilby-15341a

---

## Executive Summary

18 new client portal components shipped cleanly with no direct admin regression. However, three real bugs were found across the client surface: a **P0 assignee field name mismatch** that breaks the meet modal and Svelte's keyed-list reconciliation, a **P0 upload route 404** (task-materials upload is called but the route does not exist), and a **P1 presigned URL stale-cache** that causes images to 403 after 5 minutes. Admin components were not modified and remain stable; the shared remotes `getTaskComments`, `toggleReaction`, `getTask`, `getTaskMaterials` all retain correct tenant isolation for admin users.

On the test side, `toggleReaction`, `toggleSubtask`, `scheduleMeet`, `createTask`, `updateTask`, `deleteTask`, `getTaskComments`, and `getTaskMaterials` have zero unit tests despite being production-critical paths.

---

## Findings — Code Quality

### P0 — Real bug

**#CQ-P0-1** | `src/lib/remotes/tasks.remote.ts:203-213` + `src/lib/components/client-task/client-task-rail.svelte:11-18` + `src/lib/components/client-task/client-task-detail-body.svelte:135`
**Title: Assignee shape mismatch — `.id` vs `.userId`**

- **Evidence:** `getTask` returns assignees with field `userId` (not `id`). `ClientTaskRail`'s `Assignee` type declares `id: string`. `client-task-team-card.svelte` keys its `#each` loop on `a.id` and calls `onRemove(a.id)`. `client-task-detail-body.svelte:135` maps `(a: any) => a.id` for `defaultInviteeIds`.
- **Impact:** Three compounding failures: (1) Svelte's `{#each assignees as a (a.id)}` gets `undefined` as every key — all items collapse to the same DOM node. (2) `defaultInviteeIds` passed to the meet modal is `[undefined, undefined, ...]` — no invitees are pre-selected. (3) `onRemove(a.id)` passes `undefined` to any removal callback. The admin side correctly uses `assignee.userId` (`task-detail-body.svelte:808,831`).
- **Fix:** Either (a) map the server response in `getTask` to rename `userId` → `id` before returning, or (b) update all client components to use `a.userId`. Option (a) keeps the admin side untouched. Add the mapping in `getTask`'s return: `assignees: assigneeRows.map(r => ({ id: r.userId, ...r }))`.

---

**#CQ-P0-2** | `src/lib/components/client-task/client-task-materials-card.svelte:106`
**Title: Upload route 404 — `/[tenant]/task-materials/upload` does not exist**

- **Evidence:** `client-task-materials-card.svelte` POSTs to `` `/${tenant}/task-materials/upload` ``. A search of all `+server.ts` files confirms this route does not exist anywhere in `src/routes`. The only task upload routes are `[tenant]/task-comments/upload` and `[tenant]/marketing-materials/upload`.
- **Impact:** Every file drag-drop or click-upload in the client portal's materials card returns a network error. The upload feature is completely broken for client users.
- **Fix:** Either (a) create a `src/routes/[tenant]/task-materials/upload/+server.ts` that links a file to a `marketingMaterial` row and creates the `taskMarketingMaterial` join, or (b) reuse the existing `marketing-materials/upload` route and add the task-link step. The route must also check `isClientUser && task.clientId !== client.id`.

---

### P1 — Likely bug or fragile code

**#CQ-P1-1** | `src/lib/components/client-task/client-task-comments.svelte:59,177-182`
**Title: Presigned URL cache never expires — stale images 403 after 5 minutes**

- **Evidence:** `loadAttachmentUrl` stores URLs in `attachmentUrls` (a plain `$state` record) with no TTL. `getAttachmentUrl` calls `storage.getDownloadUrl(path, 300)` — 300-second TTL. After 5 minutes, cached URLs become invalid, causing broken images in a long-running session.
- **Impact:** A client user who opens a task with images and leaves the tab open will see broken images (403) after 5 minutes without a page reload. No error is shown (the `{:catch}` block shows "Eroare la încărcare" but the happy path just shows a broken image).
- **Fix:** Store `{ url, fetchedAt }` and re-fetch when `Date.now() - fetchedAt > 240_000`. Alternatively, increase the MinIO presign TTL to 3600 s (matching the default in `storage.ts`) and cap cache entries at 50 min.

---

**#CQ-P1-2** | `src/lib/remotes/task-comments.remote.ts:77-93`
**Title: `getTaskComments` has no client ownership check**

- **Evidence:** The remote verifies `task.tenantId === tenant.id` but never checks `isClientUser && task.clientId !== client.id`. All write operations (`createTaskComment`, `updateTaskComment`, `deleteTaskComment`) do perform this check (lines 206, 438, 488). The read path is unguarded.
- **Impact:** A client user at company A can call `getTaskComments(taskId)` for a task belonging to company B within the same tenant, as long as they know the task ID. It's not an authentication bypass (both are within the same tenant), but it leaks comment content across client companies.
- **Fix:** Add the guard after the task lookup in `getTaskComments`: `if (event.locals.isClientUser && task.clientId !== event.locals.client?.id) throw new Error('Task not found');`

---

**#CQ-P1-3** | `src/routes/client/[tenant]/(app)/tasks/[taskId]/+page.svelte:9`
**Title: `page.data as any` cast erases type safety for clientUser**

- **Evidence:** `const currentUserId = $derived(((page.data as any)?.clientUser?.userId as string) ?? '');`. The layout server loads the clientUser; the `+page.svelte` should import `LayoutData` and use `page.data.clientUser`.
- **Impact:** If the layout data shape changes (e.g., the field is renamed), TypeScript silently misses it. Also `currentUserId` is passed as a prop but `ClientTaskDetailBody` does not use it (it reconstructs user info from the task). Dead prop + unsafe cast.
- **Fix:** Delete `currentUserId` (it's unused in `ClientTaskDetailBody`) or add a proper `PageData` import.

---

**#CQ-P1-4** | `src/routes/client/[tenant]/(app)/team/+page.svelte:32-37` + `src/lib/components/client-team/client-team-invite-modal.svelte:41-78`
**Title: Role ID mismatch between team page and invite modal**

- **Evidence:** The team page defines `ROLE_DEFS` with IDs `owner | admin | member | viewer`. The invite modal's `ROLE_FLAGS` only covers `admin | member | viewer` — `owner` is missing. When a user invites someone with role `owner`, `ROLE_FLAGS['owner']` is `undefined`, the access flags step is silently skipped (line 100-101), and the new user gets no access permissions applied. Note: `CLIENT_ROLE_PRESETS` in `team.ts` uses a completely different ID set (`owner | manager | marketing | viewer`) — neither matches the team page.
- **Impact:** Inviting an `owner` creates the secondary email record but never applies access flags. Silent failure with no user-visible error.
- **Fix:** Add `owner` to `ROLE_FLAGS` in the invite modal with full-access flags (matching `ALL_ACCESS_TRUE` from `team.ts`). Then consolidate — import `CLIENT_ROLE_PRESETS` from `$lib/config/team` and derive the role list from it rather than maintaining a third independent definition.

---

**#CQ-P1-5** | `src/lib/components/client-task/client-task-materials-card.svelte:220-227`
**Title: "Mai mult" (MoreVertical) button is a visible no-op**

- **Evidence:** The button has `title="Mai mult"` and renders `MoreVerticalIcon` but has no `onclick` handler and no `aria-disabled`. Clicking it does nothing.
- **Impact:** Users see a menu affordance that doesn't work. Accessible users will find a focusable button that does nothing.
- **Fix:** Either wire up a contextual action (delete, rename) or remove the button until the feature is built.

---

### P2 — Maintainability issue

**#CQ-P2-1** | `src/lib/components/client-task/client-task-comments.svelte:20`, `src/lib/remotes/task-comments.remote.ts:8`, `src/lib/components/task-detail/task-comment-thread.svelte:11`
**Title: `VALID_EMOJIS` defined three times**

- **Evidence:** The same `['👍', '🔥', '🎉'] as const` array is defined independently in the remote and both comment UIs.
- **Fix:** Export `VALID_EMOJIS` from `task-comments.remote.ts` (or a shared `$lib/constants/tasks.ts`) and import in the components.

---

**#CQ-P2-2** | Multiple files
**Title: `fmtDate` / `fmtAgo` defined in 4 separate components**

- **Evidence:** `client-task-comments.svelte:185`, `client-task-materials-card.svelte:87`, `client-task-meta-card.svelte:16`, `client-task-activity-card.svelte:12` each implement their own local date formatter with slightly different options. `task-kanban-utils.ts` has a `formatDate` function with the same logic.
- **Fix:** Move the Romanian locale date format utility into `task-kanban-utils.ts` (already a shared module) as `fmtShortDate` and `fmtLongDate`, import in all four components.

---

**#CQ-P2-3** | `src/lib/components/task-detail/task-detail-body.svelte`
**Title: 1484-line god component**

- **Evidence:** `task-detail-body.svelte` is 1484 LOC for a single Svelte component. It handles task creation, status/priority updates, subtask CRUD, assignee management, tag management, meet scheduling, materials, watcher state, activity feed, and comment thread — all in one file.
- **Fix:** Extract into domain-scoped sub-components as was done for the client side (which correctly split into 12 focused files). Priority sections to extract: subtask panel, assignee panel, tag management panel.

---

**#CQ-P2-4** | `src/lib/components/client-task/client-task-detail-body.svelte:15-19`
**Title: `any[]` used for `subtasks`, `tags`, `assignees` on `TaskWithIncludes`**

- **Evidence:**
  ```ts
  type TaskWithIncludes = Task & {
    subtasks?: any[];
    tags?: any[];
    assignees?: any[];
  };
  ```
  These fields have well-known shapes returned by `getTask`.
- **Fix:** Import or inline the concrete types: `Subtask` from schema, `{ id: string; name: string; color: string }` for tags, `{ userId: string; role: string; firstName: string | null; lastName: string | null; email: string | null }` for assignees.

---

### P3 — Nitpick

**#CQ-P3-1** | `src/lib/components/client-task/client-task-activity-card.svelte:25`
**Title: `describe(a: any)` — untyped activity parameter**

The `describe` function accepts `any`. The `getTaskActivities` remote returns a well-typed array. Use `typeof activities[number]` or extract the type.

**#CQ-P3-2** | `src/routes/client/[tenant]/(app)/team/+page.svelte:51,99,100`
**Title: `s: any` and `t: any` in derived arrays**

`secondaries.map((s: any) => ...)` and `tasks.filter((t: any) => ...)` should be properly typed once `getClientSecondaryEmails` and `getTasks` return typed arrays.

**#CQ-P3-3** | `src/lib/components/client-task/client-task-lightbox.svelte:32-48`
**Title: `$effect` adds `keydown` listener on `window` — correct cleanup but no SSR guard**

The effect runs during SSR if `open` is true. Add `if (typeof window === 'undefined') return;` as the first line.

---

## Findings — Test Coverage Gaps

### P0 — Critical path untested

**#TC-P0-1** `toggleReaction` — no test. A client user can toggle reactions on any task comment in the tenant. No test verifies the toggle logic (add then remove), the emoji whitelist enforcement, or the tenant isolation of the reaction insert.

**#TC-P0-2** `getTaskComments` — no test. There is no test for the read path, for the reactions aggregation shape, or for the missing client ownership guard (see CQ-P1-2).

### P1 — Important untested

**#TC-P1-1** `createTask` — no test. Creates a task including the `isRecurring` validation logic, client ownership assignment, and `pending-approval` status enforcement for client users.

**#TC-P1-2** `toggleSubtask` / `addSubtask` / `deleteSubtask` — no tests for any subtask mutation.

**#TC-P1-3** `scheduleMeet` — no test. Validates datetime string format and tenant ownership.

**#TC-P1-4** `approveTask` / `rejectTask` — no tests for the approval workflow, which changes status and fires client email notifications.

**#TC-P1-5** `watchTask` / `unwatchTask` — no tests.

**#TC-P1-6** `getTaskMaterials` / `task-materials.remote.ts` — no tests at all. The entire materials module (linking, unlinking, upload) is untested.

### P2 — Nice to have

**#TC-P2-1** No test for a client user attempting to read a task belonging to a different client within the same tenant via `getTask`. The current remote only checks `tenantId`, not `clientId`, for the read path (consistent with how the admin uses it, but inconsistent with write paths).

**#TC-P2-2** No cross-tenant test for `getTaskComments`, `getTaskActivities`.

---

## Findings — Regressions / Inter-layer Inconsistencies

### P0 — Admin actually broken

None found. The admin components were not modified and continue to work against the same remotes. `task-detail-body.svelte` correctly uses `assignee.userId` for its keyed loop and remove callbacks.

### P1 — Subtle inconsistency that could become a bug

**#RG-P1-1** | `src/lib/remotes/task-comments.remote.ts:104-106`
**Title: `authorName` field semantics differ between admin and client consumers**

- The remote select aliases `table.user.firstName` as `authorName` (line 105) and `table.user.lastName` as `authorLastName` (line 106). The final `map` (line 160) overwrites `authorName` with the full name: `` `${c.authorName || ''} ${c.authorLastName || ''}`.trim() ``.
- Admin's `task-comment-thread.svelte` uses only `comment.authorName` (the merged full name) and does not access `authorLastName`. Client's `client-task-comments.svelte` accesses both `c.authorName` and `c.authorLastName` (lines 263-266) via its `lastNameOf` helper.
- After the `map`, `authorLastName` is **not** in the returned object — it is an intermediate select alias consumed during the map. The client component's `lastNameOf(c.authorName, c.authorLastName)` will always receive `undefined` for `authorLastName`. This means avatar initials for comments fall back to parsing the full name string, which works but indicates the component misunderstands the returned shape.
- **Risk:** Low severity now (fallback parsing works), but the component's type assumption is wrong.

**#RG-P1-2** | `src/lib/components/client-task/client-task-comments.svelte:74`
**Title: Comment image upload hits the admin-side route**

- `client-task-comments.svelte` builds the upload URL as `` `/${tenantSlug}/task-comments/upload` `` where `tenantSlug = page.params.tenant`. From `/client/ots/tasks/[id]`, this becomes `/ots/task-comments/upload` — the **admin** route under `[tenant]/task-comments/upload`.
- The admin upload route (`+server.ts:34`) checks `event.locals.user && event.locals.tenant`. Client users have `locals.user` set (set by the auth hook), so the 401 guard passes. However, the route does not check `isClientUser` or validate that the task's `clientId` matches `client.id`. A client user can upload an attachment to any task in the tenant regardless of client ownership.
- The route otherwise works (uploads succeed), so this is a functional regression concern (access control), not a 404.

### P2 — Smell

**#RG-P2-1** The `MoreVertical` button in `client-task-materials-card.svelte` renders but does nothing (CQ-P1-5). The admin materials panel (`task-detail-body.svelte`) has full delete/unlink functionality. Client portal materials are currently view-only + upload-only with no management UX.

**#RG-P2-2** The team page `ROLE_DEFS` is a third independent role definition for client portal roles (distinct from `ADMIN_ROLES` and `CLIENT_ROLE_PRESETS` in `team.ts`). No canonical source of truth for client roles exists.

---

## TypeScript Safety Metrics

| Metric | Count | Files |
|---|---|---|
| `: any` or `any[]` in new client components | 8 | `client-task-detail-body.svelte` (6), `client-task-activity-card.svelte` (1), `team/+page.svelte` (2) |
| `as any` in new client components | 3 | `client-task-detail-body.svelte` (3) |
| `// @ts-ignore` | 0 | — |

Total `any` uses in new components: **11**. None are necessary — concrete types are available from schema and remotes.

---

## Duplication Hot Spots

| Pattern | Locations | Notes |
|---|---|---|
| `fmtDate` / `fmtAgo` date formatter | 4 client components + `task-kanban-utils.ts` | Extract to `task-kanban-utils.ts` |
| `VALID_EMOJIS = ['👍', '🔥', '🎉']` | `task-comments.remote.ts`, `client-task-comments.svelte`, `task-comment-thread.svelte` | Export from remote |
| `AccessFlags` type | `client-team-invite-modal.svelte` (local), `team.ts` (exported) | Import from `team.ts` |
| `ROLE_FLAGS` access map | `client-team-invite-modal.svelte` (hardcoded) | Derive from `CLIENT_ROLE_PRESETS` in `team.ts` |
| `displayName(person)` helper | `client-task-meet-modal.svelte`, `client-task-team-card.svelte` | Same 3-line function, extractable |

---

## Statistics

- **LOC audited:** ~7,200 (2,416 new client components + 2,403 admin components + ~900 remotes + ~700 shared deps + ~573 tests + ~250 routes)
- **P0 findings:** 2 (assignee shape mismatch, upload 404)
- **P1 findings:** 5 (stale URL cache, client comment read isolation, unsafe any cast, role flag gap, dead button)
- **P2 findings:** 4 (VALID_EMOJIS, date formatters, god component, untyped includes)
- **P3 findings:** 3 (minor any casts, SSR guard)
- **Test coverage gaps — P0:** 2 | **P1:** 6 | **P2:** 2
- **Regression findings — P1:** 2 | **P2:** 2
- **Files with findings:** 11
