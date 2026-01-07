<script lang="ts">
	import type { PageData } from './$types';
	import { Tabs, TabsList, TabsTrigger, TabsContent } from '$lib/components/ui/tabs';
	import { Breadcrumb } from '$lib/components/app/breadcrumb';
	import { Button } from '$lib/components/ui/button';
	import { getClient } from '$lib/remotes/clients.remote';
	import { getProjects } from '$lib/remotes/projects.remote';
	import { getInvoices } from '$lib/remotes/invoices.remote';
	import { getDocuments } from '$lib/remotes/documents.remote';
	import { Badge } from '$lib/components/ui/badge';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { Pencil as Edit, ArrowLeft } from '@lucide/svelte';

	let { data, children }: { data: PageData; children: any } = $props();

	const tenantSlug = $derived(page.params.tenant as string);
	const clientId = $derived(page.params.clientId as string);
	const currentPath = $derived(page.url.pathname);

	const clientQuery = getClient(clientId);
	const client = $derived(clientQuery.current);
	const initials = $derived(
		client?.name
			? client.name
					.split(' ')
					.filter(Boolean)
					.map((n) => n[0]?.toUpperCase() || '')
					.join('')
					.slice(0, 2)
			: ''
	);

	// Counts for tabs
	const projectsQuery = getProjects(clientId);
	const projects = $derived(projectsQuery.current || []);
	const invoicesQuery = getInvoices({ clientId });
	const invoices = $derived(invoicesQuery.current || []);
	const documentsQuery = getDocuments({ clientId });
	const contracts = $derived((documentsQuery.current || []).filter((d) => d.type === 'contract'));

	const breadcrumbItems = $derived([
		{ label: data.tenant?.name || 'Organization', href: `/${tenantSlug}` },
		{ label: 'Clients', href: `/${tenantSlug}/clients` },
		{ label: client?.name || 'Client', href: `/${tenantSlug}/clients/${clientId}` }
	]);

	const tabs = $derived([
		{ id: 'overview', label: 'Overview', href: `/${tenantSlug}/clients/${clientId}` },
		{ id: 'projects', label: `Projects (${projects.length})`, href: `/${tenantSlug}/clients/${clientId}/projects` },
		{ id: 'contracts', label: `Contracts (${contracts.length})`, href: `/${tenantSlug}/clients/${clientId}/contracts` },
		{ id: 'invoices', label: `Invoices (${invoices.length})`, href: `/${tenantSlug}/clients/${clientId}/invoices` }
	]);

	const activeTab = $derived(() => {
		if (currentPath === `/${tenantSlug}/clients/${clientId}`) return 'overview';
		if (currentPath.startsWith(`/${tenantSlug}/clients/${clientId}/projects`)) return 'projects';
		if (currentPath.startsWith(`/${tenantSlug}/clients/${clientId}/contracts`)) return 'contracts';
		if (currentPath.startsWith(`/${tenantSlug}/clients/${clientId}/invoices`)) return 'invoices';
		return 'overview';
	});
</script>

<div class="space-y-6">
	<Breadcrumb items={breadcrumbItems} />

	<!-- Consistent header across all tabs -->
	<div class="mb-2">
		<Button variant="ghost" size="sm" class="mb-4" onclick={() => goto(`/${tenantSlug}/clients`)}>
			<ArrowLeft class="mr-2 h-4 w-4" />
			Back to Clients
		</Button>

		<div class="flex items-start justify-between">
			<div class="flex items-center gap-4">
				<div
					class="flex h-20 w-20 items-center justify-center rounded-full bg-primary text-primary-foreground text-2xl font-bold"
					aria-hidden="true"
				>
					{initials}
				</div>
				<div>
					<h1 class="text-3xl font-bold tracking-tight">{client?.name || 'Client'}</h1>
					{#if client?.companyType}
						<p class="text-lg text-muted-foreground mt-1">{client.companyType}</p>
					{/if}
					<div class="flex items-center gap-2 mt-2">
						<Badge variant="secondary">Client</Badge>
						{#if client?.createdAt}
							<span class="text-sm text-muted-foreground">
								Client since {new Date(client.createdAt).toLocaleDateString()}
							</span>
						{/if}
					</div>
				</div>
			</div>
			<Button onclick={() => goto(`/${tenantSlug}/clients/${clientId}/edit`)}>
				<Edit class="mr-2 h-4 w-4" />
				Edit Client
			</Button>
		</div>
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
</div>
