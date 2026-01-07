<script lang="ts">
	import type { PageData } from './$types';
	import { Tabs, TabsList, TabsTrigger, TabsContent } from '$lib/components/ui/tabs';
	import { Breadcrumb } from '$lib/components/app/breadcrumb';
	import { Button } from '$lib/components/ui/button';
	import { getClient } from '$lib/remotes/clients.remote';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { Pencil } from '@lucide/svelte';

	let { data, children }: { data: PageData; children: any } = $props();

	const tenantSlug = $derived(page.params.tenant);
	const clientId = $derived(page.params.clientId);
	const currentPath = $derived(page.url.pathname);

	const clientQuery = getClient(clientId);
	const client = $derived(clientQuery.current);

	const breadcrumbItems = $derived([
		{ label: data.tenant?.name || 'Organization', href: `/${tenantSlug}` },
		{ label: 'Clients', href: `/${tenantSlug}/clients` },
		{ label: client?.name || 'Client', href: `/${tenantSlug}/clients/${clientId}` }
	]);

	const tabs = [
		{ id: 'overview', label: 'Overview', href: `/${tenantSlug}/clients/${clientId}` },
		{ id: 'projects', label: 'Projects', href: `/${tenantSlug}/clients/${clientId}/projects` },
		{ id: 'tasks', label: 'Tasks', href: `/${tenantSlug}/clients/${clientId}/tasks` },
		{ id: 'documents', label: 'Documents', href: `/${tenantSlug}/clients/${clientId}/documents` },
		{ id: 'invoices', label: 'Invoices', href: `/${tenantSlug}/clients/${clientId}/invoices` },
		{ id: 'services', label: 'Services', href: `/${tenantSlug}/clients/${clientId}/services` }
	];

	const activeTab = $derived(() => {
		if (currentPath === `/${tenantSlug}/clients/${clientId}`) return 'overview';
		if (currentPath.startsWith(`/${tenantSlug}/clients/${clientId}/projects`)) return 'projects';
		if (currentPath.startsWith(`/${tenantSlug}/clients/${clientId}/tasks`)) return 'tasks';
		if (currentPath.startsWith(`/${tenantSlug}/clients/${clientId}/documents`)) return 'documents';
		if (currentPath.startsWith(`/${tenantSlug}/clients/${clientId}/invoices`)) return 'invoices';
		if (currentPath.startsWith(`/${tenantSlug}/clients/${clientId}/services`)) return 'services';
		return 'overview';
	});
</script>

<div class="space-y-6">
	<Breadcrumb items={breadcrumbItems} />

	{#if client}
		<div class="flex items-center justify-between">
			<div>
				<h1 class="text-3xl font-bold">{client.name}</h1>
				{#if client.email || client.phone}
					<p class="text-muted-foreground mt-1">
						{#if client.email}{client.email}{/if}
						{#if client.email && client.phone} • {/if}
						{#if client.phone}{client.phone}{/if}
					</p>
				{/if}
			</div>
			<Button variant="outline" onclick={() => goto(`/${tenantSlug}/clients/${clientId}/edit`)}>
				<Pencil class="h-4 w-4 mr-2" />
				Edit
			</Button>
		</div>

		<Tabs value={activeTab()} class="w-full">
			<TabsList class="grid w-full grid-cols-6">
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
