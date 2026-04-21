<script lang="ts">
	import { updateTask, getTasks, getTask, getCompletedTasks } from '$lib/remotes/tasks.remote';
	import { getClients } from '$lib/remotes/clients.remote';
	import { getProjects } from '$lib/remotes/projects.remote';
	import { getTenantUsers } from '$lib/remotes/users.remote';
	import { getMilestones } from '$lib/remotes/milestones.remote';
	import { DialogFooter } from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import * as Popover from '$lib/components/ui/popover';
	import { Calendar } from '$lib/components/ui/calendar';
	import Combobox from '$lib/components/ui/combobox/combobox.svelte';
	import type { Task } from '$lib/server/db/schema';
	import { getTaskFilters } from '$lib/components/task-filters-context';
	import { getPriorityDotColor, getStatusDotColor } from '$lib/components/task-kanban-utils';
	import { CalendarDate, type DateValue } from '@internationalized/date';
	import CalendarIcon from '@lucide/svelte/icons/calendar';

	interface Props {
		task: Task;
		onSuccess?: () => void;
		onCancel?: () => void;
		additionalQueriesToUpdate?: any[];
	}

	let { task, onSuccess, onCancel, additionalQueriesToUpdate = [] }: Props = $props();

	// Get filterParams from context (set by parent page) or use empty object as fallback
	const filterParams = getTaskFilters();

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
		new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim() || u.email]))
	);

	let title = $state('');
	let description = $state('');
	let clientId = $state('');
	let projectId = $state('');
	let previousProjectId = $state('');
	let milestoneId = $state('');
	let status = $state('todo');
	let priority = $state('medium');
	let assignedToUserId = $state('');
	let dueDate = $state('');
	let dueDateOpen = $state(false);
	let dueDateValue = $state<DateValue | undefined>(undefined);
	let saving = $state(false);
	let error = $state<string | null>(null);
	let loadedTaskId = $state<string | null>(null);

	// Sync dueDate string → CalendarDate
	$effect(() => {
		if (dueDate) {
			const [y, m, d] = dueDate.split('-').map(Number);
			if (y && m && d) dueDateValue = new CalendarDate(y, m, d);
		} else {
			dueDateValue = undefined;
		}
	});

	function handleDateSelect(value: DateValue | undefined) {
		if (value) {
			dueDate = `${value.year}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`;
		} else {
			dueDate = '';
		}
		dueDateOpen = false;
	}

	function formatDisplayDate(dateStr: string): string {
		if (!dateStr) return '';
		const [y, m, d] = dateStr.split('-').map(Number);
		if (!y || !m || !d) return dateStr;
		return new Date(y, m - 1, d).toLocaleDateString('ro-RO', {
			day: 'numeric',
			month: 'short',
			year: 'numeric'
		});
	}

	// Load milestones for selected project
	const milestonesQuery = $derived(projectId ? getMilestones(projectId) : null);
	const milestones = $derived(milestonesQuery?.current || []);
	const milestoneMap = $derived(new Map(milestones.map((m) => [m.id, m.name])));

	// Populate form from task on mount and whenever task identity changes
	$effect(() => {
		if (task && task.id !== loadedTaskId) {
			title = task.title || '';
			description = task.description || '';
			clientId = task.clientId || '';
			projectId = task.projectId || '';
			previousProjectId = task.projectId || '';
			milestoneId = task.milestoneId || '';
			status = task.status || 'todo';
			priority = task.priority || 'medium';
			assignedToUserId = task.assignedToUserId || '';
			dueDate = task.dueDate ? new Date(task.dueDate).toISOString().split('T')[0] : '';
			loadedTaskId = task.id;
		}
	});

	$effect(() => {
		// Reset milestone when project changes (but not on initial load)
		if (projectId !== previousProjectId && previousProjectId !== '') {
			milestoneId = '';
		}
		previousProjectId = projectId;
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
			// Refresh getTasks query with the same filters as the page and the specific task query
			await updateTask({
				taskId: task.id,
				title,
				description: description || undefined,
				clientId: clientId || undefined,
				projectId: projectId || undefined,
				milestoneId: milestoneId || undefined,
				status: (status || undefined) as
					| 'done'
					| 'todo'
					| 'in-progress'
					| 'review'
					| 'cancelled'
					| 'pending-approval'
					| undefined,
				priority: (priority || undefined) as 'medium' | 'low' | 'high' | 'urgent' | undefined,
				assignedToUserId: assignedToUserId || undefined,
				dueDate: dueDate || undefined
			}).updates(
				getTasks({ ...((filterParams as any) || {}), excludeCompleted: true }),
				getTask(task.id),
				getCompletedTasks({ ...((filterParams as any) || {}), page: 1, pageSize: 20 }),
				...additionalQueriesToUpdate
			);

			onSuccess?.();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to update task';
		} finally {
			saving = false;
		}
	}
</script>

<div class="grid gap-4 py-4">
	<div class="grid gap-2">
		<Label for="edit-title">Task Title</Label>
		<Input id="edit-title" bind:value={title} placeholder="Design homepage mockup" required />
	</div>
	<div class="grid gap-2">
		<Label for="edit-description">Description</Label>
		<Textarea
			id="edit-description"
			bind:value={description}
			placeholder="Add details about the task..."
		/>
	</div>
	<div class="grid gap-2">
		<Label for="edit-client">Client</Label>
		<Combobox
			bind:value={clientId}
			options={clientOptions}
			placeholder="Select a client (optional)"
			searchPlaceholder="Search clients..."
		/>
	</div>
	<div class="grid gap-2">
		<Label for="edit-project">Project</Label>
		<Combobox
			bind:value={projectId}
			options={projectOptions}
			placeholder="Select a project (optional)"
			searchPlaceholder="Search projects..."
		/>
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
					{#each milestones as milestone (milestone.id)}
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
					<div class="flex items-center gap-2">
						<span class="h-2 w-2 rounded-full {getStatusDotColor(status)}"></span>
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
					</div>
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="pending-approval"
						><div class="flex items-center gap-2">
							<span class="h-2 w-2 rounded-full bg-amber-500"></span> Pending Approval
						</div></SelectItem
					>
					<SelectItem value="todo"
						><div class="flex items-center gap-2">
							<span class="h-2 w-2 rounded-full bg-slate-400"></span> To Do
						</div></SelectItem
					>
					<SelectItem value="in-progress"
						><div class="flex items-center gap-2">
							<span class="h-2 w-2 rounded-full bg-blue-500"></span> In Progress
						</div></SelectItem
					>
					<SelectItem value="review"
						><div class="flex items-center gap-2">
							<span class="h-2 w-2 rounded-full bg-purple-500"></span> Review
						</div></SelectItem
					>
					<SelectItem value="done"
						><div class="flex items-center gap-2">
							<span class="h-2 w-2 rounded-full bg-green-500"></span> Done
						</div></SelectItem
					>
					<SelectItem value="cancelled"
						><div class="flex items-center gap-2">
							<span class="h-2 w-2 rounded-full bg-red-500"></span> Cancelled
						</div></SelectItem
					>
				</SelectContent>
			</Select>
		</div>
		<div class="grid gap-2">
			<Label for="edit-priority">Priority</Label>
			<Select type="single" bind:value={priority}>
				<SelectTrigger id="edit-priority">
					<div class="flex items-center gap-2">
						<span class="h-2 w-2 rounded-full {getPriorityDotColor(priority)}"></span>
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
					</div>
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="low"
						><div class="flex items-center gap-2">
							<span class="h-2 w-2 rounded-full bg-gray-400"></span> Low
						</div></SelectItem
					>
					<SelectItem value="medium"
						><div class="flex items-center gap-2">
							<span class="h-2 w-2 rounded-full bg-green-500"></span> Medium
						</div></SelectItem
					>
					<SelectItem value="high"
						><div class="flex items-center gap-2">
							<span class="h-2 w-2 rounded-full bg-orange-500"></span> High
						</div></SelectItem
					>
					<SelectItem value="urgent"
						><div class="flex items-center gap-2">
							<span class="h-2 w-2 rounded-full bg-red-500"></span> Urgent
						</div></SelectItem
					>
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
					{#each users as user (user.id)}
						<SelectItem value={user.id}>
							{`${user.firstName} ${user.lastName}`.trim() || user.email}
						</SelectItem>
					{/each}
				</SelectContent>
			</Select>
		</div>
		<div class="grid gap-2">
			<Label>Due Date</Label>
			<Popover.Root bind:open={dueDateOpen}>
				<Popover.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="outline"
							class="h-9 w-full justify-start text-start text-sm font-normal"
						>
							<CalendarIcon class="mr-2 h-3.5 w-3.5 shrink-0 opacity-50" />
							{dueDate ? formatDisplayDate(dueDate) : 'Select date'}
						</Button>
					{/snippet}
				</Popover.Trigger>
				<Popover.Content class="w-auto p-0" align="start">
					<div class="flex flex-col">
						<Calendar
							type="single"
							value={dueDateValue}
							onValueChange={handleDateSelect}
							locale="ro-RO"
						/>
						{#if dueDate}
							<Button
								variant="ghost"
								class="rounded-t-none border-t text-sm text-muted-foreground"
								onclick={() => {
									dueDate = '';
									dueDateValue = undefined;
									dueDateOpen = false;
								}}
							>
								Clear date
							</Button>
						{/if}
					</div>
				</Popover.Content>
			</Popover.Root>
		</div>
	</div>
</div>
{#if error}
	<div class="rounded-md bg-red-50 p-3">
		<p class="text-sm text-red-800">{error}</p>
	</div>
{/if}
<DialogFooter>
	<Button variant="outline" onclick={() => onCancel?.()}>Cancel</Button>
	<Button onclick={handleSubmit} disabled={saving}>
		{saving ? 'Saving...' : 'Save Changes'}
	</Button>
</DialogFooter>
