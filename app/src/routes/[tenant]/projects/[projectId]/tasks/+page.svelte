<script lang="ts">
	import { getTasks } from '$lib/remotes/tasks.remote';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import {
		Table,
		TableBody,
		TableCell,
		TableHead,
		TableHeader,
		TableRow
	} from '$lib/components/ui/table';
	import { Plus } from '@lucide/svelte';

	const tenantSlug = $derived(page.params.tenant);
	const projectId = $derived(page.params.projectId);

	const tasksQuery = getTasks({ projectId });
	const tasks = $derived(tasksQuery.current || []);
	const loading = $derived(tasksQuery.loading);
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h2 class="text-2xl font-semibold">Tasks</h2>
		<Button onclick={() => goto(`/${tenantSlug}/tasks/new?projectId=${projectId}`)}>
			<Plus class="h-4 w-4 mr-2" />
			New Task
		</Button>
	</div>

	{#if loading}
		<p>Loading...</p>
	{:else if tasks.length === 0}
		<Card>
			<CardContent class="pt-6">
				<p class="text-center text-muted-foreground">No tasks for this project yet</p>
			</CardContent>
		</Card>
	{:else}
		<Card>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Title</TableHead>
						<TableHead>Status</TableHead>
						<TableHead>Priority</TableHead>
						<TableHead>Due Date</TableHead>
						<TableHead>Actions</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{#each tasks as task}
						<TableRow>
							<TableCell class="font-medium">{task.title}</TableCell>
							<TableCell>{task.status}</TableCell>
							<TableCell>{task.priority}</TableCell>
							<TableCell>{task.dueDate ? new Date(task.dueDate).toLocaleDateString() : '-'}</TableCell>
							<TableCell>
								<Button variant="ghost" size="sm" onclick={() => goto(`/${tenantSlug}/tasks/${task.id}`)}>
									View
								</Button>
							</TableCell>
						</TableRow>
					{/each}
				</TableBody>
			</Table>
		</Card>
	{/if}
</div>
