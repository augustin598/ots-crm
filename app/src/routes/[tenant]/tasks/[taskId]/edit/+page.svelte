<script lang="ts">
	import { getTask, updateTask, getTasks } from '$lib/remotes/tasks.remote';
	import { getClients } from '$lib/remotes/clients.remote';
	import { getProjects } from '$lib/remotes/projects.remote';
	import { getTenantUsers } from '$lib/remotes/users.remote';
	import { getMilestones } from '$lib/remotes/milestones.remote';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import Combobox from '$lib/components/ui/combobox/combobox.svelte';

	const tenantSlug = $derived(page.params.tenant);
	const taskId = $derived(page.params.taskId ?? '');

	const taskQuery = getTask(taskId);
	const task = $derived(taskQuery.current);
	const clientsQuery = getClients();
	const clients = $derived(clientsQuery.current || []);
	const projectsQuery = getProjects(undefined);
	const projects = $derived(projectsQuery.current || []);

	const clientOptions = $derived([
		{ value: '', label: 'None' },
		...clients.map((c) => ({ value: c.id, label: c.name }))
	]);
	const projectOptions = $derived([
		{ value: '', label: 'None' },
		...projects.map((p) => ({ value: p.id, label: p.name }))
	]);
	const usersQuery = getTenantUsers();
	const users = $derived(usersQuery.current || []);
	const userMap = $derived(
		new Map(
			users.map((u) => [
				u.id,
				`${u.firstName} ${u.lastName}`.trim() || u.email
			])
		)
	);

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
		if (task) {
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

	async function handleSubmit() {
		saving = true;
		error = null;

		try {
			await updateTask({
				taskId,
				title,
				description: description || undefined,
				clientId: clientId || undefined,
				projectId: projectId || undefined,
				milestoneId: milestoneId || undefined,
				status: status || undefined,
				priority: priority || undefined,
				assignedToUserId: assignedToUserId || undefined,
				dueDate: dueDate || undefined
			}).updates(taskQuery, getTask(taskId), getTasks({}));

			goto(`/${tenantSlug}/tasks/${taskId}`);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to update task';
		} finally {
			saving = false;
		}
	}
</script>

<div class="space-y-6">
	{#if task}
		<h1 class="text-3xl font-bold">Edit Task</h1>

		<Card>
			<CardHeader>
				<CardTitle>Task Information</CardTitle>
				<CardDescription>Update task details</CardDescription>
			</CardHeader>
			<CardContent>
				<form
					onsubmit={(e) => {
						e.preventDefault();
						handleSubmit();
					}}
					class="space-y-4"
				>
					<div class="space-y-2">
						<Label for="title">Title *</Label>
						<Input id="title" bind:value={title} type="text" required />
					</div>
					<div class="space-y-2">
						<Label for="description">Description</Label>
						<Textarea id="description" bind:value={description} />
					</div>
					<div class="grid grid-cols-2 gap-4">
						<div class="space-y-2">
							<Label for="clientId">Client</Label>
							<Combobox
								bind:value={clientId}
								options={clientOptions}
								placeholder="Select a client (optional)"
								searchPlaceholder="Search clients..."
							/>
						</div>
						<div class="space-y-2">
							<Label for="projectId">Project</Label>
							<Combobox
								bind:value={projectId}
								options={projectOptions}
								placeholder="Select a project (optional)"
								searchPlaceholder="Search projects..."
							/>
						</div>
					</div>
					{#if projectId && milestones.length > 0}
						<div class="space-y-2">
							<Label for="milestoneId">Milestone</Label>
							<Select type="single" bind:value={milestoneId}>
								<SelectTrigger>
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
						<div class="space-y-2">
							<Label for="status">Status</Label>
							<Select type="single" bind:value={status}>
								<SelectTrigger>
									{#if status === 'pending-approval'}
										Pending Approval
									{:else if status === 'todo'}
										To Do
									{:else if status === 'in-progress'}
										In Progress
									{:else if status === 'review'}
										Review
									{:else if status === 'done'}
										Done
									{:else if status === 'cancelled'}
										Cancelled
									{:else}
										Select status
									{/if}
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="pending-approval">Pending Approval</SelectItem>
									<SelectItem value="todo">To Do</SelectItem>
									<SelectItem value="in-progress">In Progress</SelectItem>
									<SelectItem value="review">Review</SelectItem>
									<SelectItem value="done">Done</SelectItem>
									<SelectItem value="cancelled">Cancelled</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div class="space-y-2">
							<Label for="priority">Priority</Label>
							<Select type="single" bind:value={priority}>
								<SelectTrigger>
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
						<div class="space-y-2">
							<Label for="assignee">Assignee</Label>
							<Select type="single" bind:value={assignedToUserId}>
								<SelectTrigger id="assignee">
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
										<SelectItem value={user.id}>
											{`${user.firstName} ${user.lastName}`.trim() || user.email}
										</SelectItem>
									{/each}
								</SelectContent>
							</Select>
						</div>
						<div class="space-y-2">
							<Label for="dueDate">Due Date</Label>
							<Input id="dueDate" bind:value={dueDate} type="date" />
						</div>
					</div>

					{#if error}
						<div class="rounded-md bg-red-50 p-3">
							<p class="text-sm text-red-800">{error}</p>
						</div>
					{/if}

					<div class="flex items-center justify-end gap-4">
						<Button type="button" variant="outline" onclick={() => goto(`/${tenantSlug}/tasks/${taskId}`)}>
							Cancel
						</Button>
						<Button type="submit" disabled={saving}>
							{saving ? 'Saving...' : 'Save Changes'}
						</Button>
					</div>
				</form>
			</CardContent>
		</Card>
	{/if}
</div>
