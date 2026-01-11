<script lang="ts">
	import { getInvoices } from '$lib/remotes/invoices.remote';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { formatAmount, type Currency } from '$lib/utils/currency';
	import { FileText } from '@lucide/svelte';
	import { Plus } from '@lucide/svelte';

	const tenantSlug = $derived(page.params.tenant as string);
	const clientId = $derived(page.params.clientId as string);

	const invoicesQuery = getInvoices({ clientId });
	const invoices = $derived(invoicesQuery.current || []);
	const loading = $derived(invoicesQuery.loading);
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h2 class="text-2xl font-semibold">Invoices</h2>
		<Button onclick={() => goto(`/${tenantSlug}/invoices/new?clientId=${clientId}`)}>
			<Plus class="h-4 w-4 mr-2" />
			New Invoice
		</Button>
	</div>

	{#if loading}
		<p>Loading...</p>
	{:else if invoices.length === 0}
		<Card>
			<CardContent class="pt-6">
				<p class="text-center text-muted-foreground">No invoices for this client yet</p>
			</CardContent>
		</Card>
	{:else}
		<div class="space-y-4">
			{#each invoices as invoice}
				<Card class="p-6">
					<div class="flex items-center justify-between">
						<div>
							<h3 class="text-lg font-semibold">{invoice.invoiceNumber}</h3>
							<p class="text-sm text-muted-foreground mt-1">
								Issued: {invoice.issueDate ? new Date(invoice.issueDate).toLocaleDateString() : '—'} •
								{' '}Due: {invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : '—'}
							</p>
							{#if invoice.paidDate}
								<p class="text-sm text-muted-foreground">
									Paid: {new Date(invoice.paidDate).toLocaleDateString()}
								</p>
							{/if}
						</div>
						<div class="text-right">
							<p class="text-2xl font-bold">
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
								class="mt-2"
							>
								{invoice.status}
							</Badge>
						</div>
					</div>
					<div class="mt-4">
						<Button variant="outline" class="bg-transparent" onclick={() => goto(`/${tenantSlug}/invoices/${invoice.id}`)}>
							View Details
						</Button>
					</div>
				</Card>
			{/each}
		</div>
	{/if}
</div>
