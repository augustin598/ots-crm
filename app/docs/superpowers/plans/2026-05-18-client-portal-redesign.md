# Client Portal Redesign — Task Detail + Team 1:1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the dedicated client portal designs from `new_design/Client Task Detail.html` and `Client Team.html` as pixel-1:1 Svelte components, replacing the current generic `TaskDetailBody` reuse and the thin team-page wrapper.

**Architecture:** Build **dedicated client-only components** (under `src/lib/components/client-task/` and `src/lib/components/client-team/`) so admin and client views can evolve independently. Reuse only the small, behavior-only sub-components that already serve both worlds well (image lightbox, comment paste-image upload, subtask toggle remote, materials upload endpoint). Each new component is a thin shell over existing remotes — **no new backend work is required**.

**Tech Stack:** SvelteKit 5 + Svelte 5 runes (`$state`, `$derived`, `$effect`, `$props`) + Tailwind 4 with arbitrary values for design hex tokens (`bg-[#f7f8fa]`, `text-[#1877F2]`, etc.) + existing Drizzle remotes (`tasks.remote.ts`, `task-comments.remote.ts`, `task-materials.remote.ts`, `client-secondary-emails.remote.ts`).

---

## Context recap (so engineer doesn't need to re-explore)

### Current state
- `src/routes/client/[tenant]/(app)/tasks/[taskId]/+page.svelte` is a 32 LOC wrapper that calls `<TaskDetailBody mode="fullpage" isClient={true}>` — same component as admin, just with an `isClient` flag.
- `src/routes/client/[tenant]/(app)/team/+page.svelte` is 132 LOC, shows a KpiStrip + hero card, then delegates to `<ClientTeamEditor>` for the actual member list. No dedicated card grid.
- `TaskDetailBody` (1100+ LOC) has 4 `isClient` branches that hide admin-only controls but otherwise uses generic Tailwind/shadcn styling — does **not** match the design's `ct-*` and `cteam-*` token system.

### What the dedicated designs add
**Client Task Detail** (643 LOC HTML + 540 LOC CSS, prefix `ct-*`):
- `client-shell` flex container with custom topbar showing **breadcrumb path** (Settings › Tasks › title).
- Two-column page (`grid: 1fr 320px`): main column with title/pills/description/comments, right rail with stacked cards (Meta, Progress+Subtasks, Team, Materials, Activity).
- **Materials section** with 4 tabs (Toate / Foto / Video / Docs) each showing a count badge, items with colored gradient icons by type, hover-revealed download/menu buttons, dashed dropzone for upload.
- **Image lightbox** dedicated overlay (`ct-lb-*`) with prev/next nav, ESC + Arrow keys, click-outside-to-close, indexed caption.
- **Comments** with `ct-react` pill reactions (active when current user reacted), 2-level replies (`ct-replies` with left border indent), 180×180 image gallery thumbs with hover-zoom cursor, paste-Ctrl+V image upload.
- **Meet modal** dedicated 560px width, 14px radius, dedicated form (titlu / dată / oră / durată select / invitees pill list / 2 checkboxes for calendar + email).
- **Sticky-feel "Programează Google Meet"** button in page head with custom Meet brand SVG icon.

**Client Team** (separate file + 200+ LOC CSS, prefix `cteam-*`):
- Header with breadcrumb + title "Echipa {ClientName}" + subtitle stats line + search + Permisiuni + Invită coleg buttons.
- Blue gradient hero panel (`linear-gradient(135deg, #1877F2 0%, #0d5cc7 100%)`) with icon + CTA.
- 4-stat strip (Active Members / Online / Pending Approvals / Open Tasks).
- Horizontal-scroll filter chips per role (Toți / Owner / Manager / Marketing / Viewer) with color dots + counts.
- Responsive grid (`repeat(auto-fill, minmax(300px, 1fr))`) of member cards: avatar with online/offline indicator dot, name, title, role pill, email + phone + status, footer with "Adăugat {date}" + 2 quick-action buttons (Email, Mesaj).
- "+ Adaugă coleg" placeholder card at the end of grid.
- Modal (`cteam-modal`, 560px) for invite + permissions matrix.

### Reused (do **not** rewrite)
- `task-comment-thread.svelte` paste-image logic + `uploadImage()` → kept for behavior, but visual moves into new `client-task-comments.svelte`.
- `task-materials/upload/+server.ts` POST endpoint → unchanged.
- All `tasks.remote.ts` mutations (`toggleSubtask`, `addSubtask`, `addAssignee`, etc.) → unchanged.
- `scheduleMeet()` remote → unchanged.

### Design tokens (used throughout)
| Token | Hex |
|---|---|
| Page bg | `#f5f7fa` (task) / `#f4f6fa` (team) |
| Card bg | white |
| Card border | `#e5e9f0` |
| Card radius | 12-14px |
| Section divider | `#f1f5f9` |
| Text primary | `#0f172a` |
| Text muted | `#475569` (regular muted) / `#94a3b8` (placeholder/labels) / `#64748b` (medium) |
| Text on dark | `#334155` (comment body) |
| Accent blue (primary) | `#1877F2` (hover `#0d5cc7`) |
| Accent green | `#10b981` |
| Accent amber | `#f59e0b` |
| Accent red | `#ef4444` |
| Accent purple (img) | `#8b5cf6` (paired `#6d28d9`) |
| Accent pink (video) | `#ec4899` (paired `#be185d`) |
| Reaction active bg | `#f0f7ff` |
| Subtle surface | `#f7f8fa` (description bg, modal section bg) |
| Subtle border | `#d5dbe5` (inputs) |

---

## File structure (locked in before tasks)

### Phase 1 — Client Task Detail
**NEW** (all under `src/lib/components/client-task/`):
| File | Responsibility | LOC est. |
|---|---|---|
| `client-task-detail-body.svelte` | Top-level container; orchestrates main column + right rail; owns `currentTask` state + lightbox state + meet modal state | ~280 |
| `client-task-page-head.svelte` | `.ct-page-head` block — breadcrumb tag, title, pill row (status/priority/overdue/tags), Meet button, Back button | ~110 |
| `client-task-description.svelte` | `.ct-desc` block — rendered description with editable mode toggle (read-only for client unless creator) | ~70 |
| `client-task-comments.svelte` | `.ct-section` for comments — list of `.ct-comment` with reactions, replies (2 levels), 180×180 thumb gallery, paste-image textarea | ~330 |
| `client-task-meet-modal.svelte` | `.ct-meet-overlay` + `.ct-meet-modal` — 1:1 design modal for Google Meet scheduling | ~200 |
| `client-task-rail.svelte` | Right rail container (320px width); composes all 5 right-rail cards | ~60 |
| `client-task-meta-card.svelte` | `.ct-card` showing status / priority / due / created | ~120 |
| `client-task-progress-card.svelte` | `.ct-card` with progress bar + subtasks checklist + add-subtask input | ~150 |
| `client-task-team-card.svelte` | `.ct-card` with assignee avatars list + add-member popup | ~140 |
| `client-task-materials-card.svelte` | `.ct-card` with 4 tabs (Toate/Foto/Video/Docs) + list + dropzone, hooks into `getTaskMaterials` + upload endpoint | ~280 |
| `client-task-activity-card.svelte` | `.ct-card` with scrollable activity timeline (max-height 420px) | ~110 |
| `client-task-lightbox.svelte` | Dedicated `.ct-lb-overlay` lightbox (replaces the generic `image-lightbox.svelte` for client variant) — ESC + Arrow keys, indexed caption | ~120 |

**MODIFIED:**
- `src/routes/client/[tenant]/(app)/tasks/[taskId]/+page.svelte` — replace `<TaskDetailBody>` call with `<ClientTaskDetailBody>`; remove `isClient` prop wiring since the new component is client-only.

### Phase 2 — Client Team
**NEW** (under `src/lib/components/client-team/`):
| File | Responsibility | LOC est. |
|---|---|---|
| `client-team-page-header.svelte` | `.cteam-header` — breadcrumb + title + sub stats line + search input + 2 action buttons | ~100 |
| `client-team-hero.svelte` | `.cteam-hero` — blue gradient panel with icon + title + description + CTA button | ~70 |
| `client-team-stats.svelte` | `.cteam-stats` — 4-col grid (Active / Online / Pending / Open Tasks) | ~90 |
| `client-team-role-chips.svelte` | `.cteam-filters` — horizontal scrollable filter chips with color dots + counts; emits `roleFilter` change | ~110 |
| `client-team-member-card.svelte` | `.cteam-card` — single member card with avatar (online/offline dot), name, title, role pill, email, phone, status line, footer (added date + quick actions) | ~190 |
| `client-team-add-card.svelte` | `.cteam-add` — dashed dropzone-style placeholder card "+ Adaugă coleg" | ~50 |
| `client-team-invite-modal.svelte` | `.cteam-modal` — invite form (email + role select + permissions preview) | ~220 |

**MODIFIED:**
- `src/routes/client/[tenant]/(app)/team/+page.svelte` — full rewrite using new components; keep existing `ClientTeamEditor` ONLY for the deeper permissions matrix dialog if the user opens "Permisiuni" — or move all logic into new components and delete the old editor's UI layer.

### Out of scope (deferred to follow-up)
- Permissions matrix table (the deep "Permisiuni" modal). The current `<TeamPermissionsMatrix />` keeps working; only the surrounding page is redesigned.
- Backend additions: design uses some signals we don't track (presence/online, lastActive). Implement as **proxies** using task activity counts (see Phase 2 Task 3).
- Audit logging additions are NOT needed — existing `recordTaskActivity` covers the activity card.

---

## Phase 1 — Client Task Detail

### Task 1: Dedicated image lightbox component

**Files:**
- Create: `src/lib/components/client-task/client-task-lightbox.svelte`

- [ ] **Step 1: Build the component**

```svelte
<!-- src/lib/components/client-task/client-task-lightbox.svelte -->
<script lang="ts">
	import XIcon from '@lucide/svelte/icons/x';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';

	export type LightboxImage = { url: string; name?: string };

	type Props = {
		images: LightboxImage[];
		index: number;
		open: boolean;
		onClose: () => void;
		onIndexChange: (newIndex: number) => void;
	};

	let { images, index, open, onClose, onIndexChange }: Props = $props();

	function nav(delta: number) {
		const next = (index + delta + images.length) % images.length;
		onIndexChange(next);
	}

	$effect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.preventDefault();
				onClose();
			} else if (e.key === 'ArrowLeft' && images.length > 1) {
				e.preventDefault();
				nav(-1);
			} else if (e.key === 'ArrowRight' && images.length > 1) {
				e.preventDefault();
				nav(1);
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	const current = $derived(images[index]);
</script>

{#if open && current}
	<div
		class="ct-lb-overlay fixed inset-0 z-[300] flex items-center justify-center bg-black/85"
		onclick={onClose}
		role="dialog"
		aria-modal="true"
		aria-label="Image lightbox"
	>
		<button
			type="button"
			class="ct-lb-close absolute right-5 top-5 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
			onclick={(e) => {
				e.stopPropagation();
				onClose();
			}}
			aria-label="Închide"
		>
			<XIcon class="h-5 w-5" />
		</button>

		{#if images.length > 1}
			<button
				type="button"
				class="ct-lb-nav prev absolute left-5 top-1/2 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
				onclick={(e) => {
					e.stopPropagation();
					nav(-1);
				}}
				aria-label="Anterior"
			>
				<ChevronLeftIcon class="h-6 w-6" />
			</button>
			<button
				type="button"
				class="ct-lb-nav next absolute right-5 top-1/2 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
				onclick={(e) => {
					e.stopPropagation();
					nav(1);
				}}
				aria-label="Următor"
			>
				<ChevronRightIcon class="h-6 w-6" />
			</button>
		{/if}

		<div
			class="ct-lb-img max-h-[85vh] max-w-[90vw] rounded-lg"
			onclick={(e) => e.stopPropagation()}
			role="presentation"
		>
			<img
				src={current.url}
				alt={current.name ?? `Image ${index + 1}`}
				class="block max-h-[85vh] max-w-[90vw] rounded-lg object-contain"
			/>
		</div>

		<div
			class="ct-lb-caption absolute bottom-8 left-1/2 -translate-x-1/2 rounded-full bg-black/40 px-3.5 py-1.5 text-xs text-white"
		>
			{index + 1} / {images.length}{current.name ? ` · ${current.name}` : ''}
		</div>
	</div>
{/if}
```

- [ ] **Step 2: Verify Svelte 5 idioms**

Run: `npx mcp__plugin_svelte_svelte__svelte-autofixer` on the file (or open Svelte MCP and paste).
Expected: `{"issues":[],"suggestions":[]}`. If issues, fix per autofixer output.

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/client-task/client-task-lightbox.svelte
git commit -m "feat(client-task): dedicated lightbox 1:1 with ct-lb design"
```

### Task 2: Page head component (breadcrumb + title + pills + actions)

**Files:**
- Create: `src/lib/components/client-task/client-task-page-head.svelte`

- [ ] **Step 1: Build the component**

```svelte
<!-- src/lib/components/client-task/client-task-page-head.svelte -->
<script lang="ts">
	import type { Task } from '$lib/server/db/schema';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import { formatPriority, formatStatus } from '$lib/components/task-kanban-utils';
	import { isTaskOverdue } from '$lib/utils/task-filters';

	type TagInfo = { id?: string; name: string; color?: string | null };

	type Props = {
		task: Task;
		clientName: string | null;
		tags: TagInfo[];
		onBack: () => void;
		onScheduleMeet: () => void;
	};

	let { task, clientName, tags, onBack, onScheduleMeet }: Props = $props();

	const overdue = $derived(
		task.status !== 'done' && task.status !== 'cancelled' && isTaskOverdue(task.dueDate)
	);

	function statusColors(s: string | null) {
		switch (s) {
			case 'pending-approval':
				return { color: '#b45309', bg: '#fef3c7' };
			case 'todo':
				return { color: '#475569', bg: '#f1f5f9' };
			case 'in-progress':
				return { color: '#1d4ed8', bg: '#dbeafe' };
			case 'review':
				return { color: '#6d28d9', bg: '#ede9fe' };
			case 'done':
				return { color: '#047857', bg: '#d1fae5' };
			case 'cancelled':
			case 'blocked':
				return { color: '#b91c1c', bg: '#fee2e2' };
			default:
				return { color: '#475569', bg: '#f1f5f9' };
		}
	}

	function priorityColors(p: string | null) {
		switch (p) {
			case 'urgent':
				return { color: '#b91c1c', bg: '#fee2e2' };
			case 'high':
				return { color: '#b45309', bg: '#fef3c7' };
			case 'medium':
				return { color: '#047857', bg: '#d1fae5' };
			case 'low':
				return { color: '#475569', bg: '#e2e8f0' };
			default:
				return { color: '#475569', bg: '#e2e8f0' };
		}
	}

	const sCol = $derived(statusColors(task.status));
	const pCol = $derived(priorityColors(task.priority));
</script>

<div class="ct-page-head flex flex-wrap items-start justify-between gap-3">
	<div class="flex-1 min-w-0">
		<div class="ct-crumb-tag mb-2 inline-flex items-center gap-1.5 rounded-md bg-[#f7f8fa] px-2.5 py-1 text-[11px] font-semibold text-[#475569]">
			Task{clientName ? ` · ${clientName}` : ''}
		</div>
		<h1 class="ct-title text-[26px] font-bold leading-tight tracking-tight text-[#0f172a]">
			{task.title}
		</h1>
		<div class="ct-pills mt-3 flex flex-wrap items-center gap-2">
			<span
				class="ct-pill inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold"
				style:background-color={sCol.bg}
				style:color={sCol.color}
			>
				<span class="h-1.5 w-1.5 rounded-full" style:background-color={sCol.color}></span>
				{formatStatus(task.status ?? 'todo')}
			</span>
			<span
				class="ct-pill inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold"
				style:background-color={pCol.bg}
				style:color={pCol.color}
			>
				<span class="h-1.5 w-1.5 rounded-full" style:background-color={pCol.color}></span>
				{formatPriority(task.priority ?? 'medium')}
			</span>
			{#if overdue}
				<span
					class="ct-pill inline-flex items-center gap-1.5 rounded-full bg-[#fee2e2] px-3 py-1.5 text-[12px] font-semibold text-[#b91c1c]"
				>
					<span class="h-1.5 w-1.5 rounded-full bg-[#b91c1c]"></span>
					Overdue
				</span>
			{/if}
			{#each tags as t (t.id ?? t.name)}
				<span class="text-[11.5px] font-semibold text-[#1877F2]">#{t.name}</span>
			{/each}
		</div>
	</div>

	<div class="flex items-center gap-2 shrink-0">
		<button
			type="button"
			class="ct-meet-btn inline-flex items-center gap-2 rounded-lg bg-[#10b981] px-3 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-[#0e9572]"
			onclick={onScheduleMeet}
		>
			<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true" class="shrink-0">
				<path d="M16 8.5V12.5L20 16V5L16 8.5Z" fill="#a7f3d0" />
				<path d="M3 6V18C3 18.5523 3.44772 19 4 19H14C14.5523 19 15 18.5523 15 18V14L11 14V6H3Z" fill="white" />
				<path d="M11 6V14H15V10L11 6Z" fill="#fef08a" />
				<path d="M15 14L11 10V14H15Z" fill="#fca5a5" />
				<path d="M11 6L15 10V6H11Z" fill="#bbf7d0" />
			</svg>
			Programează Google Meet
		</button>
		<button
			type="button"
			class="ct-back inline-flex items-center gap-1.5 rounded-lg border border-[#e5e9f0] bg-white px-3 py-2 text-[12.5px] font-semibold text-[#475569] transition-colors hover:border-[#1877F2] hover:text-[#0f172a]"
			onclick={onBack}
		>
			<ChevronLeftIcon class="h-3.5 w-3.5" />
			Back to Tasks
		</button>
	</div>
</div>
```

- [ ] **Step 2: Run autofixer**

Use the Svelte MCP autofixer tool on `client-task-page-head.svelte`. Fix any issues reported.

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/client-task/client-task-page-head.svelte
git commit -m "feat(client-task): page head with breadcrumb + title + pills + Meet/Back"
```

### Task 3: Description section + comments component

**Files:**
- Create: `src/lib/components/client-task/client-task-description.svelte`
- Create: `src/lib/components/client-task/client-task-comments.svelte`

- [ ] **Step 1: Description component**

```svelte
<!-- src/lib/components/client-task/client-task-description.svelte -->
<script lang="ts">
	type Props = {
		description: string | null;
	};
	let { description }: Props = $props();
</script>

{#if description?.trim()}
	<div
		class="ct-desc rounded-[10px] border border-[#e5e9f0] bg-[#f7f8fa] p-4 text-[13.5px] leading-[1.65] text-[#334155]"
	>
		<pre class="whitespace-pre-wrap break-words font-sans">{description}</pre>
	</div>
{/if}
```

- [ ] **Step 2: Comments component**

The comments section is large. It mirrors `task-comment-thread.svelte` behavior but with the `ct-comment` token system. Build it by adapting from the existing thread. Key points:

```svelte
<!-- src/lib/components/client-task/client-task-comments.svelte -->
<script lang="ts">
	import {
		getTaskComments,
		createTaskComment,
		deleteTaskComment,
		updateTaskComment,
		toggleCommentReaction
	} from '$lib/remotes/task-comments.remote';
	import { uploadCommentImage } from '$lib/remotes/task-comments.remote';
	import RichEditor from '$lib/components/RichEditor/RichEditor.svelte';
	import { avatarColor, avatarInitials } from '$lib/config/team';
	import type { LightboxImage } from './client-task-lightbox.svelte';
	import RepeatIcon from '@lucide/svelte/icons/repeat';
	import SmilePlusIcon from '@lucide/svelte/icons/smile-plus';
	import ImageIcon from '@lucide/svelte/icons/image';

	const REACTIONS = ['👍', '🔥', '🎉'] as const;

	type Props = {
		taskId: string;
		currentUserId: string;
		onOpenLightbox: (images: LightboxImage[], startIndex: number) => void;
	};

	let { taskId, currentUserId, onOpenLightbox }: Props = $props();

	const commentsQuery = $derived(getTaskComments(taskId));
	const comments = $derived(commentsQuery.current ?? []);

	let editorRef = $state<RichEditor | null>(null);
	let pendingImages = $state<{ url: string; name: string }[]>([]);
	let replyTargetId = $state<string | null>(null);

	async function handlePasteImage(file: File): Promise<string> {
		const url = await uploadCommentImage({ taskId, file });
		pendingImages = [...pendingImages, { url, name: file.name }];
		return url;
	}

	async function submitComment(html: string) {
		await createTaskComment({
			taskId,
			content: html,
			parentId: replyTargetId,
			attachments: pendingImages.map((p) => ({ url: p.url, name: p.name }))
		}).updates(getTaskComments(taskId));
		pendingImages = [];
		replyTargetId = null;
		editorRef?.clear();
	}

	async function react(commentId: string, emoji: string) {
		await toggleCommentReaction({ commentId, emoji }).updates(getTaskComments(taskId));
	}

	function authorInitials(c: any): string {
		return avatarInitials(c.authorFirstName ?? null, c.authorLastName ?? null, c.authorEmail ?? null);
	}
	function authorColor(c: any): string {
		return avatarColor(c.authorEmail ?? c.authorId ?? '');
	}
</script>

<div class="ct-section">
	<div class="ct-section-head mb-4 flex items-center gap-2">
		<span class="grid h-7 w-7 place-items-center rounded-md bg-[#f0f7ff] text-[#1877F2]">
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
		</span>
		<h3 class="text-[15px] font-bold text-[#0f172a]">
			Comentarii ({comments.length})
		</h3>
	</div>

	<div class="ct-comments-list flex flex-col">
		{#each comments as c (c.id)}
			{@const isMine = c.authorId === currentUserId}
			<div class="ct-comment flex gap-3 border-b border-[#f1f5f9] py-3.5 last:border-b-0">
				<div
					class="ct-comment-av grid h-9 w-9 shrink-0 place-items-center rounded-full text-[12px] font-bold text-white"
					style:background-color={authorColor(c)}
				>
					{authorInitials(c)}
				</div>
				<div class="ct-comment-body flex-1 min-w-0">
					<div class="ct-comment-head flex items-baseline gap-2">
						<span class="ct-comment-name text-[12.5px] font-bold text-[#0f172a]">
							{c.authorName ?? 'Anonim'}
						</span>
						<span class="ct-comment-time text-[11px] text-[#94a3b8]">
							{new Date(c.createdAt).toLocaleDateString('ro-RO', {
								day: 'numeric',
								month: 'short',
								hour: '2-digit',
								minute: '2-digit'
							})}
						</span>
						<button
							type="button"
							class="ct-comment-reply ml-auto inline-flex items-center gap-1 rounded text-[11px] text-[#94a3b8] hover:text-[#1877F2]"
							onclick={() => (replyTargetId = c.id)}
							aria-label="Răspunde"
						>
							<RepeatIcon class="h-3 w-3" />
							Reply
						</button>
					</div>
					<div class="ct-comment-text mt-1 text-[13.5px] leading-[1.65] text-[#334155]">
						{@html c.content}
					</div>

					{#if c.attachments && c.attachments.length > 0}
						<div class="ct-gallery mt-2 grid gap-2" style:grid-template-columns="repeat(auto-fill, 180px)">
							{#each c.attachments as att, i (att.url)}
								<button
									type="button"
									class="ct-thumb relative h-[180px] w-[180px] cursor-zoom-in overflow-hidden rounded-[9px] border border-[#e5e9f0]"
									style:background="linear-gradient(135deg, #fafbfd, #e5e9f0)"
									onclick={() =>
										onOpenLightbox(
											c.attachments.map((a: any) => ({ url: a.url, name: a.name })),
											i
										)}
									aria-label={`Deschide ${att.name ?? 'imaginea'}`}
								>
									{#if att.url.match(/\.(jpe?g|png|gif|webp)$/i)}
										<img src={att.url} alt={att.name ?? ''} class="h-full w-full object-cover" />
									{:else}
										<ImageIcon class="m-auto h-12 w-12 text-[#94a3b8]" />
									{/if}
									{#if att.name}
										<div
											class="ct-thumb-name absolute bottom-0 left-0 right-0 px-2 py-1 text-[11px] text-white"
											style:background="linear-gradient(180deg, transparent, rgba(0,0,0,.55))"
										>
											{att.name}
										</div>
									{/if}
								</button>
							{/each}
						</div>
					{/if}

					<div class="ct-react-bar mt-2 flex flex-wrap items-center gap-1.5">
						{#each REACTIONS as emoji (emoji)}
							{@const reactionList = (c.reactions ?? []).filter((r: any) => r.emoji === emoji)}
							{@const mine = reactionList.some((r: any) => r.userId === currentUserId)}
							{#if reactionList.length > 0 || true}
								<button
									type="button"
									class={[
										'ct-react inline-flex items-center gap-1 rounded-full border px-[9px] py-[3px] text-[11.5px] transition-colors',
										mine
											? 'border-[#1877F2] bg-[#f0f7ff] text-[#1877F2]'
											: 'border-[#e5e9f0] bg-white text-[#475569] hover:border-[#1877F2]'
									].join(' ')}
									onclick={() => react(c.id, emoji)}
									aria-label={`React with ${emoji}`}
								>
									{emoji}
									{#if reactionList.length > 0}
										<span>{reactionList.length}</span>
									{/if}
								</button>
							{/if}
						{/each}
					</div>

					{#if c.replies && c.replies.length > 0}
						<div class="ct-replies mt-3 flex flex-col gap-2.5 border-l-2 border-[#e5e9f0] pl-3.5">
							{#each c.replies as r (r.id)}
								<div class="flex gap-2.5">
									<div
										class="ct-reply-av grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white"
										style:background-color={authorColor(r)}
									>
										{authorInitials(r)}
									</div>
									<div class="flex-1 min-w-0">
										<div class="flex items-baseline gap-2">
											<span class="text-[12px] font-bold text-[#0f172a]">
												{r.authorName ?? 'Anonim'}
											</span>
											<span class="text-[11px] text-[#94a3b8]">
												{new Date(r.createdAt).toLocaleDateString('ro-RO', {
													day: 'numeric',
													month: 'short'
												})}
											</span>
										</div>
										<div class="mt-1 text-[13px] text-[#334155]">
											{@html r.content}
										</div>
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			</div>
		{/each}
	</div>

	<!-- Composer -->
	<div class="mt-4">
		{#if replyTargetId}
			<div class="mb-2 inline-flex items-center gap-2 rounded-md bg-[#f0f7ff] px-2.5 py-1 text-[11.5px] text-[#1877F2]">
				Răspuns la un comentariu
				<button
					type="button"
					class="hover:underline"
					onclick={() => (replyTargetId = null)}
				>Anulează</button>
			</div>
		{/if}
		<RichEditor
			bind:this={editorRef}
			placeholder="Adaugă un comentariu... (paste imagine cu Ctrl+V)"
			onPasteImage={handlePasteImage}
			onSubmit={submitComment}
		/>
		{#if pendingImages.length > 0}
			<div class="mt-2 flex flex-wrap gap-2">
				{#each pendingImages as p, i (p.url)}
					<div class="relative h-16 w-16 overflow-hidden rounded-md border border-[#e5e9f0]">
						<img src={p.url} alt={p.name} class="h-full w-full object-cover" />
						<button
							type="button"
							class="absolute right-0.5 top-0.5 grid h-4 w-4 place-items-center rounded-full bg-black/60 text-white"
							onclick={() => (pendingImages = pendingImages.filter((_, idx) => idx !== i))}
							aria-label="Elimină imaginea"
						>×</button>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
```

> NOTE FOR ENGINEER: If `uploadCommentImage` / `toggleCommentReaction` / `attachments` field names differ in your repo's `task-comments.remote.ts`, adapt the imports/access paths. The existing `task-comment-thread.svelte` is the source of truth — copy the call signatures from there.

- [ ] **Step 3: Run autofixer on both files**

For each: Svelte MCP autofixer → fix issues → re-run until clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/client-task/client-task-description.svelte src/lib/components/client-task/client-task-comments.svelte
git commit -m "feat(client-task): description + comments 1:1 with ct-desc + ct-comment"
```

### Task 4: Right rail — meta card

**Files:**
- Create: `src/lib/components/client-task/client-task-meta-card.svelte`

- [ ] **Step 1: Build component**

```svelte
<!-- src/lib/components/client-task/client-task-meta-card.svelte -->
<script lang="ts">
	import type { Task } from '$lib/server/db/schema';
	import UserIcon from '@lucide/svelte/icons/user';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import FlameIcon from '@lucide/svelte/icons/flame';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import { formatStatus, formatPriority } from '$lib/components/task-kanban-utils';

	type Props = {
		task: Task;
		createdByName: string | null;
	};
	let { task, createdByName }: Props = $props();

	function fmtDate(d: Date | string | null | undefined): string {
		if (!d) return '—';
		const date = d instanceof Date ? d : new Date(d);
		return date.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' });
	}
</script>

<div class="ct-card rounded-[12px] border border-[#e5e9f0] bg-white p-[18px]">
	<div class="ct-section-head mb-3 flex items-center gap-2">
		<h4 class="text-[13px] font-bold uppercase tracking-[.04em] text-[#0f172a]">Detalii</h4>
	</div>
	<dl class="flex flex-col gap-3 text-[13px]">
		<div class="flex items-start gap-2">
			<UserIcon class="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#94a3b8]" />
			<div class="flex-1 min-w-0">
				<dt class="text-[11px] font-semibold uppercase tracking-[.04em] text-[#94a3b8]">Status</dt>
				<dd class="font-semibold text-[#0f172a]">{formatStatus(task.status ?? 'todo')}</dd>
			</div>
		</div>
		<div class="flex items-start gap-2">
			<FlameIcon class="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#94a3b8]" />
			<div class="flex-1 min-w-0">
				<dt class="text-[11px] font-semibold uppercase tracking-[.04em] text-[#94a3b8]">Prioritate</dt>
				<dd class="font-semibold text-[#0f172a]">{formatPriority(task.priority ?? 'medium')}</dd>
			</div>
		</div>
		<div class="flex items-start gap-2">
			<CalendarIcon class="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#94a3b8]" />
			<div class="flex-1 min-w-0">
				<dt class="text-[11px] font-semibold uppercase tracking-[.04em] text-[#94a3b8]">Due date</dt>
				<dd class="font-semibold text-[#0f172a]">{fmtDate(task.dueDate)}</dd>
			</div>
		</div>
		<div class="flex items-start gap-2">
			<ClockIcon class="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#94a3b8]" />
			<div class="flex-1 min-w-0">
				<dt class="text-[11px] font-semibold uppercase tracking-[.04em] text-[#94a3b8]">Creat</dt>
				<dd class="font-semibold text-[#0f172a]">
					{fmtDate(task.createdAt)}{createdByName ? ` · ${createdByName}` : ''}
				</dd>
			</div>
		</div>
	</dl>
</div>
```

- [ ] **Step 2: Autofixer + commit**

```bash
git add src/lib/components/client-task/client-task-meta-card.svelte
git commit -m "feat(client-task): meta card (status/priority/due/created) per ct-card"
```

### Task 5: Right rail — progress + subtasks card

**Files:**
- Create: `src/lib/components/client-task/client-task-progress-card.svelte`

- [ ] **Step 1: Build component**

```svelte
<!-- src/lib/components/client-task/client-task-progress-card.svelte -->
<script lang="ts">
	import { toggleSubtask, addSubtask, deleteSubtask } from '$lib/remotes/tasks.remote';
	import { getTask } from '$lib/remotes/tasks.remote';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import XIcon from '@lucide/svelte/icons/x';
	import CheckSquare2Icon from '@lucide/svelte/icons/check-square-2';

	type Subtask = { id: string; title: string; done: number | boolean; position: number };

	type Props = {
		taskId: string;
		subtasks: Subtask[];
	};

	let { taskId, subtasks }: Props = $props();

	let newTitle = $state('');
	let pending = $state<Record<string, boolean>>({});

	const done = $derived(subtasks.filter((s) => !!s.done).length);
	const total = $derived(subtasks.length);
	const pct = $derived(total === 0 ? 0 : Math.round((done / total) * 100));

	async function handleToggle(s: Subtask) {
		pending = { ...pending, [s.id]: true };
		try {
			await toggleSubtask(s.id).updates(getTask(taskId));
		} finally {
			const { [s.id]: _, ...rest } = pending;
			pending = rest;
		}
	}

	async function handleAdd(e: SubmitEvent) {
		e.preventDefault();
		const title = newTitle.trim();
		if (!title) return;
		newTitle = '';
		await addSubtask({ taskId, title }).updates(getTask(taskId));
	}

	async function handleDelete(s: Subtask) {
		if (!confirm(`Ștergi subtask "${s.title}"?`)) return;
		await deleteSubtask(s.id).updates(getTask(taskId));
	}
</script>

<div class="ct-card rounded-[12px] border border-[#e5e9f0] bg-white p-[18px]">
	<div class="ct-section-head mb-3 flex items-center gap-2">
		<CheckSquare2Icon class="h-3.5 w-3.5 text-[#475569]" />
		<h4 class="text-[13px] font-bold uppercase tracking-[.04em] text-[#0f172a]">
			Progres ({done}/{total})
		</h4>
	</div>

	<div class="ct-progress-bar h-2 overflow-hidden rounded-full bg-[#f1f5f9]">
		<div
			class="ct-progress-fill h-full rounded-full transition-[width] duration-300"
			style:width={`${pct}%`}
			style:background="linear-gradient(90deg, #1877F2, #10b981)"
		></div>
	</div>
	<div class="ct-progress-meta mt-1.5 flex justify-between text-[11px] text-[#94a3b8]">
		<span>{pct}% complet</span>
		<span>{total - done} rămase</span>
	</div>

	<ul class="mt-3 flex flex-col">
		{#each subtasks as s (s.id)}
			{@const isDone = !!s.done}
			<li class={`ct-subtask group flex items-center gap-2.5 border-b border-[#f1f5f9] py-2 last:border-b-0 ${isDone ? 'done' : ''}`}>
				<input
					type="checkbox"
					checked={isDone}
					disabled={pending[s.id]}
					onchange={() => handleToggle(s)}
					class="h-4 w-4 cursor-pointer rounded border-[1.5px] border-[#cbd5e1] accent-[#10b981]"
					aria-label={`Toggle ${s.title}`}
				/>
				<span class={`flex-1 text-[13px] ${isDone ? 'text-[#94a3b8] line-through' : 'text-[#0f172a]'}`}>
					{s.title}
				</span>
				<button
					type="button"
					class="opacity-0 transition-opacity group-hover:opacity-100 text-[#94a3b8] hover:text-[#ef4444]"
					onclick={() => handleDelete(s)}
					aria-label={`Șterge ${s.title}`}
				>
					<XIcon class="h-3.5 w-3.5" />
				</button>
			</li>
		{/each}
	</ul>

	<form onsubmit={handleAdd} class="mt-3 flex items-center gap-2">
		<input
			type="text"
			bind:value={newTitle}
			placeholder="Adaugă subtask..."
			class="flex-1 rounded-[7px] border border-[#d5dbe5] bg-white px-2.5 py-1.5 text-[12.5px] text-[#0f172a] focus:border-[#1877F2] focus:outline-none focus:ring-2 focus:ring-[#1877F2]/12"
		/>
		<button
			type="submit"
			disabled={!newTitle.trim()}
			class="grid h-7 w-7 place-items-center rounded-[7px] bg-[#1877F2] text-white transition-colors hover:bg-[#0d5cc7] disabled:opacity-50"
			aria-label="Adaugă subtask"
		>
			<PlusIcon class="h-3.5 w-3.5" />
		</button>
	</form>
</div>
```

- [ ] **Step 2: Autofixer + commit**

```bash
git add src/lib/components/client-task/client-task-progress-card.svelte
git commit -m "feat(client-task): progress + subtasks card per ct-card design"
```

### Task 6: Right rail — team card

**Files:**
- Create: `src/lib/components/client-task/client-task-team-card.svelte`

- [ ] **Step 1: Build component**

```svelte
<!-- src/lib/components/client-task/client-task-team-card.svelte -->
<script lang="ts">
	import { avatarColor, avatarInitials } from '$lib/config/team';
	import UsersIcon from '@lucide/svelte/icons/users';
	import XIcon from '@lucide/svelte/icons/x';

	type Assignee = {
		id: string;
		firstName?: string | null;
		lastName?: string | null;
		email?: string | null;
		displayName?: string | null;
		online?: boolean;
	};

	type Props = {
		assignees: Assignee[];
		readonly?: boolean;
		onRemove?: (assigneeId: string) => void;
		onAddClick?: () => void;
	};

	let { assignees, readonly = false, onRemove, onAddClick }: Props = $props();

	function displayName(a: Assignee): string {
		if (a.displayName) return a.displayName;
		const full = `${a.firstName ?? ''} ${a.lastName ?? ''}`.trim();
		return full || a.email || a.id;
	}
</script>

<div class="ct-card rounded-[12px] border border-[#e5e9f0] bg-white p-[18px]">
	<div class="ct-section-head mb-3 flex items-center justify-between">
		<div class="flex items-center gap-2">
			<UsersIcon class="h-3.5 w-3.5 text-[#475569]" />
			<h4 class="text-[13px] font-bold uppercase tracking-[.04em] text-[#0f172a]">
				Echipă ({assignees.length})
			</h4>
		</div>
		{#if !readonly && onAddClick}
			<button
				type="button"
				class="text-[11.5px] font-semibold text-[#1877F2] hover:underline"
				onclick={onAddClick}
			>
				+ Adaugă
			</button>
		{/if}
	</div>

	{#if assignees.length === 0}
		<div class="text-[12px] text-[#94a3b8]">Nimeni asignat încă.</div>
	{:else}
		<ul class="flex flex-col gap-2">
			{#each assignees as a (a.id)}
				<li class="group flex items-center gap-2.5">
					<div
						class="relative grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white"
						style:background-color={avatarColor(a.email ?? a.id)}
					>
						{avatarInitials(a.firstName ?? null, a.lastName ?? null, a.email ?? null)}
						{#if a.online !== undefined}
							<span
								class={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white ${a.online ? 'bg-[#10b981]' : 'bg-[#cbd5e1]'}`}
							></span>
						{/if}
					</div>
					<span class="flex-1 truncate text-[13px] font-semibold text-[#0f172a]">
						{displayName(a)}
					</span>
					{#if !readonly && onRemove}
						<button
							type="button"
							class="opacity-0 transition-opacity group-hover:opacity-100 text-[#94a3b8] hover:text-[#ef4444]"
							onclick={() => onRemove(a.id)}
							aria-label={`Scoate ${displayName(a)}`}
						>
							<XIcon class="h-3.5 w-3.5" />
						</button>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>
```

- [ ] **Step 2: Autofixer + commit**

```bash
git add src/lib/components/client-task/client-task-team-card.svelte
git commit -m "feat(client-task): team card with avatars + online dots"
```

### Task 7: Right rail — materials card with tabs

**Files:**
- Create: `src/lib/components/client-task/client-task-materials-card.svelte`

- [ ] **Step 1: Build component**

```svelte
<!-- src/lib/components/client-task/client-task-materials-card.svelte -->
<script lang="ts">
	import { getTaskMaterials } from '$lib/remotes/task-materials.remote';
	import { page } from '$app/state';
	import ImageIcon from '@lucide/svelte/icons/image';
	import VideoIcon from '@lucide/svelte/icons/video';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import ArchiveIcon from '@lucide/svelte/icons/archive';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import MoreVerticalIcon from '@lucide/svelte/icons/more-vertical';
	import PaperclipIcon from '@lucide/svelte/icons/paperclip';
	import UploadIcon from '@lucide/svelte/icons/upload';
	import type { LightboxImage } from './client-task-lightbox.svelte';

	type Props = {
		taskId: string;
		onOpenLightbox: (images: LightboxImage[], startIndex: number) => void;
	};

	let { taskId, onOpenLightbox }: Props = $props();

	type MaterialType = 'img' | 'vid' | 'doc' | 'zip';

	type Material = {
		id: string;
		name: string;
		url: string;
		mimeType: string | null;
		sizeBytes: number | null;
		uploadedAt: Date | string;
	};

	const materialsQuery = $derived(getTaskMaterials(taskId));
	const materials = $derived<Material[]>(materialsQuery.current ?? []);

	let tab = $state<'all' | 'img' | 'vid' | 'doc'>('all');
	let fileInput = $state<HTMLInputElement | null>(null);
	let uploading = $state(false);
	let dragOver = $state(false);

	function typeOf(m: Material): MaterialType {
		const mime = (m.mimeType ?? '').toLowerCase();
		const name = m.name.toLowerCase();
		if (mime.startsWith('image/') || /\.(jpe?g|png|gif|webp|svg)$/.test(name)) return 'img';
		if (mime.startsWith('video/') || /\.(mp4|mov|webm|mkv)$/.test(name)) return 'vid';
		if (/\.(zip|rar|7z|tar|gz)$/.test(name)) return 'zip';
		return 'doc';
	}

	const counts = $derived({
		all: materials.length,
		img: materials.filter((m) => typeOf(m) === 'img').length,
		vid: materials.filter((m) => typeOf(m) === 'vid').length,
		doc: materials.filter((m) => typeOf(m) === 'doc' || typeOf(m) === 'zip').length
	});

	const filtered = $derived.by(() => {
		if (tab === 'all') return materials;
		if (tab === 'doc') return materials.filter((m) => typeOf(m) === 'doc' || typeOf(m) === 'zip');
		return materials.filter((m) => typeOf(m) === tab);
	});

	const imagesInTab = $derived<LightboxImage[]>(
		filtered
			.filter((m) => typeOf(m) === 'img')
			.map((m) => ({ url: m.url, name: m.name }))
	);

	function iconGradient(t: MaterialType): string {
		switch (t) {
			case 'img':
				return 'linear-gradient(135deg, #8b5cf6, #6d28d9)';
			case 'vid':
				return 'linear-gradient(135deg, #ec4899, #be185d)';
			case 'doc':
				return 'linear-gradient(135deg, #1877F2, #0d5cc7)';
			case 'zip':
				return 'linear-gradient(135deg, #f59e0b, #b45309)';
		}
	}

	function fmtSize(bytes: number | null): string {
		if (!bytes) return '—';
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	function fmtDate(d: Date | string): string {
		const date = d instanceof Date ? d : new Date(d);
		return date.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' });
	}

	async function uploadFiles(files: FileList | File[]) {
		const list = Array.from(files);
		if (list.length === 0) return;
		uploading = true;
		const tenant = page.params.tenant;
		try {
			for (const f of list) {
				const fd = new FormData();
				fd.append('file', f);
				fd.append('taskId', taskId);
				await fetch(`/${tenant}/task-materials/upload`, { method: 'POST', body: fd });
			}
			await materialsQuery.refresh?.();
		} finally {
			uploading = false;
		}
	}

	function handleClickItem(m: Material) {
		if (typeOf(m) === 'img') {
			const index = imagesInTab.findIndex((i) => i.url === m.url);
			if (index >= 0) onOpenLightbox(imagesInTab, index);
		} else {
			window.open(m.url, '_blank');
		}
	}
</script>

<div class="ct-card rounded-[12px] border border-[#e5e9f0] bg-white p-[18px]">
	<div class="ct-section-head mb-3 flex items-center gap-2">
		<PaperclipIcon class="h-3.5 w-3.5 text-[#475569]" />
		<h4 class="text-[13px] font-bold uppercase tracking-[.04em] text-[#0f172a]">
			Materiale ({counts.all})
		</h4>
	</div>

	<div class="ct-mat-tabs mb-3 flex gap-1 rounded-lg bg-[#f1f5f9] p-[3px]">
		{#each [['all', 'Toate'], ['img', 'Foto'], ['vid', 'Video'], ['doc', 'Docs']] as [id, label] (id)}
			{@const count = counts[id as keyof typeof counts]}
			<button
				type="button"
				class={[
					'ct-mat-tab flex-1 rounded-md px-2 py-1.5 text-[11.5px] font-semibold transition-all',
					tab === id ? 'bg-white text-[#0f172a] shadow-[0_1px_2px_rgba(15,23,42,.06)]' : 'text-[#64748b] hover:text-[#0f172a]'
				].join(' ')}
				onclick={() => (tab = id as typeof tab)}
			>
				{label}
				<span class="ml-1 inline-block rounded-full bg-[#e5e9f0] px-1.5 py-[1px] text-[10px]">{count}</span>
			</button>
		{/each}
	</div>

	<ul class="ct-mat-list flex flex-col gap-1.5">
		{#each filtered as m (m.id)}
			{@const t = typeOf(m)}
			<li
				class="ct-mat group flex items-center gap-2.5 rounded-lg border border-[#e5e9f0] bg-white p-2 transition-colors hover:border-[#1877F2] hover:bg-[#f7faff]"
			>
				<button
					type="button"
					class="flex flex-1 items-center gap-2.5 text-left"
					onclick={() => handleClickItem(m)}
				>
					<div
						class={`ct-mat-icon grid h-8 w-8 shrink-0 place-items-center rounded-[7px] text-white ${t}`}
						style:background={iconGradient(t)}
					>
						{#if t === 'img'}<ImageIcon class="h-4 w-4" />
						{:else if t === 'vid'}<VideoIcon class="h-4 w-4" />
						{:else if t === 'zip'}<ArchiveIcon class="h-4 w-4" />
						{:else}<FileTextIcon class="h-4 w-4" />
						{/if}
					</div>
					<div class="ct-mat-info flex-1 min-w-0">
						<div class="ct-mat-name truncate text-[12.5px] font-semibold text-[#0f172a]">{m.name}</div>
						<div class="ct-mat-meta text-[11px] text-[#94a3b8]">
							{fmtSize(m.sizeBytes)} · {fmtDate(m.uploadedAt)}
						</div>
					</div>
				</button>
				<div class="ct-mat-actions flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
					<a
						href={m.url}
						download={m.name}
						class="grid h-7 w-7 place-items-center rounded-md text-[#475569] hover:bg-[#f1f5f9] hover:text-[#0f172a]"
						title="Download"
						aria-label={`Descarcă ${m.name}`}
					>
						<DownloadIcon class="h-3.5 w-3.5" />
					</a>
					<button
						type="button"
						class="grid h-7 w-7 place-items-center rounded-md text-[#475569] hover:bg-[#f1f5f9] hover:text-[#0f172a]"
						title="Mai mult"
						aria-label="Mai mult"
					>
						<MoreVerticalIcon class="h-3.5 w-3.5" />
					</button>
				</div>
			</li>
		{/each}
	</ul>

	<input
		bind:this={fileInput}
		type="file"
		class="hidden"
		multiple
		accept="image/*,video/*,.pdf,.doc,.docx,.zip,.rar"
		onchange={(e) => {
			const files = (e.currentTarget as HTMLInputElement).files;
			if (files) uploadFiles(files);
			(e.currentTarget as HTMLInputElement).value = '';
		}}
	/>
	<button
		type="button"
		class={`ct-mat-upload mt-3 flex w-full flex-col items-center gap-1 rounded-lg border-2 border-dashed px-3 py-3.5 text-[12px] transition-colors ${dragOver ? 'border-[#1877F2] bg-[#f0f7ff]' : 'border-[#d5dbe5] hover:border-[#1877F2]'}`}
		onclick={() => fileInput?.click()}
		ondragover={(e) => {
			e.preventDefault();
			dragOver = true;
		}}
		ondragleave={() => (dragOver = false)}
		ondrop={(e) => {
			e.preventDefault();
			dragOver = false;
			if (e.dataTransfer?.files) uploadFiles(e.dataTransfer.files);
		}}
		disabled={uploading}
	>
		<strong class="font-semibold text-[#1877F2]">
			{uploading ? 'Se încarcă...' : '+ Adaugă materiale'}
		</strong>
		<span class="text-[#94a3b8]">Trage fișiere aici sau click pentru upload</span>
	</button>
</div>
```

> NOTE: If `getTaskMaterials` returns shape different from `{ id, name, url, mimeType, sizeBytes, uploadedAt }`, adapt the field accessors. Check `src/lib/remotes/task-materials.remote.ts` for the actual return type and adjust.

- [ ] **Step 2: Autofixer + commit**

```bash
git add src/lib/components/client-task/client-task-materials-card.svelte
git commit -m "feat(client-task): materials card with 4 tabs + dropzone + colored type icons"
```

### Task 8: Right rail — activity card

**Files:**
- Create: `src/lib/components/client-task/client-task-activity-card.svelte`

- [ ] **Step 1: Build component**

```svelte
<!-- src/lib/components/client-task/client-task-activity-card.svelte -->
<script lang="ts">
	import { getTaskActivities } from '$lib/remotes/task-activities.remote';
	import HistoryIcon from '@lucide/svelte/icons/history';

	type Props = { taskId: string };
	let { taskId }: Props = $props();

	const activityQuery = $derived(getTaskActivities(taskId));
	const activities = $derived(activityQuery.current ?? []);

	function fmtAgo(d: Date | string): string {
		const date = d instanceof Date ? d : new Date(d);
		const diff = Date.now() - date.getTime();
		const mins = Math.floor(diff / 60_000);
		if (mins < 1) return 'acum';
		if (mins < 60) return `${mins}m`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours}h`;
		const days = Math.floor(hours / 24);
		if (days < 7) return `${days}z`;
		return date.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' });
	}

	function describe(a: any): string {
		switch (a.action) {
			case 'status_changed':
				return `Status: ${a.oldValue} → ${a.newValue}`;
			case 'priority_changed':
				return `Prioritate: ${a.oldValue} → ${a.newValue}`;
			case 'assignee_changed':
				return `Asignat: ${a.newValue}`;
			case 'subtask_toggled':
				return `Subtask ${a.newValue ? 'finalizat' : 'redeschis'}: ${a.field}`;
			case 'duplicated':
				return `Duplicat din alt task`;
			default:
				return a.action;
		}
	}
</script>

<div class="ct-card rounded-[12px] border border-[#e5e9f0] bg-white p-[18px]">
	<div class="ct-section-head mb-3 flex items-center gap-2">
		<HistoryIcon class="h-3.5 w-3.5 text-[#475569]" />
		<h4 class="text-[13px] font-bold uppercase tracking-[.04em] text-[#0f172a]">
			Activitate ({activities.length})
		</h4>
	</div>

	{#if activities.length === 0}
		<div class="text-[12px] text-[#94a3b8]">Nicio activitate încă.</div>
	{:else}
		<ul class="flex max-h-[420px] flex-col gap-2.5 overflow-y-auto pr-1">
			{#each activities as a (a.id)}
				<li class="flex items-start gap-2 text-[12px]">
					<span class="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#1877F2]"></span>
					<div class="flex-1 min-w-0">
						<div class="text-[#0f172a]">{describe(a)}</div>
						<div class="text-[11px] text-[#94a3b8]">
							{a.userName ?? 'Sistem'} · {fmtAgo(a.createdAt)}
						</div>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</div>
```

- [ ] **Step 2: Autofixer + commit**

```bash
git add src/lib/components/client-task/client-task-activity-card.svelte
git commit -m "feat(client-task): activity card with timeline per ct-card"
```

### Task 9: Right rail container

**Files:**
- Create: `src/lib/components/client-task/client-task-rail.svelte`

- [ ] **Step 1: Build component**

```svelte
<!-- src/lib/components/client-task/client-task-rail.svelte -->
<script lang="ts">
	import type { Task } from '$lib/server/db/schema';
	import ClientTaskMetaCard from './client-task-meta-card.svelte';
	import ClientTaskProgressCard from './client-task-progress-card.svelte';
	import ClientTaskTeamCard from './client-task-team-card.svelte';
	import ClientTaskMaterialsCard from './client-task-materials-card.svelte';
	import ClientTaskActivityCard from './client-task-activity-card.svelte';
	import type { LightboxImage } from './client-task-lightbox.svelte';

	type Subtask = { id: string; title: string; done: number | boolean; position: number };
	type Assignee = {
		id: string;
		firstName?: string | null;
		lastName?: string | null;
		email?: string | null;
		displayName?: string | null;
		online?: boolean;
	};

	type Props = {
		task: Task;
		subtasks: Subtask[];
		assignees: Assignee[];
		createdByName: string | null;
		readonlyTeam?: boolean;
		onOpenLightbox: (images: LightboxImage[], startIndex: number) => void;
	};

	let {
		task,
		subtasks,
		assignees,
		createdByName,
		readonlyTeam = false,
		onOpenLightbox
	}: Props = $props();
</script>

<aside class="ct-rail flex flex-col gap-3.5">
	<ClientTaskMetaCard {task} {createdByName} />
	<ClientTaskProgressCard taskId={task.id} {subtasks} />
	<ClientTaskTeamCard {assignees} readonly={readonlyTeam} />
	<ClientTaskMaterialsCard taskId={task.id} {onOpenLightbox} />
	<ClientTaskActivityCard taskId={task.id} />
</aside>
```

- [ ] **Step 2: Autofixer + commit**

```bash
git add src/lib/components/client-task/client-task-rail.svelte
git commit -m "feat(client-task): rail container composing 5 cards"
```

### Task 10: Meet modal — client variant

**Files:**
- Create: `src/lib/components/client-task/client-task-meet-modal.svelte`

- [ ] **Step 1: Build component**

```svelte
<!-- src/lib/components/client-task/client-task-meet-modal.svelte -->
<script lang="ts">
	import { scheduleMeet } from '$lib/remotes/tasks.remote';
	import { getTask } from '$lib/remotes/tasks.remote';
	import XIcon from '@lucide/svelte/icons/x';
	import CheckIcon from '@lucide/svelte/icons/check';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import { avatarColor, avatarInitials } from '$lib/config/team';
	import { toast } from 'svelte-sonner';
	import { clientLogger } from '$lib/client-logger';

	type Person = {
		id: string;
		firstName?: string | null;
		lastName?: string | null;
		email?: string | null;
	};

	type Props = {
		open: boolean;
		taskId: string;
		taskTitle: string;
		availableInvitees: Person[];
		defaultInviteeIds?: string[];
		onClose: () => void;
	};

	let {
		open,
		taskId,
		taskTitle,
		availableInvitees,
		defaultInviteeIds = [],
		onClose
	}: Props = $props();

	let meetTitle = $state('');
	let meetDate = $state('');
	let meetTime = $state('10:00');
	let meetDuration = $state(30);
	let selectedIds = $state(new Set<string>(defaultInviteeIds));
	let addToCalendar = $state(true);
	let sendEmail = $state(true);
	let saving = $state(false);

	$effect(() => {
		if (open) {
			meetTitle = `Meeting · ${taskTitle}`;
			const tomorrow = new Date();
			tomorrow.setDate(tomorrow.getDate() + 1);
			meetDate = tomorrow.toISOString().slice(0, 10);
			selectedIds = new Set(defaultInviteeIds);
		}
	});

	function displayName(p: Person): string {
		const full = `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim();
		return full || p.email || p.id;
	}

	function toggleInvitee(id: string) {
		const next = new Set(selectedIds);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selectedIds = next;
	}

	async function handleSave() {
		if (!meetDate || !meetTime || !meetTitle.trim()) return;
		saving = true;
		try {
			await scheduleMeet({
				taskId,
				title: meetTitle.trim(),
				date: meetDate,
				time: meetTime,
				durationMinutes: meetDuration,
				inviteeIds: [...selectedIds],
				addToCalendar,
				sendEmail
			}).updates(getTask(taskId));
			toast.success('Meeting programat');
			onClose();
		} catch (e) {
			clientLogger.apiError('schedule_meet', e);
			toast.error(e instanceof Error ? e.message : 'Eroare la programare');
		} finally {
			saving = false;
		}
	}

	const summary = $derived(
		meetDate && meetTime ? `${meetDate} · ${meetTime} · ${meetDuration} min` : 'Completează data și ora'
	);
</script>

{#if open}
	<div
		class="ct-meet-overlay fixed inset-0 z-[200] flex items-center justify-center bg-[#0f172a]/55"
		onclick={onClose}
		role="dialog"
		aria-modal="true"
		aria-labelledby="meet-modal-title"
	>
		<div
			class="ct-meet-modal w-[560px] max-w-[90vw] rounded-[14px] bg-white shadow-[0_20px_60px_rgba(15,23,42,0.25)]"
			onclick={(e) => e.stopPropagation()}
			role="document"
		>
			<div class="ct-meet-head flex items-start justify-between border-b border-[#e5e9f0] p-5">
				<div class="flex items-start gap-3">
					<span class="grid h-10 w-10 place-items-center rounded-[9px] bg-[#10b981]/10 text-[#10b981]">
						<svg width="20" height="20" viewBox="0 0 24 24" fill="none">
							<path d="M16 8.5V12.5L20 16V5L16 8.5Z" fill="#10b981" />
							<path d="M3 6V18C3 18.5523 3.44772 19 4 19H14C14.5523 19 15 18.5523 15 18V14L11 14V6H3Z" fill="#a7f3d0" />
						</svg>
					</span>
					<div>
						<h2 id="meet-modal-title" class="text-[16px] font-bold text-[#0f172a]">Programează Google Meet</h2>
						<p class="mt-0.5 text-[12px] text-[#94a3b8]">Linkul Meet va fi generat și trimis participanților</p>
					</div>
				</div>
				<button
					type="button"
					class="ct-meet-close grid h-8 w-8 place-items-center rounded-lg text-[#94a3b8] transition-colors hover:bg-[#f1f5f9] hover:text-[#0f172a]"
					onclick={onClose}
					aria-label="Închide"
				>
					<XIcon class="h-4 w-4" />
				</button>
			</div>

			<div class="ct-meet-body flex flex-col gap-4 p-5">
				<div class="ct-meet-field flex flex-col gap-1.5">
					<label for="meet-title" class="text-[11px] font-semibold uppercase tracking-[.04em] text-[#94a3b8]">
						Titlu meeting
					</label>
					<input
						id="meet-title"
						type="text"
						bind:value={meetTitle}
						class="rounded-[7px] border border-[#d5dbe5] px-2.5 py-2 text-[13px] text-[#0f172a] focus:border-[#1877F2] focus:outline-none focus:ring-2 focus:ring-[#1877F2]/12"
					/>
				</div>

				<div class="ct-meet-grid grid grid-cols-3 gap-2.5">
					<div class="ct-meet-field flex flex-col gap-1.5">
						<label for="meet-date" class="text-[11px] font-semibold uppercase tracking-[.04em] text-[#94a3b8]">Dată</label>
						<input
							id="meet-date"
							type="date"
							bind:value={meetDate}
							class="rounded-[7px] border border-[#d5dbe5] px-2.5 py-2 text-[13px] focus:border-[#1877F2] focus:outline-none focus:ring-2 focus:ring-[#1877F2]/12"
						/>
					</div>
					<div class="ct-meet-field flex flex-col gap-1.5">
						<label for="meet-time" class="text-[11px] font-semibold uppercase tracking-[.04em] text-[#94a3b8]">Oră</label>
						<input
							id="meet-time"
							type="time"
							bind:value={meetTime}
							class="rounded-[7px] border border-[#d5dbe5] px-2.5 py-2 text-[13px] focus:border-[#1877F2] focus:outline-none focus:ring-2 focus:ring-[#1877F2]/12"
						/>
					</div>
					<div class="ct-meet-field flex flex-col gap-1.5">
						<label for="meet-duration" class="text-[11px] font-semibold uppercase tracking-[.04em] text-[#94a3b8]">Durată</label>
						<select
							id="meet-duration"
							bind:value={meetDuration}
							class="rounded-[7px] border border-[#d5dbe5] px-2.5 py-2 text-[13px] focus:border-[#1877F2] focus:outline-none focus:ring-2 focus:ring-[#1877F2]/12"
						>
							<option value={15}>15 min</option>
							<option value={30}>30 min</option>
							<option value={45}>45 min</option>
							<option value={60}>1 oră</option>
							<option value={90}>1h 30 min</option>
						</select>
					</div>
				</div>

				<div class="ct-meet-field flex flex-col gap-1.5">
					<label class="text-[11px] font-semibold uppercase tracking-[.04em] text-[#94a3b8]">
						Participanți ({selectedIds.size})
					</label>
					<div class="ct-meet-invitees flex flex-wrap gap-1.5">
						{#each availableInvitees as p (p.id)}
							{@const sel = selectedIds.has(p.id)}
							<button
								type="button"
								class={[
									'ct-meet-invitee inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors',
									sel
										? 'border-[#1877F2] bg-[#f0f7ff] text-[#1877F2]'
										: 'border-[#e5e9f0] bg-white text-[#475569] hover:border-[#1877F2]'
								].join(' ')}
								onclick={() => toggleInvitee(p.id)}
							>
								<span
									class="grid h-5 w-5 place-items-center rounded-full text-[9px] font-bold text-white"
									style:background-color={avatarColor(p.email ?? p.id)}
								>
									{avatarInitials(p.firstName ?? null, p.lastName ?? null, p.email ?? null)}
								</span>
								<span>{displayName(p)}</span>
								{#if sel}
									<CheckIcon class="h-3 w-3" />
								{/if}
							</button>
						{/each}
					</div>
				</div>

				<label class="ct-meet-check flex items-center gap-2 text-[12.5px] text-[#0f172a]">
					<input type="checkbox" bind:checked={addToCalendar} class="h-4 w-4 accent-[#1877F2]" />
					Adaugă în Google Calendar
				</label>
				<label class="ct-meet-check flex items-center gap-2 text-[12.5px] text-[#0f172a]">
					<input type="checkbox" bind:checked={sendEmail} class="h-4 w-4 accent-[#1877F2]" />
					Trimite invitație pe email + notificare în CRM
				</label>
			</div>

			<div class="ct-meet-foot flex items-center justify-between border-t border-[#e5e9f0] p-4">
				<div class="ct-meet-summary inline-flex items-center gap-1.5 text-[12px] text-[#475569]">
					<CalendarIcon class="h-3.5 w-3.5" />
					{summary}
				</div>
				<div class="flex items-center gap-2">
					<button
						type="button"
						class="ct-meet-cancel rounded-[7px] px-3 py-2 text-[12.5px] font-semibold text-[#475569] hover:bg-[#f1f5f9]"
						onclick={onClose}
					>
						Anulează
					</button>
					<button
						type="button"
						class="ct-meet-save inline-flex items-center gap-1.5 rounded-[7px] bg-[#1877F2] px-4 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-[#0d5cc7] disabled:opacity-50"
						onclick={handleSave}
						disabled={saving || !meetDate || !meetTime || !meetTitle.trim()}
					>
						<CheckIcon class="h-3.5 w-3.5" />
						{saving ? 'Se programează...' : 'Programează & generează link'}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
```

> NOTE: The `scheduleMeet` remote signature in `tasks.remote.ts` may not match the call here. Check the actual signature and adapt (the existing admin task code calls it — copy the call pattern).

- [ ] **Step 2: Autofixer + commit**

```bash
git add src/lib/components/client-task/client-task-meet-modal.svelte
git commit -m "feat(client-task): dedicated Meet modal 1:1 with ct-meet design"
```

### Task 11: Top-level ClientTaskDetailBody + route wiring

**Files:**
- Create: `src/lib/components/client-task/client-task-detail-body.svelte`
- Modify: `src/routes/client/[tenant]/(app)/tasks/[taskId]/+page.svelte`

- [ ] **Step 1: Build the top-level component**

```svelte
<!-- src/lib/components/client-task/client-task-detail-body.svelte -->
<script lang="ts">
	import type { Task } from '$lib/server/db/schema';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { getTask } from '$lib/remotes/tasks.remote';
	import { getTenantUsers, getClientUsers } from '$lib/remotes/users.remote';
	import { getClient } from '$lib/remotes/clients.remote';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import ClientTaskPageHead from './client-task-page-head.svelte';
	import ClientTaskDescription from './client-task-description.svelte';
	import ClientTaskComments from './client-task-comments.svelte';
	import ClientTaskRail from './client-task-rail.svelte';
	import ClientTaskMeetModal from './client-task-meet-modal.svelte';
	import ClientTaskLightbox, { type LightboxImage } from './client-task-lightbox.svelte';

	type TaskWithIncludes = Task & {
		subtasks?: any[];
		tags?: any[];
		assignees?: any[];
	};

	type Props = {
		task: TaskWithIncludes | null;
		currentUserId: string;
		tenantSlug: string;
		onClose: () => void;
	};

	let { task, currentUserId, tenantSlug, onClose }: Props = $props();

	const tenantUsersQuery = getTenantUsers();
	const tenantUsers = $derived(tenantUsersQuery.current ?? []);

	const clientUsersQuery = $derived(task?.clientId ? getClientUsers(task.clientId) : null);
	const clientUsers = $derived(clientUsersQuery?.current ?? []);

	const clientQuery = $derived(task?.clientId ? getClient(task.clientId) : null);
	const client = $derived(clientQuery?.current);

	const createdByName = $derived.by(() => {
		if (!task?.createdByUserId) return null;
		const u = tenantUsers.find((x: any) => x.id === task.createdByUserId);
		if (!u) return null;
		const full = `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim();
		return full || u.email;
	});

	let meetOpen = $state(false);
	let lbOpen = $state(false);
	let lbImages = $state<LightboxImage[]>([]);
	let lbIndex = $state(0);

	function openLightbox(images: LightboxImage[], startIndex: number) {
		lbImages = images;
		lbIndex = startIndex;
		lbOpen = true;
	}

	const allInvitees = $derived([
		...tenantUsers.map((u: any) => ({
			id: u.id,
			firstName: u.firstName,
			lastName: u.lastName,
			email: u.email
		})),
		...clientUsers.map((u: any) => ({
			id: u.id,
			firstName: u.firstName,
			lastName: u.lastName,
			email: u.email
		}))
	]);
</script>

{#if task}
	<div class="client-shell flex min-h-screen bg-[#f5f7fa]">
		<div class="client-main flex-1 flex flex-col">
			<!-- Topbar with breadcrumbs -->
			<div class="client-topbar flex items-center gap-2 border-b border-[#e5e9f0] bg-white px-7 py-3.5 text-[13px] text-[#64748b]">
				<a href="/client/{tenantSlug}/settings" class="client-crumb inline-flex items-center gap-1.5 hover:text-[#0f172a]">
					<SettingsIcon class="h-3.5 w-3.5" />
				</a>
				<ChevronRightIcon class="h-3 w-3 text-[#cbd5e1]" />
				<a href="/client/{tenantSlug}/tasks" class="client-crumb hover:text-[#0f172a]">Tasks</a>
				<ChevronRightIcon class="h-3 w-3 text-[#cbd5e1]" />
				<span class="client-crumb current truncate font-semibold text-[#0f172a]">{task.title}</span>
			</div>

			<!-- Page body -->
			<div class="client-task-page mx-auto grid w-full max-w-[1280px] gap-6 p-7" style:grid-template-columns="1fr 320px">
				<div class="flex min-w-0 flex-col gap-5">
					<ClientTaskPageHead
						{task}
						clientName={client?.name ?? null}
						tags={task.tags ?? []}
						onBack={onClose}
						onScheduleMeet={() => (meetOpen = true)}
					/>
					<ClientTaskDescription description={task.description} />
					<ClientTaskComments
						taskId={task.id}
						{currentUserId}
						onOpenLightbox={openLightbox}
					/>
				</div>

				<ClientTaskRail
					{task}
					subtasks={task.subtasks ?? []}
					assignees={task.assignees ?? []}
					{createdByName}
					readonlyTeam={true}
					onOpenLightbox={openLightbox}
				/>
			</div>
		</div>
	</div>

	<ClientTaskMeetModal
		open={meetOpen}
		taskId={task.id}
		taskTitle={task.title}
		availableInvitees={allInvitees}
		defaultInviteeIds={(task.assignees ?? []).map((a: any) => a.id)}
		onClose={() => (meetOpen = false)}
	/>

	<ClientTaskLightbox
		images={lbImages}
		index={lbIndex}
		open={lbOpen}
		onClose={() => (lbOpen = false)}
		onIndexChange={(i) => (lbIndex = i)}
	/>
{:else}
	<div class="flex h-full items-center justify-center p-8">
		<p class="text-[#94a3b8] text-sm">Se încarcă...</p>
	</div>
{/if}
```

- [ ] **Step 2: Rewrite the route**

Replace contents of `src/routes/client/[tenant]/(app)/tasks/[taskId]/+page.svelte`:

```svelte
<script lang="ts">
	import { getTask } from '$lib/remotes/tasks.remote';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import ClientTaskDetailBody from '$lib/components/client-task/client-task-detail-body.svelte';

	const tenantSlug = $derived(page.params.tenant ?? '');
	const taskId = $derived(page.params.taskId!);
	const currentUserId = $derived((page.data as any)?.clientUser?.userId as string);

	const taskQuery = $derived(getTask(taskId));
	const task = $derived(taskQuery.current);

	function onClose() {
		goto(`/client/${tenantSlug}/tasks`);
	}
</script>

<svelte:head>
	<title>{task?.title ?? 'Task'} · Client Portal</title>
</svelte:head>

<ClientTaskDetailBody {task} {currentUserId} {tenantSlug} {onClose} />
```

- [ ] **Step 3: Run svelte-check on the whole project**

```bash
cd /Users/augustin598/Projects/CRM/.claude/worktrees/practical-kilby-15341a/app
NODE_OPTIONS="--max-old-space-size=8192" npx svelte-check --threshold error 2>&1 | tail -5
```

Expected: same pre-existing error count as baseline (no NEW errors from the client-task components). If new errors appear, address them before commit.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/client-task/client-task-detail-body.svelte src/routes/client/\[tenant\]/\(app\)/tasks/\[taskId\]/+page.svelte
git commit -m "feat(client-task): wire dedicated detail body + replace TaskDetailBody on route"
```

### Task 12: Phase 1 verification — manual visual check

- [ ] **Step 1: Restart dev server**

```bash
cd /Users/augustin598/Projects/CRM/app
# Stop existing dev (if running): Ctrl+C
rm -rf .svelte-kit node_modules/.vite
bun run dev
```

- [ ] **Step 2: Open browser** to `http://localhost:5173/client/{tenant}/tasks/{some-task-id}`. Hard refresh (Cmd+Shift+R).

Verify visually:
- Breadcrumb bar at top: Settings icon › Tasks › task title
- Page head: "Task · {Client}" crumb tag, large 26px title, status/priority/overdue pills with dots + tag chips
- Green "Programează Google Meet" button top-right, white "Back to Tasks" button beside
- Description in light-gray `#f7f8fa` rounded box
- Comments section with avatar circles, reactions pills, reply button
- Right rail (320px): 5 cards stacked (Detalii / Progres / Echipă / Materiale / Activitate)
- Materials tabs with counts; click a Foto item → lightbox opens
- Click reaction → server confirms, count updates

- [ ] **Step 3: Phase 1 merge marker commit (no actual changes)**

```bash
git commit --allow-empty -m "milestone: Phase 1 — Client Task Detail 1:1 complete"
```

---

## Phase 2 — Client Team page

### Task 13: Page header

**Files:**
- Create: `src/lib/components/client-team/client-team-page-header.svelte`

- [ ] **Step 1: Build component**

```svelte
<!-- src/lib/components/client-team/client-team-page-header.svelte -->
<script lang="ts">
	import SearchIcon from '@lucide/svelte/icons/search';
	import ShieldIcon from '@lucide/svelte/icons/shield';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';

	type Props = {
		clientName: string;
		stats: {
			total: number;
			online: number;
			pending: number;
			openTasks: number;
		};
		search: string;
		onSearchChange: (v: string) => void;
		onPermissionsClick: () => void;
		onInviteClick: () => void;
	};

	let { clientName, stats, search, onSearchChange, onPermissionsClick, onInviteClick }: Props = $props();
</script>

<header class="cteam-header flex flex-col gap-4 px-7 pt-6">
	<nav class="cteam-crumb flex items-center gap-1.5 text-[12.5px] text-[#64748b]">
		<SettingsIcon class="h-3.5 w-3.5" />
		<span>Setări companie</span>
		<ChevronRightIcon class="h-3 w-3 text-[#cbd5e1]" />
		<span class="font-semibold text-[#0f172a]">Echipa mea</span>
	</nav>

	<div class="flex flex-wrap items-end justify-between gap-4">
		<div>
			<h1 class="cteam-title text-[26px] font-extrabold tracking-tight text-[#0f172a]">
				Echipa {clientName}
			</h1>
			<p class="cteam-sub mt-1 text-[13px] text-[#64748b]">
				{stats.total} membri ·
				<span class="font-semibold text-[#10b981]">{stats.online} online</span>
				· {stats.pending} aprobări în așteptare · {stats.openTasks} taskuri active
			</p>
		</div>

		<div class="cteam-actions flex items-center gap-2">
			<div class="cteam-search relative">
				<SearchIcon class="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#94a3b8]" />
				<input
					type="text"
					placeholder="Caută coleg..."
					value={search}
					oninput={(e) => onSearchChange((e.currentTarget as HTMLInputElement).value)}
					class="min-w-[260px] rounded-[9px] border border-[#e5e9f0] bg-white py-[7px] pl-9 pr-3 text-[12.5px] focus:border-[#1877F2] focus:outline-none focus:ring-2 focus:ring-[#1877F2]/12"
				/>
			</div>
			<button
				type="button"
				class="cteam-btn ghost inline-flex items-center gap-1.5 rounded-[9px] border border-[#d5dbe5] bg-white px-3.5 py-2 text-[12.5px] font-semibold text-[#475569] hover:border-[#1877F2] hover:text-[#0f172a]"
				onclick={onPermissionsClick}
			>
				<ShieldIcon class="h-3.5 w-3.5" />
				Permisiuni
			</button>
			<button
				type="button"
				class="cteam-btn primary inline-flex items-center gap-1.5 rounded-[9px] bg-[#1877F2] px-3.5 py-2 text-[12.5px] font-semibold text-white hover:bg-[#0d5cc7]"
				onclick={onInviteClick}
			>
				<PlusIcon class="h-3.5 w-3.5" />
				Invită coleg
			</button>
		</div>
	</div>
</header>
```

- [ ] **Step 2: Autofixer + commit**

```bash
git add src/lib/components/client-team/client-team-page-header.svelte
git commit -m "feat(client-team): page header (breadcrumb + title + search + actions)"
```

### Task 14: Hero panel

**Files:**
- Create: `src/lib/components/client-team/client-team-hero.svelte`

- [ ] **Step 1: Build component**

```svelte
<!-- src/lib/components/client-team/client-team-hero.svelte -->
<script lang="ts">
	import UsersIcon from '@lucide/svelte/icons/users';
	import PlusIcon from '@lucide/svelte/icons/plus';

	type Props = {
		onAddClick: () => void;
	};
	let { onAddClick }: Props = $props();
</script>

<div
	class="cteam-hero mx-7 mt-4 flex items-center justify-between gap-4 rounded-[14px] p-5 text-white"
	style:background="linear-gradient(135deg, #1877F2 0%, #0d5cc7 100%)"
>
	<div class="flex items-center gap-4">
		<div class="grid h-12 w-12 place-items-center rounded-[10px] bg-white/15 backdrop-blur-sm">
			<UsersIcon class="h-6 w-6 text-white" />
		</div>
		<div>
			<h2 class="text-[18px] font-bold leading-tight">Invită echipa</h2>
			<p class="mt-0.5 text-[12.5px] text-white/85">
				Adaugă colegi pentru a partaja taskuri, materiale și rapoarte
			</p>
		</div>
	</div>
	<button
		type="button"
		class="inline-flex items-center gap-1.5 rounded-[9px] bg-white px-4 py-2 text-[12.5px] font-semibold text-[#1877F2] hover:bg-white/90"
		onclick={onAddClick}
	>
		<PlusIcon class="h-3.5 w-3.5" />
		Adaugă acum
	</button>
</div>
```

- [ ] **Step 2: Autofixer + commit**

```bash
git add src/lib/components/client-team/client-team-hero.svelte
git commit -m "feat(client-team): hero panel with gradient + CTA"
```

### Task 15: Stats strip

**Files:**
- Create: `src/lib/components/client-team/client-team-stats.svelte`

- [ ] **Step 1: Build component**

```svelte
<!-- src/lib/components/client-team/client-team-stats.svelte -->
<script lang="ts">
	import UsersIcon from '@lucide/svelte/icons/users';
	import CircleIcon from '@lucide/svelte/icons/circle';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import CheckSquareIcon from '@lucide/svelte/icons/check-square';

	type Props = {
		total: number;
		online: number;
		pending: number;
		openTasks: number;
	};
	let { total, online, pending, openTasks }: Props = $props();
</script>

<div class="cteam-stats mx-7 mt-4 grid grid-cols-4 gap-3">
	<div class="cteam-stat flex items-center gap-3 rounded-[12px] border border-[#e5e9f0] bg-white p-3.5">
		<div class="grid h-9 w-9 place-items-center rounded-[9px] bg-[#1877F2]/10 text-[#1877F2]">
			<UsersIcon class="h-[18px] w-[18px]" />
		</div>
		<div>
			<div class="text-[10.5px] font-semibold uppercase tracking-[.04em] text-[#475569]">Active Members</div>
			<div class="text-[22px] font-bold leading-[1.1] tracking-tight text-[#0f172a]">{total}</div>
		</div>
	</div>
	<div class="cteam-stat flex items-center gap-3 rounded-[12px] border border-[#e5e9f0] bg-white p-3.5">
		<div class="grid h-9 w-9 place-items-center rounded-[9px] bg-[#10b981]/10 text-[#10b981]">
			<CircleIcon class="h-[18px] w-[18px]" />
		</div>
		<div>
			<div class="text-[10.5px] font-semibold uppercase tracking-[.04em] text-[#475569]">Online</div>
			<div class="text-[22px] font-bold leading-[1.1] tracking-tight text-[#0f172a]">{online}</div>
		</div>
	</div>
	<div class="cteam-stat flex items-center gap-3 rounded-[12px] border border-[#e5e9f0] bg-white p-3.5">
		<div class="grid h-9 w-9 place-items-center rounded-[9px] bg-[#f59e0b]/10 text-[#f59e0b]">
			<ClockIcon class="h-[18px] w-[18px]" />
		</div>
		<div>
			<div class="text-[10.5px] font-semibold uppercase tracking-[.04em] text-[#475569]">Pending Approvals</div>
			<div class="text-[22px] font-bold leading-[1.1] tracking-tight text-[#0f172a]">{pending}</div>
		</div>
	</div>
	<div class="cteam-stat flex items-center gap-3 rounded-[12px] border border-[#e5e9f0] bg-white p-3.5">
		<div class="grid h-9 w-9 place-items-center rounded-[9px] bg-[#8b5cf6]/10 text-[#8b5cf6]">
			<CheckSquareIcon class="h-[18px] w-[18px]" />
		</div>
		<div>
			<div class="text-[10.5px] font-semibold uppercase tracking-[.04em] text-[#475569]">Open Tasks</div>
			<div class="text-[22px] font-bold leading-[1.1] tracking-tight text-[#0f172a]">{openTasks}</div>
		</div>
	</div>
</div>
```

- [ ] **Step 2: Autofixer + commit**

```bash
git add src/lib/components/client-team/client-team-stats.svelte
git commit -m "feat(client-team): 4-stat strip (Members/Online/Pending/OpenTasks)"
```

### Task 16: Role filter chips

**Files:**
- Create: `src/lib/components/client-team/client-team-role-chips.svelte`

- [ ] **Step 1: Build component**

```svelte
<!-- src/lib/components/client-team/client-team-role-chips.svelte -->
<script lang="ts">
	export type RoleId = 'all' | 'owner' | 'admin' | 'member' | 'viewer';

	type RoleDef = { id: RoleId; label: string; color: string; count: number };

	type Props = {
		roles: RoleDef[];
		active: RoleId;
		onChange: (id: RoleId) => void;
	};

	let { roles, active, onChange }: Props = $props();
</script>

<div class="cteam-filters mx-7 mt-4 flex flex-wrap gap-2">
	{#each roles as r (r.id)}
		<button
			type="button"
			class={[
				'cteam-chip inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors',
				active === r.id
					? 'border-[#1877F2] bg-[#f0f7ff] text-[#1877F2]'
					: 'border-[#d5dbe5] bg-white text-[#475569] hover:border-[#1877F2]'
			].join(' ')}
			onclick={() => onChange(r.id)}
		>
			{#if r.color}
				<span class="h-1.5 w-1.5 rounded-full" style:background-color={r.color}></span>
			{/if}
			{r.label}
			<span class="ml-1 inline-block min-w-[18px] rounded-full bg-[#e5e9f0] px-1.5 py-[1px] text-center text-[10px] text-[#475569]">
				{r.count}
			</span>
		</button>
	{/each}
</div>
```

- [ ] **Step 2: Autofixer + commit**

```bash
git add src/lib/components/client-team/client-team-role-chips.svelte
git commit -m "feat(client-team): role filter chips with count badges"
```

### Task 17: Member card

**Files:**
- Create: `src/lib/components/client-team/client-team-member-card.svelte`

- [ ] **Step 1: Build component**

```svelte
<!-- src/lib/components/client-team/client-team-member-card.svelte -->
<script lang="ts">
	import { avatarColor, avatarInitials } from '$lib/config/team';
	import MailIcon from '@lucide/svelte/icons/mail';
	import PhoneIcon from '@lucide/svelte/icons/phone';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import MessageCircleIcon from '@lucide/svelte/icons/message-circle';
	import MoreVerticalIcon from '@lucide/svelte/icons/more-vertical';

	type Props = {
		id: string;
		firstName: string | null;
		lastName: string | null;
		email: string | null;
		phone?: string | null;
		title?: string | null;
		roleLabel: string;
		roleColor: string;
		roleBg: string;
		online: boolean;
		lastActive?: string | null;
		addedAt: Date | string | null;
		onEmailClick?: () => void;
		onMessageClick?: () => void;
		onMenuClick?: () => void;
	};

	let {
		id,
		firstName,
		lastName,
		email,
		phone,
		title,
		roleLabel,
		roleColor,
		roleBg,
		online,
		lastActive,
		addedAt,
		onEmailClick,
		onMessageClick,
		onMenuClick
	}: Props = $props();

	const name = $derived(`${firstName ?? ''} ${lastName ?? ''}`.trim() || email || id);

	function fmtAdded(d: Date | string | null): string {
		if (!d) return '—';
		const date = d instanceof Date ? d : new Date(d);
		return date.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' });
	}
</script>

<article class="cteam-card relative flex flex-col gap-3 rounded-[14px] border border-[#e5e9f0] bg-white p-4 transition-all hover:border-[#1877F2] hover:shadow-[0_4px_12px_rgba(15,23,42,0.06)]">
	{#if onMenuClick}
		<button
			type="button"
			class="cteam-card-menu absolute right-3 top-3 grid h-6 w-6 place-items-center rounded text-[#94a3b8] hover:bg-[#f1f5f9] hover:text-[#0f172a]"
			onclick={onMenuClick}
			aria-label="Acțiuni"
		>
			<MoreVerticalIcon class="h-3.5 w-3.5" />
		</button>
	{/if}

	<div class="cteam-card-head flex items-center gap-3 pr-7">
		<div
			class="cteam-av relative grid h-[46px] w-[46px] shrink-0 place-items-center rounded-full text-[14px] font-bold text-white"
			style:background-color={avatarColor(email ?? id)}
		>
			{avatarInitials(firstName, lastName, email)}
			<span
				class={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white ${online ? 'bg-[#10b981]' : 'bg-[#cbd5e1]'}`}
				aria-label={online ? 'Online' : 'Offline'}
			></span>
		</div>
		<div class="min-w-0 flex-1">
			<div class="cteam-card-name truncate text-[14px] font-bold text-[#0f172a]">{name}</div>
			{#if title}
				<div class="cteam-card-title truncate text-[12px] text-[#64748b]">{title}</div>
			{/if}
		</div>
	</div>

	<span
		class="cteam-pill inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[.02em]"
		style:background-color={roleBg}
		style:color={roleColor}
	>
		<span class="dot h-1.5 w-1.5 rounded-full" style:background-color={roleColor}></span>
		{roleLabel}
	</span>

	<div class="cteam-card-meta flex flex-col gap-1.5 border-t border-b border-[#f1f5f9] py-3 text-[12.5px]">
		{#if email}
			<div class="cteam-card-meta-row flex items-center gap-2 text-[#475569]">
				<MailIcon class="h-3.5 w-3.5 shrink-0 text-[#94a3b8]" />
				<a href={`mailto:${email}`} class="truncate hover:text-[#0f172a]">{email}</a>
			</div>
		{/if}
		{#if phone}
			<div class="cteam-card-meta-row flex items-center gap-2 text-[#475569]">
				<PhoneIcon class="h-3.5 w-3.5 shrink-0 text-[#94a3b8]" />
				<a href={`tel:${phone}`} class="hover:text-[#0f172a]">{phone}</a>
			</div>
		{/if}
		<div class="cteam-card-meta-row flex items-center gap-2 text-[#475569]">
			<ClockIcon class="h-3.5 w-3.5 shrink-0 text-[#94a3b8]" />
			{#if online}
				<span class="font-semibold text-[#10b981]">Online acum</span>
			{:else if lastActive}
				<span>Activ ultima oară: {lastActive}</span>
			{:else}
				<span class="text-[#94a3b8]">—</span>
			{/if}
		</div>
	</div>

	<div class="cteam-card-foot flex items-center justify-between">
		<span class="cteam-card-since text-[11px] text-[#94a3b8]">Adăugat {fmtAdded(addedAt)}</span>
		<div class="cteam-card-quick flex gap-1">
			{#if onEmailClick}
				<button
					type="button"
					class="cteam-q-btn grid h-[26px] w-[26px] place-items-center rounded-[7px] border border-[#e5e9f0] bg-white text-[#475569] hover:border-[#1877F2] hover:text-[#1877F2]"
					title="Email"
					onclick={onEmailClick}
					aria-label="Trimite email"
				>
					<MailIcon class="h-3 w-3" />
				</button>
			{/if}
			{#if onMessageClick}
				<button
					type="button"
					class="cteam-q-btn grid h-[26px] w-[26px] place-items-center rounded-[7px] border border-[#e5e9f0] bg-white text-[#475569] hover:border-[#1877F2] hover:text-[#1877F2]"
					title="Mesaj"
					onclick={onMessageClick}
					aria-label="Trimite mesaj"
				>
					<MessageCircleIcon class="h-3 w-3" />
				</button>
			{/if}
		</div>
	</div>
</article>
```

- [ ] **Step 2: Autofixer + commit**

```bash
git add src/lib/components/client-team/client-team-member-card.svelte
git commit -m "feat(client-team): member card with avatar + role pill + contact + quick actions"
```

### Task 18: Invite modal

**Files:**
- Create: `src/lib/components/client-team/client-team-invite-modal.svelte`

- [ ] **Step 1: Build component**

```svelte
<!-- src/lib/components/client-team/client-team-invite-modal.svelte -->
<script lang="ts">
	import XIcon from '@lucide/svelte/icons/x';
	import MailIcon from '@lucide/svelte/icons/mail';
	import { inviteClientSecondaryUser } from '$lib/remotes/client-secondary-emails.remote';
	import { getClientSecondaryEmails } from '$lib/remotes/client-secondary-emails.remote';
	import { toast } from 'svelte-sonner';
	import { clientLogger } from '$lib/client-logger';

	type RoleOption = { id: string; label: string; description: string; color: string };

	type Props = {
		open: boolean;
		clientId: string;
		roles: RoleOption[];
		onClose: () => void;
	};

	let { open, clientId, roles, onClose }: Props = $props();

	let email = $state('');
	let selectedRole = $state<string>(roles[0]?.id ?? 'member');
	let saving = $state(false);

	$effect(() => {
		if (open) {
			email = '';
			selectedRole = roles[0]?.id ?? 'member';
		}
	});

	async function handleInvite() {
		const trimmed = email.trim();
		if (!trimmed || !selectedRole) return;
		saving = true;
		try {
			await inviteClientSecondaryUser({ clientId, email: trimmed, role: selectedRole }).updates(
				getClientSecondaryEmails(clientId)
			);
			toast.success(`Invitație trimisă la ${trimmed}`);
			onClose();
		} catch (e) {
			clientLogger.apiError('client_secondary_invite', e);
			toast.error(e instanceof Error ? e.message : 'Eroare la trimitere invitație');
		} finally {
			saving = false;
		}
	}
</script>

{#if open}
	<div
		class="fixed inset-0 z-[200] flex items-center justify-center bg-[#0f172a]/55"
		onclick={onClose}
		role="dialog"
		aria-modal="true"
		aria-labelledby="invite-title"
	>
		<div
			class="cteam-modal w-[560px] max-w-[90vw] rounded-[16px] bg-white shadow-[0_30px_60px_rgba(15,23,42,0.3)]"
			onclick={(e) => e.stopPropagation()}
			role="document"
		>
			<div class="flex items-center justify-between border-b border-[#e5e9f0] p-5">
				<h2 id="invite-title" class="text-[16px] font-bold text-[#0f172a]">Invită coleg</h2>
				<button
					type="button"
					class="grid h-8 w-8 place-items-center rounded-lg text-[#94a3b8] hover:bg-[#f1f5f9] hover:text-[#0f172a]"
					onclick={onClose}
					aria-label="Închide"
				>
					<XIcon class="h-4 w-4" />
				</button>
			</div>

			<div class="flex flex-col gap-4 p-5">
				<div class="cteam-fld flex flex-col gap-1.5">
					<label for="invite-email" class="text-[11px] font-semibold uppercase tracking-[.04em] text-[#94a3b8]">
						Email
					</label>
					<div class="relative">
						<MailIcon class="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#94a3b8]" />
						<input
							id="invite-email"
							type="email"
							bind:value={email}
							placeholder="coleg@firma.ro"
							class="w-full rounded-[7px] border border-[#d5dbe5] bg-white py-2 pl-9 pr-3 text-[13px] focus:border-[#1877F2] focus:outline-none focus:ring-2 focus:ring-[#1877F2]/12"
						/>
					</div>
				</div>

				<div class="cteam-fld flex flex-col gap-1.5">
					<label class="text-[11px] font-semibold uppercase tracking-[.04em] text-[#94a3b8]">
						Rol
					</label>
					<div class="cteam-role-grid grid grid-cols-2 gap-2">
						{#each roles as r (r.id)}
							<button
								type="button"
								class={[
									'flex flex-col items-start gap-1 rounded-[10px] border p-3 text-left transition-colors',
									selectedRole === r.id
										? 'border-[#1877F2] bg-[#f0f7ff]'
										: 'border-[#e5e9f0] bg-white hover:border-[#1877F2]'
								].join(' ')}
								onclick={() => (selectedRole = r.id)}
							>
								<span class="inline-flex items-center gap-1.5 text-[12.5px] font-bold text-[#0f172a]">
									<span class="h-1.5 w-1.5 rounded-full" style:background-color={r.color}></span>
									{r.label}
								</span>
								<span class="text-[11px] text-[#64748b]">{r.description}</span>
							</button>
						{/each}
					</div>
				</div>
			</div>

			<div class="flex items-center justify-end gap-2 border-t border-[#e5e9f0] p-4">
				<button
					type="button"
					class="rounded-[7px] px-3 py-2 text-[12.5px] font-semibold text-[#475569] hover:bg-[#f1f5f9]"
					onclick={onClose}
				>
					Anulează
				</button>
				<button
					type="button"
					class="rounded-[7px] bg-[#1877F2] px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-[#0d5cc7] disabled:opacity-50"
					onclick={handleInvite}
					disabled={saving || !email.trim()}
				>
					{saving ? 'Se trimite...' : 'Trimite invitație'}
				</button>
			</div>
		</div>
	</div>
{/if}
```

> NOTE: `inviteClientSecondaryUser` may not exist with this exact name. Look at the existing `client-secondary-emails.remote.ts` exports; rename the call accordingly. If the remote signature is different (e.g. accepts `{ name, role, permissions }`), adapt.

- [ ] **Step 2: Autofixer + commit**

```bash
git add src/lib/components/client-team/client-team-invite-modal.svelte
git commit -m "feat(client-team): invite modal with email + role selector"
```

### Task 19: Rewrite Client Team page

**Files:**
- Modify: `src/routes/client/[tenant]/(app)/team/+page.svelte` (full rewrite)

- [ ] **Step 1: Rewrite the page**

Replace the entire file contents with:

```svelte
<script lang="ts">
	import { page } from '$app/state';
	import { getClient } from '$lib/remotes/clients.remote';
	import { getClientSecondaryEmails } from '$lib/remotes/client-secondary-emails.remote';
	import { getTasks } from '$lib/remotes/tasks.remote';
	import ClientTeamPageHeader from '$lib/components/client-team/client-team-page-header.svelte';
	import ClientTeamHero from '$lib/components/client-team/client-team-hero.svelte';
	import ClientTeamStats from '$lib/components/client-team/client-team-stats.svelte';
	import ClientTeamRoleChips, {
		type RoleId
	} from '$lib/components/client-team/client-team-role-chips.svelte';
	import ClientTeamMemberCard from '$lib/components/client-team/client-team-member-card.svelte';
	import ClientTeamInviteModal from '$lib/components/client-team/client-team-invite-modal.svelte';
	import PlusIcon from '@lucide/svelte/icons/plus';

	let { data }: { data: any } = $props();

	const clientId = $derived(data.clientId as string);

	const clientQuery = $derived(clientId ? getClient(clientId) : null);
	const client = $derived(clientQuery?.current);

	const secondariesQuery = $derived(clientId ? getClientSecondaryEmails(clientId) : null);
	const secondaries = $derived(secondariesQuery?.current ?? []);

	const tasksQuery = $derived(getTasks({ clientId }));
	const tasks = $derived(tasksQuery.current ?? []);

	let search = $state('');
	let roleFilter = $state<RoleId>('all');
	let inviteOpen = $state(false);

	// Online proxy: a user is "online" if they have an action in taskActivity today.
	// Since we don't fetch activities for the team page (would be heavy), keep all
	// members offline by default. A follow-up can wire a getDashboardTeamActivity-style
	// aggregation if presence matters.

	const ROLE_DEFS = [
		{ id: 'owner', label: 'Owner', color: '#dc2626', bg: '#fef2f2', description: 'Acces total' },
		{ id: 'admin', label: 'Admin', color: '#1877F2', bg: '#dbeafe', description: 'Gestionează membri și taskuri' },
		{ id: 'member', label: 'Member', color: '#10b981', bg: '#d1fae5', description: 'Vede + creează taskuri proprii' },
		{ id: 'viewer', label: 'Viewer', color: '#94a3b8', bg: '#f1f5f9', description: 'Doar citire' }
	] as const;

	type Member = {
		id: string;
		firstName: string | null;
		lastName: string | null;
		email: string | null;
		phone: string | null;
		title: string | null;
		role: string;
		addedAt: Date | string | null;
	};

	const members = $derived<Member[]>(
		secondaries.map((s: any) => ({
			id: s.userId ?? s.id,
			firstName: s.firstName ?? null,
			lastName: s.lastName ?? null,
			email: s.email ?? null,
			phone: s.phone ?? null,
			title: s.title ?? null,
			role: s.role ?? 'member',
			addedAt: s.createdAt ?? null
		}))
	);

	const filteredMembers = $derived.by(() => {
		let result = members;
		if (roleFilter !== 'all') {
			result = result.filter((m) => m.role === roleFilter);
		}
		if (search.trim()) {
			const q = search.trim().toLowerCase();
			result = result.filter((m) => {
				const name = `${m.firstName ?? ''} ${m.lastName ?? ''}`.trim().toLowerCase();
				return name.includes(q) || (m.email ?? '').toLowerCase().includes(q);
			});
		}
		return result;
	});

	const roleCounts = $derived(() => {
		const counts: Record<string, number> = { all: members.length };
		for (const r of ROLE_DEFS) {
			counts[r.id] = members.filter((m) => m.role === r.id).length;
		}
		return counts;
	});

	const roleChips = $derived([
		{ id: 'all' as const, label: 'Toți', color: '#94a3b8', count: roleCounts.all ?? members.length },
		...ROLE_DEFS.map((r) => ({
			id: r.id as RoleId,
			label: r.label,
			color: r.color,
			count: roleCounts[r.id] ?? 0
		}))
	]);

	const stats = $derived({
		total: members.length,
		online: 0,
		pending: tasks.filter((t: any) => t.status === 'pending-approval').length,
		openTasks: tasks.filter((t: any) => t.status !== 'done' && t.status !== 'cancelled').length
	});
</script>

<svelte:head>
	<title>Echipa · Client Portal</title>
</svelte:head>

<div class="cteam-wrap flex min-h-screen flex-col bg-[#f4f6fa]">
	<ClientTeamPageHeader
		clientName={client?.name ?? ''}
		{stats}
		{search}
		onSearchChange={(v) => (search = v)}
		onPermissionsClick={() => {
			// Permissions matrix modal is out of scope for this redesign — keep existing
			// flow or open a separate page. For now: no-op.
		}}
		onInviteClick={() => (inviteOpen = true)}
	/>

	<ClientTeamHero onAddClick={() => (inviteOpen = true)} />

	<ClientTeamStats
		total={stats.total}
		online={stats.online}
		pending={stats.pending}
		openTasks={stats.openTasks}
	/>

	<ClientTeamRoleChips roles={roleChips} active={roleFilter} onChange={(r) => (roleFilter = r)} />

	<div class="cteam-body px-7 py-6">
		<div class="cteam-grid grid gap-3" style:grid-template-columns="repeat(auto-fill, minmax(300px, 1fr))">
			{#each filteredMembers as m (m.id)}
				{@const roleDef = ROLE_DEFS.find((r) => r.id === m.role) ?? ROLE_DEFS[2]}
				<ClientTeamMemberCard
					id={m.id}
					firstName={m.firstName}
					lastName={m.lastName}
					email={m.email}
					phone={m.phone}
					title={m.title}
					roleLabel={roleDef.label}
					roleColor={roleDef.color}
					roleBg={roleDef.bg}
					online={false}
					lastActive={null}
					addedAt={m.addedAt}
					onEmailClick={() => m.email && (window.location.href = `mailto:${m.email}`)}
				/>
			{/each}

			<button
				type="button"
				class="cteam-add flex min-h-[200px] flex-col items-center justify-center gap-2 rounded-[14px] border-2 border-dashed border-[#d5dbe5] bg-transparent p-4 text-[#475569] transition-colors hover:border-[#1877F2] hover:bg-[#1877F2]/[0.04] hover:text-[#1877F2]"
				onclick={() => (inviteOpen = true)}
			>
				<div class="grid h-12 w-12 place-items-center rounded-full bg-[#f0f7ff] text-[#1877F2]">
					<PlusIcon class="h-6 w-6" />
				</div>
				<span class="text-[13px] font-semibold">Adaugă coleg</span>
				<span class="text-[11.5px] text-[#94a3b8]">Trimite invitație pe email</span>
			</button>
		</div>
	</div>
</div>

<ClientTeamInviteModal
	open={inviteOpen}
	{clientId}
	roles={ROLE_DEFS.map((r) => ({ id: r.id, label: r.label, description: r.description, color: r.color }))}
	onClose={() => (inviteOpen = false)}
/>
```

> NOTE: The existing `+page.server.ts` for this route may need updating to expose `clientId` on the `data` prop. Check the current file — if `data.clientId` already exists, no change needed. Otherwise, ensure the server load returns `{ clientId }`.

- [ ] **Step 2: Verify server load exposes clientId**

```bash
cat src/routes/client/\[tenant\]/\(app\)/team/+page.server.ts 2>&1 | head -30
```

If `clientId` is not in the returned object, add it:

```ts
return {
  clientId: event.locals.client?.id ?? null
  // ... other existing fields
};
```

- [ ] **Step 3: svelte-check**

```bash
NODE_OPTIONS="--max-old-space-size=8192" npx svelte-check --threshold error 2>&1 | tail -3
```

Verify: no new errors vs baseline.

- [ ] **Step 4: Commit**

```bash
git add src/routes/client/\[tenant\]/\(app\)/team/+page.svelte
git commit -m "feat(client-team): rewrite team page 1:1 with cteam design"
```

### Task 20: Phase 2 verification — manual visual check

- [ ] **Step 1: Hard refresh** browser at `/client/{tenant}/team`.

Verify:
- Top breadcrumb: Setări companie › Echipa mea
- Title "Echipa {ClientName}" + stat subtitle line
- Search + Permisiuni + Invită coleg buttons top-right
- Blue gradient hero panel with "Invită echipa" + Adaugă acum button
- 4-stat strip (Members / Online / Pending / Open Tasks)
- Role filter chips (Toți / Owner / Admin / Member / Viewer)
- Member grid: each card shows avatar + online dot, name, title, role pill, email, phone, status line, footer with Added date + 2 quick-action buttons
- "+ Adaugă coleg" dashed card at end of grid
- Click "Invită coleg" → modal opens with email field + 4-role selector

- [ ] **Step 2: Phase 2 marker commit**

```bash
git commit --allow-empty -m "milestone: Phase 2 — Client Team 1:1 complete"
```

---

## Phase 3 — Ship

### Task 21: Final svelte-check + autofixer sweep

- [ ] **Step 1: Run full svelte-check**

```bash
cd /Users/augustin598/Projects/CRM/.claude/worktrees/practical-kilby-15341a/app
NODE_OPTIONS="--max-old-space-size=8192" npx svelte-check --threshold error 2>&1 | tail -3
```

Expected: `9 errors and N warnings`. The 9 errors should match baseline (pre-existing in unrelated files). If higher than 9, identify which new file introduced errors and fix.

- [ ] **Step 2: Run task remotes test**

```bash
bun test src/lib/remotes/__tests__/tasks.remote.test.ts 2>&1 | tail -3
```

Expected: `29 pass 0 fail` (no new test files added; we changed only UI components).

- [ ] **Step 3: Final autofixer sweep**

For each new component file under `src/lib/components/client-task/` and `src/lib/components/client-team/`, invoke the Svelte MCP autofixer. Fix any issue reported. The expected count is 13 components total (5 client-team + 8 client-task).

### Task 22: Merge + push

- [ ] **Step 1: Verify branch state**

```bash
git log --oneline -5 claude/practical-kilby-15341a
git status --short
```

Expected: clean working tree, branch has ~20 new commits since main.

- [ ] **Step 2: Fast-forward merge to main**

```bash
cd /Users/augustin598/Projects/CRM
git checkout main
git merge --ff-only claude/practical-kilby-15341a
```

Expected: `Fast-forward` output, no conflicts.

- [ ] **Step 3: Push**

(Wait for user approval — they have repeatedly indicated push to main requires explicit go-ahead.)

```bash
git push origin main
```

---

## Self-Review (engineer should run after writing each section)

**1. Spec coverage:** All design sections from the audit are covered:
- ✓ breadcrumb topbar → Task 11 (in `client-task-detail-body.svelte`)
- ✓ page head with pills + Meet/Back → Task 2
- ✓ description ct-desc → Task 3
- ✓ comments with reactions + replies + paste image + thumb gallery → Task 3
- ✓ image lightbox with prev/next + ESC + Arrow keys → Task 1
- ✓ right rail with 5 cards (meta/progress/team/materials/activity) → Tasks 4–9
- ✓ materials with 4 tabs + colored gradient icons + dropzone → Task 7
- ✓ Meet modal with attendees + checkboxes → Task 10
- ✓ Client Team header → Task 13
- ✓ Client Team hero panel → Task 14
- ✓ Client Team 4-stat strip → Task 15
- ✓ Client Team role chips → Task 16
- ✓ Client Team member card with quick actions → Task 17
- ✓ Client Team invite modal → Task 18
- ✓ Client Team grid with add card → Task 19

**2. Placeholder scan:** No "TBD" / "TODO" / "fill in later". Every component has full code. The NOTE blocks flag where the engineer must verify remote signatures match — that's grounded, not vague.

**3. Type consistency:** `LightboxImage` is defined once in Task 1 and reused across Tasks 3, 7, 9, 11. `Subtask`, `Assignee` types are defined where first used and reused via prop typing. `RoleId` exported from chips component and imported in page.

---

## Open questions / decisions (engineer should resolve as they go)

- **Comments remote signatures:** The exact field names in `getTaskComments` may differ from this plan (`attachments`, `reactions`, `replies`). Engineer reads the existing `task-comment-thread.svelte` and copies the call patterns, adjusting field accessors as needed.
- **`uploadCommentImage` vs `uploadImage`:** Existing admin code may use one or the other. Use whichever is exported from `task-comments.remote.ts`.
- **`inviteClientSecondaryUser`:** Verify exact name in `client-secondary-emails.remote.ts`. If only `addClientSecondaryEmail` exists, adapt the call.
- **`scheduleMeet` signature:** Verify the argument shape (`{ taskId, title, date, time, durationMinutes, inviteeIds, addToCalendar, sendEmail }`) matches the existing remote. If not, simplify the modal payload to match what's available.
- **Online presence:** This plan treats `online` as a static `false` derived from no signal. If the user wants real presence later, add a `getClientTeamActivity` remote that returns `{ userId, lastActiveAt }` and pass `online = (Date.now() - lastActiveAt) < 5*60_000` to the card.

---

**Status:** Plan complete. Implementation blocked on Augustin approval and resolution of which Phase 3 commit is push-to-main authorized.
