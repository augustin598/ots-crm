<script lang="ts">
	import { getClients } from '$lib/remotes/clients.remote';
	import { getProjects } from '$lib/remotes/projects.remote';
	import { createTask } from '$lib/remotes/tasks.remote';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import { FormSection } from '$lib/components/app/form-section';
	import { Progress } from '$lib/components/ui/progress/index';

	const tenantSlug = $derived(page.params.tenant);
	const clientsQuery = getClients();
	const clients = $derived(clientsQuery.current || []);
	const projectsQuery = getProjects(undefined);
	const projects = $derived(projectsQuery.current || []);

	let title = $state('');
	let description = $state('');
	let clientId = $state('');
	let projectId = $state('');
	let status = $state('todo');
	let priority = $state('medium');
	let dueDate = $state('');
	let loading = $state(false);
	let error = $state<string | null>(null);

	// Section completion states
	let basicInfoCompleted = $derived(!!title);
	let assignmentCompleted = $derived(!!(clientId || projectId));
	let detailsCompleted = $derived(!!(status || priority || dueDate));

	const completedSections = $derived(
		(basicInfoCompleted ? 1 : 0) + (assignmentCompleted ? 1 : 0) + (detailsCompleted ? 1 : 0)
	);
	const totalSections = 3;
	const progress = $derived((completedSections / totalSections) * 100);

	async function handleSubmit() {
		if (!title) {
			error = 'Title is required';
			return;
		}

		loading = true;
		error = null;

		try {
			const result = await createTask({
				title,
				description: description || undefined,
				clientId: clientId || undefined,
				projectId: projectId || undefined,
				status: status || undefined,
				priority: priority || undefined,
				dueDate: dueDate || undefined
			});

			if (result.success) {
				goto(`/${tenantSlug}/tasks`);
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to create task';
		} finally {
			loading = false;
		}
	}
</script>

<div class="space-y-6">
	<h1 class="text-3xl font-bold">New Task</h1>

	<Card>
		<CardHeader>
			<CardTitle>Task Information</CardTitle>
			<CardDescription>Create a new task</CardDescription>
			<div class="mt-4 space-y-2">
				<div class="flex items-center justify-between text-sm">
					<span class="text-muted-foreground">Progress</span>
					<span class="font-medium">{completedSections} of {totalSections} sections completed</span>
				</div>
				<Progress value={progress} class="h-2" />
			</div>
		</CardHeader>
		<CardContent>
			<form
				onsubmit={(e) => {
					e.preventDefault();
					handleSubmit();
				}}
				class="space-y-4"
			>
				<FormSection
					title="Basic Information"
					description="Task title and description"
					bind:completed={basicInfoCompleted}
					defaultOpen={true}
				>
					<div class="space-y-4">
						<div class="space-y-2">
							<Label for="title">Title *</Label>
							<Input id="title" bind:value={title} type="text" required />
						</div>
						<div class="space-y-2">
							<Label for="description">Description</Label>
							<Textarea id="description" bind:value={description} />
						</div>
					</div>
				</FormSection>

				<FormSection
					title="Assignment"
					description="Link to client or project"
					bind:completed={assignmentCompleted}
					defaultOpen={false}
				>
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
				</FormSection>

				<FormSection
					title="Task Details"
					description="Status, priority, and due date"
					bind:completed={detailsCompleted}
					defaultOpen={false}
				>
					<div class="space-y-4">
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
					</div>
				</FormSection>

				{#if error}
					<div class="rounded-md bg-red-50 p-3">
						<p class="text-sm text-red-800">{error}</p>
					</div>
				{/if}

				<div class="flex items-center justify-end gap-4">
					<Button type="button" variant="outline" onclick={() => goto(`/${tenantSlug}/tasks`)}>
						Cancel
					</Button>
					<Button type="submit" disabled={loading}>
						{loading ? 'Creating...' : 'Create Task'}
					</Button>
				</div>
			</form>
		</CardContent>
	</Card>
</div>
