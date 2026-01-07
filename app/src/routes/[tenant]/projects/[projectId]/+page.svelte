<script lang="ts">
	import { getProject } from '$lib/remotes/projects.remote';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';

	const tenantSlug = $derived(page.params.tenant);
	const projectId = $derived(page.params.projectId);

	const projectQuery = getProject(projectId);
	const project = $derived(projectQuery.current);
	const loading = $derived(projectQuery.loading);
</script>

<div class="space-y-6">
	{#if loading}
		<p>Loading project...</p>
	{:else if project}
		<div class="flex items-center justify-between">
			<h1 class="text-3xl font-bold">{project.name}</h1>
			<Button onclick={() => goto(`/${tenantSlug}/projects/${project.id}/edit`)}>Edit</Button>
		</div>

		<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
			<Card>
				<CardHeader>
					<CardTitle>Project Details</CardTitle>
				</CardHeader>
				<CardContent class="space-y-2">
					<div>
						<span class="font-semibold">Status:</span> {project.status}
					</div>
					{#if project.description}
						<div>
							<span class="font-semibold">Description:</span>
							<p class="mt-1">{project.description}</p>
						</div>
					{/if}
					{#if project.budget}
						<div>
							<span class="font-semibold">Budget:</span> €{(project.budget / 100).toFixed(2)}
						</div>
					{/if}
					{#if project.startDate}
						<div>
							<span class="font-semibold">Start Date:</span> {new Date(project.startDate).toLocaleDateString()}
						</div>
					{/if}
					{#if project.endDate}
						<div>
							<span class="font-semibold">End Date:</span> {new Date(project.endDate).toLocaleDateString()}
						</div>
					{/if}
				</CardContent>
			</Card>
		</div>
	{/if}
</div>
