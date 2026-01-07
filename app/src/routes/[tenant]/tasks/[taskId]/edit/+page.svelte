<script lang="ts">
	import { getTask, updateTask } from '$lib/remotes/tasks.remote';
	import { getClients } from '$lib/remotes/clients.remote';
	import { getProjects } from '$lib/remotes/projects.remote';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';

	const tenantSlug = $derived(page.params.tenant);
	const taskId = $derived(page.params.taskId);

	const taskQuery = getTask(taskId);
	const task = $derived(taskQuery.current);
	const clientsQuery = getClients();
	const clients = $derived(clientsQuery.current || []);
	const projectsQuery = getProjects();
	const projects = $derived(projectsQuery.current || []);

	let title = $state('');
	let description = $state('');
	let clientId = $state('');
	let projectId = $state('');
	let status = $state('todo');
	let priority = $state('medium');
	let dueDate = $state('');
	let saving = $state(false);
	let error = $state<string | null>(null);

	$effect(() => {
		if (task) {
			title = task.title || '';
			description = task.description || '';
			clientId = task.clientId || '';
			projectId = task.projectId || '';
			status = task.status || 'todo';
			priority = task.priority || 'medium';
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
				status: status || undefined,
				priority: priority || undefined,
				dueDate: dueDate || undefined
			});

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
							<Select type="single" bind:value={clientId}>
								<SelectTrigger>
									{#if clientId}
										{clients.find((c) => c.id === clientId)?.name || 'Select a client'}
									{:else}
										Select a client
									{/if}
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="">None</SelectItem>
									{#each clients as client}
										<SelectItem value={client.id}>{client.name}</SelectItem>
									{/each}
								</SelectContent>
							</Select>
						</div>
						<div class="space-y-2">
							<Label for="projectId">Project</Label>
							<Select type="single" bind:value={projectId}>
								<SelectTrigger>
									{#if projectId}
										{projects.find((p) => p.id === projectId)?.name || 'Select a project'}
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
					</div>
					<div class="grid grid-cols-2 gap-4">
						<div class="space-y-2">
							<Label for="status">Status</Label>
							<Select type="single" bind:value={status}>
								<SelectTrigger>
									{#if status === 'todo'}
										To Do
									{:else if status === 'in-progress'}
										In Progress
									{:else if status === 'done'}
										Done
									{:else if status === 'cancelled'}
										Cancelled
									{:else}
										Select status
									{/if}
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="todo">To Do</SelectItem>
									<SelectItem value="in-progress">In Progress</SelectItem>
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
					<div class="space-y-2">
						<Label for="dueDate">Due Date</Label>
						<Input id="dueDate" bind:value={dueDate} type="date" />
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
