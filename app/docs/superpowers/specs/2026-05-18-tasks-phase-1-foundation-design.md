# Tasks Redesign — Faza 1: Foundation (Schema + Side-Panel Infra)

**Status:** SPEC v1 (pending Augustin GO)
**Date:** 2026-05-18
**Parent plan:** `docs/tasks-redesign-plan.md` (v1.1)
**Scope:** Faza 1/5 din strategia C+ Hybrid
**Effort:** 3-4 zile dev
**Decisions locked:** Q1=a (`blocked` add separat), BS2=a (keep approval flow), BS3=a (multi-assignee coexistență), BS5=a (all tenant users inline edit)

---

## 1. Goal

Foundation layer pentru tot redesign-ul Tasks. La finalul Fazei 1:
- Schema additive cu 4 migrations live (zero breaking change)
- Side-panel detail funcțional cu URL sync `?taskId=XYZ` pe admin tasks list
- Mobile fallback la full-page route pe viewport `< 768px`
- Tenant scoping verified pe noile tables
- Existing Kanban + Table rămân operaționale identic (nimic vechi nu se rupe)

**NU în scope Faza 1:**
- NewTaskModal wizard 3 steps (Faza 2)
- Vizual redesign admin/client list (Faza 2-4)
- Calendar/Team views (Faza 5)
- Google Meet, reactions (Faza 3)

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ Admin /[tenant]/tasks/+page.svelte                              │
│ ├─ Kanban view (unchanged visual, click → side-panel)          │
│ ├─ Table view (unchanged, click → side-panel)                  │
│ └─ <TaskDetailPanel taskId={$panelTaskId} on:close />          │
│                                                                  │
│ URL state:                                                      │
│ ?view=kanban&status=todo,in-progress&taskId=tsk_abc123          │
│                          └─ nuqs-svelte param NEW               │
│                                                                  │
│ Mobile (< 768px):                                                │
│ Click task → goto(`/${tenantSlug}/tasks/${taskId}`)             │
│ (existing full-page route, unchanged)                           │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ NEW: TaskDetailPanel component                                  │
│ Wraps shadcn-svelte Sheet (slide from right, 540px desktop,    │
│  full-screen on mobile fallback)                                │
│                                                                  │
│ Content = REUSE TaskDetailDialog body sections                  │
│  (no rewrite, just wrapped in Sheet instead of Dialog)         │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ Schema additive (4 migrations):                                 │
│ 1. ALTER task ADD COLUMN type TEXT                              │
│ 2. CREATE TABLE subtask (id, task_id, title, done, position,    │
│                          tenant_id, created_at, updated_at)     │
│ 3. CREATE TABLE task_tag (id, name, color, tenant_id, ...)      │
│    CREATE TABLE task_to_tag (task_id, tag_id, ...)              │
│ 4. CREATE TABLE task_assignee (task_id, user_id, role,          │
│                                tenant_id, created_at)           │
│    + backfill: INSERT all existing assignedToUserId rows        │
│                                                                  │
│ NOTE: `blocked` status nu necesită migration — VALID_STATUSES    │
│       enum este TypeScript-only check; doar update array.       │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Migrations Detail

### Migration 1 — `task.type` column

```sql
-- drizzle/00XX_task_add_type.sql (1 statement per file pentru Turso safety)
ALTER TABLE task ADD COLUMN type TEXT DEFAULT NULL;
```

**Schema.ts update:**
```ts
type: text('type'), // 'design' | 'video' | 'ads' | 'dev' | 'content' | 'meeting' | 'other' | null
```

**Constraint în code (NU în DB):** `VALID_TASK_TYPES = ['design','video','ads','dev','content','meeting','other'] as const`.

**Backward compat:** existing tasks au `type=null`. UI afișează "Tip nedefinit" sau gol.

### Migration 2 — `subtask` table

```sql
CREATE TABLE subtask (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  title TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_by_user_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

```sql
CREATE INDEX subtask_task_id_idx ON subtask(task_id);
```

```sql
CREATE INDEX subtask_tenant_id_idx ON subtask(tenant_id);
```

**Total: 3 statements = 3 separate migration files.**

### Migration 3 — `task_tag` + `task_to_tag`

```sql
CREATE TABLE task_tag (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT,
  created_at INTEGER NOT NULL
);
```

```sql
CREATE INDEX task_tag_tenant_id_idx ON task_tag(tenant_id);
```

```sql
CREATE UNIQUE INDEX task_tag_tenant_name_uniq ON task_tag(tenant_id, name);
```

```sql
CREATE TABLE task_to_tag (
  task_id TEXT NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES task_tag(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  PRIMARY KEY (task_id, tag_id)
);
```

```sql
CREATE INDEX task_to_tag_task_id_idx ON task_to_tag(task_id);
```

```sql
CREATE INDEX task_to_tag_tag_id_idx ON task_to_tag(tag_id);
```

**Total: 6 statements = 6 separate migration files.**

### Migration 4 — `task_assignee`

```sql
CREATE TABLE task_assignee (
  task_id TEXT NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  role TEXT DEFAULT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (task_id, user_id)
);
```

```sql
CREATE INDEX task_assignee_user_id_idx ON task_assignee(user_id);
```

```sql
CREATE INDEX task_assignee_tenant_id_idx ON task_assignee(tenant_id);
```

**Backfill data migration (SEPARATE script `scripts/backfill-task-assignee.ts`):**

```ts
// Idempotent: skip task-uri already populated
INSERT INTO task_assignee (task_id, user_id, tenant_id, role, created_at)
SELECT id, assigned_to_user_id, tenant_id, NULL, created_at
FROM task
WHERE assigned_to_user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM task_assignee
    WHERE task_assignee.task_id = task.id
      AND task_assignee.user_id = task.assigned_to_user_id
  );
```

**Total Migration 4: 3 DDL statements + 1 data backfill script.**

**TOTAL MIGRATIONS FAZA 1: 13 separate `.sql` files** (per `crm_db_migration_protocol` 1-statement-per-file). Plus 1 backfill script.

---

## 4. Code Changes

### 4.1 Schema (`src/lib/server/db/schema.ts`)

Add 4 new tables + 1 column. Drizzle definitions. Update existing `task` table to include `type` column. NO modification on `assignedToUserId` (legacy stays).

### 4.2 Remote (`src/lib/remotes/tasks.remote.ts`)

**Modificări minimale:**
- `getTask(id)` → JOIN cu `subtask`, `task_to_tag`+`task_tag`, `task_assignee` (with user lookup). Return shape extends current with `subtasks: Subtask[]`, `tags: Tag[]`, `assignees: User[]`.
- `getTasks(filters)` → optional include flags pentru tags/assignees (default false pentru list performance)
- Existing `assignedToUserId` continuă să funcționeze pentru queries vechi.

### 4.3 Side-Panel Component — NEW

**File:** `src/lib/components/task-detail-panel.svelte`

```svelte
<script lang="ts">
  import * as Sheet from '$lib/components/ui/sheet';
  import TaskDetailDialog from './task-detail-dialog.svelte';
  import { getTask } from '$lib/remotes/tasks.remote';

  let { taskId = $bindable<string | null>(null), onClose } = $props<{
    taskId: string | null;
    onClose: () => void;
  }>();

  const open = $derived(!!taskId);
  const taskQuery = $derived(taskId ? getTask(taskId) : null);
</script>

<Sheet.Root {open} onOpenChange={(o) => { if (!o) onClose(); }}>
  <Sheet.Content side="right" class="w-full sm:max-w-[540px] p-0 overflow-y-auto">
    {#if taskQuery?.current}
      <!-- Reuse the content body from existing TaskDetailDialog
           (not the Dialog wrapper itself — just the sections) -->
      <TaskDetailDialog
        task={taskQuery.current}
        mode="panel"
        onClose={onClose}
      />
    {/if}
  </Sheet.Content>
</Sheet.Root>
```

**Verify Sheet exists:** check `src/lib/components/ui/sheet/` — if missing, install via `bits-ui` + shadcn-svelte CLI sau create manually după pattern din dialog.

### 4.4 Admin Tasks List Integration

**File:** `src/routes/[tenant]/tasks/+page.svelte`

```ts
// Add nuqs param
const taskIdPanel = useQueryState('taskId', parseAsString);

// Add mobile detection
let isMobile = $state(false);
$effect(() => {
  const mql = window.matchMedia('(max-width: 767px)');
  isMobile = mql.matches;
  mql.addEventListener('change', (e) => isMobile = e.matches);
});

// Replace inline TaskDetailDialog with TaskDetailPanel
function openTask(taskId: string) {
  if (isMobile) {
    goto(`/${tenantSlug}/tasks/${taskId}`);
  } else {
    taskIdPanel.current = taskId;
  }
}

function closePanel() {
  taskIdPanel.current = null;
}
```

```svelte
<TaskDetailPanel taskId={taskIdPanel.current} onClose={closePanel} />
```

**Existing `TaskDetailDialog` rămâne pentru:**
- Backward compat dacă unele locuri îl deschid din alte pagini
- Reuse pe client portal Faza 3

### 4.5 TaskDetailDialog mode prop

**File:** `src/lib/components/task-detail-dialog.svelte`

Adăugăm prop `mode: 'dialog' | 'panel'`. Defaults la 'dialog' pentru backward compat. Când mode='panel':
- NU randa Dialog wrapper (e deja în Sheet)
- Reduce padding pentru side-panel context
- Header sticky în sus

---

## 5. Files Touched

| File | Action | LOC delta est. |
|---|---|---|
| `src/lib/server/db/schema.ts` | Add types | +60 |
| `drizzle/00XX_*.sql` (13 files) | Create | +30 |
| `scripts/backfill-task-assignee.ts` | New | +50 |
| `scripts/verify-recent-migrations.ts` | Append 13 entries | +25 |
| `src/lib/remotes/tasks.remote.ts` | Extend getTask + getTasks | +80 |
| `src/lib/components/task-detail-panel.svelte` | New | +60 |
| `src/lib/components/task-detail-dialog.svelte` | Add mode prop | +20 |
| `src/lib/components/ui/sheet/*` | Verify/install | TBD |
| `src/routes/[tenant]/tasks/+page.svelte` | Add panel + mobile fallback | +30 |
| `tests/tasks-faza-1.test.ts` | New integration tests | +120 |

**Total: ~10 files modified, 13 migrations, ~475 LOC delta.**

---

## 6. Testing Strategy

### 6.1 Migrations smoke test
- `bun run db:migrate` local
- `PRAGMA table_info(task)` confirm `type` column
- `PRAGMA table_info(subtask)` confirm structură
- `PRAGMA table_info(task_tag)` + `task_to_tag` + `task_assignee`
- `SELECT COUNT(*) FROM task_assignee` post-backfill == `SELECT COUNT(*) FROM task WHERE assigned_to_user_id IS NOT NULL`

### 6.2 Tenant isolation tests
- Create task în tenant A, assignee tenant A user
- Query from tenant B context → assert 0 results pe noile tables (subtask/tag/assignee)
- Cross-tenant leak = CRITICAL fail

### 6.3 Backward compat tests
- Existing kanban DnD: status change still works (no regression)
- Existing single-assignee display: `assignedToUserId` legacy field returns same value
- `getTasks()` cu și fără include flags returnează shape compatibil

### 6.4 Side-panel E2E
- Click task pe admin list → panel se deschide din dreapta (desktop)
- URL conține `?taskId=...`
- Refresh page → panel rămâne deschis cu același task
- Close panel → URL clears `taskId`
- Mobile viewport (set window 600px) → click navigates la `/[tenant]/tasks/[taskId]` full page

### 6.5 Build verification
- `bun run check` pass
- `bun run build` pass (catches .remote.ts export issues)

---

## 7. Definition of Done (Faza 1)

- [ ] 13 migrations live, PRAGMA verified
- [ ] Backfill script ran, `task_assignee` count == legacy
- [ ] Schema.ts has all 4 new tables + `type` column
- [ ] `getTask(id)` returns subtasks, tags, assignees
- [ ] Click task pe admin list deschide side-panel (desktop)
- [ ] URL persist `?taskId=...` cu nuqs
- [ ] Mobile (<768px) redirects la full page route
- [ ] Cross-tenant query test passes (no leak)
- [ ] Existing kanban + table + drag&drop work identic
- [ ] `bun run check` pass
- [ ] `bun run build` pass
- [ ] Deploy live + `verify-recent-migrations.ts` confirms drift = 0

---

## 8. Risks (Faza 1 specific)

| # | Risk | Mitigation |
|---|---|---|
| F1-R1 | Turso silent-fail pe oricare din 13 migrations | Protocol `crm_db_migration_protocol`, post-deploy `verify-recent-migrations.ts` cu idempotent fix |
| F1-R2 | Backfill task_assignee partial dacă tenanti mari | Script idempotent, batched 1000/tx, can rerun |
| F1-R3 | Sheet component missing din shadcn-svelte | Install via bits-ui (already in package.json) sau copy din shadcn registry |
| F1-R4 | nuqs param `?taskId=` conflict cu alt URL state | Audit existing URL params pe `/tasks` route — niciun conflict identificat în plan |
| F1-R5 | Existing TaskDetailDialog consumers (alte pagini) | `mode` prop default 'dialog' → zero regresie |

---

## 9. Implementation Order (atomic deployable PRs)

**Sub-PR 1 (1-2 zile):** Migrations + Schema + Backfill
- 13 migration files
- schema.ts update
- Backfill script
- Run local, verify, deploy
- **No UI change** — pure data layer
- Rollback: `DROP TABLE subtask, task_tag, task_to_tag, task_assignee; ALTER TABLE task DROP COLUMN type`

**Sub-PR 2 (1 zi):** Remote extensions
- `getTask` JOIN-uri
- `getTasks` include flags
- Tenant isolation tests
- **Backward compat** — old queries continue to work
- Rollback: revert single file

**Sub-PR 3 (1-2 zile):** Side-panel + URL sync + mobile fallback
- Sheet wrapper component
- TaskDetailDialog mode prop
- Admin list integration + nuqs param
- E2E test
- Rollback: revert 3 files; users see classic dialog

---

## 10. Open Items (NOT blocking Faza 1)

Aceste decizii pot rămâne open pe durata Fazei 1 — vor fi clarificate la lansarea Fazei 2:
- Wizard exact UX (Step 1 fields, validation per step) → Faza 2 brainstorm
- Task type list final (6 default vs admin-configurable) → Q5 TIER 2
- Subtask permissions client (interactive vs read-only) → BS9 TIER 2

---

## 11. Self-Review Checklist

- ✅ No "TBD" în scope sau DoD
- ✅ Internal consistency: 4 migrations described match schema.ts + remote changes
- ✅ Scope check: focused doar pe foundation, NU include UI redesign
- ✅ Ambiguity check: side-panel vs full-page rule clar (>=768px panel, <768px full)
- ✅ Rollback path documented per sub-PR
