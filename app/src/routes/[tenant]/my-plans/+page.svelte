<script lang="ts">
	import { getMyPlansTasks, getUserTasksForDate } from '$lib/remotes/my-plans.remote';
	import { getTasks, updateTask } from '$lib/remotes/tasks.remote';
	import { getCurrentUser } from '$lib/remotes/auth.remote';
	import { Calendar as CalendarPrimitive } from 'bits-ui';
	import * as CalendarComponents from '$lib/components/ui/calendar';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import CreateTaskDialog from '$lib/components/create-task-dialog.svelte';
	import TaskDetailDialog from '$lib/components/task-detail-dialog.svelte';
	import {
		Dialog,
		DialogContent,
		DialogDescription,
		DialogFooter,
		DialogHeader,
		DialogTitle
	} from '$lib/components/ui/dialog';
	import { Plus, ClipboardList, MoreVertical, Calendar as CalendarIcon } from '@lucide/svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import * as ContextMenu from '$lib/components/ui/context-menu';
	import { today, getLocalTimeZone, isEqualMonth } from '@internationalized/date';
	import { setContext } from 'svelte';
	import { TASK_FILTERS_CONTEXT_KEY } from '$lib/components/task-filters-context';
	import type { Task } from '$lib/server/db/schema';
	import type { DateValue } from '@internationalized/date';
	import TaskPill from '$lib/components/my-plans/task-pill.svelte';
	import PlansToolbar from '$lib/components/my-plans/plans-toolbar.svelte';
	import PlansLegend from '$lib/components/my-plans/plans-legend.svelte';
	import {
		parseFilters,
		matchesFilters,
		isTaskOverdue,
		computeCounters,
		type Filters
	} from '$lib/components/my-plans/filters';
	import { getClients } from '$lib/remotes/clients.remote';

	const tenantSlug = $derived(page.params.tenant || '');

	// Calendar state
	const todayDate = today(getLocalTimeZone());
	let selectedDate = $state<DateValue>(todayDate);
	let calendarValue = $state<DateValue>(todayDate);
	let calendarPlaceholder = $state<DateValue>(todayDate);

	// Calculate date range for fetching tasks (3 months: current month, previous, next)
	const startDate = $derived.by(() => {
		const date = new Date(calendarValue.year, calendarValue.month - 1 - 1, 1);
		return date.toISOString().split('T')[0];
	});
	const endDate = $derived.by(() => {
		const date = new Date(calendarValue.year, calendarValue.month - 1 + 2, 0);
		return date.toISOString().split('T')[0];
	});

	// Fetch tasks for the date range
	const tasksQuery = $derived(getMyPlansTasks({ startDate, endDate }));
	const tasks = $derived(tasksQuery.current || []);
	const loading = $derived(tasksQuery.loading);

	// Filters from URL
	const filters: Filters = $derived(parseFilters(page.url.searchParams));

	// Clients for filter dropdown (only those that appear in the task range)
	const clientsQuery = getClients();
	const allClients = $derived(clientsQuery.current || []);
	const clientIdsInRange = $derived(
		new Set(tasks.map((t) => t.clientId).filter(Boolean) as string[])
	);
	const clientsForFilter = $derived(
		allClients.filter((c) => clientIdsInRange.has(c.id)).map((c) => ({ id: c.id, name: c.name }))
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

	// Group tasks by date
	const tasksByDate = $derived.by(() => {
		const map = new Map<string, Task[]>();
		for (const task of tasks) {
			if (task.dueDate) {
				const dateStr = new Date(task.dueDate).toISOString().split('T')[0];
				if (!map.has(dateStr)) {
					map.set(dateStr, []);
				}
				map.get(dateStr)!.push(task);
			}
		}
		return map;
	});

	// Get tasks for selected date
	const selectedDateStr = $derived(
		`${selectedDate.year}-${String(selectedDate.month).padStart(2, '0')}-${String(selectedDate.day).padStart(2, '0')}`
	);
	const selectedDateTasks = $derived(tasksByDate.get(selectedDateStr) || []);

	// Dialog state
	let isCreateDialogOpen = $state(false);
	let isAssignTasksDialogOpen = $state(false);
	let assignLoading = $state(false);
	let assignError = $state<string | null>(null);
	let selectedTask = $state<Task | null>(null);
	let isTaskDetailOpen = $state(false);
	let selectedDayForDialog = $state<DateValue | null>(null);
	let isDayDialogOpen = $state(false);

	// Get current user
	const currentUserQuery = getCurrentUser();
	const currentUser = $derived(currentUserQuery.current?.user);

	// Fetch all unassigned tasks (or tasks not assigned to current user) for assignment
	const allTasksQuery = $derived(
		getTasks({
			assignee: currentUser?.id || ''
		})
	);
	const allTasks = $derived(allTasksQuery.current || []);

	// Filter params for create task dialog - provide empty object for context
	let filterParams = $state({
		assignee: ''
	});
	$effect(() => {
		filterParams.assignee = currentUser?.id || '';
	});

	// Provide filterParams via context so create task dialog can access it
	setContext(TASK_FILTERS_CONTEXT_KEY, filterParams);

	function handleCreateSuccess() {
		// Refresh tasks query after task creation
		// Note: CreateTaskDialog uses getTasks internally, but we need to refresh getMyPlansTasks
		// The dialog will update getTasks, but we'll also need to refresh our calendar view
		// For now, tasksQuery will auto-refresh when the page re-renders
		isCreateDialogOpen = false;
	}

	async function handleAssignTask(task: Task) {
		if (!currentUser?.id) {
			assignError = 'Unable to determine current user';
			return;
		}

		assignLoading = true;
		assignError = null;

		try {
			await updateTask({
				taskId: task.id,
				dueDate: selectedDateStr,
				title: task.title
			}).updates(tasksQuery, allTasksQuery);

			isAssignTasksDialogOpen = false;
		} catch (e) {
			assignError = e instanceof Error ? e.message : 'Failed to assign task';
		} finally {
			assignLoading = false;
		}
	}

	function getPriorityColor(priority: string) {
		switch (priority) {
			case 'urgent':
				return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300';
			case 'high':
				return 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300';
			case 'medium':
				return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300';
			case 'low':
				return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
			default:
				return 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300';
		}
	}

	function formatDateKey(date: DateValue): string {
		return `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
	}

	function getTasksForDate(date: DateValue): Task[] {
		const dateKey = formatDateKey(date);
		return tasksByDate.get(dateKey) || [];
	}

	function handleDateClick(date: DateValue) {
		selectedDate = date;
	}

	function goToToday() {
		calendarValue = todayDate;
		calendarPlaceholder = todayDate;
		selectedDate = todayDate;
	}

	function handleClickTodayBadge() {
		selectedDate = todayDate;
		selectedDayForDialog = todayDate;
		isDayDialogOpen = true;
	}

	function handleTaskClick(task: Task, event: MouseEvent) {
		event.stopPropagation();
		selectedTask = task;
		isTaskDetailOpen = true;
	}

	function handleDayIconClick(date: DateValue, event: MouseEvent) {
		event.stopPropagation();
		selectedDayForDialog = date;
		isDayDialogOpen = true;
	}

	function handleContextMenuAction(date: DateValue, action: string) {
		if (action === 'view') {
			selectedDayForDialog = date;
			isDayDialogOpen = true;
		} else if (action === 'new-task') {
			selectedDate = date;
			isCreateDialogOpen = true;
		} else if (action === 'assign-task') {
			selectedDate = date;
			isAssignTasksDialogOpen = true;
		}
	}

	const selectedDayTasksForDialog = $derived.by(() => {
		if (!selectedDayForDialog) return [];
		const dateKey = formatDateKey(selectedDayForDialog);
		return tasksByDate.get(dateKey) || [];
	});

	const selectedDayStrForDialog = $derived.by(() => {
		if (!selectedDayForDialog) return '';
		return formatDateKey(selectedDayForDialog);
	});

	// Drag and drop state
	let draggedTask = $state<Task | null>(null);
	let dragOverDate = $state<string | null>(null);
	let isDragging = $state(false);

	function handleDragStart(e: DragEvent, task: Task) {
		if (!(e.target instanceof HTMLElement)) return;
		draggedTask = task;
		isDragging = true;
		e.dataTransfer!.effectAllowed = 'move';
		e.dataTransfer!.dropEffect = 'move';
		if (e.target) {
			e.target.style.opacity = '0.5';
		}
	}

	function handleDragEnd(e: DragEvent) {
		isDragging = false;
		draggedTask = null;
		dragOverDate = null;
		if (e.target instanceof HTMLElement) {
			e.target.style.opacity = '1';
		}
	}

	function handleDragOver(e: DragEvent, date: DateValue) {
		e.preventDefault();
		const dateKey = formatDateKey(date);
		if (dragOverDate !== dateKey) {
			dragOverDate = dateKey;
		}
		e.dataTransfer!.dropEffect = 'move';
	}

	function handleDragLeave(e: DragEvent) {
		// Only clear if we're leaving the drop target, not entering a child
		// implementation detail: simplified for now, usually needs check for relatedTarget
	}

	async function handleDrop(e: DragEvent, date: DateValue) {
		e.preventDefault();
		const dateKey = formatDateKey(date);
		dragOverDate = null;

		if (!draggedTask) return;

		// Don't do anything if dropping on same day
		if (draggedTask.dueDate) {
			const currentDueDate = new Date(draggedTask.dueDate).toISOString().split('T')[0];
			if (currentDueDate === dateKey) {
				handleDragEnd(e);
				return;
			}
		}

		const taskId = draggedTask.id;
		const taskTitle = draggedTask.title;

		// Optimistic update (optional, but good for UX)
		// For now we rely on the server response to refresh the view
		// since tasksQuery is reactive

		try {
			await updateTask({
				taskId,
				dueDate: dateKey,
				title: taskTitle
			}).updates(tasksQuery);
		} catch (e) {
			console.error('Failed to move task', e);
			// Optionally show error toast
		} finally {
			handleDragEnd(e);
		}
	}
</script>

<div class="flex h-[calc(100vh-6rem)] flex-col">
	<div class="mb-6 flex items-center justify-between">
		<div>
			<h1 class="text-3xl font-bold">My Plans</h1>
			<p class="mt-1 text-muted-foreground">Plan and organize your tasks</p>
		</div>
		<Button onclick={() => (isCreateDialogOpen = true)}>
			<Plus class="mr-2 h-4 w-4" />
			New Task
		</Button>
	</div>

	<PlansToolbar
		{filters}
		{counters}
		clients={clientsForFilter}
		onGoToToday={goToToday}
		onClickToday={handleClickTodayBadge}
	/>

	<div class="min-h-0 flex-1">
		<Card class="flex h-full flex-col">
			<CardContent class="min-h-0 flex-1 overflow-auto p-4">
				{#if loading}
					<div class="flex items-center justify-center py-12">
						<p class="text-muted-foreground">Loading tasks...</p>
					</div>
				{:else}
					<CalendarPrimitive.Root
						type="single"
						bind:value={calendarValue}
						bind:placeholder={calendarPlaceholder}
						locale="en-US"
						class="w-full"
					>
						{#snippet children({ months, weekdays })}
							<CalendarComponents.Months>
								<CalendarComponents.Nav>
									<CalendarComponents.PrevButton />
									<CalendarComponents.NextButton />
								</CalendarComponents.Nav>
								{#each months as month, monthIndex}
									<CalendarComponents.Month class="w-full">
										<CalendarComponents.Header>
											<CalendarComponents.Caption
												captionLayout="label"
												months={undefined}
												monthFormat="long"
												years={undefined}
												yearFormat="numeric"
												month={month.value}
												bind:placeholder={calendarPlaceholder}
												{monthIndex}
												locale="en-US"
											/>
										</CalendarComponents.Header>
										<CalendarComponents.Grid class="w-full border-collapse">
											<CalendarComponents.GridHead class="w-full">
												<CalendarComponents.GridRow class="w-full select-none">
													{#each weekdays as weekday}
														<CalendarComponents.HeadCell
															class="w-full py-2 text-center text-xs font-semibold tracking-wider text-muted-foreground uppercase"
														>
															{weekday.slice(0, 2)}
														</CalendarComponents.HeadCell>
													{/each}
												</CalendarComponents.GridRow>
											</CalendarComponents.GridHead>
											<CalendarComponents.GridBody class="w-full">
												{#each month.weeks as weekDates}
													<CalendarComponents.GridRow class="w-full">
														{#each weekDates as date}
															{@const dayTasks = getTasksForDate(date)}
															{@const isSelected =
																date.year === selectedDate.year &&
																date.month === selectedDate.month &&
																date.day === selectedDate.day}
															{@const isToday =
																date.year === todayDate.year &&
																date.month === todayDate.month &&
																date.day === todayDate.day}
															{@const isDragOver = dragOverDate === formatDateKey(date)}
															{@const cellDate = date.toDate(getLocalTimeZone())}
															{@const isWeekend =
																cellDate.getDay() === 0 || cellDate.getDay() === 6}
															{@const overdueInDay = dayTasks.filter((t) =>
																isTaskOverdue(t, todayDate)
															).length}
															<CalendarComponents.Cell
																{date}
																month={month.value}
																class="h-auto! min-h-[180px] w-full border border-border/50"
															>
																<ContextMenu.Root>
																	<ContextMenu.Trigger>
																		{#snippet child({ props })}
																			<button
																				{...props}
																				type="button"
																				class="group relative flex h-full min-h-[180px] w-full cursor-pointer flex-col items-start rounded-md p-2 transition-all hover:bg-accent/50 {isSelected
																					? 'bg-primary/10 ring-2 ring-primary ring-offset-1'
																					: ''} {isToday && !isSelected
																					? 'bg-accent/30 ring-1 ring-primary/50'
																					: ''} {!isEqualMonth(date, month.value)
																					? 'opacity-40'
																					: ''} {isDragOver
																					? 'border-primary bg-primary/20 ring-2 ring-primary'
																					: ''} {isWeekend && isEqualMonth(date, month.value)
																					? 'bg-muted/20'
																					: ''}"
																				onclick={() => handleDateClick(date)}
																				ondragover={(e) => handleDragOver(e, date)}
																				ondrop={(e) => handleDrop(e, date)}
																			>
																				<div
																					class="mb-1.5 flex w-full items-center justify-between"
																				>
																					<div class="flex items-center gap-1">
																						<span
																							class="text-sm font-semibold {isSelected
																								? 'text-primary'
																								: isToday && !isSelected
																									? 'font-bold text-primary'
																									: 'text-foreground'}"
																						>
																							{date.day}
																						</span>
																						{#if overdueInDay > 0}
																							<span
																								class="h-1.5 w-1.5 rounded-full bg-red-500"
																								aria-label="{overdueInDay} overdue"
																								title="{overdueInDay} overdue"
																							></span>
																						{/if}
																						{#if isToday && !isSelected}
																							<span
																								class="text-[9px] font-semibold tracking-wider text-primary/70 uppercase"
																								>TODAY</span
																							>
																						{/if}
																					</div>
																					<div
																						role="button"
																						tabindex="0"
																						class="rounded-md p-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-accent/80 {isSelected
																							? 'opacity-100'
																							: ''}"
																						onclick={(e) => handleDayIconClick(date, e)}
																						onkeydown={(e) => {
																							if (e.key === 'Enter' || e.key === ' ')
																								handleDayIconClick(
																									date,
																									e as unknown as MouseEvent
																								);
																						}}
																						title="View day details"
																					>
																						<CalendarIcon
																							class="h-4 w-4 text-muted-foreground"
																							aria-hidden="true"
																						/>
																					</div>
																				</div>
																				{#if dayTasks.length > 0}
																					<div class="flex min-h-0 w-full flex-1 flex-col gap-1">
																						{#each dayTasks.slice(0, 6) as task (task.id)}
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
																						{/each}
																						{#if dayTasks.length > 6}
																							<div
																								class="truncate px-2 py-1 text-xs font-medium text-muted-foreground"
																							>
																								+{dayTasks.length - 6} more
																							</div>
																						{/if}
																					</div>
																				{:else}
																					<div
																						class="w-full flex-1"
																						ondragover={(e) => handleDragOver(e, date)}
																						ondrop={(e) => handleDrop(e, date)}
																						role="application"
																						aria-label="Drop zone"
																					></div>
																				{/if}
																			</button>
																		{/snippet}
																	</ContextMenu.Trigger>
																	<ContextMenu.Content>
																		<ContextMenu.Item
																			onclick={() => handleContextMenuAction(date, 'view')}
																		>
																			<CalendarIcon class="h-4 w-4" />
																			View Day Details
																		</ContextMenu.Item>
																		<ContextMenu.Separator />
																		<ContextMenu.Item
																			onclick={() => handleContextMenuAction(date, 'new-task')}
																		>
																			<Plus class="h-4 w-4" />
																			New Task
																		</ContextMenu.Item>
																		<ContextMenu.Item
																			onclick={() => handleContextMenuAction(date, 'assign-task')}
																		>
																			<ClipboardList class="h-4 w-4" />
																			Assign Existing Task
																		</ContextMenu.Item>
																	</ContextMenu.Content>
																</ContextMenu.Root>
															</CalendarComponents.Cell>
														{/each}
													</CalendarComponents.GridRow>
												{/each}
											</CalendarComponents.GridBody>
										</CalendarComponents.Grid>
									</CalendarComponents.Month>
								{/each}
							</CalendarComponents.Months>
						{/snippet}
					</CalendarPrimitive.Root>
				{/if}
			</CardContent>
		</Card>
	</div>

	<div class="mt-2">
		<PlansLegend />
	</div>
</div>

<CreateTaskDialog
	open={isCreateDialogOpen}
	onOpenChange={(open) => (isCreateDialogOpen = open)}
	onSuccess={handleCreateSuccess}
	defaultDueDate={selectedDateStr}
	additionalQueriesToUpdate={[tasksQuery, allTasksQuery]}
/>

<Dialog bind:open={isAssignTasksDialogOpen}>
	<DialogContent class="max-h-[85vh] overflow-y-auto sm:max-w-[500px]">
		<DialogHeader>
			<DialogTitle>Assign Existing Task</DialogTitle>
			<DialogDescription>
				Assign a task to yourself for {new Date(selectedDateStr + 'T00:00:00').toLocaleDateString(
					'en-US',
					{
						weekday: 'long',
						month: 'long',
						day: 'numeric'
					}
				)}
			</DialogDescription>
		</DialogHeader>
		<div class="max-h-[400px] overflow-y-auto">
			{#if allTasks.length === 0}
				<p class="py-4 text-center text-sm text-muted-foreground">
					No unassigned tasks available. All tasks are already assigned to you.
				</p>
			{:else}
				<div class="space-y-2">
					{#each allTasks as task}
						<div
							class="cursor-pointer rounded-lg border p-3 transition-colors hover:bg-accent"
							role="button"
							tabindex="0"
							onclick={() => handleAssignTask(task)}
							onkeydown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									handleAssignTask(task);
								}
							}}
						>
							<div class="flex items-start justify-between gap-2">
								<div class="min-w-0 flex-1">
									<h4 class="truncate font-medium">{task.title}</h4>
									{#if task.description}
										<p class="mt-1 line-clamp-2 text-sm text-muted-foreground">
											{task.description}
										</p>
									{/if}
									<div class="mt-2 flex items-center gap-2">
										<Badge variant="outline" class="text-xs">{task.status}</Badge>
										{#if task.priority}
											<Badge class="text-xs {getPriorityColor(task.priority)}"
												>{task.priority}</Badge
											>
										{/if}
									</div>
								</div>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
		{#if assignError}
			<div class="mt-4 rounded-md bg-destructive/10 p-3">
				<p class="text-sm text-destructive">{assignError}</p>
			</div>
		{/if}
		<DialogFooter>
			<Button
				variant="outline"
				onclick={() => (isAssignTasksDialogOpen = false)}
				disabled={assignLoading}
			>
				Cancel
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>

<TaskDetailDialog
	task={selectedTask}
	open={isTaskDetailOpen}
	onOpenChange={(open) => {
		isTaskDetailOpen = open;
		if (!open) selectedTask = null;
	}}
	{tenantSlug}
	additionalQueriesToUpdate={[tasksQuery, allTasksQuery]}
/>

<Dialog bind:open={isDayDialogOpen}>
	<DialogContent class="max-h-[80vh] overflow-y-auto sm:max-w-[600px]">
		<DialogHeader>
			<DialogTitle>
				{selectedDayForDialog
					? new Date(selectedDayStrForDialog + 'T00:00:00').toLocaleDateString('en-US', {
							weekday: 'long',
							year: 'numeric',
							month: 'long',
							day: 'numeric'
						})
					: ''}
			</DialogTitle>
			<DialogDescription>
				{selectedDayTasksForDialog.length} task{selectedDayTasksForDialog.length !== 1 ? 's' : ''} scheduled
				for this day
			</DialogDescription>
		</DialogHeader>
		<div class="mt-4 space-y-4">
			{#if selectedDayTasksForDialog.length === 0}
				<p class="py-4 text-center text-sm text-muted-foreground">
					No tasks scheduled for this day.
				</p>
			{:else}
				<div class="space-y-2">
					{#each selectedDayTasksForDialog as task}
						<div
							class="cursor-pointer rounded-lg border p-3 transition-colors hover:bg-accent"
							role="button"
							tabindex="0"
							onclick={() => {
								isDayDialogOpen = false;
								selectedTask = task;
								isTaskDetailOpen = true;
							}}
							onkeydown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									isDayDialogOpen = false;
									selectedTask = task;
									isTaskDetailOpen = true;
								}
							}}
						>
							<div class="flex items-start justify-between gap-2">
								<div class="min-w-0 flex-1">
									<h4 class="truncate font-medium">{task.title}</h4>
									{#if task.description}
										<p class="mt-1 line-clamp-2 text-sm text-muted-foreground">
											{task.description}
										</p>
									{/if}
									<div class="mt-2 flex items-center gap-2">
										<Badge variant="outline" class="text-xs">{task.status}</Badge>
										{#if task.priority}
											<Badge class="text-xs {getPriorityColor(task.priority)}"
												>{task.priority}</Badge
											>
										{/if}
									</div>
								</div>
							</div>
						</div>
					{/each}
				</div>
			{/if}
			<div class="flex flex-col gap-2 border-t pt-4">
				<Button
					variant="outline"
					class="w-full"
					onclick={() => {
						if (selectedDayForDialog) {
							selectedDate = selectedDayForDialog;
						}
						isDayDialogOpen = false;
						isCreateDialogOpen = true;
					}}
				>
					<Plus class="mr-2 h-4 w-4" />
					New Task
				</Button>
				<Button
					variant="outline"
					class="w-full"
					onclick={() => {
						if (selectedDayForDialog) {
							selectedDate = selectedDayForDialog;
						}
						isDayDialogOpen = false;
						isAssignTasksDialogOpen = true;
					}}
				>
					<ClipboardList class="mr-2 h-4 w-4" />
					Assign Existing Task
				</Button>
			</div>
		</div>
	</DialogContent>
</Dialog>
