<script lang="ts">
	import { getTasks, deleteTask } from '$lib/remotes/tasks.remote';
	import { getProjects } from '$lib/remotes/projects.remote';
	import { getTenantUsers } from '$lib/remotes/users.remote';
	import { getMilestones } from '$lib/remotes/milestones.remote';
	import { getClients } from '$lib/remotes/clients.remote';
	import { getCurrentUser } from '$lib/remotes/auth.remote';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { useQueryState, parseAsStringEnum, parseAsArrayOf, parseAsString } from 'nuqs-svelte';
	import { setContext } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import TaskDetailPanel from '$lib/components/task-detail-panel.svelte';
	import EditTaskDialog from '$lib/components/edit-task-dialog.svelte';
	import CreateTaskDialog from '$lib/components/create-task-dialog.svelte';
	import TaskFilterPills from '$lib/components/task-filter-pills.svelte';
	import TaskStatsStrip, { type CardFilter } from '$lib/components/task-stats-strip.svelte';
	import TaskCalendarView from '$lib/components/task-calendar-view.svelte';
	import { isTaskOverdue } from '$lib/utils/task-filters';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import type { Task } from '$lib/server/db/schema';
	import { toast } from 'svelte-sonner';
	import { clientLogger } from '$lib/client-logger';
	import { TASK_FILTERS_CONTEXT_KEY } from '$lib/components/task-filters-context';

	const tenantSlug = $derived(page.params.tenant || '');

	// Current user — drives assignee prefiltering
	const currentUserQuery = getCurrentUser();
	const currentUserId = $derived(currentUserQuery.current?.user?.id ?? '');

	// Filter states (same URL contract as /tasks, minus the `view` toggle)
	const statuses = useQueryState(
		'status',
		parseAsArrayOf(
			parseAsStringEnum([
				'todo',
				'in-progress',
				'review',
				'done',
				'cancelled',
				'pending-approval',
				'blocked'
			])
		)
	);
	const priorities = useQueryState(
		'priority',
		parseAsArrayOf(parseAsStringEnum(['low', 'medium', 'high', 'urgent']))
	);
	const projectIds = useQueryState('project', parseAsArrayOf(parseAsString));
	const milestoneIds = useQueryState('milestone', parseAsArrayOf(parseAsString));
	const clientIdFilter = useQueryState('client', parseAsString.withDefault(''));
	const search = useQueryState('search', parseAsString.withDefault(''));
	const dueDate = useQueryState(
		'dueDate',
		parseAsStringEnum(['overdue', 'today', 'thisWeek', 'thisMonth'])
	);
	const taskIdPanel = useQueryState('taskId', parseAsString);
	const cardFilter = useQueryState(
		'card',
		parseAsStringEnum(['overdue', 'today', 'week', 'completed'])
	);
	type TaskType = 'design' | 'video' | 'ads' | 'dev' | 'content' | 'meeting' | 'other';
	const taskType = useQueryState(
		'type',
		parseAsStringEnum(['design', 'video', 'ads', 'dev', 'content', 'meeting', 'other'])
	);

	// Build filter params. `assignee` is FORCED to current user — URL value is ignored.
	const filterParams = $derived({
		status:
			(statuses.current as string[] | null) && (statuses.current as string[]).length > 0
				? (statuses.current as string[])
				: undefined,
		priority:
			(priorities.current as string[] | null) && (priorities.current as string[]).length > 0
				? (priorities.current as string[])
				: undefined,
		assignee: currentUserId ? [currentUserId] : undefined,
		projectId:
			(projectIds.current as string[] | null) && (projectIds.current as string[]).length > 0
				? (projectIds.current as string[])
				: undefined,
		milestoneId:
			(milestoneIds.current as string[] | null) && (milestoneIds.current as string[]).length > 0
				? (milestoneIds.current as string[])
				: undefined,
		clientId: clientIdFilter.current || undefined,
		type: (taskType.current as TaskType | null) ?? undefined,
		search: search.current || undefined,
		dueDate: dueDate.current || undefined
	});

	// Provide filter context for child components (CreateTaskDialog reads it for default values)
	// svelte-ignore state_referenced_locally
	setContext(TASK_FILTERS_CONTEXT_KEY, filterParams);

	const tasksQuery = $derived(
		getTasks({
			...filterParams,
			include: { subtasks: true, tags: true, assignees: true }
		})
	);
	const tasks = $derived(tasksQuery.current || []);
	const loading = $derived(tasksQuery.loading);

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
		total: tasks.length,
		totalActive: tasks.filter((t: any) => isActiveStatus(t.status)).length,
		inProgress: tasks.filter((t: any) => t.status === 'in-progress').length,
		overdue: tasks.filter((t: any) => isActiveStatus(t.status) && isTaskOverdue(t.dueDate)).length,
		dueToday: tasks.filter((t: any) => isActiveStatus(t.status) && isDueToday(t.dueDate)).length,
		dueWeek: tasks.filter((t: any) => isActiveStatus(t.status) && isDueWithinWeek(t.dueDate))
			.length,
		completed: tasks.filter((t: any) => t.status === 'done').length,
		blocked: tasks.filter((t: any) => t.status === 'blocked').length
	});

	const filteredTasksForView = $derived.by(() => {
		const card = cardFilter.current;
		if (!card) return tasks;
		if (card === 'completed') return tasks.filter((t: any) => t.status === 'done');
		if (card === 'overdue') {
			return tasks.filter((t: any) => isActiveStatus(t.status) && isTaskOverdue(t.dueDate));
		}
		if (card === 'today') {
			return tasks.filter((t: any) => isActiveStatus(t.status) && isDueToday(t.dueDate));
		}
		if (card === 'week') {
			return tasks.filter((t: any) => isActiveStatus(t.status) && isDueWithinWeek(t.dueDate));
		}
		return tasks;
	});

	const usersQuery = getTenantUsers();
	const users = $derived(usersQuery.current || []);
	const clientsQuery = getClients();
	const clients = $derived(clientsQuery.current || []);

	// Clients dropdown — only those with at least one task assigned to current user
	const taskClientIds = $derived(
		new Set(tasks.map((t: any) => t.clientId).filter(Boolean) as string[])
	);
	const clientsForFilter = $derived(
		clients
			.filter((c: any) => taskClientIds.has(c.id))
			.map((c: any) => ({ id: c.id, name: c.name }))
	);

	// Pre-warm projects/milestones queries so child dialogs hit cache
	getProjects(undefined);
	getMilestones(undefined);

	function setCardFilter(v: CardFilter) {
		cardFilter.current = (v === '' ? null : v) as any;
	}

	// Dialog state
	let isCreateDialogOpen = $state(false);
	let createDialogInitialDay = $state<Date | null>(null);
	let createDialogInitialType = $state<'task' | 'meet' | undefined>(undefined);
	let editingTask = $state<Task | null>(null);

	function openCreateDialog() {
		createDialogInitialDay = null;
		createDialogInitialType = undefined;
		isCreateDialogOpen = true;
	}

	function openCreateDialogFromCalendar(isoDate: string, kind: 'task' | 'meet') {
		const [y, m, d] = isoDate.split('-').map(Number);
		if (y && m && d) {
			createDialogInitialDay = new Date(y, m - 1, d);
		} else {
			createDialogInitialDay = null;
		}
		createDialogInitialType = kind;
		isCreateDialogOpen = true;
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
		// Updates are propagated via .updates() in the dialog
	}

	async function handleDeleteTask(taskId: string) {
		if (!confirm('Sigur ștergi acest task?')) return;
		try {
			await deleteTask(taskId).updates(getTasks({ ...filterParams }));
			if (taskIdPanel.current === taskId) taskIdPanel.current = null;
			toast.success('Task șters');
		} catch (e) {
			clientLogger.apiError('task_delete', e);
		}
	}

	function handleEditTask(task: Task) {
		editingTask = task;
	}

	function handleEditSuccess() {
		// Updates propagated via .updates() in the dialog
	}
</script>

<svelte:head>
	<title>Plans mele - CRM</title>
</svelte:head>

<div class="mb-6 flex items-start justify-between gap-4">
	<div>
		<h1 class="text-3xl font-bold tracking-tight">Plans mele</h1>
		<p class="mt-1 text-sm text-muted-foreground">
			{stats.totalActive} active ·
			<strong class="text-[#ef4444]">{stats.overdue} overdue</strong>
			· {stats.dueToday} azi
		</p>
	</div>
	<Button onclick={() => openCreateDialog()}>
		<PlusIcon class="mr-2 h-4 w-4" />
		Task nou
	</Button>
</div>

<div class="mb-4">
	<TaskStatsStrip
		{stats}
		activeFilter={(cardFilter.current ?? '') as CardFilter}
		onFilterChange={setCardFilter}
		cards={['all', 'overdue', 'today', 'week', 'completed']}
	/>
</div>

<div class="mb-6">
	<TaskFilterPills {users} clients={clientsForFilter} lockedAssignee={currentUserId} />
</div>

<CreateTaskDialog
	open={isCreateDialogOpen}
	initialDay={createDialogInitialDay}
	initialType={createDialogInitialType}
	onOpenChange={(open) => {
		isCreateDialogOpen = open;
		if (!open) {
			createDialogInitialDay = null;
			createDialogInitialType = undefined;
		}
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

{#if loading}
	<div class="flex items-center justify-center py-12">
		<p class="text-muted-foreground">Se încarcă task-urile...</p>
	</div>
{:else}
	<TaskCalendarView
		tasks={filteredTasksForView}
		onTaskClick={openTaskFromList}
		onAddDay={openCreateDialogFromCalendar}
	/>
{/if}

<TaskDetailPanel
	taskId={taskIdPanel.current}
	onClose={closePanel}
	{tenantSlug}
	currentUserId={(page.data as any)?.tenantUser?.userId}
/>
