<script lang="ts">
	import { getTask } from '$lib/remotes/tasks.remote';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';

	const tenantSlug = $derived(page.params.tenant);
	const taskId = $derived(page.params.taskId);

	const taskQuery = getTask(taskId);
	const task = $derived(taskQuery.current);
	const loading = $derived(taskQuery.loading);
	const error = $derived(taskQuery.error);
</script>

<div class="space-y-6">
	{#if loading}
		<p>Loading task...</p>
	{:else if error}
		<div class="rounded-md bg-red-50 p-3">
			<p class="text-sm text-red-800">{error instanceof Error ? error.message : 'Failed to load task'}</p>
		</div>
	{:else if task}
		<div class="flex items-center justify-between">
			<h1 class="text-3xl font-bold">{task.title}</h1>
			<Button onclick={() => goto(`/${tenantSlug}/tasks/${task.id}/edit`)}>Edit</Button>
		</div>

		<Card>
			<CardHeader>
				<CardTitle>Task Details</CardTitle>
			</CardHeader>
			<CardContent class="space-y-2">
				<div>
					<span class="font-semibold">Status:</span> {task.status}
				</div>
				<div>
					<span class="font-semibold">Priority:</span> {task.priority}
				</div>
				{#if task.dueDate}
					<div>
						<span class="font-semibold">Due Date:</span> {new Date(task.dueDate).toLocaleDateString()}
					</div>
				{/if}
				{#if task.description}
					<div>
						<span class="font-semibold">Description:</span>
						<p class="mt-1">{task.description}</p>
					</div>
				{/if}
			</CardContent>
		</Card>
	{:else}
		<p>Task not found</p>
	{/if}
</div>
