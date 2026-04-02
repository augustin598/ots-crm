<script lang="ts">
	import { getTiktokAdsSpendingList } from '$lib/remotes/tiktok-ads.remote';
	import { page } from '$app/state';
	import { Card } from '$lib/components/ui/card';
	import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '$lib/components/ui/collapsible';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Download, Search, Eye, FileArchive } from '@lucide/svelte';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import DollarSignIcon from '@lucide/svelte/icons/dollar-sign';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import WalletIcon from '@lucide/svelte/icons/wallet';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import MousePointerClickIcon from '@lucide/svelte/icons/mouse-pointer-click';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import IconTiktok from '$lib/components/marketing/icon-tiktok.svelte';
	import AccountSpendChart from '$lib/components/reports/account-spend-chart.svelte';
	import DateRangePicker from '$lib/components/reports/date-range-picker.svelte';
	import { getDefaultDateRange, getDatePresets } from '$lib/utils/report-helpers';
	import { SvelteSet } from 'svelte/reactivity';
	import { clientLogger } from '$lib/client-logger';
	import JSZip from 'jszip';

	const tenantSlug = $derived(page.params.tenant as string);

	// Date range — implicit: luna trecută (la fel ca Meta)
	const _presets = getDatePresets();
	const _lastMonth = _presets.find(p => p.label === 'Luna trecută');
	const _defaults = _lastMonth || getDefaultDateRange();
	let since = $state(_defaults.since);
	let until = $state(_defaults.until);
	const dateRangeLabel = $derived.by(() => {
		for (const p of _presets) {
			if (p.since === since && p.until === until) return p.label;
		}
		const fmt = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' });
		return `${fmt(since)} — ${fmt(until)}`;
	});

	const spendingQuery = getTiktokAdsSpendingList();
	const spending = $derived(spendingQuery.current || []);
	const loading = $derived(spendingQuery.loading);

	// ---- Helpers ----

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

	// ---- Data grouping (mirroring Meta client structure) ----

	const dateFilteredSpending = $derived(
		spending.filter((r: any) => {
			if (!r.periodStart) return true;
			const period = r.periodStart.substring(0, 7);
			return period >= since.substring(0, 7) && period <= until.substring(0, 7);
		})
	);

	const groupedByClient = $derived.by(() => {
		const groups = new Map<string, { clientName: string; hasMultipleAccounts: boolean; rows: typeof spending }>();
		for (const row of dateFilteredSpending) {
			const key = row.clientName || 'Neatribuit';
			const existing = groups.get(key) || { clientName: key, hasMultipleAccounts: false, rows: [] };
			existing.rows.push(row);
			groups.set(key, existing);
		}
		for (const group of groups.values()) {
			const uniqueAccounts = new Set(group.rows.map((r: any) => r.tiktokAdvertiserId));
			group.hasMultipleAccounts = uniqueAccounts.size > 1;
			group.rows.sort((a: any, b: any) => (b.periodStart || '').localeCompare(a.periodStart || ''));
		}
		return Array.from(groups.values()).sort((a, b) => a.clientName.localeCompare(b.clientName));
	});

	// Count invoices per client for badge
	const invoiceCountByClient = $derived.by(() => {
		const sinceMonth = since.substring(0, 7);
		const untilMonth = until.substring(0, 7);
		const map = new Map<string, number>();
		for (const row of spending) {
			if (!row.pdfPath) continue;
			const period = row.periodStart?.substring(0, 7);
			if (period && (period < sinceMonth || period > untilMonth)) continue;
			const key = row.clientName || 'Neatribuit';
			map.set(key, (map.get(key) || 0) + 1);
		}
		return map;
	});

	// ---- UI state ----

	let spendSearchQuery = $state('');
	let expandedAccounts = new SvelteSet<string>();
	let expandedPeriods = new SvelteSet<string>();
	let selectedInvoices = new SvelteSet<string>();
	let zipping = $state(false);

	const filteredGroupedByClient = $derived(
		spendSearchQuery.trim()
			? groupedByClient.filter((g) =>
				g.clientName.toLowerCase().includes(spendSearchQuery.trim().toLowerCase()) ||
				g.rows.some((r: any) => (r.tiktokAdvertiserId || '').toLowerCase().includes(spendSearchQuery.trim().toLowerCase()))
			)
			: groupedByClient
	);

	function toggleAccount(key: string) {
		if (expandedAccounts.has(key)) expandedAccounts.delete(key);
		else expandedAccounts.add(key);
	}

	function togglePeriod(key: string) {
		if (expandedPeriods.has(key)) expandedPeriods.delete(key);
		else expandedPeriods.add(key);
	}

	let autoExpandedOnce = false;
	$effect(() => {
		if (autoExpandedOnce || groupedByClient.length === 0) return;
		autoExpandedOnce = true;
		for (const group of groupedByClient) {
			expandedAccounts.add(group.clientName);
		}
	});

	function toggleSelectInvoice(id: string) {
		if (selectedInvoices.has(id)) selectedInvoices.delete(id);
		else selectedInvoices.add(id);
	}

	// ---- PDF download/preview ----

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

	// ---- ZIP Download ----

	async function downloadAsZip(invoiceIds: string[], zipName: string) {
		zipping = true;
		try {
			const zip = new JSZip();
			for (const id of invoiceIds) {
				const res = await fetch(`/client/${tenantSlug}/invoices/tiktok-ads/${id}/pdf`);
				if (!res.ok) continue;
				const blob = await res.blob();
				const row = spending.find((s: any) => s.id === id);
				const fileName = row?.periodStart
					? `TikTokAds-${row.periodStart}.pdf`
					: `TikTokAds-${id.substring(0, 8)}.pdf`;
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
			clientLogger.apiError('client_tiktok_ads_zip_download', e, 'EXPORT_GENERATION_FAILED');
		} finally {
			zipping = false;
		}
	}

	async function downloadSelected() {
		const ids = [...selectedInvoices];
		if (ids.length === 0) return;
		await downloadAsZip(ids, `TikTokAds-Facturi-selectate-${ids.length}`);
		selectedInvoices.clear();
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
		<div class="flex items-center gap-2">
			<div class="relative w-48">
				<Search class="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
				<Input bind:value={spendSearchQuery} type="text" placeholder="Caută..." class="pl-8 h-9 text-sm" />
			</div>
			<DateRangePicker bind:since bind:until />
		</div>
	</div>

	<!-- Spending cards per client (Meta-style) -->
	{#if loading}
		<div class="space-y-4">
			{#each Array(2) as _, idx (idx)}<Card class="p-6"><Skeleton class="h-48 w-full" /></Card>{/each}
		</div>
	{:else if spending.length === 0}
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

		{#if filteredGroupedByClient.length === 0}
			<p class="text-sm text-muted-foreground text-center py-4">Niciun cont găsit pentru „{spendSearchQuery}"</p>
		{:else}
			<div class="space-y-4">
				{#each filteredGroupedByClient as group (group.clientName)}
					{@const totalSpend = group.rows.reduce((s: number, r: any) => s + (r.spendCents || 0), 0)}
					{@const totalClicks = group.rows.reduce((s: number, r: any) => s + (r.clicks || 0), 0)}
					{@const totalImpressions = group.rows.reduce((s: number, r: any) => s + (r.impressions || 0), 0)}
					{@const curr = group.rows[0]?.currencyCode || 'RON'}
					{@const daysInRange = Math.max(1, Math.round((new Date(until).getTime() - new Date(since).getTime()) / 86400000) + 1)}
					{@const spendPerDay = totalSpend > 0 ? Math.round(totalSpend / daysInRange) : 0}
					{@const isExpanded = expandedAccounts.has(group.clientName)}
					{@const dlCount = invoiceCountByClient.get(group.clientName) || 0}
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
														<span class="inline-flex items-center rounded-full border border-green-200 px-2 py-0.5 text-xs font-medium text-green-700 bg-green-50">{dlCount} {dlCount === 1 ? 'factură' : 'facturi'}</span>
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
								{#if group.rows.some((r: any) => r.spendCents > 0)}
									<div class="px-6 py-4 border-t">
										<p class="text-sm font-medium mb-3">Cheltuieli per zi / cont</p>
										<AccountSpendChart rows={group.rows.map((r: any) => ({ periodStart: r.periodStart, periodEnd: r.periodEnd || r.periodStart, adAccountName: r.tiktokAdvertiserId, metaAdAccountId: r.tiktokAdvertiserId, spendCents: r.spendCents || 0, currencyCode: r.currencyCode }))} currency={curr} />
									</div>
								{/if}
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
											{@const prevSpend = group.rows[i + 1]?.spendCents}
											{@const trend = prevSpend ? (((row.spendCents || 0) - prevSpend) / prevSpend) * 100 : null}
											{@const hasPdf = !!row.pdfPath}
											{@const periodKey = `${group.clientName}:${row.tiktokAdvertiserId}:${row.periodStart}`}
											{@const isPeriodExpanded = expandedPeriods.has(periodKey)}
											{@const periodDays = (() => { const start = new Date(row.periodStart); const end = new Date(row.periodEnd || row.periodStart); return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1); })()}
											{@const rowSpendPerDay = (row.spendCents || 0) > 0 ? Math.round((row.spendCents || 0) / periodDays) : 0}
											<!-- Period row -->
											<tr class="hover:bg-muted/30 transition-colors cursor-pointer" onclick={() => hasPdf && togglePeriod(periodKey)} onkeydown={(e) => e.key === 'Enter' && hasPdf && togglePeriod(periodKey)} role="button" tabindex="0">
												<td class="px-6 py-3">
													<div class="flex items-center gap-2 min-w-0">
														<CalendarIcon class="h-4 w-4 text-muted-foreground shrink-0" />
														<span class="font-medium capitalize whitespace-nowrap">{formatPeriod(row.periodStart)}</span>
														{#if group.hasMultipleAccounts && row.tiktokAdvertiserId}
															<span class="inline-flex items-center rounded-md border bg-muted/50 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{row.tiktokAdvertiserId}</span>
														{/if}
													</div>
												</td>
												<td class="px-3 py-3 text-right whitespace-nowrap">
													<span class="text-base font-semibold">{formatAmount(row.spendCents, row.currencyCode)}</span>
													{#if rowSpendPerDay > 0}
														<p class="inline-flex items-center rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[10px] font-medium text-green-700 mt-0.5">{formatAmount(rowSpendPerDay, row.currencyCode)} / zi</p>
													{/if}
												</td>
												<td class="px-2 py-3 text-right whitespace-nowrap">
													{#if trend !== null}
														<span class="text-xs {trend >= 0 ? 'text-red-500' : 'text-green-500'}">{trend >= 0 ? '+' : ''}{trend.toFixed(1)}%</span>
													{/if}
												</td>
												<td class="px-3 py-3 text-sm text-muted-foreground text-right whitespace-nowrap">{formatNumber(row.impressions)}</td>
												<td class="px-3 py-3 text-sm text-right whitespace-nowrap">{formatNumber(row.clicks)}</td>
												<td class="px-6 py-3 text-right">
													{#if hasPdf}
														<button class="inline-flex items-center gap-1 rounded-full border border-green-200 px-2.5 py-1 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 transition-colors cursor-pointer whitespace-nowrap" onclick={(e) => { e.stopPropagation(); togglePeriod(periodKey); }}>
															<ChevronRightIcon class="h-3 w-3 transition-transform duration-200 {isPeriodExpanded ? 'rotate-90' : ''}" />
															1 factură
														</button>
													{:else}
														<span class="text-xs text-orange-500">In asteptare</span>
													{/if}
												</td>
											</tr>
											<!-- Expandable invoice row -->
											{#if isPeriodExpanded && hasPdf}
												<tr class="bg-muted/10 hover:bg-muted/20 transition-colors">
													<td colspan="6">
														<div class="flex items-center gap-3 px-6 py-2 pl-10">
															<Checkbox checked={selectedInvoices.has(row.id)} onCheckedChange={() => toggleSelectInvoice(row.id)} />
															<div class="flex items-center gap-2 min-w-0 flex-1">
																<span class="text-sm font-medium text-blue-600">Factura PDF</span>
																<span class="text-xs text-muted-foreground">{formatAmount(row.spendCents, row.currencyCode)}</span>
															</div>
															<div class="flex items-center gap-0.5 shrink-0">
																<Button variant="outline" size="sm" class="h-7 text-xs" onclick={() => handleDownloadPDF(row.id, row.periodStart)}>
																	<Download class="mr-1 h-3 w-3" />Descarca factura
																</Button>
																<Button variant="ghost" size="icon" class="h-7 w-7" onclick={() => handlePreviewPDF(row.id)} title="Previzualizare"><Eye class="h-3.5 w-3.5" /></Button>
															</div>
														</div>
													</td>
												</tr>
											{/if}
										{/each}
									</tbody>
									{#if group.rows.length > 1}
										{@const totalPdfRows = group.rows.filter((r: any) => r.pdfPath)}
										{@const totalInvoices = totalPdfRows.length}
										<tfoot>
											<tr class="border-t-2 border-border bg-muted">
												<td class="px-6 py-3 font-semibold text-sm">Total</td>
												<td class="px-3 py-3 text-right whitespace-nowrap"><span class="text-base font-bold">{formatAmount(totalSpend, curr)}</span></td>
												<td></td>
												<td class="px-3 py-3 text-sm font-semibold text-right whitespace-nowrap">{formatNumber(totalImpressions)}</td>
												<td class="px-3 py-3 text-sm font-semibold text-right whitespace-nowrap">{formatNumber(totalClicks)}</td>
												<td class="px-6 py-3 text-right">
													{#if totalInvoices > 0}
														<span class="inline-flex items-center rounded-full border border-green-200 px-2.5 py-1 text-xs font-medium text-green-700 bg-green-50">{totalInvoices} facturi</span>
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
