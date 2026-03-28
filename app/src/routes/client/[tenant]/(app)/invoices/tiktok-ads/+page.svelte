<script lang="ts">
	import { getTiktokAdsSpendingList, getTiktokInvoiceDownloads } from '$lib/remotes/tiktok-ads.remote';
	import { page } from '$app/state';
	import { Card } from '$lib/components/ui/card';
	import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '$lib/components/ui/collapsible';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { Download, Search, Eye } from '@lucide/svelte';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import DollarSignIcon from '@lucide/svelte/icons/dollar-sign';
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import IconTiktok from '$lib/components/marketing/icon-tiktok.svelte';
	import DateRangePicker from '$lib/components/reports/date-range-picker.svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { clientLogger } from '$lib/client-logger';

	const tenantSlug = $derived(page.params.tenant as string);

	// Date range — implicit: tot anul curent
	const currentYear = new Date().getFullYear();
	let since = $state(`${currentYear}-01-01`);
	let until = $state(`${currentYear}-12-31`);

	const spendingQuery = getTiktokAdsSpendingList();
	const spending = $derived(spendingQuery.current || []);
	const loading = $derived(spendingQuery.loading);

	const downloadsQuery = getTiktokInvoiceDownloads();
	const downloads = $derived(downloadsQuery.current || []);
	const downloadsLoading = $derived(downloadsQuery.loading);

	function formatAmount(cents: number | null, currency: string): string {
		if (cents == null) return '-';
		return new Intl.NumberFormat('ro-RO', { style: 'currency', currency, maximumFractionDigits: 2 }).format(cents / 100);
	}

	function formatPeriod(start: string): string {
		try {
			const d = new Date(start + 'T00:00:00');
			return d.toLocaleDateString('ro-RO', { month: 'long', year: 'numeric' });
		} catch { return start; }
	}

	function formatNumber(n: number | null): string {
		if (n == null) return '-';
		return n.toLocaleString('ro-RO');
	}

	// Filter by date range then group by client
	const dateFilteredSpending = $derived(
		spending.filter((r: any) => {
			if (!r.periodStart) return true;
			const period = r.periodStart.substring(0, 7);
			return period >= since.substring(0, 7) && period <= until.substring(0, 7);
		})
	);

	const groupedByClient = $derived.by(() => {
		const groups = new Map<string, { clientName: string; rows: typeof spending }>();
		for (const row of dateFilteredSpending) {
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

	// Collapsible + search state
	let spendSearchQuery = $state('');
	let expandedAccounts = new SvelteSet<string>();

	function toggleAccount(key: string) {
		if (expandedAccounts.has(key)) expandedAccounts.delete(key);
		else expandedAccounts.add(key);
	}

	const filteredGroupedByClient = $derived(
		spendSearchQuery.trim()
			? groupedByClient.filter((g) =>
				g.clientName.toLowerCase().includes(spendSearchQuery.trim().toLowerCase())
			)
			: groupedByClient
	);

	// Map downloads by advertiser+period for inline display
	const downloadsByKey = $derived.by(() => {
		const map = new Map<string, typeof downloads[0]>();
		for (const dl of downloads) {
			const key = `${dl.tiktokAdvertiserId}:${dl.periodStart}`;
			if (!map.has(key) || dl.status === 'downloaded') map.set(key, dl);
		}
		return map;
	});

	async function handleDownloadPDF(id: string, period: string) {
		try {
			const response = await fetch(`/client/${tenantSlug}/invoices/tiktok-ads/${id}/pdf`);
			if (!response.ok) throw new Error('Failed to download PDF');
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `TikTokAds-Cheltuieli-${period.replace(/[^a-zA-Z0-9-_]/g, '_')}.pdf`;
			a.click();
			URL.revokeObjectURL(url);
		} catch (e) {
			clientLogger.apiError('client_tiktok_ads_download_pdf', e);
		}
	}

	async function handlePreviewPDF(id: string) {
		try {
			const response = await fetch(`/client/${tenantSlug}/invoices/tiktok-ads/${id}/pdf`);
			if (!response.ok) throw new Error('Failed to load PDF');
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			window.open(url, '_blank');
		} catch (e) {
			clientLogger.apiError('client_tiktok_ads_preview_pdf', e);
		}
	}

	async function handlePreviewInvoicePDF(id: string) {
		try {
			const response = await fetch(`/client/${tenantSlug}/invoices/tiktok-ads/downloads/${id}/pdf`);
			if (!response.ok) throw new Error('Failed to load PDF');
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			window.open(url, '_blank');
		} catch (e) {
			clientLogger.apiError('client_tiktok_ads_preview_invoice_pdf', e);
		}
	}

	async function handleDownloadInvoicePDF(id: string, period: string) {
		try {
			const response = await fetch(`/client/${tenantSlug}/invoices/tiktok-ads/downloads/${id}/pdf`);
			if (!response.ok) throw new Error('Failed to download PDF');
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `TikTokAds-Factura-${period.replace(/[^a-zA-Z0-9-_]/g, '_')}.pdf`;
			a.click();
			URL.revokeObjectURL(url);
		} catch (e) {
			clientLogger.apiError('client_tiktok_ads_download_invoice_pdf', e);
		}
	}
</script>

<div class="space-y-6">
	<!-- Header -->
	<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
		<div>
			<h1 class="text-3xl font-bold flex items-center gap-3">
				<IconTiktok class="h-8 w-8" />
				Facturi TikTok Ads
			</h1>
			<p class="text-muted-foreground">Cheltuieli lunare și documente de facturare</p>
		</div>
		<DateRangePicker bind:since bind:until />
	</div>

	<!-- Spending Cards by Client -->
	{#if loading}
		<div class="space-y-4">
			{#each Array(2) as _, idx (idx)}
				<Card class="p-6"><Skeleton class="h-48 w-full" /></Card>
			{/each}
		</div>
	{:else if spending.length === 0 && downloads.length === 0}
		<Card class="p-12 text-center">
			<div class="flex flex-col items-center gap-3">
				<div class="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
					<DollarSignIcon class="h-7 w-7 text-muted-foreground" />
				</div>
				<p class="text-lg font-medium">Nu există date de facturare</p>
				<p class="text-sm text-muted-foreground">Nu sunt cheltuieli TikTok Ads înregistrate.</p>
			</div>
		</Card>
	{:else}
		<!-- Search -->
		<div class="relative">
			<Search class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
			<Input bind:value={spendSearchQuery} type="text" placeholder="Caută cont sau client..." class="pl-9" />
		</div>

		{#if filteredGroupedByClient.length === 0}
			<p class="text-sm text-muted-foreground text-center py-4">Niciun cont găsit pentru „{spendSearchQuery}"</p>
		{:else}
			<div class="space-y-4">
				{#each filteredGroupedByClient as group (group.clientName)}
					{#if group.rows.length > 0}
						{@const totalSpend = group.rows.reduce((s, r) => s + (r.spendCents || 0), 0)}
						{@const totalClicks = group.rows.reduce((s, r) => s + (r.clicks || 0), 0)}
						{@const totalConv = group.rows.reduce((s, r) => s + (r.conversions || 0), 0)}
						{@const curr = group.rows[0]?.currencyCode || 'RON'}
						{@const isExpanded = expandedAccounts.has(group.clientName)}
						<Collapsible open={isExpanded} onOpenChange={() => toggleAccount(group.clientName)}>
							<Card class="overflow-hidden">
								<CollapsibleTrigger class="w-full text-left cursor-pointer">
									<div class="px-6 py-4">
										<div class="flex items-center justify-between">
											<div class="flex items-center gap-3">
												<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
													<DollarSignIcon class="h-5 w-5 text-primary" />
												</div>
												<div>
													<h3 class="text-lg font-semibold">{group.clientName}</h3>
													<p class="text-sm text-muted-foreground">{group.rows.length} luni</p>
												</div>
											</div>
											<div class="flex items-center gap-4">
												<div class="text-right">
													<p class="text-xs text-muted-foreground">Total cheltuieli</p>
													<p class="text-lg font-bold">{formatAmount(totalSpend, curr)}</p>
												</div>
												<div class="text-right hidden sm:block">
													<p class="text-xs text-muted-foreground">Click-uri</p>
													<p class="text-base font-semibold">{formatNumber(totalClicks)}</p>
												</div>
												<div class="text-right hidden sm:block">
													<p class="text-xs text-muted-foreground">Conversii</p>
													<p class="text-base font-semibold">{formatNumber(totalConv)}</p>
												</div>
												<ChevronDownIcon class="h-5 w-5 text-muted-foreground shrink-0 transition-transform duration-200 {isExpanded ? 'rotate-180' : ''}" />
											</div>
										</div>
									</div>
								</CollapsibleTrigger>

								<CollapsibleContent>
									<div class="border-t divide-y">
										{#each group.rows as row, i (row.id)}
											{@const prevSpend = group.rows[i + 1]?.spendCents}
											{@const trend = prevSpend ? (((row.spendCents || 0) - prevSpend) / prevSpend) * 100 : null}
											{@const invoice = downloadsByKey.get(`${row.tiktokAdvertiserId}:${row.periodStart}`)}
											<div class="grid grid-cols-6 gap-2 px-6 py-3 hover:bg-muted/30 transition-colors items-center">
												<div class="flex items-center gap-2">
													<CalendarIcon class="h-4 w-4 text-muted-foreground shrink-0" />
													<span class="font-medium capitalize whitespace-nowrap">{formatPeriod(row.periodStart)}</span>
												</div>
												<div class="text-right whitespace-nowrap">
													<span class="text-base font-semibold">{formatAmount(row.spendCents, row.currencyCode)}</span>
													{#if trend !== null}
														<span class="ml-1 text-xs {trend >= 0 ? 'text-red-500' : 'text-green-500'}">{trend >= 0 ? '+' : ''}{trend.toFixed(1)}%</span>
													{/if}
												</div>
												<span class="text-sm text-muted-foreground text-right whitespace-nowrap">{formatNumber(row.impressions)} imp.</span>
												<span class="text-sm text-right whitespace-nowrap">{formatNumber(row.clicks)} clicks</span>
												<span class="text-sm text-right whitespace-nowrap flex items-center justify-end gap-1"><TrendingUpIcon class="h-3.5 w-3.5 text-primary" />{formatNumber(row.conversions)} conv.</span>
												<div class="flex justify-end">
													{#if invoice?.status === 'downloaded' && invoice.pdfPath}
														<Button variant="outline" size="sm" class="whitespace-nowrap w-full" onclick={() => handleDownloadInvoicePDF(invoice.id, row.periodStart)}>
															<Download class="mr-1.5 h-3.5 w-3.5" />Descarcă factura
														</Button>
													{:else}
														<Button size="sm" class="whitespace-nowrap w-full bg-orange-100 text-orange-600 border border-orange-300 hover:bg-orange-100 cursor-default" disabled>
															<CalendarIcon class="mr-1.5 h-3.5 w-3.5" />În așteptare
														</Button>
													{/if}
												</div>
											</div>
										{/each}
									</div>
								</CollapsibleContent>
							</Card>
						</Collapsible>
					{/if}
				{/each}
			</div>
		{/if}
	{/if}

	<!-- Facturi PDF TikTok -->
	{#if downloadsLoading}
		<Card class="p-6"><Skeleton class="h-32 w-full" /></Card>
	{:else if downloads.length > 0}
		<Card class="overflow-hidden">
			<div class="border-b bg-muted/30 px-6 py-4">
				<div class="flex items-center gap-3">
					<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
						<IconTiktok class="h-5 w-5 text-primary" />
					</div>
					<div>
						<h3 class="text-lg font-semibold">Facturi PDF TikTok</h3>
						<p class="text-sm text-muted-foreground">Facturi oficiale descărcate din TikTok Business Center</p>
					</div>
				</div>
			</div>

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
							<span class="text-sm text-muted-foreground capitalize">{formatPeriod(dl.periodStart)}</span>
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
						</div>
					</div>
				{/each}
			</div>
		</Card>
	{/if}
</div>
