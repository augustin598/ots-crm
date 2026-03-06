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
	import {
		DropdownMenu,
		DropdownMenuContent,
		DropdownMenuItem,
		DropdownMenuTrigger
	} from '$lib/components/ui/dropdown-menu';
	import MoreVerticalIcon from '@lucide/svelte/icons/more-vertical';
	import ArrowUpDownIcon from '@lucide/svelte/icons/arrow-up-down';
	import type { Task } from '$lib/server/db/schema';
	import { formatStatus, getStatusColor } from './task-kanban-utils';
	import { formatPriority, getPriorityColor } from '$lib/utils/task-filters';

	type Props = {
		tasks: Task[];
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
		onDeleteTask
	}: Props = $props();

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

</script>

<div class="rounded-md border overflow-x-auto">
	<Table>
		<TableHeader>
			<TableRow>
				<TableHead class="w-[300px]">
					<button
						class="flex items-center gap-2 hover:text-primary"
						onclick={() => handleSort('title')}
					>
						Title
						<ArrowUpDownIcon class="h-4 w-4" />
						{#if sortBy === 'title'}
							<span>{getSortIcon('title')}</span>
						{/if}
					</button>
				</TableHead>
				<TableHead>
					<button
						class="flex items-center gap-2 hover:text-primary"
						onclick={() => handleSort('status')}
					>
						Status
						<ArrowUpDownIcon class="h-4 w-4" />
						{#if sortBy === 'status'}
							<span>{getSortIcon('status')}</span>
						{/if}
					</button>
				</TableHead>
				<TableHead>
					<button
						class="flex items-center gap-2 hover:text-primary"
						onclick={() => handleSort('priority')}
					>
						Priority
						<ArrowUpDownIcon class="h-4 w-4" />
						{#if sortBy === 'priority'}
							<span>{getSortIcon('priority')}</span>
						{/if}
					</button>
				</TableHead>
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
						{#if sortBy === 'dueDate'}
							<span>{getSortIcon('dueDate')}</span>
						{/if}
					</button>
				</TableHead>
				<TableHead>
					<button
						class="flex items-center gap-2 hover:text-primary"
						onclick={() => handleSort('createdAt')}
					>
						Created
						<ArrowUpDownIcon class="h-4 w-4" />
						{#if sortBy === 'createdAt'}
							<span>{getSortIcon('createdAt')}</span>
						{/if}
					</button>
				</TableHead>
				<TableHead class="w-[50px]"></TableHead>
			</TableRow>
		</TableHeader>
		<TableBody>
			{#if tasks.length === 0}
				<TableRow>
					<TableCell colspan="9" class="text-center text-muted-foreground py-8">
						No tasks found
					</TableCell>
				</TableRow>
			{:else}
				{#each tasks as task}
					{@const projectName = task.projectId ? projectMap.get(task.projectId) || 'No project' : 'No project'}
					<TableRow class="cursor-pointer hover:bg-accent/50" onclick={() => onTaskClick(task)}>
						<TableCell class="font-medium max-w-[300px] truncate">{task.title}</TableCell>
						<TableCell>
							<span class={`text-xs font-medium px-2 py-1 rounded capitalize ${getStatusColor(task.status || 'todo')}`}>
								{formatStatus(task.status || 'todo')}
							</span>
						</TableCell>
						<TableCell>
							<span class={`text-xs font-medium px-2 py-1 rounded ${getPriorityColor(task.priority || 'medium')}`}>
								{formatPriority(task.priority || 'medium')}
							</span>
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
									href="/{tenantSlug}/projects/{task.projectId}"
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
