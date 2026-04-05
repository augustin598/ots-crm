<script lang="ts">
	import { getClient } from '$lib/remotes/clients.remote';
	import { getProjects } from '$lib/remotes/projects.remote';
	import { getInvoices } from '$lib/remotes/invoices.remote';
	import { getDocuments } from '$lib/remotes/documents.remote';
	import { getClientCredit, syncKeezIfStale } from '$lib/remotes/banking.remote';
	import { onMount } from 'svelte';
	import { getInvoiceSettings } from '$lib/remotes/invoice-settings.remote';
	import { formatInvoiceNumberDisplay } from '$lib/utils/invoice';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { formatAmount, type Currency } from '$lib/utils/currency';
	import {
		FolderKanban,
		FileText,
		TrendingUp,
		DollarSign,
		Mail,
		Phone,
		MapPin,
		Building2,
		CreditCard
	} from '@lucide/svelte';
	import ClientActivityFeed from '$lib/components/client/ClientActivityFeed.svelte';
	import ClientOnboardingControl from '$lib/components/client/client-onboarding-control.svelte';

	const tenantSlug = $derived(page.params.tenant as string);
	const clientId = $derived(page.params.clientId as string);

	const clientQuery = $derived(getClient(clientId));
	const client = $derived(clientQuery.current);
	const loading = $derived(clientQuery.loading);
	const error = $derived(clientQuery.error);

	const projectsQuery = $derived(getProjects(clientId));
	const projects = $derived(projectsQuery.current || []);

	const invoicesQuery = $derived(getInvoices({ clientId }));
	const invoices = $derived(invoicesQuery.current || []);

	const documentsQuery = $derived(getDocuments({ clientId }));
	const documents = $derived(documentsQuery.current || []);
	const contracts = $derived(documents.filter((d) => d.type === 'contract'));

	const activeProjects = $derived(projects.filter((p) => p.status === 'active').length);
	const totalContracts = $derived(contracts.length);
	const recentInvoices = $derived(
		[...invoices]
			.sort((a, b) => {
				const ad = a.issueDate ? new Date(a.issueDate).getTime() : 0;
				const bd = b.issueDate ? new Date(b.issueDate).getTime() : 0;
				return bd - ad;
			})
			.slice(0, 3)
	);

	const creditQuery = $derived(getClientCredit(clientId));
	const credit = $derived(creditQuery.current);

	const invoiceSettingsQuery = getInvoiceSettings();
	const invoiceSettings = $derived(invoiceSettingsQuery.current);

	// Sync Keez invoices on mount (if stale), then refresh credit data
	onMount(async () => {
		try {
			await syncKeezIfStale().updates(creditQuery, invoicesQuery);
		} catch {
			// Sync failed silently, use cached data
		}
	});
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
		<div class="grid gap-4 md:grid-cols-3 lg:grid-cols-5 mb-6">
			<Card class="p-4">
				<div class="flex items-center gap-3">
					<div class="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-500/10">
						<DollarSign class="h-6 w-6 text-blue-600" />
					</div>
					<div>
						<p class="text-sm text-muted-foreground">Total Facturat</p>
						{#if credit}
							{#each Object.entries(credit.totalInvoicedByCurrency) as [curr, amount]}
								<p class="text-2xl font-bold">{formatAmount(amount, curr as Currency)}</p>
							{:else}
								<p class="text-2xl font-bold">{formatAmount(0, 'RON')}</p>
							{/each}
							<p class="text-xs text-muted-foreground mt-1">
								{credit.paidInvoices + credit.unpaidInvoices} factur{credit.paidInvoices + credit.unpaidInvoices !== 1 ? 'i' : 'ă'}
							</p>
						{:else}
							<p class="text-2xl font-bold">—</p>
						{/if}
					</div>
				</div>
			</Card>

			<Card class="p-4">
				<div class="flex items-center gap-3">
					<div class="flex h-12 w-12 items-center justify-center rounded-lg bg-green-500/10">
						<TrendingUp class="h-6 w-6 text-green-600" />
					</div>
					<div>
						<p class="text-sm text-muted-foreground">Total Încasat</p>
						{#if credit}
							{#each Object.entries(credit.totalPaidByCurrency) as [curr, amount]}
								<p class="text-2xl font-bold text-green-600">{formatAmount(amount, curr as Currency)}</p>
							{:else}
								<p class="text-2xl font-bold text-green-600">{formatAmount(0, 'RON')}</p>
							{/each}
							<p class="text-xs text-muted-foreground mt-1">
								{credit.paidInvoices} factur{credit.paidInvoices !== 1 ? 'i' : 'ă'} plătit{credit.paidInvoices !== 1 ? 'e' : 'ă'}
							</p>
						{:else}
							<p class="text-2xl font-bold">—</p>
						{/if}
					</div>
				</div>
			</Card>

			<Card class="p-4">
				<div class="flex items-center gap-3">
					<div class="flex h-12 w-12 items-center justify-center rounded-lg bg-red-500/10">
						<CreditCard class="h-6 w-6 text-red-600" />
					</div>
					<div>
						<p class="text-sm text-muted-foreground">Remaining Credit</p>
						{#if credit}
							{#each Object.entries(credit.remainingCreditByCurrency) as [curr, amount]}
								<p class="text-2xl font-bold {amount > 0 ? 'text-red-600' : 'text-green-600'}">
									{formatAmount(amount, curr as Currency)}
								</p>
							{:else}
								<p class="text-2xl font-bold text-green-600">{formatAmount(0, 'RON')}</p>
							{/each}
							<p class="text-xs text-muted-foreground mt-1">
								{credit.unpaidInvoices} factur{credit.unpaidInvoices !== 1 ? 'i' : 'ă'} neachitat{credit.unpaidInvoices !== 1 ? 'e' : 'ă'}
							</p>
						{:else}
							<p class="text-2xl font-bold">—</p>
						{/if}
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

			<!-- Onboarding Control -->
			<ClientOnboardingControl {clientId} />

			<!-- Recent Activity -->
			<Card class="md:col-span-2">
				<CardHeader>
					<CardTitle>Activitate recentă</CardTitle>
					<CardDescription>Ultimele evenimente pentru acest client</CardDescription>
				</CardHeader>
				<CardContent>
					<ClientActivityFeed {clientId} compact />
				</CardContent>
			</Card>
		</div>
	{/if}
</div>
