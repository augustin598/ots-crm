<script lang="ts">
	import { getClient } from '$lib/remotes/clients.remote';
	import { getProjects } from '$lib/remotes/projects.remote';
	import { getTasks } from '$lib/remotes/tasks.remote';
	import { getInvoices } from '$lib/remotes/invoices.remote';
	import { getServices } from '$lib/remotes/services.remote';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Plus, FolderKanban, CheckSquare, FileText, Receipt } from '@lucide/svelte';

	const tenantSlug = $derived(page.params.tenant);
	const clientId = $derived(page.params.clientId);

	const clientQuery = getClient(clientId);
	const client = $derived(clientQuery.current);
	const loading = $derived(clientQuery.loading);
	const error = $derived(clientQuery.error);

	const projectsQuery = getProjects(clientId);
	const projects = $derived(projectsQuery.current || []);

	const tasksQuery = getTasks({ clientId });
	const tasks = $derived(tasksQuery.current || []);

	const invoicesQuery = getInvoices({ clientId });
	const invoices = $derived(invoicesQuery.current || []);

	const servicesQuery = getServices({ clientId });
	const services = $derived(servicesQuery.current || []);

	const totalProjects = $derived(projects.length);
	const totalTasks = $derived(tasks.length);
	const totalInvoices = $derived(invoices.length);
	const totalServices = $derived(services.length);
	const totalRevenue = $derived(
		invoices.filter((i) => i.status === 'paid').reduce((sum, i) => sum + i.totalAmount, 0) / 100
	);
</script>

<svelte:head>
	<title>{client?.name || 'Client'} - CRM</title>
</svelte:head>

<div class="space-y-6">
	{#if loading}
		<p>Loading client...</p>
	{:else if error}
		<div class="rounded-md bg-red-50 p-3">
			<p class="text-sm text-red-800">{error instanceof Error ? error.message : 'Failed to load client'}</p>
		</div>
	{:else if client}
		<!-- Summary Cards -->
		<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
			<Card>
				<CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
					<CardTitle class="text-sm font-medium">Projects</CardTitle>
					<FolderKanban class="h-4 w-4 text-muted-foreground" />
				</CardHeader>
				<CardContent>
					<div class="text-2xl font-bold">{totalProjects}</div>
					<p class="text-xs text-muted-foreground">Active projects</p>
				</CardContent>
			</Card>

			<Card>
				<CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
					<CardTitle class="text-sm font-medium">Tasks</CardTitle>
					<CheckSquare class="h-4 w-4 text-muted-foreground" />
				</CardHeader>
				<CardContent>
					<div class="text-2xl font-bold">{totalTasks}</div>
					<p class="text-xs text-muted-foreground">Total tasks</p>
				</CardContent>
			</Card>

			<Card>
				<CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
					<CardTitle class="text-sm font-medium">Invoices</CardTitle>
					<Receipt class="h-4 w-4 text-muted-foreground" />
				</CardHeader>
				<CardContent>
					<div class="text-2xl font-bold">{totalInvoices}</div>
					<p class="text-xs text-muted-foreground">Total invoices</p>
				</CardContent>
			</Card>

			<Card>
				<CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
					<CardTitle class="text-sm font-medium">Revenue</CardTitle>
					<FileText class="h-4 w-4 text-muted-foreground" />
				</CardHeader>
				<CardContent>
					<div class="text-2xl font-bold">€{totalRevenue.toFixed(2)}</div>
					<p class="text-xs text-muted-foreground">Paid invoices</p>
				</CardContent>
			</Card>
		</div>

		<!-- Quick Actions -->
		<Card>
			<CardHeader>
				<CardTitle>Quick Actions</CardTitle>
				<CardDescription>Create new items for this client</CardDescription>
			</CardHeader>
			<CardContent>
				<div class="flex flex-wrap gap-2">
					<Button variant="outline" onclick={() => goto(`/${tenantSlug}/projects/new?clientId=${clientId}`)}>
						<Plus class="h-4 w-4 mr-2" />
						New Project
					</Button>
					<Button variant="outline" onclick={() => goto(`/${tenantSlug}/tasks/new?clientId=${clientId}`)}>
						<Plus class="h-4 w-4 mr-2" />
						New Task
					</Button>
					<Button variant="outline" onclick={() => goto(`/${tenantSlug}/invoices/new?clientId=${clientId}`)}>
						<Plus class="h-4 w-4 mr-2" />
						New Invoice
					</Button>
					<Button variant="outline" onclick={() => goto(`/${tenantSlug}/services/new?clientId=${clientId}`)}>
						<Plus class="h-4 w-4 mr-2" />
						New Service
					</Button>
					<Button variant="outline" onclick={() => goto(`/${tenantSlug}/documents/upload?clientId=${clientId}`)}>
						<Plus class="h-4 w-4 mr-2" />
						Upload Document
					</Button>
				</div>
			</CardContent>
		</Card>

		<!-- Client Details -->
		<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
			<Card>
				<CardHeader>
					<CardTitle>Contact Information</CardTitle>
				</CardHeader>
				<CardContent class="space-y-2">
					{#if client.email}
						<div>
							<span class="font-semibold">Email:</span> {client.email}
						</div>
					{/if}
					{#if client.phone}
						<div>
							<span class="font-semibold">Phone:</span> {client.phone}
						</div>
					{/if}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Legal Data</CardTitle>
				</CardHeader>
				<CardContent class="space-y-2">
					{#if client.cui}
						<div>
							<span class="font-semibold">CUI:</span> {client.cui}
						</div>
					{/if}
					{#if client.companyType}
						<div>
							<span class="font-semibold">Company Type:</span> {client.companyType}
						</div>
					{/if}
					{#if client.registrationNumber}
						<div>
							<span class="font-semibold">Registration Number:</span> {client.registrationNumber}
						</div>
					{/if}
					{#if client.tradeRegister}
						<div>
							<span class="font-semibold">Trade Register:</span> {client.tradeRegister}
						</div>
					{/if}
					{#if client.iban}
						<div>
							<span class="font-semibold">IBAN:</span> {client.iban}
						</div>
					{/if}
				</CardContent>
			</Card>

			{#if client.address || client.city || client.county}
				<Card>
					<CardHeader>
						<CardTitle>Address</CardTitle>
					</CardHeader>
					<CardContent class="space-y-2">
						{#if client.address}
							<div>{client.address}</div>
						{/if}
						<div>
							{#if client.city}{client.city}{/if}
							{#if client.city && client.county}, {/if}
							{#if client.county}{client.county}{/if}
							{#if client.postalCode} {client.postalCode}{/if}
						</div>
						{#if client.country}
							<div>{client.country}</div>
						{/if}
					</CardContent>
				</Card>
			{/if}

			{#if client.notes}
				<Card>
					<CardHeader>
						<CardTitle>Notes</CardTitle>
					</CardHeader>
					<CardContent>
						<p class="whitespace-pre-wrap">{client.notes}</p>
					</CardContent>
				</Card>
			{/if}
		</div>
	{/if}
</div>
