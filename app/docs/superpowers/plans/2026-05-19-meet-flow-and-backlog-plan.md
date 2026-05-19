# Meet Flow End-to-End + Audit Backlog — Implementation Plan

**Date:** 2026-05-19
**Author:** post-audit investigation triggered by user screenshot of broken "Faza 3" promise
**Status:** Plan-only, awaiting user approval

---

## Part I — Verification: Meet Creation Flow Cap-Coadă

### What the screenshot shows

User opened the "+" → CreateTaskDialog with `initialType='meet'`. The wizard has 3 steps:
1. **Detalii** — title, time, duration, description, client, project, type
2. **Echipă & Plan** — assignees, priority, status, deadline
3. **Subtaskuri & Final** — subtasks, attachments, summary

In Step 1, a blue banner says: **"Link Google Meet va fi generat automat la creare (Faza 3)"**

In Step 3, the attachments dropzone says: **"Upload disponibil în Faza 3"**

### What actually happens (cap-coadă trace)

**Step 1 → 2 → 3** is just frontend wizard navigation — no backend calls.

**Step 3 "Creează" click** calls `createTask({...})` (line 250 in `create-task-dialog.svelte`). Pass-through fields:
- `title`, `description`, `clientId`, `projectId`, `milestoneId`
- `status`, `priority`, `dueDate`, `assignedToUserId`, `assigneeUserIds`
- `isRecurring` + recurring args
- `type: 'meeting'`
- `meetTime`, `meetDurationMinutes`
- `subtasks`, `tagNames`

**Server `createTask`** persists all of the above into the `task` row. Crucially:
- ❌ **NO `meetLink` is generated.** The field stays `null`.
- ❌ **NO calendar event is created.**
- ❌ **NO email invitation is sent.**
- ❌ **NO attachments are uploaded.**

The promise "Link Google Meet va fi generat automat la creare (Faza 3)" is **broken** — no auto-generation logic exists in the codebase. The user gets a "meeting" task with no link, having to manually paste a Meet URL via the admin `task-detail-body.svelte` Meet modal afterwards.

### Root cause

Two separate gaps:

1. **No Google Calendar API integration.** Existing Google integrations:
   - `gmail/auth.ts` — Gmail OAuth (scopes: `gmail.readonly/send/modify`)
   - `google-ads/auth.ts` — Google Ads OAuth (scope: `adwords`)
   - **NO `calendar.events` scope anywhere.** Cannot create Calendar events / Meet conference data without it.

2. **Upload stub is decorative.** Hotfix created `/[tenant]/task-materials/upload` endpoint (commit `0370514`), but `create-task-dialog.svelte` never wires up the dropzone to that endpoint. Drag-drop / click does nothing today.

### What "Faza 3" means in the UI text

The "(Faza 3)" copy refers to a development phase, NOT step 3 of the wizard. It's a roadmap reference — but the user reads it as "step 3 will do this", which is misleading.

**Decision needed:** either implement the missing logic, or remove the false promise from the UI.

---

## Part II — Fix Plan: Meet Flow (P0 — User-Visible Broken Promise)

### Approach options

**A. Implement real Google Calendar Meet generation** — full scope (~2 days)
- Add `calendar.events` scope to Gmail OAuth flow
- Existing Gmail-integrated tenants get a "Reconnect to enable Meet" prompt (token re-consent)
- Server helper `createGoogleMeetForTask(tenantId, {title, startTime, durationMinutes, attendees})` → returns `{eventId, hangoutLink}`
- Wire into `createTask` when `type='meeting'`: call the helper after task insert, update `meetLink` on the row
- Update `scheduleMeet` server function: if `meetLink` is null and request comes from a connected Gmail tenant, generate one
- Update `client-task-meet-modal.svelte` and admin Meet modal accordingly

**B. Honest fallback — drop the false promise** (~30 min)
- Change UI copy: "Link Google Meet" → "Notă meeting (linkul îl adaugi după creare)" or similar
- Keep `meetTime`/`meetDurationMinutes` persistence as-is
- User pastes Meet link manually in admin Meet modal post-creation (existing flow)
- Add a follow-up backlog item: "Implement Google Calendar Meet auto-generation"

**C. Hybrid — auto-generation behind feature flag** (~1 day)
- Add Calendar scope but only enable Meet auto-gen if the env flag `ENABLE_GOOGLE_MEET=true` is set
- Document the OAuth scope upgrade as a manual deployment step
- Same wiring as A but gated

**Recommendation: B for now (ship honest UX in 30 min), then A as a planned sprint** — Calendar integration is a real feature that deserves its own design + testing cycle. Stop the bleeding first.

### Detailed Plan: Option B (immediate fix)

**Files to touch:**
- `app/src/lib/components/create-task-dialog.svelte` (lines 408-414, 727-742)

**Change 1: Step 1 banner copy**

Replace lines 408-414 (the blue info banner promising "Faza 3"):

```svelte
<!-- BEFORE -->
<div class="col-span-2 flex items-center gap-3 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3">
    <div class="text-xs text-blue-700">
        <strong>Link Google Meet</strong> va fi generat automat la creare (Faza 3)
    </div>
</div>

<!-- AFTER -->
<div class="col-span-2 flex items-start gap-3 rounded-lg border border-amber-100 bg-amber-50 px-4 py-3">
    <span class="mt-0.5 text-amber-600">ⓘ</span>
    <div class="text-xs text-amber-800">
        <strong>Linkul Google Meet îl adaugi manual</strong> după ce salvezi meeting-ul, din panoul de detalii al taskului. Integrarea Calendar pentru auto-generare e pe roadmap.
    </div>
</div>
```

**Change 2: Step 3 attachments stub**

Replace lines 727-742 (the "Upload disponibil în Faza 3" dropzone):

Two sub-options:
- **B1.** Wire dropzone to the existing `/[tenant]/task-materials/upload` endpoint
- **B2.** Just hide the stub for now and add to backlog

Choose **B1** since the endpoint already exists. Wire it up:

```svelte
<!-- AFTER -->
<div class="flex flex-col gap-1.5">
    <label class="text-[11px] font-bold uppercase tracking-wide text-slate-500">Atașamente</label>
    <input
        type="file"
        bind:this={fileInputEl}
        class="hidden"
        multiple
        accept="image/*,video/*,application/pdf,application/zip"
        onchange={handleFiles}
    />
    <button
        type="button"
        class="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50 py-6 text-xs text-slate-400 transition-colors hover:border-blue-400 hover:bg-blue-50"
        ondragover={(e) => e.preventDefault()}
        ondrop={handleDrop}
        onclick={() => fileInputEl?.click()}
    >
        <span class="text-base">📎</span>
        <div class="text-center">
            <strong class="text-slate-500">Trage fișiere aici</strong>
            <p class="mt-0.5">sau click pentru a selecta · max 50MB · img/video/pdf/zip</p>
        </div>
    </button>
    {#if pendingAttachments.length > 0}
        <ul class="mt-2 flex flex-col gap-1">
            {#each pendingAttachments as a (a.path)}
                <li class="flex items-center justify-between text-xs text-slate-600">
                    <span class="truncate">{a.fileName}</span>
                    <button onclick={() => removePending(a.path)} aria-label="Șterge">×</button>
                </li>
            {/each}
        </ul>
    {/if}
</div>
```

**Challenge:** The attachments are uploaded BEFORE the task exists (no taskId yet). Solutions:
- **B1.a:** Upload after task creation — collect Files locally, then in `handleCreate` chain: `createTask` → loop POST attachments to `/[tenant]/task-materials/upload` with the new task ID
- **B1.b:** Server endpoint accepts a "pending" mode (no taskId), returns path; on `createTask` server side, link the pending paths
- **B1.c:** Two-phase save: Step 3 "Creează" creates the task first, then uploads attachments and links them

Choose **B1.a** — simplest, single user-facing button. Flow:
1. Step 3 user selects files → stored locally in `pendingFiles: File[]`
2. Click "Creează" → `createTask(...)` returns `{taskId}`
3. For each `pendingFile`, POST to `/[tenant]/task-materials/upload` with `taskId`
4. On any upload error, surface toast but don't undo task creation
5. Close dialog when all uploads settle

**Server change needed?** Check `/[tenant]/task-materials/upload` — does it accept `taskId` in formData? Per Sprint B (hotfix), yes — it requires `taskId` AND validates it belongs to current tenant. ✅ Compatible with this flow.

**Commit plan:**
1. `fix(create-task): honest copy for Meet link — manual paste post-creation (P0 — broken promise)`
2. `feat(create-task): wire attachments dropzone to task-materials upload endpoint (P0 — broken stub)`

**Effort:** ~1-2h.

### Detailed Plan: Option A (real Google Meet integration — separate sprint)

This becomes its own brainstorming session because of:
- OAuth scope expansion = user re-consent flow
- Per-tenant Calendar settings (which calendar to write to, timezone, etc.)
- Error handling for non-connected tenants (graceful fallback to manual)
- Testing strategy (mock the Google Calendar API)
- Audit logging on Meet event creation/deletion

**Scope: ~2-3 days. Roadmap item, NOT included in this plan.**

---

## Part III — Backlog Plan (the items in the prompt)

The 5 items left over from the audit. Each gets a concrete plan + effort estimate.

### Backlog Item 1 — Lazy-load RichEditor (~100KB TipTap)

**Scope:** moderate, touches admin + client comment paths.

**Current state:** `RichEditor.svelte` is statically imported in BOTH `task-detail/task-comment-thread.svelte` (admin) AND `client-task/client-task-comments.svelte` (client). Every page load that includes either component pulls in TipTap's full bundle (~100KB gzipped) regardless of whether the user actually opens the editor.

**Strategy:** Lazy-load the RichEditor behind a `{#if showEditor}` gate that defers the import until first focus.

**Files to touch:**
- `src/lib/components/RichEditor/RichEditor.svelte` (no change to this file, but provide a lazy wrapper)
- New: `src/lib/components/RichEditor/LazyRichEditor.svelte` (Svelte 5 dynamic import wrapper)
- `src/lib/components/task-detail/task-comment-thread.svelte` — swap `RichEditor` → `LazyRichEditor`
- `src/lib/components/client-task/client-task-comments.svelte` — same

**Pattern (Svelte 5):**

```svelte
<!-- LazyRichEditor.svelte -->
<script lang="ts">
    import type RichEditorType from './RichEditor.svelte';
    type Props = { /* same as RichEditor */ };
    let { ...props }: Props = $props();
    let Comp = $state<typeof RichEditorType | null>(null);

    $effect(() => {
        // Trigger import on mount. The placeholder is a textarea that promotes to RichEditor.
        import('./RichEditor.svelte').then(m => { Comp = m.default; });
    });
</script>

{#if Comp}
    <Comp {...props} />
{:else}
    <textarea
        class="w-full rounded-lg border border-slate-200 p-3 text-sm"
        placeholder="Se încarcă editor..."
        disabled
    ></textarea>
{/if}
```

**Risks:**
- TipTap's API surface — if comment-thread uses `editorRef.getHTML()` imperatively, we need a method-forwarding pattern (export functions from LazyRichEditor that delegate to the loaded Comp's instance)
- Server-side rendering: ensure the placeholder renders on SSR, TipTap loads only client-side

**Effort:** ~3-4h. Includes testing the imperative API forwarding.

**Risk level:** medium (touches both admin + client comment flow; reverts well if test pass).

### Backlog Item 2 — Kanban Optimistic Array Spread Refactor

**Scope:** perf, complex.

**Current state:** `src/lib/components/task-kanban-board.svelte` does `optimisticTasks = [...tasks, ...]` on every DnD drop. At 500 cards, this is a ~500-element array realloc on each move.

**Strategy:**
- Use `SvelteMap<string, Task>` instead of array — O(1) mutation by ID
- Derive grouped columns via `$derived.by`
- On drop, mutate the map entry's `status`/`position` directly

**Files to touch:**
- `src/lib/components/task-kanban-board.svelte` (~50 LOC restructure)
- Possibly update consumers if they depend on array semantics

**Effort:** ~4-6h. Test thoroughly: DnD across columns, multi-select drag, optimistic rollback on server error.

**Risk level:** medium-high — the DnD code is intricate. Worth doing only if you're seeing actual frame drops at scale.

### Backlog Item 3 — JSZip Server-Side Generation

**Scope:** rewrite, big.

**Current state:** `src/routes/client/[tenant]/(app)/invoices/google-ads/+page.svelte:315` does `new JSZip(); zip.file(name, blob); ...` — all in browser memory. Crashes on mobile or low-memory tabs for large invoice bulk downloads.

**Strategy:**
- New endpoint `/[tenant]/api/invoices/bulk-zip` — POST with array of invoice IDs
- Server streams `node-stream-zip` (or `archiver`) output to response with `Content-Type: application/zip` + `Content-Disposition: attachment; filename=...`
- Client triggers `<a href={...} download>` or `fetch().then(blob → URL.createObjectURL → trigger download)`
- Add a server-side cap (e.g., max 50 invoices per zip) + log telemetry

**Files to touch:**
- New: `src/routes/[tenant]/api/invoices/bulk-zip/+server.ts`
- `src/routes/client/[tenant]/(app)/invoices/google-ads/+page.svelte` (line 315) — replace JSZip with fetch
- Possibly same for `/[tenant]/invoices/...` admin variant if it has bulk download

**Risks:**
- MinIO presigned URLs are short-lived (300s) — server needs to fetch each PDF via signed URL (or read directly from S3 SDK) and stream into the zip
- Memory still needs care server-side: stream, don't buffer-then-zip
- Auth: must validate user has access to ALL invoice IDs (per-tenant + ownership)

**Effort:** ~1-1.5 days.

**Risk level:** medium — server I/O wiring is the tricky part.

### Backlog Item 4 — Race Condition Row-Version on Status Changes

**Scope:** schema change + server-side conditional update.

**Current state:** Two users (admin + client) can change `task.status` simultaneously. The "last writer wins" pattern. UI flickers, audit log is confused.

**Strategy:**
- Add `version: integer NOT NULL DEFAULT 0` column to `task` table
- Every UPDATE sets `version = version + 1 WHERE version = $currentVersion`
- Check `rowsAffected` — if 0, throw "Stale" → UI prompts user to refresh
- All write operations on `task` (createTask returns version, getTask returns version, updateTask/updateTaskPosition/approveTask/rejectTask/scheduleMeet etc. require it)

**Files to touch:**
- New migration: `drizzle/0336_task_version_column.sql` (Turso single-statement constraint applies)
- `src/lib/server/db/schema.ts` — add `version` field
- `src/lib/remotes/tasks.remote.ts` — every UPDATE on `task` rows
- Client: all `updateTask()` callers need to pass + receive version
- Optional UI: show "Stale" toast with "Refresh" action

**Risks:**
- Wide blast radius — every task mutation must thread the version
- Migration on existing rows: backfill `version = 0`
- Cache-invalidation interaction: `query()` cached responses include version; refresh must propagate

**Effort:** ~1 day.

**Risk level:** high — wide blast radius, every endpoint changes signature.

### Backlog Item 5 — Bulk Invoice Download Memory Limits (Frontend Cap)

**Scope:** defensive, small.

**Current state:** No limit on how many invoices can be selected for ZIP download. Crashes browsers on mobile.

**Strategy (defensive — until Backlog Item 3 ships):**
- Cap selection at 20 invoices
- If user tries to download more, show modal "Selectează maxim 20 facturi per descărcare"
- Disable bulk download button when selection > 20

**Files to touch:**
- `src/routes/client/[tenant]/(app)/invoices/google-ads/+page.svelte` (selection state + bulk action)
- Possibly admin invoice list

**Effort:** ~30 min.

**Risk level:** low.

### Backlog Item 6 — P3 Nitpicks (omnibus polish)

Audit `2026-05-19-task-module-audit-SUMMARY.md` lists smaller items:
- Stats refresh dedup (already verified not a duplicate in Sprint 5)
- "Detalii" rail card icon (DONE Sprint 5)
- Permissions button feedback (DONE Sprint 5)
- Various pre-existing svelte-check warnings cleanup
- Documentation refresh

**Effort:** ~2-3h for a sweep.

---

## Sequencing Recommendation

### Phase A — Stop the bleeding (TODAY, ~2h)

1. **Meet flow honest copy + wire attachments** (Part II Option B)
   - Effort: ~1-2h
   - Risk: low
   - User impact: HIGH (removes broken promise visible on every Meet creation)

### Phase B — Backlog quick win cluster (this week, ~1 day)

2. **Bulk invoice download cap** (Item 5) — 30 min
3. **P3 nitpicks omnibus** (Item 6) — 2-3h
4. **Lazy RichEditor** (Item 1) — 3-4h

Total: ~1 day for measurable bundle-size + UX wins.

### Phase C — Heavier scope (next sprint, ~3-4 days)

5. **Google Calendar Meet auto-generation** (Part II Option A) — 2-3 days
   - Brainstorm session needed for OAuth + per-tenant settings
6. **JSZip server-side** (Item 3) — 1-1.5 days

### Phase D — Schema-level (separate sprint)

7. **Row-version optimistic locking** (Item 4) — 1 day
   - Schema change + blast radius across all task mutations

### Phase E — Defer

8. **Kanban optimistic refactor** (Item 2) — 4-6h
   - Only ship if perf measurements show real drop at scale (>500 cards)

---

## Decision Points for User

1. **Phase A scope:** Just the honest-copy fix? Or also wire attachments? (Spec says both. ~1-2h either way.)
2. **Phase A approach for Meet:** Option B (honest copy, defer) vs Option A (real Calendar integration, brainstorm needed)?
3. **Phase B ordering:** All three (Item 5 + Item 6 + Item 1) in one batch? Or just Item 1 (highest impact)?
4. **Phase C+D timing:** Schedule now, or wait for product validation?

---

## Out of Scope (Intentional Defers)

- Kanban optimistic refactor — defer until metrics justify
- Calendar deep integration (per-tenant calendar choice, recurring meetings, RSVP tracking) — Phase 2 of Item A
- Per-task version optimistic locking — only if collaboration UX shows real conflicts
