<script lang="ts">
	import type { PageData } from './$types';
	import { Tabs, TabsList, TabsTrigger, TabsContent } from '$lib/components/ui/tabs';
	import { Breadcrumb } from '$lib/components/app/breadcrumb';
	import { Button } from '$lib/components/ui/button';
	import { getTask } from '$lib/remotes/tasks.remote';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { Pencil } from '@lucide/svelte';

	let { data, children }: { data: PageData; children: any } = $props();

	const tenantSlug = $derived(page.params.tenant);
	const taskId = $derived(page.params.taskId!);
	const currentPath = $derived(page.url.pathname);

	const taskQuery = getTask(taskId);
	const task = $derived(taskQuery.current);

	const breadcrumbItems = $derived([
		{ label: data.tenant?.name || 'Organization', href: `/${tenantSlug}` },
		{ label: 'Tasks', href: `/${tenantSlug}/tasks` },
		{ label: task?.title || 'Task', href: `/${tenantSlug}/tasks/${taskId}` }
	]);

	const tabs = [
		{ id: 'overview', label: 'Overview', href: `/${tenantSlug}/tasks/${taskId}` },
		{ id: 'documents', label: 'Documents', href: `/${tenantSlug}/tasks/${taskId}/documents` }
	];

	const activeTab = $derived(() => {
		if (currentPath === `/${tenantSlug}/tasks/${taskId}`) return 'overview';
		if (currentPath.startsWith(`/${tenantSlug}/tasks/${taskId}/documents`)) return 'documents';
		return 'overview';
	});
</script>

<div class="space-y-6">
	<Breadcrumb items={breadcrumbItems} />

	{#if task}
		<div class="flex items-center justify-between">
			<div>
				<h1 class="text-3xl font-bold">{task.title}</h1>
				<div class="flex gap-4 mt-1 text-sm text-muted-foreground">
					{#if task.status}
						<span>Status: <span class="capitalize">{task.status}</span></span>
					{/if}
					{#if task.priority}
						<span>Priority: <span class="capitalize">{task.priority}</span></span>
					{/if}
				</div>
			</div>
			<Button variant="outline" onclick={() => goto(`/${tenantSlug}/tasks/${taskId}/edit`)}>
				<Pencil class="h-4 w-4 mr-2" />
				Edit
			</Button>
		</div>

		<Tabs value={activeTab()} class="w-full">
			<TabsList class="grid w-full grid-cols-2">
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
