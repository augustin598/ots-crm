<script lang="ts">
	import { useQueryState } from 'nuqs-svelte';
	import { parseAsArrayOf, parseAsStringEnum, parseAsString } from 'nuqs-svelte';
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
	import { TASK_STATUSES, TASK_PRIORITIES, formatStatus, formatPriority, formatDateRange } from '$lib/utils/task-filters';

	type Props = {
		projects?: Array<{ id: string; name: string }>;
		users?: Array<{ id: string; firstName: string; lastName: string; email: string }>;
		milestones?: Array<{ id: string; name: string }>;
	};

	let { projects = [], users = [], milestones = [] }: Props = $props();

	// Query states using nuqs-svelte
	const statuses = useQueryState(
		'status',
		parseAsArrayOf(parseAsStringEnum(['todo', 'in-progress', 'review', 'done', 'cancelled', 'pending-approval']))
	);
	const priorities = useQueryState(
		'priority',
		parseAsArrayOf(parseAsStringEnum(['low', 'medium', 'high', 'urgent']))
	);
	const assignees = useQueryState('assignee', parseAsArrayOf(parseAsString));
	const projectIds = useQueryState('project', parseAsArrayOf(parseAsString));
	const milestoneIds = useQueryState('milestone', parseAsArrayOf(parseAsString));
	const search = useQueryState('search', parseAsString.withDefault(''));
	const dueDate = useQueryState('dueDate', parseAsStringEnum(['overdue', 'today', 'thisWeek', 'thisMonth']));

	// Popover states
	let statusPopoverOpen = $state(false);
	let priorityPopoverOpen = $state(false);
	let assigneePopoverOpen = $state(false);
	let projectPopoverOpen = $state(false);
	let milestonePopoverOpen = $state(false);
	let dueDatePopoverOpen = $state(false);

	// Computed active filters count
	const activeFiltersCount = $derived(
		((statuses.current as string[] | null)?.length || 0) +
			((priorities.current as string[] | null)?.length || 0) +
			((assignees.current as string[] | null)?.length || 0) +
			((projectIds.current as string[] | null)?.length || 0) +
			((milestoneIds.current as string[] | null)?.length || 0) +
			(dueDate.current ? 1 : 0) +
			(search.current ? 1 : 0)
	);

	function toggleStatus(status: string) {
		const current = (statuses.current as string[] | null) || [];
		if (current.includes(status)) {
			statuses.current = current.filter((s) => s !== status) as any;
		} else {
			statuses.current = [...current, status] as any;
		}
	}

	function togglePriority(priority: string) {
		const current = (priorities.current as string[] | null) || [];
		if (current.includes(priority)) {
			priorities.current = current.filter((p) => p !== priority) as any;
		} else {
			priorities.current = [...current, priority] as any;
		}
	}

	function toggleAssignee(userId: string) {
		const current = (assignees.current as string[] | null) || [];
		if (current.includes(userId)) {
			assignees.current = current.filter((id) => id !== userId) as any;
		} else {
			assignees.current = [...current, userId] as any;
		}
	}

	function toggleProject(projectId: string) {
		const current = (projectIds.current as string[] | null) || [];
		if (current.includes(projectId)) {
			projectIds.current = current.filter((id) => id !== projectId) as any;
		} else {
			projectIds.current = [...current, projectId] as any;
		}
	}

	function toggleMilestone(milestoneId: string) {
		const current = (milestoneIds.current as string[] | null) || [];
		if (current.includes(milestoneId)) {
			milestoneIds.current = current.filter((id) => id !== milestoneId) as any;
		} else {
			milestoneIds.current = [...current, milestoneId] as any;
		}
	}

	function clearAllFilters() {
		statuses.current = null as any;
		priorities.current = null as any;
		assignees.current = null as any;
		projectIds.current = null as any;
		milestoneIds.current = null as any;
		dueDate.current = null as any;
		search.current = '';
	}

	function getUserDisplayName(user: { firstName: string; lastName: string; email: string }): string {
		const name = `${user.firstName} ${user.lastName}`.trim();
		return name || user.email;
	}
</script>

<div class="flex flex-wrap items-center gap-2">
	<!-- Search Input -->
	<div class="relative flex-1 min-w-[200px]">
		<SearchIcon class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
		<Input
			bind:value={search.current}
			placeholder="Search tasks..."
			class="pl-9"
		/>
	</div>

	<!-- Status Filter -->
	<Popover bind:open={statusPopoverOpen}>
		<PopoverTrigger>
			{#snippet child({ props })}
				<Button {...props} variant="outline" size="sm">
					<FilterIcon class="mr-2 h-4 w-4" />
					Status
					{#if (statuses.current as string[] | null) && (statuses.current as string[]).length > 0}
						<Badge variant="secondary" class="ml-2">
							{(statuses.current as string[]).length}
						</Badge>
					{/if}
				</Button>
			{/snippet}
		</PopoverTrigger>
		<PopoverContent class="w-56">
			<div class="space-y-2">
				<Label>Status</Label>
				{#each TASK_STATUSES as status}
					<div class="flex items-center space-x-2">
						<Checkbox
							checked={((statuses.current as string[] | null)?.includes(status)) || false}
							onCheckedChange={() => toggleStatus(status)}
							id={`status-${status}`}
						/>
						<Label for={`status-${status}`} class="cursor-pointer">
							{formatStatus(status)}
						</Label>
					</div>
				{/each}
			</div>
		</PopoverContent>
	</Popover>

	<!-- Priority Filter -->
	<Popover bind:open={priorityPopoverOpen}>
		<PopoverTrigger>
			{#snippet child({ props })}
				<Button {...props} variant="outline" size="sm">
					Priority
					{#if (priorities.current as string[] | null) && (priorities.current as string[]).length > 0}
						<Badge variant="secondary" class="ml-2">
							{(priorities.current as string[]).length}
						</Badge>
					{/if}
				</Button>
			{/snippet}
		</PopoverTrigger>
		<PopoverContent class="w-56">
			<div class="space-y-2">
				<Label>Priority</Label>
				{#each TASK_PRIORITIES as priority}
					<div class="flex items-center space-x-2">
						<Checkbox
							checked={((priorities.current as string[] | null)?.includes(priority)) || false}
							onCheckedChange={() => togglePriority(priority)}
							id={`priority-${priority}`}
						/>
						<Label for={`priority-${priority}`} class="cursor-pointer">
							{formatPriority(priority)}
						</Label>
					</div>
				{/each}
			</div>
		</PopoverContent>
	</Popover>

	<!-- Assignee Filter -->
	{#if users.length > 0}
		<Popover bind:open={assigneePopoverOpen}>
			<PopoverTrigger>
				{#snippet child({ props })}
					<Button {...props} variant="outline" size="sm">
						Assignee
						{#if (assignees.current as string[] | null) && (assignees.current as string[]).length > 0}
							<Badge variant="secondary" class="ml-2">
								{(assignees.current as string[]).length}
							</Badge>
						{/if}
					</Button>
				{/snippet}
			</PopoverTrigger>
			<PopoverContent class="w-64 max-h-[300px] overflow-y-auto">
				<div class="space-y-2">
					<Label>Assignee</Label>
					{#each users as user}
						<div class="flex items-center space-x-2">
							<Checkbox
								checked={((assignees.current as string[] | null)?.includes(user.id)) || false}
								onCheckedChange={() => toggleAssignee(user.id)}
								id={`assignee-${user.id}`}
							/>
							<Label for={`assignee-${user.id}`} class="cursor-pointer">
								{getUserDisplayName(user)}
							</Label>
						</div>
					{/each}
				</div>
			</PopoverContent>
		</Popover>
	{/if}

	<!-- Project Filter -->
	{#if projects.length > 0}
		<Popover bind:open={projectPopoverOpen}>
			<PopoverTrigger>
				{#snippet child({ props })}
					<Button {...props} variant="outline" size="sm">
						Project
						{#if (projectIds.current as string[] | null) && (projectIds.current as string[]).length > 0}
							<Badge variant="secondary" class="ml-2">
								{(projectIds.current as string[]).length}
							</Badge>
						{/if}
					</Button>
				{/snippet}
			</PopoverTrigger>
			<PopoverContent class="w-64 max-h-[300px] overflow-y-auto">
				<div class="space-y-2">
					<Label>Project</Label>
					{#each projects as project}
						<div class="flex items-center space-x-2">
							<Checkbox
								checked={((projectIds.current as string[] | null)?.includes(project.id)) || false}
								onCheckedChange={() => toggleProject(project.id)}
								id={`project-${project.id}`}
							/>
							<Label for={`project-${project.id}`} class="cursor-pointer">
								{project.name}
							</Label>
						</div>
					{/each}
				</div>
			</PopoverContent>
		</Popover>
	{/if}

	<!-- Milestone Filter -->
	{#if milestones.length > 0}
		<Popover bind:open={milestonePopoverOpen}>
			<PopoverTrigger>
				{#snippet child({ props })}
					<Button {...props} variant="outline" size="sm">
						Milestone
						{#if (milestoneIds.current as string[] | null) && (milestoneIds.current as string[]).length > 0}
							<Badge variant="secondary" class="ml-2">
								{(milestoneIds.current as string[]).length}
							</Badge>
						{/if}
					</Button>
				{/snippet}
			</PopoverTrigger>
			<PopoverContent class="w-64 max-h-[300px] overflow-y-auto">
				<div class="space-y-2">
					<Label>Milestone</Label>
					{#each milestones as milestone}
						<div class="flex items-center space-x-2">
							<Checkbox
								checked={((milestoneIds.current as string[] | null)?.includes(milestone.id)) || false}
								onCheckedChange={() => toggleMilestone(milestone.id)}
								id={`milestone-${milestone.id}`}
							/>
							<Label for={`milestone-${milestone.id}`} class="cursor-pointer">
								{milestone.name}
							</Label>
						</div>
					{/each}
				</div>
			</PopoverContent>
		</Popover>
	{/if}

	<!-- Due Date Filter -->
	<Popover bind:open={dueDatePopoverOpen}>
		<PopoverTrigger>
			{#snippet child({ props })}
				<Button {...props} variant="outline" size="sm">
					Due Date
					{#if dueDate.current}
						<Badge variant="secondary" class="ml-2">1</Badge>
					{/if}
				</Button>
			{/snippet}
		</PopoverTrigger>
		<PopoverContent class="w-56">
			<div class="space-y-2">
				<Label>Due Date</Label>
				{#each ['overdue', 'today', 'thisWeek', 'thisMonth'] as dateFilter}
					<div class="flex items-center space-x-2">
						<Checkbox
							checked={dueDate.current === dateFilter}
							onCheckedChange={(checked) => {
								if (checked) {
									dueDate.current = dateFilter as any;
								} else {
									dueDate.current = null;
								}
							}}
							id={`dueDate-${dateFilter}`}
						/>
						<Label for={`dueDate-${dateFilter}`} class="cursor-pointer">
							{formatDateRange(dateFilter)}
						</Label>
					</div>
				{/each}
			</div>
		</PopoverContent>
	</Popover>

	<!-- Clear All Filters -->
	{#if activeFiltersCount > 0}
		<Button variant="ghost" size="sm" onclick={clearAllFilters}>
			<XIcon class="mr-2 h-4 w-4" />
			Clear ({activeFiltersCount})
		</Button>
	{/if}
</div>

<!-- Active Filter Chips -->
	{#if activeFiltersCount > 0}
	<div class="flex flex-wrap gap-2 mt-3">
		{#if (statuses.current as string[] | null) && (statuses.current as string[]).length > 0}
			{#each (statuses.current as string[]) as status}
				<Badge variant="secondary" class="gap-1">
					Status: {formatStatus(status)}
					<button
						onclick={() => toggleStatus(status)}
						class="ml-1 hover:bg-destructive/20 rounded-full p-0.5"
					>
						<XIcon class="h-3 w-3" />
					</button>
				</Badge>
			{/each}
		{/if}
		{#if (priorities.current as string[] | null) && (priorities.current as string[]).length > 0}
			{#each (priorities.current as string[]) as priority}
				<Badge variant="secondary" class="gap-1">
					Priority: {formatPriority(priority)}
					<button
						onclick={() => togglePriority(priority)}
						class="ml-1 hover:bg-destructive/20 rounded-full p-0.5"
					>
						<XIcon class="h-3 w-3" />
					</button>
				</Badge>
			{/each}
		{/if}
		{#if (assignees.current as string[] | null) && (assignees.current as string[]).length > 0}
			{#each (assignees.current as string[]) as assigneeId}
				{@const user = users.find((u) => u.id === assigneeId)}
				{#if user}
					<Badge variant="secondary" class="gap-1">
						Assignee: {getUserDisplayName(user)}
						<button
							onclick={() => toggleAssignee(assigneeId)}
							class="ml-1 hover:bg-destructive/20 rounded-full p-0.5"
						>
							<XIcon class="h-3 w-3" />
						</button>
					</Badge>
				{/if}
			{/each}
		{/if}
		{#if (projectIds.current as string[] | null) && (projectIds.current as string[]).length > 0}
			{#each (projectIds.current as string[]) as projectId}
				{@const project = projects.find((p) => p.id === projectId)}
				{#if project}
					<Badge variant="secondary" class="gap-1">
						Project: {project.name}
						<button
							onclick={() => toggleProject(projectId)}
							class="ml-1 hover:bg-destructive/20 rounded-full p-0.5"
						>
							<XIcon class="h-3 w-3" />
						</button>
					</Badge>
				{/if}
			{/each}
		{/if}
		{#if (milestoneIds.current as string[] | null) && (milestoneIds.current as string[]).length > 0}
			{#each (milestoneIds.current as string[]) as milestoneId}
				{@const milestone = milestones.find((m) => m.id === milestoneId)}
				{#if milestone}
					<Badge variant="secondary" class="gap-1">
						Milestone: {milestone.name}
						<button
							onclick={() => toggleMilestone(milestoneId)}
							class="ml-1 hover:bg-destructive/20 rounded-full p-0.5"
						>
							<XIcon class="h-3 w-3" />
						</button>
					</Badge>
				{/if}
			{/each}
		{/if}
		{#if dueDate.current}
			<Badge variant="secondary" class="gap-1">
				Due: {formatDateRange(dueDate.current)}
				<button
					onclick={() => (dueDate.current = null as any)}
					class="ml-1 hover:bg-destructive/20 rounded-full p-0.5"
				>
					<XIcon class="h-3 w-3" />
				</button>
			</Badge>
		{/if}
	</div>
{/if}
