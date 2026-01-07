<script lang="ts">
	import { getInvoices } from '$lib/remotes/invoices.remote';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import {
		Table,
		TableBody,
		TableCell,
		TableHead,
		TableHeader,
		TableRow
	} from '$lib/components/ui/table';

	const tenantSlug = $derived(page.params.tenant);
	const invoicesQuery = getInvoices({});
	const invoices = $derived(invoicesQuery.current || []);
	const loading = $derived(invoicesQuery.loading);
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-3xl font-bold">Invoices</h1>
		<Button onclick={() => goto(`/${tenantSlug}/invoices/new`)}>New Invoice</Button>
	</div>

	{#if loading}
		<p>Loading...</p>
	{:else if invoices.length === 0}
		<Card>
			<CardContent class="pt-6">
				<p class="text-center text-gray-500">No invoices yet</p>
			</CardContent>
		</Card>
	{:else}
		<Card>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Invoice Number</TableHead>
						<TableHead>Status</TableHead>
						<TableHead>Total Amount</TableHead>
						<TableHead>Due Date</TableHead>
						<TableHead>Actions</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{#each invoices as invoice}
						<TableRow>
							<TableCell class="font-medium">{invoice.invoiceNumber}</TableCell>
							<TableCell>{invoice.status}</TableCell>
							<TableCell>€{(invoice.totalAmount / 100).toFixed(2)}</TableCell>
							<TableCell>{invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : '-'}</TableCell>
							<TableCell>
								<Button variant="ghost" size="sm" onclick={() => goto(`/${tenantSlug}/invoices/${invoice.id}`)}>
									View
								</Button>
							</TableCell>
						</TableRow>
					{/each}
				</TableBody>
			</Table>
		</Card>
	{/if}
</div>
