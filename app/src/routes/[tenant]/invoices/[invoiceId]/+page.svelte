<script lang="ts">
	import { getInvoice, markInvoiceAsPaid, sendInvoice, getInvoices } from '$lib/remotes/invoices.remote';
	import { getClient } from '$lib/remotes/clients.remote';
	import { getTransactions } from '$lib/remotes/banking.remote';
	import { getInvoiceSettings } from '$lib/remotes/invoice-settings.remote';
	import { formatInvoiceNumberDisplay } from '$lib/utils/invoice';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Separator } from '$lib/components/ui/separator';
	import { formatAmount, type Currency } from '$lib/utils/currency';
	import {
		ArrowLeft,
		Download,
		Send,
		Mail,
		Phone,
		Building2,
		Calendar,
		Edit,
		CheckCircle2,
		CreditCard
	} from '@lucide/svelte';

	const tenantSlug = $derived(page.params.tenant);
	const invoiceId = $derived(page.params.invoiceId || '');

	const invoiceQuery = getInvoice(invoiceId);
	const invoice = $derived(invoiceQuery.current);
	const loading = $derived(invoiceQuery.loading);

	const invoiceSettingsQuery = getInvoiceSettings();
	const invoiceSettings = $derived(invoiceSettingsQuery.current);

	const clientQuery = $derived(invoice?.clientId ? getClient(invoice.clientId) : null);
	const client = $derived(clientQuery?.current);

	const matchedTransactionsQuery = $derived(
		invoice?.id ? getTransactions({ matched: true }) : null
	);
	const matchedTransactions = $derived(
		matchedTransactionsQuery?.current?.filter((t) => t.matchedInvoiceId === invoice?.id) || []
	);

	// Get tenant data from layout
	let { data }: { data: any } = $props();
	const tenant = $derived(data?.tenant);

	const displayInvoiceNumber = $derived(invoice ? formatInvoiceNumberDisplay(invoice, invoiceSettings) : '');

	function getStatusVariant(status: string) {
		switch (status) {
			case 'paid':
				return 'success';
			case 'overdue':
				return 'destructive';
			case 'sent':
				return 'secondary';
			case 'draft':
				return 'outline';
			default:
				return 'secondary';
		}
	}

	// Get currency from invoice (default to RON)
	const invoiceCurrency = $derived((invoice?.currency || 'RON') as Currency);

	// Calculate amounts
	const subtotal = $derived(invoice ? (invoice.amount || 0) / 100 : 0);
	const taxRate = $derived(invoice ? (invoice.taxRate || 0) / 100 : 0);
	const tax = $derived(invoice ? (invoice.taxAmount || 0) / 100 : 0);
	const total = $derived(invoice ? (invoice.totalAmount || 0) / 100 : 0);

	// Get line items or create a default one from invoice amount
	const lineItems = $derived(
		invoice?.lineItems && invoice.lineItems.length > 0
			? invoice.lineItems.map((item) => ({
					description: item.description,
					quantity: item.quantity,
					rate: item.rate / 100,
					amount: item.amount / 100
				}))
			: invoice
				? [
						{
							description: invoice.notes || 'Professional Services',
							quantity: 1,
							rate: subtotal,
							amount: subtotal
						}
					]
				: []
	);

	async function handleSendInvoice() {
		if (!invoice || !invoiceId) return;
		try {
			await sendInvoice(invoiceId).updates(invoiceQuery, getInvoice(invoiceId), getInvoices({}));
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to send invoice');
		}
	}

	async function handleMarkAsPaid() {
		if (!invoice || !invoiceId) return;
		try {
			await markInvoiceAsPaid(invoiceId).updates(invoiceQuery, getInvoice(invoiceId), getInvoices({}));
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to mark invoice as paid');
		}
	}

	function handleDownloadPDF() {
		// TODO: Implement PDF download
		alert('PDF download will be implemented soon');
	}

	function formatAddress() {
		if (!tenant) return '';
		const parts = [tenant.address, tenant.city, tenant.county, tenant.postalCode].filter(Boolean);
		return parts.join(', ') || '';
	}

	function formatClientAddress() {
		if (!client) return '';
		const parts = [client.address, client.city, client.county, client.postalCode].filter(Boolean);
		return parts.join(', ') || '';
	}

	function isValidDate(date: Date | string | null | undefined): boolean {
		if (!date) return false;
		try {
			const d = date instanceof Date ? date : new Date(date);
			return !isNaN(d.getTime()) && d.getFullYear() > 1970;
		} catch {
			return false;
		}
	}

	function formatDate(date: Date | string | null | undefined): string {
		if (!date) return '-';
		try {
			const d = date instanceof Date ? date : new Date(date);
			if (!isNaN(d.getTime()) && d.getFullYear() > 1970) {
				return d.toLocaleDateString();
			}
		} catch {
			// ignore
		}
		return '-';
	}
</script>

<svelte:head>
	<title>Invoice {displayInvoiceNumber || ''} - CRM</title>
</svelte:head>

<div class="space-y-6">
	{#if loading}
		<p>Loading invoice...</p>
	{:else if invoice}
		<div class="mb-6">
			<Button variant="ghost" size="sm" class="mb-4" onclick={() => goto(`/${tenantSlug}/invoices`)}>
				<ArrowLeft class="mr-2 h-4 w-4" />
				Back to Invoices
			</Button>

			<div class="flex items-start justify-between">
				<div>
					<div class="flex items-center gap-3 mb-2">
						<h1 class="text-3xl font-bold tracking-tight">{displayInvoiceNumber}</h1>
						<Badge variant={getStatusVariant(invoice.status)}>{invoice.status}</Badge>
					</div>
					<p class="text-lg text-muted-foreground">{client?.name || 'Unknown Client'}</p>
				</div>
				<div class="flex gap-2">
					<Button variant="outline" onclick={handleDownloadPDF}>
						<Download class="mr-2 h-4 w-4" />
						Download PDF
					</Button>
					{#if invoice.status !== 'paid'}
						<Button variant="outline" onclick={handleSendInvoice}>
							<Send class="mr-2 h-4 w-4" />
							Send Invoice
						</Button>
					{/if}
					<Button onclick={() => goto(`/${tenantSlug}/invoices/${invoiceId}/edit`)}>
						<Edit class="mr-2 h-4 w-4" />
						Edit
					</Button>
				</div>
			</div>
		</div>

		<div class="grid gap-6 lg:grid-cols-3">
			<div class="lg:col-span-2 space-y-6">
				<Card class="p-8">
					<div class="flex justify-between items-start mb-8">
						<div>
							<h2 class="text-2xl font-bold mb-2">{tenant?.name || 'Your Company Name'}</h2>
							{#if tenant?.address}
								<p class="text-muted-foreground">{tenant.address}</p>
							{/if}
							{#if tenant?.city}
								<p class="text-muted-foreground">
									{tenant.city}
									{#if tenant.county}, {tenant.county}{/if}
									{#if tenant.postalCode} {tenant.postalCode}{/if}
								</p>
							{/if}
							{#if tenant?.email}
								<p class="text-muted-foreground">{tenant.email}</p>
							{/if}
						</div>
						<div class="text-right">
							<h3 class="text-3xl font-bold mb-2">INVOICE</h3>
							<p class="text-muted-foreground">{displayInvoiceNumber}</p>
						</div>
					</div>

					<Separator class="my-6" />

					<div class="grid md:grid-cols-2 gap-8 mb-8">
						<div>
							<h4 class="font-semibold mb-2">Bill To:</h4>
							<p class="font-medium">{client?.name || 'Unknown Client'}</p>
							{#if client?.companyType}
								<p class="text-muted-foreground">{client.companyType}</p>
							{/if}
							{#if client?.email}
								<p class="text-muted-foreground">{client.email}</p>
							{/if}
							{#if client?.phone}
								<p class="text-muted-foreground">{client.phone}</p>
							{/if}
							{#if formatClientAddress()}
								<p class="text-muted-foreground">{formatClientAddress()}</p>
							{/if}
						</div>
						<div>
							<div class="space-y-2">
								{#if invoice.issueDate}
									<div class="flex justify-between">
										<span class="text-muted-foreground">Issue Date:</span>
										<span class="font-medium">{new Date(invoice.issueDate).toLocaleDateString()}</span>
									</div>
								{/if}
								{#if isValidDate(invoice.dueDate)}
									<div class="flex justify-between">
										<span class="text-muted-foreground">Due Date:</span>
										<span class="font-medium">{formatDate(invoice.dueDate)}</span>
									</div>
								{/if}
								{#if invoice.paidDate}
									<div class="flex justify-between">
										<span class="text-muted-foreground">Paid Date:</span>
										<span class="font-medium text-green-600">
											{new Date(invoice.paidDate).toLocaleDateString()}
										</span>
									</div>
								{/if}
							</div>
						</div>
					</div>

					<div class="mb-8">
						<table class="w-full">
							<thead>
								<tr class="border-b">
									<th class="text-left py-3 font-semibold">Description</th>
									<th class="text-right py-3 font-semibold">Quantity</th>
									<th class="text-right py-3 font-semibold">Rate</th>
									<th class="text-right py-3 font-semibold">Amount</th>
								</tr>
							</thead>
							<tbody>
								{#each lineItems as item}
									<tr class="border-b">
										<td class="py-4">
											<p class="font-medium">{item.description}</p>
										</td>
										<td class="text-right py-4">{item.quantity}</td>
										<td class="text-right py-4">{formatAmount(Math.round(item.rate * 100), invoiceCurrency)}</td>
										<td class="text-right py-4 font-medium">{formatAmount(Math.round(item.amount * 100), invoiceCurrency)}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>

					<div class="flex justify-end">
						<div class="w-64 space-y-2">
							<div class="flex justify-between">
								<span class="text-muted-foreground">Subtotal:</span>
								<span class="font-medium">{formatAmount(invoice?.amount || 0, invoiceCurrency)}</span>
							</div>
							{#if tax > 0}
								<div class="flex justify-between">
									<span class="text-muted-foreground">Tax ({taxRate.toFixed(2)}%):</span>
									<span class="font-medium">{formatAmount(invoice?.taxAmount || 0, invoiceCurrency)}</span>
								</div>
							{/if}
							<Separator />
							<div class="flex justify-between text-lg">
								<span class="font-semibold">Total:</span>
								<span class="font-bold">{formatAmount(invoice?.totalAmount || 0, invoiceCurrency)}</span>
							</div>
						</div>
					</div>
				</Card>

				{#if invoice.status === 'paid'}
					<Card class="p-6 bg-green-50 border-green-200">
						<div class="flex items-center gap-3">
							<div class="flex h-12 w-12 items-center justify-center rounded-full bg-green-500 text-white">
								<CheckCircle2 class="h-6 w-6" />
							</div>
							<div class="flex-1">
								<h4 class="font-semibold text-green-900">Payment Received</h4>
								<p class="text-sm text-green-700">
									This invoice was paid on
									{#if invoice.paidDate}
										{new Date(invoice.paidDate).toLocaleDateString()}
									{/if}
								</p>
								{#if matchedTransactions.length > 0}
									{@const txn = matchedTransactions[0]}
									<p class="text-xs text-green-600 mt-1">
										Paid via bank transaction {txn.matchingMethod === 'manual' ? '(manually matched)' : '(auto-matched)'}
									</p>
								{/if}
							</div>
						</div>
					</Card>
				{/if}
			</div>

			<div class="space-y-6">
				<Card class="p-6">
					<CardHeader>
						<CardTitle>Invoice Summary</CardTitle>
					</CardHeader>
					<CardContent class="space-y-4">
						<div>
							<p class="text-sm text-muted-foreground mb-1">Status</p>
							<div class="flex items-center gap-2">
								<Badge variant={getStatusVariant(invoice.status)}>
									{#if invoice.status === 'sent' && invoice.lastEmailStatus === 'sent'}
										<Mail class="mr-1 h-3 w-3" />
									{/if}
									{invoice.status}
								</Badge>
							</div>
							{#if invoice.lastEmailSentAt && invoice.lastEmailStatus}
								<div class="mt-2">
									<p class="text-xs text-muted-foreground">
										Email {invoice.lastEmailStatus === 'sent' ? 'trimis' : invoice.lastEmailStatus === 'failed' ? 'eșuat' : 'pending'} pe {formatDate(invoice.lastEmailSentAt)}
									</p>
								</div>
							{/if}
						</div>
						<Separator />
						<div>
							<p class="text-sm text-muted-foreground mb-1">Total Amount</p>
							<p class="text-2xl font-bold">{formatAmount(invoice?.totalAmount || 0, invoiceCurrency)}</p>
						</div>
						<Separator />
						{#if isValidDate(invoice.dueDate)}
							<div class="flex items-center gap-2">
								<Calendar class="h-4 w-4 text-muted-foreground" />
								<div>
									<p class="text-sm text-muted-foreground">Due Date</p>
									<p class="font-medium">{formatDate(invoice.dueDate)}</p>
								</div>
							</div>
						{/if}
					</CardContent>
				</Card>

				{#if client}
					<Card class="p-6">
						<CardHeader>
							<CardTitle>Client Information</CardTitle>
						</CardHeader>
						<CardContent class="space-y-3">
							{#if client.companyType || client.name}
								<div class="flex items-center gap-3">
									<Building2 class="h-5 w-5 text-muted-foreground" />
									<div>
										<p class="text-sm text-muted-foreground">Company</p>
										<p class="font-medium">{client.companyType || client.name}</p>
									</div>
								</div>
							{/if}
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
						</CardContent>
						<CardContent>
							<Button
								variant="outline"
								class="w-full bg-transparent"
								onclick={() => goto(`/${tenantSlug}/clients/${client.id}`)}
							>
								View Client Profile
							</Button>
						</CardContent>
					</Card>
				{/if}

				{#if invoice.status !== 'paid'}
					<Card class="p-6">
						<CardHeader>
							<CardTitle>Quick Actions</CardTitle>
						</CardHeader>
						<CardContent class="space-y-2">
							<Button class="w-full" onclick={handleSendInvoice}>
								<Send class="mr-2 h-4 w-4" />
								Send Reminder
							</Button>
							<Button variant="outline" class="w-full bg-transparent" onclick={handleMarkAsPaid}>
								<CheckCircle2 class="mr-2 h-4 w-4" />
								Mark as Paid
							</Button>
						</CardContent>
					</Card>
				{/if}
			</div>
		</div>
	{:else}
		<p>Invoice not found</p>
	{/if}
</div>
