<script lang="ts">
	import { getTasks, createTask } from '$lib/remotes/tasks.remote';
	import { page } from '$app/state';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Plus } from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import CreateTaskDialog from '$lib/components/create-task-dialog.svelte';

	const tenantSlug = $derived(page.params.tenant as string);

	const tasksQuery = getTasks({});
	const tasks = $derived(tasksQuery.current || []);
	const loading = $derived(tasksQuery.loading);

	let createDialogOpen = $state(false);

	function getStatusColor(status: string): string {
		switch (status) {
			case 'pending-approval':
				return 'bg-yellow-100 text-yellow-700';
			case 'todo':
				return 'bg-gray-100 text-gray-700';
			case 'in-progress':
				return 'bg-blue-100 text-blue-700';
			case 'review':
				return 'bg-purple-100 text-purple-700';
			case 'done':
				return 'bg-green-100 text-green-700';
			case 'cancelled':
				return 'bg-red-100 text-red-700';
			default:
				return 'bg-gray-100 text-gray-700';
		}
	}

	function formatDate(date: Date | string | null | undefined): string {
		if (!date) return '-';
		try {
			const d = date instanceof Date ? date : new Date(date);
			return d.toLocaleDateString('ro-RO', { year: 'numeric', month: 'short', day: 'numeric' });
		} catch {
			return '-';
		}
	}
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-3xl font-bold">Tasks</h1>
			<p class="text-muted-foreground">View and manage your tasks</p>
		</div>
		<Button onclick={() => (createDialogOpen = true)}>
			<Plus class="mr-2 h-4 w-4" />
			Create Task
		</Button>
	</div>

	{#if loading}
		<p class="text-muted-foreground">Loading tasks...</p>
	{:else if tasks.length === 0}
		<Card>
			<CardContent class="pt-6">
				<p class="text-center text-muted-foreground">No tasks yet. Create your first task!</p>
			</CardContent>
		</Card>
	{:else}
		<div class="space-y-4">
			{#each tasks as task}
				<Card class="cursor-pointer hover:border-primary transition-colors"
					onclick={() => goto(`/client/${tenantSlug}/tasks/${task.id}`)}
				>
					<CardHeader>
						<div class="flex items-start justify-between">
							<div class="flex-1">
								<CardTitle class="text-lg">{task.title}</CardTitle>
								{#if task.description}
									<p class="text-sm text-muted-foreground mt-1 line-clamp-2">{task.description}</p>
								{/if}
							</div>
							<Badge class={getStatusColor(task.status)}>{task.status.replace('-', ' ')}</Badge>
						</div>
					</CardHeader>
					<CardContent>
						<div class="flex items-center gap-4 text-sm text-muted-foreground">
							{#if task.dueDate}
								<span>Due: {formatDate(task.dueDate)}</span>
							{/if}
							{#if task.priority}
								<span class="capitalize">Priority: {task.priority}</span>
							{/if}
						</div>
					</CardContent>
				</Card>
			{/each}
		</div>
	{/if}
</div>

<CreateTaskDialog
	open={createDialogOpen}
	isClient={true}
	onSuccess={() => {
		createDialogOpen = false;
		tasksQuery.refresh();
	}}
	onOpenChange={(value) => {
		tasksQuery.refresh();
		createDialogOpen = value;
	}}
/>
