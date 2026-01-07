<script lang="ts">
	import { getProjects } from '$lib/remotes/projects.remote';
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
	const projectsQuery = getProjects();
	const projects = $derived(projectsQuery.current || []);
	const loading = $derived(projectsQuery.loading);
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-3xl font-bold">Projects</h1>
		<Button onclick={() => goto(`/${tenantSlug}/projects/new`)}>New Project</Button>
	</div>

	{#if loading}
		<p>Loading...</p>
	{:else if projects.length === 0}
		<Card>
			<CardContent class="pt-6">
				<p class="text-center text-gray-500">No projects yet</p>
			</CardContent>
		</Card>
	{:else}
		<Card>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Name</TableHead>
						<TableHead>Status</TableHead>
						<TableHead>Budget</TableHead>
						<TableHead>Actions</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{#each projects as project}
						<TableRow>
							<TableCell class="font-medium">{project.name}</TableCell>
							<TableCell>{project.status}</TableCell>
							<TableCell>{project.budget ? `€${(project.budget / 100).toFixed(2)}` : '-'}</TableCell>
							<TableCell>
								<Button variant="ghost" size="sm" onclick={() => goto(`/${tenantSlug}/projects/${project.id}`)}>
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
