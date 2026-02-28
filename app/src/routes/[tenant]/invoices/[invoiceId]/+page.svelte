<script lang="ts">
	import { getInvoice, markInvoiceAsPaid, sendInvoice, getInvoices } from '$lib/remotes/invoices.remote';
	import { getClient } from '$lib/remotes/clients.remote';
	import { getProject } from '$lib/remotes/projects.remote';
	import { getTransactions } from '$lib/remotes/banking.remote';
	import { getInvoiceSettings } from '$lib/remotes/invoice-settings.remote';
	import { validateInvoiceInKeez, sendInvoiceToEFactura, cancelInvoiceInKeez, getInvoicePDFFromKeez, sendInvoiceEmailFromKeez, syncInvoiceToKeez } from '$lib/remotes/keez.remote';
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
		CreditCard,
		FileText,
		Upload,
		Ban,
		RefreshCw,
		Eye
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

	const projectQuery = $derived(invoice?.projectId ? getProject(invoice.projectId) : null);
	const project = $derived(projectQuery?.current);

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

	// Get currencies from invoice
	const calculationCurrency = $derived((invoice?.currency || 'RON') as Currency);
	const invoiceCurrency = $derived((invoice?.invoiceCurrency || invoice?.currency || 'RON') as Currency);

	// Calculate totals grouped by currency (similar to new invoice page)
	const totalsByCurrency = $derived.by(() => {
		if (!invoice?.lineItems || invoice.lineItems.length === 0) {
			return {};
		}

		const totals: Record<
			string,
			{
				subtotal: number;
				taxTotal: number;
				netValue: number;
				grossValue: number;
				grandTotal: number;
			}
		> = {};

		invoice.lineItems.forEach((item) => {
			const itemCurrency = (item.currency as Currency) || calculationCurrency;
			if (!totals[itemCurrency]) {
				totals[itemCurrency] = {
					subtotal: 0,
					taxTotal: 0,
					netValue: 0,
					grossValue: 0,
					grandTotal: 0
				};
			}

			const itemSubtotal = (item.quantity * item.rate) / 100;
			const itemTaxRate = item.taxRate ? item.taxRate / 100 : 0;

			// Calculate discount
			let itemDiscount = 0;
			if (item.discountType === 'percent' && item.discount) {
				itemDiscount = (itemSubtotal * item.discount) / 100;
			} else if (item.discountType === 'fixed' && item.discount) {
				itemDiscount = item.discount / 100;
			}

			const itemNetValue = itemSubtotal - itemDiscount;

			// Calculate tax based on tax application type
			const itemTax =
				invoice.taxApplicationType === 'apply' ? (itemNetValue * itemTaxRate) / 100 : 0;

			totals[itemCurrency].subtotal += itemSubtotal;
			totals[itemCurrency].taxTotal += itemTax;
		});

		// Apply invoice-level discount to primary currency
		Object.keys(totals).forEach((curr) => {
			const currSubtotal = totals[curr].subtotal;
			const currTaxTotal = totals[curr].taxTotal;

			// Apply invoice discount only to the primary currency (calculation currency)
			let discountAmount = 0;
			if (curr === calculationCurrency && invoice.discountType && invoice.discountType !== 'none' && invoice.discountValue) {
				if (invoice.discountType === 'percent') {
					discountAmount = (currSubtotal * invoice.discountValue) / 100;
				} else {
					discountAmount = invoice.discountValue / 100;
				}
			}

			totals[curr].netValue = currSubtotal - discountAmount;
			totals[curr].grossValue = totals[curr].netValue + currTaxTotal;
			totals[curr].grandTotal = totals[curr].grossValue;
		});

		return totals;
	});

	// Legacy totals for backward compatibility (primary currency)
	const subtotal = $derived(totalsByCurrency[calculationCurrency]?.subtotal || 0);
	const taxTotal = $derived(totalsByCurrency[calculationCurrency]?.taxTotal || 0);
	const invoiceDiscountAmount = $derived.by(() => {
		if (!invoice || !invoice.discountType || invoice.discountType === 'none' || !invoice.discountValue) return 0;
		if (invoice.discountType === 'percent') {
			return (subtotal * invoice.discountValue) / 100;
		}
		return invoice.discountValue / 100; // value type
	});
	const netValue = $derived(totalsByCurrency[calculationCurrency]?.netValue || 0);
	const grossValue = $derived(totalsByCurrency[calculationCurrency]?.grossValue || 0);
	const grandTotal = $derived(totalsByCurrency[calculationCurrency]?.grandTotal || 0);

	// Get line items with all fields
	const lineItems = $derived(
		invoice?.lineItems && invoice.lineItems.length > 0
			? invoice.lineItems.map((item) => {
					const itemSubtotal = (item.quantity * item.rate) / 100;
					const itemTaxRate = item.taxRate ? item.taxRate / 100 : 0;

					// Calculate discount
					let itemDiscount = 0;
					if (item.discountType === 'percent' && item.discount) {
						itemDiscount = (itemSubtotal * item.discount) / 100;
					} else if (item.discountType === 'fixed' && item.discount) {
						itemDiscount = item.discount / 100;
					}

					const itemNetValue = itemSubtotal - itemDiscount;
					const itemTax =
						invoice.taxApplicationType === 'apply' ? (itemNetValue * itemTaxRate) / 100 : 0;
					const itemFinalValue = itemNetValue + itemTax;

					return {
						description: item.description,
						quantity: item.quantity,
						rate: item.rate / 100,
						amount: itemSubtotal,
						taxRate: itemTaxRate,
						discountType: item.discountType,
						discount: item.discount ? item.discount / 100 : 0,
						note: item.note,
						currency: (item.currency as Currency) || calculationCurrency,
						unitOfMeasure: item.unitOfMeasure || 'Pcs',
						netValue: itemNetValue,
						taxValue: itemTax,
						finalValue: itemFinalValue
					};
				})
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

	async function handleValidateInKeez() {
		if (!invoice || !invoiceId) return;
		if (!confirm('Validează factura în Keez? Factura va deveni factură fiscală și nu mai poate fi ștearsă.')) {
			return;
		}
		try {
			await validateInvoiceInKeez({ invoiceId });
			alert('Factura a fost validată în Keez');
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Validarea facturii în Keez a eșuat');
		}
	}

	async function handleSendToEFactura() {
		if (!invoice || !invoiceId) return;
		if (!confirm('Trimite factura în sistemul eFactura? Factura trebuie să fie validată.')) {
			return;
		}
		try {
			await sendInvoiceToEFactura({ invoiceId });
			alert('Factura a fost trimisă în eFactura');
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Trimiterea în eFactura a eșuat');
		}
	}

	async function handleCancelInKeez() {
		if (!invoice || !invoiceId) return;
		if (!confirm('Anulează factura în Keez? Această acțiune va schimba statusul facturii în Cancelled.')) {
			return;
		}
		try {
			await cancelInvoiceInKeez({ invoiceId });
			alert('Factura a fost anulată în Keez');
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Anularea facturii în Keez a eșuat');
		}
	}

	async function handleDownloadKeezPDF() {
		if (!invoice || !invoiceId) return;
		try {
			const result = await getInvoicePDFFromKeez({ invoiceId });
			const byteCharacters = atob(result.pdf);
			const byteNumbers = new Array(byteCharacters.length);
			for (let i = 0; i < byteCharacters.length; i++) {
				byteNumbers[i] = byteCharacters.charCodeAt(i);
			}
			const byteArray = new Uint8Array(byteNumbers);
			const blob = new Blob([byteArray], { type: 'application/pdf' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `keez-${invoice.invoiceNumber || invoiceId}.pdf`;
			a.click();
			URL.revokeObjectURL(url);
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Descărcarea PDF-ului din Keez a eșuat');
		}
	}

	async function handleSendEmailFromKeez() {
		if (!invoice || !invoiceId) return;
		const email = prompt('Introduceți adresa de email pentru trimiterea facturii:');
		if (!email) return;
		try {
			await sendInvoiceEmailFromKeez({ invoiceId, to: email });
			alert('Factura a fost trimisă pe email din Keez');
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Trimiterea pe email a eșuat');
		}
	}

	async function handleSyncToKeez() {
		if (!invoice || !invoiceId) return;
		if (!confirm('Sincronizează factura în Keez?')) return;
		try {
			await syncInvoiceToKeez({ invoiceId });
			alert('Factura a fost sincronizată în Keez');
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Sincronizarea în Keez a eșuat');
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

	async function handleDownloadPDF() {
		if (!invoiceId) return;
		try {
			const response = await fetch(`/${tenantSlug}/invoices/${invoiceId}/pdf`);
			if (!response.ok) throw new Error('Failed to generate PDF');
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `Factura-${displayInvoiceNumber.replace(/[^a-zA-Z0-9-_]/g, '_')}.pdf`;
			a.click();
			URL.revokeObjectURL(url);
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to download PDF');
		}
	}

	async function handlePreviewPDF() {
		if (!invoiceId) return;
		try {
			const response = await fetch(`/${tenantSlug}/invoices/${invoiceId}/pdf`);
			if (!response.ok) throw new Error('Failed to generate PDF');
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			window.open(url, '_blank');
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to preview PDF');
		}
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
						{#if invoice.keezExternalId}
							{#if invoice.keezStatus === 'Valid'}
								<Badge variant="outline" class="border-green-500 text-green-600 dark:text-green-400">Keez ✓</Badge>
							{:else if invoice.keezStatus === 'Cancelled'}
								<Badge variant="outline" class="border-red-500 text-red-600 dark:text-red-400">Keez Anulată</Badge>
							{:else}
								<Badge variant="outline" class="border-yellow-500 text-yellow-600 dark:text-yellow-400">Keez Proformă</Badge>
							{/if}
						{/if}
						{#if invoice.isCreditNote}
							<Badge variant="outline">Credit Note</Badge>
						{/if}
					</div>
					<p class="text-lg text-muted-foreground">{client?.name || 'Unknown Client'}</p>
				</div>
				<div class="flex gap-2">
					<Button variant="outline" size="icon" onclick={handlePreviewPDF} title="Preview PDF">
						<Eye class="h-4 w-4" />
					</Button>
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
							<h3 class="text-3xl font-bold mb-2">{invoice.isCreditNote ? 'CREDIT NOTE' : (invoice.keezStatus === 'Draft' || (!invoice.keezStatus && invoice.status === 'draft')) ? 'PROFORMA' : 'INVOICE'}</h3>
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
								{#if invoice.invoiceSeries}
									<div class="flex justify-between">
										<span class="text-muted-foreground">Series:</span>
										<span class="font-medium">{invoice.invoiceSeries}</span>
									</div>
								{/if}
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
								{#if invoice.paymentTerms}
									<div class="flex justify-between">
										<span class="text-muted-foreground">Payment Terms:</span>
										<span class="font-medium">{invoice.paymentTerms}</span>
									</div>
								{/if}
								{#if invoice.paymentMethod}
									<div class="flex justify-between">
										<span class="text-muted-foreground">Payment Method:</span>
										<span class="font-medium">{invoice.paymentMethod}</span>
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
								{#if calculationCurrency !== invoiceCurrency}
									<div class="flex justify-between">
										<span class="text-muted-foreground">Calculation Currency:</span>
										<span class="font-medium">{calculationCurrency}</span>
									</div>
									<div class="flex justify-between">
										<span class="text-muted-foreground">Invoice Currency:</span>
										<span class="font-medium">{invoiceCurrency}</span>
									</div>
									{#if invoice.exchangeRate}
										<div class="flex justify-between">
											<span class="text-muted-foreground">Exchange Rate:</span>
											<span class="font-medium">{invoice.exchangeRate}</span>
										</div>
									{/if}
								{/if}
								{#if invoice.taxApplicationType}
									<div class="flex justify-between">
										<span class="text-muted-foreground">Tax Application:</span>
										<span class="font-medium">
											{invoice.taxApplicationType === 'apply'
												? 'Apply Tax (Normala)'
												: invoice.taxApplicationType === 'none'
													? 'Do Not Apply Tax'
													: 'Reverse Tax (Taxare inversa)'}
										</span>
									</div>
								{/if}
								{#if invoice.vatOnCollection}
									<div class="flex justify-between">
										<span class="text-muted-foreground">VAT on Collection:</span>
										<span class="font-medium">Yes</span>
									</div>
								{/if}
								{#if invoice.isCreditNote}
									<div class="flex justify-between">
										<span class="text-muted-foreground">Credit Note:</span>
										<span class="font-medium">Yes</span>
									</div>
								{/if}
							</div>
						</div>
					</div>

					<div class="mb-8">
						<table class="w-full">
							<thead>
								<tr class="border-b">
									<th class="text-left py-3 font-semibold">Item</th>
									<th class="text-left py-3 font-semibold">Unit</th>
									<th class="text-right py-3 font-semibold">Quantity</th>
									<th class="text-right py-3 font-semibold">Unit Price</th>
									<th class="text-right py-3 font-semibold">Discount</th>
									<th class="text-right py-3 font-semibold">Amount</th>
									<th class="text-right py-3 font-semibold">VAT</th>
									<th class="text-right py-3 font-semibold">Final Amount</th>
								</tr>
							</thead>
							<tbody>
								{#each lineItems as item}
									<tr class="border-b">
										<td class="py-4">
											<p class="font-medium">{item.description}</p>
											{#if item.note}
												<p class="text-xs text-muted-foreground mt-1">{item.note}</p>
											{/if}
										</td>
										<td class="py-4">{item.unitOfMeasure}</td>
										<td class="text-right py-4">{item.quantity}</td>
										<td class="text-right py-4">{formatAmount(Math.round(item.rate * 100), item.currency)}</td>
										<td class="text-right py-4">
											{#if item.discountType && item.discount > 0}
												{item.discountType === 'percent' ? `${item.discount}%` : formatAmount(Math.round(item.discount * 100), item.currency)}
											{:else}
												-
											{/if}
										</td>
										<td class="text-right py-4">{formatAmount(Math.round(item.amount * 100), item.currency)}</td>
										<td class="text-right py-4">
											{invoice.taxApplicationType === 'apply' ? `${(item.taxRate * 100).toFixed(0)}%` : '-'}
										</td>
										<td class="text-right py-4 font-medium">{formatAmount(Math.round(item.finalValue * 100), item.currency)}</td>
									</tr>
								{:else}
									<tr>
										<td colspan="8" class="py-8 text-center text-muted-foreground">
											No items found
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>

					<div class="flex justify-end">
						<div class="w-64 space-y-2">
							<div class="flex justify-between">
								<span class="text-muted-foreground">Subtotal:</span>
								<span class="font-medium">{formatAmount(Math.round(subtotal * 100), calculationCurrency)}</span>
							</div>
							{#if invoice.discountType && invoice.discountType !== 'none' && invoiceDiscountAmount > 0}
								<div class="flex justify-between">
									<span class="text-muted-foreground">Discount:</span>
									<span class="font-medium">-{formatAmount(Math.round(invoiceDiscountAmount * 100), calculationCurrency)}</span>
								</div>
							{/if}
							{#if invoice.taxApplicationType === 'apply' && taxTotal > 0}
								<div class="flex justify-between">
									<span class="text-muted-foreground">Tax Total:</span>
									<span class="font-medium">{formatAmount(Math.round(taxTotal * 100), calculationCurrency)}</span>
								</div>
							{/if}
							<Separator />
							<div class="flex justify-between text-lg">
								<span class="font-semibold">Grand Total:</span>
								<span class="font-bold">{formatAmount(Math.round(grandTotal * 100), invoiceCurrency)}</span>
							</div>
							{#if calculationCurrency !== invoiceCurrency && invoice.exchangeRate}
								<div class="text-xs text-muted-foreground mt-2">
									Exchange Rate: {invoice.exchangeRate}
								</div>
							{/if}
						</div>
					</div>
				</Card>

				{#if invoice.notes}
					<Card class="p-6">
						<CardHeader>
							<CardTitle>Notes</CardTitle>
						</CardHeader>
						<CardContent>
							<p class="text-sm text-muted-foreground whitespace-pre-wrap">{invoice.notes}</p>
						</CardContent>
					</Card>
				{/if}

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
							<div class="flex items-center gap-2 flex-wrap">
								<Badge variant={getStatusVariant(invoice.status)}>
									{#if invoice.status === 'sent' && invoice.lastEmailStatus === 'sent'}
										<Mail class="mr-1 h-3 w-3" />
									{/if}
									{invoice.status}
								</Badge>
								{#if invoice.isCreditNote}
									<Badge variant="outline">Credit Note</Badge>
								{/if}
								{#if invoice.vatOnCollection}
									<Badge variant="outline">VAT on Collection</Badge>
								{/if}
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
							<p class="text-2xl font-bold">{formatAmount(Math.round(grandTotal * 100), invoiceCurrency)}</p>
							{#if calculationCurrency !== invoiceCurrency}
								<p class="text-xs text-muted-foreground mt-1">
									{formatAmount(Math.round(grandTotal * 100), calculationCurrency)} {calculationCurrency}
								</p>
							{/if}
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
						{#if invoice.paymentTerms}
							<div class="flex items-center gap-2">
								<CreditCard class="h-4 w-4 text-muted-foreground" />
								<div>
									<p class="text-sm text-muted-foreground">Payment Terms</p>
									<p class="font-medium">{invoice.paymentTerms}</p>
								</div>
							</div>
						{/if}
						{#if invoice.paymentMethod}
							<div class="flex items-center gap-2">
								<CreditCard class="h-4 w-4 text-muted-foreground" />
								<div>
									<p class="text-sm text-muted-foreground">Payment Method</p>
									<p class="font-medium">{invoice.paymentMethod}</p>
								</div>
							</div>
						{/if}
					</CardContent>
				</Card>

				{#if project}
					<Card class="p-6">
						<CardHeader>
							<CardTitle>Project</CardTitle>
						</CardHeader>
						<CardContent>
							<p class="font-medium mb-2">{project.name}</p>
							{#if project.description}
								<p class="text-sm text-muted-foreground mb-4">{project.description}</p>
							{/if}
							<Button
								variant="outline"
								class="w-full bg-transparent"
								onclick={() => goto(`/${tenantSlug}/projects/${project.id}`)}
							>
								View Project
							</Button>
						</CardContent>
					</Card>
				{/if}

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
							{#if client.cui}
								<div class="flex items-center gap-3">
									<Building2 class="h-5 w-5 text-muted-foreground" />
									<div>
										<p class="text-sm text-muted-foreground">CUI</p>
										<p class="font-medium">{client.cui}</p>
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
							{#if client.iban}
								<div class="flex items-center gap-3">
									<CreditCard class="h-5 w-5 text-muted-foreground" />
									<div>
										<p class="text-sm text-muted-foreground">IBAN</p>
										<p class="font-medium">{client.iban}</p>
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
							{#if !invoice.keezExternalId}
								<Button variant="outline" class="w-full bg-transparent" onclick={handleSyncToKeez}>
									<Upload class="mr-2 h-4 w-4" />
									Sincronizează în Keez
								</Button>
							{/if}
							{#if invoice.keezExternalId}
								<Button variant="outline" class="w-full bg-transparent" onclick={handleValidateInKeez}>
									<CheckCircle2 class="mr-2 h-4 w-4" />
									Validează în Keez
								</Button>
								<Button variant="outline" class="w-full bg-transparent" onclick={handleSendToEFactura}>
									<FileText class="mr-2 h-4 w-4" />
									Trimite eFactura
								</Button>
								<Button variant="outline" class="w-full bg-transparent" onclick={handleSendEmailFromKeez}>
									<Mail class="mr-2 h-4 w-4" />
									Trimite pe Email (Keez)
								</Button>
								<Button variant="outline" class="w-full bg-transparent" onclick={handleDownloadKeezPDF}>
									<Download class="mr-2 h-4 w-4" />
									Descarcă PDF Keez
								</Button>
								<Button variant="outline" class="w-full bg-transparent" onclick={handleCancelInKeez}>
									<Ban class="mr-2 h-4 w-4" />
									Anulează în Keez
								</Button>
							{/if}
						</CardContent>
					</Card>
				{/if}
			</div>
		</div>
	{:else}
		<p>Invoice not found</p>
	{/if}
</div>
