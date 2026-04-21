# My Plans UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework `/ots/my-plans` calendar so status, priority, and overdue are all readable at a glance, with URL-backed filters and a live counter. Spec: [`docs/superpowers/specs/2026-04-21-my-plans-ux-design.md`](../specs/2026-04-21-my-plans-ux-design.md).

**Architecture:** Extract the current inline pill markup into a `<TaskPill>` component driven by status group + priority + overdue. Add a `<PlansToolbar>` that reads/writes URL query params for filtering and exposes click-to-filter counter badges. Add a `<PlansLegend>` collapsible explaining color coding. Keep all filtering client-side (the remote already returns 3 months of tasks).

**Tech Stack:** SvelteKit 5 (runes), TypeScript, Tailwind, bits-ui calendar, shadcn-svelte components (Popover, Checkbox, Collapsible, Badge, Button), `@lucide/svelte` icons, `@internationalized/date`. No new deps.

**Testing note:** This repo has **no vitest/unit-test runner**. Verification is via `bun run check` (svelte-check), Svelte MCP `svelte-autofixer` per new component, and manual browser testing. Each pure helper is written to be trivially testable but no test files are added in this plan.

**Working directory:** `/Users/augustin598/Projects/CRM/.claude/worktrees/silly-rubin-a7370a`. All paths below are repo-relative.

**Dev server caveat (memory note):** User runs localhost from `main`, not this worktree. After each task that produces user-visible changes, the user will only see them after the branch is merged. Don't rely on "go look at localhost" during tasks — rely on `bun run check` and code review.

---

## File Structure

**New files:**

| Path | Responsibility |
|------|----------------|
| `app/src/lib/components/my-plans/filters.ts` | Pure helpers: `parseFilters`, `applyFilters`, `isTaskOverdue`, `getStatusGroup`, plus shared constants for status/priority options. Zero Svelte, zero DOM. |
| `app/src/lib/components/my-plans/task-pill.svelte` | Renders a single task as a pill with status color, priority border, status icon, overdue ring. Draggable + clickable. |
| `app/src/lib/components/my-plans/plans-toolbar.svelte` | Filter dropdowns (status/priority/client) + "Doar overdue" toggle + "Azi" button + counter badges. Reads/writes URL. |
| `app/src/lib/components/my-plans/plans-legend.svelte` | Collapsible legend explaining colors. State in localStorage. |

**Modified files:**

| Path | Change |
|------|--------|
| `app/src/routes/[tenant]/my-plans/+page.svelte` | Replace inline pill markup with `<TaskPill>`, add toolbar + legend, wire filters through `$derived`. |

---

## Task 1: `filters.ts` — pure helpers

**Files:**
- Create: `app/src/lib/components/my-plans/filters.ts`

- [ ] **Step 1: Create the file with types, constants, and helpers**

```ts
import type { Task } from '$lib/server/db/schema';
import { today, getLocalTimeZone, type DateValue } from '@internationalized/date';

// ── status groups ─────────────────────────────────────────────────────────
export type StatusGroup = 'todo' | 'in-progress' | 'done' | 'cancelled';

export const STATUS_OPTIONS = [
	{ value: 'todo', label: 'To do' },
	{ value: 'pending-approval', label: 'Pending approval' },
	{ value: 'in-progress', label: 'In progress' },
	{ value: 'review', label: 'Review' },
	{ value: 'done', label: 'Done' },
	{ value: 'cancelled', label: 'Cancelled' }
] as const;

export type TaskStatus = (typeof STATUS_OPTIONS)[number]['value'];

export const PRIORITY_OPTIONS = [
	{ value: 'urgent', label: 'Urgent' },
	{ value: 'high', label: 'High' },
	{ value: 'medium', label: 'Medium' },
	{ value: 'low', label: 'Low' }
] as const;

export type TaskPriority = (typeof PRIORITY_OPTIONS)[number]['value'];

export function getStatusGroup(status: string | null | undefined): StatusGroup {
	switch (status) {
		case 'done':
			return 'done';
		case 'cancelled':
			return 'cancelled';
		case 'in-progress':
		case 'review':
			return 'in-progress';
		default:
			return 'todo';
	}
}

// ── overdue ───────────────────────────────────────────────────────────────
export function isTaskOverdue(task: Pick<Task, 'dueDate' | 'status'>, now: DateValue): boolean {
	if (!task.dueDate) return false;
	if (task.status === 'done' || task.status === 'cancelled') return false;
	const due = new Date(task.dueDate);
	const nowDate = new Date(now.year, now.month - 1, now.day);
	return due < nowDate;
}

// ── filters ───────────────────────────────────────────────────────────────
export interface Filters {
	status: TaskStatus[];
	priority: TaskPriority[];
	clientId: string | null;
	onlyOverdue: boolean;
}

const VALID_STATUS = new Set(STATUS_OPTIONS.map((o) => o.value));
const VALID_PRIORITY = new Set(PRIORITY_OPTIONS.map((o) => o.value));

export function parseFilters(searchParams: URLSearchParams): Filters {
	const parseCsv = <T extends string>(key: string, allowed: Set<string>): T[] => {
		const raw = searchParams.get(key);
		if (!raw) return [];
		return raw
			.split(',')
			.map((s) => s.trim())
			.filter((s) => allowed.has(s)) as T[];
	};
	return {
		status: parseCsv<TaskStatus>('status', VALID_STATUS),
		priority: parseCsv<TaskPriority>('priority', VALID_PRIORITY),
		clientId: searchParams.get('client') || null,
		onlyOverdue: searchParams.get('overdue') === '1'
	};
}

export function filtersToSearchParams(filters: Filters): URLSearchParams {
	const params = new URLSearchParams();
	if (filters.status.length) params.set('status', filters.status.join(','));
	if (filters.priority.length) params.set('priority', filters.priority.join(','));
	if (filters.clientId) params.set('client', filters.clientId);
	if (filters.onlyOverdue) params.set('overdue', '1');
	return params;
}

export function hasActiveFilters(filters: Filters): boolean {
	return (
		filters.status.length > 0 ||
		filters.priority.length > 0 ||
		filters.clientId !== null ||
		filters.onlyOverdue
	);
}

export function matchesFilters(
	task: Pick<Task, 'status' | 'priority' | 'clientId' | 'dueDate'>,
	filters: Filters,
	now: DateValue
): boolean {
	if (filters.status.length && !filters.status.includes(task.status as TaskStatus)) return false;
	if (filters.priority.length && !filters.priority.includes(task.priority as TaskPriority))
		return false;
	if (filters.clientId && task.clientId !== filters.clientId) return false;
	if (filters.onlyOverdue && !isTaskOverdue(task, now)) return false;
	return true;
}

// ── counters ──────────────────────────────────────────────────────────────
export interface Counters {
	overdue: number;
	today: number;
	inProgress: number;
}

export function computeCounters(
	tasks: Pick<Task, 'dueDate' | 'status'>[],
	now: DateValue
): Counters {
	let overdue = 0;
	let todayCount = 0;
	let inProgress = 0;
	const nowYMD = `${now.year}-${String(now.month).padStart(2, '0')}-${String(now.day).padStart(2, '0')}`;
	for (const t of tasks) {
		if (isTaskOverdue(t, now)) overdue++;
		if (t.dueDate) {
			const dueYMD = new Date(t.dueDate).toISOString().split('T')[0];
			if (dueYMD === nowYMD && t.status !== 'done' && t.status !== 'cancelled') todayCount++;
		}
		if (t.status === 'in-progress' || t.status === 'review') inProgress++;
	}
	return { overdue, today: todayCount, inProgress };
}

// ── styling maps (re-exported so components don't duplicate them) ─────────
export const STATUS_GROUP_CLASSES: Record<StatusGroup, string> = {
	todo: 'bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-300',
	'in-progress': 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
	done: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300 line-through opacity-60',
	cancelled:
		'bg-zinc-100 text-zinc-500 dark:bg-zinc-900/30 dark:text-zinc-400 line-through opacity-40 italic'
};

export const PRIORITY_BORDER_CLASSES: Record<TaskPriority | 'none', string> = {
	urgent: 'border-l-red-500',
	high: 'border-l-orange-500',
	medium: 'border-l-blue-500',
	low: 'border-l-emerald-500',
	none: 'border-l-gray-300'
};

// exported for legend component
export const STATUS_GROUP_DOT_CLASSES: Record<StatusGroup, string> = {
	todo: 'bg-slate-400',
	'in-progress': 'bg-blue-500',
	done: 'bg-emerald-500',
	cancelled: 'bg-zinc-400'
};

export { today, getLocalTimeZone };
```

- [ ] **Step 2: Type-check**

Run from `app/`:
```
bun run check
```
Expected: 0 new errors introduced by this file.

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/components/my-plans/filters.ts
git commit -m "feat(my-plans): add filter/status helpers for calendar UX rework"
```

---

## Task 2: `<TaskPill>` component

**Files:**
- Create: `app/src/lib/components/my-plans/task-pill.svelte`

- [ ] **Step 1: Create the component**

```svelte
<script lang="ts">
	import type { Task } from '$lib/server/db/schema';
	import {
		Circle,
		CircleDashed,
		CircleDot,
		Eye,
		CheckCircle2,
		XCircle
	} from '@lucide/svelte';
	import {
		getStatusGroup,
		STATUS_GROUP_CLASSES,
		PRIORITY_BORDER_CLASSES,
		type TaskPriority
	} from './filters';

	interface Props {
		task: Task;
		isOverdue: boolean;
		dimmed?: boolean;
		onclick?: (event: MouseEvent) => void;
		ondragstart?: (event: DragEvent) => void;
		ondragend?: (event: DragEvent) => void;
	}

	const {
		task,
		isOverdue,
		dimmed = false,
		onclick,
		ondragstart,
		ondragend
	}: Props = $props();

	const group = $derived(getStatusGroup(task.status));
	const priorityKey = $derived<keyof typeof PRIORITY_BORDER_CLASSES>(
		(task.priority as TaskPriority) || 'none'
	);

	const StatusIcon = $derived.by(() => {
		switch (task.status) {
			case 'todo':
				return Circle;
			case 'pending-approval':
				return CircleDashed;
			case 'in-progress':
				return CircleDot;
			case 'review':
				return Eye;
			case 'done':
				return CheckCircle2;
			case 'cancelled':
				return XCircle;
			default:
				return Circle;
		}
	});

	function handleKey(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onclick?.(e as unknown as MouseEvent);
		}
	}
</script>

<div
	class="relative flex items-center gap-1.5 text-xs text-start px-2 py-1 rounded-md truncate font-medium shadow-sm border border-current/20 border-l-4 cursor-grab active:cursor-grabbing hover:opacity-80 transition-opacity {STATUS_GROUP_CLASSES[
		group
	]} {PRIORITY_BORDER_CLASSES[priorityKey]} {isOverdue ? 'ring-1 ring-red-500 ring-offset-1' : ''} {dimmed
		? 'opacity-25 pointer-events-none'
		: ''}"
	title={task.title}
	draggable={true}
	{ondragstart}
	{ondragend}
	{onclick}
	onkeydown={handleKey}
	role="button"
	tabindex="0"
	aria-label={isOverdue ? `Overdue: ${task.title}` : task.title}
>
	<StatusIcon class="h-3 w-3 shrink-0" aria-hidden="true" />
	<span class="truncate">{task.title}</span>
	{#if isOverdue}
		<span
			class="absolute -top-1 -right-1 w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse"
			aria-hidden="true"
		></span>
	{/if}
</div>
```

- [ ] **Step 2: Run Svelte MCP autofixer**

Use the `svelte-autofixer` tool from the `svelte` MCP server on the file path `app/src/lib/components/my-plans/task-pill.svelte`. Fix any issues it reports, then re-run until clean (per `feedback_svelte_mcp_check.md`).

- [ ] **Step 3: Type-check**

```
cd app && bun run check
```
Expected: 0 new errors.

- [ ] **Step 4: Commit**

```bash
git add app/src/lib/components/my-plans/task-pill.svelte
git commit -m "feat(my-plans): add TaskPill with status colors, priority border, overdue ring"
```

---

## Task 3: `<PlansToolbar>` component

**Files:**
- Create: `app/src/lib/components/my-plans/plans-toolbar.svelte`

- [ ] **Step 1: Create the component**

```svelte
<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Popover from '$lib/components/ui/popover';
	import {
		STATUS_OPTIONS,
		PRIORITY_OPTIONS,
		filtersToSearchParams,
		type Filters,
		type Counters,
		type TaskStatus,
		type TaskPriority
	} from './filters';
	import { ChevronDown, X, CalendarClock } from '@lucide/svelte';

	interface ClientOption {
		id: string;
		name: string;
	}

	interface Props {
		filters: Filters;
		counters: Counters;
		clients: ClientOption[];
		onGoToToday: () => void;
	}

	const { filters, counters, clients, onGoToToday }: Props = $props();

	function updateUrl(next: Filters) {
		const sp = filtersToSearchParams(next);
		const url = new URL(page.url);
		url.search = sp.toString();
		goto(url, { replaceState: true, keepFocus: true, noScroll: true });
	}

	function toggleStatus(value: TaskStatus) {
		const has = filters.status.includes(value);
		const next: Filters = {
			...filters,
			status: has ? filters.status.filter((v) => v !== value) : [...filters.status, value]
		};
		updateUrl(next);
	}

	function togglePriority(value: TaskPriority) {
		const has = filters.priority.includes(value);
		const next: Filters = {
			...filters,
			priority: has ? filters.priority.filter((v) => v !== value) : [...filters.priority, value]
		};
		updateUrl(next);
	}

	function setClient(id: string | null) {
		updateUrl({ ...filters, clientId: id });
	}

	function toggleOverdue() {
		updateUrl({ ...filters, onlyOverdue: !filters.onlyOverdue });
	}

	function clearAll() {
		updateUrl({ status: [], priority: [], clientId: null, onlyOverdue: false });
	}

	function applyStatusFilter(value: TaskStatus) {
		updateUrl({ ...filters, status: [value] });
	}

	function applyOverdueFilter() {
		updateUrl({ ...filters, onlyOverdue: true });
	}

	const statusLabel = $derived(
		filters.status.length === 0
			? 'Status'
			: filters.status.length === 1
				? `Status: ${STATUS_OPTIONS.find((o) => o.value === filters.status[0])?.label}`
				: `Status (${filters.status.length})`
	);
	const priorityLabel = $derived(
		filters.priority.length === 0
			? 'Priority'
			: filters.priority.length === 1
				? `Priority: ${PRIORITY_OPTIONS.find((o) => o.value === filters.priority[0])?.label}`
				: `Priority (${filters.priority.length})`
	);
	const clientLabel = $derived(
		filters.clientId
			? `Client: ${clients.find((c) => c.id === filters.clientId)?.name ?? '…'}`
			: 'Client'
	);
	const hasAny = $derived(
		filters.status.length > 0 ||
			filters.priority.length > 0 ||
			filters.clientId !== null ||
			filters.onlyOverdue
	);
</script>

<div class="flex flex-wrap items-center gap-2 mb-4">
	<!-- Status -->
	<Popover.Root>
		<Popover.Trigger>
			{#snippet child({ props })}
				<Button {...props} variant="outline" size="sm">
					{statusLabel}
					<ChevronDown class="h-3 w-3 ml-1" />
				</Button>
			{/snippet}
		</Popover.Trigger>
		<Popover.Content class="w-56 p-2">
			<div class="flex flex-col gap-1">
				{#each STATUS_OPTIONS as opt}
					<label class="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent cursor-pointer">
						<Checkbox
							checked={filters.status.includes(opt.value)}
							onCheckedChange={() => toggleStatus(opt.value)}
						/>
						<span class="text-sm">{opt.label}</span>
					</label>
				{/each}
			</div>
		</Popover.Content>
	</Popover.Root>

	<!-- Priority -->
	<Popover.Root>
		<Popover.Trigger>
			{#snippet child({ props })}
				<Button {...props} variant="outline" size="sm">
					{priorityLabel}
					<ChevronDown class="h-3 w-3 ml-1" />
				</Button>
			{/snippet}
		</Popover.Trigger>
		<Popover.Content class="w-56 p-2">
			<div class="flex flex-col gap-1">
				{#each PRIORITY_OPTIONS as opt}
					<label class="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent cursor-pointer">
						<Checkbox
							checked={filters.priority.includes(opt.value)}
							onCheckedChange={() => togglePriority(opt.value)}
						/>
						<span class="text-sm">{opt.label}</span>
					</label>
				{/each}
			</div>
		</Popover.Content>
	</Popover.Root>

	<!-- Client -->
	<Popover.Root>
		<Popover.Trigger>
			{#snippet child({ props })}
				<Button {...props} variant="outline" size="sm">
					{clientLabel}
					<ChevronDown class="h-3 w-3 ml-1" />
				</Button>
			{/snippet}
		</Popover.Trigger>
		<Popover.Content class="w-64 p-2 max-h-[300px] overflow-auto">
			<div class="flex flex-col gap-1">
				<button
					type="button"
					class="text-left text-sm px-2 py-1.5 rounded hover:bg-accent {filters.clientId === null
						? 'font-semibold'
						: ''}"
					onclick={() => setClient(null)}
				>
					All clients
				</button>
				{#each clients as c}
					<button
						type="button"
						class="text-left text-sm px-2 py-1.5 rounded hover:bg-accent truncate {filters.clientId ===
						c.id
							? 'font-semibold bg-accent/50'
							: ''}"
						onclick={() => setClient(c.id)}
						title={c.name}
					>
						{c.name}
					</button>
				{/each}
				{#if clients.length === 0}
					<span class="text-xs text-muted-foreground px-2 py-1.5">No clients with tasks</span>
				{/if}
			</div>
		</Popover.Content>
	</Popover.Root>

	<!-- Only overdue -->
	<label class="flex items-center gap-2 text-sm cursor-pointer select-none">
		<Checkbox checked={filters.onlyOverdue} onCheckedChange={() => toggleOverdue()} />
		Doar overdue
	</label>

	<!-- Today -->
	<Button variant="outline" size="sm" onclick={onGoToToday}>
		<CalendarClock class="h-3 w-3 mr-1" />
		Azi
	</Button>

	<!-- Clear -->
	{#if hasAny}
		<Button variant="ghost" size="sm" onclick={clearAll}>
			<X class="h-3 w-3 mr-1" />
			Clear
		</Button>
	{/if}

	<!-- Counter badges (right side) -->
	<div class="ml-auto flex items-center gap-2 flex-wrap">
		<Badge
			variant="outline"
			class="cursor-pointer hover:bg-red-50 dark:hover:bg-red-900/20 {counters.overdue > 0
				? 'border-red-500 text-red-600 dark:text-red-400'
				: ''}"
			onclick={applyOverdueFilter}
			role="button"
			tabindex={0}
		>
			{counters.overdue} overdue
		</Badge>
		<Badge variant="outline" class="cursor-default">
			{counters.today} today
		</Badge>
		<Badge
			variant="outline"
			class="cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/20"
			onclick={() => applyStatusFilter('in-progress')}
			role="button"
			tabindex={0}
		>
			{counters.inProgress} in progress
		</Badge>
	</div>
</div>
```

- [ ] **Step 2: Run Svelte MCP autofixer**

Run `svelte-autofixer` on `app/src/lib/components/my-plans/plans-toolbar.svelte`. Fix issues until clean.

- [ ] **Step 3: Type-check**

```
cd app && bun run check
```
Expected: 0 new errors.

- [ ] **Step 4: Commit**

```bash
git add app/src/lib/components/my-plans/plans-toolbar.svelte
git commit -m "feat(my-plans): add toolbar with URL-backed filters and counter badges"
```

---

## Task 4: `<PlansLegend>` component

**Files:**
- Create: `app/src/lib/components/my-plans/plans-legend.svelte`

- [ ] **Step 1: Create the component**

```svelte
<script lang="ts">
	import * as Collapsible from '$lib/components/ui/collapsible';
	import { Button } from '$lib/components/ui/button';
	import { ChevronDown, ChevronRight } from '@lucide/svelte';
	import { STATUS_GROUP_DOT_CLASSES } from './filters';
	import { onMount } from 'svelte';

	const STORAGE_KEY = 'my-plans-legend-open';
	let open = $state(true);

	onMount(() => {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw !== null) open = raw === '1';
		} catch {
			// ignore
		}
	});

	function handleOpenChange(next: boolean) {
		open = next;
		try {
			localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
		} catch {
			// ignore
		}
	}
</script>

<Collapsible.Root {open} onOpenChange={handleOpenChange}>
	<Collapsible.Trigger>
		{#snippet child({ props })}
			<Button {...props} variant="ghost" size="sm" class="text-xs text-muted-foreground">
				{#if open}
					<ChevronDown class="h-3 w-3 mr-1" />
				{:else}
					<ChevronRight class="h-3 w-3 mr-1" />
				{/if}
				Legendă
			</Button>
		{/snippet}
	</Collapsible.Trigger>
	<Collapsible.Content>
		<div class="flex flex-wrap items-center gap-4 text-xs text-muted-foreground px-3 py-2">
			<div class="flex items-center gap-3">
				<span class="font-medium text-foreground">Status:</span>
				<span class="inline-flex items-center gap-1.5">
					<span class="w-2 h-2 rounded-full {STATUS_GROUP_DOT_CLASSES.todo}"></span>
					To do
				</span>
				<span class="inline-flex items-center gap-1.5">
					<span class="w-2 h-2 rounded-full {STATUS_GROUP_DOT_CLASSES['in-progress']}"></span>
					In progress
				</span>
				<span class="inline-flex items-center gap-1.5">
					<span class="w-2 h-2 rounded-full {STATUS_GROUP_DOT_CLASSES.done}"></span>
					Done
				</span>
				<span class="inline-flex items-center gap-1.5">
					<span class="w-2 h-2 rounded-full {STATUS_GROUP_DOT_CLASSES.cancelled}"></span>
					Cancelled
				</span>
			</div>
			<span class="text-border">│</span>
			<div class="flex items-center gap-3">
				<span class="font-medium text-foreground">Priority:</span>
				<span class="inline-flex items-center gap-1.5">
					<span class="w-1 h-3 bg-red-500 rounded-sm"></span>Urgent
				</span>
				<span class="inline-flex items-center gap-1.5">
					<span class="w-1 h-3 bg-orange-500 rounded-sm"></span>High
				</span>
				<span class="inline-flex items-center gap-1.5">
					<span class="w-1 h-3 bg-blue-500 rounded-sm"></span>Medium
				</span>
				<span class="inline-flex items-center gap-1.5">
					<span class="w-1 h-3 bg-emerald-500 rounded-sm"></span>Low
				</span>
			</div>
			<span class="text-border">│</span>
			<span class="inline-flex items-center gap-1.5">
				<span class="w-2 h-2 rounded-full ring-1 ring-red-500 ring-offset-1"></span>
				Overdue
			</span>
		</div>
	</Collapsible.Content>
</Collapsible.Root>
```

- [ ] **Step 2: Run Svelte MCP autofixer**

Run `svelte-autofixer` on `app/src/lib/components/my-plans/plans-legend.svelte`. Fix until clean.

- [ ] **Step 3: Type-check**

```
cd app && bun run check
```
Expected: 0 new errors.

- [ ] **Step 4: Commit**

```bash
git add app/src/lib/components/my-plans/plans-legend.svelte
git commit -m "feat(my-plans): add collapsible legend with status/priority/overdue keys"
```

---

## Task 5: Integrate components into `+page.svelte`

**Files:**
- Modify: `app/src/routes/[tenant]/my-plans/+page.svelte`

This is the big change. We replace the inline pill with `<TaskPill>`, insert the toolbar and legend, wire URL filters, compute counters, and add weekend / overdue-dot to cells.

- [ ] **Step 1: Add imports**

Open `app/src/routes/[tenant]/my-plans/+page.svelte`. At the end of the existing `<script>` imports block (around line 21), add:

```ts
import TaskPill from '$lib/components/my-plans/task-pill.svelte';
import PlansToolbar from '$lib/components/my-plans/plans-toolbar.svelte';
import PlansLegend from '$lib/components/my-plans/plans-legend.svelte';
import {
	parseFilters,
	matchesFilters,
	isTaskOverdue,
	hasActiveFilters,
	computeCounters,
	type Filters
} from '$lib/components/my-plans/filters';
import { getClients } from '$lib/remotes/clients.remote';
```

- [ ] **Step 2: Add reactive filter state + clients query**

After the existing `const tasks = $derived(tasksQuery.current || []);` (around line 43), add:

```ts
// Filters from URL
const filters: Filters = $derived(parseFilters(page.url.searchParams));

// Clients for filter dropdown (only those that appear in the task range)
const clientsQuery = getClients();
const allClients = $derived(clientsQuery.current || []);
const clientIdsInRange = $derived(new Set(tasks.map((t) => t.clientId).filter(Boolean) as string[]));
const clientsForFilter = $derived(
	allClients
		.filter((c) => clientIdsInRange.has(c.id))
		.map((c) => ({ id: c.id, name: c.name }))
);

// Counters (computed on full task list, not filtered — so they don't lie)
const counters = $derived(computeCounters(tasks, todayDate));

// Apply filters to individual task rendering decisions
function taskMatches(task: Task): boolean {
	return matchesFilters(task, filters, todayDate);
}

// Single-filter "onlyOverdue" => hide non-matching entirely; otherwise dim them
const shouldHideNonMatching = $derived(
	filters.onlyOverdue &&
		filters.status.length === 0 &&
		filters.priority.length === 0 &&
		filters.clientId === null
);
```

- [ ] **Step 3: Add `goToToday` handler**

After `handleDateClick` (around line 154), add:

```ts
function goToToday() {
	calendarValue = todayDate;
	calendarPlaceholder = todayDate;
	selectedDate = todayDate;
}
```

- [ ] **Step 4: Insert toolbar + legend into markup**

Replace the top-level markup block. Find the existing header div (around line 270):

```svelte
<div class="flex items-center justify-between mb-6">
    <div>
        <h1 class="text-3xl font-bold">My Plans</h1>
        <p class="text-muted-foreground mt-1">Plan and organize your tasks</p>
    </div>
    <Button onclick={() => (isCreateDialogOpen = true)}>
        <Plus class="h-4 w-4 mr-2" />
        New Task
    </Button>
</div>
```

Leave that header block unchanged. Immediately after it (before `<div class="flex-1 min-h-0 ">`), insert:

```svelte
<PlansToolbar
    {filters}
    {counters}
    clients={clientsForFilter}
    onGoToToday={goToToday}
/>
```

Then, at the very end of the outermost wrapper `<div class="flex flex-col h-[calc(100vh-6rem)]">` (find the closing `</div>` that matches line 269; it's the one on line 427 before the dialogs), add *just before* it:

```svelte
<div class="mt-2">
    <PlansLegend />
</div>
```

- [ ] **Step 5: Replace inline pill with `<TaskPill>` + add dimming**

Find the `{#each dayTasks.slice(0, 6) as task}` block (around line 364) and replace the inner `<div class="text-xs text-start px-2 py-1 rounded-md ...">...{task.title}</div>` entirely with:

```svelte
{@const pillOverdue = isTaskOverdue(task, todayDate)}
{@const match = taskMatches(task)}
{#if !match && shouldHideNonMatching}
    <!-- hidden by overdue-only filter -->
{:else}
    <TaskPill
        {task}
        isOverdue={pillOverdue}
        dimmed={!match}
        onclick={(e) => handleTaskClick(task, e)}
        ondragstart={(e) => handleDragStart(e, task)}
        ondragend={handleDragEnd}
    />
{/if}
```

Replace the `{#if dayTasks.length > 6}` sibling block with (so the "+N more" respects filters too):

```svelte
{#if dayTasks.length > 6}
    {@const hidden = dayTasks.length - 6}
    <div class="text-xs px-2 py-1 text-muted-foreground truncate font-medium">
        +{hidden} more
    </div>
{/if}
```

- [ ] **Step 6: Add weekend dim + overdue dot on day number**

Find the cell `<button>` class (around line 342). Replace the class attribute with this — note the added `isWeekend` logic and reference to new `isEqualMonth` import already in scope:

```svelte
{@const cellDate = date.toDate(getLocalTimeZone())}
{@const isWeekend = cellDate.getDay() === 0 || cellDate.getDay() === 6}
{@const overdueInDay = dayTasks.filter((t) => isTaskOverdue(t, todayDate)).length}
```

Add those three `{@const}` declarations just below the existing `{@const isDragOver = ...}` line (around line 334).

Then update the button class to include `{isWeekend ? 'bg-muted/20' : ''}`:

```svelte
class="group relative flex flex-col items-start w-full min-h-[180px] h-full p-2 cursor-pointer hover:bg-accent/50 rounded-md transition-all {isSelected ? 'bg-primary/10 ring-2 ring-primary ring-offset-1' : ''} {isToday && !isSelected ? 'bg-accent/30 ring-1 ring-primary/50' : ''} {!isEqualMonth(date, month.value) ? 'opacity-40' : ''} {isDragOver ? 'bg-primary/20 ring-2 ring-primary border-primary' : ''} {isWeekend && isEqualMonth(date, month.value) ? 'bg-muted/20' : ''}"
```

Update the day-number span (around line 348) to add the overdue dot and the TODAY label. Replace the whole:

```svelte
<div class="flex items-center justify-between w-full mb-1.5">
    <span class="text-sm font-semibold {isSelected ? 'text-primary' : isToday && !isSelected ? 'text-primary font-bold' : 'text-foreground'}">
        {date.day}
    </span>
```

with:

```svelte
<div class="flex items-center justify-between w-full mb-1.5">
    <div class="flex items-center gap-1">
        <span class="text-sm font-semibold {isSelected ? 'text-primary' : isToday && !isSelected ? 'text-primary font-bold' : 'text-foreground'}">
            {date.day}
        </span>
        {#if overdueInDay > 0}
            <span
                class="w-1.5 h-1.5 bg-red-500 rounded-full"
                aria-label="{overdueInDay} overdue"
                title="{overdueInDay} overdue"
            ></span>
        {/if}
        {#if isToday && !isSelected}
            <span class="text-[9px] font-semibold uppercase tracking-wider text-primary/70">TODAY</span>
        {/if}
    </div>
```

(Keep the rest of the inner div — the calendar-icon button on the right — unchanged.)

- [ ] **Step 7: Delete the now-unused `getPriorityColor` function**

Remove the `function getPriorityColor(priority: string)` block (lines 128–141 in the original). Check whether it is still referenced in the two remaining dialogs (assign existing task + day-detail dialog). Both still use it (they apply `getPriorityColor` to a `<Badge class={...}>`). To avoid scope creep, **keep** `getPriorityColor` as-is for those two dialogs. Skip this deletion step — note it as follow-up scope if desired.

Action: **Leave `getPriorityColor` untouched.** This step is a no-op; move on.

- [ ] **Step 8: Run Svelte MCP autofixer on the modified page**

Run `svelte-autofixer` on `app/src/routes/[tenant]/my-plans/+page.svelte`. Fix issues until clean.

- [ ] **Step 9: Type-check**

```
cd app && bun run check
```
Expected: 0 new errors. If you see a type error about `getClients`, re-check the import path matches what appears in the Grep results (`app/src/lib/remotes/clients.remote.ts`).

- [ ] **Step 10: Commit**

```bash
git add app/src/routes/[tenant]/my-plans/+page.svelte
git commit -m "feat(my-plans): integrate TaskPill, toolbar, legend, weekend dim + overdue dot"
```

---

## Task 6: Final verification

- [ ] **Step 1: Full type-check**

```
cd app && bun run check
```
Expected: no errors related to the changed files.

- [ ] **Step 2: Lint**

```
cd app && bun run lint
```
Expected: passes on changed files. Fix any prettier/eslint issues by running `bun run format` then re-committing as a separate `style:` commit if needed.

- [ ] **Step 3: Spec-vs-plan coverage walk**

Open [`docs/superpowers/specs/2026-04-21-my-plans-ux-design.md`](../specs/2026-04-21-my-plans-ux-design.md) side by side with the diff. Confirm each design section is implemented:

| Spec section | Implemented in | Check |
|-|-|-|
| A. Pill anatomy (status bg, priority border, status icon, overdue ring + dot) | Task 2 (TaskPill) | ☐ |
| B. Toolbar (filters, Azi, counter badges, click-to-filter) | Task 3 + Task 5 step 4 | ☐ |
| C. Cell (weekend dim, today tag, overdue dot on number, dim-vs-hide non-matching) | Task 5 steps 5–6 | ☐ |
| D. Legend (collapsible, localStorage) | Task 4 + Task 5 step 4 | ☐ |
| Preserved: drag&drop, context menu, create task, day dialog | Task 5 (pill wraps existing handlers) | ☐ |

- [ ] **Step 4: Manual browser smoke test (optional, only if user has merged to main)**

If the user has already merged this branch to main, ask them to smoke-test:

1. Navigate to `/ots/my-plans`
2. Overdue tasks show red ring + pulsing dot
3. Done tasks show line-through + faded
4. Filter `?status=in-progress` in URL → only in-progress pills full opacity, rest dimmed
5. Click "N overdue" badge → URL becomes `?overdue=1`, non-overdue hidden
6. Click "Azi" → calendar snaps to current month, today highlighted
7. Drag a task to another day → still works
8. Refresh with filters in URL → filters persist
9. Toggle legend → collapses; refresh → stays collapsed

If user cannot access localhost, skip this step — code review + type check are sufficient gate.

- [ ] **Step 5: Update CLAUDE memory**

No durable memory update needed — the spec doc and code are the source of truth. The auto-memory system will track "Invoice Email Audit" / "Meta Ads Audit"–style entries only if this is a non-obvious lesson. Skip.

- [ ] **Step 6: Final commit if lint made changes**

If `bun run format` changed files beyond what was already committed:

```bash
git add -A
git commit -m "style(my-plans): prettier formatting"
```

---

## Self-review (author fills this in before handoff)

- ✅ Spec coverage: all 4 sections (A pill / B toolbar / C cell / D legend) have explicit tasks.
- ✅ No placeholders: all code blocks are complete; no "similar to task N" references.
- ✅ Type consistency: `Filters` shape is defined once in `filters.ts`, consumed identically by toolbar (Task 3) and page (Task 5). Status values match the DB enum (Task 1).
- ✅ Out-of-scope respected: no mobile work, no server change, `getPriorityColor` intentionally kept (Task 5 step 7 explicitly skipped to prevent scope creep).
- ✅ No test-runner assumed: verification is svelte-check + svelte-autofixer + manual, matching project reality.
