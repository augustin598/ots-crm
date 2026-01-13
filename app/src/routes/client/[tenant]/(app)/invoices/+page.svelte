<script lang="ts">
	import { getInvoices } from '$lib/remotes/invoices.remote';
	import { page } from '$app/state';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Receipt } from '@lucide/svelte';
	import { formatAmount, type Currency } from '$lib/utils/currency';

	const tenantSlug = $derived(page.params.tenant as string);

	const invoicesQuery = getInvoices({});
	const invoices = $derived(invoicesQuery.current || []);
	const loading = $derived(invoicesQuery.loading);

	function getStatusColor(status: string): string {
		switch (status) {
			case 'paid':
				return 'bg-green-100 text-green-700';
			case 'sent':
				return 'bg-blue-100 text-blue-700';
			case 'overdue':
				return 'bg-red-100 text-red-700';
			case 'draft':
				return 'bg-gray-100 text-gray-700';
			case 'cancelled':
				return 'bg-red-100 text-red-700';
			default:
				return 'bg-gray-100 text-gray-700';
		}
	}

	function formatDate(date: Date | string | null | undefined): string {
		if (!date) return '-';
		try {
			const d = date instanceof Date ? date : new Date(date);
			return d.toLocaleDateString('ro-RO', { year: 'numeric', month: 'short', day: 'numeric' });
		} catch {
			return '-';
		}
	}
</script>

<div class="space-y-6">
	<div>
		<h1 class="text-3xl font-bold">Invoices</h1>
		<p class="text-muted-foreground">View your invoices</p>
	</div>

	{#if loading}
		<p class="text-muted-foreground">Loading invoices...</p>
	{:else if invoices.length === 0}
		<Card>
			<CardContent class="pt-6">
				<p class="text-center text-muted-foreground">No invoices yet.</p>
			</CardContent>
		</Card>
	{:else}
		<div class="space-y-4">
			{#each invoices as invoice}
				<Card>
					<CardHeader>
						<div class="flex items-start justify-between">
							<div class="flex items-center gap-3">
								<Receipt class="h-5 w-5 text-muted-foreground" />
								<div>
									<CardTitle class="text-lg">{invoice.invoiceNumber}</CardTitle>
									<div class="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
										{#if invoice.issueDate}
											<span>Issue Date: {formatDate(invoice.issueDate)}</span>
										{/if}
										{#if invoice.dueDate}
											<span>Due: {formatDate(invoice.dueDate)}</span>
										{/if}
									</div>
								</div>
							</div>
							<div class="flex items-center gap-4">
								{#if invoice.totalAmount}
									<div class="text-right">
										<p class="text-lg font-semibold">
											{formatAmount(invoice.totalAmount, invoice.currency as Currency)}
										</p>
									</div>
								{/if}
								<Badge class={getStatusColor(invoice.status)}>{invoice.status}</Badge>
							</div>
						</div>
					</CardHeader>
				</Card>
			{/each}
		</div>
	{/if}
</div>
