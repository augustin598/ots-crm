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

	const tenantSlug = $derived(page.params.tenant);
	const tasksQuery = getTasks({});
	const tasks = $derived(tasksQuery.current || []);
	const loading = $derived(tasksQuery.loading);
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-3xl font-bold">Tasks</h1>
		<Button onclick={() => goto(`/${tenantSlug}/tasks/new`)}>New Task</Button>
	</div>

	{#if loading}
		<p>Loading...</p>
	{:else if tasks.length === 0}
		<Card>
			<CardContent class="pt-6">
				<p class="text-center text-gray-500">No tasks yet</p>
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
						<TableHead>Actions</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{#each tasks as task}
						<TableRow>
							<TableCell class="font-medium">{task.title}</TableCell>
							<TableCell>{task.status}</TableCell>
							<TableCell>{task.priority}</TableCell>
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
