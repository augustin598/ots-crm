<script lang="ts">
	import { getClient } from '$lib/remotes/clients.remote';
	import { getProjects } from '$lib/remotes/projects.remote';
	import { getInvoices } from '$lib/remotes/invoices.remote';
	import { getDocuments } from '$lib/remotes/documents.remote';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import {
		FolderKanban,
		FileText,
		TrendingUp,
		DollarSign,
		Mail,
		Phone,
		MapPin,
		Building2
	} from '@lucide/svelte';

	const tenantSlug = $derived(page.params.tenant as string);
	const clientId = $derived(page.params.clientId as string);

	const clientQuery = getClient(clientId);
	const client = $derived(clientQuery.current);
	const loading = $derived(clientQuery.loading);
	const error = $derived(clientQuery.error);

	const projectsQuery = getProjects(clientId);
	const projects = $derived(projectsQuery.current || []);

	const invoicesQuery = getInvoices({ clientId });
	const invoices = $derived(invoicesQuery.current || []);

	const documentsQuery = getDocuments({ clientId });
	const documents = $derived(documentsQuery.current || []);
	const contracts = $derived(documents.filter((d) => d.type === 'contract'));

	const activeProjects = $derived(projects.filter((p) => p.status === 'active').length);
	const totalContracts = $derived(contracts.length);
	const paidInvoices = $derived(invoices.filter((i) => i.status === 'paid'));
	const totalPaid = $derived(paidInvoices.reduce((sum, i) => sum + (i.totalAmount || 0), 0) / 100);
	const pendingInvoices = $derived(invoices.filter((i) => i.status === 'sent' || i.status === 'overdue'));
	const totalPending = $derived(pendingInvoices.reduce((sum, i) => sum + (i.totalAmount || 0), 0) / 100);
	const recentInvoices = $derived(
		[...invoices]
			.sort((a, b) => {
				const ad = a.issueDate ? new Date(a.issueDate).getTime() : 0;
				const bd = b.issueDate ? new Date(b.issueDate).getTime() : 0;
				return bd - ad;
			})
			.slice(0, 3)
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
		

		<!-- KPIs -->
		<div class="grid gap-4 md:grid-cols-4 mb-6">
			<Card class="p-4">
				<div class="flex items-center gap-3">
					<div class="flex h-12 w-12 items-center justify-center rounded-lg bg-green-500/10">
						<DollarSign class="h-6 w-6 text-green-600" />
					</div>
					<div>
						<p class="text-sm text-muted-foreground">Total Revenue</p>
						<p class="text-2xl font-bold">€{totalPaid.toLocaleString()}</p>
					</div>
				</div>
			</Card>

			<Card class="p-4">
				<div class="flex items-center gap-3">
					<div class="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-500/10">
						<FolderKanban class="h-6 w-6 text-blue-600" />
					</div>
					<div>
						<p class="text-sm text-muted-foreground">Active Projects</p>
						<p class="text-2xl font-bold">{activeProjects}</p>
					</div>
				</div>
			</Card>

			<Card class="p-4">
				<div class="flex items-center gap-3">
					<div class="flex h-12 w-12 items-center justify-center rounded-lg bg-purple-500/10">
						<FileText class="h-6 w-6 text-purple-600" />
					</div>
					<div>
						<p class="text-sm text-muted-foreground">Contracts</p>
						<p class="text-2xl font-bold">{totalContracts}</p>
					</div>
				</div>
			</Card>

			<Card class="p-4">
				<div class="flex items-center gap-3">
					<div class="flex h-12 w-12 items-center justify-center rounded-lg bg-orange-500/10">
						<TrendingUp class="h-6 w-6 text-orange-600" />
					</div>
					<div>
						<p class="text-sm text-muted-foreground">Pending</p>
						<p class="text-2xl font-bold">€{totalPending.toLocaleString()}</p>
					</div>
				</div>
			</Card>
		</div>

		<!-- Overview content -->
		<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
			<Card>
				<CardHeader>
					<CardTitle>Contact Information</CardTitle>
				</CardHeader>
				<CardContent class="space-y-2">
					<div class="space-y-3">
						{#if client.email}
							<div class="flex items-center gap-3">
								<Mail class="h-5 w-5 text-muted-foreground" />
								<div>
									<p class="text-sm text-muted-foreground">Email</p>
									<p class="font-medium">{client.email}</p>
								</div>
							</div>
						{/if}
						{#if client.phone}
							<div class="flex items-center gap-3">
								<Phone class="h-5 w-5 text-muted-foreground" />
								<div>
									<p class="text-sm text-muted-foreground">Phone</p>
									<p class="font-medium">{client.phone}</p>
								</div>
							</div>
						{/if}
						{#if client.address}
							<div class="flex items-center gap-3">
								<MapPin class="h-5 w-5 text-muted-foreground" />
								<div>
									<p class="text-sm text-muted-foreground">Address</p>
									<p class="font-medium">
										{client.address}
										{#if client.city}, {client.city}{/if}
										{#if client.county}, {client.county}{/if}
									</p>
								</div>
							</div>
						{/if}
						{#if client.companyType}
							<div class="flex items-center gap-3">
								<Building2 class="h-5 w-5 text-muted-foreground" />
								<div>
                                    <p class="text-sm text-muted-foreground">Company Type</p>
									<p class="font-medium">{client.companyType}</p>
								</div>
							</div>
						{/if}
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Notes</CardTitle>
				</CardHeader>
				<CardContent class="space-y-2">
					<p class="text-muted-foreground leading-relaxed">
						{client.notes || 'No notes available for this client.'}
					</p>
				</CardContent>
			</Card>

			<!-- Recent Activity -->
			<Card class="md:col-span-2">
				<CardHeader>
					<CardTitle>Recent Activity</CardTitle>
					<CardDescription>Latest invoices for this client</CardDescription>
				</CardHeader>
				<CardContent>
					<div class="space-y-4">
						{#if recentInvoices.length === 0}
							<p class="text-sm text-muted-foreground">No recent invoices.</p>
						{:else}
							{#each recentInvoices as invoice}
								<div class="flex items-center gap-4 pb-4 border-b last:border-0 last:pb-0">
									<div class="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
										<FileText class="h-5 w-5 text-primary" />
									</div>
									<div class="flex-1">
										<p class="font-medium">{invoice.invoiceNumber}</p>
										<p class="text-sm text-muted-foreground">
											Issued on {invoice.issueDate ? new Date(invoice.issueDate).toLocaleDateString() : '—'}
										</p>
									</div>
									<div class="text-right">
										<p class="font-semibold">€{((invoice.totalAmount || 0) / 100).toLocaleString()}</p>
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
									</div>
								</div>
							{/each}
						{/if}
					</div>
				</CardContent>
			</Card>
		</div>
	{/if}
</div>
