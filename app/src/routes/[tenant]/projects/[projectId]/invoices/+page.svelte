<script lang="ts">
	import { getInvoices } from '$lib/remotes/invoices.remote';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { formatAmount, type Currency } from '$lib/utils/currency';
	import {
		Table,
		TableBody,
		TableCell,
		TableHead,
		TableHeader,
		TableRow
	} from '$lib/components/ui/table';
	import { Plus } from '@lucide/svelte';

	const tenantSlug = $derived(page.params.tenant);
	const projectId = $derived(page.params.projectId);

	const invoicesQuery = getInvoices({ projectId });
	const invoices = $derived(invoicesQuery.current || []);
	const loading = $derived(invoicesQuery.loading);
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h2 class="text-2xl font-semibold">Invoices</h2>
		<Button onclick={() => goto(`/${tenantSlug}/invoices/new?projectId=${projectId}`)}>
			<Plus class="h-4 w-4 mr-2" />
			New Invoice
		</Button>
	</div>

	{#if loading}
		<p>Loading...</p>
	{:else if invoices.length === 0}
		<Card>
			<CardContent class="pt-6">
				<p class="text-center text-muted-foreground">No invoices for this project yet</p>
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
							<TableCell>{formatAmount(invoice.totalAmount || 0, (invoice.currency || 'RON') as Currency)}</TableCell>
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
