<script lang="ts">
	import { getInvoice, markInvoiceAsPaid, sendInvoice, getInvoices, deleteInvoice } from '$lib/remotes/invoices.remote';
	import { getClient } from '$lib/remotes/clients.remote';
	import { getTransactions } from '$lib/remotes/banking.remote';
	import { getInvoiceSettings } from '$lib/remotes/invoice-settings.remote';
	import { formatInvoiceNumberDisplay } from '$lib/utils/invoice';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Separator } from '$lib/components/ui/separator';
	import { formatAmount, type Currency } from '$lib/utils/currency';
	import {
		ArrowLeft,
		ArrowRight,
		ChevronLeft,
		ChevronRight,
		Download,
		Send,
		Mail,
		Phone,
		Building2,
		Calendar,
		Edit,
		CheckCircle2,
		CreditCard,
		Unlock,
		X,
		Trash2,
		Copy,
		FileText,
		Paperclip,
		FileCheck
	} from '@lucide/svelte';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { toast } from 'svelte-sonner';

	const tenantSlug = $derived(page.params.tenant);
	const invoiceId = $derived(page.params.invoiceId || '');

	const invoiceQuery = getInvoice(invoiceId);
	const invoice = $derived(invoiceQuery.current);
	const loading = $derived(invoiceQuery.loading);

	const invoiceSettingsQuery = getInvoiceSettings();
	const invoiceSettings = $derived(invoiceSettingsQuery.current);

	const clientQuery = $derived(invoice?.clientId ? getClient(invoice.clientId) : null);
	const client = $derived(clientQuery?.current);

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

	function getStatusLabel(status: string) {
		switch (status) {
			case 'paid':
				return 'Plătită';
			case 'overdue':
				return 'Restantă';
			case 'sent':
				return 'Trimisă';
			case 'draft':
				return 'Ciornă';
			case 'validated':
			case 'validată':
				return 'Validată';
			default:
				return status;
		}
	}

	// Get currency from invoice (default to RON)
	const invoiceCurrency = $derived((invoice?.currency || 'RON') as Currency);

	// Calculate amounts
	const subtotal = $derived(invoice ? (invoice.amount || 0) / 100 : 0);
	const taxRate = $derived(invoice ? (invoice.taxRate || 0) / 100 : 0);
	const tax = $derived(invoice ? (invoice.taxAmount || 0) / 100 : 0);
	const total = $derived(invoice ? (invoice.totalAmount || 0) / 100 : 0);
	const balance = $derived(total); // For now, balance equals total

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
			toast.success('Factura a fost trimisă cu succes');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la trimiterea facturii');
		}
	}

	async function handleMarkAsPaid() {
		if (!invoice || !invoiceId) return;
		try {
			await markInvoiceAsPaid(invoiceId).updates(invoiceQuery, getInvoice(invoiceId), getInvoices({}));
			toast.success('Factura a fost marcată ca plătită');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la marcarea facturii');
		}
	}

	function handleDownloadPDF() {
		// TODO: Implement PDF download
		toast.info('Descărcarea PDF va fi implementată în curând');
	}

	function formatDate(date: Date | string | null | undefined): string {
		if (!date) return '-';
		try {
			const d = date instanceof Date ? date : new Date(date);
			if (!isNaN(d.getTime()) && d.getFullYear() > 1970) {
				return d.toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' });
			}
		} catch {
			// ignore
		}
		return '-';
	}

	function formatDateShort(date: Date | string | null | undefined): string {
		if (!date) return '';
		try {
			const d = date instanceof Date ? date : new Date(date);
			if (!isNaN(d.getTime()) && d.getFullYear() > 1970) {
				return d.toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' });
			}
		} catch {
			// ignore
		}
		return '';
	}

	async function handleDelete() {
		if (!confirm('Sigur doriți să ștergeți această factură?')) return;
		try {
			await deleteInvoice(invoiceId);
			toast.success('Factura a fost ștearsă');
			goto(`/${tenantSlug}/invoices`);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la ștergerea facturii');
		}
	}

	function handleCopy() {
		// TODO: Implement copy invoice
		toast.info('Copierea facturii va fi implementată în curând');
	}

	function handleCancel() {
		// TODO: Implement cancel invoice
		toast.info('Anularea facturii va fi implementată în curând');
	}

	function handleUnlock() {
		// TODO: Implement unlock invoice
		toast.info('Deblocarea facturii va fi implementată în curând');
	}

	function handleCreditNote() {
		// TODO: Implement credit note
		toast.info('Stornarea facturii va fi implementată în curând');
	}

	function handleAttachFile() {
		// TODO: Implement attach file
		toast.info('Atașarea fișierului va fi implementată în curând');
	}

	function handleEFactura() {
		// TODO: Implement eFactura
		toast.info('eFactura va fi implementată în curând');
	}

	// Navigation functions (placeholder - would need to fetch previous/next invoices)
	function handlePrevious() {
		toast.info('Navigarea către factura anterioară');
	}

	function handleNext() {
		toast.info('Navigarea către factura următoare');
	}
</script>

<svelte:head>
	<title>Factură {displayInvoiceNumber || ''} - CRM</title>
</svelte:head>

<div class="min-h-screen bg-gray-50">
	{#if loading}
		<div class="flex items-center justify-center min-h-screen">
			<p>Se încarcă factura...</p>
		</div>
	{:else if invoice}
		<!-- Top Navigation Bar -->
		<div class="bg-white border-b border-gray-200 px-6 py-4">
			<div class="flex items-center justify-between">
				<!-- Left: Navigation and Invoice Info -->
				<div class="flex items-center gap-4">
					<button
						onclick={handlePrevious}
						class="p-2 hover:bg-gray-100 rounded-md transition-colors"
						title="Factura anterioară"
					>
						<ChevronLeft class="h-5 w-5 text-gray-600" />
					</button>
					<button
						onclick={handleNext}
						class="p-2 hover:bg-gray-100 rounded-md transition-colors"
						title="Factura următoare"
					>
						<ChevronRight class="h-5 w-5 text-gray-600" />
					</button>
					<div class="flex items-center gap-3">
						<span class="text-gray-600">{formatDateShort(invoice.issueDate)}</span>
						<span class="text-gray-400">-</span>
						<span class="font-semibold text-gray-900">{displayInvoiceNumber}</span>
						<span class="text-gray-400">-</span>
						<span class="text-gray-600">{client?.name || 'Client necunoscut'}</span>
					</div>
				</div>

				<!-- Center: Status Badge -->
				<div class="flex-1 flex justify-center">
					<Badge variant={getStatusVariant(invoice.status)} class="px-4 py-1.5 text-sm">
						{getStatusLabel(invoice.status)}
					</Badge>
				</div>

				<!-- Right: Back Button -->
				<Button
					variant="ghost"
					class="bg-pink-500 hover:bg-pink-600 text-white border-0"
					onclick={() => goto(`/${tenantSlug}/invoices`)}
				>
					ÎNAPOI
				</Button>
			</div>
		</div>

		<!-- Main Content -->
		<div class="max-w-7xl mx-auto px-6 py-6">
			<div class="grid grid-cols-1 lg:grid-cols-4 gap-6">
				<!-- Left Column: Main Content -->
				<div class="lg:col-span-3 space-y-6">
					<!-- Client Information Card -->
					<Card class="border border-gray-200">
						<CardContent class="p-6">
							<div class="space-y-4">
								<div>
									<p class="text-sm text-gray-500 mb-1">PJ (Persoană Juridică)</p>
									<p class="font-semibold text-gray-900">
										{#if client?.cui}
											{client.cui}
										{/if}
										{#if client?.cui && client?.name} - {/if}
										{client?.name || 'Client necunoscut'}
									</p>
								</div>
								<div>
									<p class="text-sm text-gray-500 mb-1">Țară</p>
									<p class="text-gray-900">{client?.country || 'România'}</p>
								</div>
								{#if client?.county}
									<div>
										<p class="text-sm text-gray-500 mb-1">Județ</p>
										<p class="text-gray-900">{client.county}</p>
									</div>
								{/if}
								{#if client?.city}
									<div>
										<p class="text-sm text-gray-500 mb-1">Localitate</p>
										<p class="text-gray-900">{client.city}</p>
									</div>
								{:else}
									<div>
										<p class="text-sm text-gray-500 mb-1">Localitate</p>
										<p class="text-gray-900">-</p>
									</div>
								{/if}
								{#if client?.address}
									<div>
										<p class="text-sm text-gray-500 mb-1">Adresă</p>
										<p class="text-gray-900">{client.address}</p>
									</div>
								{/if}
							</div>
						</CardContent>
					</Card>

					<!-- Invoice Details Card -->
					<Card class="border border-gray-200">
						<CardContent class="p-6">
							<div class="grid grid-cols-2 gap-6">
								<div>
									<p class="text-sm text-gray-500 mb-1">Serie</p>
									<p class="font-semibold text-gray-900">
										{invoiceSettings?.keezSeries || 'OTS'}
									</p>
								</div>
								<div>
									<p class="text-sm text-gray-500 mb-1">Număr</p>
									<p class="font-semibold text-gray-900">
										{invoice.invoiceNumber?.split(' ')[1] || invoice.invoiceNumber || '-'}
									</p>
								</div>
								<div>
									<p class="text-sm text-gray-500 mb-1">Data</p>
									<p class="text-gray-900">{formatDate(invoice.issueDate)}</p>
								</div>
								<div>
									<p class="text-sm text-gray-500 mb-1">Scadența la</p>
									<p class="text-gray-900">{formatDate(invoice.dueDate)}</p>
								</div>
								<div>
									<p class="text-sm text-gray-500 mb-1">Plată</p>
									<p class="text-gray-900">Transfer bancar</p>
								</div>
								<div>
									<p class="text-sm text-gray-500 mb-1">Monedă calcul</p>
									<p class="text-gray-900">{invoiceCurrency}</p>
								</div>
								<div>
									<p class="text-sm text-gray-500 mb-1">Monedă factură</p>
									<p class="text-gray-900">{invoiceCurrency}</p>
								</div>
								<div>
									<p class="text-sm text-gray-500 mb-1">Rată schimb</p>
									<p class="text-gray-900">1,0000</p>
								</div>
								<div class="col-span-2 flex items-center gap-4 mt-2">
									<div class="flex items-center gap-2">
										<Checkbox id="vat-on-collection" />
										<label for="vat-on-collection" class="text-sm text-gray-700 cursor-pointer">
											TVA la încasare
										</label>
									</div>
									<div class="flex items-center gap-2">
										<Checkbox id="credit-note" />
										<label for="credit-note" class="text-sm text-gray-700 cursor-pointer">
											Factură storno
										</label>
									</div>
								</div>
							</div>
						</CardContent>
					</Card>

					<!-- Line Items Card -->
					<Card class="border border-gray-200">
						<CardContent class="p-6">
							<div class="mb-4">
								<p class="text-sm text-gray-500 mb-1">Articol</p>
								<p class="font-semibold text-gray-900">
									{lineItems[0]?.description || 'Servicii marketing'}
								</p>
							</div>
							{#if lineItems[0]?.description && lineItems[0].description !== invoice.notes}
								<div class="mb-4">
									<p class="text-sm text-gray-500 mb-1">Notă Articol</p>
									<p class="text-gray-900">{invoice.notes || '-'}</p>
								</div>
							{/if}
							<div class="overflow-x-auto">
								<table class="w-full border-collapse">
									<thead>
										<tr class="border-b border-gray-200">
											<th class="text-left py-3 px-4 text-sm font-semibold text-gray-700">UM</th>
											<th class="text-right py-3 px-4 text-sm font-semibold text-gray-700">
												Cantitate
											</th>
											<th class="text-right py-3 px-4 text-sm font-semibold text-gray-700">
												Preț unitar
											</th>
											<th class="text-right py-3 px-4 text-sm font-semibold text-gray-700">
												Tip rabat
											</th>
											<th class="text-right py-3 px-4 text-sm font-semibold text-gray-700">Rabat</th>
											<th class="text-right py-3 px-4 text-sm font-semibold text-gray-700">Valoare</th>
											<th class="text-right py-3 px-4 text-sm font-semibold text-gray-700">TVA</th>
											<th class="text-right py-3 px-4 text-sm font-semibold text-gray-700">
												Valoare TVA
											</th>
											<th class="text-right py-3 px-4 text-sm font-semibold text-gray-700">
												Valoare finală
											</th>
										</tr>
									</thead>
									<tbody>
										{#each lineItems as item}
											<tr class="border-b border-gray-100">
												<td class="py-3 px-4 text-gray-900">Buc</td>
												<td class="py-3 px-4 text-right text-gray-900">
													{item.quantity.toFixed(4)}
												</td>
												<td class="py-3 px-4 text-right text-gray-900">
													{formatAmount(Math.round(item.rate * 100), invoiceCurrency).replace(
														/\s/g,
														''
													).replace(',', '.')}
													.0000
												</td>
												<td class="py-3 px-4 text-right text-gray-900">-</td>
												<td class="py-3 px-4 text-right text-gray-900">0,00</td>
												<td class="py-3 px-4 text-right text-gray-900 font-medium">
													{formatAmount(Math.round(item.amount * 100), invoiceCurrency)}
												</td>
												<td class="py-3 px-4 text-right text-gray-900">
													{taxRate.toFixed(2)} %
												</td>
												<td class="py-3 px-4 text-right text-gray-900">
													{formatAmount(invoice?.taxAmount || 0, invoiceCurrency)}
												</td>
												<td class="py-3 px-4 text-right text-gray-900 font-medium">
													{formatAmount(Math.round((item.amount + (invoice?.taxAmount || 0) / 100) * 100), invoiceCurrency)}
												</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						</CardContent>
					</Card>

					<!-- Invoice Totals Card -->
					<Card class="border border-gray-200">
						<CardContent class="p-6">
							<div class="space-y-4">
								<div>
									<p class="text-sm text-gray-500 mb-2">Rabat factură</p>
									<div class="flex justify-between text-sm">
										<span class="text-gray-600">Valoare netă</span>
										<span class="text-gray-900">0,00</span>
									</div>
									<div class="flex justify-between text-sm">
										<span class="text-gray-600">Valoare brută</span>
										<span class="text-gray-900">0,00</span>
									</div>
								</div>
								<Separator />
								<div class="flex justify-between">
									<span class="text-gray-700 font-medium">Total Valoare</span>
									<span class="text-gray-900 font-semibold">
										{formatAmount(invoice?.amount || 0, invoiceCurrency)}
									</span>
								</div>
								<div class="flex justify-between">
									<span class="text-gray-700 font-medium">Total TVA</span>
									<span class="text-gray-900 font-semibold">
										{formatAmount(invoice?.taxAmount || 0, invoiceCurrency)}
									</span>
								</div>
								<div class="flex justify-between">
									<span class="text-gray-700 font-medium">Total de plată</span>
									<span class="text-gray-900 font-semibold text-lg">
										{formatAmount(invoice?.totalAmount || 0, invoiceCurrency)}
									</span>
								</div>
								<div class="flex justify-between">
									<span class="text-gray-700 font-medium">Sold</span>
									<span class="text-gray-900 font-semibold text-lg">
										{formatAmount(Math.round(balance * 100), invoiceCurrency)}
									</span>
								</div>
							</div>
						</CardContent>
					</Card>

					<!-- Invoice Notes Card -->
					{#if invoice.notes}
						<Card class="border border-gray-200">
							<CardContent class="p-6">
								<div>
									<p class="text-sm text-gray-500 mb-1">Note Factură</p>
									<p class="text-gray-900">{invoice.notes}</p>
								</div>
								<div class="mt-4">
									<a href="#" class="text-sm text-blue-600 hover:underline">
										Vezi informațiile adiționale
									</a>
								</div>
							</CardContent>
						</Card>
					{/if}
				</div>

				<!-- Right Sidebar: Action Buttons -->
				<div class="lg:col-span-1">
					<Card class="border border-gray-200 sticky top-6">
						<CardContent class="p-4">
							<div class="space-y-1">
								<Button
									variant="ghost"
									class="w-full justify-start text-pink-600 hover:text-pink-700 hover:bg-pink-50"
									onclick={handleUnlock}
								>
									<Unlock class="mr-2 h-4 w-4" />
									Deblochează
								</Button>
								<Button
									variant="ghost"
									class="w-full justify-start text-pink-600 hover:text-pink-700 hover:bg-pink-50"
									onclick={handleCancel}
								>
									<X class="mr-2 h-4 w-4" />
									Anulează
								</Button>
								<Button
									variant="ghost"
									class="w-full justify-start text-pink-600 hover:text-pink-700 hover:bg-pink-50"
									onclick={handleDelete}
								>
									<Trash2 class="mr-2 h-4 w-4" />
									Șterge
								</Button>
								<Button
									variant="ghost"
									class="w-full justify-start text-pink-600 hover:text-pink-700 hover:bg-pink-50"
									onclick={handleCreditNote}
								>
									<FileText class="mr-2 h-4 w-4" />
									Stornează
								</Button>
								<Button
									variant="ghost"
									class="w-full justify-start text-pink-600 hover:text-pink-700 hover:bg-pink-50"
									onclick={handleCopy}
								>
									<Copy class="mr-2 h-4 w-4" />
									Copiază
								</Button>
								<Button
									variant="ghost"
									class="w-full justify-start text-pink-600 hover:text-pink-700 hover:bg-pink-50"
									onclick={handleDownloadPDF}
								>
									<Download class="mr-2 h-4 w-4" />
									Descarcă
								</Button>
								<Button
									variant="ghost"
									class="w-full justify-start text-pink-600 hover:text-pink-700 hover:bg-pink-50"
									onclick={handleSendInvoice}
								>
									<Send class="mr-2 h-4 w-4" />
									Trimite
								</Button>
								<Button
									variant="ghost"
									class="w-full justify-start text-pink-600 hover:text-pink-700 hover:bg-pink-50"
									onclick={handleEFactura}
								>
									<FileCheck class="mr-2 h-4 w-4" />
									eFactura
								</Button>
								<Button
									variant="ghost"
									class="w-full justify-start text-pink-600 hover:text-pink-700 hover:bg-pink-50"
									onclick={handleAttachFile}
								>
									<Paperclip class="mr-2 h-4 w-4" />
									Atașează fișier
								</Button>
							</div>
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	{:else}
		<div class="flex items-center justify-center min-h-screen">
			<p>Factura nu a fost găsită</p>
		</div>
	{/if}
</div>
