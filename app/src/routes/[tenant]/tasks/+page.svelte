<script lang="ts">
	import {
		getTasks,
		deleteTask,
		getCompletedTasks,
		getTaskClientIds,
		bulkUpdateTaskStatus,
		bulkDeleteTasks,
		bulkDuplicateTasks
	} from '$lib/remotes/tasks.remote';
	import { getProjects } from '$lib/remotes/projects.remote';
	import { getTenantUsers } from '$lib/remotes/users.remote';
	import { getMilestones } from '$lib/remotes/milestones.remote';
	import { getClients } from '$lib/remotes/clients.remote';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { useQueryState } from 'nuqs-svelte';
	import { parseAsStringEnum, parseAsArrayOf, parseAsString } from 'nuqs-svelte';
	import { setContext } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import TaskDetailPanel from '$lib/components/task-detail-panel.svelte';
	import EditTaskDialog from '$lib/components/edit-task-dialog.svelte';
	import CreateTaskDialog from '$lib/components/create-task-dialog.svelte';
	import TaskFilterPills from '$lib/components/task-filter-pills.svelte';
	import TaskStatsStrip, { type CardFilter } from '$lib/components/task-stats-strip.svelte';
	import TaskKanbanBoard from '$lib/components/task-kanban-board.svelte';
	import TaskTableView from '$lib/components/task-table-view.svelte';
	import TaskBulkActionBar from '$lib/components/task-bulk-action-bar.svelte';
	import { isTaskOverdue } from '$lib/utils/task-filters';
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
		parseAsArrayOf(parseAsStringEnum(['todo', 'in-progress', 'review', 'done', 'cancelled', 'pending-approval', 'blocked']))
	);
	const priorities = useQueryState(
		'priority',
		parseAsArrayOf(parseAsStringEnum(['low', 'medium', 'high', 'urgent']))
	);
	const assignees = useQueryState('assignee', parseAsArrayOf(parseAsString));
	const projectIds = useQueryState('project', parseAsArrayOf(parseAsString));
	const milestoneIds = useQueryState('milestone', parseAsArrayOf(parseAsString));
	const clientIdFilter = useQueryState('client', parseAsString.withDefault(''));
	const search = useQueryState('search', parseAsString.withDefault(''));
	const dueDate = useQueryState('dueDate', parseAsStringEnum(['overdue', 'today', 'thisWeek', 'thisMonth']));
	const sortBy = useQueryState('sortBy', parseAsString.withDefault(''));
	const sortDir = useQueryState('sortDir', parseAsStringEnum(['asc', 'desc']));
	const taskIdPanel = useQueryState('taskId', parseAsString);
	const cardFilter = useQueryState(
		'card',
		parseAsStringEnum(['overdue', 'today', 'week', 'completed'])
	);
	const taskType = useQueryState(
		'type',
		parseAsStringEnum(['design', 'video', 'ads', 'dev', 'content', 'meeting', 'other'])
	);

	// Build filter params for getTasks
	const filterParams = $derived({
		status: (statuses.current as string[] | null) && (statuses.current as string[]).length > 0 ? (statuses.current as string[]) : undefined,
		priority: (priorities.current as string[] | null) && (priorities.current as string[]).length > 0 ? (priorities.current as string[]) : undefined,
		assignee: (assignees.current as string[] | null) && (assignees.current as string[]).length > 0 ? (assignees.current as string[]) : undefined,
		projectId: (projectIds.current as string[] | null) && (projectIds.current as string[]).length > 0 ? (projectIds.current as string[]) : undefined,
		milestoneId: (milestoneIds.current as string[] | null) && (milestoneIds.current as string[]).length > 0 ? (milestoneIds.current as string[]) : undefined,
		clientId: clientIdFilter.current || undefined,
		type: (taskType.current as string | null) || undefined,
		search: search.current || undefined,
		dueDate: dueDate.current || undefined,
		sortBy: sortBy.current || undefined,
		sortDir: (sortDir.current as 'asc' | 'desc' | null) || undefined
	});

	// Provide filterParams via context so child components can access it without prop drilling
	// Note: captures initial filterParams reference — context consumers get the derived object which updates reactively
	setContext(TASK_FILTERS_CONTEXT_KEY, filterParams);

	// Fetch data — in kanban view, exclude done/cancelled (they are loaded lazily by the kanban board)
	// include.{subtasks,tags,assignees} hydrates TaskCard with the data it needs to render fully.
	const tasksQuery = $derived(
		getTasks({
			...filterParams,
			excludeCompleted:
				view.current === 'kanban' && !filterParams.status ? true : undefined,
			include: { subtasks: true, tags: true, assignees: true }
		})
	);
	const tasks = $derived(tasksQuery.current || []);
	const loading = $derived(tasksQuery.loading);

	// Stats query — separate (no excludeCompleted) so live counts stay accurate even in kanban view.
	const statsTasksQuery = $derived(getTasks({ ...filterParams }));
	const statsTasks = $derived(statsTasksQuery.current || []);

	function isDueToday(d: Date | string | null | undefined): boolean {
		if (!d) return false;
		const due = d instanceof Date ? d : new Date(d);
		const now = new Date();
		return (
			due.getFullYear() === now.getFullYear() &&
			due.getMonth() === now.getMonth() &&
			due.getDate() === now.getDate()
		);
	}
	function isDueWithinWeek(d: Date | string | null | undefined): boolean {
		if (!d) return false;
		const due = d instanceof Date ? d : new Date(d);
		const now = new Date();
		now.setHours(0, 0, 0, 0);
		const dueMidnight = new Date(due);
		dueMidnight.setHours(0, 0, 0, 0);
		const diff = Math.round((dueMidnight.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
		return diff >= 0 && diff <= 7;
	}
	function isActiveStatus(s: string | null | undefined): boolean {
		return s !== 'done' && s !== 'cancelled';
	}

	const stats = $derived({
		total: statsTasks.length,
		totalActive: statsTasks.filter((t: any) => isActiveStatus(t.status)).length,
		inProgress: statsTasks.filter((t: any) => t.status === 'in-progress').length,
		overdue: statsTasks.filter(
			(t: any) => isActiveStatus(t.status) && isTaskOverdue(t.dueDate)
		).length,
		dueToday: statsTasks.filter(
			(t: any) => isActiveStatus(t.status) && isDueToday(t.dueDate)
		).length,
		dueWeek: statsTasks.filter(
			(t: any) => isActiveStatus(t.status) && isDueWithinWeek(t.dueDate)
		).length,
		completed: statsTasks.filter((t: any) => t.status === 'done').length,
		blocked: statsTasks.filter((t: any) => t.status === 'blocked').length
	});

	// Apply cardFilter (quick stat-card narrowing) as a post-filter on tasks for views.
	const filteredTasksForView = $derived.by(() => {
		const card = cardFilter.current;
		if (!card) return tasks;
		if (card === 'completed') return tasks.filter((t: any) => t.status === 'done');
		if (card === 'overdue') {
			return tasks.filter(
				(t: any) => isActiveStatus(t.status) && isTaskOverdue(t.dueDate)
			);
		}
		if (card === 'today') {
			return tasks.filter(
				(t: any) => isActiveStatus(t.status) && isDueToday(t.dueDate)
			);
		}
		if (card === 'week') {
			return tasks.filter(
				(t: any) => isActiveStatus(t.status) && isDueWithinWeek(t.dueDate)
			);
		}
		return tasks;
	});

	const projectsQuery = getProjects(undefined);
	const projects = $derived(projectsQuery.current || []);

	const usersQuery = getTenantUsers();
	const users = $derived(usersQuery.current || []);

	const milestonesQuery = getMilestones(undefined);
	const milestones = $derived(milestonesQuery.current || []);

	const clientsQuery = getClients();
	const clients = $derived(clientsQuery.current || []);

	// Clients shown in the filter dropdown — only those that have at least one task
	const taskClientIdsQuery = getTaskClientIds();
	const taskClientIds = $derived(new Set(taskClientIdsQuery.current || []));
	const clientsForFilter = $derived(
		clients
			.filter((c: any) => taskClientIds.has(c.id))
			.map((c: any) => ({ id: c.id, name: c.name }))
	);

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

	// Pagination state (table view only) — operates on filteredTasksForView
	let currentPage = $state(1);
	let pageSize = $state(25);
	const totalPages = $derived(Math.ceil(filteredTasksForView.length / pageSize));
	const paginatedTasks = $derived(
		filteredTasksForView.slice((currentPage - 1) * pageSize, currentPage * pageSize)
	);

	// Reset to page 1 when filters change (incl. cardFilter)
	$effect(() => {
		filterParams;
		cardFilter.current;
		currentPage = 1;
	});

	function setCardFilter(v: CardFilter) {
		cardFilter.current = (v === '' ? null : v) as any;
	}

	// Dialog states
	let isCreateDialogOpen = $state(false);
	let createDialogDefaultStatus = $state<string | undefined>(undefined);
	let editingTask = $state<Task | null>(null);

	function openCreateDialog(defaultStatus?: string) {
		createDialogDefaultStatus = defaultStatus;
		isCreateDialogOpen = true;
	}

	// --- Bulk selection state ---
	let selectedIds = $state(new Set<string>());
	let bulkBusy = $state(false);

	function toggleTaskSelection(taskId: string, sel: boolean) {
		const next = new Set(selectedIds);
		if (sel) next.add(taskId);
		else next.delete(taskId);
		selectedIds = next;
	}

	function toggleSelectAllVisible(selectAll: boolean) {
		const next = new Set(selectedIds);
		if (selectAll) {
			for (const t of paginatedTasks) next.add(t.id);
		} else {
			for (const t of paginatedTasks) next.delete(t.id);
		}
		selectedIds = next;
	}

	function clearSelection() {
		selectedIds = new Set();
	}

	// Tasks already in done/cancelled — Pause is a no-op for them; show warning chip.
	const inactiveSelectedCount = $derived(
		[...selectedIds].filter((id) => {
			const t = tasks.find((x: any) => x.id === id) || statsTasks.find((x: any) => x.id === id);
			return t && (t.status === 'done' || t.status === 'cancelled');
		}).length
	);

	function getStatsRefreshQueries() {
		return [
			getTasks({
				...filterParams,
				excludeCompleted:
					view.current === 'kanban' && !filterParams.status ? true : undefined,
				include: { subtasks: true, tags: true, assignees: true }
			}),
			getTasks({ ...filterParams })
		];
	}

	async function handleBulkPause() {
		if (selectedIds.size === 0 || bulkBusy) return;
		const ids = [...selectedIds];
		bulkBusy = true;
		try {
			const res = await bulkUpdateTaskStatus({ taskIds: ids, newStatus: 'blocked' }).updates(
				...getStatsRefreshQueries()
			);
			toast.success(
				res.changed > 0
					? `${res.changed} task-uri marcate ca blocked`
					: 'Niciun task afectat'
			);
			clearSelection();
		} catch (e) {
			clientLogger.apiError('task_bulk_pause', e);
			toast.error(e instanceof Error ? e.message : 'Eroare la pauzarea task-urilor');
		} finally {
			bulkBusy = false;
		}
	}

	async function handleBulkDuplicate() {
		if (selectedIds.size === 0 || bulkBusy) return;
		const ids = [...selectedIds];
		bulkBusy = true;
		try {
			const res = await bulkDuplicateTasks(ids).updates(...getStatsRefreshQueries());
			toast.success(`${res.duplicated} task-uri duplicate`);
			clearSelection();
		} catch (e) {
			clientLogger.apiError('task_bulk_duplicate', e);
			toast.error(e instanceof Error ? e.message : 'Eroare la duplicarea task-urilor');
		} finally {
			bulkBusy = false;
		}
	}

	async function handleBulkDelete() {
		if (selectedIds.size === 0 || bulkBusy) return;
		const ids = [...selectedIds];
		if (
			typeof window !== 'undefined' &&
			!confirm(
				`Sigur ștergi ${ids.length} task-uri? Acțiunea e ireversibilă (subtaskuri, tags și assignees sunt și ele șterse).`
			)
		) {
			return;
		}
		bulkBusy = true;
		try {
			const res = await bulkDeleteTasks(ids).updates(...getStatsRefreshQueries());
			toast.success(`${res.deleted} task-uri șterse`);
			// Close detail panel if it was for one of the deleted tasks
			if (taskIdPanel.current && ids.includes(taskIdPanel.current)) {
				taskIdPanel.current = null;
			}
			clearSelection();
		} catch (e) {
			clientLogger.apiError('task_bulk_delete', e);
			toast.error(e instanceof Error ? e.message : 'Eroare la ștergerea task-urilor');
		} finally {
			bulkBusy = false;
		}
	}

	function openTaskFromList(task: Task) {
		if (typeof window !== 'undefined' && window.innerWidth < 768) {
			goto(`/${tenantSlug}/tasks/${task.id}`);
		} else {
			taskIdPanel.current = task.id;
		}
	}

	function closePanel() {
		taskIdPanel.current = null;
	}

	function handleCreateSuccess() {
		// Data will be refreshed automatically via .updates() in the dialog
	}

	async function handleDeleteTask(taskId: string) {
		if (!confirm('Are you sure you want to delete this task?')) {
			return;
		}

		try {
			await deleteTask(taskId).updates(
				getTasks({ ...filterParams, excludeCompleted: view.current === 'kanban' && !filterParams.status ? true : undefined }),
				getCompletedTasks({ ...(filterParams as any), page: 1, pageSize: 20 })
			);
			if (taskIdPanel.current === taskId) {
				taskIdPanel.current = null;
			}
			toast.success('Task deleted');
		} catch (e) {
			clientLogger.apiError('task_delete', e);
		}
	}

	function handleEditTask(task: Task) {
		editingTask = task;
	}

	function handleEditSuccess() {
		// Data refreshed automatically via .updates() in the dialog
	}

	function handleSortChange(column: string, direction: 'asc' | 'desc') {
		sortBy.current = column;
		sortDir.current = direction as any;
	}
</script>

<svelte:head>
	<title>Tasks - CRM</title>
</svelte:head>

<div class="mb-6 flex items-start justify-between gap-4">
	<div>
		<h1 class="text-3xl font-bold tracking-tight">Tasks</h1>
		<p class="mt-1 text-sm text-muted-foreground">
			Coordonează echipa: {stats.totalActive} active ·
			<strong class="text-[#ef4444]">{stats.overdue} overdue</strong>
			· {stats.dueToday} azi
		</p>
	</div>
	<div class="flex items-center gap-2">
		<!-- View Toggle -->
		<div class="flex items-center gap-1 rounded-md border p-1">
			<Button
				variant={view.current === 'kanban' ? 'default' : 'ghost'}
				size="sm"
				onclick={() => (view.current = 'kanban')}
			>
				<LayoutGridIcon class="mr-2 h-4 w-4" />
				Kanban
			</Button>
			<Button
				variant={view.current === 'table' ? 'default' : 'ghost'}
				size="sm"
				onclick={() => (view.current = 'table')}
			>
				<TableIcon class="mr-2 h-4 w-4" />
				Tabel
			</Button>
		</div>
		<Button onclick={() => openCreateDialog()}>
			<PlusIcon class="mr-2 h-4 w-4" />
			Task nou
		</Button>
	</div>
</div>

<!-- Stats strip (5 cards 1:1 with design: Total active / Overdue / Scadente azi / Săptămâna asta / Finalizate) -->
<div class="mb-4">
	<TaskStatsStrip
		{stats}
		activeFilter={(cardFilter.current ?? '') as CardFilter}
		onFilterChange={setCardFilter}
		cards={['all', 'overdue', 'today', 'week', 'completed']}
	/>
</div>

<!-- Filters -->
<div class="mb-6">
	<TaskFilterPills users={users} clients={clientsForFilter} />
</div>

<!-- Dialogs -->
<CreateTaskDialog
	open={isCreateDialogOpen}
	defaultStatus={createDialogDefaultStatus}
	onOpenChange={(open) => {
		isCreateDialogOpen = open;
		if (!open) createDialogDefaultStatus = undefined;
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

<!-- Content -->
{#if loading}
	<div class="flex items-center justify-center py-12">
		<p class="text-muted-foreground">Loading tasks...</p>
	</div>
{:else if view.current === 'kanban'}
	<TaskKanbanBoard
		tasks={filteredTasksForView}
		{projectMap}
		{userMap}
		{clientMap}
		{tenantSlug}
		onTaskClick={openTaskFromList}
		onEditTask={handleEditTask}
		onDeleteTask={handleDeleteTask}
		onAddTask={(status) => openCreateDialog(status)}
		{selectedIds}
		onTaskSelectChange={toggleTaskSelection}
		showSelectionCheckbox={selectedIds.size > 0}
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
			onTaskClick={openTaskFromList}
			onEditTask={handleEditTask}
			onDeleteTask={handleDeleteTask}
			{selectedIds}
			onTaskSelectChange={toggleTaskSelection}
			onToggleSelectAll={toggleSelectAllVisible}
			showSelectionCheckbox={true}
		/>
		{#if filteredTasksForView.length > 0}
			<div class="flex items-center justify-between mt-4">
				<div class="flex items-center gap-4">
					<p class="text-sm text-muted-foreground">
						{Math.min((currentPage - 1) * pageSize + 1, filteredTasksForView.length)}-{Math.min(currentPage * pageSize, filteredTasksForView.length)} of {filteredTasksForView.length} tasks
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

<TaskDetailPanel
	taskId={taskIdPanel.current}
	onClose={closePanel}
	{tenantSlug}
	currentUserId={(page.data as any)?.tenantUser?.userId}
/>

<TaskBulkActionBar
	count={selectedIds.size}
	inactiveCount={inactiveSelectedCount}
	onPause={handleBulkPause}
	onDuplicate={handleBulkDuplicate}
	onDelete={handleBulkDelete}
	onClear={clearSelection}
	busy={bulkBusy}
/>
