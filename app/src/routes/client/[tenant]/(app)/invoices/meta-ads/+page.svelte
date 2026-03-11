<script lang="ts">
	import { getMetaAdsInvoices } from '$lib/remotes/meta-ads-invoices.remote';
	import { page } from '$app/state';
	import {
		Table, TableBody, TableCell, TableHead, TableHeader, TableRow
	} from '$lib/components/ui/table';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Download, Search, Eye } from '@lucide/svelte';
	import ArrowUpDownIcon from '@lucide/svelte/icons/arrow-up-down';
	import { toast } from 'svelte-sonner';

	const tenantSlug = $derived(page.params.tenant as string);

	const invoicesQuery = getMetaAdsInvoices();
	const invoices = $derived(invoicesQuery.current || []);
	const loading = $derived(invoicesQuery.loading);

	let searchQuery = $state('');
	let sortColumn = $state<'invoiceNumber' | 'issueDate' | 'dueDate' | 'amountCents'>('issueDate');
	let sortDirection = $state<'asc' | 'desc'>('desc');
	let pageSize = $state(10);
	let currentPage = $state(1);

	async function handleDownloadPDF(invoiceId: string, invoiceNumber: string | null) {
		try {
			const response = await fetch(`/client/${tenantSlug}/invoices/meta-ads/${invoiceId}/pdf`);
			if (!response.ok) throw new Error('Failed to download PDF');
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `MetaAds-${(invoiceNumber || invoiceId).replace(/[^a-zA-Z0-9-_]/g, '_')}.pdf`;
			a.click();
			URL.revokeObjectURL(url);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to download PDF');
		}
	}

	async function handlePreviewPDF(invoiceId: string) {
		try {
			const response = await fetch(`/client/${tenantSlug}/invoices/meta-ads/${invoiceId}/pdf`);
			if (!response.ok) throw new Error('Failed to load PDF');
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			window.open(url, '_blank');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to preview PDF');
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
			const day = d.getDate();
			const month = d.toLocaleDateString('en-US', { month: 'short' });
			const year = d.getFullYear();
			return `${day} ${month} ${year}`;
		} catch {
			return '-';
		}
	}

	const filteredInvoices = $derived(
		searchQuery.trim() === ''
			? invoices
			: invoices.filter((inv: any) =>
				(inv.invoiceNumber || '').toLowerCase().includes(searchQuery.trim().toLowerCase())
			)
	);

	const sortedInvoices = $derived(
		[...filteredInvoices].sort((a: any, b: any) => {
			const dir = sortDirection === 'asc' ? 1 : -1;
			switch (sortColumn) {
				case 'invoiceNumber':
					return dir * (a.invoiceNumber || '').localeCompare(b.invoiceNumber || '', undefined, { numeric: true });
				case 'issueDate': {
					const da = a.issueDate ? new Date(a.issueDate).getTime() : 0;
					const db2 = b.issueDate ? new Date(b.issueDate).getTime() : 0;
					return dir * (da - db2);
				}
				case 'dueDate': {
					const da = a.dueDate ? new Date(a.dueDate).getTime() : 0;
					const db2 = b.dueDate ? new Date(b.dueDate).getTime() : 0;
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
	const showingFrom = $derived(totalEntries === 0 ? 0 : startIndex + 1);
	const showingTo = $derived(endIndex);

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
	<div>
		<h1 class="text-3xl font-bold">Facturi Meta Ads</h1>
		<p class="text-muted-foreground">Facturile tale din Meta/Facebook Ads</p>
	</div>

	{#if loading}
		<p class="text-muted-foreground">Se încarcă facturile...</p>
	{:else if invoices.length === 0}
		<div class="rounded-md border p-8 text-center">
			<p class="text-muted-foreground">Nu sunt facturi Meta Ads disponibile.</p>
		</div>
	{:else}
		<div class="flex items-center justify-between gap-4 rounded-md bg-muted/50 px-4 py-3">
			<p class="text-sm text-muted-foreground whitespace-nowrap">
				{showingFrom} - {showingTo} din {totalEntries}
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
							<button class="flex items-center gap-2 hover:text-primary" onclick={() => handleSort('invoiceNumber')}>
								Invoice # <ArrowUpDownIcon class="h-4 w-4" />
							</button>
						</TableHead>
						<TableHead>
							<button class="flex items-center gap-2 hover:text-primary" onclick={() => handleSort('issueDate')}>
								Data Emitere <ArrowUpDownIcon class="h-4 w-4" />
							</button>
						</TableHead>
						<TableHead>
							<button class="flex items-center gap-2 hover:text-primary" onclick={() => handleSort('dueDate')}>
								Scadența <ArrowUpDownIcon class="h-4 w-4" />
							</button>
						</TableHead>
						<TableHead class="text-right">
							<button class="ml-auto flex items-center gap-2 hover:text-primary" onclick={() => handleSort('amountCents')}>
								Total <ArrowUpDownIcon class="h-4 w-4" />
							</button>
						</TableHead>
						<TableHead class="w-[80px]"></TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{#if paginatedInvoices.length === 0}
						<TableRow>
							<TableCell colspan={5} class="text-center text-muted-foreground py-8">
								Nicio factură găsită.
							</TableCell>
						</TableRow>
					{:else}
						{#each paginatedInvoices as invoice}
							<TableRow>
								<TableCell class="font-medium">{invoice.invoiceNumber || '-'}</TableCell>
								<TableCell>{formatDate(invoice.issueDate)}</TableCell>
								<TableCell>{formatDate(invoice.dueDate)}</TableCell>
								<TableCell class="text-right font-semibold">
									{formatAmount(invoice.amountCents, invoice.currencyCode)}
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
									</div>
								</TableCell>
							</TableRow>
						{/each}
					{/if}
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
