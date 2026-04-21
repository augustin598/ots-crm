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
		hasActiveFilters,
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
		onClickToday?: () => void;
	}

	const { filters, counters, clients, onGoToToday, onClickToday }: Props = $props();

	const FILTER_KEYS = ['status', 'priority', 'client', 'overdue'] as const;

	function updateUrl(next: Filters) {
		const url = new URL(page.url);
		for (const k of FILTER_KEYS) url.searchParams.delete(k);
		const sp = filtersToSearchParams(next);
		sp.forEach((v, k) => url.searchParams.set(k, v));
		goto(url, { replaceState: true, keepFocus: true, noScroll: true });
	}

	function handleBadgeKey(e: KeyboardEvent, fn: () => void) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			fn();
		}
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
	const hasAny = $derived(hasActiveFilters(filters));
</script>

<div class="mb-4 flex flex-wrap items-center gap-2">
	<!-- Status -->
	<Popover.Root>
		<Popover.Trigger>
			{#snippet child({ props })}
				<Button {...props} variant="outline" size="sm">
					{statusLabel}
					<ChevronDown class="ml-1 h-3 w-3" />
				</Button>
			{/snippet}
		</Popover.Trigger>
		<Popover.Content class="w-56 p-2">
			<div class="flex flex-col gap-1">
				{#each STATUS_OPTIONS as opt (opt.value)}
					<label class="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-accent">
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
					<ChevronDown class="ml-1 h-3 w-3" />
				</Button>
			{/snippet}
		</Popover.Trigger>
		<Popover.Content class="w-56 p-2">
			<div class="flex flex-col gap-1">
				{#each PRIORITY_OPTIONS as opt (opt.value)}
					<label class="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-accent">
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
					<ChevronDown class="ml-1 h-3 w-3" />
				</Button>
			{/snippet}
		</Popover.Trigger>
		<Popover.Content class="max-h-[300px] w-64 overflow-auto p-2">
			<div class="flex flex-col gap-1">
				<button
					type="button"
					class="rounded px-2 py-1.5 text-left text-sm hover:bg-accent {filters.clientId === null
						? 'font-semibold'
						: ''}"
					onclick={() => setClient(null)}
				>
					All clients
				</button>
				{#each clients as c (c.id)}
					<button
						type="button"
						class="truncate rounded px-2 py-1.5 text-left text-sm hover:bg-accent {filters.clientId ===
						c.id
							? 'bg-accent/50 font-semibold'
							: ''}"
						onclick={() => setClient(c.id)}
						title={c.name}
					>
						{c.name}
					</button>
				{/each}
				{#if clients.length === 0}
					<span class="px-2 py-1.5 text-xs text-muted-foreground">No clients with tasks</span>
				{/if}
			</div>
		</Popover.Content>
	</Popover.Root>

	<!-- Only overdue -->
	<label class="flex cursor-pointer items-center gap-2 text-sm select-none">
		<Checkbox checked={filters.onlyOverdue} onCheckedChange={() => toggleOverdue()} />
		Doar overdue
	</label>

	<!-- Today -->
	<Button variant="outline" size="sm" onclick={onGoToToday}>
		<CalendarClock class="mr-1 h-3 w-3" />
		Azi
	</Button>

	<!-- Clear -->
	{#if hasAny}
		<Button variant="ghost" size="sm" onclick={clearAll}>
			<X class="mr-1 h-3 w-3" />
			Clear
		</Button>
	{/if}

	<!-- Counter badges (right side) -->
	<div class="ml-auto flex flex-wrap items-center gap-2">
		<Badge
			variant="outline"
			class="cursor-pointer hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-red-900/20 {counters.overdue >
			0
				? 'border-red-500 text-red-600 dark:text-red-400'
				: ''}"
			onclick={applyOverdueFilter}
			onkeydown={(e) => handleBadgeKey(e, applyOverdueFilter)}
			role="button"
			tabindex={0}
		>
			{counters.overdue} overdue
		</Badge>
		<Badge
			variant="outline"
			class={onClickToday
				? 'cursor-pointer hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring'
				: 'cursor-default'}
			onclick={onClickToday}
			onkeydown={onClickToday ? (e) => handleBadgeKey(e, onClickToday) : undefined}
			role={onClickToday ? 'button' : undefined}
			tabindex={onClickToday ? 0 : undefined}
		>
			{counters.today} today
		</Badge>
		<Badge
			variant="outline"
			class="cursor-pointer hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-blue-900/20"
			onclick={() => applyStatusFilter('in-progress')}
			onkeydown={(e) => handleBadgeKey(e, () => applyStatusFilter('in-progress'))}
			role="button"
			tabindex={0}
		>
			{counters.inProgress} in progress
		</Badge>
	</div>
</div>
