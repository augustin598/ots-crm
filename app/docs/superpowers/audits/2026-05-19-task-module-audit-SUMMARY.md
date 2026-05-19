# Task Module — Comprehensive Audit (Synthesis)

**Date:** 2026-05-19
**Branch audited:** `main` @ `062e72b` (post Client Portal Redesign merge)
**Method:** 5 independent auditors in parallel — 4 specialized Claude subagents (Security, Performance, UX/A11y, Code Quality) + Gemini full-context independent review
**Scope:** Full task module — admin (Faza 1-5 already shipped) + client portal (Phase 1+2 just shipped)

---

## Executive Summary

The task module is **structurally sound** but ships with **two production-blocking bugs from the just-merged client portal redesign** plus **two pre-existing data-leak vulnerabilities** that no single auditor caught alone — only the multi-perspective approach surfaced them.

**12 P0 findings, 19 P1 findings, ~15 P2/P3.**

The most important takeaway is that the Security Engineer auditor reported "0 P0" with high confidence — but Gemini and the Code Quality auditor independently found **two server-side IDOR vulnerabilities in READ paths** (`getTask` and `getTaskComments`) that the Security audit missed because it focused on mutations. A client user can read any task and any comment for any other client in their tenant simply by guessing an ID. This is the single most important finding in the audit.

The recent redesign shipped clean from a multi-tenant perspective (no new leaks introduced), but it inherited two assumptions that turned out to be wrong: `getTask` returns `assignees[].userId` not `.id`, and the materials upload route doesn't exist in this branch. Both are immediately fixable.

---

## P0 Findings — Ranked by Production Blast Radius

| # | Finding | File:Line | Source | Owner |
|---|---|---|---|---|
| **P0-1** | **IDOR in `getTask`**: client user can read any task in their tenant by guessing taskId — no `clientId` check | `tasks.remote.ts:150-184` | Gemini | Pre-existing (admin code) |
| **P0-2** | **IDOR in `getTaskComments`**: same gap — client user reads any task's comments | `task-comments.remote.ts` | Code Quality | Pre-existing |
| **P0-3** | **File theft via attachment path**: `createTaskComment` accepts arbitrary `path` from client → can link to other tenants' MinIO objects → `getAttachmentUrl` issues presigned URL | `task-comments.remote.ts:244-254` | Gemini | Pre-existing |
| **P0-4** | **Assignee shape mismatch**: `getTask` returns `assignees[].userId`, client components use `a.id` → Svelte key collision, broken `defaultInviteeIds` to Meet modal | `client-task-team-card.svelte:8,55,75`; `client-task-detail-body.svelte:1782` | Code Quality | Redesign (mine) |
| **P0-5** | **Materials upload route missing**: client materials card POSTs to `/${tenant}/task-materials/upload` — route doesn't exist; every upload fails network error | `client-task-materials-card.svelte` (POST URL) | Code Quality | Redesign (mine) — backend gap |
| **P0-6** | **`updateTask` watcher N+1 + write-lock**: fires 1 SELECT per watcher inside a for-loop AND holds Turso write lock across email sends | `tasks.remote.ts:1293` | Performance | Pre-existing |
| **P0-7** | **`bulkUpdateTaskStatus` 200 roundtrips**: ~4 DB queries per task × 50 tasks = ~200 sequential roundtrips, ~3s serial I/O | `tasks.remote.ts:1769` | Performance | Pre-existing |
| **P0-8** | **English copy in client team stats**: "Active Members", "Online", "Pending Approvals", "Open Tasks" — design says Romanian | `client-team-stats.svelte:53,62,71,80` | UX | Redesign (mine) |
| **P0-9** | **Meet button design mismatch**: solid green button; design specifies off-white `#f7f8fa` background + full-color Google Meet SVG | `client-task-page-head.svelte` | UX | Redesign (mine) |
| **P0-10** | **Meet modal icon mismatch**: 2-path monochrome SVG; design requires the 5-path branded Google Meet SVG | `client-task-meet-modal.svelte:1500-1503` | UX | Redesign (mine) |
| **P0-11** | **No modal focus management**: Meet, Invite, Lightbox modals do NOT move focus into the dialog when opened → screen readers don't announce; lightbox focuses overlay then Tab escapes (no trap) | All 3 client modals | UX | Redesign + admin |
| **P0-12** | **No loading skeleton on task detail**: `task=null` renders only a small grey "Se încarcă..." line on an empty white page | `client-task-detail-body.svelte:1794-1797` | UX | Redesign (mine) |

### Cross-cutting P0 by category

- **Security/Auth gates** (3): P0-1, P0-2, P0-3 — server READ paths missing client-scope filter
- **Redesign bugs** (5): P0-4, P0-5, P0-8, P0-9, P0-10 — wrong assumptions in the just-shipped client portal
- **Performance** (2): P0-6, P0-7 — pre-existing N+1 / serial roundtrips
- **A11y/UX** (2): P0-11, P0-12 — modals + loading state polish

### Verified false positives (don't fix)

- **Gemini P1-6** (description rendered as `<pre>` shows raw HTML): admin uses `InlineEditableText` with `whitespace-pre-wrap` — description is plain text, not HTML. My `<pre>{description}</pre>` is correct.
- **Gemini P0-3** (timestamp resolution via `current_date` default): schema does default to `current_date`, but all task-related insert paths pass `new Date()` explicitly via `recordTaskActivity` and `createTaskComment`. Default is not hit in normal code paths. Demoted to P2 (defensive: change default to `current_timestamp` so future code that omits `createdAt` doesn't silently break).

---

## P1 Findings — Important, Plan Before Next Major Feature

### Auth & permissions (server gates)
| # | Finding | File:Line | Source |
|---|---|---|---|
| P1-1 | `scheduleMeet`, `toggleSubtask`, `addSubtask`, `deleteSubtask` — no `isClientUser` check; client portal can mutate Meet link + freely manage subtasks | `tasks.remote.ts` (search functions) | Security + Gemini |
| P1-2 | `updateTaskPosition` — no `isClientUser` check; clients can move their own tasks to `done`/`cancelled` without approval | `tasks.remote.ts:600` | Gemini |
| P1-3 | 8 DML statements have bare-ID WHERE (pre-fetch validates tenant but final UPDATE/DELETE trusts ID alone) | `updateTask:1150, reopenTask:1437, approveTask:2276, rejectTask:2327, updateTaskComment:453, updateSubtask:2462, deleteClientSecondaryEmail:216, updateClientSecondaryEmailAccess:189` | Security |
| P1-4 | `getTaskComments` no `isClientUser && task.clientId !== client.id` guard — same family as P0-1 read-leak | `task-comments.remote.ts` | Code Quality |

### Performance & scale
| # | Finding | File:Line | Source |
|---|---|---|---|
| P1-5 | **Zero custom indexes on 7 task tables** (`task`, `taskActivity`, `taskComment`, `taskWatcher`, `subtask`, `taskAssignee`, `taskCommentReaction`). At 25k rows, full scan ~50ms vs <5ms with index | `schema.ts` | Performance |
| P1-6 | `createTaskComment` — N+1 SELECT user per @mention in notification path | `task-comments.remote.ts` | Performance |
| P1-7 | `getTask` detail — 4 sequential queries where 3 could parallelise with `Promise.all` | `tasks.remote.ts:150-220` | Performance |
| P1-8 | `bulkDuplicateTasks` — N sequential `await recordTaskActivity` after transaction | `tasks.remote.ts` | Performance |
| P1-9 | `getTaskActivities` + `getTaskComments` — preflight tenant verification roundtrip; can be JOIN | `task-comments.remote.ts`, `task-activities.remote.ts` | Performance |
| P1-10 | Kanban "Done" column pagination re-instantiates ALL previous page queries on each "More" click — O(N²) load growth | `task-kanban-board.svelte:102` | Gemini |
| P1-11 | `.updates(getTaskComments(taskId), getTaskActivities(taskId))` — calling factory inside `.updates` creates new store instances; UI listens to old. **Verify** if this affects refresh behavior in practice. | `client-task-comments.svelte:115` | Gemini |

### Code quality
| # | Finding | File:Line | Source |
|---|---|---|---|
| P1-12 | Presigned attachment URLs cached forever in component state; 300s server TTL → 403 after 5 min | `client-task-comments.svelte` | Code Quality |
| P1-13 | `page.data as any` erases type safety for `currentUserId`; also it's a dead prop now (unused by `ClientTaskDetailBody`) | `client/[tenant]/(app)/tasks/[taskId]/+page.svelte` | Code Quality |
| P1-14 | `ROLE_FLAGS` in invite modal missing `owner` — inviting owner silently skips access flag assignment | `client-team-invite-modal.svelte` | Code Quality |
| P1-15 | "MoreVertical" kebab in materials card renders but has no `onclick` handler — dead UI affordance | `client-task-materials-card.svelte` | Code Quality |

### A11y
| # | Finding | File:Line | Source |
|---|---|---|---|
| P1-16 | "Reply" button has visible text in English but `aria-label="Răspunde"` in Romanian — conflicting AT vs sighted names | `client-task-comments.svelte` | UX |
| P1-17 | Admin Meet modal known-suppressed with `a11y_no_static_element_interactions` instead of fixed | `task-detail-body.svelte:1073` | UX |
| P1-18 | Lightbox: $effect moves focus to overlay but Tab immediately escapes — no focus trap implementation | `client-task-lightbox.svelte` | UX |

### Testing
| # | Finding | Source |
|---|---|---|
| P1-19 | Zero unit tests on: `toggleReaction`, `getTaskComments`, `createTask`, `toggleSubtask`, `scheduleMeet`, `approveTask`/`rejectTask`, `watchTask`/`unwatchTask`, entire `task-materials.remote.ts` | Code Quality |

---

## P2/P3 — Polish & Backlog

- Stats refresh double-calls `getTasks` in bulk ops
- Kanban `optimisticTasks` spreads full 500-item array on every drop
- `RichEditor` (~100KB TipTap) statically imported in 2 comment components — should be lazy
- `ClientTaskMeetModal` + `ClientTaskLightbox` not async-imported on open
- No `task.clientId` index (Performance + Gemini agree)
- JSZip in-memory blob assembly will crash on bulk invoice download
- `current_date` defaults across all timestamp columns (defensive — change to `current_timestamp`)
- Race condition concerns on simultaneous status changes (add row-version or check `rowsAffected`)
- Permissions button is a no-op with no user feedback
- "Detalii" rail card has no icon (inconsistent with other 4 cards which all have icons)

Full per-auditor lists in:
- `2026-05-19-task-audit-01-security.md`
- `2026-05-19-task-audit-02-performance.md`
- `2026-05-19-task-audit-03-ux-design.md`
- `2026-05-19-task-audit-04-code-quality.md`
- `2026-05-19-task-audit-05-gemini.md`

---

## Cross-cutting Themes

1. **Read paths are under-audited.** Every mutation in `tasks.remote.ts` has an `isClientUser` guard. But the most important reads (`getTask`, `getTaskComments`, `getTaskActivities`) do not. This is the single most impactful systemic gap. Fix all read paths in the same pass.

2. **The "trust the path" pattern is the second most dangerous.** Both `createTaskComment` (P0-3) and probably future upload-linking commands accept opaque storage paths from the client. There should be a single source of truth: either upload endpoints return a signed token wrapping the path, or every consume-the-path command validates ownership.

3. **The just-shipped redesign inherited assumptions.** P0-4 (assignee shape), P0-5 (missing route), P0-8/P0-9/P0-10 (English copy + branded SVGs) all stem from building components from a design+plan stub without runtime smoke-testing against real data. **Recommendation:** before next phase, add a pre-merge step where a sample task with assignees is actually rendered in the new components in dev.

4. **No indexes on task tables.** The 7 task tables have zero custom indexes. The product works because the dataset is small. At 25k+ rows per tenant (some agencies will reach this), every list/filter/search will degrade. This is the single largest performance improvement available.

5. **Defense-in-depth on DML.** Multiple updates and deletes have a pre-fetch tenant check, but the final UPDATE/DELETE WHERE clause is `eq(id, ...)` alone. Today this works. One innocent refactor could break it. Standard pattern should be: every DML WHERE = `and(eq(id, x), eq(tenantId, y))`.

---

## Triage Recommendation

The audit found **12 P0**. Of these:
- **6 P0 are immediately actionable** within 1-2 days of focused work (P0-1, P0-2, P0-3, P0-4, P0-5, P0-8 through P0-10)
- **2 P0 are perf bugs** that need careful refactor + measurement (P0-6, P0-7) — ~1 day each
- **2 P0 are a11y/UX** that need a shared focus-trap action + skeleton component (P0-11, P0-12) — ~half day

**Suggested fix sequence (most risk reduction first):**

1. **Hotfix branch — Security (4 hours)**
   - P0-1, P0-2: Add `isClientUser && clientId !== client.id` guard to `getTask` and `getTaskComments`
   - P0-3: Stop trusting `path` from client; either validate vs storage metadata OR re-architect via attachment IDs
   - P1-1, P1-2, P1-4: Add `isClientUser` gates to `scheduleMeet`, `toggleSubtask`, `addSubtask`, `deleteSubtask`, `updateTaskPosition`
   - **Recommendation:** ship this BEFORE next deploy. These are exploitable in production today.

2. **Redesign polish hotfix (2-3 hours)**
   - P0-4: Fix assignee shape consumers — search for `a.id` in `client-task/*`, change to `a.userId` (or remap at the rail level)
   - P0-5: Create the `/[tenant]/task-materials/upload` route OR point the client component at the correct existing route
   - P0-8: Romanian labels in stats strip
   - P0-9, P0-10: Meet button visual + branded SVG
   - P0-12: Loading skeleton

3. **A11y sprint (1 day)**
   - P0-11: Build shared `use:focusTrap` action; apply to Meet, Invite, Lightbox + admin Meet modal
   - P1-16: Romanian aria-label audit pass on all new components
   - P1-17, P1-18: Per-modal a11y fixes

4. **Performance sprint (2-3 days)**
   - P0-6: JOIN user into watcher query
   - P0-7: Batch activity inserts after bulk loop, hoist `taskSettings` prefetch
   - P1-5: Add 14 missing indexes via migration
   - P1-7: Parallelise `getTask` 4 queries via Promise.all

5. **Code quality + tests (parallelable)**
   - P1-12: Refresh attachment URLs on stale 403
   - P1-13: Type-safe `currentUserId` OR drop the prop completely
   - P1-14: Add `owner` to `ROLE_FLAGS`
   - P1-15: Either wire the kebab onclick or remove the button
   - P1-19: Add unit tests for the 8 untested mutations (start with cross-tenant negative tests)

---

## Statistics

| Auditor | P0 | P1 | P2/P3 | Total | Words |
|---|---|---|---|---|---|
| Security | 0 (missed 2) | 4 | 3 | 7 | ~2500 |
| Performance | 2 | 6 | 4 | 12 | ~2500 |
| UX/A11y/Design | 11 | 8 | 6 | 25 | ~3000 |
| Code Quality | 2 | 5 | 4 | 11 | ~2500 |
| Gemini | 3 | 4 | 3 | 10 | ~1500 |
| **Synthesized (deduplicated)** | **12** | **19** | **~15** | **~46** | this doc |

**Key insight:** No single auditor caught all 12 P0s. Multi-perspective audit was essential — the Security auditor missed both IDOR findings; the Code Quality auditor missed the attachment path issue; Gemini missed the assignee shape mismatch and the materials route. **Future audit cadence should keep the multi-perspective pattern.**
