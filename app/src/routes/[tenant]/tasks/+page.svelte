<script lang="ts">
	import { getTasks, deleteTask } from '$lib/remotes/tasks.remote';
	import { getProjects } from '$lib/remotes/projects.remote';
	import { getTenantUsers } from '$lib/remotes/users.remote';
	import { getMilestones } from '$lib/remotes/milestones.remote';
	import { getClients } from '$lib/remotes/clients.remote';
	import { page } from '$app/state';
	import { useQueryState } from 'nuqs-svelte';
	import { parseAsStringEnum, parseAsArrayOf, parseAsString } from 'nuqs-svelte';
	import { setContext } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import TaskDetailDialog from '$lib/components/task-detail-dialog.svelte';
	import EditTaskDialog from '$lib/components/edit-task-dialog.svelte';
	import CreateTaskDialog from '$lib/components/create-task-dialog.svelte';
	import TaskFilters from '$lib/components/task-filters.svelte';
	import TaskKanbanBoard from '$lib/components/task-kanban-board.svelte';
	import TaskTableView from '$lib/components/task-table-view.svelte';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import LayoutGridIcon from '@lucide/svelte/icons/layout-grid';
	import TableIcon from '@lucide/svelte/icons/table';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import type { Task } from '$lib/server/db/schema';
	import { toast } from 'svelte-sonner';
	import { clientLogger } from '$lib/client-logger';
	import { TASK_FILTERS_CONTEXT_KEY } from '$lib/components/task-filters-context';

	const tenantSlug = $derived(page.params.tenant || '');

	// View state
	const view = useQueryState('view', parseAsStringEnum(['kanban', 'table']).withDefault('kanban'));

	// Filter states
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
	const sortBy = useQueryState('sortBy', parseAsString.withDefault(''));
	const sortDir = useQueryState('sortDir', parseAsStringEnum(['asc', 'desc']));

	// Build filter params for getTasks
	const filterParams = $derived({
		status: (statuses.current as string[] | null) && (statuses.current as string[]).length > 0 ? (statuses.current as string[]) : undefined,
		priority: (priorities.current as string[] | null) && (priorities.current as string[]).length > 0 ? (priorities.current as string[]) : undefined,
		assignee: (assignees.current as string[] | null) && (assignees.current as string[]).length > 0 ? (assignees.current as string[]) : undefined,
		projectId: (projectIds.current as string[] | null) && (projectIds.current as string[]).length > 0 ? (projectIds.current as string[]) : undefined,
		milestoneId: (milestoneIds.current as string[] | null) && (milestoneIds.current as string[]).length > 0 ? (milestoneIds.current as string[]) : undefined,
		search: search.current || undefined,
		dueDate: dueDate.current || undefined,
		sortBy: sortBy.current || undefined,
		sortDir: (sortDir.current as 'asc' | 'desc' | null) || undefined
	});

	// Provide filterParams via context so child components can access it without prop drilling
	setContext(TASK_FILTERS_CONTEXT_KEY, filterParams);

	// Fetch data
	const tasksQuery = $derived(getTasks(filterParams));
	const tasks = $derived(tasksQuery.current || []);
	const loading = $derived(tasksQuery.loading);

	const projectsQuery = getProjects(undefined);
	const projects = $derived(projectsQuery.current || []);

	const usersQuery = getTenantUsers();
	const users = $derived(usersQuery.current || []);

	const milestonesQuery = getMilestones(undefined);
	const milestones = $derived(milestonesQuery.current || []);

	const clientsQuery = getClients();
	const clients = $derived(clientsQuery.current || []);

	// Create maps
	const projectMap = $derived(new Map(projects.map((project) => [project.id, project.name])));
	const userMap = $derived(
		new Map(
			users.map((u) => [
				u.id,
				`${u.firstName} ${u.lastName}`.trim() || u.email
			])
		)
	);
	const milestoneMap = $derived(new Map(milestones.map((m) => [m.id, m.name])));
	const clientMap = $derived(new Map(clients.map((c: any) => [c.id, c.name])));

	// Pagination state (table view only)
	let currentPage = $state(1);
	let pageSize = $state(25);
	const totalPages = $derived(Math.ceil(tasks.length / pageSize));
	const paginatedTasks = $derived(
		tasks.slice((currentPage - 1) * pageSize, currentPage * pageSize)
	);

	// Reset to page 1 when filters change
	$effect(() => {
		filterParams;
		currentPage = 1;
	});

	// Dialog states
	let isCreateDialogOpen = $state(false);
	let selectedTask = $state<Task | null>(null);
	let isTaskDetailOpen = $state(false);
	let editingTask = $state<Task | null>(null);

	function handleTaskClick(task: Task) {
		selectedTask = task;
		isTaskDetailOpen = true;
	}

	function handleCreateSuccess() {
		// Data will be refreshed automatically via .updates() in the dialog
	}

	async function handleDeleteTask(taskId: string) {
		if (!confirm('Are you sure you want to delete this task?')) {
			return;
		}

		try {
			await deleteTask(taskId).updates(getTasks(filterParams));
			if (selectedTask?.id === taskId) {
				isTaskDetailOpen = false;
				selectedTask = null;
			}
			toast.success('Task deleted');
		} catch (e) {
			clientLogger.apiError('task_delete', e);
		}
	}

	function handleEditTask(task: Task) {
		editingTask = task;
		isTaskDetailOpen = false;
	}

	function handleEditSuccess() {
		// Data will be refreshed automatically via .updates() in the dialog
		if (selectedTask) {
			// Refresh selected task from updated tasks list
			const updatedTask = tasks.find((t: any) => t.id === selectedTask?.id);
			if (updatedTask) {
				selectedTask = updatedTask;
				isTaskDetailOpen = true;
			}
		}
	}

	function handleSortChange(column: string, direction: 'asc' | 'desc') {
		sortBy.current = column;
		sortDir.current = direction as any;
	}
</script>

<svelte:head>
	<title>Tasks - CRM</title>
</svelte:head>

<div class="mb-8 flex items-center justify-between">
	<div>
		<h1 class="text-3xl font-bold tracking-tight">Tasks</h1>
		<p class="text-muted-foreground mt-1">Manage and track all project tasks</p>
	</div>
	<div class="flex items-center gap-2">
		<!-- View Toggle -->
		<div class="flex items-center gap-1 border rounded-md p-1">
			<Button
				variant={view.current === 'kanban' ? 'default' : 'ghost'}
				size="sm"
				onclick={() => (view.current = 'kanban')}
			>
				<LayoutGridIcon class="h-4 w-4 mr-2" />
				Kanban
			</Button>
			<Button
				variant={view.current === 'table' ? 'default' : 'ghost'}
				size="sm"
				onclick={() => (view.current = 'table')}
			>
				<TableIcon class="h-4 w-4 mr-2" />
				Table
			</Button>
		</div>
		<Button onclick={() => (isCreateDialogOpen = true)}>
			<PlusIcon class="mr-2 h-4 w-4" />
			New Task
		</Button>
	</div>
</div>

<!-- Filters -->
<div class="mb-6">
	<TaskFilters
		projects={projects}
		users={users}
		milestones={milestones}
	/>
</div>

<!-- Dialogs -->
<CreateTaskDialog
	open={isCreateDialogOpen}
	onOpenChange={(open) => {
		isCreateDialogOpen = open;
	}}
	onSuccess={handleCreateSuccess}
/>

{#if editingTask}
	<EditTaskDialog
		task={editingTask}
		open={!!editingTask}
		onOpenChange={(open) => {
			if (!open) editingTask = null;
		}}
		onSuccess={handleEditSuccess}
	/>
{/if}

<TaskDetailDialog
	task={selectedTask}
	open={isTaskDetailOpen}
	onOpenChange={(open) => {
		isTaskDetailOpen = open;
		if (!open) selectedTask = null;
	}}
	{tenantSlug}
	currentUserId={(page.data as any)?.tenantUser?.userId}
/>

<!-- Content -->
{#if loading}
	<div class="flex items-center justify-center py-12">
		<p class="text-muted-foreground">Loading tasks...</p>
	</div>
{:else if view.current === 'kanban'}
	<TaskKanbanBoard
		{tasks}
		{projectMap}
		{userMap}
		{clientMap}
		{tenantSlug}
		onTaskClick={handleTaskClick}
		onEditTask={handleEditTask}
		onDeleteTask={handleDeleteTask}
		onTasksUpdate={() => {
			// Tasks will be refreshed automatically via .updates() in the component
		}}
	/>
{:else}
		<TaskTableView
			tasks={paginatedTasks}
			{projectMap}
			{userMap}
			{clientMap}
			{tenantSlug}
			sortBy={sortBy.current || null}
			sortDir={(sortDir.current as 'asc' | 'desc' | null) || 'asc'}
			onSortChange={handleSortChange}
			onTaskClick={handleTaskClick}
			onEditTask={handleEditTask}
			onDeleteTask={handleDeleteTask}
		/>
		{#if tasks.length > 0}
			<div class="flex items-center justify-between mt-4">
				<div class="flex items-center gap-4">
					<p class="text-sm text-muted-foreground">
						{Math.min((currentPage - 1) * pageSize + 1, tasks.length)}-{Math.min(currentPage * pageSize, tasks.length)} of {tasks.length} tasks
					</p>
					<select
						class="h-8 rounded-md border border-input bg-background px-2 text-sm"
						bind:value={pageSize}
						onchange={() => (currentPage = 1)}
					>
						<option value={10}>10 / page</option>
						<option value={25}>25 / page</option>
						<option value={50}>50 / page</option>
					</select>
				</div>
				{#if totalPages > 1}
					<div class="flex items-center gap-2">
						<Button variant="outline" size="sm" disabled={currentPage <= 1} onclick={() => (currentPage = currentPage - 1)}>
							<ChevronLeftIcon class="h-4 w-4" />
						</Button>
						<span class="text-sm text-muted-foreground">Page {currentPage} / {totalPages}</span>
						<Button variant="outline" size="sm" disabled={currentPage >= totalPages} onclick={() => (currentPage = currentPage + 1)}>
							<ChevronRightIcon class="h-4 w-4" />
						</Button>
					</div>
				{/if}
			</div>
		{/if}
{/if}
