<script lang="ts">
	import { getMetaAdsInvoices, deleteMetaAdsInvoice, triggerMetaAdsSync } from '$lib/remotes/meta-ads-invoices.remote';
	import { page } from '$app/state';
	import {
		Table, TableBody, TableCell, TableHead, TableHeader, TableRow
	} from '$lib/components/ui/table';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Download, Search, Eye, Trash2 } from '@lucide/svelte';
	import ArrowUpDownIcon from '@lucide/svelte/icons/arrow-up-down';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import { toast } from 'svelte-sonner';

	const tenantSlug = $derived(page.params.tenant as string);

	const invoicesQuery = getMetaAdsInvoices();
	const invoices = $derived(invoicesQuery.current || []);
	const loading = $derived(invoicesQuery.loading);

	let syncing = $state(false);
	let searchQuery = $state('');
	let sortColumn = $state<'clientName' | 'invoiceNumber' | 'issueDate' | 'amountCents'>('issueDate');
	let sortDirection = $state<'asc' | 'desc'>('desc');
	let pageSize = $state(25);
	let currentPage = $state(1);

	async function handleSync() {
		syncing = true;
		try {
			const result = await triggerMetaAdsSync().updates(invoicesQuery);
			toast.success(`Sync complet: ${result.imported} importate, ${result.skipped} existente, ${result.errors} erori`);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la sincronizare');
		} finally {
			syncing = false;
		}
	}

	async function handleDelete(invoiceId: string) {
		if (!confirm('Ești sigur că vrei să ștergi această factură?')) return;
		try {
			await deleteMetaAdsInvoice(invoiceId).updates(invoicesQuery);
			toast.success('Factură ștearsă');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la ștergere');
		}
	}

	async function handleDownloadPDF(invoiceId: string, invoiceNumber: string | null) {
		try {
			const response = await fetch(`/${tenantSlug}/invoices/meta-ads/${invoiceId}/pdf`);
			if (!response.ok) throw new Error('Failed to download PDF');
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `MetaAds-${(invoiceNumber || invoiceId).replace(/[^a-zA-Z0-9-_]/g, '_')}.pdf`;
			a.click();
			URL.revokeObjectURL(url);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la descărcare');
		}
	}

	async function handlePreviewPDF(invoiceId: string) {
		try {
			const response = await fetch(`/${tenantSlug}/invoices/meta-ads/${invoiceId}/pdf`);
			if (!response.ok) throw new Error('Failed to load PDF');
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			window.open(url, '_blank');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la previzualizare');
		}
	}

	function formatAmount(cents: number | null, currency: string): string {
		if (cents == null) return '-';
		const amount = cents / 100;
		return new Intl.NumberFormat('ro-RO', { style: 'currency', currency }).format(amount);
	}

	function formatDate(date: Date | string | null): string {
		if (!date) return '-';
		try {
			const d = date instanceof Date ? date : new Date(date);
			return d.toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', year: 'numeric' });
		} catch {
			return '-';
		}
	}

	// Filter, sort, paginate
	const filteredInvoices = $derived(
		searchQuery.trim() === ''
			? invoices
			: invoices.filter((inv: any) =>
				(inv.clientName || '').toLowerCase().includes(searchQuery.trim().toLowerCase()) ||
				(inv.invoiceNumber || '').toLowerCase().includes(searchQuery.trim().toLowerCase()) ||
				(inv.businessName || '').toLowerCase().includes(searchQuery.trim().toLowerCase())
			)
	);

	const sortedInvoices = $derived(
		[...filteredInvoices].sort((a: any, b: any) => {
			const dir = sortDirection === 'asc' ? 1 : -1;
			switch (sortColumn) {
				case 'clientName':
					return dir * (a.clientName || '').localeCompare(b.clientName || '');
				case 'invoiceNumber':
					return dir * (a.invoiceNumber || '').localeCompare(b.invoiceNumber || '', undefined, { numeric: true });
				case 'issueDate': {
					const da = a.issueDate ? new Date(a.issueDate).getTime() : 0;
					const db2 = b.issueDate ? new Date(b.issueDate).getTime() : 0;
					return dir * (da - db2);
				}
				case 'amountCents':
					return dir * ((a.amountCents || 0) - (b.amountCents || 0));
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

	const pageNumbers = $derived.by(() => {
		const pages: number[] = [];
		const maxVisible = 5;
		let start = Math.max(1, safePage - Math.floor(maxVisible / 2));
		const end = Math.min(totalPages, start + maxVisible - 1);
		if (end - start + 1 < maxVisible) start = Math.max(1, end - maxVisible + 1);
		for (let i = start; i <= end; i++) pages.push(i);
		return pages;
	});

	$effect(() => {
		if (currentPage > totalPages) currentPage = totalPages;
	});

	function handleSort(column: typeof sortColumn) {
		if (sortColumn === column) {
			sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
		} else {
			sortColumn = column;
			sortDirection = 'asc';
		}
		currentPage = 1;
	}
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-3xl font-bold">Facturi Meta Ads</h1>
			<p class="text-muted-foreground">Facturile descărcate din Meta/Facebook Ads pentru toți clienții</p>
		</div>
		<Button variant="outline" size="sm" onclick={handleSync} disabled={syncing}>
			{#if syncing}
				<RefreshCwIcon class="mr-2 h-4 w-4 animate-spin" />
				Sincronizare...
			{:else}
				<RefreshCwIcon class="mr-2 h-4 w-4" />
				Sync Acum
			{/if}
		</Button>
	</div>

	{#if loading}
		<p class="text-muted-foreground">Se încarcă facturile...</p>
	{:else if invoices.length === 0}
		<div class="rounded-md border p-8 text-center">
			<p class="text-muted-foreground">Nu sunt facturi Meta Ads sincronizate.</p>
		</div>
	{:else}
		<div class="flex items-center justify-between gap-4 rounded-md bg-muted/50 px-4 py-3">
			<p class="text-sm text-muted-foreground whitespace-nowrap">
				{startIndex + 1} - {endIndex} din {totalEntries}
			</p>
			<div class="relative w-64">
				<Search class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
				<Input type="text" placeholder="Caută..." class="pl-9" bind:value={searchQuery} oninput={() => { currentPage = 1; }} />
			</div>
		</div>

		<div class="rounded-md border overflow-x-auto">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>
							<button class="flex items-center gap-2 hover:text-primary" onclick={() => handleSort('clientName')}>
								Client <ArrowUpDownIcon class="h-4 w-4" />
							</button>
						</TableHead>
						<TableHead>BM</TableHead>
						<TableHead>
							<button class="flex items-center gap-2 hover:text-primary" onclick={() => handleSort('invoiceNumber')}>
								Invoice # <ArrowUpDownIcon class="h-4 w-4" />
							</button>
						</TableHead>
						<TableHead>
							<button class="flex items-center gap-2 hover:text-primary" onclick={() => handleSort('issueDate')}>
								Data <ArrowUpDownIcon class="h-4 w-4" />
							</button>
						</TableHead>
						<TableHead class="text-right">
							<button class="ml-auto flex items-center gap-2 hover:text-primary" onclick={() => handleSort('amountCents')}>
								Total <ArrowUpDownIcon class="h-4 w-4" />
							</button>
						</TableHead>
						<TableHead>Tip</TableHead>
						<TableHead>Status</TableHead>
						<TableHead class="w-[120px]"></TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{#each paginatedInvoices as invoice}
						<TableRow>
							<TableCell class="font-medium">{invoice.clientName || '-'}</TableCell>
							<TableCell class="text-sm text-muted-foreground">{invoice.businessName || '-'}</TableCell>
							<TableCell>{invoice.invoiceNumber || '-'}</TableCell>
							<TableCell>{formatDate(invoice.issueDate)}</TableCell>
							<TableCell class="text-right font-semibold">
								{formatAmount(invoice.amountCents, invoice.currencyCode)}
							</TableCell>
							<TableCell>
								<span class="text-xs">{invoice.invoiceType || 'INVOICE'}</span>
							</TableCell>
							<TableCell>
								<span class="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium {invoice.status === 'synced' ? 'border-green-500 text-green-700 bg-green-50' : 'border-red-500 text-red-700 bg-red-50'}">
									{invoice.status}
								</span>
							</TableCell>
							<TableCell>
								<div class="flex items-center gap-1">
									{#if invoice.pdfPath}
										<Button variant="ghost" size="icon" class="h-8 w-8" onclick={() => handlePreviewPDF(invoice.id)} title="Preview PDF">
											<Eye class="h-4 w-4" />
										</Button>
										<Button variant="ghost" size="icon" class="h-8 w-8" onclick={() => handleDownloadPDF(invoice.id, invoice.invoiceNumber)} title="Download PDF">
											<Download class="h-4 w-4" />
										</Button>
									{/if}
									<Button variant="ghost" size="icon" class="h-8 w-8 text-red-500" onclick={() => handleDelete(invoice.id)} title="Șterge">
										<Trash2 class="h-4 w-4" />
									</Button>
								</div>
							</TableCell>
						</TableRow>
					{/each}
				</TableBody>
			</Table>
		</div>

		{#if totalEntries > 0}
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-2 text-sm">
					<span class="text-muted-foreground">Arată</span>
					<select
						class="h-8 w-[70px] rounded-md border border-input bg-background px-2 text-sm"
						value={pageSize.toString()}
						onchange={(e) => { pageSize = parseInt(e.currentTarget.value); currentPage = 1; }}
					>
						<option value="10">10</option>
						<option value="25">25</option>
						<option value="50">50</option>
					</select>
				</div>
				<div class="flex items-center gap-1">
					<Button variant="outline" size="sm" disabled={safePage <= 1} onclick={() => { currentPage = safePage - 1; }}>Anterior</Button>
					{#each pageNumbers as pn}
						<Button variant={pn === safePage ? 'default' : 'outline'} size="sm" class="w-8 h-8 p-0" onclick={() => { currentPage = pn; }}>{pn}</Button>
					{/each}
					<Button variant="outline" size="sm" disabled={safePage >= totalPages} onclick={() => { currentPage = safePage + 1; }}>Următor</Button>
				</div>
			</div>
		{/if}
	{/if}
</div>
