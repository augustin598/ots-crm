<script lang="ts">
	import { getGoogleAdsInvoices, getGoogleAdsMonthlySpend, deleteGoogleAdsInvoice, triggerGoogleAdsSync } from '$lib/remotes/google-ads-invoices.remote';
	import { page } from '$app/state';
	import {
		Table, TableBody, TableCell, TableHead, TableHeader, TableRow
	} from '$lib/components/ui/table';
	import { Card } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Download, Search, Eye, Trash2, ExternalLink } from '@lucide/svelte';
	import ArrowUpDownIcon from '@lucide/svelte/icons/arrow-up-down';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
	import DollarSignIcon from '@lucide/svelte/icons/dollar-sign';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import IconGoogleAds from '$lib/components/marketing/icon-google-ads.svelte';
	import { toast } from 'svelte-sonner';

	function formatMonth(month: string): string {
		try {
			const parts = month.split('-');
			const d = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
			return isNaN(d.getTime()) ? month : d.toLocaleDateString('ro-RO', { month: 'long', year: 'numeric' });
		} catch { return month; }
	}

	function formatCurr(value: number, currency: string): string {
		return new Intl.NumberFormat('ro-RO', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
	}

	const tenantSlug = $derived(page.params.tenant as string);

	const invoicesQuery = getGoogleAdsInvoices();
	const invoices = $derived(invoicesQuery.current || []);
	const loading = $derived(invoicesQuery.loading);

	const monthlySpendQuery = getGoogleAdsMonthlySpend();
	const monthlySpend = $derived(monthlySpendQuery.current || []);
	const monthlyLoading = $derived(monthlySpendQuery.loading);

	let syncing = $state(false);
	let searchQuery = $state('');
	let sortColumn = $state<'clientName' | 'invoiceNumber' | 'issueDate' | 'totalAmountMicros'>('issueDate');
	let sortDirection = $state<'asc' | 'desc'>('desc');
	let pageSize = $state(25);
	let currentPage = $state(1);

	async function handleSync() {
		syncing = true;
		try {
			const result = await triggerGoogleAdsSync().updates(invoicesQuery);
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
			await deleteGoogleAdsInvoice(invoiceId).updates(invoicesQuery);
			toast.success('Factură ștearsă');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la ștergere');
		}
	}

	async function handleDownloadPDF(invoiceId: string, invoiceNumber: string | null) {
		try {
			const response = await fetch(`/${tenantSlug}/invoices/google-ads/${invoiceId}/pdf`);
			if (!response.ok) throw new Error('Failed to download PDF');
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `GoogleAds-${(invoiceNumber || invoiceId).replace(/[^a-zA-Z0-9-_]/g, '_')}.pdf`;
			a.click();
			URL.revokeObjectURL(url);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la descărcare');
		}
	}

	async function handlePreviewPDF(invoiceId: string) {
		try {
			const response = await fetch(`/${tenantSlug}/invoices/google-ads/${invoiceId}/pdf`);
			if (!response.ok) throw new Error('Failed to load PDF');
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			window.open(url, '_blank');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la previzualizare');
		}
	}

	function formatAmount(micros: number | null, currency: string): string {
		if (micros == null) return '-';
		const amount = micros / 1_000_000;
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
			: invoices.filter((inv) =>
				(inv.clientName || '').toLowerCase().includes(searchQuery.trim().toLowerCase()) ||
				(inv.invoiceNumber || '').toLowerCase().includes(searchQuery.trim().toLowerCase())
			)
	);

	const sortedInvoices = $derived(
		[...filteredInvoices].sort((a, b) => {
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
				case 'totalAmountMicros':
					return dir * ((a.totalAmountMicros || 0) - (b.totalAmountMicros || 0));
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
	<!-- Header -->
	<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
		<div>
			<h1 class="text-3xl font-bold flex items-center gap-3">
				<IconGoogleAds class="h-8 w-8" />
				Facturi Google Ads
			</h1>
			<p class="text-muted-foreground">Cheltuieli lunare și documente de facturare</p>
		</div>
		<Button variant="outline" size="sm" onclick={handleSync} disabled={syncing}>
			{#if syncing}
				<RefreshCwIcon class="mr-2 h-4 w-4 animate-spin" />Sincronizare...
			{:else}
				<RefreshCwIcon class="mr-2 h-4 w-4" />Sync Acum
			{/if}
		</Button>
	</div>

	<!-- Monthly Spend Cards -->
	{#if monthlyLoading}
		<div class="space-y-4">
			{#each Array(2) as _}
				<Card class="p-6"><Skeleton class="h-48 w-full" /></Card>
			{/each}
		</div>
	{:else if monthlySpend.length > 0}
		<div class="space-y-6">
			{#each monthlySpend as account}
				{#if account.months.length > 0}
					{@const totalSpend = account.months.reduce((s, m) => s + m.spend, 0)}
					{@const totalClicks = account.months.reduce((s, m) => s + m.clicks, 0)}
					{@const totalConv = account.months.reduce((s, m) => s + m.conversions, 0)}
					{@const curr = account.months[0]?.currencyCode || 'USD'}
					<Card class="overflow-hidden">
						<!-- Account Header -->
						<div class="border-b bg-muted/30 px-6 py-4">
							<div class="flex items-center justify-between">
								<div class="flex items-center gap-3">
									<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
										<DollarSignIcon class="h-5 w-5 text-primary" />
									</div>
									<div>
										<h3 class="text-lg font-semibold">{account.accountName}</h3>
										{#if account.clientName}
											<p class="text-sm text-muted-foreground">{account.clientName}</p>
										{/if}
									</div>
								</div>
								<div class="flex items-center gap-3">
									{#if account.clientEmail}
										<p class="text-sm text-muted-foreground">Facturi disponibile pe contul <strong>{account.clientEmail}</strong></p>
									{/if}
									<a href="https://ads.google.com/aw/billing/documents" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-2 rounded-lg border bg-background px-4 py-2 text-sm font-medium hover:bg-muted transition-colors shrink-0">
										<ExternalLink class="h-4 w-4" />
										Descarcă facturi
									</a>
								</div>
							</div>
						</div>

						<!-- Summary KPIs -->
						<div class="grid grid-cols-3 divide-x border-b">
							<div class="px-6 py-4 text-center">
								<p class="text-xs text-muted-foreground uppercase tracking-wider">Total cheltuieli</p>
								<p class="text-xl font-bold mt-1">{formatCurr(totalSpend, curr)}</p>
							</div>
							<div class="px-6 py-4 text-center">
								<p class="text-xs text-muted-foreground uppercase tracking-wider">Total click-uri</p>
								<p class="text-xl font-bold mt-1">{totalClicks.toLocaleString('ro-RO')}</p>
							</div>
							<div class="px-6 py-4 text-center">
								<p class="text-xs text-muted-foreground uppercase tracking-wider">Total conversii</p>
								<p class="text-xl font-bold mt-1">{totalConv.toLocaleString('ro-RO')}</p>
							</div>
						</div>

						<!-- Monthly Rows -->
						<div class="divide-y">
							{#each account.months as m, i}
								{@const prevSpend = account.months[i + 1]?.spend}
								{@const trend = prevSpend ? ((m.spend - prevSpend) / prevSpend) * 100 : null}
								<div class="flex items-center px-6 py-4 hover:bg-muted/30 transition-colors">
									<div class="flex items-center gap-3 w-48">
										<CalendarIcon class="h-4 w-4 text-muted-foreground" />
										<span class="font-medium capitalize">{formatMonth(m.month)}</span>
									</div>
									<div class="flex-1 grid grid-cols-4 gap-4 text-right">
										<div>
											<span class="text-base font-semibold">{formatCurr(m.spend, m.currencyCode)}</span>
											{#if trend !== null}
												<span class="ml-2 text-xs {trend >= 0 ? 'text-red-500' : 'text-green-500'}">
													{trend >= 0 ? '+' : ''}{trend.toFixed(1)}%
												</span>
											{/if}
										</div>
										<span class="text-sm text-muted-foreground">{m.impressions.toLocaleString('ro-RO')} imp.</span>
										<span class="text-sm">{m.clicks.toLocaleString('ro-RO')} clicks</span>
										<div class="flex items-center justify-end gap-1.5">
											<TrendingUpIcon class="h-3.5 w-3.5 text-primary" />
											<span class="text-sm font-medium">{m.conversions} conv.</span>
										</div>
									</div>
								</div>
							{/each}
						</div>
					</Card>
				{/if}
			{/each}
		</div>
	{/if}

	<!-- Synced Invoices (for monthly invoicing accounts) -->
	{#if loading}
		<Card class="p-6"><Skeleton class="h-32 w-full" /></Card>
	{:else if invoices.length > 0}
		<div class="space-y-4">
			<h2 class="text-lg font-semibold">Facturi sincronizate</h2>
			<div class="flex items-center justify-between gap-4 rounded-md bg-muted/50 px-4 py-3">
				<p class="text-sm text-muted-foreground whitespace-nowrap">{startIndex + 1} - {endIndex} din {totalEntries}</p>
				<div class="relative w-64">
					<Search class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
					<Input type="text" placeholder="Caută..." class="pl-9" bind:value={searchQuery} oninput={() => { currentPage = 1; }} />
				</div>
			</div>

			<div class="rounded-md border overflow-x-auto">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead><button class="flex items-center gap-2 hover:text-primary" onclick={() => handleSort('clientName')}>Client <ArrowUpDownIcon class="h-4 w-4" /></button></TableHead>
							<TableHead><button class="flex items-center gap-2 hover:text-primary" onclick={() => handleSort('invoiceNumber')}>Invoice # <ArrowUpDownIcon class="h-4 w-4" /></button></TableHead>
							<TableHead><button class="flex items-center gap-2 hover:text-primary" onclick={() => handleSort('issueDate')}>Data <ArrowUpDownIcon class="h-4 w-4" /></button></TableHead>
							<TableHead class="text-right"><button class="ml-auto flex items-center gap-2 hover:text-primary" onclick={() => handleSort('totalAmountMicros')}>Total <ArrowUpDownIcon class="h-4 w-4" /></button></TableHead>
							<TableHead>Status</TableHead>
							<TableHead class="w-[120px]"></TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{#each paginatedInvoices as invoice}
							<TableRow>
								<TableCell class="font-medium">{invoice.clientName || '-'}</TableCell>
								<TableCell class="text-sm text-muted-foreground">{invoice.invoiceNumber || '-'}</TableCell>
								<TableCell>{formatDate(invoice.issueDate)}</TableCell>
								<TableCell class="text-right font-semibold">{formatAmount(invoice.totalAmountMicros, invoice.currencyCode)}</TableCell>
								<TableCell>
									<span class="inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium {invoice.status === 'synced' ? 'border-green-200 text-green-700 bg-green-50 dark:border-green-800 dark:text-green-400 dark:bg-green-950' : 'border-red-200 text-red-700 bg-red-50 dark:border-red-800 dark:text-red-400 dark:bg-red-950'}">
										{invoice.status}
									</span>
								</TableCell>
								<TableCell>
									<div class="flex items-center gap-1">
										{#if invoice.pdfPath}
											<Button variant="ghost" size="icon" class="h-8 w-8" onclick={() => handlePreviewPDF(invoice.id)} title="Preview"><Eye class="h-4 w-4" /></Button>
											<Button variant="ghost" size="icon" class="h-8 w-8" onclick={() => handleDownloadPDF(invoice.id, invoice.invoiceNumber)} title="Download"><Download class="h-4 w-4" /></Button>
										{/if}
										<Button variant="ghost" size="icon" class="h-8 w-8 text-red-500 hover:text-red-700" onclick={() => handleDelete(invoice.id)} title="Șterge"><Trash2 class="h-4 w-4" /></Button>
									</div>
								</TableCell>
							</TableRow>
						{/each}
					</TableBody>
				</Table>
			</div>

			{#if totalPages > 1}
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-2 text-sm">
						<span class="text-muted-foreground">Arată</span>
						<select class="h-8 w-[70px] rounded-md border border-input bg-background px-2 text-sm" value={pageSize.toString()} onchange={(e) => { pageSize = parseInt(e.currentTarget.value); currentPage = 1; }}>
							<option value="10">10</option><option value="25">25</option><option value="50">50</option>
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
		</div>
	{/if}
</div>
