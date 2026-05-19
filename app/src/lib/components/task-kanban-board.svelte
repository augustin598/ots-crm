<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import CheckCircle2Icon from '@lucide/svelte/icons/check-circle-2';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import type { Task } from '$lib/server/db/schema';
	import { updateTaskPosition, getTasks, getCompletedTasks } from '$lib/remotes/tasks.remote';
	import { formatStatus } from './task-kanban-utils';
	import { getTaskFilters } from '$lib/components/task-filters-context';
	import { toast } from 'svelte-sonner';
	import { tick } from 'svelte';
	import TaskCard, { type AssigneeInfo, type TagInfo, type SubtaskProgress } from './task-card.svelte';

	type TaskWithIncludes = Task & {
		subtaskCount?: number;
		subtaskDoneCount?: number;
		tags?: TagInfo[];
		assignees?: AssigneeInfo[];
	};

	type Props = {
		tasks: TaskWithIncludes[];
		projectMap: Map<string, string>;
		userMap: Map<string, string>;
		clientMap: Map<string, string>;
		clientColorMap?: Map<string, string>;
		tenantSlug: string;
		onTaskClick: (task: Task) => void;
		onEditTask: (task: Task) => void;
		onDeleteTask: (taskId: string) => void;
		onTasksUpdate?: () => void;
		onAddTask?: (status: string) => void;
		selectedIds?: Set<string>;
		onTaskSelectChange?: (taskId: string, selected: boolean) => void;
		showSelectionCheckbox?: boolean;
	};

	let {
		tasks,
		projectMap,
		userMap,
		clientMap,
		clientColorMap,
		tenantSlug,
		onTaskClick,
		onEditTask,
		onDeleteTask,
		onTasksUpdate,
		onAddTask,
		selectedIds,
		onTaskSelectChange,
		showSelectionCheckbox = false
	}: Props = $props();

	// Get filterParams from context (set by parent page) or use empty object as fallback
	const filterParams = getTaskFilters();

	// Column order per design 1:1 (tasks-data.jsx STATUSES order):
	// pending → todo → in-progress → review → done → blocked
	const STATUSES = ['pending-approval', 'todo', 'in-progress', 'review', 'done', 'blocked'] as const;

	type ColumnStatus = (typeof STATUSES)[number];

	// Per-status dot color (matches design's tk-col-dot)
	const STATUS_DOT: Record<ColumnStatus, string> = {
		'pending-approval': '#f59e0b',
		todo: '#64748b',
		'in-progress': '#1877F2',
		review: '#8b5cf6',
		done: '#10b981',
		blocked: '#ef4444'
	};

	function buildAssigneeInfos(task: TaskWithIncludes): AssigneeInfo[] {
		// Prefer the `assignees` array from include.assignees=true; fall back to legacy single assignee.
		if (Array.isArray(task.assignees) && task.assignees.length > 0) {
			return task.assignees as AssigneeInfo[];
		}
		if (task.assignedToUserId) {
			const name = userMap.get(task.assignedToUserId) || '';
			const [firstName, ...rest] = name.split(' ');
			return [
				{
					userId: task.assignedToUserId,
					firstName: firstName ?? null,
					lastName: rest.join(' ') || null,
					email: null,
					displayName: name
				}
			];
		}
		return [];
	}

	function buildSubtaskProgress(task: TaskWithIncludes): SubtaskProgress | null {
		const total = task.subtaskCount ?? 0;
		if (total <= 0) return null;
		return { done: task.subtaskDoneCount ?? 0, total };
	}

	// Optimistic updates for active tasks — synced from prop via $effect
	let optimisticTasks = $state<Task[]>([]);

	// --- Done column lazy loading ---
	const DONE_PAGE_SIZE = 20;
	const DONE_COLLAPSED_COUNT = 3;
	let doneLoadedPages = $state(1);
	let doneExpanded = $state(false);

	// Reset done pagination when filters change
	$effect(() => {
		filterParams; // reactive dependency
		doneLoadedPages = 1;
	});

	// Build one query per loaded page of completed tasks
	const completedQueries = $derived.by(() => {
		const fp = filterParams as any;
		const queries = [];
		for (let p = 1; p <= doneLoadedPages; p++) {
			queries.push(
				getCompletedTasks({
					projectId: fp?.projectId,
					clientId: fp?.clientId,
					milestoneId: fp?.milestoneId,
					priority: fp?.priority,
					assignee: fp?.assignee,
					search: fp?.search,
					dueDate: fp?.dueDate,
					createdDate: fp?.createdDate,
					sortBy: fp?.sortBy,
					sortDir: fp?.sortDir as 'asc' | 'desc' | undefined,
					page: p,
					pageSize: DONE_PAGE_SIZE
				})
			);
		}
		return queries;
	});

	// Flatten all loaded pages of done tasks into one array
	const doneTasks = $derived.by(() => {
		const all: Task[] = [];
		for (const q of completedQueries) {
			if (q.current?.items) all.push(...q.current.items);
		}
		return all;
	});

	const doneTotalCount = $derived(completedQueries[0]?.current?.totalCount ?? 0);
	const doneIsLoading = $derived(completedQueries.some((q) => q.loading));
	const doneHasMore = $derived(doneTasks.length < doneTotalCount);
	const doneHasCollapsedItems = $derived(!doneExpanded && doneTasks.length > DONE_COLLAPSED_COUNT);

	// Separate optimistic state for done column
	let optimisticDoneTasks = $state<Task[]>([]);
	$effect(() => {
		optimisticDoneTasks = doneTasks;
	});

	// Group tasks by status and sort by position
	const groupedTasks = $derived.by(() => {
		const groups: Record<string, TaskWithIncludes[]> = {
			'pending-approval': [],
			todo: [],
			'in-progress': [],
			review: [],
			done: [],
			blocked: []
		};

		// Active tasks — from optimisticTasks (excludes done/cancelled)
		const tasksToGroup = optimisticTasks.length > 0 ? optimisticTasks : tasks;
		for (const task of tasksToGroup) {
			const status = task.status || 'todo';
			if (status in groups && status !== 'done') {
				groups[status].push(task);
			}
		}

		// Done tasks — from their own optimistic state (limited when collapsed)
		const visibleDoneTasks = doneExpanded
			? optimisticDoneTasks
			: optimisticDoneTasks.slice(0, DONE_COLLAPSED_COUNT);
		for (const task of visibleDoneTasks) {
			groups['done'].push(task);
		}

		// Sort each group by position, then by createdAt desc
		for (const status in groups) {
			groups[status].sort((a, b) => {
				const posA = a.position ?? 0;
				const posB = b.position ?? 0;
				if (posA !== posB) return posA - posB;
				const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
				const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
				return dateB - dateA;
			});
		}

		return groups;
	});

	// Keyboard accessibility state
	let pickedUpTask = $state<Task | null>(null);
	let liveRegionMessage = $state('');

	// Drag state
	let draggedTask = $state<Task | null>(null);
	let draggedFromStatus = $state<string | null>(null);
	let draggedFromIndex = $state<number>(-1);
	let dragOverStatus = $state<string | null>(null);
	let dragOverIndex = $state<number>(-1);
	let isDragging = $state(false);



	$effect(() => {
		optimisticTasks = tasks;
	});

	function handleDragStart(e: DragEvent, task: Task, status: string, index: number) {
		draggedTask = task;
		draggedFromStatus = status;
		draggedFromIndex = index;
		isDragging = true;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.dropEffect = 'move';
			// Required by Firefox to start drag
			try {
				e.dataTransfer.setData('text/plain', task.id);
			} catch {
				// ignore — some browsers throw if called after the event has propagated
			}
		}
	}

	function handleDragEnd(_e: DragEvent) {
		isDragging = false;
		draggedTask = null;
		draggedFromStatus = null;
		draggedFromIndex = -1;
		dragOverStatus = null;
		dragOverIndex = -1;
	}

	function handleDragOver(e: DragEvent, status: string, index: number) {
		e.preventDefault();
		e.dataTransfer!.dropEffect = 'move';
		dragOverStatus = status;
		dragOverIndex = index;
	}

	function handleDragLeave() {
		dragOverStatus = null;
		dragOverIndex = -1;
	}

	// Build completed tasks query args from current filter context
	function buildCompletedQueryArgs(page: number) {
		const fp = filterParams as any;
		return {
			projectId: fp?.projectId,
			clientId: fp?.clientId,
			milestoneId: fp?.milestoneId,
			priority: fp?.priority,
			assignee: fp?.assignee,
			search: fp?.search,
			dueDate: fp?.dueDate,
			createdDate: fp?.createdDate,
			sortBy: fp?.sortBy,
			sortDir: fp?.sortDir as 'asc' | 'desc' | undefined,
			page,
			pageSize: DONE_PAGE_SIZE
		};
	}

	// Build the full .updates() list for position changes
	function buildPositionUpdates(involvesDone: boolean) {
		const updates: any[] = [
			getTasks({ ...(filterParams as any || {}), excludeCompleted: true })
		];
		if (involvesDone) {
			for (let p = 1; p <= doneLoadedPages; p++) {
				updates.push(getCompletedTasks(buildCompletedQueryArgs(p)));
			}
		}
		return updates;
	}

	async function handleDrop(e: DragEvent, targetStatus: string, targetIndex: number) {
		e.preventDefault();
		if (!draggedTask || draggedFromStatus === null) return;

		const oldStatus = draggedFromStatus;
		const oldIndex = draggedFromIndex;
		const newStatus = targetStatus;
		const newPosition = targetIndex;
		const savedTask = { ...draggedTask };

		// Reset drag state early
		draggedTask = null;
		draggedFromStatus = null;
		draggedFromIndex = -1;
		dragOverStatus = null;
		dragOverIndex = -1;
		isDragging = false;

		// Snapshot for rollback
		const prevOptimisticTasks = [...optimisticTasks];
		const prevOptimisticDoneTasks = [...optimisticDoneTasks];

		// --- Optimistic update ---
		if (oldStatus === 'done' && newStatus === 'done') {
			// Reorder within done column
			const taskIdx = optimisticDoneTasks.findIndex((t) => t.id === savedTask.id);
			if (taskIdx === -1) return;
			const updatedTask: Task = { ...savedTask, status: 'done', position: newPosition };
			const newDone = [...optimisticDoneTasks];
			newDone[taskIdx] = updatedTask;
			newDone.forEach((t, i) => {
				if (i !== taskIdx && (t.position ?? 0) >= newPosition) {
					newDone[i] = { ...t, position: (t.position ?? 0) + 1 };
				}
			});
			optimisticDoneTasks = newDone;
		} else if (oldStatus === 'done' && newStatus !== 'done') {
			// Moving FROM done → active column
			optimisticDoneTasks = optimisticDoneTasks.filter((t) => t.id !== savedTask.id);
			const movedTask: Task = { ...savedTask, status: newStatus, position: newPosition };
			const newActive = [...optimisticTasks, movedTask];
			newActive.forEach((t, i) => {
				if (t.id !== savedTask.id && t.status === newStatus && (t.position ?? 0) >= newPosition) {
					newActive[i] = { ...t, position: (t.position ?? 0) + 1 };
				}
			});
			optimisticTasks = newActive;
		} else if (oldStatus !== 'done' && newStatus === 'done') {
			// Moving FROM active → done column
			const taskIdx = optimisticTasks.findIndex((t) => t.id === savedTask.id);
			if (taskIdx === -1) return;
			const newActive = [...optimisticTasks];
			newActive.splice(taskIdx, 1);
			newActive.forEach((t, i) => {
				if (t.status === oldStatus && (t.position ?? 0) > oldIndex) {
					newActive[i] = { ...t, position: (t.position ?? 0) - 1 };
				}
			});
			optimisticTasks = newActive;
			// Prepend to done column at position 0
			const movedTask: Task = { ...savedTask, status: 'done', position: 0 };
			optimisticDoneTasks = [movedTask, ...optimisticDoneTasks];
		} else {
			// Active → active (standard behavior)
			const taskIdx = optimisticTasks.findIndex((t) => t.id === savedTask.id);
			if (taskIdx === -1) return;
			const updatedTask: Task = { ...savedTask, status: newStatus, position: newPosition };
			const newActive = [...optimisticTasks];
			newActive[taskIdx] = updatedTask;
			if (oldStatus !== newStatus) {
				newActive.forEach((t, i) => {
					if (t.status === oldStatus && i !== taskIdx && (t.position ?? 0) > oldIndex) {
						newActive[i] = { ...t, position: (t.position ?? 0) - 1 };
					}
				});
			}
			newActive.forEach((t, i) => {
				if (t.status === newStatus && i !== taskIdx && (t.position ?? 0) >= newPosition) {
					newActive[i] = { ...t, position: (t.position ?? 0) + 1 };
				}
			});
			optimisticTasks = newActive;
		}

		// Update server
		const involvesDone = oldStatus === 'done' || newStatus === 'done';
		try {
			await updateTaskPosition({
				taskId: savedTask.id,
				newStatus: newStatus as 'todo' | 'in-progress' | 'review' | 'done' | 'cancelled' | 'pending-approval',
				newPosition,
				oldStatus: oldStatus as 'todo' | 'in-progress' | 'review' | 'done' | 'cancelled' | 'pending-approval',
				oldPosition: oldIndex
			}).updates(...buildPositionUpdates(involvesDone));
			onTasksUpdate?.();
		} catch (error) {
			// Rollback on error
			optimisticTasks = prevOptimisticTasks;
			optimisticDoneTasks = prevOptimisticDoneTasks;
			toast.error(error instanceof Error ? error.message : 'Failed to update task position');
		}
	}

	async function moveTask(task: Task, oldStatus: string, oldIndex: number, newStatus: string, newPosition: number) {
		// Snapshot for rollback
		const prevOptimisticTasks = [...optimisticTasks];
		const prevOptimisticDoneTasks = [...optimisticDoneTasks];

		if (oldStatus === 'done' && newStatus === 'done') {
			// Reorder within done column
			const taskIdx = optimisticDoneTasks.findIndex((t) => t.id === task.id);
			if (taskIdx === -1) return;
			const updatedTask: Task = { ...task, status: 'done', position: newPosition };
			const newDone = [...optimisticDoneTasks];
			newDone[taskIdx] = updatedTask;
			newDone.forEach((t, i) => {
				if (i !== taskIdx && (t.position ?? 0) >= newPosition) {
					newDone[i] = { ...t, position: (t.position ?? 0) + 1 };
				}
			});
			optimisticDoneTasks = newDone;
		} else if (oldStatus === 'done' && newStatus !== 'done') {
			optimisticDoneTasks = optimisticDoneTasks.filter((t) => t.id !== task.id);
			const movedTask: Task = { ...task, status: newStatus, position: newPosition };
			const newActive = [...optimisticTasks, movedTask];
			newActive.forEach((t, i) => {
				if (t.id !== task.id && t.status === newStatus && (t.position ?? 0) >= newPosition) {
					newActive[i] = { ...t, position: (t.position ?? 0) + 1 };
				}
			});
			optimisticTasks = newActive;
		} else if (oldStatus !== 'done' && newStatus === 'done') {
			const taskIdx = optimisticTasks.findIndex((t) => t.id === task.id);
			if (taskIdx === -1) return;
			const newActive = [...optimisticTasks];
			newActive.splice(taskIdx, 1);
			newActive.forEach((t, i) => {
				if (t.status === oldStatus && (t.position ?? 0) > oldIndex) {
					newActive[i] = { ...t, position: (t.position ?? 0) - 1 };
				}
			});
			optimisticTasks = newActive;
			const movedTask: Task = { ...task, status: 'done', position: 0 };
			optimisticDoneTasks = [movedTask, ...optimisticDoneTasks];
		} else {
			// Active → active
			const taskIdx = optimisticTasks.findIndex((t) => t.id === task.id);
			if (taskIdx === -1) return;
			const updatedTask: Task = { ...task, status: newStatus, position: newPosition };
			const newActive = [...optimisticTasks];
			newActive[taskIdx] = updatedTask;
			if (oldStatus !== newStatus) {
				newActive.forEach((t, i) => {
					if (t.status === oldStatus && i !== taskIdx && (t.position ?? 0) > oldIndex) {
						newActive[i] = { ...t, position: (t.position ?? 0) - 1 };
					}
				});
			}
			newActive.forEach((t, i) => {
				if (t.status === newStatus && i !== taskIdx && (t.position ?? 0) >= newPosition) {
					newActive[i] = { ...t, position: (t.position ?? 0) + 1 };
				}
			});
			optimisticTasks = newActive;
		}

		const involvesDone = oldStatus === 'done' || newStatus === 'done';
		try {
			await updateTaskPosition({
				taskId: task.id,
				newStatus: newStatus as 'todo' | 'in-progress' | 'review' | 'done' | 'cancelled' | 'pending-approval',
				newPosition,
				oldStatus: oldStatus as 'todo' | 'in-progress' | 'review' | 'done' | 'cancelled' | 'pending-approval',
				oldPosition: oldIndex
			}).updates(...buildPositionUpdates(involvesDone));
			onTasksUpdate?.();
		} catch (error) {
			optimisticTasks = prevOptimisticTasks;
			optimisticDoneTasks = prevOptimisticDoneTasks;
			toast.error(error instanceof Error ? error.message : 'Failed to update task position');
		}

		// Re-focus the card after DOM update
		await tick();
		const el = document.querySelector(`[data-task-id="${task.id}"]`) as HTMLElement;
		el?.focus();
	}

	async function handleCardKeyDown(e: KeyboardEvent, task: Task, currentStatus: string, currentIndex: number) {
		const statusIndex = STATUSES.indexOf(currentStatus as typeof STATUSES[number]);

		if (e.key === ' ' || e.key === 'Enter') {
			e.preventDefault();
			e.stopPropagation();
			if (pickedUpTask?.id === task.id) {
				pickedUpTask = null;
				liveRegionMessage = `${task.title} dropped`;
			} else {
				pickedUpTask = task;
				liveRegionMessage = `${task.title} picked up. Use arrow keys to move, Enter to drop, Escape to cancel.`;
			}
			return;
		}

		if (e.key === 'Escape' && pickedUpTask) {
			e.preventDefault();
			liveRegionMessage = `${pickedUpTask.title} move cancelled`;
			pickedUpTask = null;
			return;
		}

		if (!pickedUpTask || pickedUpTask.id !== task.id) return;

		const columnTasks = groupedTasks[currentStatus] || [];

		if (e.key === 'ArrowLeft' && statusIndex > 0) {
			e.preventDefault();
			const newStatus = STATUSES[statusIndex - 1];
			const newColumnTasks = groupedTasks[newStatus] || [];
			await moveTask(task, currentStatus, currentIndex, newStatus, newColumnTasks.length);
			liveRegionMessage = `${task.title} moved to ${formatStatus(newStatus)}`;
		} else if (e.key === 'ArrowRight' && statusIndex < STATUSES.length - 1) {
			e.preventDefault();
			const newStatus = STATUSES[statusIndex + 1];
			const newColumnTasks = groupedTasks[newStatus] || [];
			await moveTask(task, currentStatus, currentIndex, newStatus, newColumnTasks.length);
			liveRegionMessage = `${task.title} moved to ${formatStatus(newStatus)}`;
		} else if (e.key === 'ArrowUp' && currentIndex > 0) {
			e.preventDefault();
			await moveTask(task, currentStatus, currentIndex, currentStatus, currentIndex - 1);
			liveRegionMessage = `${task.title} moved up to position ${currentIndex}`;
		} else if (e.key === 'ArrowDown' && currentIndex < columnTasks.length - 1) {
			e.preventDefault();
			await moveTask(task, currentStatus, currentIndex, currentStatus, currentIndex + 1);
			liveRegionMessage = `${task.title} moved down to position ${currentIndex + 2}`;
		}
	}

</script>

<div class="sr-only" role="status" aria-live="assertive" aria-atomic="true">
	{liveRegionMessage}
</div>
<div class="grid grid-cols-[repeat(6,minmax(280px,1fr))] gap-3 overflow-x-auto pb-4">
	{#each STATUSES as status (status)}
		{@const statusTasks = groupedTasks[status] || []}
		{@const isDoneCol = status === 'done'}
		{@const isHighlight = dragOverStatus === status}
		<div
			class={[
				'tk-col flex min-h-[120px] flex-col gap-2 rounded-xl bg-[#eef1f6] p-2.5 transition-colors',
				isHighlight ? 'bg-[#dbe7fb] outline outline-2 outline-dashed outline-[#1877F2] -outline-offset-1' : ''
			].filter(Boolean).join(' ')}
			role="region"
			aria-label={`${formatStatus(status)} column, ${statusTasks.length} tasks`}
		>
			<!-- Column header: dot + title + count + actions -->
			<div class="tk-col-head flex items-center gap-2 px-1.5 pt-1 pb-1.5">
				<span
					class="h-2 w-2 shrink-0 rounded-full"
					style:background-color={STATUS_DOT[status]}
				></span>
				<span
					class="text-[12px] font-bold uppercase tracking-[.04em] text-[#0f172a]"
				>
					{#if status === 'done'}Finalizate{:else}{formatStatus(status)}{/if}
				</span>
				<span
					class="rounded-[10px] bg-white px-[7px] py-[1px] text-[11px] font-bold text-[#475569]"
				>
					{isDoneCol ? doneTotalCount : statusTasks.length}
				</span>
				<div class="ml-auto flex items-center gap-0.5">
					{#if isDoneCol && optimisticDoneTasks.length > DONE_COLLAPSED_COUNT}
						<button
							type="button"
							class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-[#94a3b8] transition-colors hover:bg-white hover:text-[#0f172a]"
							onclick={() => {
								doneExpanded = !doneExpanded;
							}}
						>
							{#if doneExpanded}
								<ChevronUpIcon class="h-3 w-3" />
								<span>Restrânge</span>
							{:else}
								<ChevronDownIcon class="h-3 w-3" />
								<span>Toate</span>
							{/if}
						</button>
					{/if}
					{#if onAddTask}
						<button
							type="button"
							class="grid h-[22px] w-[22px] place-items-center rounded-md text-[#94a3b8] transition-colors hover:bg-white hover:text-[#0f172a]"
							onclick={() => onAddTask?.(status)}
							aria-label={`Add task to ${formatStatus(status)}`}
						>
							<PlusIcon class="h-3 w-3" />
						</button>
					{/if}
				</div>
			</div>

			<!-- Body / drop zone -->
			<div
				class={[
					'flex flex-1 min-h-[200px] flex-col gap-2',
					isDoneCol && doneExpanded ? 'max-h-[600px] overflow-y-auto pr-1 done-scroll-area' : ''
				].filter(Boolean).join(' ')}
				role="list"
				ondragover={(e) => handleDragOver(e, status, statusTasks.length)}
				ondragleave={handleDragLeave}
				ondrop={(e) => handleDrop(e, status, statusTasks.length)}
			>
				{#if statusTasks.length === 0}
					{#if isDoneCol && doneIsLoading}
						<div class="rounded-lg border border-dashed border-[#e5e9f0] bg-white py-[22px] px-2 text-center text-[11.5px] text-[#94a3b8]">
							Se încarcă…
						</div>
					{:else}
						<div class="rounded-lg border border-dashed border-[#e5e9f0] bg-white py-[22px] px-2 text-center text-[11.5px] text-[#94a3b8]">
							Niciun task aici.<br />Trage unul aici.
						</div>
					{/if}
				{:else}
					{#each statusTasks as task, index (task.id)}
						{@const projectName = task.projectId ? projectMap.get(task.projectId) || null : null}
						{@const clientName = task.clientId ? clientMap.get(task.clientId) || null : null}
						{@const clientColor = task.clientId ? clientColorMap?.get(task.clientId) ?? null : null}
						<TaskCard
							{task}
							{projectName}
							projectId={task.projectId}
							{clientName}
							{clientColor}
							assignees={buildAssigneeInfos(task)}
							tags={task.tags ?? []}
							subtaskProgress={buildSubtaskProgress(task)}
							{tenantSlug}
							selected={selectedIds?.has(task.id) ?? false}
							onSelectChange={(v) => onTaskSelectChange?.(task.id, v)}
							onClick={() => onTaskClick(task)}
							onEdit={() => onEditTask(task)}
							onDelete={() => onDeleteTask(task.id)}
							dragState={draggedTask?.id === task.id
								? 'dragging'
								: pickedUpTask?.id === task.id
									? 'pickedUp'
									: dragOverStatus === status && dragOverIndex === index
										? 'over'
										: 'idle'}
							{showSelectionCheckbox}
							onDragStart={(e) => handleDragStart(e, task, status, index)}
							onDragEnd={(e) => handleDragEnd(e)}
							onKeyDown={(e) => handleCardKeyDown(e, task, status, index)}
							ariaLabel={`${task.title}, ${formatStatus(status)}, position ${index + 1} of ${statusTasks.length}`}
							dataTaskId={task.id}
						/>
					{/each}
				{/if}

				{#if dragOverStatus === status && dragOverIndex === statusTasks.length && draggedTask}
					<div class="h-2 rounded border-2 border-dashed border-[#1877F2]"></div>
				{/if}

				{#if isDoneCol && doneHasCollapsedItems}
					<button
						type="button"
						class="mt-1 flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-[#cbd5e1] bg-transparent py-2 text-xs font-semibold text-[#64748b] transition-colors hover:border-[#1877F2] hover:bg-[#1877F2]/[0.04] hover:text-[#1877F2]"
						onclick={() => {
							doneExpanded = true;
						}}
					>
						<ChevronDownIcon class="h-3.5 w-3.5" />
						Arată toate ({doneTotalCount})
					</button>
				{/if}
				{#if isDoneCol && doneExpanded && doneHasMore}
					<Button
						variant="outline"
						class="mt-1 w-full"
						disabled={doneIsLoading}
						onclick={() => {
							doneLoadedPages += 1;
						}}
					>
						{doneIsLoading
							? 'Se încarcă...'
							: `Mai multe (${doneTotalCount - doneTasks.length} rămase)`}
					</Button>
				{/if}
			</div>

			<!-- Bottom "Adaugă task" button (per design's .tk-add-card) -->
			{#if !isDoneCol && onAddTask}
				<button
					type="button"
					class="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[#cbd5e1] bg-transparent py-[9px] text-xs font-semibold text-[#64748b] transition-colors hover:border-[#1877F2] hover:bg-[#1877F2]/[0.04] hover:text-[#1877F2]"
					onclick={() => onAddTask?.(status)}
				>
					<PlusIcon class="h-3 w-3" />
					Adaugă task
				</button>
			{/if}
		</div>
	{/each}
</div>

<style>
	.done-scroll-area {
		padding-bottom: 3rem;
		scrollbar-width: thin;
		scrollbar-color: oklch(0.7 0.05 155) transparent;
	}
	.done-scroll-area::-webkit-scrollbar {
		width: 4px;
	}
	.done-scroll-area::-webkit-scrollbar-thumb {
		background: oklch(0.7 0.05 155);
		border-radius: 4px;
	}
	.done-scroll-area::-webkit-scrollbar-track {
		background: transparent;
	}
</style>
