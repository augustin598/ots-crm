<script lang="ts">
	import { useQueryState, parseAsArrayOf, parseAsStringEnum, parseAsString } from 'nuqs-svelte';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import { Popover, PopoverContent, PopoverTrigger } from '$lib/components/ui/popover';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Label } from '$lib/components/ui/label';
	import { Separator } from '$lib/components/ui/separator';
	import FilterIcon from '@lucide/svelte/icons/filter';
	import XIcon from '@lucide/svelte/icons/x';
	import SearchIcon from '@lucide/svelte/icons/search';
	import {
		TASK_STATUSES,
		TASK_PRIORITIES,
		formatStatus,
		formatPriority,
		formatDateRange
	} from '$lib/utils/task-filters';
	import { getStatusDotColor, getPriorityDotColor } from '$lib/components/task-kanban-utils';

	type Props = {
		projects?: Array<{ id: string; name: string }>;
		users?: Array<{ id: string; firstName: string; lastName: string; email: string }>;
		milestones?: Array<{ id: string; name: string }>;
		clients?: Array<{ id: string; name: string }>;
	};

	let { projects = [], users = [], milestones = [], clients = [] }: Props = $props();

	// Shared nuqs query keys — URL state in sync with task-filters.svelte
	const statuses = useQueryState(
		'status',
		parseAsArrayOf(
			parseAsStringEnum(['todo', 'in-progress', 'review', 'done', 'cancelled', 'pending-approval', 'blocked'])
		)
	);
	const priorities = useQueryState(
		'priority',
		parseAsArrayOf(parseAsStringEnum(['low', 'medium', 'high', 'urgent']))
	);
	const assignees = useQueryState('assignee', parseAsArrayOf(parseAsString));
	const projectIds = useQueryState('project', parseAsArrayOf(parseAsString));
	const milestoneIds = useQueryState('milestone', parseAsArrayOf(parseAsString));
	const clientId = useQueryState('client', parseAsString.withDefault(''));
	const search = useQueryState('search', parseAsString.withDefault(''));
	const dueDate = useQueryState(
		'dueDate',
		parseAsStringEnum(['overdue', 'today', 'thisWeek', 'thisMonth'])
	);

	let popoverOpen = $state(false);

	const activeFiltersCount = $derived(
		((statuses.current as string[] | null)?.length || 0) +
			((priorities.current as string[] | null)?.length || 0) +
			((assignees.current as string[] | null)?.length || 0) +
			((projectIds.current as string[] | null)?.length || 0) +
			((milestoneIds.current as string[] | null)?.length || 0) +
			(clientId.current ? 1 : 0) +
			(dueDate.current ? 1 : 0)
	);

	function toggleStatus(s: string) {
		const current = (statuses.current as string[] | null) || [];
		statuses.current = (current.includes(s) ? current.filter((x) => x !== s) : [...current, s]) as any;
	}

	function togglePriority(p: string) {
		const current = (priorities.current as string[] | null) || [];
		priorities.current = (current.includes(p) ? current.filter((x) => x !== p) : [...current, p]) as any;
	}

	function toggleAssignee(uid: string) {
		const current = (assignees.current as string[] | null) || [];
		assignees.current = (current.includes(uid) ? current.filter((x) => x !== uid) : [...current, uid]) as any;
	}

	function toggleProject(pid: string) {
		const current = (projectIds.current as string[] | null) || [];
		projectIds.current = (current.includes(pid) ? current.filter((x) => x !== pid) : [...current, pid]) as any;
	}

	function toggleMilestone(mid: string) {
		const current = (milestoneIds.current as string[] | null) || [];
		milestoneIds.current = (current.includes(mid) ? current.filter((x) => x !== mid) : [...current, mid]) as any;
	}

	function setClientFilter(id: string | null) {
		clientId.current = id ?? '';
	}

	function clearAllFilters() {
		statuses.current = null as any;
		priorities.current = null as any;
		assignees.current = null as any;
		projectIds.current = null as any;
		milestoneIds.current = null as any;
		clientId.current = '';
		dueDate.current = null as any;
		search.current = '';
	}

	function getUserDisplayName(u: { firstName: string; lastName: string; email: string }): string {
		const name = `${u.firstName} ${u.lastName}`.trim();
		return name || u.email;
	}
</script>

<div class="flex flex-wrap items-center gap-2">
	<!-- Search -->
	<div class="relative flex-1 min-w-[200px]">
		<SearchIcon class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
		<Input bind:value={search.current} placeholder="Search tasks..." class="pl-9" />
	</div>

	<!-- Single Filters Button -->
	<Popover bind:open={popoverOpen}>
		<PopoverTrigger>
			{#snippet child({ props })}
				<Button {...props} variant="outline" size="sm" class="gap-2">
					<FilterIcon class="h-4 w-4" />
					Filters
					{#if activeFiltersCount > 0}
						<Badge variant="secondary" class="ml-1 h-5 px-1.5">{activeFiltersCount}</Badge>
					{/if}
				</Button>
			{/snippet}
		</PopoverTrigger>
		<PopoverContent class="w-[480px] max-w-[calc(100vw-2rem)] max-h-[70vh] overflow-y-auto p-4">
			<div class="space-y-4">
				<!-- Status + Priority side by side -->
				<div class="grid grid-cols-2 gap-4">
					<div class="space-y-2">
						<Label class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
							Status
						</Label>
						<div class="space-y-1.5">
							{#each TASK_STATUSES as status (status)}
								<div class="flex items-center gap-2">
									<Checkbox
										checked={((statuses.current as string[] | null)?.includes(status)) || false}
										onCheckedChange={() => toggleStatus(status)}
										id={`fpov-status-${status}`}
									/>
									<Label
										for={`fpov-status-${status}`}
										class="flex cursor-pointer items-center gap-2 text-sm font-normal"
									>
										<span class="h-2 w-2 rounded-full {getStatusDotColor(status)}"></span>
										{formatStatus(status)}
									</Label>
								</div>
							{/each}
						</div>
					</div>

					<div class="space-y-2">
						<Label class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
							Priority
						</Label>
						<div class="space-y-1.5">
							{#each TASK_PRIORITIES as priority (priority)}
								<div class="flex items-center gap-2">
									<Checkbox
										checked={((priorities.current as string[] | null)?.includes(priority)) || false}
										onCheckedChange={() => togglePriority(priority)}
										id={`fpov-prio-${priority}`}
									/>
									<Label
										for={`fpov-prio-${priority}`}
										class="flex cursor-pointer items-center gap-2 text-sm font-normal"
									>
										<span class="h-2 w-2 rounded-full {getPriorityDotColor(priority)}"></span>
										{formatPriority(priority)}
									</Label>
								</div>
							{/each}
						</div>
					</div>
				</div>

				<Separator />

				<!-- Due Date -->
				<div class="space-y-2">
					<Label class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
						Due Date
					</Label>
					<div class="flex flex-wrap gap-1.5">
						{#each ['overdue', 'today', 'thisWeek', 'thisMonth'] as df (df)}
							<button
								type="button"
								class="rounded-full border px-3 py-1 text-xs transition-colors {dueDate.current ===
								df
									? 'border-primary bg-primary text-primary-foreground'
									: 'border-border hover:bg-accent'}"
								onclick={() => {
									dueDate.current = (dueDate.current === df ? null : df) as any;
								}}
							>
								{formatDateRange(df)}
							</button>
						{/each}
					</div>
				</div>

				{#if clients.length > 0}
					<Separator />
					<!-- Client (single-select) -->
					<div class="space-y-2">
						<Label class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
							Client
						</Label>
						<div class="max-h-32 overflow-y-auto rounded border bg-background/50">
							<button
								type="button"
								class="block w-full px-2 py-1.5 text-left text-sm hover:bg-accent {!clientId.current
									? 'bg-accent/50 font-medium'
									: ''}"
								onclick={() => setClientFilter(null)}
							>
								All clients
							</button>
							{#each clients as c (c.id)}
								<button
									type="button"
									class="block w-full truncate px-2 py-1.5 text-left text-sm hover:bg-accent {clientId.current ===
									c.id
										? 'bg-accent/50 font-medium'
										: ''}"
									onclick={() => setClientFilter(c.id)}
									title={c.name}
								>
									{c.name}
								</button>
							{/each}
						</div>
					</div>
				{/if}

				{#if users.length > 0}
					<Separator />
					<!-- Assignee -->
					<div class="space-y-2">
						<Label class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
							Assignee
						</Label>
						<div class="max-h-32 space-y-1 overflow-y-auto pr-1">
							{#each users as u (u.id)}
								<div class="flex items-center gap-2">
									<Checkbox
										checked={((assignees.current as string[] | null)?.includes(u.id)) || false}
										onCheckedChange={() => toggleAssignee(u.id)}
										id={`fpov-assignee-${u.id}`}
									/>
									<Label
										for={`fpov-assignee-${u.id}`}
										class="cursor-pointer text-sm font-normal"
									>
										{getUserDisplayName(u)}
									</Label>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				{#if projects.length > 0}
					<Separator />
					<!-- Project -->
					<div class="space-y-2">
						<Label class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
							Project
						</Label>
						<div class="max-h-32 space-y-1 overflow-y-auto pr-1">
							{#each projects as p (p.id)}
								<div class="flex items-center gap-2">
									<Checkbox
										checked={((projectIds.current as string[] | null)?.includes(p.id)) || false}
										onCheckedChange={() => toggleProject(p.id)}
										id={`fpov-project-${p.id}`}
									/>
									<Label for={`fpov-project-${p.id}`} class="cursor-pointer text-sm font-normal">
										{p.name}
									</Label>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				{#if milestones.length > 0}
					<Separator />
					<!-- Milestone -->
					<div class="space-y-2">
						<Label class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
							Milestone
						</Label>
						<div class="max-h-32 space-y-1 overflow-y-auto pr-1">
							{#each milestones as m (m.id)}
								<div class="flex items-center gap-2">
									<Checkbox
										checked={((milestoneIds.current as string[] | null)?.includes(m.id)) || false}
										onCheckedChange={() => toggleMilestone(m.id)}
										id={`fpov-milestone-${m.id}`}
									/>
									<Label
										for={`fpov-milestone-${m.id}`}
										class="cursor-pointer text-sm font-normal"
									>
										{m.name}
									</Label>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				{#if activeFiltersCount > 0}
					<Separator />
					<div class="flex justify-end">
						<Button variant="ghost" size="sm" onclick={clearAllFilters}>
							<XIcon class="mr-2 h-4 w-4" />
							Clear all ({activeFiltersCount})
						</Button>
					</div>
				{/if}
			</div>
		</PopoverContent>
	</Popover>
</div>

<!-- Active filter chips (below row, like the original) -->
{#if activeFiltersCount > 0}
	{@const statusList = (statuses.current as string[] | null) || []}
	{@const priorityList = (priorities.current as string[] | null) || []}
	{@const assigneeList = (assignees.current as string[] | null) || []}
	<div class="mt-3 flex flex-wrap gap-2">
		{#each statusList as status (status)}
			<Badge variant="secondary" class="gap-1.5">
				<span class="h-2 w-2 rounded-full {getStatusDotColor(status)}"></span>
				{formatStatus(status)}
				<button
					type="button"
					onclick={() => toggleStatus(status)}
					class="ml-1 rounded-full p-0.5 hover:bg-destructive/20"
					aria-label="Remove status filter {status}"
				>
					<XIcon class="h-3 w-3" />
				</button>
			</Badge>
		{/each}
		{#each priorityList as priority (priority)}
			<Badge variant="secondary" class="gap-1.5">
				<span class="h-2 w-2 rounded-full {getPriorityDotColor(priority)}"></span>
				{formatPriority(priority)}
				<button
					type="button"
					onclick={() => togglePriority(priority)}
					class="ml-1 rounded-full p-0.5 hover:bg-destructive/20"
					aria-label="Remove priority filter {priority}"
				>
					<XIcon class="h-3 w-3" />
				</button>
			</Badge>
		{/each}
		{#each assigneeList as aid (aid)}
			{@const u = users.find((x) => x.id === aid)}
			{#if u}
				<Badge variant="secondary" class="gap-1">
					{getUserDisplayName(u)}
					<button
						type="button"
						onclick={() => toggleAssignee(aid)}
						class="ml-1 rounded-full p-0.5 hover:bg-destructive/20"
						aria-label="Remove assignee filter"
					>
						<XIcon class="h-3 w-3" />
					</button>
				</Badge>
			{/if}
		{/each}
		{#if clientId.current}
			{@const c = clients.find((x) => x.id === clientId.current)}
			{#if c}
				<Badge variant="secondary" class="gap-1">
					{c.name}
					<button
						type="button"
						onclick={() => setClientFilter(null)}
						class="ml-1 rounded-full p-0.5 hover:bg-destructive/20"
						aria-label="Remove client filter"
					>
						<XIcon class="h-3 w-3" />
					</button>
				</Badge>
			{/if}
		{/if}
		{#if dueDate.current}
			<Badge variant="secondary" class="gap-1">
				Due: {formatDateRange(dueDate.current)}
				<button
					type="button"
					onclick={() => (dueDate.current = null as any)}
					class="ml-1 rounded-full p-0.5 hover:bg-destructive/20"
					aria-label="Remove due date filter"
				>
					<XIcon class="h-3 w-3" />
				</button>
			</Badge>
		{/if}
	</div>
{/if}
