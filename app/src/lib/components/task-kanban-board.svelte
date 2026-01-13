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
	import { formatStatus } from './task-kanban-utils';
	import { getTaskFilters } from '$lib/components/task-filters-context';

	type Props = {
		tasks: Task[];
		projectMap: Map<string, string>;
		userMap: Map<string, string>;
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
				newStatus,
				newPosition,
				oldStatus,
				oldPosition: oldIndex
			}).updates(getTasks(filterParams || {}));
			onTasksUpdate?.();
		} catch (error) {
			// Rollback on error
			optimisticTasks = tasks;
			alert(error instanceof Error ? error.message : 'Failed to update task position');
		}
	}

	function formatDueDate(date: Date | string | null): string {
		if (!date) return 'No due date';
		const d = date instanceof Date ? date : new Date(date);
		return d.toLocaleDateString('ro-RO', { month: 'short', day: 'numeric' });
	}

	function getPriorityColor(priority: string | null): string {
		switch (priority) {
			case 'urgent':
				return 'bg-red-100 text-red-700';
			case 'high':
				return 'bg-orange-100 text-orange-700';
			case 'medium':
				return 'bg-blue-100 text-blue-700';
			case 'low':
				return 'bg-gray-100 text-gray-700';
			default:
				return 'bg-gray-100 text-gray-700';
		}
	}
</script>

<div class="grid gap-6 lg:grid-cols-4 overflow-x-auto pb-4">
	{#each STATUSES as status}
		{@const statusTasks = groupedTasks[status] || []}
		<div class="flex flex-col min-w-[280px]">
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
					{@const projectName = task.projectId ? projectMap.get(task.projectId) || 'No project' : 'No project'}
					{@const isDragged = draggedTask?.id === task.id}
					{@const isDragOver = dragOverStatus === status && dragOverIndex === index}
					<Card
						class="p-4 cursor-move hover:shadow-md transition-all {isDragged
							? 'opacity-50'
							: ''} {isDragOver ? 'ring-2 ring-primary' : ''}"
						draggable={true}
						ondragstart={(e) => handleDragStart(e, task, status, index)}
						ondragend={handleDragEnd}
						onclick={() => onTaskClick(task)}
					>
						<div class="flex items-start justify-between mb-3">
							<div class="flex-1">
								<h4 class="font-medium text-sm mb-1">{task.title}</h4>
								{#if task.projectId}
									<a
										href="/{tenantSlug}/projects/{task.projectId}"
										onclick={(e) => e.stopPropagation()}
										class="text-xs text-muted-foreground hover:text-primary"
									>
										{projectName}
									</a>
								{:else}
									<p class="text-xs text-muted-foreground">{projectName}</p>
								{/if}
							</div>
							<DropdownMenu>
								<DropdownMenuTrigger>
									{#snippet child({props})}
									<Button {...props} variant="ghost" size="icon" class="h-6 w-6">
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

						<div class="space-y-2">
							<div class="flex items-center gap-2">
								<span class={`text-xs font-medium px-2 py-1 rounded ${getPriorityColor(task.priority || 'medium')}`}>
									{task.priority || 'medium'}
								</span>
							</div>
							<div class="text-xs text-muted-foreground">
								<p>Due: {formatDueDate(task.dueDate)}</p>
								{#if task.assignedToUserId}
									<p class="mt-1">Assignee: {userMap.get(task.assignedToUserId) || task.assignedToUserId.substring(0, 8)}</p>
								{/if}
							</div>
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
