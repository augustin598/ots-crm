<script lang="ts">
	import { createTask, getTasks } from '$lib/remotes/tasks.remote';
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
	import Combobox from '$lib/components/ui/combobox/combobox.svelte';
	import { getTaskFilters } from '$lib/components/task-filters-context';

	interface Props {
		open: boolean;
		onOpenChange: (open: boolean) => void;
		onSuccess?: () => void;
		defaultProjectId?: string;
		defaultClientId?: string;
		defaultMilestoneId?: string;
		defaultDueDate?: string;
		isClient?: boolean;
	}

	let { open, onOpenChange, onSuccess, defaultProjectId, defaultClientId, defaultMilestoneId, defaultDueDate, isClient = false }: Props = $props();

	// Get filterParams from context (set by parent page) or use empty object as fallback
	const filterParams = getTaskFilters();

	const clientsQuery = $derived(getClients());
	const clients = $derived(clientsQuery.current || []);
	const clientMap = $derived(new Map(clients.map((c) => [c.id, c.name])));

	const projectsQuery = $derived(getProjects(undefined));
	const projects = $derived(projectsQuery.current || []);
	const projectMap = $derived(new Map(projects.map((p) => [p.id, p.name])));

	const clientOptions = $derived([
		{ value: '', label: 'None' },
		...clients.map((c) => ({ value: c.id, label: c.name }))
	]);
	const projectOptions = $derived([
		{ value: '', label: 'None' },
		...projects.map((p) => ({ value: p.id, label: p.name }))
	]);

	const usersQuery = $derived(getTenantUsers());
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
	let clientId = $state(defaultClientId || '');
	let projectId = $state(defaultProjectId || '');
	let milestoneId = $state(defaultMilestoneId || '');
	let previousProjectId = $state(defaultProjectId || '');
	let status = $state(isClient ? 'pending-approval' : 'todo');
	let priority = $state('medium');
	let assignedToUserId = $state('');
	let dueDate = $state('');
	let loading = $state(false);
	let error = $state<string | null>(null);

	// Load milestones for selected project
	const milestonesQuery = $derived(
		projectId ? getMilestones(projectId) : null
	);
	const milestones = $derived(milestonesQuery?.current || []);
	const milestoneMap = $derived(new Map(milestones.map((m) => [m.id, m.name])));

	$effect(() => {
		if (open) {
			// Reset form when dialog opens
			title = '';
			description = '';
			clientId = defaultClientId || '';
			projectId = defaultProjectId || '';
			previousProjectId = defaultProjectId || '';
			milestoneId = defaultMilestoneId || '';
			status = isClient ? 'pending-approval' : 'todo';
			priority = 'medium';
			assignedToUserId = '';
			dueDate = defaultDueDate || '';
			error = null;
		}
	});

	$effect(() => {
		// Reset milestone when project changes
		if (projectId !== previousProjectId && previousProjectId !== '') {
			milestoneId = '';
		}
		previousProjectId = projectId;
	});

	async function handleSubmit() {
		if (!title.trim()) {
			error = 'Title is required';
			return;
		}

		loading = true;
		error = null;

		try {
			// Refresh getTasks query with the same filters as the page
			await createTask({
				title,
				description: description || undefined,
				clientId: clientId || undefined,
				projectId: projectId || undefined,
				milestoneId: milestoneId || undefined,
				status: status || undefined,
				priority: priority || undefined,
				dueDate: dueDate || undefined,
				assignedToUserId: assignedToUserId || undefined
			}).updates(getTasks(filterParams || {}));

			onOpenChange(false);
			onSuccess?.();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to create task';
		} finally {
			loading = false;
		}
	}
</script>

<Dialog bind:open onOpenChange={onOpenChange}>
	<DialogContent class="sm:max-w-[600px]">
		<DialogHeader>
			<DialogTitle>Create New Task</DialogTitle>
			<DialogDescription>Add a new task to a project</DialogDescription>
		</DialogHeader>
		<div class="grid gap-4 py-4">
			<div class="grid gap-2">
				<Label for="title">Task Title</Label>
				<Input id="title" bind:value={title} placeholder="Design homepage mockup" required />
			</div>
			<div class="grid gap-2">
				<Label for="description">Description</Label>
				<Textarea id="description" bind:value={description} placeholder="Add details about the task..." />
			</div>
			{#if !isClient}
				<div class="grid gap-2">
					<Label for="client">Client</Label>
					<Combobox
						bind:value={clientId}
						options={clientOptions}
						placeholder="Select a client (optional)"
						searchPlaceholder="Search clients..."
					/>
				</div>
			{/if}
			<div class="grid gap-2">
				<Label for="project">Project</Label>
				<Combobox
					bind:value={projectId}
					options={projectOptions}
					placeholder="Select a project (optional)"
					searchPlaceholder="Search projects..."
				/>
			</div>
			{#if projectId && milestones.length > 0}
				<div class="grid gap-2">
					<Label for="milestone">Milestone (Optional)</Label>
					<Select type="single" bind:value={milestoneId}>
						<SelectTrigger id="milestone">
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
				{#if !isClient}
					<div class="grid gap-2">
						<Label for="status">Status</Label>
						<Select type="single" bind:value={status}>
							<SelectTrigger id="status">
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
				{/if}
				<div class="grid gap-2">
					<Label for="priority">Priority</Label>
					<Select type="single" bind:value={priority}>
						<SelectTrigger id="priority">
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
				{#if !isClient}
					<div class="grid gap-2">
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
				{/if}
				<div class="grid gap-2">
					<Label for="dueDate">Due Date</Label>
					<Input id="dueDate" type="date" bind:value={dueDate} />
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
			<Button onclick={handleSubmit} disabled={loading}>
				{loading ? 'Creating...' : 'Create Task'}
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>
