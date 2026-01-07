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
	import { Plus } from '@lucide/svelte';

	const tenantSlug = $derived(page.params.tenant);
	const clientId = $derived(page.params.clientId);

	const projectsQuery = getProjects(clientId);
	const projects = $derived(projectsQuery.current || []);
	const loading = $derived(projectsQuery.loading);
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h2 class="text-2xl font-semibold">Projects</h2>
		<Button onclick={() => goto(`/${tenantSlug}/projects/new?clientId=${clientId}`)}>
			<Plus class="h-4 w-4 mr-2" />
			New Project
		</Button>
	</div>

	{#if loading}
		<p>Loading...</p>
	{:else if projects.length === 0}
		<Card>
			<CardContent class="pt-6">
				<p class="text-center text-muted-foreground">No projects for this client yet</p>
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
