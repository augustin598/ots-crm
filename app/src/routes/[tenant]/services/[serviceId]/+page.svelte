<script lang="ts">
	import { getService, deleteService, getServices } from '$lib/remotes/services.remote';
	import { getClient } from '$lib/remotes/clients.remote';
	import { getInvoices } from '$lib/remotes/invoices.remote';
	import { getInvoiceSettings } from '$lib/remotes/invoice-settings.remote';
	import { formatInvoiceNumberDisplay } from '$lib/utils/invoice';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { formatAmount, type Currency } from '$lib/utils/currency';
	import { DollarSign, Calendar, Building2, FileText } from '@lucide/svelte';

	const tenantSlug = $derived(page.params.tenant);
	const serviceId = $derived(page.params.serviceId);

	const serviceQuery = $derived(serviceId ? getService(serviceId) : null);
	const service = $derived(serviceQuery?.current);
	const loading = $derived(serviceQuery?.loading ?? false);
	const error = $derived(serviceQuery?.error);

	const clientQuery = $derived(
		service?.clientId ? getClient(service.clientId) : null
	);
	const client = $derived(clientQuery?.current);

	const invoicesQuery = $derived(
		service ? getInvoices({ serviceId: service.id }) : null
	);
	const invoices = $derived(invoicesQuery?.current || []);

	const invoiceSettingsQuery = getInvoiceSettings();
	const invoiceSettings = $derived(invoiceSettingsQuery.current);

	function getCategoryColor(category: string | null) {
		if (!category) return 'bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-300';
		switch (category) {
			case 'Development':
				return 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300';
			case 'Design':
				return 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300';
			case 'Marketing':
				return 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300';
			case 'Consulting':
				return 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300';
			default:
				return 'bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-300';
		}
	}


	function formatUnit(recurringType: string): string {
		switch (recurringType) {
			case 'daily':
				return 'Per Day';
			case 'weekly':
				return 'Per Week';
			case 'monthly':
				return 'Per Month';
			case 'yearly':
				return 'Per Year';
			case 'none':
			default:
				return 'One-time';
		}
	}

	async function handleDelete() {
		if (!serviceId || !tenantSlug) {
			return;
		}

		if (!confirm('Are you sure you want to delete this service?')) {
			return;
		}

		try {
			if (serviceQuery) {
				await deleteService(serviceId).updates(serviceQuery, getService(serviceId), getServices({}));
			} else {
				await deleteService(serviceId);
			}
			goto(`/${tenantSlug}/services`);
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to delete service');
		}
	}
</script>

<svelte:head>
	<title>{service?.name || 'Service'} - CRM</title>
</svelte:head>

<div class="space-y-6">
	{#if loading}
		<p>Loading service...</p>
	{:else if error}
		<div class="rounded-md bg-red-50 p-3">
			<p class="text-sm text-red-800">{error instanceof Error ? error.message : 'Failed to load service'}</p>
		</div>
	{:else if service}
		<div class="flex items-center justify-between">
			<h1 class="text-3xl font-bold">{service.name}</h1>
			<div class="flex items-center gap-2">
				{#if tenantSlug && serviceId}
					<Button variant="outline" onclick={() => goto(`/${tenantSlug}/services/${serviceId}/edit`)}>
						Edit
					</Button>
				{/if}
				<Button variant="destructive" onclick={handleDelete}>
					Delete
				</Button>
			</div>
		</div>

		<div class="grid gap-6 md:grid-cols-2">
			<Card>
				<CardHeader>
					<CardTitle>Service Details</CardTitle>
				</CardHeader>
				<CardContent class="space-y-4">
					<div>
						<p class="text-sm text-muted-foreground mb-1">Description</p>
						<p class="font-medium">{service.description || 'No description provided'}</p>
					</div>
					{#if service.category}
						<div>
							<p class="text-sm text-muted-foreground mb-1">Category</p>
							<Badge class={getCategoryColor(service.category)}>{service.category}</Badge>
						</div>
					{/if}
					<div>
						<p class="text-sm text-muted-foreground mb-1">Status</p>
						<Badge variant={service.isActive ? 'default' : 'outline'}>
							{service.isActive ? 'Active' : 'Inactive'}
						</Badge>
					</div>
					<div>
						<p class="text-sm text-muted-foreground mb-1">Price</p>
						<p class="text-2xl font-bold text-primary">
							{service.price
								? `${formatAmount(service.price, (service.currency || 'RON') as Currency)} ${formatUnit(service.recurringType)}`
								: '—'}
						</p>
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Client Information</CardTitle>
				</CardHeader>
				<CardContent class="space-y-3">
					{#if client}
						<div class="flex items-center gap-3">
							<Building2 class="h-5 w-5 text-muted-foreground" />
							<div>
								<p class="font-medium">{client.name}</p>
								<p class="text-sm text-muted-foreground">Client</p>
							</div>
						</div>
						{#if tenantSlug}
							<Button variant="outline" onclick={() => goto(`/${tenantSlug}/clients/${client.id}`)}>
								View Client
							</Button>
						{/if}
					{:else}
						<p class="text-muted-foreground">Client information not available</p>
					{/if}
				</CardContent>
			</Card>

			{#if invoices.length > 0}
				<Card class="md:col-span-2">
					<CardHeader>
						<CardTitle>Related Invoices</CardTitle>
						<CardDescription>Invoices generated from this service</CardDescription>
					</CardHeader>
					<CardContent>
						<div class="space-y-3">
							{#each invoices as invoice}
								<div class="flex items-center justify-between p-3 border rounded-lg">
									<div class="flex items-center gap-3">
										<FileText class="h-5 w-5 text-muted-foreground" />
										<div>
											<p class="font-medium">{formatInvoiceNumberDisplay(invoice, invoiceSettings)}</p>
											<p class="text-sm text-muted-foreground">
												{invoice.issueDate ? new Date(invoice.issueDate).toLocaleDateString() : '—'}
											</p>
										</div>
									</div>
									<div class="flex items-center gap-4">
										<p class="font-semibold">
											{formatAmount(invoice.totalAmount || 0, (invoice.currency || 'RON') as Currency)}
										</p>
										<Badge
											variant={
												invoice.status === 'paid'
													? 'default'
													: invoice.status === 'overdue'
													? 'destructive'
													: 'secondary'
											}
										>
											{invoice.status}
										</Badge>
										{#if tenantSlug}
											<Button variant="ghost" size="sm" onclick={() => goto(`/${tenantSlug}/invoices/${invoice.id}`)}>
												View
											</Button>
										{/if}
									</div>
								</div>
							{/each}
						</div>
					</CardContent>
				</Card>
			{/if}
		</div>
	{:else}
		<p>Service not found</p>
	{/if}
</div>
