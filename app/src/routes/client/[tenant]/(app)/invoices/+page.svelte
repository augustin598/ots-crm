<script lang="ts">
	import { getInvoices } from '$lib/remotes/invoices.remote';
	import { page } from '$app/state';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import {
		FileText as FileTextIcon,
		Coins as CoinsIcon,
		Calendar as CalendarIcon,
		Eye as EyeIcon,
		Download as DownloadIcon,
		Search,
		RefreshCw as RefreshCwIcon
	} from '@lucide/svelte';
	import { formatAmount, type Currency } from '$lib/utils/currency';

	const lastKeezSyncAt = $derived((page.data as any)?.lastKeezSyncAt as string | null);

	async function handleDownloadPDF(invoiceId: string, invoiceNumber: string) {
		try {
			const response = await fetch(`/client/${tenantSlug}/invoices/${invoiceId}/pdf`);
			if (!response.ok) throw new Error('Failed to generate PDF');
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `Factura-${invoiceNumber.replace(/[^a-zA-Z0-9-_]/g, '_')}.pdf`;
			a.click();
			URL.revokeObjectURL(url);
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to download PDF');
		}
	}

	async function handlePreviewPDF(invoiceId: string) {
		try {
			const response = await fetch(`/client/${tenantSlug}/invoices/${invoiceId}/pdf`);
			if (!response.ok) throw new Error('Failed to generate PDF');
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			window.open(url, '_blank');
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to preview PDF');
		}
	}

	const tenantSlug = $derived(page.params.tenant as string);

	const invoicesQuery = getInvoices({});
	const invoices = $derived(invoicesQuery.current || []);
	const loading = $derived(invoicesQuery.loading);


	// --- Table state ---
	let searchQuery = $state('');
	let sortColumn = $state<'invoiceNumber' | 'issueDate' | 'dueDate' | 'totalAmount'>('issueDate');
	let sortDirection = $state<'asc' | 'desc'>('desc');
	let pageSize = $state(10);
	let currentPage = $state(1);

	// --- Derived: filter -> sort -> paginate ---
	const filteredInvoices = $derived(
		searchQuery.trim() === ''
			? invoices
			: invoices.filter((inv) =>
					inv.invoiceNumber.toLowerCase().includes(searchQuery.trim().toLowerCase())
				)
	);

	const sortedInvoices = $derived(
		[...filteredInvoices].sort((a, b) => {
			const dir = sortDirection === 'asc' ? 1 : -1;
			switch (sortColumn) {
				case 'invoiceNumber':
					return (
						dir *
						a.invoiceNumber.localeCompare(b.invoiceNumber, undefined, { numeric: true })
					);
				case 'issueDate': {
					const dateA = a.issueDate ? new Date(a.issueDate).getTime() : 0;
					const dateB = b.issueDate ? new Date(b.issueDate).getTime() : 0;
					return dir * (dateA - dateB);
				}
				case 'dueDate': {
					const dateA = a.dueDate ? new Date(a.dueDate).getTime() : 0;
					const dateB = b.dueDate ? new Date(b.dueDate).getTime() : 0;
					return dir * (dateA - dateB);
				}
				case 'totalAmount':
					return dir * ((a.totalAmount || 0) - (b.totalAmount || 0));
				default:
					return 0;
			}
		})
	);

	const totalEntries = $derived(filteredInvoices.length);
	const totalPages = $derived(Math.max(1, Math.ceil(totalEntries / pageSize)));
	const safePage = $derived(Math.min(Math.max(1, currentPage), totalPages));
	const startIndex = $derived((safePage - 1) * pageSize);
	const endIndex = $derived(Math.min(startIndex + pageSize, totalEntries));
	const paginatedInvoices = $derived(sortedInvoices.slice(startIndex, endIndex));
	const showingFrom = $derived(totalEntries === 0 ? 0 : startIndex + 1);
	const showingTo = $derived(endIndex);

	const pageNumbers = $derived.by(() => {
		const pages: number[] = [];
		const maxVisible = 5;
		let start = Math.max(1, safePage - Math.floor(maxVisible / 2));
		const end = Math.min(totalPages, start + maxVisible - 1);
		if (end - start + 1 < maxVisible) {
			start = Math.max(1, end - maxVisible + 1);
		}
		for (let i = start; i <= end; i++) {
			pages.push(i);
		}
		return pages;
	});

	$effect(() => {
		if (currentPage > totalPages) {
			currentPage = totalPages;
		}
	});

	function getStatusColor(status: string): string {
		switch (status) {
			case 'paid':
				return 'border-green-500 text-green-700 bg-green-50';
			case 'partially_paid':
				return 'border-orange-300 text-orange-800 bg-orange-50';
			case 'sent':
				return 'border-blue-500 text-blue-700 bg-blue-50';
			case 'overdue':
				return 'border-red-500 text-red-700 bg-red-50';
			case 'draft':
				return 'border-gray-400 text-gray-600 bg-gray-50';
			case 'cancelled':
				return 'border-red-400 text-red-600 bg-red-50';
			default:
				return 'border-gray-400 text-gray-600 bg-gray-50';
		}
	}

	function getStatusText(status: string): string {
		switch (status) {
			case 'paid': return 'Achitata';
			case 'partially_paid': return 'Achitata partial';
			case 'sent': return 'Trimisa';
			case 'overdue': return 'Restanta';
			case 'draft': return 'Ciorna';
			case 'cancelled': return 'Anulata';
			default: return status;
		}
	}

	function isInvoiceUnpaid(status: string): boolean {
		return status === 'partially_paid' || status === 'sent' || status === 'overdue';
	}

	function isInvoiceOverdue(status: string, dueDate: Date | string | null | undefined): boolean {
		if (!isInvoiceUnpaid(status) || !dueDate) return false;
		const d = dueDate instanceof Date ? dueDate : new Date(dueDate);
		return d < new Date();
	}

	function formatDate(date: Date | string | null | undefined): string {
		if (!date) return '-';
		try {
			const d = date instanceof Date ? date : new Date(date);
			return d.toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', year: 'numeric' });
		} catch {
			return '-';
		}
	}

</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-3xl font-bold">Facturile mele</h1>
			<p class="text-muted-foreground">Istoricul facturilor</p>
		</div>
		{#if lastKeezSyncAt}
			<div class="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
				<RefreshCwIcon class="h-3.5 w-3.5" />
				<span>Ultima sincronizare: <strong class="text-foreground">{new Date(lastKeezSyncAt).toLocaleString('ro-RO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</strong></span>
			</div>
		{/if}
	</div>

	{#if loading}
		<p class="text-muted-foreground">Loading invoices...</p>
	{:else if invoices.length === 0}
		<div class="rounded-md border p-8 text-center">
			<p class="text-muted-foreground">No invoices yet.</p>
		</div>
	{:else}
		<!-- Info bar with search and sort -->
		<div class="flex flex-col gap-3 rounded-md bg-muted/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
			<p class="text-sm text-muted-foreground whitespace-nowrap">
				Showing {showingFrom} to {showingTo} of {totalEntries} entries
			</p>
			<div class="flex items-center gap-3">
				<!-- Sort dropdown -->
				<div class="flex items-center gap-2">
					<span class="text-sm text-muted-foreground whitespace-nowrap">Sort by:</span>
					<select
						class="h-8 rounded-md border border-input bg-background px-2 text-sm"
						value={`${sortColumn}-${sortDirection}`}
						onchange={(e) => {
							const val = e.currentTarget.value;
							const [col, dir] = val.split('-') as [typeof sortColumn, 'asc' | 'desc'];
							sortColumn = col;
							sortDirection = dir;
							currentPage = 1;
						}}
					>
						<option value="issueDate-desc">Data emiterii (recent)</option>
						<option value="issueDate-asc">Data emiterii (vechi)</option>
						<option value="dueDate-desc">Scadenta (recent)</option>
						<option value="dueDate-asc">Scadenta (vechi)</option>
						<option value="totalAmount-desc">Suma (descrescator)</option>
						<option value="totalAmount-asc">Suma (crescator)</option>
						<option value="invoiceNumber-asc">Nr. factura (A-Z)</option>
						<option value="invoiceNumber-desc">Nr. factura (Z-A)</option>
					</select>
				</div>
				<!-- Search -->
				<div class="relative w-64">
					<Search
						class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
					/>
					<Input
						type="text"
						placeholder="Search..."
						class="pl-9"
						bind:value={searchQuery}
						oninput={() => {
							currentPage = 1;
						}}
					/>
				</div>
			</div>
		</div>

		<!-- Invoice cards -->
		{#if paginatedInvoices.length === 0}
			<div class="rounded-md border p-8 text-center">
				<p class="text-muted-foreground">No invoices match your search.</p>
			</div>
		{:else}
			<div class="space-y-4">
				{#each paginatedInvoices as invoice (invoice.id)}
					<Card class="group relative overflow-hidden transition-all duration-300 hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-0.5">
						<!-- Vertical accent bar on left, colored by status -->
						<div class="absolute top-0 left-0 bottom-0 w-1 rounded-l-lg {invoice.status === 'paid' ? 'bg-green-500' : invoice.status === 'partially_paid' ? 'bg-orange-500' : invoice.status === 'overdue' ? 'bg-red-500' : invoice.status === 'cancelled' ? 'bg-gray-400' : 'bg-blue-500'}"></div>

						<CardContent class="p-4 pl-5">
							<!-- Header row -->
							<div class="flex items-start justify-between gap-4">
								<div class="flex items-center gap-2 flex-wrap flex-1 min-w-0">
									<div class="p-1.5 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors">
										<FileTextIcon class="h-3.5 w-3.5 text-primary" />
									</div>
									<h3 class="text-lg font-bold tracking-tight text-foreground">
										{invoice.invoiceNumber}
									</h3>
									<span
										class="inline-flex items-center rounded-full border px-3 py-0.5 text-xs font-medium {getStatusColor(invoice.status)} {invoice.status === 'partially_paid' ? 'bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-900/40 dark:text-orange-300 dark:border-orange-700' : ''}"
									>
										{getStatusText(invoice.status)}
									</span>
									{#if invoice.status === 'partially_paid' && invoice.remainingAmount}
										<span class="text-xs font-medium text-orange-600 dark:text-orange-400">
											Sold restant: {(invoice.remainingAmount / 100).toLocaleString('ro-RO', { minimumFractionDigits: 2 })} {invoice.currency}
										</span>
									{/if}
								</div>

								<!-- Action buttons -->
								<div class="flex items-center gap-2 flex-shrink-0">
									<Button
										variant="outline"
										size="sm"
										class="hover:border-primary/50 hover:bg-primary/5 transition-all"
										onclick={() => handlePreviewPDF(invoice.id)}
									>
										<EyeIcon class="h-3.5 w-3.5 mr-1.5" />
										Vizualizare
									</Button>
									<Button
										variant="outline"
										size="sm"
										class="hover:border-primary/50 hover:bg-primary/5 transition-all"
										onclick={() => handleDownloadPDF(invoice.id, invoice.invoiceNumber)}
									>
										<DownloadIcon class="h-3.5 w-3.5 mr-1.5" />
										Descarcă PDF
									</Button>
								</div>
							</div>

							<!-- Info grid -->
							<div class="mt-4 grid gap-3 {invoice.paidDate ? 'md:grid-cols-4' : 'md:grid-cols-3'}">
								<!-- Amount -->
								<div class="relative p-3 rounded-lg bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/10 group-hover:border-primary/20 transition-all">
									<div class="flex items-center gap-1.5 mb-1.5">
										<CoinsIcon class="h-3.5 w-3.5 text-primary/60" />
										<p class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Suma</p>
									</div>
									<p class="text-2xl font-bold text-primary leading-tight">
										{formatAmount(invoice.totalAmount, invoice.currency as Currency)}
									</p>
								</div>

								<!-- Issue Date -->
								<div class="p-3 rounded-lg bg-muted/30 border border-border/50 group-hover:bg-muted/50 transition-all">
									<div class="flex items-center gap-1.5 mb-1.5">
										<CalendarIcon class="h-3.5 w-3.5 text-muted-foreground/60" />
										<p class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Data emiterii</p>
									</div>
									<p class="text-sm font-semibold text-foreground">
										{formatDate(invoice.issueDate)}
									</p>
								</div>

								<!-- Due Date -->
								<div class="p-3 rounded-lg transition-all {isInvoiceOverdue(invoice.status, invoice.dueDate) ? 'bg-red-50 border-2 border-red-400 dark:bg-red-950/30 dark:border-red-700 due-blink ring-2 ring-red-300/50 dark:ring-red-700/50' : isInvoiceUnpaid(invoice.status) ? 'bg-orange-50 border border-orange-200 dark:bg-orange-950/20 dark:border-orange-800' : 'bg-muted/30 border border-border/50 group-hover:bg-muted/50'}">
									<div class="flex items-center gap-1.5 mb-1.5">
										<CalendarIcon class="h-3.5 w-3.5 {isInvoiceOverdue(invoice.status, invoice.dueDate) ? 'text-red-500 animate-pulse' : isInvoiceUnpaid(invoice.status) ? 'text-orange-500 animate-pulse' : 'text-muted-foreground/60'}" />
										<p class="text-xs font-semibold uppercase tracking-wide {isInvoiceOverdue(invoice.status, invoice.dueDate) ? 'text-red-600 dark:text-red-400' : isInvoiceUnpaid(invoice.status) ? 'text-orange-600 dark:text-orange-400' : 'text-muted-foreground'}">Scadenta</p>
									</div>
									<p class="text-sm font-semibold {isInvoiceOverdue(invoice.status, invoice.dueDate) ? 'text-red-700 dark:text-red-300' : isInvoiceUnpaid(invoice.status) ? 'text-orange-700 dark:text-orange-300' : 'text-foreground'}">
										{formatDate(invoice.dueDate)}
									</p>
									{#if isInvoiceOverdue(invoice.status, invoice.dueDate) && invoice.dueDate}
										{@const daysLate = Math.floor((new Date().getTime() - new Date(invoice.dueDate).getTime()) / (1000 * 60 * 60 * 24))}
										<p class="text-xs font-semibold text-red-600 dark:text-red-400 mt-1">
											Restantă de {daysLate} {daysLate === 1 ? 'zi' : 'zile'}
										</p>
									{:else if isInvoiceUnpaid(invoice.status) && invoice.dueDate}
										{@const daysLeft = Math.ceil((new Date(invoice.dueDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))}
										<p class="text-xs font-medium text-orange-600 dark:text-orange-400 mt-1">
											{daysLeft === 0 ? 'Scadentă azi' : `Mai ${daysLeft === 1 ? 'e 1 zi' : `sunt ${daysLeft} zile`}`}
										</p>
									{/if}
								</div>

								<!-- Paid Date (conditional) -->
								{#if invoice.paidDate}
									<div class="p-3 rounded-lg bg-green-500/10 border border-green-500/20">
										<div class="flex items-center gap-1.5 mb-1.5">
											<CalendarIcon class="h-3.5 w-3.5 text-green-600/60" />
											<p class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Data platii</p>
										</div>
										<p class="text-sm font-semibold text-green-600 dark:text-green-400">
											{formatDate(invoice.paidDate)}
										</p>
									</div>
								{/if}
							</div>
						</CardContent>
					</Card>
				{/each}
			</div>
		{/if}

		<!-- Pagination -->
		{#if totalEntries > 0}
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-2 text-sm">
					<span class="text-muted-foreground">Show</span>
					<select
						class="h-8 w-[70px] rounded-md border border-input bg-background px-2 text-sm"
						value={pageSize.toString()}
						onchange={(e) => {
							pageSize = parseInt(e.currentTarget.value);
							currentPage = 1;
						}}
					>
						<option value="10">10</option>
						<option value="25">25</option>
						<option value="50">50</option>
						<option value="100">100</option>
					</select>
					<span class="text-muted-foreground">entries</span>
				</div>

				<div class="flex items-center gap-1">
					<Button
						variant="outline"
						size="sm"
						disabled={safePage <= 1}
						onclick={() => {
							currentPage = safePage - 1;
						}}
					>
						Previous
					</Button>
					{#each pageNumbers as pn (pn)}
						<Button
							variant={pn === safePage ? 'default' : 'outline'}
							size="sm"
							class="w-8 h-8 p-0"
							onclick={() => {
								currentPage = pn;
							}}
						>
							{pn}
						</Button>
					{/each}
					<Button
						variant="outline"
						size="sm"
						disabled={safePage >= totalPages}
						onclick={() => {
							currentPage = safePage + 1;
						}}
					>
						Next
					</Button>
				</div>
			</div>
		{/if}
	{/if}
</div>

<style>
	:global(.due-blink) {
		animation: due-blink 1.5s ease-in-out infinite;
	}

	@keyframes due-blink {
		0%, 100% {
			opacity: 1;
			box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4);
		}
		50% {
			opacity: 0.7;
			box-shadow: 0 0 12px 4px rgba(239, 68, 68, 0.3);
		}
	}
</style>
