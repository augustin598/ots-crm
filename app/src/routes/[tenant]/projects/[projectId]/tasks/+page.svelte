<script lang="ts">
	import { getTasks, updateTask, deleteTask } from '$lib/remotes/tasks.remote';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Card } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import {
		Dialog,
		DialogContent,
		DialogDescription,
		DialogFooter,
		DialogHeader,
		DialogTitle
	} from '$lib/components/ui/dialog';
	import {
		DropdownMenu,
		DropdownMenuContent,
		DropdownMenuItem,
		DropdownMenuTrigger
	} from '$lib/components/ui/dropdown-menu';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import CreateTaskDialog from '$lib/components/create-task-dialog.svelte';
	import { formatStatus, getStatusBadgeVariant } from '$lib/components/task-kanban-utils';
	import { Plus, Calendar, Users, MoreVertical } from '@lucide/svelte';

	const tenantSlug = $derived(page.params.tenant);
	const projectId = $derived(page.params.projectId);

	const tasksQuery = $derived(getTasks({ projectId }));
	const tasks = $derived(tasksQuery.current || []);
	const loading = $derived(tasksQuery.loading);

	let statusDialogOpen = $state(false);
	let selectedTaskId = $state<string | null>(null);
	let newStatus = $state('todo');
	let isCreateDialogOpen = $state(false);

	function getPriorityBadgeVariant(priority: string) {
		switch (priority) {
			case 'urgent':
				return 'destructive';
			case 'high':
				return 'default';
			case 'medium':
				return 'secondary';
			default:
				return 'outline';
		}
	}


	async function handleChangeStatus(taskId: string) {
		selectedTaskId = taskId;
		const task = tasks.find((t: { id: string }) => t.id === taskId);
		if (task) {
			newStatus = task.status;
		}
		statusDialogOpen = true;
	}

	async function handleSaveStatus() {
		if (!selectedTaskId) return;

		const task = tasks.find((t: { id: string }) => t.id === selectedTaskId);
		if (!task) return;

		try {
			await updateTask({
				taskId: selectedTaskId,
				title: task.title,
				status: newStatus as 'done' | 'todo' | 'in-progress' | 'review' | 'cancelled' | 'pending-approval'
			}).updates(getTasks({ projectId }));
			statusDialogOpen = false;
			selectedTaskId = null;
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to update task status');
		}
	}

	async function handleDeleteTask(taskId: string) {
		if (!confirm('Are you sure you want to delete this task?')) {
			return;
		}

		try {
			await deleteTask(taskId).updates(getTasks({ projectId }));
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to delete task');
		}
	}

	function handleCreateSuccess() {
		// Tasks will be refreshed automatically via .updates() in the dialog
	}
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h2 class="text-2xl font-semibold">Tasks</h2>
		<Button onclick={() => (isCreateDialogOpen = true)}>
			<Plus class="h-4 w-4 mr-2" />
			New Task
		</Button>
	</div>

	{#if loading}
		<p>Loading...</p>
	{:else if tasks.length === 0}
		<Card class="p-4">
			<p class="text-muted-foreground">No tasks for this project yet.</p>
		</Card>
	{:else}
		<div class="space-y-3">
			{#each tasks as task}
				<Card class="p-4">
					<div class="flex items-start justify-between">
						<div class="flex-1">
							<div class="flex items-center gap-3 mb-2">
								<h4 class="font-semibold">{task.title}</h4>
								{#if task.priority}
									<Badge variant={getPriorityBadgeVariant(task.priority)}>
										{task.priority}
									</Badge>
								{/if}
								<Badge variant={getStatusBadgeVariant(task.status)}>{formatStatus(task.status)}</Badge>
							</div>
							{#if task.description}
								<p class="text-sm text-muted-foreground mb-3">{task.description}</p>
							{/if}
							<div class="flex items-center gap-4 text-sm text-muted-foreground">
								{#if task.assignedToUserId}
									<div class="flex items-center gap-1">
										<Users class="h-4 w-4" />
										<span>{task.assignedToUserId.substring(0, 8)}</span>
									</div>
								{/if}
								{#if task.dueDate}
									<div class="flex items-center gap-1">
										<Calendar class="h-4 w-4" />
										<span>Due: {new Date(task.dueDate).toLocaleDateString()}</span>
									</div>
								{/if}
							</div>
						</div>
						<DropdownMenu>
							<DropdownMenuTrigger>
								{#snippet child({ props })}
									<Button {...props} variant="ghost" size="icon">
										<MoreVertical class="h-4 w-4" />
									</Button>
								{/snippet}
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								<DropdownMenuItem onclick={() => goto(`/${tenantSlug}/tasks/${task.id}`)}>
									View Details
								</DropdownMenuItem>
								<DropdownMenuItem onclick={() => goto(`/${tenantSlug}/tasks/${task.id}/edit`)}>
									Edit
								</DropdownMenuItem>
								<DropdownMenuItem onclick={() => handleChangeStatus(task.id)}>Change Status</DropdownMenuItem>
								<DropdownMenuItem class="text-destructive" onclick={() => handleDeleteTask(task.id)}>
									Delete
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</Card>
			{/each}
		</div>
	{/if}
</div>

<Dialog bind:open={statusDialogOpen}>
	<DialogContent>
		<DialogHeader>
			<DialogTitle>Change Task Status</DialogTitle>
			<DialogDescription>Update the status of this task</DialogDescription>
		</DialogHeader>
		<div class="grid gap-4 py-4">
			<div class="grid gap-2">
				<p class="text-sm font-medium">Status</p>
				<Select type="single" bind:value={newStatus}>
					<SelectTrigger>
						{#if newStatus === 'todo'}
							Todo
						{:else if newStatus === 'in-progress'}
							In Progress
						{:else if newStatus === 'review'}
							Review
						{:else if newStatus === 'done'}
							Done
						{:else if newStatus === 'cancelled'}
							Cancelled
						{:else}
							Select status
						{/if}
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="todo">Todo</SelectItem>
						<SelectItem value="in-progress">In Progress</SelectItem>
						<SelectItem value="review">Review</SelectItem>
						<SelectItem value="done">Done</SelectItem>
						<SelectItem value="cancelled">Cancelled</SelectItem>
					</SelectContent>
				</Select>
			</div>
		</div>
		<DialogFooter>
			<Button variant="outline" onclick={() => (statusDialogOpen = false)}>Cancel</Button>
			<Button onclick={handleSaveStatus}>Save</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>

<CreateTaskDialog
	open={isCreateDialogOpen}
	onOpenChange={(open) => {
		isCreateDialogOpen = open;
	}}
	onSuccess={handleCreateSuccess}
	defaultProjectId={projectId}
/>
