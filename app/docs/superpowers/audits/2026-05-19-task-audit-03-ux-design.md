# UX + Design Fidelity + A11y Audit — Task Module

**Date:** 2026-05-19
**Auditor:** AccessibilityAuditor subagent
**Standard:** WCAG 2.2 Level AA
**Scope:** Client task detail (12 components), client team (6 components), admin task detail / Faza 1-5 admin surface
**Design reference:** `/Users/augustin598/Projects/CRM/new_design/Client Task Detail.html`, `Client Team.html`

---

## Executive Summary

The client portal task surface (Faza 5) is visually well-crafted and broadly faithful to the design reference. The most critical gaps are structural: the Meet modal is missing `aria-labelledby` on the overlay element itself (the `id` attribute exists on the `<h2>` but the outer `<div role="dialog">` only carries `tabindex={0}`, not the keyboard focus management a real trap requires); the lightbox overlay acquires focus through a `$effect` but never traps it inside (Tab will escape the overlay); and the invite modal for client-team has the same focus-trap gap. Three fields on `client-task-meta-card.svelte` use `<dt>` inside a `<dl>` but wrap the whole section in a `<div class="ct-card">` without a heading association — screen readers get "Status / In Progress" but no card label. The design reference specifies a `ct-section-head` label ("Detalii") — the code omits it entirely.

The admin task-detail surface (`task-detail-body.svelte`) carries a `<!-- svelte-ignore a11y_no_static_element_interactions -->` comment on its Meet modal overlay, signaling a known suppress of the trap warning rather than a fix. The progress bar in admin uses Tailwind `emerald-500` while the client-portal uses a `#1877F2 → #10b981` gradient — the two surfaces are visually inconsistent for the same "progress" concept.

Language mixing is the most visible UX inconsistency: stats labels in `client-team-stats.svelte` are in English ("Active Members", "Pending Approvals", "Open Tasks") while the rest of the interface is in Romanian. The design reference uses "Membri activi", "Aprobări pending", "Tasks deschise".

---

## Findings — Design Fidelity Deviations

### P0 — Visible mismatch from new_design/

**#UX-P0-1** | `client-team/client-team-stats.svelte` | Stats card labels are English instead of Romanian

- **Design says:** `"Membri activi"`, `"Online acum"`, `"Aprobări pending"`, `"Tasks deschise"` (`Client Team.html` lines 95–113)
- **Code does:** `"Active Members"`, `"Online"`, `"Pending Approvals"`, `"Open Tasks"` (lines 24, 30, 36, 42)
- **Visible impact:** Four stat cards render in English in an otherwise fully Romanian UI — visually jarring and immediately noticeable to any Romanian-speaking user.
- **Fix:** Replace the four label strings: `"Active Members"` → `"Membri activi"`, `"Online"` → `"Online acum"`, `"Pending Approvals"` → `"Aprobări pending"`, `"Open Tasks"` → `"Tasks deschise"`.

**#UX-P0-2** | `client-task/client-task-meta-card.svelte:23–25` | Missing "Detalii" section heading — card has no visual title

- **Design says:** `<div className="ct-section-head"><h3>Detalii</h3></div>` present in the meta card before the `<dl>` rows (`Client Task Detail.html` implicit from `ct-section-head` pattern on every other card)
- **Code does:** `<h4 class="... font-bold uppercase">Detalii</h4>` exists at line 25, but no icon precedes it (every other rail card uses an icon + heading pattern: progress card has `CheckSquare2Icon`, team card has `UsersIcon`, materials card has `PaperclipIcon`, activity card has `HistoryIcon`). The meta card lacks the icon entirely.
- **Visible impact:** The meta card is visually inconsistent with the rest of the rail — it appears "flat" compared to its siblings.
- **Fix:** Add `<UserIcon>` (or a suitable Lucide icon) before the "Detalii" heading to match the `icon + heading` pattern of all other rail cards.

**#UX-P0-3** | `client-task/client-task-page-head.svelte:105–116` | Meet button uses green (`#10b981`) background instead of the design's white-on-transparent pill

- **Design says:** `<button className="ct-meet-btn">` with `background: #f7f8fa` and colored Google Meet SVG icon filling in brand colors (`#00897B`, `#1E88E5`, `#FBC02D`, `#E53935`, `#4CAF50`) — the button is light/neutral (`Client Task Detail.html` lines 258–268)
- **Code does:** `bg-[#10b981]` with white text and a monochrome white/mint SVG (lines 105–116) — makes the Meet button a solid green pill, visually dominating the page head.
- **Visible impact:** The "Programează Google Meet" button is the most prominent element in the page header due to its saturated green. Design intent is a more subtle off-white button that lets the Google Meet icon carry the brand recognition.
- **Fix:** Change `bg-[#10b981]` to `bg-[#f7f8fa]`, set `text-[#0f172a]`, restore the full-color Google Meet SVG paths (`#00897B`, `#1E88E5`, `#FBC02D`, `#E53935`, `#4CAF50`), and add `border border-[#e5e9f0]` to match the design.

**#UX-P0-4** | `client-task/client-task-meet-modal.svelte:122–132` | Meet modal icon uses monochrome SVG paths instead of Google Meet brand colors

- **Design says:** Meet icon in modal header uses the full 5-path Google Meet SVG with `#00897B`, `#1E88E5`, `#FBC02D`, `#E53935`, `#4CAF50` fills (`Client Task Detail.html` lines 547–554)
- **Code does:** Two paths only — `fill="#10b981"` and `fill="#a7f3d0"` — rendering a simplified teal icon (lines 125–129)
- **Visible impact:** The Google Meet icon in the modal header is unrecognizable as Google Meet — it's just two green blobs. Users familiar with Meet branding may not recognize it.
- **Fix:** Replace the two-path SVG with the full five-path version from the design reference.

### P1 — Subtle deviations

**#UX-P1-1** | `client-task/client-task-page-head.svelte:88–96` | Overdue pill uses `#b91c1c` (red-700) while design uses `#ef4444` (red-500)

- **Design says:** `color: "#ef4444"`, `background: "#fee2e2"` (`Client Task Detail.html` line 283)
- **Code does:** `text-[#b91c1c]` with `bg-[#fee2e2]` and `bg-[#b91c1c]` dot (lines 88–96). Using the darker red-700 for both text and dot.
- **Fix:** Change `text-[#b91c1c]` → `text-[#ef4444]` and `bg-[#b91c1c]` (dot) → `bg-[#ef4444]`. The overdue pill background `#fee2e2` is correct.

**#UX-P1-2** | `client-task/client-task-progress-card.svelte:65` | Progress bar uses a `#1877F2 → #10b981` gradient; design uses solid `#10b981`

- **Design says:** `className="ct-progress-fill"` with simple `background: #10b981` fill (design CSS inferred from solid color usage across all progress elements)
- **Code does:** `background: linear-gradient(90deg, #1877F2, #10b981)` (line 65) — a two-color gradient
- **Visible impact:** Gradient looks richer but is inconsistent with admin task-detail which uses `bg-emerald-500` (solid). Two different treatments for the same UI concept.
- **Fix:** Replace the gradient with solid `background-color: #10b981` to match admin panel and design spec.

**#UX-P1-3** | `client-task/client-task-comments.svelte:343–366` | Reaction bar omits the "+ emoji" picker button that the design shows

- **Design says:** `<button className="ct-react">+ 😊</button>` — an "add emoji" button after the fixed reactions (`Client Task Detail.html` line 336)
- **Code does:** Only renders `VALID_EMOJIS = ['👍', '🔥', '🎉']` with no "add emoji" CTA
- **Fix:** Add a non-functional (or future) "+ 😊" button after the emoji buttons, styled as `ct-react` without `active` class.

**#UX-P1-4** | `client-task/client-task-description.svelte:11` | Description uses `<pre>` tag inside the styled container — monospace fallback risk

- **Design says:** Plain `<div className="ct-desc">` wrapping the description text directly, not inside `<pre>`
- **Code does:** `<pre class="whitespace-pre-wrap break-words font-sans">` — while `font-sans` overrides monospace, a `<pre>` element has browser-specific quirks (some browsers/contexts still inherit monospace for `<pre>` even with `font-sans`)
- **Fix:** Replace `<pre>` with `<p>` or a `<div>` with `whitespace-pre-wrap break-words`.

**#UX-P1-5** | `client-team/client-team-hero.svelte` | Hero gradient direction differs from design

- **Design says:** Hero uses `background: linear-gradient(135deg, #1877F2, #0d5cc7)` with a distinct icon panel using `bg-white/15` (`Client Team.html` lines 83–90)
- **Code does:** `linear-gradient(135deg, #1877F2 0%, #0d5cc7 100%)` — gradient is correct. Icon container uses `bg-white/15 backdrop-blur-sm` — `backdrop-blur-sm` is added but design has no blur. Minor.
- **Fix:** Remove `backdrop-blur-sm` from the icon wrapper to match design exactly.

**#UX-P1-6** | `client-task/client-task-meta-card.svelte:29–58` | Status and priority display text only (e.g. "In Progress") with no color coding

- **Design says:** Status value uses `style={{ color: status.color }}>● {status.label}` — colored bullet + colored text. Priority same. (`Client Task Detail.html` lines 386–394)
- **Code does:** `<dd class="font-semibold text-[#0f172a]">` with no color — all meta values are identical dark slate regardless of status or priority.
- **Fix:** Apply status-specific color to the `<dd>` value using the same `statusColors()` / `priorityColors()` helpers already defined in `client-task-page-head.svelte`.

### P2 — Polish

**#UX-P2-1** | `client-team/client-team-member-card.svelte:55` | Card `rounded-[14px]` — design specifies `rounded-[12px]` for smaller member cards

- **Design says:** Member cards use `.cteam-card { border-radius: 12px }` (inferred from the 14px used only on the modal, 12px on cards)
- **Code does:** `rounded-[14px]` — 2px oversize.
- **Fix:** Change to `rounded-[12px]`.

**#UX-P2-2** | `client-task/client-task-activity-card.svelte` | Activity items show abbreviated actions only (e.g. `Status: todo → in-progress`) — design shows full English sentences

- **Design says:** `<strong>{p.name}</strong> updated <span class="field">{a.field}</span>` with human-readable field names (`Client Task Detail.html` lines 515–527)
- **Code does:** `describe()` returns terse strings like `"Status: todo → in-progress"` — the raw DB values are exposed.
- **Fix:** Map DB values to display strings (e.g. `"todo"` → `"To Do"`, `"in-progress"` → `"In Progress"`) in the `describe()` function.

---

## Findings — Accessibility

### P0 — WCAG fail / blocker for assistive tech users

**#A11Y-P0-1** | `client-task/client-task-lightbox.svelte:54–68` | Lightbox overlay not a true focus trap — WCAG 2.1 SC 2.1.2 No Keyboard Trap (inverse)

- **Standard:** WCAG 2.1 SC 2.1.2 / WAI-ARIA dialog pattern requires focus to remain inside the dialog while it is open. Equivalently, Autofocus on open and Tab cycling within the dialog is required.
- **Evidence:** `tabindex={-1}` on the overlay `<div>` means `$effect(() => overlayEl.focus())` does move focus to the overlay — but the overlay itself is not a proper focus container. The close button, prev/next buttons, and caption are inside, but `Tab` from the last button will traverse to underlying page content (the overlay has no focus trap loop).
- **Impact:** Keyboard and screen reader users pressing Tab will cycle out of the lightbox into the obscured page behind it, leaving them stranded in invisible content.
- **Fix:** Implement a focus trap: on `open`, collect all focusable children; on `keydown Tab`, intercept and cycle within those children. Alternatively use the `focus-trap` library already available in many SvelteKit projects, or a `<dialog>` element which the browser traps natively.

**#A11Y-P0-2** | `client-task/client-task-meet-modal.svelte:96–106` | Meet modal outer element has `tabindex={0}` but is not focused on open — focus remains on the triggering button

- **Standard:** WCAG 2.2 SC 2.4.3 Focus Order; WAI-ARIA dialog pattern requires focus to move to the dialog when it opens.
- **Evidence:**
  ```svelte
  <div
    role="dialog"
    aria-modal="true"
    aria-labelledby="meet-modal-title"
    tabindex={0}
    onkeydown={(e) => { if (e.key === 'Escape') onClose(); }}
  >
  ```
  No `$effect` or `bind:this` to programmatically move focus to the dialog container or first focusable child when `open` becomes true.
- **Impact:** Screen reader users receive no announcement that a dialog has opened. Focus stays on the "Programează Google Meet" button in the background.
- **Fix:** Add `bind:this={dialogEl}` and `$effect(() => { if (open && dialogEl) dialogEl.querySelector<HTMLElement>('[autofocus], input, button')?.focus(); })`.

**#A11Y-P0-3** | `client-team/client-team-invite-modal.svelte:124–135` | Invite modal same gap — no focus movement on open + no focus trap

- **Standard:** WCAG 2.2 SC 2.4.3; WAI-ARIA dialog pattern.
- **Evidence:**
  ```svelte
  <div
    role="dialog" aria-modal="true" aria-labelledby="invite-title"
    tabindex={-1}
    onkeydown={(e) => { if (e.key === 'Escape') onClose(); }}
  >
  ```
  `tabindex={-1}` is correct for programmatic focus but no `$effect` fires `dialogEl.focus()` on `open`.
- **Impact:** Same as A11Y-P0-2 — dialog opens silently for screen reader users.
- **Fix:** Same pattern: `bind:this` + `$effect` to focus the first input (`#invite-email`) when `open` becomes true.

**#A11Y-P0-4** | `task-detail/task-detail-body.svelte:1073–1087` | Admin Meet modal deliberately suppresses a11y warning instead of fixing it

- **Standard:** WCAG 2.2 SC 2.1.1 Keyboard; SC 2.4.3 Focus Order.
- **Evidence:**
  ```svelte
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div ... role="dialog" aria-modal="true" tabindex="-1"
    onkeydown={(e) => { if (e.key === 'Escape') showMeetModal = false; }}
  >
  ```
  The `svelte-ignore` comment reveals this is a known issue that was suppressed rather than resolved.
- **Impact:** Admin modal has the same focus management gap. Blocks keyboard users from modal interaction.
- **Fix:** Remove `svelte-ignore`. Apply the same focus-on-open fix as A11Y-P0-2. The inner `<div role="document">` child div also incorrectly has no keyboard handler — replace the `onkeydown={() => {}}` with a proper `e.stopPropagation()` guard.

**#A11Y-P0-5** | `client-task/client-task-comments.svelte:277–284` | Reply button has `aria-label="Răspunde"` but also renders visible "Reply" text — creates duplicate announcement

- **Standard:** WCAG 2.2 SC 4.1.2 Name, Role, Value — the accessible name should not be redundant in a confusing way, but more critically: the button visual text is "Reply" (English) while `aria-label` says "Răspunde" (Romanian). Screen readers announce "Răspunde, button" but sighted users see "Reply".
- **Impact:** Language inconsistency for AT users vs sighted users. Minor confusion for bilingual screen reader users.
- **Fix:** Remove `aria-label` (let the visible text be the accessible name) and translate the visible "Reply" to "Răspunde".

### P1 — A11y degradation

**#A11Y-P1-1** | `client-task/client-task-progress-card.svelte:79–84` | Checkbox `aria-label` says "Toggle {s.title}" — English word in a Romanian interface

- **Standard:** WCAG 2.2 SC 3.1.1 Language of Page
- **Evidence:** `aria-label={\`Toggle ${s.title}\`}` (line 85)
- **Fix:** Change to `Marchează "${s.title}" ca ${isDone ? 'nefinalizat' : 'finalizat'}`.

**#A11Y-P1-2** | `client-task/client-task-comments.svelte:356–358` | Reaction buttons have `aria-label="React with {emoji}"` — English in Romanian UI

- **Evidence:** `aria-label={\`React with ${emoji}\`}` (line 357)
- **Fix:** Change to `aria-label={\`Reacție: ${emoji}\`}`.

**#A11Y-P1-3** | `client-team/client-team-member-card.svelte:74–76` | Online/offline indicator is a purely visual dot with `aria-label` on the `<span>` only — screen reader announcement may be lost

- **Standard:** WCAG 2.2 SC 1.3.1 Info and Relationships
- **Evidence:**
  ```svelte
  <span
    class={`absolute ... ${online ? 'bg-[#10b981]' : 'bg-[#cbd5e1]'}`}
    aria-label={online ? 'Online' : 'Offline'}
  ></span>
  ```
  A `<span>` with only `aria-label` (no `role`) is not guaranteed to be read by all screen readers. It needs `role="img"` to establish it as a labelled presentational element.
- **Fix:** Add `role="img"` to the status indicator span.

**#A11Y-P1-4** | `client-team/client-team-page-header.svelte:49–54` | Search input has no `<label>` — only `placeholder`

- **Standard:** WCAG 2.2 SC 1.3.1, 4.1.2 Name, Role, Value
- **Evidence:**
  ```svelte
  <input
    type="text"
    placeholder="Caută coleg..."
    value={search}
    ...
  />
  ```
  No `id`, no `<label for>`, no `aria-label`.
- **Impact:** Screen readers announce "text input" or just read the placeholder. VoiceOver on Safari does not reliably use placeholder as the accessible name.
- **Fix:** Add `aria-label="Caută coleg"` or wrap in a `<label>`.

**#A11Y-P1-5** | `client-task/client-task-meta-card.svelte` | `<dl>` / `<dt>` / `<dd>` structure is semantically correct but the entire card has no accessible heading linking it to context

- **Standard:** WCAG 2.2 SC 1.3.1 Info and Relationships
- **Evidence:** The `<h4>Detalii</h4>` at line 25 precedes a `<dl>` at line 27. The heading and the list are both inside the card `<div>` but not associated via `aria-labelledby`. When navigating by landmarks or headings, screen readers encounter "Detalii" as a heading and then a definition list — acceptable, but could be improved.
- **Fix:** Add `aria-labelledby` to the `<dl>` pointing to the `<h4 id="meta-details-heading">`.

**#A11Y-P1-6** | `client-task/client-task-materials-card.svelte:206–230` | Material action buttons only appear on hover (`opacity-0 group-hover:opacity-100`) — keyboard users who Tab to the download/more buttons will never see them focused

- **Standard:** WCAG 2.2 SC 2.4.11 Focus Not Obscured (Minimum); SC 2.4.7 Focus Visible
- **Evidence:**
  ```svelte
  <div class="ct-mat-actions flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
  ```
  Buttons inside this container are focusable (Tab will reach them) but visually invisible at rest and on focus — the `group-hover` only triggers on mouse hover, not keyboard focus.
- **Impact:** Keyboard users Tab to Download/More buttons they cannot see, violating focus-visible requirements.
- **Fix:** Add `group-focus-within:opacity-100` to the actions container class list.

**#A11Y-P1-7** | `client-task/client-task-team-card.svelte:71–79` | Team member remove button same hover-only visibility issue

- **Evidence:** `class="opacity-0 transition-opacity group-hover:opacity-100"` on the remove button.
- **Fix:** Add `group-focus-within:opacity-100`.

**#A11Y-P1-8** | `client-task/client-task-lightbox.svelte:64` | `role="dialog"` on overlay has `aria-label="Image lightbox"` — English label in Romanian UI

- **Fix:** Change to `aria-label="Galerie imagini"`.

### P2 — A11y polish

**#A11Y-P2-1** | `task-detail/task-detail-body.svelte` | Admin task rail `<details>/<summary>` elements use `list-none` which removes the browser's default disclosure triangle — no visible expand/collapse indicator

- **Standard:** WCAG 2.2 SC 2.4.11 Focus Not Obscured (advisory)
- **Evidence:** `class="flex cursor-pointer select-none list-none items-center justify-between p-4 text-sm font-semibold"` — `list-none` on `<summary>` hides the native disclosure marker. A custom `<ChevronLeft>` icon is provided but only shown with `md:hidden`, meaning on desktop there is no expand indicator at all.
- **Fix:** On desktop, always show the chevron icon regardless of breakpoint, or remove `md:hidden`.

**#A11Y-P2-2** | `client-task/client-task-activity-card.svelte:54` | Activity list overflow container (`max-h-[420px] overflow-y-auto`) has no accessible scroll announcement

- **Standard:** WCAG 2.2 SC 1.3.1
- **Fix:** Add `role="region"` and `aria-label="Lista de activitate"` to the scrollable container so screen readers can navigate to it as a landmark.

**#A11Y-P2-3** | `task-detail/task-detail-body.svelte` | Admin assignee online status indicator: `<span class="h-2 w-2 ... bg-emerald-400" title="Online">` — `title` only visible on mouse hover, not available to touch/keyboard users

- **Fix:** Replace `title="Online"` with `aria-label="Online"` + `role="img"`.

---

## Findings — UX Patterns

### P0 — Broken user flow

**#UX-P0-5** | `client-task/client-task-detail-body.svelte:147–150` | Loading state shows "Se încarcă..." plain text with no visual indicator

- **Design says:** Loading skeletons or a spinner for each card area
- **Code does:** `<p class="text-[#94a3b8] text-sm">Se încarcă...</p>` — a single line of text in the center of the page
- **Impact:** On slow connections, the user sees a blank white page with a small grey text. No skeleton, no skeleton cards, no spinner.
- **Fix:** Add skeleton cards matching the rail and main column layout for the loading state.

**#UX-P0-6** | `routes/client/[tenant]/(app)/team/+page.svelte:114–118` | Permissions button is wired to a no-op

- **Evidence:**
  ```svelte
  onPermissionsClick={() => {
    // Permissions matrix modal is out of scope for this redesign — keep existing
    // flow or open a separate page. For now: no-op.
  }}
  ```
- **Impact:** Client portal "Permisiuni" button visible in the header does nothing. Users who click it receive no feedback and no explanation. This is a dead interactive element.
- **Fix:** Either wire it to a working modal/page, or hide the button entirely until the feature is ready. At minimum add a toast: `toast.info('Funcție în curând disponibilă')`.

### P1 — Confusing or inconsistent

**#UX-P1-7** | Cross-component | Overdue label is "Overdue" (English) in client portal, "Overdue" in admin — neither uses Romanian "Depășit termen"

- **Evidence:** `client-task-page-head.svelte` line 90: `Overdue`; `task-detail-header.svelte` line 188: `Overdue`
- **Impact:** Inconsistency with a Romanian-first UI convention. The design reference also uses "Overdue" (lines 283, 400) — so this is technically a design reference conformance issue, but worth flagging as a copy improvement opportunity.
- **Fix:** Align with product decision: either change both to "Depășit termen" or keep "Overdue" globally. Currently it is consistent between admin and client, but mixed with Romanian in context.

**#UX-P1-8** | `client-task/client-task-progress-card.svelte:69` | Progress label uses "complet" but admin uses "complet" too — consistent, but English-adjacent phrasing

- **Evidence:** `{pct}% complet` — correct Romanian. Admin same. This is consistent.
- **No action needed.**

**#UX-P1-9** | `client-task/client-task-progress-card.svelte:48–50` | Delete subtask triggers `confirm()` (browser native dialog) — breaks consistent UX

- **Evidence:** `if (!confirm(\`Ștergi subtask "${s.title}"?\`)) return;`
- **Impact:** Native `confirm()` dialogs are visually inconsistent with the designed UI, block the main thread, and cannot be styled. Admin task-detail (`task-detail-body.svelte` line 742) uses the same pattern (`handleDeleteSubtask` has no confirm — but `handleUnlinkMaterial` does: line 415 `if (!task || !confirm('Elimini legătura cu acest material?')) return`).
- **Fix:** Replace `confirm()` with an inline confirmation popover or a toast-based undo pattern.

**#UX-P1-10** | `client-team/client-team-invite-modal.svelte` | Invite modal lacks "Funcție / Titlu" and message fields that the design includes

- **Design says:** Three extra fields: "Nume (opțional)", "Funcție / Titlu", "Mesaj (opțional)" (`Client Team.html` lines 218–241)
- **Code does:** Only "Email" and "Rol" fields — two fewer fields than the design
- **Impact:** The invite modal is functionally reduced vs. the design; incomplete implementation.
- **Fix:** Add the three fields. Note: the name/title/message fields may be UI-only at this stage (backend can store them) — confirm with backend schema.

**#UX-P1-11** | `client-team/+page.svelte:99` | Stats "pending" count uses `tasks.filter(t => t.status === 'pending-approval')` — counts client's own tasks, not approvals from the team page's context

- **Evidence:**
  ```svelte
  pending: tasks.filter((t: any) => t.status === 'pending-approval').length,
  openTasks: tasks.filter((t: any) => t.status !== 'done' && t.status !== 'cancelled').length
  ```
  Design's "Aprobări pending" refers to creative/budget approvals from team members, not task-approval-workflow items.
- **Impact:** Number shown may be misleading (tasks awaiting approval ≠ team member approvals).
- **Fix:** Clarify the intended semantic with the product team. If the stat is meant to show tasks awaiting approval, the label should say "Tasks în aprobare". If it means creative approvals, it needs a different data source.

### P2 — Polish

**#UX-P2-3** | `client-task/client-task-comments.svelte:252–258` | Comment timestamp uses full `ro-RO` date with time but design shows relative-like short format ("3 apr 2026")

- **Design says:** `"3 apr 2026"` — day + short month + year, no time
- **Code does:** `day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'` — includes time
- **Impact:** Comment timestamps show "3 apr, 14:30" which is more precise but deviates from the design's cleaner "3 apr 2026" format.
- **Fix:** Either match design format or use a relative format (e.g. "acum 2 zile") for recent comments, falling back to the full format for older ones.

**#UX-P2-4** | `client-task/client-task-materials-card.svelte:198–200` | Material meta shows `fmtDate(createdAt)` + `materialCategory` — design shows file size + date

- **Design says:** `{m.size} · {m.date}` — file size is visible (`Client Task Detail.html` lines 192–194)
- **Code does:** Shows `createdAt` date + `materialCategory` — file size is not displayed
- **Fix:** Add `materialFileSize` formatted as KB/MB to the meta row.

**#UX-P2-5** | Cross-component | "Back to Tasks" button text mixes English in Romanian UI

- **Evidence:** `client-task-page-head.svelte` line 119: `Back to Tasks` with English text
- **Fix:** Change to "Înapoi la Tasks" or "Înapoi" to match the admin panel's `task-detail-header.svelte` which uses "Înapoi".

---

## Cross-cutting Themes

The most systemic issue across the entire task module is **focus management for modal overlays**. Three separate modals (client lightbox, client Meet modal, client invite modal) plus the admin Meet modal all have the same pattern: a `role="dialog"` div with `tabindex` but without a `$effect` that moves focus into the dialog on open, and without a focus trap that prevents Tab from escaping. This suggests the focus management pattern was not established as a shared utility when the modals were built — each was implemented independently and all carry the same gap. The fix needs to be applied as a shared `useFocusTrap` action or Svelte `use:` directive to prevent the pattern from recurring.

The second systemic theme is **language consistency**. The application has a strong Romanian-first convention throughout most components, but several strings slip into English: "Active Members", "Pending Approvals", "Open Tasks" in stats; "Reply" in comments; `aria-label="React with {emoji}"` and `aria-label="Image lightbox"` in ARIA annotations; "Back to Tasks" in the page header; and "Overdue" throughout. These likely crept in during rapid development from English-language design tool annotation or copy-pasted code from English-language component references. A single pass through all user-visible strings against a Romanian glossary would close this class of issue.

---

## Statistics

**Components audited:** 20 (12 client-task, 6 client-team, task-detail-body, task-detail-header, task-comment-thread, task-activity-timeline)

**Design fidelity findings:**
- P0: 4
- P1: 6
- P2: 2

**Accessibility findings:**
- P0: 5 (4 focus management / WCAG 2.1.2 / 2.4.3; 1 language mismatch in ARIA)
- P1: 8
- P2: 3

**UX findings:**
- P0: 2 (loading skeleton missing; permissions button is dead)
- P1: 5
- P2: 3

**Total findings:** 38
**WCAG 2.2 AA Conformance:** DOES NOT CONFORM (5 P0 accessibility failures)
**Assistive Technology Compatibility:** PARTIAL — keyboard navigation works for most flows but modal focus management is broken across all three modal types
