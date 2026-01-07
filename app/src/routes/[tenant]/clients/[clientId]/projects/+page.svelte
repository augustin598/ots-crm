<script lang="ts">
	import { getProjects } from '$lib/remotes/projects.remote';
	import { getTasks } from '$lib/remotes/tasks.remote';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Plus } from '@lucide/svelte';
	import { DollarSign, Calendar } from '@lucide/svelte';

	const tenantSlug = $derived(page.params.tenant as string);
	const clientId = $derived(page.params.clientId as string);

	const projectsQuery = getProjects(clientId);
	const projects = $derived(projectsQuery.current || []);
	const loading = $derived(projectsQuery.loading);

	// Get all tasks for this client to compute progress per project
	const tasksQuery = getTasks({ clientId });
	const tasks = $derived(tasksQuery.current || []);

	function getProjectProgress(projectId: string) {
		const projectTasks = tasks.filter((t) => t.projectId === projectId);
		if (projectTasks.length === 0) return 0;
		const done = projectTasks.filter((t) => t.status === 'done').length;
		return Math.round((done / projectTasks.length) * 100);
	}
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
		<Card><CardContent class="pt-6"><p class="text-center text-muted-foreground">No projects for this client yet</p></CardContent></Card>
	{:else}
		<div class="grid gap-4 md:grid-cols-2">
			{#each projects as project}
				<Card class="p-6">
					<div class="flex items-start justify-between mb-4">
						<div>
							<h3 class="text-lg font-semibold">{project.name}</h3>
							<Badge variant={project.status === 'active' ? 'default' : 'secondary'} class="mt-2">
								{project.status}
							</Badge>
						</div>
					</div>
					<div class="space-y-3">
						<div>
							<div class="flex items-center justify-between mb-1">
								<span class="text-sm text-muted-foreground">Progress</span>
								<span class="text-sm font-semibold">{getProjectProgress(project.id)}%</span>
							</div>
							<div class="h-2 bg-secondary rounded-full overflow-hidden">
								<div
									class="h-full bg-primary"
									style={`width: ${getProjectProgress(project.id)}%`}
								/>
							</div>
						</div>
						<div class="flex items-center justify-between pt-2 border-t">
							<div class="flex items-center gap-2 text-sm text-muted-foreground">
								<DollarSign class="h-4 w-4" />
								<span>{project.budget ? `€${(project.budget / 100).toLocaleString()}` : '—'}</span>
							</div>
							<div class="flex items-center gap-2 text-sm text-muted-foreground">
								<Calendar class="h-4 w-4" />
								<span>{project.endDate ? new Date(project.endDate).toLocaleDateString() : '—'}</span>
							</div>
						</div>
						<Button variant="outline" class="w-full mt-4 bg-transparent" onclick={() => goto(`/${tenantSlug}/projects/${project.id}`)}>
							View Details
						</Button>
					</div>
				</Card>
			{/each}
		</div>
	{/if}
</div>
