<script lang="ts">
	import { getTasks } from '$lib/remotes/tasks.remote';
	import { getTenantUsers } from '$lib/remotes/users.remote';
	import { getClientUserPreferences } from '$lib/remotes/client-user-preferences.remote';
	import { page } from '$app/state';
	import { Card } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import { goto } from '$app/navigation';
	import CreateTaskDialog from '$lib/components/create-task-dialog.svelte';
	import {
		formatStatus,
		getStatusDotColor,
		getStatusBadgeVariant,
		getPriorityColor,
		getPriorityDotColor,
		formatDate,
		formatPriority
	} from '$lib/components/task-kanban-utils';
	import { isTaskOverdue } from '$lib/utils/task-filters';
	import SearchIcon from '@lucide/svelte/icons/search';
	import XIcon from '@lucide/svelte/icons/x';
	import ListTodoIcon from '@lucide/svelte/icons/list-todo';
	import PlayIcon from '@lucide/svelte/icons/play';
	import AlertTriangleIcon from '@lucide/svelte/icons/alert-triangle';
	import CheckCircle2Icon from '@lucide/svelte/icons/check-circle-2';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import UserIcon from '@lucide/svelte/icons/user';

	const tenantSlug = $derived(page.params.tenant as string);
	const clientName = $derived(
		(page.data as any)?.client?.businessName ||
		(page.data as any)?.client?.name || ''
	);
	const clientRepresentative = $derived(
		(page.data as any)?.client?.legalRepresentative || clientName
	);

	const tasksQuery = getTasks({});
	const tasks = $derived(tasksQuery.current || []);
	const loading = $derived(tasksQuery.loading);

	const usersQuery = getTenantUsers();
	const users = $derived(usersQuery.current || []);
	const userMap = $derived(
		new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim() || u.email]))
	);

	function getCreatorName(userId: string | null): string {
		if (!userId) return '';
		return userMap.get(userId) || clientRepresentative || '';
	}

	// User preferences
	const prefsQuery = getClientUserPreferences();
	const prefs = $derived(prefsQuery.current);

	let createDialogOpen = $state(false);

	// Filters
	let filterSearch = $state('');
	let filterStatus = $state('');
	let filterPriority = $state('');
	let sortBy = $state('date');

	const filteredTasks = $derived.by(() => {
		let result = tasks;
		if (filterSearch.trim()) {
			const q = filterSearch.trim().toLowerCase();
			result = result.filter(
				(t) =>
					t.title.toLowerCase().includes(q) ||
					(t.description && t.description.toLowerCase().includes(q))
			);
		}
		if (filterStatus) {
			result = result.filter((t) => t.status === filterStatus);
		}
		if (filterPriority) {
			result = result.filter((t) => t.priority === filterPriority);
		}
		// Sort
		const priorityOrder: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
		const statusOrder: Record<string, number> = { 'pending-approval': 0, 'todo': 1, 'in-progress': 2, 'review': 3, 'done': 4, 'cancelled': 5 };
		result = [...result].sort((a, b) => {
			if (sortBy === 'priority') {
				return (priorityOrder[a.priority ?? 'medium'] ?? 2) - (priorityOrder[b.priority ?? 'medium'] ?? 2);
			}
			if (sortBy === 'status') {
				return (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
			}
			// Default: date (newest first)
			const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
			const db_ = b.createdAt ? new Date(b.createdAt).getTime() : 0;
			return db_ - da;
		});
		return result;
	});

	const stats = $derived({
		total: tasks.length,
		inProgress: tasks.filter((t) => t.status === 'in-progress').length,
		overdue: tasks.filter(
			(t) => t.status !== 'done' && t.status !== 'cancelled' && isTaskOverdue(t.dueDate)
		).length,
		completed: tasks.filter((t) => t.status === 'done').length
	});

	const totalActiveFilters = $derived(
		[filterSearch.trim(), filterStatus, filterPriority].filter(Boolean).length
	);

	// Sync preferences
	$effect(() => {
		if (prefs) {
			sortBy = prefs.defaultTaskSort ?? 'date';
			pageSize = prefs.itemsPerPage ?? 25;
		}
	});

	// Pagination
	let currentPage = $state(1);
	let pageSize = $state(25);
	const totalPages = $derived(Math.ceil(filteredTasks.length / pageSize));
	const paginatedTasks = $derived(
		filteredTasks.slice((currentPage - 1) * pageSize, currentPage * pageSize)
	);

	// Reset page on filter/sort/pageSize change
	$effect(() => {
		filterSearch; filterStatus; filterPriority; sortBy; pageSize;
		currentPage = 1;
	});

	function getPriorityBorderColor(priority: string | null): string {
		switch (priority) {
			case 'urgent': return 'border-l-red-500';
			case 'high': return 'border-l-orange-500';
			case 'medium': return 'border-l-green-500';
			case 'low': return 'border-l-gray-400';
			default: return 'border-l-gray-400';
		}
	}

	function formatDueDate(dueDate: Date | string | null): { text: string; isOverdue: boolean; isClose: boolean } {
		if (!dueDate) return { text: '', isOverdue: false, isClose: false };
		const d = dueDate instanceof Date ? dueDate : new Date(dueDate);
		const now = new Date();
		now.setHours(0, 0, 0, 0);
		const diffDays = Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

		if (diffDays < 0) {
			return {
				text: diffDays === -1 ? 'Yesterday' : `${Math.abs(diffDays)} days overdue`,
				isOverdue: true,
				isClose: false
			};
		}
		if (diffDays === 0) return { text: 'Today', isOverdue: false, isClose: true };
		if (diffDays === 1) return { text: 'Tomorrow', isOverdue: false, isClose: true };
		if (diffDays <= 7) return { text: `In ${diffDays} days`, isOverdue: false, isClose: true };
		return { text: formatDate(dueDate), isOverdue: false, isClose: false };
	}
</script>

<svelte:head>
	<title>Tasks - Client Portal</title>
</svelte:head>

<div class="space-y-6">
	<!-- Header -->
	<div class="flex items-center justify-between">
		<div>
			{#if clientName}
				<p class="text-sm font-medium text-muted-foreground">Tasks</p>
				<h1 class="text-2xl font-bold leading-tight">{clientName}</h1>
			{:else}
				<h1 class="text-2xl font-bold">Tasks</h1>
			{/if}
			<p class="text-muted-foreground text-sm">View and manage your tasks</p>
		</div>
		<Button onclick={() => (createDialogOpen = true)}>
			<PlusIcon class="mr-2 h-4 w-4" />
			Create Task
		</Button>
	</div>

	<!-- Stats cards -->
	{#if !loading && tasks.length > 0}
		<div class="grid gap-4 md:grid-cols-4">
			<Card class="p-4">
				<div class="flex items-center gap-3">
					<div class="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/10">
						<ListTodoIcon class="h-5 w-5 text-blue-600" />
					</div>
					<div>
						<p class="text-sm text-muted-foreground">Total Tasks</p>
						<p class="text-2xl font-bold">{stats.total}</p>
					</div>
				</div>
			</Card>
			<Card class="p-4">
				<div class="flex items-center gap-3">
					<div class="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/10">
						<PlayIcon class="h-5 w-5 text-blue-600" />
					</div>
					<div>
						<p class="text-sm text-muted-foreground">In Progress</p>
						<p class="text-2xl font-bold">{stats.inProgress}</p>
					</div>
				</div>
			</Card>
			<Card class="p-4">
				<div class="flex items-center gap-3">
					<div class="flex h-9 w-9 items-center justify-center rounded-lg bg-red-500/10">
						<AlertTriangleIcon class="h-5 w-5 text-red-600" />
					</div>
					<div>
						<p class="text-sm text-muted-foreground">Overdue</p>
						<p class="text-2xl font-bold {stats.overdue > 0 ? 'text-red-600' : ''}">{stats.overdue}</p>
					</div>
				</div>
			</Card>
			<Card class="p-4">
				<div class="flex items-center gap-3">
					<div class="flex h-9 w-9 items-center justify-center rounded-lg bg-green-500/10">
						<CheckCircle2Icon class="h-5 w-5 text-green-600" />
					</div>
					<div>
						<p class="text-sm text-muted-foreground">Completed</p>
						<p class="text-2xl font-bold">{stats.completed}</p>
					</div>
				</div>
			</Card>
		</div>
	{/if}

	<!-- Filter bar -->
	<div class="rounded-xl border border-border/40 bg-card/50 shadow-sm overflow-hidden">
		<div class="flex flex-wrap items-end gap-3 px-4 pt-4 pb-3">
			<!-- Search -->
			<div class="space-y-1.5 flex-1 min-w-[200px]">
				<p class="text-xs font-medium text-muted-foreground">Search</p>
				<div class="relative">
					<SearchIcon class="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
					<Input bind:value={filterSearch} placeholder="Search tasks..." class="pl-8 h-9 text-sm" />
				</div>
			</div>

			<!-- Status filter -->
			<div class="space-y-1.5 min-w-[140px]">
				<p class="text-xs font-medium text-muted-foreground">Status</p>
				<Select value={filterStatus || 'all'} type="single" onValueChange={(v) => { filterStatus = v === 'all' ? '' : v || ''; }}>
					<SelectTrigger class="h-9">
						{filterStatus ? formatStatus(filterStatus) : 'All'}
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">All</SelectItem>
						<SelectItem value="pending-approval">
							<span class="flex items-center gap-2"><span class="h-2 w-2 rounded-full bg-amber-500"></span> Pending Approval</span>
						</SelectItem>
						<SelectItem value="todo">
							<span class="flex items-center gap-2"><span class="h-2 w-2 rounded-full bg-slate-400"></span> To Do</span>
						</SelectItem>
						<SelectItem value="in-progress">
							<span class="flex items-center gap-2"><span class="h-2 w-2 rounded-full bg-blue-500"></span> In Progress</span>
						</SelectItem>
						<SelectItem value="review">
							<span class="flex items-center gap-2"><span class="h-2 w-2 rounded-full bg-purple-500"></span> Review</span>
						</SelectItem>
						<SelectItem value="done">
							<span class="flex items-center gap-2"><span class="h-2 w-2 rounded-full bg-green-500"></span> Done</span>
						</SelectItem>
						<SelectItem value="cancelled">
							<span class="flex items-center gap-2"><span class="h-2 w-2 rounded-full bg-red-500"></span> Cancelled</span>
						</SelectItem>
					</SelectContent>
				</Select>
			</div>

			<!-- Priority filter -->
			<div class="space-y-1.5 min-w-[140px]">
				<p class="text-xs font-medium text-muted-foreground">Priority</p>
				<Select value={filterPriority || 'all'} type="single" onValueChange={(v) => { filterPriority = v === 'all' ? '' : v || ''; }}>
					<SelectTrigger class="h-9">
						{filterPriority ? formatPriority(filterPriority) : 'All'}
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">All</SelectItem>
						<SelectItem value="urgent">
							<span class="flex items-center gap-2"><span class="h-2 w-2 rounded-full bg-red-500"></span> Urgent</span>
						</SelectItem>
						<SelectItem value="high">
							<span class="flex items-center gap-2"><span class="h-2 w-2 rounded-full bg-orange-500"></span> High</span>
						</SelectItem>
						<SelectItem value="medium">
							<span class="flex items-center gap-2"><span class="h-2 w-2 rounded-full bg-green-500"></span> Medium</span>
						</SelectItem>
						<SelectItem value="low">
							<span class="flex items-center gap-2"><span class="h-2 w-2 rounded-full bg-gray-400"></span> Low</span>
						</SelectItem>
					</SelectContent>
				</Select>
			</div>

			<!-- Sort -->
			<div class="space-y-1.5 min-w-[130px]">
				<p class="text-xs font-medium text-muted-foreground">Sortare</p>
				<Select value={sortBy} type="single" onValueChange={(v) => { if (v) sortBy = v; }}>
					<SelectTrigger class="h-9">
						{sortBy === 'date' ? 'Dată' : sortBy === 'priority' ? 'Prioritate' : 'Status'}
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="date">Dată</SelectItem>
						<SelectItem value="priority">Prioritate</SelectItem>
						<SelectItem value="status">Status</SelectItem>
					</SelectContent>
				</Select>
			</div>

			<!-- Page size -->
			<div class="space-y-1.5 min-w-[90px]">
				<p class="text-xs font-medium text-muted-foreground">Pe pagină</p>
				<Select value={String(pageSize)} type="single" onValueChange={(v) => { if (v) pageSize = Number(v); }}>
					<SelectTrigger class="h-9">
						{pageSize}
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="10">10</SelectItem>
						<SelectItem value="25">25</SelectItem>
						<SelectItem value="50">50</SelectItem>
					</SelectContent>
				</Select>
			</div>
		</div>

		<!-- Active filter chips -->
		{#if totalActiveFilters > 0}
			<div class="flex flex-wrap items-center gap-2 border-t px-4 py-2.5 bg-muted/20">
				{#if filterSearch.trim()}
					<button onclick={() => (filterSearch = '')}
						class="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-0.5 text-xs font-medium hover:bg-muted transition-colors">
						"{filterSearch.trim()}" <XIcon class="h-3 w-3 opacity-60" />
					</button>
				{/if}
				{#if filterStatus}
					<button onclick={() => (filterStatus = '')}
						class="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-0.5 text-xs font-medium hover:bg-muted transition-colors">
						<span class="h-1.5 w-1.5 rounded-full {getStatusDotColor(filterStatus)}"></span>
						{formatStatus(filterStatus)} <XIcon class="h-3 w-3 opacity-60" />
					</button>
				{/if}
				{#if filterPriority}
					<button onclick={() => (filterPriority = '')}
						class="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-0.5 text-xs font-medium hover:bg-muted transition-colors">
						<span class="h-1.5 w-1.5 rounded-full {getPriorityDotColor(filterPriority)}"></span>
						{formatPriority(filterPriority)} <XIcon class="h-3 w-3 opacity-60" />
					</button>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Task list -->
	{#if loading}
		<div class="flex items-center justify-center py-12">
			<p class="text-muted-foreground">Loading tasks...</p>
		</div>
	{:else if tasks.length === 0}
		<div class="flex flex-col items-center justify-center py-16 px-4">
			<div class="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted/50 mb-4">
				<ListTodoIcon class="h-8 w-8 text-muted-foreground" />
			</div>
			<h3 class="text-lg font-semibold mb-1">No tasks yet</h3>
			<p class="text-sm text-muted-foreground text-center max-w-sm mb-4">
				Create your first task to get started. Tasks you create will be reviewed before being added to the board.
			</p>
			<Button onclick={() => (createDialogOpen = true)}>
				<PlusIcon class="mr-2 h-4 w-4" />
				Create Task
			</Button>
		</div>
	{:else if filteredTasks.length === 0}
		<div class="flex flex-col items-center justify-center py-12">
			<SearchIcon class="h-8 w-8 text-muted-foreground mb-3" />
			<p class="text-sm text-muted-foreground">No tasks match your filters.</p>
		</div>
	{:else}
		<div class="space-y-3">
			{#each paginatedTasks as task}
				{@const dueDateInfo = formatDueDate(task.dueDate)}
				{@const overdue = task.status !== 'done' && task.status !== 'cancelled' && dueDateInfo.isOverdue}
				<div
					class="group relative rounded-xl border border-border/40 bg-card/50 shadow-sm hover:shadow-md hover:border-primary/30 transition-all duration-200 cursor-pointer overflow-hidden border-l-4 {getPriorityBorderColor(task.priority)}"
					role="button"
					tabindex="0"
					onclick={() => goto(`/client/${tenantSlug}/tasks/${task.id}`)}
					onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') goto(`/client/${tenantSlug}/tasks/${task.id}`); }}
				>
					<div class="p-4">
						<div class="flex items-start justify-between gap-3">
							<div class="flex-1 min-w-0">
								<h3 class="font-semibold text-[15px] leading-tight group-hover:text-primary transition-colors">
									{task.title}
								</h3>
								{#if task.description}
									<p class="text-sm text-muted-foreground mt-1 line-clamp-2">{task.description}</p>
								{/if}
							</div>
							<Badge variant={getStatusBadgeVariant(task.status)} class="shrink-0 text-[11px] h-5 rounded-full px-2 font-normal">
								{formatStatus(task.status)}
							</Badge>
						</div>

						<div class="flex items-center gap-4 mt-3 flex-wrap">
							<!-- Priority -->
							<span class="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
								<span class="h-2 w-2 rounded-full {getPriorityDotColor(task.priority)}"></span>
								{formatPriority(task.priority || 'medium')}
							</span>

							<!-- Assignee -->
							{#if task.assignedToUserId && userMap.get(task.assignedToUserId)}
								<span class="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
									<UserIcon class="h-3 w-3" />
									{userMap.get(task.assignedToUserId)}
								</span>
							{/if}

							<!-- Due date -->
							{#if task.dueDate}
								<span class="inline-flex items-center gap-1.5 text-xs {overdue ? 'text-red-600 font-medium' : dueDateInfo.isClose ? 'text-amber-600' : 'text-muted-foreground'}">
									{#if overdue}
										<AlertTriangleIcon class="h-3 w-3" />
									{:else}
										<CalendarIcon class="h-3 w-3" />
									{/if}
									Due: {formatDate(task.dueDate)}
								</span>
							{/if}

							<!-- Created by -->
							{#if getCreatorName(task.createdByUserId)}
								<span class="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
									<UserIcon class="h-3 w-3" />
									Created by: {getCreatorName(task.createdByUserId)}
								</span>
							{/if}

							<!-- Created date -->
							<span class="inline-flex items-center gap-1.5 text-xs text-muted-foreground ml-auto">
								<ClockIcon class="h-3 w-3" />
								{formatDate(task.createdAt)}
							</span>
						</div>
					</div>
				</div>
			{/each}
		</div>

		{#if totalPages > 1}
			<div class="flex items-center justify-between pt-2">
				<p class="text-sm text-muted-foreground">
					Showing {Math.min((currentPage - 1) * pageSize + 1, filteredTasks.length)}-{Math.min(currentPage * pageSize, filteredTasks.length)} of {filteredTasks.length} tasks
				</p>
				<div class="flex items-center gap-2">
					<Button variant="outline" size="sm" disabled={currentPage <= 1} onclick={() => (currentPage = currentPage - 1)}>
						<ChevronLeftIcon class="h-4 w-4" />
					</Button>
					<span class="text-sm text-muted-foreground tabular-nums">
						Page {currentPage} / {totalPages}
					</span>
					<Button variant="outline" size="sm" disabled={currentPage >= totalPages} onclick={() => (currentPage = currentPage + 1)}>
						<ChevronRightIcon class="h-4 w-4" />
					</Button>
				</div>
			</div>
		{/if}
	{/if}
</div>

<CreateTaskDialog
	open={createDialogOpen}
	isClient={true}
	defaultPriority={prefs?.defaultPriority}
	onSuccess={() => {
		createDialogOpen = false;
		tasksQuery.refresh();
	}}
	onOpenChange={(value) => {
		tasksQuery.refresh();
		createDialogOpen = value;
	}}
/>
