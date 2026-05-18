# Tasks Page Redesign — Plan Complet

**Status:** DRAFT v1 (plan-mode, pending Augustin approval)
**Date:** 2026-05-18
**Surse:** Design package Anthropic `f6orClYdcrpMu-OEeAZarA` + Gemini second opinion + read-only gap analysis worker `w_mpaw8nkn_7`
**Locație gap analysis detaliat:** `/tmp/tasks-design-gap-analysis.md` (8 secțiuni)

---

## 0. TL;DR

Redesign Tasks page (admin + client portal) la **100% feature parity cu designul Anthropic** prin **strategia C+ Hybrid** (Detail-First, faseat, low-risk). **~13-16 zile dev** distribuite în 5 faze deployable independent. Schema additive (4 migrations totale, fără breaking changes). Păstrăm `nuqs-svelte` URL filter state, păstrăm full-page route pentru deep work, side-panel pentru quick edit.

**Top 3 surprize:**
1. **Current client detail e MAI bogat decât designul** (rich editor TipTap, threaded comments, lightbox, activities, approve/reject, reopen) — design adaugă DOAR: subtasks, team card, reactions, Google Meet modal. **NU regresăm pe ce funcționează.**
2. **Schema delta** = 4 fields lipsesc: `type`, `tags`, subtasks table, multi-assignee, `blocked` status, meet fields (4-5 migrations dacă alegem clean schema)
3. **NewTaskModal = 3-step wizard** (vs current single-form) — biggest single UI lift

**Top 3 risks:**
- Mobile UX side-panel — fallback la full-screen drawer pe `< 768px`
- Tenant isolation pe Calendar/Team aggregations — audit pe fiecare query nouă
- "Feature parity" pe Google Meet — REAL Google Calendar API (5+ zile) vs manual URL paste (1 zi)

---

## 1. Intent (din chat1.md — 1276 linii)

User a iterat în ~10 runde:
1. Start: redesign existing Tasks (era simple kanban+table)
2. Add Google Meet pe Calendar view
3. Inline status/priority edits pe Table
4. "Back to Tasks" header repositioning
5. 3-step NewTaskModal cu meeting mode
6. Client task detail page (right rail rich)
7. Image lightbox + reactions pe comments
8. Team/progress/materials right rail
9. "Programează Google Meet" modal cu participanți

**Must-haves explicit:**
- **Admin:** 4 view modes (Kanban/Table/Calendar/Team), Stats strip clickable, Filter pills popover, inline status/priority în table, side-panel detail, NewTaskModal wizard cu meeting mode
- **Client detail:** right rail (metadata + subtasks interactive + team + materials tabbed + activity), comments cu lightbox + reactions, header "Programează Google Meet"
- **Schema:** `type` (Design/Video/Ads/Dev/Content/Meeting), `tags[]`, subtasks, multiple assignees, `blocked` status, meet fields

**Design language:** dark sidebar, #1877F2 blue accent, Inter font, white cards on #f4f6fa (consistent cu Campanii Ads design).

---

## 2. Decizii Arhitecturale (locked)

### 2.1 Side-panel + URL hybrid (Gemini-recommended)

**Decision:** quick edit prin side-sheet 540px right cu URL sync `?taskId=XYZ` via `nuqs-svelte`. **PĂSTRĂM** full-page route `/[tenant]/tasks/[taskId]` pentru deep work (edit, /documents subroute, mobile).

**Rationale:**
- Bookmark + back button + deep-link rămân funcționale
- Mobile <768px fallback: panel devine full-screen drawer (alternativ redirect la full page)
- Existing `EditTaskDialog`, materials, activities — păstrate, doar reorganizate vizual

### 2.2 Schema additive (Gemini approach pe tags/subtasks)

| Field | Decision | Migration cost |
|---|---|---|
| `task.type TEXT` | Direct column, fixed enum `[design, video, ads, dev, content, meeting, other]` cu fallback `'other'` | 1 migration |
| Tags | **Join table** `task_tag` + `task_to_tag` (NU JSON — filter performance critic) | 2 migrations |
| Subtasks | Tabel separat `subtask(id, taskId, title, done, position, createdAt)` (Gemini rec) | 1 migration |
| Multiple assignees | Tabel `task_assignee(taskId, userId, role)` — păstrăm legacy `assignedToUserId` pentru backward compat | 1 migration |
| `blocked` status | Extindem `VALID_STATUSES` enum în code (no migration, doar CHECK constraint dacă există) | 0-1 |
| Meet fields | `meet_link TEXT`, `meet_start_time DATETIME`, `meet_duration_minutes INTEGER` direct pe task (nullable) | 1 migration |
| Comment reactions | `task_comment_reaction(id, commentId, userId, emoji, createdAt)` | 1 migration |

**Total: 5-7 migrations** distribuite faseat (nu toate odată).

### 2.3 URL state — KEEP nuqs-svelte

Filter state rămâne URL-persistent. Designul folosește React local state, dar pentru CRM e regresie. KEEP nuqs.

### 2.4 Reusable components — extragem 7

Toate cu `src/lib/components/task-*` prefix:
- `task-card.svelte` (Kanban + Team views)
- `task-stats-strip.svelte` (admin + client list)
- `task-avatar-stack.svelte` (multi-assignee display)
- `task-client-chip.svelte`
- `task-due-badge.svelte`
- `task-workload-card.svelte` (Team view)
- `task-calendar-view.svelte`

Existing components UPGRADE (NU rescriu de la 0):
- `task-detail-dialog.svelte` → vizual nou, păstrăm rich editor + comments + materials
- `create-task-dialog.svelte` → 3-step wizard
- `task-kanban-board.svelte` → folosește noul `task-card`
- `task-table-view.svelte` → adaugă inline selects

### 2.5 Google Meet — phase-it

**Fază 3 (launch):** type='meeting' + `meet_link` text (paste manual URL or autogen placeholder)
**Backlog:** Google Calendar API integration cu OAuth (5+ zile, scope separat)

---

## 3. Migration Strategy — Option C+ Hybrid (recommended)

**Why C+:** combinare Gemini (side-panel first → infra solidă) + Worker (detail-first → high user impact). 5 faze deployable independent. Lowest branch conflict risk.

### Faza 1 — Schema + Side-Panel Infra (3-4 zile)
**Goal:** Foundation. Side-panel funcțional cu URL sync. Schema lookups pregătite.

**Tasks:**
- Migrations: `task.type`, `subtask` table, `task_tag` + `task_to_tag` join, `task_assignee` join
- Side-panel component: `task-detail-panel.svelte` wrapping existing `task-detail-dialog` content în Sheet (shadcn-svelte)
- `nuqs-svelte` URL sync `?taskId=XYZ` pe admin tasks list
- Mobile fallback: dacă viewport < 768px, redirect la `/[tenant]/tasks/[taskId]`
- Tenant scoping audit pe noile tables

**DoD:**
- Click pe task în Kanban deschide side-panel (NU full-page navigate)
- URL conține `?taskId=...`, refresh re-deschide panel
- Mobile screenshot: panel = full-screen drawer
- Migrations live verificate cu PRAGMA

**Risk:** L (schema migrations Turso silent-fail — folosesc protocolul `crm_db_migration_protocol`)

### Faza 2 — NewTaskModal Wizard + Admin Detail Visual (3-4 zile)
**Goal:** Cele 2 surfaces cu impact maxim user — create + view.

**Tasks:**
- `create-task-dialog.svelte` refactor → 3-step wizard:
  - Step 1: title / desc / client / project / type
  - Step 2: assignees (multi) / priority / status / due / recurring / tags
  - Step 3: subtasks / attachments / summary
- Meeting mode toggle în wizard (Step 1 alegi task vs meeting)
- `task-detail-panel.svelte` vizual: metadata grid, subtasks checklist interactive, materials upload zone
- Reusable: `task-card.svelte`, `task-avatar-stack.svelte`, `task-client-chip.svelte`, `task-due-badge.svelte`

**DoD:**
- Wizard creează task cu type/tags/subtasks/multi-assignees
- Detail panel afișează subtasks interactive (check/uncheck)
- E2E test: create task cu 3 subtasks → vezi progress bar 0/3 → mark 1 done → 1/3

### Faza 3 — Client Detail Redesign (3-4 zile)
**Goal:** Right-rail rich + reactions + meet modal.

**Tasks:**
- `client/[tenant]/(app)/tasks/[taskId]/+page.svelte` redesign vizual:
  - Right rail cards: subtasks interactive, team (read-only pentru client), materials tabbed cu upload, activity
  - Header: button "Programează Google Meet" verde
  - Comments: grid 180×180 thumbnails + reactions UI
- New: `task-comment-reaction.svelte` + remote `task-comment-reactions.remote.ts`
- New: `task-meet-modal.svelte` (manual URL paste pentru MVP)
- Migration: `task.meet_link`, `meet_start_time`, `meet_duration_minutes`
- Migration: `task_comment_reaction` table

**DoD:**
- Client vede right-rail cu 4 carduri
- Click pe reaction emoji adaugă/elimină reaction propriu
- Lightbox grid 180×180 cu navigation
- "Programează Meet" creează entry cu URL manual

**Mobile:** right rail devine accordion pe `< 768px`.

### Faza 4 — Admin List Redesign (Kanban+Table cu noi componente) (2-3 zile)
**Goal:** Listă admin folosește noile componente, hero stats, filter pills.

**Tasks:**
- Admin tasks `+page.svelte` refactor:
  - Hero stats live (`StatsStrip` reused din client list)
  - Filter pills popover (priority/client/assignee/type) cu color dots
  - Kanban folosește `task-card.svelte` redesignat
  - Table cu inline status/priority selects (colored), progress bar pe subtasks
  - Add `blocked` status la kanban columns
  - Per-column "+" add task (pre-fill status)
  - Bulk actions bar (pause/duplicate/delete pe select)

**DoD:**
- Admin tasks list = 100% design parity pe Kanban + Table view
- Filter popover funcțional + URL persistent
- Inline status change persistă imediat la DB (optimistic + rollback on error)

### Faza 5 — Calendar + Team Views + Polish (3-4 zile)
**Goal:** Cele 2 view modes noi.

**Tasks:**
- `task-calendar-view.svelte`:
  - Month grid (start month, navigation prev/next)
  - Hover day cell → buttons add task + add meet
  - Events colored by priority, max 3 per cell + "+N more"
  - Click event → side-panel detail
  - Adaugă `task.start_date` column (optional, pentru multi-day tasks viitor)
- `task-workload-card.svelte` + Team view:
  - Per-user: avatar, count, overdue, progress bar
  - Per-user task columns
  - Index pe `task_assignee.userId` pentru aggregation performance
- Audit logging pe inline edits (every status/priority change → `task_activity`)
- Polish: animations side-panel slide, focus management, ARIA

**DoD:**
- Calendar arată tasks pe luna curentă cu colored chips
- Team view arată workload pe toți users cu task active
- Lighthouse a11y pass

---

## 4. Risk Register

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Turso migration silent-fail (cunoscut, vezi `turso_migration_silent_fail_pattern`) | High | Protocol obligatoriu `crm_db_migration_protocol` + `scripts/verify-recent-migrations.ts` post-deploy |
| R2 | Mobile UX side-panel break pe small screens | Medium | Fallback redirect/drawer pe viewport `< 768px` în Faza 1 DoD |
| R3 | Tenant isolation pe Calendar/Team aggregations cross-tenant leak | Critical | Audit pe fiecare query nouă (skill `multi-tenant`), tests integration cu 2 tenanti |
| R4 | Backward compat single-assignee → multi-assignee | High | Păstrăm `assignedToUserId` legacy + populate cu primul din `task_assignee` la INSERT; queries vechi continuă |
| R5 | Inline status/priority race conditions | Medium | Optimistic UI + revert on server error + toast; log în `task_activity` |
| R6 | Audit log balooning pe Calendar quick-add | Low | Aggregate audit entries pe 5min window same task |
| R7 | Google Meet "feature parity" rabbit hole | Medium | Lock în Faza 3: manual URL paste; Google API = backlog separat |
| R8 | Recurring tasks materialization | Medium | Gemini: NU materializăm; virtual instances calculate la render |
| R9 | Reactions table balooning | Low | Index pe `(commentId, emoji)`, unique constraint pe `(commentId, userId, emoji)` |

---

## 5. Open Questions — Need Augustin Decision

**Q1 — `blocked` status: nou sau înlocuiește `cancelled`?**
- (a) Adăugăm `blocked` separat (avem 7 statuses total: pending-approval, todo, in-progress, review, done, cancelled, blocked) ← **recomand**
- (b) Înlocuim/redenumim `cancelled` → `blocked` (breaking pe rapoarte vechi)

**Q2 — Google Meet în Faza 3:**
- (a) Manual URL paste (1 zi în Faza 3) ← **recomand pentru launch**
- (b) Google Calendar API real cu OAuth (5+ zile, scope separat după Faza 5)

**Q3 — Client task list — redesign sau leave as-is?**
- Designul livrează DOAR Client Task Detail, NU list. Current client list (`client/[tenant]/(app)/tasks/+page.svelte`) e funcțional cu stats + filter.
- (a) Leave as-is (focus pe detail în Faza 3) ← **recomand**
- (b) Redesign list în Faza 3 (+1-2 zile)

**Q4 — Comment reactions — în scope acum?**
- Designul are reactions emoji (👍🔥🎉), dar e feature nou + DB table + remote.
- (a) În Faza 3 (cum am planificat — adăugă 1 zi) ← **recomand**
- (b) Defer la sprint următor (Faza 3 fără reactions = 2-3 zile)

**Q5 — Task type categories — fixed enum sau admin-configurable?**
- Designul hardcodează 6 tipuri (Design/Video/Ads/Dev/Content/Meeting).
- (a) Fixed enum în code (simplu, fără UI admin) ← **recomand pentru MVP**
- (b) Lookup table `task_type` cu CRUD admin (flexibil, +1 zi)

**Q6 — Strategy confirmation:**
- (a) C+ Hybrid 5 faze ~13-16 zile ← **recomand**
- (b) B View-by-view (calendar+team întâi, schema după)
- (c) A Big-bang (1 PR mare, mare risc)
- (d) Doar Faza 1+2+3 acum (~9-11 zile), Faza 4+5 sprint următor

---

## 6. Effort Rollup

| Faza | Zile dev | Migrations | Files atinse | Componente noi |
|---|---|---|---|---|
| 1 — Schema + Side-Panel Infra | 3-4 | 4 | ~5 | 1 (Sheet wrapper) |
| 2 — Wizard + Admin Detail | 3-4 | 0 | ~8 | 4 (card, avatar-stack, client-chip, due-badge) |
| 3 — Client Detail + Meet + Reactions | 3-4 | 2 | ~6 | 3 (reaction, meet-modal, materials-tabbed) |
| 4 — Admin List Redesign | 2-3 | 0 | ~5 | 1 (stats-strip extras) |
| 5 — Calendar + Team + Polish | 3-4 | 1 | ~6 | 2 (calendar-view, workload-card) |
| **Total** | **14-19** | **7** | **~30** | **11** |

**Sweet spot:** Faze 1-3 (~10-12 zile) livrează 80% din valoarea user: detail panel, wizard, schema, client detail rich. Faze 4-5 (~5-7 zile) închid 100% parity cu designul.

---

## 7. Componente Reutilizabile — Plan Extract

| Nou component | Locație | Used in |
|---|---|---|
| `task-detail-panel.svelte` | `$lib/components/` | Admin list (side-panel), Client list (side-panel) |
| `task-card.svelte` | `$lib/components/` | Kanban col, Team view col |
| `task-stats-strip.svelte` | `$lib/components/` | Admin hero, Client list hero |
| `task-avatar-stack.svelte` | `$lib/components/` | TaskCard, Table assignees, Detail panel |
| `task-client-chip.svelte` | `$lib/components/` | TaskCard, Table client col |
| `task-due-badge.svelte` | `$lib/components/` | TaskCard, Table due col, Detail panel header |
| `task-workload-card.svelte` | `$lib/components/` | Team view |
| `task-calendar-view.svelte` | `$lib/components/` | Calendar view |
| `task-comment-reaction.svelte` | `$lib/components/` | Detail panel comments, Client detail comments |
| `task-meet-modal.svelte` | `$lib/components/` | Detail panel header (admin + client) |
| `task-subtask-list.svelte` | `$lib/components/` | Detail panel right rail |

---

## 8. Reference Files

**Design source:**
- `/tmp/design-tasks/create-campaign-ads/project/Tasks OTS.html`
- `/tmp/design-tasks/create-campaign-ads/project/Client Task Detail.html`
- `/tmp/design-tasks/create-campaign-ads/project/tasks-*.{jsx,css}`
- `/tmp/design-tasks/create-campaign-ads/chats/chat1.md` (1276 lines intent)

**Current code:**
- Admin: `src/routes/[tenant]/tasks/{+page.svelte, new/+page.svelte, [taskId]/{+page.svelte, edit/+page.svelte, documents/+page.svelte, +layout.svelte}}`
- Client: `src/routes/client/[tenant]/(app)/tasks/{+page.svelte, [taskId]/+page.svelte}`
- Components: `src/lib/components/{task-detail-dialog, edit-task-dialog, create-task-dialog, task-filters, task-kanban-board, task-table-view, task-kanban-utils}.svelte`
- Remotes: `src/lib/remotes/{tasks, task-comments}.remote.ts`
- Schema: `src/lib/server/db/schema.ts` (search `task`)

**Gap analysis detaliat:** `/tmp/tasks-design-gap-analysis.md` (8 secțiuni, tabele feature-by-feature)

---

## 9. Decisions Locked (TIER 1 — 2026-05-18 v1.1)

Augustin approval pe defaults pentru blocking Faza 1:

| Decision | Locked value | Rationale |
|---|---|---|
| Q1 — `blocked` status | **(a)** Adăugat separat lângă `cancelled` → 7 statuses total | Zero breaking pe rapoarte istorice |
| BS2 — Approval flow `pending-approval` + approve/reject | **(a)** KEEP as-is | Client portal îl folosește, designul nu îl interzice |
| BS3 — Multi-assignee migration | **(a)** Coexistență — `assignedToUserId` legacy păstrat + `task_assignee` join populated + backward compat | Zero risk pe queries vechi |
| BS5 — Permissions inline edit status (Table) | **(a)** All tenant users (consistent cu Kanban DnD) | Consistent cu pattern existent |

**TIER 2-4 decisions** se vor lua incremental — la lansarea fiecărei faze respective face brainstorm separat per fază.

---

## 10. Per-Phase Spec Workflow

Conform brainstorming skill (decompose project), fiecare fază are spec dedicat:

| Fază | Spec path |
|---|---|
| 1 — Schema + Side-Panel Infra | `docs/superpowers/specs/2026-05-18-tasks-phase-1-foundation-design.md` |
| 2 — NewTaskModal Wizard + Admin Detail | TBD la lansare (brainstorm separat) |
| 3 — Client Detail + Meet + Reactions | TBD |
| 4 — Admin List Redesign | TBD |
| 5 — Calendar + Team + Polish | TBD |

---

## 11. Versioning

- v1 (2026-05-18): initial draft, post worker+Gemini, plan-mode
- **v1.1 (2026-05-18): TIER 1 decisions locked (Q1=a, BS2=a, BS3=a, BS5=a) → unblocks Faza 1**
- v2 (TBD): post-Faza 1 retro + TIER 2 decisions pentru Faza 2 launch
- v3 (TBD): post-Faza 2 retro
