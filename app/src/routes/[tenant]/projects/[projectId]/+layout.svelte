<script lang="ts">
	import type { PageData } from './$types';
	import { Tabs, TabsList, TabsTrigger, TabsContent } from '$lib/components/ui/tabs';
	import { Breadcrumb } from '$lib/components/app/breadcrumb';
	import { Button } from '$lib/components/ui/button';
	import { getProject } from '$lib/remotes/projects.remote';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { Pencil } from '@lucide/svelte';

	let { data, children }: { data: PageData; children: any } = $props();

	const tenantSlug = $derived(page.params.tenant);
	const projectId = $derived(page.params.projectId);
	const currentPath = $derived(page.url.pathname);

	const projectQuery = getProject(projectId);
	const project = $derived(projectQuery.current);

	const breadcrumbItems = $derived([
		{ label: data.tenant?.name || 'Organization', href: `/${tenantSlug}` },
		{ label: 'Projects', href: `/${tenantSlug}/projects` },
		{ label: project?.name || 'Project', href: `/${tenantSlug}/projects/${projectId}` }
	]);

	const tabs = [
		{ id: 'overview', label: 'Overview', href: `/${tenantSlug}/projects/${projectId}` },
		{ id: 'tasks', label: 'Tasks', href: `/${tenantSlug}/projects/${projectId}/tasks` },
		{ id: 'documents', label: 'Documents', href: `/${tenantSlug}/projects/${projectId}/documents` },
		{ id: 'invoices', label: 'Invoices', href: `/${tenantSlug}/projects/${projectId}/invoices` }
	];

	const activeTab = $derived(() => {
		if (currentPath === `/${tenantSlug}/projects/${projectId}`) return 'overview';
		if (currentPath.startsWith(`/${tenantSlug}/projects/${projectId}/tasks`)) return 'tasks';
		if (currentPath.startsWith(`/${tenantSlug}/projects/${projectId}/documents`)) return 'documents';
		if (currentPath.startsWith(`/${tenantSlug}/projects/${projectId}/invoices`)) return 'invoices';
		return 'overview';
	});
</script>

<div class="space-y-6">
	<Breadcrumb items={breadcrumbItems} />

	{#if project}
		<div class="flex items-center justify-between">
			<div>
				<h1 class="text-3xl font-bold">{project.name}</h1>
				{#if project.status}
					<p class="text-muted-foreground mt-1">
						Status: <span class="capitalize">{project.status}</span>
					</p>
				{/if}
			</div>
			<Button variant="outline" onclick={() => goto(`/${tenantSlug}/projects/${projectId}/edit`)}>
				<Pencil class="h-4 w-4 mr-2" />
				Edit
			</Button>
		</div>

		<Tabs value={activeTab()} class="w-full">
			<TabsList class="grid w-full grid-cols-4">
				{#each tabs as tab}
					<TabsTrigger value={tab.id} onclick={() => goto(tab.href)}>
						{tab.label}
					</TabsTrigger>
				{/each}
			</TabsList>
			<TabsContent value={activeTab()} class="mt-6">
				{@render children()}
			</TabsContent>
		</Tabs>
	{:else}
		<div class="space-y-6">
			{@render children()}
		</div>
	{/if}
</div>
