<script lang="ts">
	import {
		Table,
		TableBody,
		TableCell,
		TableHead,
		TableHeader,
		TableRow
	} from '$lib/components/ui/table';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import {
		DropdownMenu,
		DropdownMenuContent,
		DropdownMenuItem,
		DropdownMenuTrigger
	} from '$lib/components/ui/dropdown-menu';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import MoreVerticalIcon from '@lucide/svelte/icons/more-vertical';
	import ArrowUpDownIcon from '@lucide/svelte/icons/arrow-up-down';
	import RepeatIcon from '@lucide/svelte/icons/repeat';
	import type { Task } from '$lib/server/db/schema';
	import {
		formatStatus,
		getStatusColor,
		getStatusDotColor,
		getPriorityColor,
		getPriorityDotColor,
		formatPriority,
		TASK_STATUSES,
		TASK_PRIORITIES
	} from './task-kanban-utils';
	import { updateTaskStatus, updateTaskPriority, getTasks } from '$lib/remotes/tasks.remote';
	import { getTaskFilters } from '$lib/components/task-filters-context';
	import { toast } from 'svelte-sonner';
	import { clientLogger } from '$lib/client-logger';

	type TaskWithIncludes = Task & {
		subtaskCount?: number;
		subtaskDoneCount?: number;
	};

	type Props = {
		tasks: TaskWithIncludes[];
		projectMap: Map<string, string>;
		userMap: Map<string, string>;
		clientMap: Map<string, string>;
		tenantSlug: string;
		sortBy?: string | null;
		sortDir?: 'asc' | 'desc' | null;
		onSortChange: (sortBy: string, sortDir: 'asc' | 'desc') => void;
		onTaskClick: (task: Task) => void;
		onEditTask: (task: Task) => void;
		onDeleteTask: (taskId: string) => void;
		selectedIds?: Set<string>;
		onTaskSelectChange?: (taskId: string, selected: boolean) => void;
		onToggleSelectAll?: (selectAll: boolean) => void;
		showSelectionCheckbox?: boolean;
	};

	let {
		tasks,
		projectMap,
		userMap,
		clientMap,
		tenantSlug,
		sortBy = null,
		sortDir = 'asc',
		onSortChange,
		onTaskClick,
		onEditTask,
		onDeleteTask,
		selectedIds,
		onTaskSelectChange,
		onToggleSelectAll,
		showSelectionCheckbox = false
	}: Props = $props();

	const filterParams = getTaskFilters();

	// Optimistic local state for inline edits — keyed by taskId.
	// When the server confirms, the upstream getTasks() refresh clears it.
	let optimisticStatus = $state<Record<string, string>>({});
	let optimisticPriority = $state<Record<string, string>>({});
	let pendingTaskIds = $state<Record<string, boolean>>({});

	function handleSort(column: string) {
		const newSortDir = sortBy === column && sortDir === 'asc' ? 'desc' : 'asc';
		onSortChange(column, newSortDir);
	}

	function formatDueDate(date: Date | string | null): string {
		if (!date) return '-';
		const d = date instanceof Date ? date : new Date(date);
		return d.toLocaleDateString('ro-RO');
	}

	function formatCreatedDate(date: Date | string | null): string {
		if (!date) return '-';
		const d = date instanceof Date ? date : new Date(date);
		return d.toLocaleDateString('ro-RO');
	}

	function getSortIcon(column: string) {
		if (sortBy !== column) return '';
		return sortDir === 'asc' ? '↑' : '↓';
	}

	function effectiveStatus(t: TaskWithIncludes): string {
		return optimisticStatus[t.id] ?? t.status ?? 'todo';
	}
	function effectivePriority(t: TaskWithIncludes): string {
		return optimisticPriority[t.id] ?? t.priority ?? 'medium';
	}

	async function handleStatusChange(task: TaskWithIncludes, newStatus: string) {
		const oldStatus = task.status ?? 'todo';
		if (newStatus === oldStatus) return;

		// Optimistic
		optimisticStatus = { ...optimisticStatus, [task.id]: newStatus };
		pendingTaskIds = { ...pendingTaskIds, [task.id]: true };

		try {
			await updateTaskStatus({ taskId: task.id, newStatus: newStatus as any }).updates(
				getTasks({ ...(filterParams as any) })
			);
			toast.success('Status actualizat');
			// Clear optimistic on success — fresh data has it now
			const { [task.id]: _, ...restStatus } = optimisticStatus;
			optimisticStatus = restStatus;
		} catch (e) {
			// Revert
			const { [task.id]: _, ...restStatus } = optimisticStatus;
			optimisticStatus = restStatus;
			clientLogger.apiError('task_status_update', e);
			toast.error(e instanceof Error ? e.message : 'Eroare la actualizarea status-ului');
		} finally {
			const { [task.id]: __, ...restPending } = pendingTaskIds;
			pendingTaskIds = restPending;
		}
	}

	async function handlePriorityChange(task: TaskWithIncludes, newPriority: string) {
		const oldPriority = task.priority ?? 'medium';
		if (newPriority === oldPriority) return;

		optimisticPriority = { ...optimisticPriority, [task.id]: newPriority };
		pendingTaskIds = { ...pendingTaskIds, [task.id]: true };

		try {
			await updateTaskPriority({
				taskId: task.id,
				newPriority: newPriority as any
			}).updates(getTasks({ ...(filterParams as any) }));
			toast.success('Prioritate actualizată');
			const { [task.id]: _, ...restPriority } = optimisticPriority;
			optimisticPriority = restPriority;
		} catch (e) {
			const { [task.id]: _, ...restPriority } = optimisticPriority;
			optimisticPriority = restPriority;
			clientLogger.apiError('task_priority_update', e);
			toast.error(e instanceof Error ? e.message : 'Eroare la actualizarea priorității');
		} finally {
			const { [task.id]: __, ...restPending } = pendingTaskIds;
			pendingTaskIds = restPending;
		}
	}

	const allRowsSelected = $derived(
		tasks.length > 0 && tasks.every((t) => selectedIds?.has(t.id))
	);
</script>

<div class="overflow-x-auto rounded-md border">
	<Table>
		<TableHeader>
			<TableRow>
				{#if showSelectionCheckbox}
					<TableHead class="w-[40px]">
						<Checkbox
							checked={allRowsSelected}
							onCheckedChange={(v) => onToggleSelectAll?.(v === true)}
							aria-label="Select all visible tasks"
						/>
					</TableHead>
				{/if}
				<TableHead class="w-[300px]">
					<button
						class="flex items-center gap-2 hover:text-primary"
						onclick={() => handleSort('title')}
					>
						Title
						<ArrowUpDownIcon class="h-4 w-4" />
						{#if sortBy === 'title'}<span>{getSortIcon('title')}</span>{/if}
					</button>
				</TableHead>
				<TableHead class="w-[160px]">
					<button
						class="flex items-center gap-2 hover:text-primary"
						onclick={() => handleSort('status')}
					>
						Status
						<ArrowUpDownIcon class="h-4 w-4" />
						{#if sortBy === 'status'}<span>{getSortIcon('status')}</span>{/if}
					</button>
				</TableHead>
				<TableHead class="w-[130px]">
					<button
						class="flex items-center gap-2 hover:text-primary"
						onclick={() => handleSort('priority')}
					>
						Priority
						<ArrowUpDownIcon class="h-4 w-4" />
						{#if sortBy === 'priority'}<span>{getSortIcon('priority')}</span>{/if}
					</button>
				</TableHead>
				<TableHead class="w-[120px]">Subtasks</TableHead>
				<TableHead>Client</TableHead>
				<TableHead>Project</TableHead>
				<TableHead>Assignee</TableHead>
				<TableHead>
					<button
						class="flex items-center gap-2 hover:text-primary"
						onclick={() => handleSort('dueDate')}
					>
						Due Date
						<ArrowUpDownIcon class="h-4 w-4" />
						{#if sortBy === 'dueDate'}<span>{getSortIcon('dueDate')}</span>{/if}
					</button>
				</TableHead>
				<TableHead>
					<button
						class="flex items-center gap-2 hover:text-primary"
						onclick={() => handleSort('createdAt')}
					>
						Created
						<ArrowUpDownIcon class="h-4 w-4" />
						{#if sortBy === 'createdAt'}<span>{getSortIcon('createdAt')}</span>{/if}
					</button>
				</TableHead>
				<TableHead class="w-[50px]"></TableHead>
			</TableRow>
		</TableHeader>
		<TableBody>
			{#if tasks.length === 0}
				<TableRow>
					<TableCell
						colspan={showSelectionCheckbox ? 11 : 10}
						class="py-8 text-center text-muted-foreground"
					>
						No tasks found
					</TableCell>
				</TableRow>
			{:else}
				{#each tasks as task (task.id)}
					{@const projectName = task.projectId ? projectMap.get(task.projectId) || 'No project' : 'No project'}
					{@const currentStatus = effectiveStatus(task)}
					{@const currentPriority = effectivePriority(task)}
					{@const subDone = task.subtaskDoneCount ?? 0}
					{@const subTotal = task.subtaskCount ?? 0}
					{@const isPending = pendingTaskIds[task.id] === true}
					<TableRow
						class="cursor-pointer hover:bg-accent/50"
						onclick={() => onTaskClick(task)}
					>
						{#if showSelectionCheckbox}
							<TableCell onclick={(e) => e.stopPropagation()}>
								<Checkbox
									checked={selectedIds?.has(task.id) ?? false}
									onCheckedChange={(v) => onTaskSelectChange?.(task.id, v === true)}
									aria-label={`Select ${task.title}`}
								/>
							</TableCell>
						{/if}
						<TableCell class="max-w-[300px] truncate font-medium">
							<span class="inline-flex items-center gap-1.5">
								{#if task.isRecurring || task.recurringParentId}
									<RepeatIcon
										class="h-3.5 w-3.5 shrink-0 text-blue-600"
										aria-label="Task recurent"
									/>
								{/if}
								<span class="truncate">{task.title}</span>
							</span>
						</TableCell>

						<!-- Inline STATUS Select -->
						<TableCell onclick={(e) => e.stopPropagation()}>
							<Select
								type="single"
								value={currentStatus}
								onValueChange={(v) => v && handleStatusChange(task, v)}
								disabled={isPending}
							>
								<SelectTrigger
									class={`h-7 w-full justify-start gap-1.5 px-2 text-xs font-medium ${getStatusColor(currentStatus)} ${isPending ? 'opacity-60' : ''}`}
								>
									<span class={`h-1.5 w-1.5 rounded-full ${getStatusDotColor(currentStatus)}`}></span>
									{formatStatus(currentStatus)}
								</SelectTrigger>
								<SelectContent>
									{#each TASK_STATUSES as s (s)}
										{#if s !== 'cancelled'}
											<SelectItem value={s}>
												<span class="inline-flex items-center gap-2">
													<span class={`h-1.5 w-1.5 rounded-full ${getStatusDotColor(s)}`}></span>
													{formatStatus(s)}
												</span>
											</SelectItem>
										{/if}
									{/each}
								</SelectContent>
							</Select>
						</TableCell>

						<!-- Inline PRIORITY Select -->
						<TableCell onclick={(e) => e.stopPropagation()}>
							<Select
								type="single"
								value={currentPriority}
								onValueChange={(v) => v && handlePriorityChange(task, v)}
								disabled={isPending}
							>
								<SelectTrigger
									class={`h-7 w-full justify-start gap-1.5 px-2 text-xs font-medium ${getPriorityColor(currentPriority)} ${isPending ? 'opacity-60' : ''}`}
								>
									<span class={`h-1.5 w-1.5 rounded-full ${getPriorityDotColor(currentPriority)}`}></span>
									{formatPriority(currentPriority)}
								</SelectTrigger>
								<SelectContent>
									{#each TASK_PRIORITIES as p (p)}
										<SelectItem value={p}>
											<span class="inline-flex items-center gap-2">
												<span class={`h-1.5 w-1.5 rounded-full ${getPriorityDotColor(p)}`}></span>
												{formatPriority(p)}
											</span>
										</SelectItem>
									{/each}
								</SelectContent>
							</Select>
						</TableCell>

						<!-- Subtask progress -->
						<TableCell>
							{#if subTotal > 0}
								{@const pct = Math.round((subDone / subTotal) * 100)}
								<div class="flex flex-col gap-1">
									<div class="h-1 w-full overflow-hidden rounded-sm bg-[#f1f5f9]">
										<div
											class="h-full rounded-sm bg-gradient-to-r from-[#1877F2] to-[#60a5fa]"
											style:width={`${pct}%`}
										></div>
									</div>
									<span class="text-[10.5px] font-semibold text-[#94a3b8]">
										{subDone}/{subTotal}
									</span>
								</div>
							{:else}
								<span class="text-muted-foreground text-xs">—</span>
							{/if}
						</TableCell>

						<TableCell>
							{#if task.clientId}
								{clientMap.get(task.clientId) || '-'}
							{:else}
								<span class="text-muted-foreground">-</span>
							{/if}
						</TableCell>
						<TableCell>
							{#if task.projectId}
								<a
									href={`/${tenantSlug}/projects/${task.projectId}`}
									onclick={(e) => e.stopPropagation()}
									class="text-primary hover:underline"
								>
									{projectName}
								</a>
							{:else}
								<span class="text-muted-foreground">{projectName}</span>
							{/if}
						</TableCell>
						<TableCell>
							{#if task.assignedToUserId}
								{userMap.get(task.assignedToUserId) || task.assignedToUserId.substring(0, 8)}
							{:else}
								<span class="text-muted-foreground">-</span>
							{/if}
						</TableCell>
						<TableCell>{formatDueDate(task.dueDate)}</TableCell>
						<TableCell>{formatCreatedDate(task.createdAt)}</TableCell>
						<TableCell onclick={(e) => e.stopPropagation()}>
							<DropdownMenu>
								<DropdownMenuTrigger>
									<Button variant="ghost" size="icon" class="h-8 w-8">
										<MoreVerticalIcon class="h-4 w-4" />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end">
									<DropdownMenuItem onclick={() => onEditTask(task)}>Edit</DropdownMenuItem>
									<DropdownMenuItem
										class="text-destructive"
										onclick={() => onDeleteTask(task.id)}
									>
										Delete
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</TableCell>
					</TableRow>
				{/each}
			{/if}
		</TableBody>
	</Table>
</div>
