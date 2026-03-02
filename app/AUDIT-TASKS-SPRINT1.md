# Audit Tasks Module — Sprint 1 (2026-03-02)

## Rezumat
Audit complet al modulului `/tasks`. S-au rezolvat 6 bug-uri critice, 5 inconsistente logice, si s-a consolidat codul duplicat din 5+ fisiere intr-o singura sursa de adevar.

---

## Bug-uri Rezolvate

### BUG 1: `window.location.reload()` dupa approve/reject
**Fisier**: `task-detail-dialog.svelte`
**Problema**: Dupa approve/reject, se facea hard page reload, cauzand flash complet al paginii si pierderea starii.
**Fix**: Inlocuit cu `.updates(getTasks(...), getTask(...))` — pattern consistent cu restul app-ului.

### BUG 2: Statusuri lipsa in edit-task-dialog
**Fisier**: `edit-task-dialog.svelte`
**Problema**: Dropdown-ul status nu avea `pending-approval` si `cancelled`. Un task in `pending-approval` arata "Select status".
**Fix**: Adaugat toate 6 statusurile in SelectTrigger + SelectContent.

### BUG 3: Butoane approve/reject lipsa pe pagina detail
**Fisier**: `[tenant]/tasks/[taskId]/+page.svelte`
**Problema**: Pagina full-page de task detail NU avea butoane Approve/Reject pentru task-uri `pending-approval`.
**Fix**: Adaugat butoane Approve/Reject in header cand `task.status === 'pending-approval'`.

### BUG 4: Milestone effect reseteaza pe initial render
**Fisier**: `edit-task-dialog.svelte`
**Problema**: Effect-ul `$effect()` curata milestoneId si la load initial, nu doar la schimbarea proiectului.
**Fix**: Adaugat `previousProjectId` tracking (pattern din create-task-dialog).

### BUG 5: Comentariile client nu arata numele autorului
**Fisier**: `client/[tenant]/(app)/tasks/[taskId]/+page.svelte`
**Problema**: Comentariile aratau doar icon User + data, fara numele autorului.
**Fix**: Adaugat `getTenantUsers()` query + `userMap` pentru a afisa numele utilizatorilor.

### BUG 6: Camp client lipsa in edit-task-dialog
**Fisier**: `edit-task-dialog.svelte`
**Problema**: Create dialog avea combobox client, dar edit dialog nu. Clientul nu putea fi schimbat dupa creare.
**Fix**: Adaugat combobox client cu `clientOptions` (identic cu create dialog).

---

## Inconsistente Logice Rezolvate

### LOGIC 1: Functii utilitare duplicate in 5+ fisiere
**Afectat**: `task-kanban-utils.ts`, `task-filters.ts`, `task-kanban-board.svelte`, `[taskId]/+page.svelte`, `client/.../[taskId]/+page.svelte`, `client/.../tasks/+page.svelte`
**Problema**: `formatStatus()`, `getPriorityColor()`, `getStatusColor()`, `formatDate()` definite independent in fiecare fisier, cu variante inconsistente (unele cu dark mode, altele fara).
**Fix**: Consolidat totul in `task-kanban-utils.ts` ca sursa unica de adevar. `task-filters.ts` face re-export. Stersa codul duplicat din toate celelalte fisiere.

### LOGIC 2: Status display inconsistent
**Problema**: Admin detail arata raw "in-progress", client list folosea `.replace('-', ' ')`, dialog folosea `formatStatus()`.
**Fix**: Folosit `formatStatus()` consistent peste tot.

### LOGIC 3: Date formatting inconsistent
**Problema**: Unele locuri foloseau `toLocaleDateString()` fara locale, altele cu `ro-RO`.
**Fix**: Adaugat functia centralizata `formatDate()` in `task-kanban-utils.ts` cu locale `ro-RO` si doua stiluri (short/long).

### LOGIC 4: Lipsa validare enum pentru status/priority
**Fisier**: `tasks.remote.ts`
**Problema**: Schema valibot accepta orice string pentru status si priority.
**Fix**: Inlocuit `v.optional(v.string())` cu `v.optional(v.picklist([...]))` pentru status si priority. Aplicat si pe `updateTaskPosition` si `approveTask`.

### LOGIC 5: Buton Delete pe comentariile altora
**Fisier**: `[tenant]/tasks/[taskId]/+page.svelte`
**Problema**: Butonul Delete era vizibil pe TOATE comentariile, nu doar pe ale utilizatorului curent.
**Fix**: Adaugat verificare `comment.userId === currentUserId` (via `page.data.tenantUser.userId`).

---

## Imbunatatiri Design

### Adaugat `pending-approval` in full-page edit
**Fisier**: `[tenant]/tasks/[taskId]/edit/+page.svelte`
Dropdown-ul status avea `cancelled` dar nu `pending-approval`. Adaugat.

### EditTaskDialog onSuccess in task-detail-dialog
**Fisier**: `task-detail-dialog.svelte`
`EditTaskDialog` nu avea `onSuccess` callback — dupa edit din dialog, detaliile nu se refreshuiau.

---

## Fisiere Modificate

| # | Fisier | Schimbari |
|---|--------|-----------|
| 1 | `src/lib/components/task-kanban-utils.ts` | +`formatPriority`, `formatDate`, `TASK_STATUSES`, `TASK_PRIORITIES`, type aliases |
| 2 | `src/lib/utils/task-filters.ts` | Re-export din task-kanban-utils in loc de duplicate |
| 3 | `src/lib/components/task-kanban-board.svelte` | Stersa `getPriorityColor` duplicata, import din utils |
| 4 | `src/lib/components/task-detail-dialog.svelte` | Fix reload, fix date, adaugat EditTaskDialog onSuccess |
| 5 | `src/lib/components/edit-task-dialog.svelte` | +statusuri, fix milestone effect, +client combobox |
| 6 | `routes/[tenant]/tasks/[taskId]/edit/+page.svelte` | +pending-approval in dropdown |
| 7 | `routes/[tenant]/tasks/[taskId]/+page.svelte` | +approve/reject btns, fix status/date/comments |
| 8 | `routes/client/[tenant]/(app)/tasks/[taskId]/+page.svelte` | +user names, remove duplicates |
| 9 | `routes/client/[tenant]/(app)/tasks/+page.svelte` | Remove duplicates, fix status display |
| 10 | `src/lib/remotes/tasks.remote.ts` | +picklist validation status/priority |

---

## TODO Sprint 2
- Paginare task list (getTasks returneaza TOATE task-urile)
- Toast notifications in loc de alert()
- Comment editing UI (backend suporta updateTaskComment, UI nu)
- Keyboard accessibility pe Kanban drag-and-drop
- Task activity/audit trail (cine a schimbat ce si cand)
- Cascade delete pe taskComment (lipsa in schema)
