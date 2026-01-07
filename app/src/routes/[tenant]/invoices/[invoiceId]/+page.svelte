<script lang="ts">
	import { getInvoice } from '$lib/remotes/invoices.remote';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';

	const tenantSlug = $derived(page.params.tenant);
	const invoiceId = $derived(page.params.invoiceId);

	const invoiceQuery = getInvoice(invoiceId);
	const invoice = $derived(invoiceQuery.current);
	const loading = $derived(invoiceQuery.loading);
</script>

<div class="space-y-6">
	{#if loading}
		<p>Loading invoice...</p>
	{:else if invoice}
		<div class="flex items-center justify-between">
			<h1 class="text-3xl font-bold">Invoice {invoice.invoiceNumber}</h1>
		</div>

		<Card>
			<CardHeader>
				<CardTitle>Invoice Details</CardTitle>
			</CardHeader>
			<CardContent class="space-y-2">
				<div>
					<span class="font-semibold">Invoice Number:</span> {invoice.invoiceNumber}
				</div>
				<div>
					<span class="font-semibold">Status:</span> {invoice.status}
				</div>
				<div>
					<span class="font-semibold">Amount:</span> €{(invoice.amount / 100).toFixed(2)}
				</div>
				{#if invoice.taxAmount}
					<div>
						<span class="font-semibold">Tax ({invoice.taxRate / 100}%):</span> €{(invoice.taxAmount / 100).toFixed(2)}
					</div>
				{/if}
				<div>
					<span class="font-semibold">Total:</span> €{(invoice.totalAmount / 100).toFixed(2)}
				</div>
				{#if invoice.issueDate}
					<div>
						<span class="font-semibold">Issue Date:</span> {new Date(invoice.issueDate).toLocaleDateString()}
					</div>
				{/if}
				{#if invoice.dueDate}
					<div>
						<span class="font-semibold">Due Date:</span> {new Date(invoice.dueDate).toLocaleDateString()}
					</div>
				{/if}
			</CardContent>
		</Card>
	{:else}
		<p>Invoice not found</p>
	{/if}
</div>
