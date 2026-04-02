<script lang="ts">
	import { getTiktokInvoiceDownloads } from '$lib/remotes/tiktok-ads.remote';
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
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import IconTiktok from '$lib/components/marketing/icon-tiktok.svelte';
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

	const invoicesQuery = getTiktokInvoiceDownloads();
	const invoices = $derived(invoicesQuery.current || []);
	const loading = $derived(invoicesQuery.loading);

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

	// ---- Data grouping ----

	const dateFilteredInvoices = $derived(
		invoices.filter((r: any) => {
			if (!r.periodStart) return true;
			const period = r.periodStart.substring(0, 7);
			return period >= since.substring(0, 7) && period <= until.substring(0, 7);
		})
	);

	const groupedByClient = $derived.by(() => {
		const groups = new Map<string, { clientName: string; hasMultipleAccounts: boolean; rows: typeof invoices }>();
		for (const row of dateFilteredInvoices) {
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

	// Count downloaded invoices per client for badge
	const invoiceCountByClient = $derived.by(() => {
		const sinceMonth = since.substring(0, 7);
		const untilMonth = until.substring(0, 7);
		const map = new Map<string, number>();
		for (const row of invoices) {
			if (row.status !== 'downloaded' || !row.pdfPath) continue;
			const period = row.periodStart?.substring(0, 7);
			if (period && (period < sinceMonth || period > untilMonth)) continue;
			const key = row.clientName || 'Neatribuit';
			map.set(key, (map.get(key) || 0) + 1);
		}
		return map;
	});

	// ---- UI state ----

	let searchQuery = $state('');
	let expandedAccounts = new SvelteSet<string>();
	let selectedInvoices = new SvelteSet<string>();
	let zipping = $state(false);

	const filteredGroupedByClient = $derived(
		searchQuery.trim()
			? groupedByClient.filter((g) => {
				const q = searchQuery.trim().toLowerCase();
				return g.clientName.toLowerCase().includes(q) ||
					g.rows.some((r: any) =>
						(r.tiktokAdvertiserId || '').toLowerCase().includes(q) ||
						(r.adAccountName || '').toLowerCase().includes(q) ||
						(r.invoiceNumber || '').toLowerCase().includes(q)
					);
			})
			: groupedByClient
	);

	function toggleAccount(key: string) {
		if (expandedAccounts.has(key)) expandedAccounts.delete(key);
		else expandedAccounts.add(key);
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

	async function handleDownloadPDF(id: string, invoiceNumber: string | null, period: string) {
		try {
			const response = await fetch(`/client/${tenantSlug}/invoices/tiktok-ads/downloads/${id}/pdf`);
			if (!response.ok) throw new Error('Failed to download PDF');
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			const name = invoiceNumber || `TikTokAds-${period}`;
			a.download = `${name.replace(/[^a-zA-Z0-9-_]/g, '_')}.pdf`;
			a.click();
			URL.revokeObjectURL(url);
		} catch (e) {
			clientLogger.apiError('client_tiktok_ads_download_pdf', e);
		}
	}

	async function handlePreviewPDF(id: string) {
		try {
			const response = await fetch(`/client/${tenantSlug}/invoices/tiktok-ads/downloads/${id}/pdf`);
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
				const res = await fetch(`/client/${tenantSlug}/invoices/tiktok-ads/downloads/${id}/pdf`);
				if (!res.ok) continue;
				const blob = await res.blob();
				const row = invoices.find((s: any) => s.id === id);
				const fileName = row?.invoiceNumber
					? `${row.invoiceNumber}.pdf`
					: row?.periodStart
						? `TikTokAds-Factura-${row.periodStart}.pdf`
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
			<p class="text-muted-foreground">Facturi oficiale descărcate din TikTok Business Center</p>
		</div>
		<div class="flex items-center gap-2">
			<div class="relative w-48">
				<Search class="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
				<Input bind:value={searchQuery} type="text" placeholder="Caută..." class="pl-8 h-9 text-sm" />
			</div>
			<DateRangePicker bind:since bind:until />
		</div>
	</div>

	<!-- Invoice cards per client -->
	{#if loading}
		<div class="space-y-4">
			{#each Array(2) as _, idx (idx)}<Card class="p-6"><Skeleton class="h-48 w-full" /></Card>{/each}
		</div>
	{:else if invoices.length === 0}
		<Card class="p-12 text-center">
			<div class="flex flex-col items-center gap-3">
				<div class="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
					<FileTextIcon class="h-7 w-7 text-muted-foreground" />
				</div>
				<p class="text-lg font-medium">Nu sunt facturi oficiale TikTok</p>
				<p class="text-sm text-muted-foreground">Nu sunt facturi TikTok Ads descărcate pentru acest cont.</p>
			</div>
		</Card>
	{:else}

		{#if filteredGroupedByClient.length === 0}
			<p class="text-sm text-muted-foreground text-center py-4">Niciun rezultat găsit pentru „{searchQuery}"</p>
		{:else}
			<div class="space-y-4">
				{#each filteredGroupedByClient as group (group.clientName)}
					{@const totalAmount = group.rows.reduce((s: number, r: any) => s + (r.amountCents || 0), 0)}
					{@const curr = group.rows[0]?.currencyCode || 'RON'}
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
												<p class="text-xs text-muted-foreground">Total facturi</p>
												<p class="text-lg font-bold">{formatAmount(totalAmount, curr)}</p>
											</div>
											<ChevronDownIcon class="h-5 w-5 text-muted-foreground shrink-0 transition-transform duration-200 {isExpanded ? 'rotate-180' : ''}" />
										</div>
									</div>
								</div>
							</CollapsibleTrigger>

							<CollapsibleContent>
								<table class="w-full border-t">
									<thead>
										<tr class="bg-muted/30 text-sm font-semibold text-muted-foreground">
											<td class="px-6 py-2.5"><span class="inline-flex items-center gap-1.5"><CalendarIcon class="h-3.5 w-3.5" />Perioadă</span></td>
											<td class="px-3 py-2.5">Nr. Factură</td>
											<td class="px-3 py-2.5 text-right">Sumă</td>
											<td class="px-3 py-2.5 text-center">Status</td>
											<td class="px-6 py-2.5 text-right">Acțiuni</td>
										</tr>
									</thead>
									<tbody class="divide-y">
										{#each group.rows as row (row.id)}
											{@const hasPdf = row.status === 'downloaded' && !!row.pdfPath}
											<tr class="hover:bg-muted/30 transition-colors">
												<td class="px-6 py-3">
													<div class="flex items-center gap-2 min-w-0">
														{#if hasPdf}
															<Checkbox checked={selectedInvoices.has(row.id)} onCheckedChange={() => toggleSelectInvoice(row.id)} />
														{/if}
														<CalendarIcon class="h-4 w-4 text-muted-foreground shrink-0" />
														<span class="font-medium capitalize whitespace-nowrap">{formatPeriod(row.periodStart)}</span>
														{#if group.hasMultipleAccounts && (row.adAccountName || row.tiktokAdvertiserId)}
															<span class="inline-flex items-center rounded-md border bg-muted/50 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground truncate max-w-[150px]">{row.adAccountName || row.tiktokAdvertiserId}</span>
														{/if}
													</div>
												</td>
												<td class="px-3 py-3 text-sm text-muted-foreground truncate" title={row.invoiceNumber || ''}>{row.invoiceNumber || '-'}</td>
												<td class="px-3 py-3 text-right whitespace-nowrap">
													<span class="text-base font-semibold">{formatAmount(row.amountCents, row.currencyCode)}</span>
												</td>
												<td class="px-3 py-3 text-center">
													{#if row.status === 'downloaded' && row.pdfPath}
														<span class="inline-flex items-center rounded-full border border-green-200 px-2 py-0.5 text-xs font-medium text-green-700 bg-green-50">Descărcată</span>
													{:else if row.status === 'pending'}
														<span class="inline-flex items-center rounded-full border border-orange-200 px-2 py-0.5 text-xs font-medium text-orange-700 bg-orange-50">În așteptare</span>
													{:else if row.status === 'error'}
														<span class="inline-flex items-center rounded-full border border-red-200 px-2 py-0.5 text-xs font-medium text-red-700 bg-red-50" title={row.errorMessage || ''}>Eroare</span>
													{:else}
														<span class="text-xs text-muted-foreground">-</span>
													{/if}
												</td>
												<td class="px-6 py-3 text-right">
													<div class="flex items-center justify-end gap-0.5">
														{#if hasPdf}
															<Button variant="outline" size="sm" class="h-7 text-xs" onclick={() => handleDownloadPDF(row.id, row.invoiceNumber, row.periodStart)}>
																<Download class="mr-1 h-3 w-3" />Descarcă
															</Button>
															<Button variant="ghost" size="icon" class="h-7 w-7" onclick={() => handlePreviewPDF(row.id)} title="Previzualizare"><Eye class="h-3.5 w-3.5" /></Button>
														{/if}
													</div>
												</td>
											</tr>
										{/each}
									</tbody>
									{#if group.rows.length > 1}
										<tfoot>
											<tr class="border-t-2 border-border bg-muted">
												<td class="px-6 py-3 font-semibold text-sm">Total</td>
												<td></td>
												<td class="px-3 py-3 text-right whitespace-nowrap"><span class="text-base font-bold">{formatAmount(totalAmount, curr)}</span></td>
												<td></td>
												<td class="px-6 py-3 text-right">
													{#if dlCount > 0}
														<span class="inline-flex items-center rounded-full border border-green-200 px-2.5 py-1 text-xs font-medium text-green-700 bg-green-50">{dlCount} facturi</span>
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
