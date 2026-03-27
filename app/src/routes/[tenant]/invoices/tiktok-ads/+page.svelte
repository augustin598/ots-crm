<script lang="ts">
	import { getTiktokAdsSpendingList, deleteTiktokAdsSpending, triggerTiktokAdsSync, regenerateTiktokSpendingPdf, getTiktokInvoiceDownloads, triggerTiktokInvoiceDownload, redownloadTiktokInvoice, deleteTiktokInvoiceDownload } from '$lib/remotes/tiktok-ads.remote';
	import { page } from '$app/state';
	import {
		Table, TableBody, TableCell, TableHead, TableHeader, TableRow
	} from '$lib/components/ui/table';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Download, Search, Eye, Trash2 } from '@lucide/svelte';
	import ArrowUpDownIcon from '@lucide/svelte/icons/arrow-up-down';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import { Card } from '$lib/components/ui/card';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import DollarSignIcon from '@lucide/svelte/icons/dollar-sign';
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
	import { toast } from 'svelte-sonner';

	const tenantSlug = $derived(page.params.tenant as string);

	const spendingQuery = getTiktokAdsSpendingList();
	const spending = $derived(spendingQuery.current || []);
	const loading = $derived(spendingQuery.loading);

	let syncing = $state(false);
	let regeneratingAll = $state(false);
	let regeneratingId = $state<string | null>(null);
	let searchQuery = $state('');
	let sortColumn = $state<'clientName' | 'periodStart' | 'spendCents'>('periodStart');
	let sortDirection = $state<'asc' | 'desc'>('desc');
	let pageSize = $state(25);
	let currentPage = $state(1);

	let lastSyncResult = $state<{ imported: number; updated: number; errors: number; at: Date } | null>(null);

	async function handleSync() {
		syncing = true;
		try {
			const result = await triggerTiktokAdsSync().updates(spendingQuery);
			lastSyncResult = { imported: result.imported, updated: result.updated, errors: result.errors, at: new Date() };
			toast.success(`Sync complet: ${result.imported} noi, ${result.updated} actualizate, ${result.errors} erori`);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la sincronizare');
		} finally {
			syncing = false;
		}
	}

	async function handleDelete(id: string) {
		if (!confirm('Ești sigur că vrei să ștergi acest raport?')) return;
		try {
			await deleteTiktokAdsSpending(id).updates(spendingQuery);
			toast.success('Raport șters');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la ștergere');
		}
	}

	async function handleRegenerate(spendingId: string) {
		regeneratingId = spendingId;
		try {
			await regenerateTiktokSpendingPdf(spendingId).updates(spendingQuery);
			toast.success('PDF regenerat');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la regenerare PDF');
		} finally {
			regeneratingId = null;
		}
	}

	async function handleRegenerateAll() {
		regeneratingAll = true;
		try {
			const seen = new Set<string>();
			let regenerated = 0;
			for (const row of spending) {
				const key = `${row.tiktokAdvertiserId}_${row.clientId}`;
				if (seen.has(key)) continue;
				seen.add(key);
				await regenerateTiktokSpendingPdf(row.id).updates(spendingQuery);
				regenerated++;
			}
			toast.success(`${regenerated} PDF-uri regenerate`);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la regenerare PDF-uri');
		} finally {
			regeneratingAll = false;
		}
	}

	async function handleDownloadPDF(id: string, period: string) {
		try {
			const response = await fetch(`/${tenantSlug}/invoices/tiktok-ads/${id}/pdf`);
			if (!response.ok) throw new Error('Failed to download PDF');
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `TikTokAds-Cheltuieli-${period.replace(/[^a-zA-Z0-9-_]/g, '_')}.pdf`;
			a.click();
			URL.revokeObjectURL(url);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la descărcare');
		}
	}

	async function handlePreviewPDF(id: string) {
		try {
			const response = await fetch(`/${tenantSlug}/invoices/tiktok-ads/${id}/pdf`);
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

	function formatPeriod(start: string): string {
		try {
			const d = new Date(start + 'T00:00:00');
			return d.toLocaleDateString('ro-RO', { month: 'long', year: 'numeric' });
		} catch {
			return start;
		}
	}

	function formatNumber(n: number | null): string {
		if (n == null) return '-';
		return n.toLocaleString('ro-RO');
	}

	const filteredSpending = $derived(
		searchQuery.trim() === ''
			? spending
			: spending.filter((s: any) =>
				(s.clientName || '').toLowerCase().includes(searchQuery.trim().toLowerCase()) ||
				(s.tiktokAdvertiserId || '').toLowerCase().includes(searchQuery.trim().toLowerCase())
			)
	);

	const sortedSpending = $derived(
		[...filteredSpending].sort((a: any, b: any) => {
			const dir = sortDirection === 'asc' ? 1 : -1;
			switch (sortColumn) {
				case 'clientName':
					return dir * (a.clientName || '').localeCompare(b.clientName || '');
				case 'periodStart':
					return dir * (a.periodStart || '').localeCompare(b.periodStart || '');
				case 'spendCents':
					return dir * ((a.spendCents || 0) - (b.spendCents || 0));
				default:
					return 0;
			}
		})
	);

	const totalEntries = $derived(filteredSpending.length);
	const totalPages = $derived(Math.max(1, Math.ceil(totalEntries / pageSize)));
	const safePage = $derived(Math.min(Math.max(1, currentPage), totalPages));
	const startIndex = $derived((safePage - 1) * pageSize);
	const endIndex = $derived(Math.min(startIndex + pageSize, totalEntries));
	const paginatedSpending = $derived(sortedSpending.slice(startIndex, endIndex));

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

	// ---- Invoice Downloads ----
	const downloadsQuery = getTiktokInvoiceDownloads();
	const downloads = $derived(downloadsQuery.current || []);
	const downloadsLoading = $derived(downloadsQuery.loading);

	let downloadingMonth = $state(false);
	let redownloadingId = $state<string | null>(null);

	const MONTHS = ['Ianuarie', 'Februarie', 'Martie', 'Aprilie', 'Mai', 'Iunie', 'Iulie', 'August', 'Septembrie', 'Octombrie', 'Noiembrie', 'Decembrie'];
	const now = new Date();
	const defaultMonth = now.getMonth() === 0 ? 12 : now.getMonth();
	const defaultYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
	let selectedMonth = $state(defaultMonth);
	let selectedYear = $state(defaultYear);

	async function handleDownloadMonth() {
		downloadingMonth = true;
		try {
			const result = await triggerTiktokInvoiceDownload({ year: selectedYear, month: selectedMonth }).updates(downloadsQuery);
			toast.success(`Download complet: ${result.downloaded} descărcate, ${result.skipped} sărite, ${result.errors} erori`);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la descărcare facturi');
		} finally {
			downloadingMonth = false;
		}
	}

	async function handleRedownloadInvoice(downloadId: string) {
		redownloadingId = downloadId;
		try {
			await redownloadTiktokInvoice(downloadId).updates(downloadsQuery);
			toast.success('Factură re-descărcată');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la re-descărcare');
		} finally {
			redownloadingId = null;
		}
	}

	async function handleDeleteDownload(id: string) {
		if (!confirm('Ești sigur că vrei să ștergi această factură?')) return;
		try {
			await deleteTiktokInvoiceDownload(id).updates(downloadsQuery);
			toast.success('Factură ștearsă');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la ștergere');
		}
	}

	async function handlePreviewInvoicePDF(id: string) {
		try {
			const response = await fetch(`/${tenantSlug}/invoices/tiktok-ads/downloads/${id}/pdf`);
			if (!response.ok) throw new Error('Failed to load PDF');
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			window.open(url, '_blank');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la previzualizare');
		}
	}

	async function handleDownloadInvoicePDF(id: string, period: string) {
		try {
			const response = await fetch(`/${tenantSlug}/invoices/tiktok-ads/downloads/${id}/pdf`);
			if (!response.ok) throw new Error('Failed to download PDF');
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `TikTokAds-Factura-${period.replace(/[^a-zA-Z0-9-_]/g, '_')}.pdf`;
			a.click();
			URL.revokeObjectURL(url);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la descărcare');
		}
	}

	function formatDownloadPeriod(start: string): string {
		try {
			const d = new Date(start + 'T00:00:00');
			return d.toLocaleDateString('ro-RO', { month: 'long', year: 'numeric' });
		} catch {
			return start;
		}
	}

	const groupedByClient = $derived.by(() => {
		const groups = new Map<string, { clientName: string; rows: typeof spending }>();
		for (const row of spending) {
			const key = row.clientName || 'Neatribuit';
			const existing = groups.get(key) || { clientName: key, rows: [] };
			existing.rows.push(row);
			groups.set(key, existing);
		}
		for (const group of groups.values()) {
			group.rows.sort((a: any, b: any) => (b.periodStart || '').localeCompare(a.periodStart || ''));
		}
		return Array.from(groups.values());
	});
</script>

<div class="space-y-6">
	<!-- Header -->
	<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
		<div>
			<h1 class="text-3xl font-bold flex items-center gap-3">
				<svg class="h-8 w-8" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.34-6.34V8.75a8.16 8.16 0 004.76 1.52V6.84a4.84 4.84 0 01-1-.15z"/></svg>
				Facturi TikTok Ads
			</h1>
			<p class="text-muted-foreground">Cheltuieli lunare și documente de facturare</p>
		</div>
		<div class="flex items-center gap-2">
			<Button variant="outline" size="sm" onclick={handleRegenerateAll} disabled={regeneratingAll || spending.length === 0}>
				{#if regeneratingAll}
					<Download class="mr-2 h-4 w-4 animate-bounce" />Regenerare...
				{:else}
					<Download class="mr-2 h-4 w-4" />Regenerează PDF-uri
				{/if}
			</Button>
			<Button variant="outline" size="sm" onclick={handleSync} disabled={syncing}>
				{#if syncing}
					<RefreshCwIcon class="mr-2 h-4 w-4 animate-spin" />Sincronizare...
				{:else}
					<RefreshCwIcon class="mr-2 h-4 w-4" />Sync Acum
				{/if}
			</Button>
		</div>
		{#if lastSyncResult}
			<p class="text-xs text-muted-foreground text-right">
				{lastSyncResult.at.toLocaleString('ro-RO')} — {lastSyncResult.imported} noi, {lastSyncResult.updated} actualizate, {lastSyncResult.errors} erori
			</p>
		{/if}
	</div>

	<!-- Spending Cards by Client -->
	{#if loading}
		<div class="space-y-4">
			{#each Array(2) as _}
				<Card class="p-6"><Skeleton class="h-48 w-full" /></Card>
			{/each}
		</div>
	{:else if spending.length === 0}
		<div class="rounded-md border p-8 text-center">
			<p class="text-muted-foreground">Nu sunt date de cheltuieli TikTok Ads sincronizate.</p>
		</div>
	{:else}
		<div class="space-y-6">
			{#each groupedByClient as group}
				{#if group.rows.length > 0}
					{@const totalSpend = group.rows.reduce((s, r) => s + (r.spendCents || 0), 0)}
					{@const totalClicks = group.rows.reduce((s, r) => s + (r.clicks || 0), 0)}
					{@const totalConv = group.rows.reduce((s, r) => s + (r.conversions || 0), 0)}
					{@const curr = group.rows[0]?.currencyCode || 'USD'}
					<Card class="overflow-hidden">
						<!-- Client Header -->
						<div class="border-b bg-muted/30 px-6 py-4">
							<div class="flex items-center justify-between">
								<div class="flex items-center gap-3">
									<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
										<DollarSignIcon class="h-5 w-5 text-primary" />
									</div>
									<div>
										<h3 class="text-lg font-semibold">{group.clientName}</h3>
										<p class="text-sm text-muted-foreground">{group.rows.length} {group.rows.length === 1 ? 'lună' : 'luni'} de date</p>
									</div>
								</div>
							</div>
						</div>

						<!-- Summary KPIs -->
						<div class="grid grid-cols-3 divide-x border-b">
							<div class="px-6 py-4 text-center">
								<p class="text-xs text-muted-foreground uppercase tracking-wider">Total cheltuieli</p>
								<p class="text-xl font-bold mt-1">{formatAmount(totalSpend, curr)}</p>
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
							{#each group.rows as row, i}
								{@const prevSpend = group.rows[i + 1]?.spendCents}
								{@const trend = prevSpend ? (((row.spendCents || 0) - prevSpend) / prevSpend) * 100 : null}
								<div class="flex items-center px-6 py-4 hover:bg-muted/30 transition-colors">
									<div class="flex items-center gap-3 w-48">
										<CalendarIcon class="h-4 w-4 text-muted-foreground" />
										<span class="font-medium capitalize">{formatPeriod(row.periodStart)}</span>
									</div>
									<div class="flex-1 grid grid-cols-4 gap-4 text-right">
										<div>
											<span class="text-base font-semibold">{formatAmount(row.spendCents, row.currencyCode)}</span>
											{#if trend !== null}
												<span class="ml-2 text-xs {trend >= 0 ? 'text-red-500' : 'text-green-500'}">
													{trend >= 0 ? '+' : ''}{trend.toFixed(1)}%
												</span>
											{/if}
										</div>
										<span class="text-sm text-muted-foreground">{formatNumber(row.impressions)} imp.</span>
										<span class="text-sm">{formatNumber(row.clicks)} clicks</span>
										<div class="flex items-center justify-end gap-1.5">
											<TrendingUpIcon class="h-3.5 w-3.5 text-primary" />
											<span class="text-sm font-medium">{formatNumber(row.conversions)} conv.</span>
										</div>
									</div>
									<div class="flex items-center gap-1 ml-4">
										{#if row.pdfPath}
											<Button variant="ghost" size="icon" class="h-8 w-8" onclick={() => handlePreviewPDF(row.id)} title="Preview PDF">
												<Eye class="h-4 w-4" />
											</Button>
											<Button variant="ghost" size="icon" class="h-8 w-8" onclick={() => handleDownloadPDF(row.id, row.periodStart)} title="Download PDF">
												<Download class="h-4 w-4" />
											</Button>
										{/if}
										<Button variant="ghost" size="icon" class="h-8 w-8 text-blue-500" onclick={() => handleRegenerate(row.id)} disabled={regeneratingId === row.id} title="Regenerează PDF">
											{#if regeneratingId === row.id}
												<RefreshCwIcon class="h-4 w-4 animate-spin" />
											{:else}
												<RefreshCwIcon class="h-4 w-4" />
											{/if}
										</Button>
										<Button variant="ghost" size="icon" class="h-8 w-8 text-red-500" onclick={() => handleDelete(row.id)} title="Șterge">
											<Trash2 class="h-4 w-4" />
										</Button>
									</div>
								</div>
							{/each}
						</div>
					</Card>
				{/if}
			{/each}
		</div>
	{/if}

	<!-- Facturi PDF TikTok -->
	{#if downloadsLoading}
		<Card class="p-6"><Skeleton class="h-32 w-full" /></Card>
	{:else}
		<Card class="overflow-hidden">
			<div class="border-b bg-muted/30 px-6 py-4">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-3">
						<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
							<svg class="h-5 w-5 text-primary" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.34-6.34V8.75a8.16 8.16 0 004.76 1.52V6.84a4.84 4.84 0 01-1-.15z"/></svg>
						</div>
						<div>
							<h3 class="text-lg font-semibold">Facturi PDF TikTok</h3>
							<p class="text-sm text-muted-foreground">Facturi oficiale descărcate din TikTok Business Center</p>
						</div>
					</div>
					<div class="flex items-center gap-2">
						<select class="h-8 rounded-md border border-input bg-background px-2 text-sm" value={selectedMonth.toString()} onchange={(e) => { selectedMonth = parseInt(e.currentTarget.value); }}>
							{#each MONTHS as m, i}<option value={(i + 1).toString()}>{m}</option>{/each}
						</select>
						<select class="h-8 w-20 rounded-md border border-input bg-background px-2 text-sm" value={selectedYear.toString()} onchange={(e) => { selectedYear = parseInt(e.currentTarget.value); }}>
							{#each [2024, 2025, 2026] as y}<option value={y.toString()}>{y}</option>{/each}
						</select>
						<Button variant="outline" size="sm" onclick={handleDownloadMonth} disabled={downloadingMonth}>
							{#if downloadingMonth}<Download class="mr-2 h-4 w-4 animate-bounce" />Descărcare...{:else}<Download class="mr-2 h-4 w-4" />Download{/if}
						</Button>
					</div>
				</div>
			</div>

			{#if downloads.length === 0}
				<div class="p-8 text-center">
					<p class="text-muted-foreground">Nu sunt facturi PDF descărcate. Selectează luna și apasă "Download".</p>
				</div>
			{:else}
				<div class="divide-y">
					{#each downloads as dl}
						<div class="flex items-center px-6 py-4 hover:bg-muted/30 transition-colors">
							<div class="flex items-center gap-3 w-56">
								<CalendarIcon class="h-4 w-4 text-muted-foreground" />
								<div>
									<span class="font-medium">{dl.adAccountName || dl.tiktokAdvertiserId}</span>
									{#if dl.clientName}
										<span class="block text-xs text-muted-foreground">{dl.clientName}</span>
									{/if}
								</div>
							</div>
							<div class="flex-1 grid grid-cols-3 gap-4 items-center">
								<span class="text-sm text-muted-foreground capitalize">{formatDownloadPeriod(dl.periodStart)}</span>
								<div class="text-right">
									<span class="text-base font-semibold">{dl.amountCents ? formatAmount(dl.amountCents, dl.currencyCode || 'USD') : '-'}</span>
									{#if dl.invoiceNumber}
										<span class="ml-2 text-xs text-muted-foreground">#{dl.invoiceNumber}</span>
									{/if}
								</div>
								<div class="text-right">
									{#if dl.status === 'downloaded'}
										<span class="inline-flex items-center rounded-full border border-green-200 px-2.5 py-1 text-xs font-medium text-green-700 bg-green-50 dark:border-green-800 dark:text-green-400 dark:bg-green-950">
											Descărcat
										</span>
									{:else if dl.status === 'pending'}
										<span class="inline-flex items-center rounded-full border border-yellow-200 px-2.5 py-1 text-xs font-medium text-yellow-700 bg-yellow-50 dark:border-yellow-800 dark:text-yellow-400 dark:bg-yellow-950">
											Pending
										</span>
									{:else if dl.status === 'error'}
										<span class="inline-flex items-center rounded-full border border-red-200 px-2.5 py-1 text-xs font-medium text-red-700 bg-red-50 dark:border-red-800 dark:text-red-400 dark:bg-red-950" title={dl.errorMessage || ''}>
											Eroare
										</span>
									{:else if dl.status === 'session_expired'}
										<span class="inline-flex items-center rounded-full border border-orange-200 px-2.5 py-1 text-xs font-medium text-orange-700 bg-orange-50 dark:border-orange-800 dark:text-orange-400 dark:bg-orange-950">
											Sesiune expirată
										</span>
									{:else}
										<span class="inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium text-muted-foreground">
											{dl.status}
										</span>
									{/if}
								</div>
							</div>
							<div class="flex items-center gap-1 ml-4">
								{#if dl.status === 'downloaded' && dl.pdfPath}
									<Button variant="ghost" size="icon" class="h-8 w-8" onclick={() => handlePreviewInvoicePDF(dl.id)} title="Preview PDF">
										<Eye class="h-4 w-4" />
									</Button>
									<Button variant="ghost" size="icon" class="h-8 w-8" onclick={() => handleDownloadInvoicePDF(dl.id, dl.periodStart)} title="Download PDF">
										<Download class="h-4 w-4" />
									</Button>
								{/if}
								{#if dl.status === 'error' || dl.status === 'session_expired'}
									<Button variant="ghost" size="icon" class="h-8 w-8 text-blue-500" onclick={() => handleRedownloadInvoice(dl.id)} disabled={redownloadingId === dl.id} title="Re-download">
										{#if redownloadingId === dl.id}
											<RefreshCwIcon class="h-4 w-4 animate-spin" />
										{:else}
											<RefreshCwIcon class="h-4 w-4" />
										{/if}
									</Button>
								{/if}
								<Button variant="ghost" size="icon" class="h-8 w-8 text-red-500" onclick={() => handleDeleteDownload(dl.id)} title="Șterge">
									<Trash2 class="h-4 w-4" />
								</Button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</Card>
	{/if}
</div>
