<script lang="ts">
	import { Card } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import {
		DropdownMenu,
		DropdownMenuContent,
		DropdownMenuItem,
		DropdownMenuTrigger
	} from '$lib/components/ui/dropdown-menu';
	import MoreVerticalIcon from '@lucide/svelte/icons/more-vertical';
	import type { Task } from '$lib/server/db/schema';
	import { updateTaskPosition, getTasks } from '$lib/remotes/tasks.remote';
	import { formatStatus, getPriorityColor, getPriorityDotColor, getPriorityCardClass, formatPriority, formatDate } from './task-kanban-utils';
	import { getTaskFilters } from '$lib/components/task-filters-context';
	import { toast } from 'svelte-sonner';
	import { tick } from 'svelte';

	type Props = {
		tasks: Task[];
		projectMap: Map<string, string>;
		userMap: Map<string, string>;
		clientMap: Map<string, string>;
		tenantSlug: string;
		onTaskClick: (task: Task) => void;
		onEditTask: (task: Task) => void;
		onDeleteTask: (taskId: string) => void;
		onTasksUpdate?: () => void;
	};

	let {
		tasks,
		projectMap,
		userMap,
		clientMap,
		tenantSlug,
		onTaskClick,
		onEditTask,
		onDeleteTask,
		onTasksUpdate
	}: Props = $props();

	// Get filterParams from context (set by parent page) or use empty object as fallback
	const filterParams = getTaskFilters();

	const STATUSES = ['pending-approval', 'todo', 'in-progress', 'review', 'done'] as const;

		// Optimistic updates
	let optimisticTasks = $state<Task[]>(tasks);

	// Group tasks by status and sort by position
	const groupedTasks = $derived.by(() => {
		const groups: Record<string, Task[]> = {
			'pending-approval': [],
			todo: [],
			'in-progress': [],
			review: [],
			done: []
		};

		// Use optimistic tasks for display
		const tasksToGroup = optimisticTasks.length > 0 ? optimisticTasks : tasks;

		for (const task of tasksToGroup) {
			const status = task.status || 'todo';
			if (status in groups) {
				groups[status].push(task);
			}
		}

		// Sort each group by position, then by createdAt
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
		if (!(e.target instanceof HTMLElement)) return;
		draggedTask = task;
		draggedFromStatus = status;
		draggedFromIndex = index;
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
		draggedFromStatus = null;
		draggedFromIndex = -1;
		dragOverStatus = null;
		dragOverIndex = -1;
		if (e.target instanceof HTMLElement) {
			e.target.style.opacity = '1';
		}
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

	async function handleDrop(e: DragEvent, targetStatus: string, targetIndex: number) {
		e.preventDefault();
		if (!draggedTask || draggedFromStatus === null) return;

		const oldStatus = draggedFromStatus;
		const oldIndex = draggedFromIndex;
		const newStatus = targetStatus;
		const newPosition = targetIndex;
		const taskId = draggedTask.id;

		// Optimistic update - create new array with updated task
		const taskIndex = optimisticTasks.findIndex((t) => t.id === taskId);
		if (taskIndex === -1) return;

		const updatedTask: Task = {
			...draggedTask,
			status: newStatus,
			position: newPosition
		};

		// Create new tasks array
		const newTasks = [...optimisticTasks];
		newTasks[taskIndex] = updatedTask;

		// Update positions for tasks in old status column
		if (oldStatus !== newStatus) {
			newTasks.forEach((t, i) => {
				if (t.status === oldStatus && i !== taskIndex && (t.position ?? 0) > oldIndex) {
					newTasks[i] = { ...t, position: (t.position ?? 0) - 1 };
				}
			});
		}

		// Update positions for tasks in new status column
		newTasks.forEach((t, i) => {
			if (t.status === newStatus && i !== taskIndex && (t.position ?? 0) >= newPosition) {
				newTasks[i] = { ...t, position: (t.position ?? 0) + 1 };
			}
		});

		optimisticTasks = newTasks;

		// Reset drag state
		const savedTask = draggedTask;
		draggedTask = null;
		draggedFromStatus = null;
		draggedFromIndex = -1;
		dragOverStatus = null;
		dragOverIndex = -1;
		isDragging = false;

		// Update server
		try {
			await updateTaskPosition({
				taskId: savedTask.id,
				newStatus: newStatus as 'todo' | 'in-progress' | 'review' | 'done' | 'cancelled' | 'pending-approval',
				newPosition,
				oldStatus: oldStatus as 'todo' | 'in-progress' | 'review' | 'done' | 'cancelled' | 'pending-approval',
				oldPosition: oldIndex
			}).updates(getTasks(filterParams || {}));
			onTasksUpdate?.();
		} catch (error) {
			// Rollback on error
			optimisticTasks = tasks;
			toast.error(error instanceof Error ? error.message : 'Failed to update task position');
		}
	}

	async function moveTask(task: Task, oldStatus: string, oldIndex: number, newStatus: string, newPosition: number) {
		const taskIndex = optimisticTasks.findIndex((t) => t.id === task.id);
		if (taskIndex === -1) return;

		const updatedTask: Task = { ...task, status: newStatus, position: newPosition };
		const newTasks = [...optimisticTasks];
		newTasks[taskIndex] = updatedTask;

		if (oldStatus !== newStatus) {
			newTasks.forEach((t, i) => {
				if (t.status === oldStatus && i !== taskIndex && (t.position ?? 0) > oldIndex) {
					newTasks[i] = { ...t, position: (t.position ?? 0) - 1 };
				}
			});
		}
		newTasks.forEach((t, i) => {
			if (t.status === newStatus && i !== taskIndex && (t.position ?? 0) >= newPosition) {
				newTasks[i] = { ...t, position: (t.position ?? 0) + 1 };
			}
		});

		optimisticTasks = newTasks;

		try {
			await updateTaskPosition({
				taskId: task.id,
				newStatus: newStatus as 'todo' | 'in-progress' | 'review' | 'done' | 'cancelled' | 'pending-approval',
				newPosition,
				oldStatus: oldStatus as 'todo' | 'in-progress' | 'review' | 'done' | 'cancelled' | 'pending-approval',
				oldPosition: oldIndex
			}).updates(getTasks(filterParams || {}));
			onTasksUpdate?.();
		} catch (error) {
			optimisticTasks = tasks;
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

	function formatDueDate(date: Date | string | null): string {
		if (!date) return 'No due date';
		return formatDate(date, 'short');
	}
</script>

<div class="sr-only" role="status" aria-live="assertive" aria-atomic="true">
	{liveRegionMessage}
</div>
<div class="grid gap-6 lg:grid-cols-5 overflow-x-auto pb-4">
	{#each STATUSES as status}
		{@const statusTasks = groupedTasks[status] || []}
		<div class="flex flex-col min-w-[280px]" role="region" aria-label="{formatStatus(status)} column, {statusTasks.length} tasks">
			<div class="flex items-center justify-between mb-4">
				<h3 class="font-semibold capitalize">
					{formatStatus(status)} ({statusTasks.length})
				</h3>
			</div>
			<div
				class="flex-1 space-y-3 min-h-[200px]"
				ondragover={(e) => handleDragOver(e, status, statusTasks.length)}
				ondragleave={handleDragLeave}
				ondrop={(e) => handleDrop(e, status, statusTasks.length)}
			>
				{#each statusTasks as task, index}
					{@const projectName = task.projectId ? projectMap.get(task.projectId) || '' : ''}
					{@const clientName = task.clientId ? clientMap.get(task.clientId) || '' : ''}
					{@const assigneeName = task.assignedToUserId ? userMap.get(task.assignedToUserId) || '' : ''}
					{@const isDragged = draggedTask?.id === task.id}
					{@const isDragOver = dragOverStatus === status && dragOverIndex === index}
					<Card
						class="group p-0 cursor-move hover:shadow-md transition-all overflow-hidden {getPriorityCardClass(task.priority || 'medium')} {isDragged
							? 'opacity-50'
							: ''} {isDragOver ? 'ring-2 ring-primary' : ''} {pickedUpTask?.id === task.id ? 'ring-2 ring-primary bg-primary/5' : ''}"
						draggable={true}
						tabindex={0}
						role="button"
						aria-roledescription="Draggable task"
						aria-label="{task.title}, {formatStatus(status)}, position {index + 1} of {statusTasks.length}"
						data-task-id={task.id}
						ondragstart={(e) => handleDragStart(e, task, status, index)}
						ondragend={handleDragEnd}
						onclick={() => onTaskClick(task)}
						onkeydown={(e) => handleCardKeyDown(e, task, status, index)}
					>
						<div class="p-3.5">
							<!-- Header: priority badge + title + menu -->
							<div class="flex items-start justify-between gap-2 mb-2">
								<div class="flex-1 min-w-0">
									<div class="flex items-center gap-1.5 mb-1">
										<span class="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded {getPriorityColor(task.priority || 'medium')}">
											{formatPriority(task.priority || 'medium')}
										</span>
									</div>
									<h4 class="font-medium text-sm leading-snug line-clamp-2">{task.title}</h4>
								</div>
								<DropdownMenu>
									<DropdownMenuTrigger>
										{#snippet child({props})}
										<Button {...props} variant="ghost" size="icon" class="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
											<MoreVerticalIcon class="h-3 w-3" />
										</Button>
										{/snippet}
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end">
										<DropdownMenuItem onclick={(e) => {
											e.stopPropagation();
											onEditTask(task);
										}}>
											Edit
										</DropdownMenuItem>
										<DropdownMenuItem
											class="text-destructive"
											onclick={(e) => {
												e.stopPropagation();
												onDeleteTask(task.id);
											}}
										>
											Delete
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							</div>

							<!-- Tags row: client + project -->
							{#if clientName || projectName}
								<div class="flex flex-wrap gap-1.5 mb-2.5">
									{#if clientName}
										<span class="inline-flex items-center gap-1 text-[11px] font-medium bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300 px-1.5 py-0.5 rounded">
											{clientName}
										</span>
									{/if}
									{#if projectName}
										<a
											href="/{tenantSlug}/projects/{task.projectId}"
											onclick={(e) => e.stopPropagation()}
											class="inline-flex items-center gap-1 text-[11px] font-medium bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 px-1.5 py-0.5 rounded hover:bg-blue-100 dark:hover:bg-blue-950/60 transition-colors"
										>
											{projectName}
										</a>
									{/if}
								</div>
							{/if}

							<!-- Dates row -->
							<div class="flex items-center gap-3 mb-2.5 text-[11px] text-muted-foreground">
								<span title="Due date">Due: {formatDueDate(task.dueDate)}</span>
								<span title="Created">Creat: {formatDate(task.createdAt, 'short')}</span>
							</div>

							<!-- Footer: assignee -->
							{#if assigneeName}
								<div class="flex items-center gap-1.5 text-xs text-muted-foreground">
									<div class="h-5 w-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-semibold shrink-0">
										{assigneeName.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)}
									</div>
									<span class="truncate max-w-[120px]">{assigneeName}</span>
								</div>
							{/if}
						</div>
					</Card>
				{/each}
				{#if dragOverStatus === status && dragOverIndex === statusTasks.length && draggedTask}
					<div class="h-2 border-2 border-dashed border-primary rounded"></div>
				{/if}
			</div>
		</div>
	{/each}
</div>
