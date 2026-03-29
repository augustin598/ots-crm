<script lang="ts">
	import { getTiktokAdsSpendingList, deleteTiktokAdsSpending, triggerTiktokAdsSync, getTiktokAdsConnectionStatus, bulkDownloadTiktokInvoices } from '$lib/remotes/tiktok-ads.remote';
	import ScraperPanel from '$lib/components/invoice-scraper/scraper-panel.svelte';
	import { page } from '$app/state';
	import { Card } from '$lib/components/ui/card';
	import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '$lib/components/ui/collapsible';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '$lib/components/ui/dropdown-menu';
	import { Download, Search, Eye, Trash2, FileArchive } from '@lucide/svelte';
	import MonitorIcon from '@lucide/svelte/icons/monitor';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import DollarSignIcon from '@lucide/svelte/icons/dollar-sign';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
	import DateRangePicker from '$lib/components/reports/date-range-picker.svelte';
	import { getDefaultDateRange, getDatePresets } from '$lib/utils/report-helpers';
	import { SvelteSet } from 'svelte/reactivity';
	import { toast } from 'svelte-sonner';
	import { clientLogger } from '$lib/client-logger';
	import JSZip from 'jszip';

	// Date range — implicit: luna curenta (la fel ca Meta)
	const _defaults = getDefaultDateRange();
	let since = $state(_defaults.since);
	let until = $state(_defaults.until);
	const _presets = getDatePresets();
	const dateRangeLabel = $derived.by(() => {
		for (const p of _presets) {
			if (p.since === since && p.until === until) return p.label;
		}
		const fmt = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' });
		return `${fmt(since)} — ${fmt(until)}`;
	});

	const tenantSlug = $derived(page.params.tenant as string);

	// Session status check
	const connectionStatusQuery = getTiktokAdsConnectionStatus();
	const tiktokIntegrationId = $derived((connectionStatusQuery.current || [])[0]?.id || '');
	let scraperPanelRef: ScraperPanel | undefined = $state();
	const sessionWarning = $derived.by(() => {
		const connections = connectionStatusQuery.current || [];
		for (const conn of connections) {
			if (conn.ttSessionStatus !== 'active') {
				return 'Sesiunea TikTok nu este activă — facturile PDF nu pot fi descărcate. Setează cookies din Settings.';
			}
		}
		return null;
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

	// ---- Data grouping (mirroring Meta's structure) ----

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

	function toggleSelectInvoice(id: string) {
		if (selectedInvoices.has(id)) selectedInvoices.delete(id);
		else selectedInvoices.add(id);
	}

	// ---- Sync ----

	let syncing = $state(false);
	let lastSyncResult = $state<{ imported: number; updated: number; errors: number; at: Date } | null>(null);

	async function handleSync() {
		syncing = true;
		try {
			const result = await triggerTiktokAdsSync().updates(spendingQuery);
			lastSyncResult = { imported: result.imported, updated: result.updated, errors: result.errors, at: new Date() };
			toast.success(`Sync complet: ${result.imported} noi, ${result.updated} actualizate, ${result.errors} erori`);
		} catch (e) {
			clientLogger.apiError('tiktok_ads_sync', e, 'TIKTOK_API_FETCH_FAILED');
		} finally {
			syncing = false;
		}
	}

	// ---- Delete ----

	async function handleDelete(id: string) {
		if (!confirm('Ești sigur că vrei să ștergi acest raport?')) return;
		try {
			await deleteTiktokAdsSpending(id).updates(spendingQuery);
			toast.success('Raport șters');
		} catch (e) {
			clientLogger.apiError('tiktok_ads_delete', e);
		}
	}

	// ---- PDF download/preview ----

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
			clientLogger.apiError('tiktok_ads_download_pdf', e);
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
			clientLogger.apiError('tiktok_ads_preview_pdf', e);
		}
	}

	// ---- ZIP Download ----

	async function downloadAsZip(invoiceIds: string[], zipName: string) {
		zipping = true;
		try {
			const zip = new JSZip();
			for (const id of invoiceIds) {
				const res = await fetch(`/${tenantSlug}/invoices/tiktok-ads/${id}/pdf`);
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
			clientLogger.apiError('tiktok_ads_zip_download', e, 'EXPORT_GENERATION_FAILED');
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

	// ---- Bulk Import ----

	let showBulkImport = $state(false);
	let bulkJson = $state('');
	let bulkImporting = $state(false);
	let bulkCurrent = $state(0);
	let bulkTotal = $state(0);
	let bulkCurrentLabel = $state('');
	type BulkResult = { label: string; status: string; error: string | null };
	let bulkResults = $state<BulkResult[]>([]);
	let bulkDone = $state(false);
	const bulkProgressPct = $derived(bulkTotal > 0 ? Math.round((bulkCurrent / bulkTotal) * 100) : 0);
	const bulkDownloaded = $derived(bulkResults.filter(r => r.status === 'downloaded').length);
	const bulkSkipped = $derived(bulkResults.filter(r => r.status === 'skipped').length);
	const bulkErrors = $derived(bulkResults.filter(r => r.status === 'error').length);

	async function handleBulkImport() {
		if (!bulkJson.trim()) {
			toast.error('Inserează JSON-ul cu facturi');
			return;
		}
		let links: { invoiceId: string; invoiceSerial?: string; advId?: string; accountName?: string; amount?: string; currency?: string; period?: string }[];
		try {
			const parsed = JSON.parse(bulkJson.trim());
			if (Array.isArray(parsed)) {
				links = parsed;
			} else {
				toast.error('JSON-ul trebuie să fie un array');
				return;
			}
		} catch {
			toast.error('JSON invalid');
			return;
		}

		if (links.length === 0) {
			toast.error('Array-ul de facturi este gol');
			return;
		}
		bulkImporting = true;
		bulkDone = false;
		bulkCurrent = 0;
		bulkTotal = links.length;
		bulkResults = [];
		bulkCurrentLabel = '';

		for (const link of links) {
			const label = link.invoiceSerial || link.invoiceId.substring(0, 16);
			bulkCurrentLabel = label;
			try {
				const result = await bulkDownloadTiktokInvoices({ links: [link] });
				if (result.skipped > 0) {
					bulkResults = [...bulkResults, { label, status: 'skipped', error: null }];
				} else if (result.downloaded > 0) {
					bulkResults = [...bulkResults, { label, status: 'downloaded', error: null }];
				} else {
					const err = result.errorDetails?.[0] || 'unknown';
					bulkResults = [...bulkResults, { label, status: 'error', error: err }];
				}
			} catch (e) {
				bulkResults = [...bulkResults, { label, status: 'error', error: e instanceof Error ? e.message : 'Eroare' }];
			}
			bulkCurrent++;
		}

		bulkImporting = false;
		bulkDone = true;
		bulkCurrentLabel = '';
		if (bulkDownloaded > 0) bulkJson = '';
	}

	const ttBillingScript = `// TikTok Business Center → Billing → Invoices — extrage facturi
// Tastează "allow pasting" în Console înainte de paste!
(function(){
  var invoices = [];
  document.querySelectorAll('tr[class*="Row"], div[class*="invoice-item"]').forEach(function(row) {
    var text = row.innerText;
    var serialMatch = text.match(/([A-Z]{2,6}\\d{10,})/);
    var amountMatch = text.match(/(\\d[\\d,]*\\.\\d{2})/);
    var currencyMatch = text.match(/(RON|USD|EUR|GBP)/);
    var dateMatch = text.match(/(\\d{4}-\\d{2})/);
    var invoiceId = row.getAttribute('data-invoice-id') || '';
    if (!invoiceId) {
      var link = row.querySelector('a[href*="invoice"]');
      if (link) {
        var idMatch = link.href.match(/invoice_id=([^&]+)/);
        if (idMatch) invoiceId = idMatch[1];
      }
    }
    if (serialMatch || invoiceId) {
      invoices.push({
        invoiceId: invoiceId || serialMatch[1],
        invoiceSerial: serialMatch ? serialMatch[1] : undefined,
        amount: amountMatch ? amountMatch[1].replace(/,/g, '') : undefined,
        currency: currencyMatch ? currencyMatch[1] : 'RON',
        period: dateMatch ? dateMatch[1] : undefined
      });
    }
  });
  if (invoices.length === 0) {
    alert('Nu am gasit facturi pe aceasta pagina. Navigheaza la Billing > Invoices.');
    return;
  }
  var json = JSON.stringify(invoices, null, 2);
  copy(json);
  console.log(json);
  alert('Copiat ' + invoices.length + ' facturi TikTok in clipboard!\\nLipeste JSON-ul in CRM → Import Facturi.');
})();`;

	function copyScript() {
		navigator.clipboard.writeText(ttBillingScript);
		toast.success('Script copiat în clipboard! Rulează-l în Console pe pagina TikTok Billing.');
	}
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
		<div class="flex items-center gap-2 flex-wrap">
			<DateRangePicker bind:since bind:until />
			<Button variant="outline" size="sm" onclick={() => showBulkImport = !showBulkImport}>
				<Download class="mr-2 h-4 w-4" />Import Facturi
			</Button>
			<Button variant="outline" size="sm" onclick={handleSync} disabled={syncing}>
				{#if syncing}
					<RefreshCwIcon class="mr-2 h-4 w-4 animate-spin" />Sincronizare...
				{:else}
					<RefreshCwIcon class="mr-2 h-4 w-4" />Sync Acum
				{/if}
			</Button>
			{#if tiktokIntegrationId}
				<Button variant="outline" size="sm" onclick={() => scraperPanelRef?.start()}>
					<MonitorIcon class="mr-2 h-4 w-4" />Scan cu Browser
				</Button>
			{/if}
		</div>
	</div>

	{#if tiktokIntegrationId}
		<ScraperPanel bind:this={scraperPanelRef} platform="tiktok" integrationId={tiktokIntegrationId} showTrigger={false} />
	{/if}

	{#if lastSyncResult}
		<p class="text-xs text-muted-foreground text-right">
			{lastSyncResult.at.toLocaleString('ro-RO')} — {lastSyncResult.imported} noi, {lastSyncResult.updated} actualizate, {lastSyncResult.errors} erori
		</p>
	{/if}

	<!-- Bulk Import Panel -->
	{#if showBulkImport}
		<Card class="p-4 space-y-3">
			<p class="text-sm font-medium">Import facturi din TikTok Billing</p>
			<div class="text-xs text-muted-foreground space-y-1">
				<p>1. Deschide <a href="https://business.tiktok.com" target="_blank" class="underline text-blue-600">TikTok Business Center</a> → Billing → Invoices</p>
				<p>2. Rulează scriptul din Console sau copiază manual datele facturilor, apoi lipește JSON-ul aici:</p>
			</div>
			<textarea bind:value={bulkJson} placeholder={'[{"invoiceId":"123456","invoiceSerial":"BDUK20261596169","amount":"1234.56","currency":"RON","period":"2026-01"}]'} class="w-full rounded-md border px-3 py-2 text-sm bg-background font-mono min-h-[100px]"></textarea>
			<div class="flex items-center gap-2">
				<Button size="sm" onclick={handleBulkImport} disabled={bulkImporting}>
					{#if bulkImporting}
						<Download class="mr-2 h-4 w-4 animate-spin" />Import...
					{:else}
						<Download class="mr-2 h-4 w-4" />Importă Toate
					{/if}
				</Button>
				<Button variant="outline" size="sm" onclick={copyScript}>Copiază Script Console</Button>
			</div>

			<!-- Bulk import progress / results -->
			{#if bulkImporting || bulkDone}
				<div class="space-y-3 pt-3 border-t">
					{#if bulkImporting}
						<div class="space-y-2">
							<div class="flex items-center justify-between text-sm">
								<span class="font-medium">Progres import</span>
								<span class="text-muted-foreground">{bulkCurrent} / {bulkTotal}</span>
							</div>
							<div class="h-2.5 w-full rounded-full bg-muted overflow-hidden">
								<div class="h-2.5 rounded-full bg-primary transition-all duration-300" style="width: {bulkProgressPct}%"></div>
							</div>
							<p class="text-xs text-muted-foreground truncate">Se descarcă: {bulkCurrentLabel}...</p>
						</div>
					{/if}

					{#if bulkDone}
						<div class="grid grid-cols-3 gap-3">
							<div class="rounded-lg border bg-green-50 p-3 text-center">
								<p class="text-2xl font-bold text-green-700">{bulkDownloaded}</p>
								<p class="text-xs text-green-600">Descărcate</p>
							</div>
							<div class="rounded-lg border bg-muted/40 p-3 text-center">
								<p class="text-2xl font-bold text-muted-foreground">{bulkSkipped}</p>
								<p class="text-xs text-muted-foreground">Sărite</p>
							</div>
							<div class="rounded-lg border bg-red-50 p-3 text-center">
								<p class="text-2xl font-bold text-red-700">{bulkErrors}</p>
								<p class="text-xs text-red-600">Erori</p>
							</div>
						</div>
					{/if}

					{#if bulkResults.length > 0}
						<div class="max-h-60 overflow-y-auto rounded-md border">
							<table class="w-full text-sm">
								<thead class="sticky top-0 bg-muted/80 backdrop-blur">
									<tr>
										<th class="px-3 py-2 text-left font-medium text-muted-foreground">Factură</th>
										<th class="px-3 py-2 text-left font-medium text-muted-foreground">Status</th>
									</tr>
								</thead>
								<tbody class="divide-y">
									{#each [...bulkResults].reverse() as r}
										<tr class="hover:bg-muted/30">
											<td class="px-3 py-2 font-mono text-xs truncate max-w-[250px]">{r.label}</td>
											<td class="px-3 py-2">
												{#if r.status === 'downloaded'}
													<span class="text-green-600">Descărcat</span>
												{:else if r.status === 'skipped'}
													<span class="text-muted-foreground">Sărit</span>
												{:else}
													<span class="text-red-600">{r.error || 'Eroare'}</span>
												{/if}
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}

					{#if bulkDone}
						<Button variant="outline" size="sm" onclick={() => { bulkDone = false; bulkResults = []; }}>Închide</Button>
					{/if}
				</div>
			{/if}
		</Card>
	{/if}

	<!-- Session warning -->
	{#if sessionWarning}
		<div class="rounded-md p-4 bg-red-50 border border-red-200">
			<p class="text-sm text-red-800">
				{sessionWarning}
				<a href="/{tenantSlug}/settings/tiktok-ads" class="underline font-medium ml-1">Settings → TikTok Ads</a>
			</p>
		</div>
	{/if}

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
				<p class="text-lg font-medium">Nu sunt date de cheltuieli</p>
				<p class="text-sm text-muted-foreground">Apasă "Sync Acum" pentru a importa datele din TikTok Ads.</p>
			</div>
		</Card>
	{:else}
		<!-- Search -->
		<div class="flex items-center gap-3">
			<div class="relative flex-1">
				<Search class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
				<Input bind:value={spendSearchQuery} type="text" placeholder="Caută cont sau client..." class="pl-9" />
			</div>
		</div>

		{#if filteredGroupedByClient.length === 0}
			<p class="text-sm text-muted-foreground text-center py-4">Niciun cont găsit pentru „{spendSearchQuery}"</p>
		{:else}
			<div class="space-y-4">
				{#each filteredGroupedByClient as group (group.clientName)}
					{@const totalSpend = group.rows.reduce((s: number, r: any) => s + (r.spendCents || 0), 0)}
					{@const totalClicks = group.rows.reduce((s: number, r: any) => s + (r.clicks || 0), 0)}
					{@const totalImpressions = group.rows.reduce((s: number, r: any) => s + (r.impressions || 0), 0)}
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
												<p class="text-xs text-muted-foreground">Total cheltuieli</p>
												<p class="text-lg font-bold">{formatAmount(totalSpend, curr)}</p>
											</div>
											<div class="text-right hidden sm:block">
												<p class="text-xs text-muted-foreground">Click-uri</p>
												<p class="text-base font-semibold">{formatNumber(totalClicks)}</p>
											</div>
											<div class="text-right hidden sm:block">
												<p class="text-xs text-muted-foreground">Impresii</p>
												<p class="text-base font-semibold">{formatNumber(totalImpressions)}</p>
											</div>
											<ChevronDownIcon class="h-5 w-5 text-muted-foreground shrink-0 transition-transform duration-200 {isExpanded ? 'rotate-180' : ''}" />
										</div>
									</div>
								</div>
							</CollapsibleTrigger>

							<CollapsibleContent>
								<!-- Column headers -->
								<div class="grid grid-cols-[2fr_minmax(100px,1fr)_60px_minmax(80px,1fr)_minmax(80px,1fr)_minmax(90px,auto)] gap-x-2 px-6 py-2 border-t bg-muted/30 text-xs font-medium text-muted-foreground">
									<span>Perioadă</span>
									<span class="text-right">Cheltuieli</span>
									<span class="text-right"></span>
									<span class="text-right hidden sm:block">Impresii</span>
									<span class="text-right hidden sm:block">Click-uri</span>
									<span class="text-right">Facturi</span>
								</div>
								<div class="divide-y">
									{#each group.rows as row, i (row.id)}
										{@const prevSpend = group.rows[i + 1]?.spendCents}
										{@const trend = prevSpend ? (((row.spendCents || 0) - prevSpend) / prevSpend) * 100 : null}
										{@const hasPdf = !!row.pdfPath}
										{@const periodKey = `${group.clientName}:${row.tiktokAdvertiserId}:${row.periodStart}`}
										{@const isPeriodExpanded = expandedPeriods.has(periodKey)}
										<!-- Period row -->
										<div class="grid grid-cols-[2fr_minmax(100px,1fr)_60px_minmax(80px,1fr)_minmax(80px,1fr)_minmax(90px,auto)] gap-x-2 px-6 py-3 hover:bg-muted/30 transition-colors items-center cursor-pointer" onclick={() => hasPdf && togglePeriod(periodKey)} onkeydown={(e) => e.key === 'Enter' && hasPdf && togglePeriod(periodKey)} role="button" tabindex="0">
											<div class="flex items-center gap-2 min-w-0">
												<CalendarIcon class="h-4 w-4 text-muted-foreground shrink-0" />
												<span class="font-medium capitalize whitespace-nowrap">{formatPeriod(row.periodStart)}</span>
												{#if group.hasMultipleAccounts && row.tiktokAdvertiserId}
													<span class="inline-flex items-center rounded-md border bg-muted/50 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{row.tiktokAdvertiserId}</span>
												{/if}
											</div>
											<span class="text-base font-semibold text-right whitespace-nowrap">{formatAmount(row.spendCents, row.currencyCode)}</span>
											<span class="text-right whitespace-nowrap">
												{#if trend !== null}
													<span class="text-xs {trend >= 0 ? 'text-red-500' : 'text-green-500'}">{trend >= 0 ? '+' : ''}{trend.toFixed(1)}%</span>
												{/if}
											</span>
											<span class="text-sm text-muted-foreground text-right whitespace-nowrap hidden sm:block">{formatNumber(row.impressions)}</span>
											<span class="text-sm text-right whitespace-nowrap hidden sm:block">{formatNumber(row.clicks)}</span>
											<div class="text-right">
												{#if hasPdf}
													<button class="inline-flex items-center gap-1 rounded-full border border-green-200 px-2.5 py-1 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 transition-colors cursor-pointer whitespace-nowrap" onclick={(e) => { e.stopPropagation(); togglePeriod(periodKey); }}>
														<ChevronRightIcon class="h-3 w-3 transition-transform duration-200 {isPeriodExpanded ? 'rotate-90' : ''}" />
														1 factură
													</button>
												{:else}
													<span class="text-xs text-orange-500">În așteptare</span>
												{/if}
											</div>
										</div>
										<!-- Expandable invoice row -->
										{#if isPeriodExpanded && hasPdf}
											<div class="flex items-center gap-3 px-6 py-2 pl-10 bg-muted/10 hover:bg-muted/20 transition-colors">
												<Checkbox checked={selectedInvoices.has(row.id)} onCheckedChange={() => toggleSelectInvoice(row.id)} />
												<div class="flex items-center gap-2 min-w-0 flex-1">
													<span class="text-sm font-medium text-blue-600">Factura PDF</span>
													<span class="text-xs text-muted-foreground">{formatAmount(row.spendCents, row.currencyCode)}</span>
												</div>
												<div class="flex items-center gap-0.5 shrink-0">
													<Button variant="outline" size="sm" class="h-7 text-xs" onclick={() => handleDownloadPDF(row.id, row.periodStart)}>
														<Download class="mr-1 h-3 w-3" />PDF
													</Button>
													<Button variant="ghost" size="icon" class="h-7 w-7" onclick={() => handlePreviewPDF(row.id)} title="Previzualizare"><Eye class="h-3.5 w-3.5" /></Button>
													<DropdownMenu>
														<DropdownMenuTrigger>
															<Button variant="ghost" size="icon" class="h-7 w-7"><EllipsisIcon class="h-3.5 w-3.5" /></Button>
														</DropdownMenuTrigger>
														<DropdownMenuContent align="end">
															<DropdownMenuItem class="text-red-600" onclick={() => handleDelete(row.id)}>
																<Trash2 class="mr-2 h-3.5 w-3.5" />Șterge factura
															</DropdownMenuItem>
														</DropdownMenuContent>
													</DropdownMenu>
												</div>
											</div>
										{/if}
									{/each}
								</div>
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
