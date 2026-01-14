<script lang="ts">
	import { useQueryState } from 'nuqs-svelte';
	import { parseAsArrayOf, parseAsStringEnum, parseAsString } from 'nuqs-svelte';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import { Popover, PopoverContent, PopoverTrigger } from '$lib/components/ui/popover';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Label } from '$lib/components/ui/label';
	import FilterIcon from '@lucide/svelte/icons/filter';
	import XIcon from '@lucide/svelte/icons/x';
	import SearchIcon from '@lucide/svelte/icons/search';
	import { INVOICE_STATUSES, formatStatus, formatDateRange } from '$lib/utils/invoice-filters';

	type Props = {
		clients?: Array<{ id: string; name: string }>;
		projects?: Array<{ id: string; name: string }>;
		services?: Array<{ id: string; name: string }>;
	};

	let { clients = [], projects = [], services = [] }: Props = $props();

	// Query states using nuqs-svelte
	const statuses = useQueryState(
		'status',
		parseAsArrayOf(parseAsStringEnum(['draft', 'sent', 'paid', 'overdue', 'cancelled']))
	);
	const clientIds = useQueryState('client', parseAsArrayOf(parseAsString));
	const projectIds = useQueryState('project', parseAsArrayOf(parseAsString));
	const serviceIds = useQueryState('service', parseAsArrayOf(parseAsString));
	const search = useQueryState('search', parseAsString.withDefault(''));
	const issueDate = useQueryState('issueDate', parseAsStringEnum(['overdue', 'today', 'thisWeek', 'thisMonth','lastMonth']));
	const dueDate = useQueryState('dueDate', parseAsStringEnum(['overdue', 'today', 'thisWeek', 'thisMonth']));

	// Popover states
	let statusPopoverOpen = $state(false);
	let clientPopoverOpen = $state(false);
	let projectPopoverOpen = $state(false);
	let servicePopoverOpen = $state(false);
	let issueDatePopoverOpen = $state(false);
	let dueDatePopoverOpen = $state(false);

	// Computed active filters count
	const activeFiltersCount = $derived(
		((statuses.current as string[] | null)?.length || 0) +
			((clientIds.current as string[] | null)?.length || 0) +
			((projectIds.current as string[] | null)?.length || 0) +
			((serviceIds.current as string[] | null)?.length || 0) +
			(issueDate.current ? 1 : 0) +
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

	function toggleClient(clientId: string) {
		const current = (clientIds.current as string[] | null) || [];
		if (current.includes(clientId)) {
			clientIds.current = current.filter((id) => id !== clientId) as any;
		} else {
			clientIds.current = [...current, clientId] as any;
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

	function toggleService(serviceId: string) {
		const current = (serviceIds.current as string[] | null) || [];
		if (current.includes(serviceId)) {
			serviceIds.current = current.filter((id) => id !== serviceId) as any;
		} else {
			serviceIds.current = [...current, serviceId] as any;
		}
	}

	function clearAllFilters() {
		statuses.current = null as any;
		clientIds.current = null as any;
		projectIds.current = null as any;
		serviceIds.current = null as any;
		issueDate.current = null as any;
		dueDate.current = null as any;
		search.current = '';
	}
</script>

<div class="flex flex-wrap items-center gap-2">
	<!-- Search Input -->
	<div class="relative flex-1 min-w-[200px]">
		<SearchIcon class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
		<Input
			bind:value={search.current}
			placeholder="Search invoices..."
			class="pl-9"
		/>
	</div>

	<!-- Status Filter -->
	<Popover bind:open={statusPopoverOpen}>
		<PopoverTrigger>
			<Button variant="outline" size="sm">
				<FilterIcon class="mr-2 h-4 w-4" />
				Status
				{#if (statuses.current as string[] | null) && (statuses.current as string[]).length > 0}
					<Badge variant="secondary" class="ml-2">
						{(statuses.current as string[]).length}
					</Badge>
				{/if}
			</Button>
		</PopoverTrigger>
		<PopoverContent class="w-56">
			<div class="space-y-2">
				<Label>Status</Label>
				{#each INVOICE_STATUSES as status}
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

	<!-- Client Filter -->
	{#if clients.length > 0}
		<Popover bind:open={clientPopoverOpen}>
			<PopoverTrigger>
				<Button variant="outline" size="sm">
					Client
					{#if (clientIds.current as string[] | null) && (clientIds.current as string[]).length > 0}
						<Badge variant="secondary" class="ml-2">
							{(clientIds.current as string[]).length}
						</Badge>
					{/if}
				</Button>
			</PopoverTrigger>
			<PopoverContent class="w-64 max-h-[300px] overflow-y-auto">
				<div class="space-y-2">
					<Label>Client</Label>
					{#each clients as client}
						<div class="flex items-center space-x-2">
							<Checkbox
								checked={((clientIds.current as string[] | null)?.includes(client.id)) || false}
								onCheckedChange={() => toggleClient(client.id)}
								id={`client-${client.id}`}
							/>
							<Label for={`client-${client.id}`} class="cursor-pointer">
								{client.name}
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
				<Button variant="outline" size="sm">
					Project
					{#if (projectIds.current as string[] | null) && (projectIds.current as string[]).length > 0}
						<Badge variant="secondary" class="ml-2">
							{(projectIds.current as string[]).length}
						</Badge>
					{/if}
				</Button>
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

	<!-- Service Filter -->
	{#if services.length > 0}
		<Popover bind:open={servicePopoverOpen}>
			<PopoverTrigger>
				<Button variant="outline" size="sm">
					Service
					{#if (serviceIds.current as string[] | null) && (serviceIds.current as string[]).length > 0}
						<Badge variant="secondary" class="ml-2">
							{(serviceIds.current as string[]).length}
						</Badge>
					{/if}
				</Button>
			</PopoverTrigger>
			<PopoverContent class="w-64 max-h-[300px] overflow-y-auto">
				<div class="space-y-2">
					<Label>Service</Label>
					{#each services as service}
						<div class="flex items-center space-x-2">
							<Checkbox
								checked={((serviceIds.current as string[] | null)?.includes(service.id)) || false}
								onCheckedChange={() => toggleService(service.id)}
								id={`service-${service.id}`}
							/>
							<Label for={`service-${service.id}`} class="cursor-pointer">
								{service.name}
							</Label>
						</div>
					{/each}
				</div>
			</PopoverContent>
		</Popover>
	{/if}

	<!-- Issue Date Filter -->
	<Popover bind:open={issueDatePopoverOpen}>
		<PopoverTrigger>
			<Button variant="outline" size="sm">
				Issue Date
				{#if issueDate.current}
					<Badge variant="secondary" class="ml-2">1</Badge>
				{/if}
			</Button>
		</PopoverTrigger>
		<PopoverContent class="w-56">
			<div class="space-y-2">
				<Label>Issue Date</Label>
				{#each ['today', 'thisWeek', 'thisMonth', 'lastMonth'] as dateFilter}
					<div class="flex items-center space-x-2">
						<Checkbox
							checked={issueDate.current === dateFilter}
							onCheckedChange={(checked) => {
								if (checked) {
									issueDate.current = dateFilter as any;
								} else {
									issueDate.current = null;
								}
							}}
							id={`issueDate-${dateFilter}`}
						/>
						<Label for={`issueDate-${dateFilter}`} class="cursor-pointer">
							{formatDateRange(dateFilter)}
						</Label>
					</div>
				{/each}
			</div>
		</PopoverContent>
	</Popover>

	<!-- Due Date Filter -->
	<Popover bind:open={dueDatePopoverOpen}>
		<PopoverTrigger>
			<Button variant="outline" size="sm">
				Due Date
				{#if dueDate.current}
					<Badge variant="secondary" class="ml-2">1</Badge>
				{/if}
			</Button>
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
		{#if (clientIds.current as string[] | null) && (clientIds.current as string[]).length > 0}
			{#each (clientIds.current as string[]) as clientId}
				{@const client = clients.find((c) => c.id === clientId)}
				{#if client}
					<Badge variant="secondary" class="gap-1">
						Client: {client.name}
						<button
							onclick={() => toggleClient(clientId)}
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
		{#if (serviceIds.current as string[] | null) && (serviceIds.current as string[]).length > 0}
			{#each (serviceIds.current as string[]) as serviceId}
				{@const service = services.find((s) => s.id === serviceId)}
				{#if service}
					<Badge variant="secondary" class="gap-1">
						Service: {service.name}
						<button
							onclick={() => toggleService(serviceId)}
							class="ml-1 hover:bg-destructive/20 rounded-full p-0.5"
						>
							<XIcon class="h-3 w-3" />
						</button>
					</Badge>
				{/if}
			{/each}
		{/if}
		{#if issueDate.current}
			<Badge variant="secondary" class="gap-1">
				Issue: {formatDateRange(issueDate.current)}
				<button
					onclick={() => (issueDate.current = null as any)}
					class="ml-1 hover:bg-destructive/20 rounded-full p-0.5"
				>
					<XIcon class="h-3 w-3" />
				</button>
			</Badge>
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
