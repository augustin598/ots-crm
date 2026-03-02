# Tasks Audit — Sprint 2 Changelog (2026-03-02)

## Overview
Sprint 2 addressed all 6 remaining items from the Sprint 1 audit (`AUDIT-TASKS-SPRINT1.md` TODO section): cascade delete, activity trail, toast notifications, pagination, comment editing UI, and keyboard accessibility.

---

## 1. Schema: Cascade Delete + Activity Trail Table

**Files changed**:
- `app/src/lib/server/db/schema.ts`
- `app/drizzle/0052_whole_mulholland_black.sql` (generated migration)

**Changes**:
- Added `{ onDelete: 'cascade' }` to `taskComment.taskId` FK — deleting a task now cascades to its comments (matching `taskWatcher` pattern)
- Created new `taskActivity` table:
  - `id` (text PK), `taskId` (FK cascade), `userId` (FK), `tenantId` (FK)
  - `action` (text: created/updated/status_changed/assigned/commented/approved/rejected)
  - `field` (nullable), `oldValue` (nullable), `newValue` (nullable)
  - `createdAt` (timestamp)
- Added `taskActivityRelations` (one-to-one: task, user, tenant)
- Added `activities: many(taskActivity)` to `taskRelations`
- Exported types: `TaskActivity`, `NewTaskActivity`

---

## 2. Activity Trail Backend

**New files**:
- `app/src/lib/server/task-activity.ts` — `recordTaskActivity()` shared helper
- `app/src/lib/remotes/task-activities.remote.ts` — `getTaskActivities(taskId)` query (joins user for name)

**Instrumented remotes**:
- `tasks.remote.ts`:
  - `createTask` → action: 'created'
  - `updateTask` → field-level change detection (status_changed, assigned, updated per field)
  - `updateTaskPosition` → action: 'status_changed' when status differs
  - `approveTask` → action: 'approved' (old=pending-approval, new=approved status)
  - `rejectTask` → action: 'rejected' (old=pending-approval, new=cancelled)
- `task-comments.remote.ts`:
  - `createTaskComment` → action: 'commented'

**Note**: `deleteTask` not instrumented — cascade would delete the activity with the task.

---

## 3. Toast Notifications

**Pattern**: `import { toast } from 'svelte-sonner'` — already installed (v1.0.7).

**Files changed** (13 `alert()` → `toast.error()`, added `toast.success()` for success):
- `task-kanban-board.svelte` (1 alert)
- `task-detail-dialog.svelte` (3 alerts)
- `[tenant]/tasks/+page.svelte` (1 alert)
- `[tenant]/tasks/[taskId]/+page.svelte` (5 alerts)
- `[tenant]/tasks/[taskId]/documents/+page.svelte` (2 alerts)
- `client/[tenant]/(app)/tasks/[taskId]/+page.svelte` (1 alert)

**Also**: Added `<Toaster />` to client layout (`client/[tenant]/(app)/+layout.svelte`) — was missing.

---

## 4. Pagination

**Pattern**: Client-side with `$state` currentPage/pageSize, `$derived` paginatedTasks slice.

**Files changed**:
- `[tenant]/tasks/+page.svelte` — TABLE view only (Kanban keeps all tasks for column grouping). Page size selector (10/25/50). `$effect` resets page on filter change.
- `client/[tenant]/(app)/tasks/+page.svelte` — Card list, 25/page default. Prev/Next with page info.

---

## 5. Comment Editing UI

**Backend existed**: `updateTaskComment` + `deleteTaskComment` in `task-comments.remote.ts`.

**Files changed**:
- `task-detail-dialog.svelte`:
  - Added `currentUserId` prop
  - Inline edit mode: Textarea + Save/Cancel buttons per own comment
  - Edit (Pencil icon) + Delete (Trash2 icon) buttons visible only for own comments
  - "(edited)" indicator when `updatedAt > createdAt + 1s`
- `[tenant]/tasks/+page.svelte` — passes `currentUserId` to TaskDetailDialog
- `[tenant]/tasks/[taskId]/+page.svelte` — edit/delete buttons, inline textarea editing, "(edited)" indicator
- `client/[tenant]/(app)/tasks/[taskId]/+page.svelte` — full edit/delete functionality for own comments

---

## 6. Keyboard Accessibility on Kanban

**File**: `task-kanban-board.svelte`

**Changes**:
- Cards: `tabindex={0}`, `role="button"`, `aria-roledescription="Draggable task"`, `aria-label` (title + status + position), `data-task-id`
- Columns: `role="region"`, `aria-label="{status} column, {count} tasks"`
- Space/Enter: toggle "picked up" state (visual ring + bg highlight)
- Arrow Left/Right: move task to adjacent column (status change)
- Arrow Up/Down: reorder within column (position change)
- Escape: cancel move
- ARIA live region (`role="status"`, `aria-live="assertive"`) for screen reader announcements
- Extracted shared `moveTask()` function reused by both drag-and-drop and keyboard
- Re-focuses card after DOM update via `tick()` + `document.querySelector`

---

## 7. Activity Trail UI

**Files changed**:
- `task-detail-dialog.svelte`:
  - Added Activity section below Comments with Separator
  - Shows activities count, scrollable list (max 300px)
  - Each entry: user initials avatar, human-readable action, relative timestamp
- `[tenant]/tasks/[taskId]/+page.svelte`:
  - Added Activity card (md:col-span-2) below Comments card
  - Same display pattern: initials + action description + timeAgo

**Helpers** (in both files):
- `formatActivityDescription()` — maps action types to human-readable strings
- `timeAgo()` — relative timestamp (just now, Xm ago, Xh ago, Xd ago, or date)
- `getInitials()` — extracts initials from user name

---

## Migration
- Migration: `0052_whole_mulholland_black.sql`
- Applied to: `app/local-ots.db`

## Files Summary
| File | Changes |
|------|---------|
| `schema.ts` | cascade delete + taskActivity table |
| `0052_whole_mulholland_black.sql` | migration |
| `task-activity.ts` | NEW — recordTaskActivity helper |
| `task-activities.remote.ts` | NEW — getTaskActivities query |
| `tasks.remote.ts` | activity recording in 5 commands |
| `task-comments.remote.ts` | activity recording in createTaskComment |
| `task-detail-dialog.svelte` | comments editing, activity UI, toast |
| `task-kanban-board.svelte` | keyboard accessibility, toast |
| `[tenant]/tasks/+page.svelte` | pagination, currentUserId, toast |
| `[tenant]/tasks/[taskId]/+page.svelte` | comment editing, activity UI, toast |
| `[tenant]/tasks/[taskId]/documents/+page.svelte` | toast |
| `client/(app)/+layout.svelte` | Toaster component |
| `client/(app)/tasks/+page.svelte` | pagination |
| `client/(app)/tasks/[taskId]/+page.svelte` | comment editing, toast |
