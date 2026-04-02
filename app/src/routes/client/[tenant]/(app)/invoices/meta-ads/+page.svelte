<script lang="ts">
	import { getMetaAdsSpendingList, getMetaInvoiceDownloads, getMappedMetaAdsClients } from '$lib/remotes/meta-ads-invoices.remote';
	import { page } from '$app/state';
	import { Card } from '$lib/components/ui/card';
	import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '$lib/components/ui/collapsible';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { Download, Search, Eye, FileArchive } from '@lucide/svelte';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import JSZip from 'jszip';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import DollarSignIcon from '@lucide/svelte/icons/dollar-sign';
	import WalletIcon from '@lucide/svelte/icons/wallet';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import MousePointerClickIcon from '@lucide/svelte/icons/mouse-pointer-click';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import IconFacebook from '$lib/components/marketing/icon-facebook.svelte';
	import DateRangePicker from '$lib/components/reports/date-range-picker.svelte';
	import { getDefaultDateRange, getDatePresets } from '$lib/utils/report-helpers';
	import { SvelteSet } from 'svelte/reactivity';
	import { clientLogger } from '$lib/client-logger';
	import AccountSpendChart from '$lib/components/reports/account-spend-chart.svelte';

	const tenantSlug = $derived(page.params.tenant as string);

	// Date range — implicit: luna trecuta (clientul vede facturile finalizate)
	const _presets = getDatePresets();
	const _lastMonth = _presets.find(p => p.label === 'Luna trecută');
	const _defaults = _lastMonth || getDefaultDateRange();
	let since = $state(_defaults.since);
	let until = $state(_defaults.until);

	const spendingQuery = getMetaAdsSpendingList();
	const spending = $derived(spendingQuery.current || []);
	const loading = $derived(spendingQuery.loading);

	const mappedClientsQuery = getMappedMetaAdsClients();
	const mappedClients = $derived(mappedClientsQuery.current || []);

	const downloadsQuery = getMetaInvoiceDownloads();
	const downloads = $derived(downloadsQuery.current || []);

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
		const sinceMonth = since.substring(0, 7);
		const untilMonth = until.substring(0, 7);
		const groups = new Map<string, { clientName: string; businessName: string; hasMultipleAccounts: boolean; rows: typeof spending }>();
		for (const row of dateFilteredSpending) {
			const key = row.clientName || 'Neatribuit';
			const existing = groups.get(key) || { clientName: key, businessName: row.businessName || '', hasMultipleAccounts: false, rows: [] };
			existing.rows.push(row);
			groups.set(key, existing);
		}
		// Add download-only periods (no matching spending row)
		for (const dl of downloads) {
			const period = dl.periodStart?.substring(0, 7);
			if (period && (period < sinceMonth || period > untilMonth)) continue;
			const clientKey = dl.clientName || 'Neatribuit';
			const group = groups.get(clientKey) || { clientName: clientKey, businessName: dl.bmName || '', hasMultipleAccounts: false, rows: [] };
			const hasSpendingRow = group.rows.some(r => r.metaAdAccountId === dl.metaAdAccountId && r.periodStart === dl.periodStart);
			if (!hasSpendingRow) {
				const alreadyAdded = group.rows.some(r => (r as any)._downloadOnly && r.metaAdAccountId === dl.metaAdAccountId && r.periodStart === dl.periodStart);
				if (!alreadyAdded) {
					group.rows.push({
						id: `dl-${dl.metaAdAccountId}-${dl.periodStart}`,
						tenantId: dl.tenantId,
						integrationId: dl.integrationId,
						clientId: dl.clientId,
						metaAdAccountId: dl.metaAdAccountId,
						adAccountName: dl.adAccountName || '',
						periodStart: dl.periodStart,
						periodEnd: dl.periodEnd,
						spendAmount: null,
						spendCents: 0,
						currencyCode: 'RON',
						impressions: 0,
						clicks: 0,
						pdfPath: null,
						syncedAt: null,
						createdAt: dl.downloadedAt,
						clientName: dl.clientName,
						businessName: dl.bmName || '',
						_downloadOnly: true
					} as any);
				}
			}
			groups.set(clientKey, group);
		}
		// Add mapped accounts that have no spending/download data yet
		for (const mapped of mappedClients) {
			const key = mapped.clientName || 'Neatribuit';
			if (!groups.has(key)) {
				groups.set(key, { clientName: key, businessName: mapped.bmName || '', hasMultipleAccounts: false, rows: [] });
			}
		}
		// Detect multi-account clients + sort
		for (const group of groups.values()) {
			const uniqueAccounts = new Set(group.rows.map(r => r.metaAdAccountId));
			group.hasMultipleAccounts = uniqueAccounts.size > 1;
			group.rows.sort((a: any, b: any) => {
				const periodCmp = (b.periodStart || '').localeCompare(a.periodStart || '');
				if (periodCmp !== 0) return periodCmp;
				return (a.adAccountName || a.metaAdAccountId || '').localeCompare(b.adAccountName || b.metaAdAccountId || '');
			});
		}
		return Array.from(groups.values());
	});

	// Collapsible + search + filter state
	let spendSearchQuery = $state('');
	let showCredits = $state(false);
	let expandedAccounts = new SvelteSet<string>();
	let expandedPeriods = new SvelteSet<string>();
	let selectedInvoices = new SvelteSet<string>();
	let zipping = $state(false);

	function toggleSelectInvoice(id: string) {
		if (selectedInvoices.has(id)) selectedInvoices.delete(id);
		else selectedInvoices.add(id);
	}

	async function downloadAsZip(invoiceIds: string[], zipName: string) {
		zipping = true;
		try {
			const zip = new JSZip();
			for (const id of invoiceIds) {
				const res = await fetch(`/client/${tenantSlug}/invoices/meta-ads/downloads/${id}/pdf`);
				if (!res.ok) continue;
				const blob = await res.blob();
				const dl = downloads.find(d => d.id === id);
				const fileName = dl?.invoiceNumber
					? `${dl.invoiceNumber}.pdf`
					: dl?.txid ? `TX-${dl.txid.substring(0, 16)}.pdf` : `factura-${id.substring(0, 8)}.pdf`;
				zip.file(fileName, blob);
			}
			const content = await zip.generateAsync({ type: 'blob' });
			const url = URL.createObjectURL(content);
			const a = document.createElement('a');
			a.href = url;
			a.download = `${zipName}.zip`;
			a.click();
			URL.revokeObjectURL(url);
		} catch (e) {
			clientLogger.apiError('client_meta_ads_zip_download', e);
		} finally {
			zipping = false;
		}
	}

	async function downloadSelected() {
		const ids = [...selectedInvoices];
		if (ids.length === 0) return;
		await downloadAsZip(ids, `MetaAds-Facturi-selectate-${ids.length}`);
		selectedInvoices.clear();
	}

	async function downloadPeriodZip(periodInvoices: typeof downloads, periodLabel: string) {
		const ids = periodInvoices.map(d => d.id);
		await downloadAsZip(ids, `MetaAds-${periodLabel}`);
	}

	function togglePeriod(key: string) {
		if (expandedPeriods.has(key)) expandedPeriods.delete(key);
		else expandedPeriods.add(key);
	}

	function toggleAccount(key: string) {
		if (expandedAccounts.has(key)) expandedAccounts.delete(key);
		else expandedAccounts.add(key);
	}

	// Auto-expand all clients on load (client view) — periods stay collapsed
	let autoExpandedOnce = false;
	$effect(() => {
		if (autoExpandedOnce || groupedByClient.length === 0) return;
		autoExpandedOnce = true;
		for (const group of groupedByClient) {
			expandedAccounts.add(group.clientName);
		}
	});

	const filteredGroupedByClient = $derived(
		spendSearchQuery.trim()
			? groupedByClient.filter((g) =>
				g.clientName.toLowerCase().includes(spendSearchQuery.trim().toLowerCase()) ||
				g.businessName.toLowerCase().includes(spendSearchQuery.trim().toLowerCase())
			)
			: groupedByClient
	);

	// Map downloads by periodStart+accountId — array of all invoices per account+period
	const downloadsByKey = $derived.by(() => {
		const map = new Map<string, (typeof downloads)>();
		for (const dl of downloads) {
			const key = `${dl.metaAdAccountId}:${dl.periodStart}`;
			const arr = map.get(key) || [];
			arr.push(dl);
			map.set(key, arr);
		}
		return map;
	});

	// Group downloads per client for pill counts (filtered by date range)
	const downloadsByClient = $derived.by(() => {
		const sinceMonth = since.substring(0, 7);
		const untilMonth = until.substring(0, 7);
		const map = new Map<string, typeof downloads>();
		for (const dl of downloads) {
			const period = dl.periodStart?.substring(0, 7);
			if (period && (period < sinceMonth || period > untilMonth)) continue;
			const key = dl.clientName || 'unknown';
			const arr = map.get(key) || [];
			arr.push(dl);
			map.set(key, arr);
		}
		return map;
	});

	// Date range label
	const dateRangeLabel = $derived.by(() => {
		for (const p of _presets) {
			if (p.since === since && p.until === until) return p.label;
		}
		const fmt = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' });
		return `${fmt(since)} — ${fmt(until)}`;
	});

	async function handlePreviewInvoicePDF(id: string) {
		try {
			const response = await fetch(`/client/${tenantSlug}/invoices/meta-ads/downloads/${id}/pdf`);
			if (!response.ok) throw new Error('Failed to load PDF');
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			window.open(url, '_blank');
		} catch (e) { clientLogger.apiError('client_meta_ads_preview_pdf', e); }
	}

	async function handleDownloadInvoicePDF(id: string, period: string) {
		try {
			const response = await fetch(`/client/${tenantSlug}/invoices/meta-ads/downloads/${id}/pdf`);
			if (!response.ok) throw new Error('Failed to download PDF');
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `MetaAds-Factura-${period.replace(/[^a-zA-Z0-9-_]/g, '_')}.pdf`;
			a.click();
			URL.revokeObjectURL(url);
		} catch (e) { clientLogger.apiError('client_meta_ads_download_pdf', e); }
	}
</script>

<div class="space-y-6">
	<!-- Header -->
	<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
		<div>
			<h1 class="text-3xl font-bold flex items-center gap-3">
				<IconFacebook class="h-8 w-8" />
				Facturi Meta Ads
			</h1>
			<p class="text-muted-foreground">Cheltuieli lunare și documente de facturare</p>
		</div>
		<div class="flex items-center gap-2">
			<div class="relative w-48">
				<Search class="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
				<Input bind:value={spendSearchQuery} type="text" placeholder="Caută..." class="pl-8 h-9 text-sm" />
			</div>
			<DateRangePicker bind:since bind:until />
		</div>
	</div>

	<!-- Spending cards per client -->
	{#if loading}
		<div class="space-y-4">
			{#each Array(2) as _, idx (idx)}<Card class="p-6"><Skeleton class="h-48 w-full" /></Card>{/each}
		</div>
	{:else if spending.length === 0 && downloads.length === 0}
		<Card class="p-12 text-center">
			<div class="flex flex-col items-center gap-3">
				<div class="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
					<DollarSignIcon class="h-7 w-7 text-muted-foreground" />
				</div>
				<p class="text-lg font-medium">Nu există date de facturare</p>
				<p class="text-sm text-muted-foreground">Nu sunt cheltuieli Meta Ads înregistrate.</p>
			</div>
		</Card>
	{:else}

		{#if filteredGroupedByClient.length === 0}
			<p class="text-sm text-muted-foreground text-center py-4">Niciun cont găsit pentru „{spendSearchQuery}"</p>
		{:else}
			<div class="space-y-4">
				{#each filteredGroupedByClient as group (group.clientName)}
					{@const totalSpend = group.rows.reduce((s, r) => s + (r.spendCents || 0), 0)}
					{@const totalClicks = group.rows.reduce((s, r) => s + (r.clicks || 0), 0)}
					{@const totalImpressions = group.rows.reduce((s, r) => s + (r.impressions || 0), 0)}
					{@const curr = group.rows[0]?.currencyCode || 'RON'}
					{@const daysInRange = Math.max(1, Math.round((new Date(until).getTime() - new Date(since).getTime()) / 86400000) + 1)}
					{@const spendPerDay = totalSpend > 0 ? Math.round(totalSpend / daysInRange) : 0}
					{@const isExpanded = expandedAccounts.has(group.clientName)}
					{@const clientDls = downloadsByClient.get(group.clientName) || []}
					{@const dlCount = clientDls.filter(d => d.status === 'downloaded' && d.invoiceType !== 'credit').length}
					{@const creditDlCount = clientDls.filter(d => d.status === 'downloaded' && d.invoiceType === 'credit').length}
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
												<div class="flex items-center gap-2">
													<h3 class="text-lg font-semibold">{group.clientName}</h3>
													{#if dlCount > 0}
														<span class="inline-flex items-center rounded-full border border-green-200 px-2 py-0.5 text-xs font-medium text-green-700 bg-green-50">{dlCount} facturi</span>
													{/if}
													{#if creditDlCount > 0 && showCredits}
														<span class="inline-flex items-center rounded-full border border-amber-200 px-2 py-0.5 text-xs font-medium text-amber-700 bg-amber-50">{creditDlCount} credite</span>
													{/if}
												</div>
												<span class="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground"><CalendarIcon class="h-3 w-3" />{dateRangeLabel}</span>
											</div>
										</div>
										<div class="flex items-center gap-4">
											<div class="text-right">
												<p class="text-sm text-muted-foreground">Total cheltuieli · {new Date(since + 'T00:00:00').toLocaleDateString('ro-RO', { day: 'numeric', month: 'long' })} — {new Date(until + 'T00:00:00').toLocaleDateString('ro-RO', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
												<p class="text-2xl font-bold">{formatAmount(totalSpend, curr)}</p>
												{#if spendPerDay > 0}
													<p class="inline-flex items-center rounded-full border border-green-200 bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700 mt-1">{formatAmount(spendPerDay, curr)} / zi</p>
												{/if}
											</div>
											<ChevronDownIcon class="h-5 w-5 text-muted-foreground shrink-0 transition-transform duration-200 {isExpanded ? 'rotate-180' : ''}" />
										</div>
									</div>
								</div>
							</CollapsibleTrigger>

							<CollapsibleContent>
								<!-- Spend chart per account -->
								{#if group.rows.some(r => r.spendCents > 0)}
									<div class="px-6 py-4 border-t">
										<p class="text-sm font-medium mb-3">Cheltuieli per zi / cont</p>
										<AccountSpendChart rows={group.rows} currency={curr} />
									</div>
								{/if}
								<!-- Data table -->
								<table class="w-full border-t">
									<thead>
										<tr class="bg-muted/30 text-sm font-semibold text-muted-foreground">
											<td class="px-6 py-2.5"><span class="inline-flex items-center gap-1.5"><CalendarIcon class="h-3.5 w-3.5" />Perioadă</span></td>
											<td class="px-3 py-2.5 text-right"><span class="inline-flex items-center gap-1.5"><WalletIcon class="h-3.5 w-3.5" />Cheltuieli</span></td>
											<td class="px-2 py-2.5 text-right w-[60px]"></td>
											<td class="px-3 py-2.5 text-right"><span class="inline-flex items-center gap-1.5"><EyeIcon class="h-3.5 w-3.5" />Impresii</span></td>
											<td class="px-3 py-2.5 text-right"><span class="inline-flex items-center gap-1.5"><MousePointerClickIcon class="h-3.5 w-3.5" />Click-uri</span></td>
											<td class="px-6 py-2.5 text-right"><span class="inline-flex items-center gap-1.5"><FileTextIcon class="h-3.5 w-3.5" />Facturi</span></td>
										</tr>
									</thead>
									<tbody class="divide-y">
									{#each group.rows as row, i (row.id)}
										{@const isDownloadOnly = (row as any)._downloadOnly === true}
										{@const prevSpend = !isDownloadOnly ? group.rows[i + 1]?.spendCents : null}
										{@const trend = prevSpend ? ((row.spendCents - prevSpend) / prevSpend) * 100 : null}
										{@const invoices = downloadsByKey.get(`${row.metaAdAccountId}:${row.periodStart}`) || []}
										{@const allDownloaded = invoices.filter(d => d.status === 'downloaded' && d.pdfPath)}
										{@const filteredDownloaded = showCredits ? allDownloaded : allDownloaded.filter(d => d.invoiceType !== 'credit')}
										{@const hasIndividual = filteredDownloaded.some(d => d.txid)}
										{@const downloadedInvoices = hasIndividual ? filteredDownloaded.filter(d => d.txid) : filteredDownloaded}
										{@const periodKey = `${group.clientName}:${row.metaAdAccountId}:${row.periodStart}`}
										{@const isPeriodExpanded = expandedPeriods.has(periodKey)}
										<!-- Period row -->
										<tr class="hover:bg-muted/30 transition-colors cursor-pointer" onclick={() => downloadedInvoices.length > 0 && togglePeriod(periodKey)} onkeydown={(e) => e.key === 'Enter' && downloadedInvoices.length > 0 && togglePeriod(periodKey)} tabindex="0">
											<td class="px-6 py-3">
												<div class="flex items-center gap-2 min-w-0">
													<CalendarIcon class="h-4 w-4 text-muted-foreground shrink-0" />
													<span class="font-medium capitalize whitespace-nowrap">{formatPeriod(row.periodStart)}</span>
													{#if group.hasMultipleAccounts && (row.adAccountName || row.metaAdAccountId)}
														<span class="inline-flex items-center rounded-md border bg-muted/50 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{row.adAccountName || row.metaAdAccountId}</span>
													{/if}
												</div>
											</td>
											{#if isDownloadOnly}
												<td></td>
												<td></td>
												<td></td>
												<td></td>
											{:else}
												{@const periodDays = (() => { const start = new Date(row.periodStart); const end = new Date(row.periodEnd || row.periodStart); return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1); })()}
												{@const rowSpendPerDay = row.spendCents > 0 ? Math.round(row.spendCents / periodDays) : 0}
												<td class="px-3 py-3 text-right whitespace-nowrap">
													<span class="text-base font-semibold">{formatAmount(row.spendCents, row.currencyCode)}</span>
													{#if rowSpendPerDay > 0}
														<br><span class="inline-flex items-center rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700">{formatAmount(rowSpendPerDay, row.currencyCode)} / zi</span>
													{/if}
												</td>
												<td class="px-2 py-3 text-right whitespace-nowrap">
													{#if trend !== null}
														<span class="text-xs {trend >= 0 ? 'text-red-500' : 'text-green-500'}">{trend >= 0 ? '+' : ''}{trend.toFixed(1)}%</span>
													{/if}
												</td>
												<td class="px-3 py-3 text-sm text-muted-foreground text-right whitespace-nowrap">{formatNumber(row.impressions)}</td>
												<td class="px-3 py-3 text-sm text-right whitespace-nowrap">{formatNumber(row.clicks)}</td>
											{/if}
											<td class="px-6 py-3 text-right">
												{#if downloadedInvoices.length > 0}
													<div class="flex items-center justify-end gap-1">
														<button class="inline-flex items-center gap-1 rounded-full border border-green-200 px-2.5 py-1 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 transition-colors cursor-pointer whitespace-nowrap" onclick={(e) => { e.stopPropagation(); togglePeriod(periodKey); }}>
															<ChevronRightIcon class="h-3 w-3 transition-transform duration-200 {isPeriodExpanded ? 'rotate-90' : ''}" />
															{downloadedInvoices.length} {downloadedInvoices.length === 1 ? 'factură' : 'facturi'}
														</button>
														<Button variant="ghost" size="icon" class="h-7 w-7" onclick={(e) => { e.stopPropagation(); downloadPeriodZip(downloadedInvoices, `${row.periodStart}-${row.adAccountName || row.metaAdAccountId}`); }} title="Descarcă toate ca ZIP" disabled={zipping}>
															<FileArchive class="h-3.5 w-3.5" />
														</Button>
													</div>
												{:else if !isDownloadOnly}
													<span class="text-xs text-orange-500">În așteptare</span>
												{/if}
											</td>
										</tr>
										<!-- Expandable invoice list -->
										{#if isPeriodExpanded && downloadedInvoices.length > 0}
											{#each downloadedInvoices as inv}
												<tr class="bg-muted/10 hover:bg-muted/20 transition-colors">
													<td colspan="6" class="px-6 py-2 pl-10">
														<div class="flex items-center gap-3">
															<Checkbox checked={selectedInvoices.has(inv.id)} onCheckedChange={() => toggleSelectInvoice(inv.id)} />
															<div class="flex items-center gap-2 min-w-0 flex-1">
																<span class="text-sm font-medium text-blue-600">{inv.invoiceNumber ? `Invoice no. ${inv.invoiceNumber}` : (inv.txid ? `TX-${inv.txid.substring(0, 16)}…` : 'Factura PDF')}</span>
																{#if inv.invoiceType === 'credit'}<span class="inline-flex items-center rounded-full border border-amber-200 px-1.5 py-0 text-[10px] font-medium text-amber-700 bg-amber-50">Credit</span>{/if}
																{#if inv.amountText}<span class="text-xs text-muted-foreground">{inv.amountText}</span>{/if}
															</div>
															<div class="flex items-center gap-0.5 shrink-0">
																<Button variant="outline" size="sm" class="h-7 text-xs" onclick={() => handleDownloadInvoicePDF(inv.id, row.periodStart)}>
																	<Download class="mr-1 h-3 w-3" />Descarcă factura
																</Button>
																<Button variant="ghost" size="icon" class="h-7 w-7" onclick={() => handlePreviewInvoicePDF(inv.id)} title="Previzualizare"><Eye class="h-3.5 w-3.5" /></Button>
															</div>
														</div>
													</td>
												</tr>
											{/each}
										{/if}
									{/each}
									</tbody>
									<!-- Total row -->
									{#if group.rows.length > 1}
										{@const allGroupInvoices = group.rows.flatMap(r => {
											const key = `${r.metaAdAccountId}:${r.periodStart}`;
											const all = (downloadsByKey.get(key) || []).filter(d => d.status === 'downloaded' && d.pdfPath);
											const filtered = showCredits ? all : all.filter(d => d.invoiceType !== 'credit');
											const hasIndividual = filtered.some(d => d.txid);
											return hasIndividual ? filtered.filter(d => d.txid) : filtered;
										})}
										{@const totalInvoices = allGroupInvoices.length}
										<tfoot>
											<tr class="border-t-2 border-border bg-muted">
												<td class="px-6 py-3 font-semibold text-sm">Total</td>
												<td class="px-3 py-3 text-right whitespace-nowrap">
													<span class="text-base font-bold">{formatAmount(totalSpend, curr)}</span>
												</td>
												<td></td>
												<td class="px-3 py-3 text-sm font-semibold text-right whitespace-nowrap">{formatNumber(totalImpressions)}</td>
												<td class="px-3 py-3 text-sm font-semibold text-right whitespace-nowrap">{formatNumber(totalClicks)}</td>
												<td class="px-6 py-3 text-right">
													{#if totalInvoices > 0}
														<div class="flex items-center justify-end gap-1">
															<span class="inline-flex items-center rounded-full border border-green-200 px-2.5 py-1 text-xs font-medium text-green-700 bg-green-50">{totalInvoices} facturi</span>
															<Button variant="ghost" size="icon" class="h-7 w-7" onclick={() => downloadPeriodZip(allGroupInvoices, `${group.clientName}-total`)} title="Descarcă toate ca ZIP" disabled={zipping}>
																<FileArchive class="h-3.5 w-3.5" />
															</Button>
														</div>
													{/if}
												</td>
											</tr>
										</tfoot>
									{/if}
								</table>
							</CollapsibleContent>
						</Card>
					</Collapsible>
				{/each}
			</div>
		{/if}
	{/if}
</div>

<!-- Floating selection bar -->
{#if selectedInvoices.size > 0}
	<div class="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-full border bg-background/95 backdrop-blur shadow-lg px-5 py-2.5">
		<span class="text-sm font-medium">{selectedInvoices.size} {selectedInvoices.size === 1 ? 'factură selectată' : 'facturi selectate'}</span>
		<Button size="sm" onclick={downloadSelected} disabled={zipping}>
			<FileArchive class="mr-1.5 h-3.5 w-3.5" />{zipping ? 'Se creează ZIP...' : 'Descarcă ZIP'}
		</Button>
		<Button variant="ghost" size="sm" onclick={() => selectedInvoices.clear()}>Anulează</Button>
	</div>
{/if}
