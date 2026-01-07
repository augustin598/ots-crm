<script lang="ts">
	import { getTasks, createTask, deleteTask, updateTask } from '$lib/remotes/tasks.remote';
	import { getProjects } from '$lib/remotes/projects.remote';
	import { getTenantUsers } from '$lib/remotes/users.remote';
	import { getMilestones } from '$lib/remotes/milestones.remote';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Card } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import {
		Dialog,
		DialogContent,
		DialogDescription,
		DialogFooter,
		DialogHeader,
		DialogTitle,
		DialogTrigger
	} from '$lib/components/ui/dialog';
	import {
		DropdownMenu,
		DropdownMenuContent,
		DropdownMenuItem,
		DropdownMenuTrigger
	} from '$lib/components/ui/dropdown-menu';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import { Textarea } from '$lib/components/ui/textarea';
	import TaskDetailDialog from '$lib/components/task-detail-dialog.svelte';
	import EditTaskDialog from '$lib/components/edit-task-dialog.svelte';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import MoreVerticalIcon from '@lucide/svelte/icons/more-vertical';
	import type { Task } from '$lib/server/db/schema';

	const tenantSlug = $derived(page.params.tenant || '');

	const tasksQuery = getTasks({});
	const tasks = $derived(tasksQuery.current || []);
	const loading = $derived(tasksQuery.loading);

	const projectsQuery = getProjects(undefined);
	const projects = $derived(projectsQuery.current || []);

	const usersQuery = getTenantUsers();
	const users = $derived(usersQuery.current || []);

	// Create a map of project IDs to names
	const projectMap = $derived(new Map(projects.map((project) => [project.id, project.name])));
	const userMap = $derived(new Map(users.map((u) => [u.id, u.username])));

	let isDialogOpen = $state(false);
	let formTitle = $state('');
	let formDescription = $state('');
	let formProjectId = $state('');
	let formMilestoneId = $state('');
	let formStatus = $state('todo');
	let formPriority = $state('medium');
	let formAssignee = $state('');
	let formDueDate = $state('');
	let formLoading = $state(false);
	let formError = $state<string | null>(null);

	let selectedTask = $state<Task | null>(null);
	let isTaskDetailOpen = $state(false);
	let editingTask = $state<Task | null>(null);

	// Load milestones for selected project
	const milestonesQuery = $derived(
		formProjectId ? getMilestones(formProjectId) : null
	);
	const milestones = $derived(milestonesQuery?.current || []);
	const milestoneMap = $derived(new Map(milestones.map((m) => [m.id, m.name])));

	function getStatusColor(status: string) {
		switch (status) {
			case 'todo':
				return 'secondary';
			case 'in-progress':
				return 'default';
			case 'review':
				return 'outline';
			case 'done':
				return 'secondary';
			default:
				return 'secondary';
		}
	}

	function getPriorityColor(priority: string) {
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

	function formatStatus(status: string) {
		return status.replace('-', ' ');
	}

	const groupedTasks = $derived({
		todo: tasks.filter((t) => t.status === 'todo'),
		'in-progress': tasks.filter((t) => t.status === 'in-progress'),
		review: tasks.filter((t) => t.status === 'review'),
		done: tasks.filter((t) => t.status === 'done')
	});

	function handleTaskClick(task: Task) {
		selectedTask = task;
		isTaskDetailOpen = true;
	}

	async function handleCreateTask() {
		if (!formTitle) {
			formError = 'Title is required';
			return;
		}

		formLoading = true;
		formError = null;

		try {
			await createTask({
				title: formTitle,
				description: formDescription || undefined,
				projectId: formProjectId || undefined,
				milestoneId: formMilestoneId || undefined,
				status: formStatus || undefined,
				priority: formPriority || undefined,
				dueDate: formDueDate || undefined,
				assignedToUserId: formAssignee || undefined
			});

			// Reset form
			formTitle = '';
			formDescription = '';
			formProjectId = '';
			formMilestoneId = '';
			formStatus = 'todo';
			formPriority = 'medium';
			formAssignee = '';
			formDueDate = '';
			isDialogOpen = false;
		} catch (e) {
			formError = e instanceof Error ? e.message : 'Failed to create task';
		} finally {
			formLoading = false;
		}
	}

	async function handleDeleteTask(taskId: string) {
		if (!confirm('Are you sure you want to delete this task?')) {
			return;
		}

		try {
			await deleteTask(taskId);
			if (selectedTask?.id === taskId) {
				isTaskDetailOpen = false;
				selectedTask = null;
			}
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to delete task');
		}
	}

	async function handleMoveTask(task: Task, newStatus: string) {
		try {
			const dueDateStr = task.dueDate
				? typeof task.dueDate === 'string'
					? task.dueDate
					: new Date(task.dueDate).toISOString().split('T')[0]
				: undefined;

			await updateTask({
				taskId: task.id,
				title: task.title,
				description: task.description || undefined,
				projectId: task.projectId || undefined,
				clientId: task.clientId || undefined,
				milestoneId: task.milestoneId || undefined,
				status: newStatus,
				priority: task.priority || undefined,
				dueDate: dueDateStr,
				assignedToUserId: task.assignedToUserId || undefined
			});
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to move task');
		}
	}

	function handleEditTask(task: Task) {
		editingTask = task;
		isTaskDetailOpen = false;
	}

	function handleEditSuccess() {
		// Refresh tasks by re-running the query
		if (tasksQuery && 'refetch' in tasksQuery) {
			(tasksQuery as any).refetch();
		}
		if (selectedTask) {
			// Refresh selected task
			const updatedTask = tasks.find((t) => t.id === selectedTask?.id);
			if (updatedTask) {
				selectedTask = updatedTask;
				isTaskDetailOpen = true;
			}
		}
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
	<Dialog bind:open={isDialogOpen}>
		<DialogTrigger>
			<Button>
				<PlusIcon class="mr-2 h-4 w-4" />
				New Task
			</Button>
		</DialogTrigger>
		<DialogContent class="sm:max-w-[600px]">
			<DialogHeader>
				<DialogTitle>Create New Task</DialogTitle>
				<DialogDescription>Add a new task to a project</DialogDescription>
			</DialogHeader>
			<div class="grid gap-4 py-4">
				<div class="grid gap-2">
					<Label for="title">Task Title</Label>
					<Input id="title" bind:value={formTitle} placeholder="Design homepage mockup" />
				</div>
				<div class="grid gap-2">
					<Label for="description">Description</Label>
					<Textarea id="description" bind:value={formDescription} placeholder="Add details about the task..." />
				</div>
				<div class="grid gap-2">
					<Label for="project">Project</Label>
					<Select type="single" bind:value={formProjectId}>
						<SelectTrigger id="project">
							{#if formProjectId && projectMap.has(formProjectId)}
								{projectMap.get(formProjectId)}
							{:else}
								Select a project
							{/if}
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="">None</SelectItem>
							{#each projects as project}
								<SelectItem value={project.id}>{project.name}</SelectItem>
							{/each}
						</SelectContent>
					</Select>
				</div>
				{#if formProjectId && milestones.length > 0}
					<div class="grid gap-2">
						<Label for="milestone">Milestone (Optional)</Label>
						<Select type="single" bind:value={formMilestoneId}>
							<SelectTrigger id="milestone">
								{#if formMilestoneId && milestoneMap.has(formMilestoneId)}
									{milestoneMap.get(formMilestoneId)}
								{:else}
									Select a milestone
								{/if}
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="">None</SelectItem>
								{#each milestones as milestone}
									<SelectItem value={milestone.id}>{milestone.name}</SelectItem>
								{/each}
							</SelectContent>
						</Select>
					</div>
				{/if}
				<div class="grid grid-cols-2 gap-4">
					<div class="grid gap-2">
						<Label for="status">Status</Label>
						<Select type="single" bind:value={formStatus}>
							<SelectTrigger id="status">
								{#if formStatus === 'todo'}
									To Do
								{:else if formStatus === 'in-progress'}
									In Progress
								{:else if formStatus === 'review'}
									Review
								{:else if formStatus === 'done'}
									Done
								{:else}
									Select status
								{/if}
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="todo">To Do</SelectItem>
								<SelectItem value="in-progress">In Progress</SelectItem>
								<SelectItem value="review">Review</SelectItem>
								<SelectItem value="done">Done</SelectItem>
							</SelectContent>
						</Select>
					</div>
					<div class="grid gap-2">
						<Label for="priority">Priority</Label>
						<Select type="single" bind:value={formPriority}>
							<SelectTrigger id="priority">
								{#if formPriority === 'low'}
									Low
								{:else if formPriority === 'medium'}
									Medium
								{:else if formPriority === 'high'}
									High
								{:else if formPriority === 'urgent'}
									Urgent
								{:else}
									Select priority
								{/if}
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="low">Low</SelectItem>
								<SelectItem value="medium">Medium</SelectItem>
								<SelectItem value="high">High</SelectItem>
								<SelectItem value="urgent">Urgent</SelectItem>
							</SelectContent>
						</Select>
					</div>
				</div>
				<div class="grid grid-cols-2 gap-4">
					<div class="grid gap-2">
						<Label for="assignee">Assignee</Label>
						<Select type="single" bind:value={formAssignee}>
							<SelectTrigger id="assignee">
								{#if formAssignee && userMap.has(formAssignee)}
									{userMap.get(formAssignee)}
								{:else if formAssignee}
									{formAssignee.substring(0, 8)}...
								{:else}
									Select a user
								{/if}
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="">None</SelectItem>
								{#each users as user}
									<SelectItem value={user.id}>{user.username}</SelectItem>
								{/each}
							</SelectContent>
						</Select>
					</div>
					<div class="grid gap-2">
						<Label for="dueDate">Due Date</Label>
						<Input id="dueDate" type="date" bind:value={formDueDate} />
					</div>
				</div>
			</div>
			{#if formError}
				<div class="rounded-md bg-red-50 p-3">
					<p class="text-sm text-red-800">{formError}</p>
				</div>
			{/if}
			<DialogFooter>
				<Button variant="outline" onclick={() => (isDialogOpen = false)}>Cancel</Button>
				<Button onclick={handleCreateTask} disabled={formLoading}>
					{formLoading ? 'Creating...' : 'Create Task'}
				</Button>
			</DialogFooter>
		</DialogContent>
	</Dialog>
</div>

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
	<p>Loading tasks...</p>
{:else}
	<div class="grid gap-6 lg:grid-cols-4">
		{#each Object.entries(groupedTasks) as [status, statusTasks]}
			<div class="space-y-3">
				<div class="flex items-center justify-between">
					<h3 class="font-semibold capitalize">
						{formatStatus(status)} ({statusTasks.length})
					</h3>
				</div>
				<div class="space-y-3">
					{#each statusTasks as task}
						{@const projectName = task.projectId ? projectMap.get(task.projectId) || 'No project' : 'No project'}
						{@const formattedDueDate = task.dueDate
							? new Date(task.dueDate).toLocaleDateString()
							: 'No due date'}
						<Card
							class="p-4 cursor-pointer hover:shadow-md transition-shadow"
							onclick={() => handleTaskClick(task)}
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
									<DropdownMenuTrigger onclick={(e) => e.stopPropagation()}>
										<Button variant="ghost" size="icon" class="h-6 w-6">
											<MoreVerticalIcon class="h-3 w-3" />
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end">
										<DropdownMenuItem
											onclick={(e) => {
												e.stopPropagation();
												handleEditTask(task);
											}}
										>
											Edit
										</DropdownMenuItem>
										{#if status !== 'todo'}
											<DropdownMenuItem
												onclick={(e) => {
													e.stopPropagation();
													handleMoveTask(task, 'todo');
												}}
											>
												Move to To Do
											</DropdownMenuItem>
										{/if}
										{#if status !== 'in-progress'}
											<DropdownMenuItem
												onclick={(e) => {
													e.stopPropagation();
													handleMoveTask(task, 'in-progress');
												}}
											>
												Move to In Progress
											</DropdownMenuItem>
										{/if}
										{#if status !== 'review'}
											<DropdownMenuItem
												onclick={(e) => {
													e.stopPropagation();
													handleMoveTask(task, 'review');
												}}
											>
												Move to Review
											</DropdownMenuItem>
										{/if}
										{#if status !== 'done'}
											<DropdownMenuItem
												onclick={(e) => {
													e.stopPropagation();
													handleMoveTask(task, 'done');
												}}
											>
												Move to Done
											</DropdownMenuItem>
										{/if}
										<DropdownMenuItem
											class="text-destructive"
											onclick={(e) => {
												e.stopPropagation();
												handleDeleteTask(task.id);
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
									<p>Due: {formattedDueDate}</p>
									{#if task.assignedToUserId}
										<p class="mt-1">Assignee: {userMap.get(task.assignedToUserId) || task.assignedToUserId.substring(0, 8)}</p>
									{/if}
								</div>
							</div>
						</Card>
					{/each}
				</div>
			</div>
		{/each}
	</div>
{/if}

<TaskDetailDialog
	task={selectedTask}
	open={isTaskDetailOpen}
	onOpenChange={(open) => {
		isTaskDetailOpen = open;
		if (!open) selectedTask = null;
	}}
	{tenantSlug}
/>
