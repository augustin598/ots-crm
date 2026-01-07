<script lang="ts">
	import { updateTask } from '$lib/remotes/tasks.remote';
	import { getClients } from '$lib/remotes/clients.remote';
	import { getProjects } from '$lib/remotes/projects.remote';
	import { getTenantUsers } from '$lib/remotes/users.remote';
	import { getMilestones } from '$lib/remotes/milestones.remote';
	import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import type { Task } from '$lib/server/db/schema';

	interface Props {
		task: Task | null;
		open: boolean;
		onOpenChange: (open: boolean) => void;
		onSuccess?: () => void;
	}

	let { task, open, onOpenChange, onSuccess }: Props = $props();

	const clientsQuery = getClients();
	const clients = $derived(clientsQuery.current || []);

	const projectsQuery = getProjects(undefined);
	const projects = $derived(projectsQuery.current || []);

	const usersQuery = getTenantUsers();
	const users = $derived(usersQuery.current || []);
	const userMap = $derived(new Map(users.map((u) => [u.id, u.username])));

	let title = $state('');
	let description = $state('');
	let clientId = $state('');
	let projectId = $state('');
	let milestoneId = $state('');
	let status = $state('todo');
	let priority = $state('medium');
	let assignedToUserId = $state('');
	let dueDate = $state('');
	let saving = $state(false);
	let error = $state<string | null>(null);

	// Load milestones for selected project
	const milestonesQuery = $derived(
		projectId ? getMilestones(projectId) : null
	);
	const milestones = $derived(milestonesQuery?.current || []);
	const milestoneMap = $derived(new Map(milestones.map((m) => [m.id, m.name])));

	$effect(() => {
		if (task && open) {
			title = task.title || '';
			description = task.description || '';
			clientId = task.clientId || '';
			projectId = task.projectId || '';
			milestoneId = task.milestoneId || '';
			status = task.status || 'todo';
			priority = task.priority || 'medium';
			assignedToUserId = task.assignedToUserId || '';
			dueDate = task.dueDate ? new Date(task.dueDate).toISOString().split('T')[0] : '';
		}
	});

	$effect(() => {
		// Reset milestone when project changes
		if (projectId !== task?.projectId) {
			milestoneId = '';
		}
	});

	async function handleSubmit() {
		if (!task) return;

		if (!title.trim()) {
			error = 'Title is required';
			return;
		}

		saving = true;
		error = null;

		try {
			await updateTask({
				taskId: task.id,
				title,
				description: description || undefined,
				clientId: clientId || undefined,
				projectId: projectId || undefined,
				milestoneId: milestoneId || undefined,
				status: status || undefined,
				priority: priority || undefined,
				assignedToUserId: assignedToUserId || undefined,
				dueDate: dueDate || undefined
			});

			onOpenChange(false);
			onSuccess?.();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to update task';
		} finally {
			saving = false;
		}
	}
</script>

<Dialog bind:open onOpenChange={onOpenChange}>
	<DialogContent class="sm:max-w-[600px]">
		{#if task}
			<DialogHeader>
				<DialogTitle>Edit Task</DialogTitle>
				<DialogDescription>Update task details</DialogDescription>
			</DialogHeader>
			<div class="grid gap-4 py-4">
				<div class="grid gap-2">
					<Label for="edit-title">Task Title</Label>
					<Input id="edit-title" bind:value={title} placeholder="Design homepage mockup" required />
				</div>
				<div class="grid gap-2">
					<Label for="edit-description">Description</Label>
					<Textarea id="edit-description" bind:value={description} placeholder="Add details about the task..." />
				</div>
				<div class="grid gap-2">
					<Label for="edit-project">Project</Label>
					<Select type="single" bind:value={projectId}>
						<SelectTrigger id="edit-project">
							{#if projectId && projects.find((p) => p.id === projectId)}
								{projects.find((p) => p.id === projectId)?.name}
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
				{#if projectId && milestones.length > 0}
					<div class="grid gap-2">
						<Label for="edit-milestone">Milestone (Optional)</Label>
						<Select type="single" bind:value={milestoneId}>
							<SelectTrigger id="edit-milestone">
								{#if milestoneId && milestoneMap.has(milestoneId)}
									{milestoneMap.get(milestoneId)}
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
						<Label for="edit-status">Status</Label>
						<Select type="single" bind:value={status}>
							<SelectTrigger id="edit-status">
								{#if status === 'todo'}
									To Do
								{:else if status === 'in-progress'}
									In Progress
								{:else if status === 'review'}
									Review
								{:else if status === 'done'}
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
						<Label for="edit-priority">Priority</Label>
						<Select type="single" bind:value={priority}>
							<SelectTrigger id="edit-priority">
								{#if priority === 'low'}
									Low
								{:else if priority === 'medium'}
									Medium
								{:else if priority === 'high'}
									High
								{:else if priority === 'urgent'}
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
						<Label for="edit-assignee">Assignee</Label>
						<Select type="single" bind:value={assignedToUserId}>
							<SelectTrigger id="edit-assignee">
								{#if assignedToUserId && userMap.has(assignedToUserId)}
									{userMap.get(assignedToUserId)}
								{:else if assignedToUserId}
									{assignedToUserId.substring(0, 8)}...
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
						<Label for="edit-dueDate">Due Date</Label>
						<Input id="edit-dueDate" type="date" bind:value={dueDate} />
					</div>
				</div>
			</div>
			{#if error}
				<div class="rounded-md bg-red-50 p-3">
					<p class="text-sm text-red-800">{error}</p>
				</div>
			{/if}
			<DialogFooter>
				<Button variant="outline" onclick={() => onOpenChange(false)}>Cancel</Button>
				<Button onclick={handleSubmit} disabled={saving}>
					{saving ? 'Saving...' : 'Save Changes'}
				</Button>
			</DialogFooter>
		{/if}
	</DialogContent>
</Dialog>
