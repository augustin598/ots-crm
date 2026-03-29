<script lang="ts">
	import { getGoogleAdsInvoices, getGoogleAdsSpendingList, deleteGoogleAdsInvoice, triggerGoogleAdsSync, downloadGoogleInvoiceFromUrl, bulkDownloadGoogleInvoices, importScrapedGoogleInvoices, getGoogleAdsConnectionStatus } from '$lib/remotes/google-ads-invoices.remote';
	import ScraperPanel from '$lib/components/invoice-scraper/scraper-panel.svelte';
	import { page } from '$app/state';
	import { Card } from '$lib/components/ui/card';
	import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '$lib/components/ui/collapsible';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { Separator } from '$lib/components/ui/separator';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '$lib/components/ui/dropdown-menu';
	import { Download, Search, Eye, Trash2, ExternalLink, FileArchive } from '@lucide/svelte';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import DollarSignIcon from '@lucide/svelte/icons/dollar-sign';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
	import IconGoogleAds from '$lib/components/marketing/icon-google-ads.svelte';
	import MonitorIcon from '@lucide/svelte/icons/monitor';
	import DateRangePicker from '$lib/components/reports/date-range-picker.svelte';
	import { getDefaultDateRange, getDatePresets } from '$lib/utils/report-helpers';
	import { SvelteSet } from 'svelte/reactivity';
	import { toast } from 'svelte-sonner';
	import { clientLogger } from '$lib/client-logger';
	import JSZip from 'jszip';

	// Date range — implicit: luna curenta (la fel ca Meta/TikTok)
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
	const connectionStatusQuery = getGoogleAdsConnectionStatus();
	const googleIntegrationId = $derived(connectionStatusQuery.current?.integrationId || '');
	let scraperPanelRef: ScraperPanel | undefined = $state();
	const sessionWarning = $derived.by(() => {
		const status = connectionStatusQuery.current;
		if (!status || !status.connected) return null;
		if (status.googleSessionStatus !== 'active') {
			return 'Sesiunea Google Ads nu este activă — facturile PDF nu pot fi descărcate. Setează cookies din Settings.';
		}
		return null;
	});

	const invoicesQuery = getGoogleAdsInvoices();
	const invoices = $derived(invoicesQuery.current || []);
	const loading = $derived(invoicesQuery.loading);

	// Spending data from DB (synced via Google Ads API, same pattern as Meta/TikTok)
	const spendingQuery = getGoogleAdsSpendingList();
	const spendingRows = $derived(spendingQuery.current || []);
	const monthlyLoading = $derived(spendingQuery.loading);

	// Transform flat DB rows into grouped format: { googleAdsCustomerId, accountName, clientName, clientEmail, months[] }
	const monthlySpend = $derived.by(() => {
		const byAccount = new Map<string, { googleAdsCustomerId: string; accountName: string; clientName: string | null; clientEmail: string | null; months: Array<{ month: string; spend: number; currencyCode: string; impressions: number; clicks: number; conversions: number }> }>();

		for (const row of spendingRows) {
			const key = row.googleAdsCustomerId;
			const acc = byAccount.get(key) || {
				googleAdsCustomerId: row.googleAdsCustomerId,
				accountName: row.accountName || row.googleAdsCustomerId,
				clientName: row.clientName,
				clientEmail: row.clientEmail,
				months: []
			};
			acc.months.push({
				month: row.periodStart.substring(0, 7), // "2026-02-01" → "2026-02"
				spend: (row.spendCents || 0) / 100,
				currencyCode: row.currencyCode,
				impressions: row.impressions || 0,
				clicks: row.clicks || 0,
				conversions: row.conversions || 0
			});
			byAccount.set(key, acc);
		}

		return Array.from(byAccount.values());
	});

	// ---- Helpers ----

	function formatMonth(month: string): string {
		try {
			const parts = month.split('-');
			const d = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
			return isNaN(d.getTime()) ? month : d.toLocaleDateString('ro-RO', { month: 'long', year: 'numeric' });
		} catch { return month; }
	}

	function getInvoiceMonth(issueDate: any): string | null {
		if (!issueDate) return null;
		if (issueDate instanceof Date && !isNaN(issueDate.getTime())) {
			return `${issueDate.getUTCFullYear()}-${String(issueDate.getUTCMonth() + 1).padStart(2, '0')}`;
		}
		const s = String(issueDate);
		if (s.match(/^\d{4}-\d{2}/)) return s.substring(0, 7);
		if (s.match(/^\d{10,13}$/)) {
			const d = new Date(Number(s) * (s.length <= 10 ? 1000 : 1));
			return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
		}
		const d = new Date(s);
		if (!isNaN(d.getTime())) return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
		return null;
	}

	function formatCurr(value: number, currency: string): string {
		return new Intl.NumberFormat('ro-RO', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
	}

	function formatNumber(n: number | null): string {
		if (n == null) return '-';
		return n.toLocaleString('ro-RO');
	}

	function formatAmount(micros: number | null, currency: string): string {
		if (micros == null) return '-';
		const amount = micros / 1_000_000;
		return new Intl.NumberFormat('ro-RO', { style: 'currency', currency }).format(amount);
	}

	// ---- Data grouping (mirroring Meta's structure) ----

	// Filter months by date range
	const dateFilteredMonthlySpend = $derived(
		monthlySpend.map((account: any) => ({
			...account,
			months: account.months.filter((m: any) => {
				const month = m.month.substring(0, 7);
				const sinceMonth = since.substring(0, 7);
				const untilMonth = until.substring(0, 7);
				return month >= sinceMonth && month <= untilMonth;
			})
		})).filter((account: any) => account.months.length > 0)
	);

	// Map invoices by customerId:month for quick lookup
	const invoicesByKey = $derived.by(() => {
		const map = new Map<string, typeof invoices>();
		for (const inv of invoices) {
			const month = getInvoiceMonth(inv.issueDate);
			if (!month) continue;
			const custId = (inv.googleAdsCustomerId || '').replace(/-/g, '');
			const key = `${custId}:${month}`;
			const arr = map.get(key) || [];
			arr.push(inv);
			map.set(key, arr);
		}
		return map;
	});

	// Group by client (like Meta does), flatten months from all accounts
	type SpendRow = {
		id: string;
		month: string;
		accountName: string;
		googleAdsCustomerId: string;
		clientEmail?: string;
		spend: number;
		currencyCode: string;
		impressions: number;
		clicks: number;
		conversions: number;
	};

	const groupedByClient = $derived.by(() => {
		const sinceMonth = since.substring(0, 7);
		const untilMonth = until.substring(0, 7);
		const groups = new Map<string, { clientName: string; hasMultipleAccounts: boolean; rows: SpendRow[] }>();

		// Add spending rows
		for (const account of dateFilteredMonthlySpend) {
			const key = account.clientName || account.accountName || 'Neatribuit';
			const group = groups.get(key) || { clientName: key, hasMultipleAccounts: false, rows: [] as SpendRow[] };
			for (const m of account.months) {
				group.rows.push({
					id: `${account.googleAdsCustomerId}:${m.month}`,
					month: m.month,
					accountName: account.accountName,
					googleAdsCustomerId: account.googleAdsCustomerId,
					clientEmail: account.clientEmail,
					spend: m.spend,
					currencyCode: m.currencyCode,
					impressions: m.impressions,
					clicks: m.clicks,
					conversions: m.conversions,
				});
			}
			groups.set(key, group);
		}

		// Add invoice-only entries (invoices without matching spending row)
		for (const inv of invoices) {
			const invMonth = getInvoiceMonth(inv.issueDate);
			if (!invMonth) continue;
			if (invMonth < sinceMonth || invMonth > untilMonth) continue;
			const key = inv.clientName || 'Neatribuit';
			const group = groups.get(key) || { clientName: key, hasMultipleAccounts: false, rows: [] as SpendRow[] };
			const custId = (inv.googleAdsCustomerId || '').replace(/-/g, '');
			const hasRow = group.rows.some(r => r.month.substring(0, 7) === invMonth && r.googleAdsCustomerId.replace(/-/g, '') === custId);
			console.log(`[DEBUG-FRONTEND] Invoice ${inv.invoiceNumber || inv.googleInvoiceId}: client="${key}", month=${invMonth}, custId=${custId}, hasRow=${hasRow}, totalAmountMicros=${inv.totalAmountMicros}, spend=${(inv.totalAmountMicros || 0) / 1_000_000}`);
			if (!hasRow) {
				group.rows.push({
					id: `inv-${custId}:${invMonth}`,
					month: invMonth,
					accountName: inv.clientName || custId,
					googleAdsCustomerId: inv.googleAdsCustomerId || '',
					spend: (inv.totalAmountMicros || 0) / 1_000_000,
					currencyCode: inv.currencyCode || 'RON',
					impressions: 0,
					clicks: 0,
					conversions: 0,
				});
			}
			groups.set(key, group);
		}

		// Detect multi-account + sort rows
		for (const group of groups.values()) {
			const uniqueAccounts = new Set(group.rows.map(r => r.googleAdsCustomerId));
			group.hasMultipleAccounts = uniqueAccounts.size > 1;
			group.rows.sort((a, b) => {
				const periodCmp = b.month.localeCompare(a.month);
				if (periodCmp !== 0) return periodCmp;
				return (a.accountName || '').localeCompare(b.accountName || '');
			});
		}

		return Array.from(groups.values()).sort((a, b) => a.clientName.localeCompare(b.clientName));
	});

	// Count invoices per client for badge
	const invoiceCountByClient = $derived.by(() => {
		const sinceMonth = since.substring(0, 7);
		const untilMonth = until.substring(0, 7);
		const map = new Map<string, number>();
		for (const inv of invoices) {
			if (!inv.pdfPath) continue;
			const month = getInvoiceMonth(inv.issueDate);
			if (month && (month < sinceMonth || month > untilMonth)) continue;
			const key = inv.clientName || 'Neatribuit';
			map.set(key, (map.get(key) || 0) + 1);
		}
		return map;
	});

	// Get invoices for a specific row (month + customerId)
	function getRowInvoices(row: SpendRow) {
		const targetMonth = row.month.substring(0, 7);
		const custId = row.googleAdsCustomerId.replace(/-/g, '');
		return invoicesByKey.get(`${custId}:${targetMonth}`) || [];
	}

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
				g.rows.some(r => r.accountName.toLowerCase().includes(spendSearchQuery.trim().toLowerCase()) ||
					r.googleAdsCustomerId.includes(spendSearchQuery.trim().replace(/-/g, '')))
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
	let lastSyncResult = $state<{ imported: number; skipped: number; errors: number; spendingInserted?: number; spendingUpdated?: number; at: Date } | null>(null);

	async function handleSync() {
		syncing = true;
		try {
			const result = await triggerGoogleAdsSync().updates(invoicesQuery);
			lastSyncResult = { ...result, at: new Date() };
			toast.success(`Sync complet: ${result.imported} importate, ${result.skipped} existente, ${result.errors} erori`);
		} catch (e) {
			clientLogger.apiError('google_ads_sync', e, 'GOOGLE_API_FETCH_FAILED');
		} finally {
			syncing = false;
		}
	}

	// ---- Scraper import ----

	async function handleScraperImport(invoices: any[]) {
		console.log('[DEBUG-SCRAPER] Invoices received from scraper:', JSON.stringify(invoices.slice(0, 3).map(inv => ({ id: inv.invoiceId, amountText: inv.amountText, amount: inv.amount, accountId: inv.accountId })), null, 2));
		const result = await importScrapedGoogleInvoices({ invoices }).updates(invoicesQuery);
		if (result.errors > 0) {
			toast.warning(`Importate: ${result.downloaded}, existente: ${result.skipped}, erori: ${result.errors}`);
		} else {
			toast.success(`Importate: ${result.downloaded}, existente (skip): ${result.skipped}`);
		}
	}

	// ---- Bulk Import ----

	let showBulkImport = $state(false);
	let bulkJson = $state('');
	let bulkCustomerId = $state('');
	let bulkDownloading = $state(false);

	const consoleScript = `// Rulează pe pagina Google Payments (billing documents)
// Copiază rezultatul și lipește-l în CRM
(function(){
  const links = [];
  document.querySelectorAll('[data-url]').forEach(el => {
    const url = el.getAttribute('data-url');
    if (url && url.includes('/payments/apis-secure/doc')) {
      const row = el.closest('.b3id-row, .b3-row, tr, [role="row"]');
      const rowEl = row || el.parentElement?.parentElement?.parentElement;
      const text = rowEl ? rowEl.innerText : '';
      const idMatch = text.match(/(\\d{8,12})/);
      const dateMatch = text.match(/(\\d{1,2})\\s+(ian|feb|mar|apr|mai|iun|iul|aug|sep|oct|nov|dec)\\.?\\s+(\\d{4})/i);
      links.push({
        url: url,
        invoiceId: idMatch ? idMatch[1] : undefined,
        date: dateMatch ? dateMatch[3]+'-'+dateMatch[2]+'-'+dateMatch[1] : undefined
      });
    }
  });
  const json = JSON.stringify(links, null, 2);
  copy(json);
  console.log('Copiat ' + links.length + ' link-uri în clipboard!');
  alert('Copiat ' + links.length + ' link-uri de facturi în clipboard!\\nLipește în CRM.');
})();`;

	async function handleBulkImport() {
		if (!bulkJson.trim() || !bulkCustomerId) {
			toast.error('Lipește JSON-ul cu link-urile și selectează contul');
			return;
		}
		let links;
		try {
			links = JSON.parse(bulkJson);
			if (!Array.isArray(links) || links.length === 0) throw new Error('Array gol');
		} catch {
			toast.error('JSON invalid. Rulează scriptul din consolă și lipește rezultatul.');
			return;
		}
		bulkDownloading = true;
		try {
			const result = await bulkDownloadGoogleInvoices({ customerId: bulkCustomerId, links }).updates(invoicesQuery);
			toast.success(`Download complet: ${result.downloaded} descărcate, ${result.skipped} existente, ${result.errors} erori`);
			bulkJson = '';
			showBulkImport = false;
		} catch (e) {
			clientLogger.apiError('google_ads_bulk_download', e, 'GOOGLE_API_FETCH_FAILED');
		} finally {
			bulkDownloading = false;
		}
	}

	// ---- URL Download ----

	let showUrlDownload = $state(false);
	let urlPdfLink = $state('');
	let urlCustomerId = $state('');
	let urlInvoiceId = $state('');
	let urlDownloading = $state(false);

	async function handleUrlDownload() {
		if (!urlPdfLink || !urlCustomerId) {
			toast.error('Completează URL-ul PDF și Customer ID');
			return;
		}
		urlDownloading = true;
		try {
			const result = await downloadGoogleInvoiceFromUrl({
				pdfUrl: urlPdfLink,
				customerId: urlCustomerId,
				invoiceId: urlInvoiceId || undefined
			}).updates(invoicesQuery);
			toast.success(`Factură descărcată: ${result.invoiceId}`);
			urlPdfLink = '';
			urlInvoiceId = '';
			showUrlDownload = false;
		} catch (e) {
			clientLogger.apiError('google_ads_url_download', e, 'GOOGLE_API_FETCH_FAILED');
		} finally {
			urlDownloading = false;
		}
	}

	// ---- PDF download/preview ----

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
			clientLogger.apiError('google_ads_download_pdf', e);
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
			clientLogger.apiError('google_ads_preview_pdf', e);
		}
	}

	async function handleDelete(invoiceId: string) {
		if (!confirm('Ești sigur că vrei să ștergi această factură?')) return;
		try {
			await deleteGoogleAdsInvoice(invoiceId).updates(invoicesQuery);
			toast.success('Factură ștearsă');
		} catch (e) {
			clientLogger.apiError('google_ads_delete', e);
		}
	}

	// ---- ZIP Download ----

	async function downloadAsZip(invoiceIds: string[], zipName: string) {
		zipping = true;
		try {
			const zip = new JSZip();
			for (const id of invoiceIds) {
				const res = await fetch(`/${tenantSlug}/invoices/google-ads/${id}/pdf`);
				if (!res.ok) continue;
				const blob = await res.blob();
				const inv = invoices.find(i => i.id === id);
				const fileName = inv?.invoiceNumber
					? `${inv.invoiceNumber}.pdf`
					: `GoogleAds-${id.substring(0, 8)}.pdf`;
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
			clientLogger.apiError('google_ads_zip_download', e, 'EXPORT_GENERATION_FAILED');
		} finally {
			zipping = false;
		}
	}

	async function downloadSelected() {
		const ids = [...selectedInvoices];
		if (ids.length === 0) return;
		await downloadAsZip(ids, `GoogleAds-Facturi-selectate-${ids.length}`);
		selectedInvoices.clear();
	}

	async function downloadPeriodZip(periodInvoices: typeof invoices, periodLabel: string) {
		const ids = periodInvoices.filter(i => i.pdfPath).map(i => i.id);
		await downloadAsZip(ids, `GoogleAds-${periodLabel}`);
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
		<div class="flex items-center gap-2 flex-wrap">
			<DateRangePicker bind:since bind:until />
			<Button variant="outline" size="sm" onclick={() => showBulkImport = !showBulkImport}>
				<Download class="mr-2 h-4 w-4" />Import Facturi
			</Button>
			<Button variant="outline" size="sm" onclick={() => showUrlDownload = !showUrlDownload}>
				<ExternalLink class="mr-2 h-4 w-4" />Link Singular
			</Button>
			<Button variant="outline" size="sm" onclick={handleSync} disabled={syncing}>
				{#if syncing}
					<RefreshCwIcon class="mr-2 h-4 w-4 animate-spin" />Sincronizare...
				{:else}
					<RefreshCwIcon class="mr-2 h-4 w-4" />Sync Acum
				{/if}
			</Button>
			{#if googleIntegrationId}
				<Button variant="outline" size="sm" onclick={() => scraperPanelRef?.start()}>
					<MonitorIcon class="mr-2 h-4 w-4" />Scan cu Browser
				</Button>
			{/if}
		</div>
	</div>

	{#if googleIntegrationId}
		<ScraperPanel bind:this={scraperPanelRef} platform="google" integrationId={googleIntegrationId} onImport={handleScraperImport} showTrigger={false} />
	{/if}

	{#if lastSyncResult}
		<p class="text-xs text-muted-foreground text-right">
			{lastSyncResult.at.toLocaleString('ro-RO')} — {lastSyncResult.imported} importate, {lastSyncResult.errors} erori
			{#if lastSyncResult.spendingInserted != null}
				| spend: {lastSyncResult.spendingInserted} noi, {lastSyncResult.spendingUpdated ?? 0} actualizate
			{/if}
		</p>
	{/if}

	<!-- Bulk Import Panel -->
	{#if showBulkImport}
		<Card class="p-4 space-y-3">
			<p class="text-sm font-medium">Import facturi Google Ads</p>
			<p class="text-xs text-muted-foreground">1. Folosește scriptul Tampermonkey pe pagina Google Ads → Billing → Documents pentru a copia link-urile. Lipește JSON-ul aici:</p>
			<textarea bind:value={bulkJson} placeholder="Lipeste JSON-ul aici..." class="w-full rounded-md border px-3 py-2 text-sm bg-background font-mono min-h-[100px]"></textarea>
			<div class="flex items-center gap-2">
				<select bind:value={bulkCustomerId} class="rounded-md border px-3 py-2 text-sm bg-background">
					<option value="">Selectează contul</option>
					{#each monthlySpend as account}
						<option value={account.googleAdsCustomerId}>{account.accountName}</option>
					{/each}
				</select>
				<Button size="sm" onclick={handleBulkImport} disabled={bulkDownloading}>
					{#if bulkDownloading}
						<Download class="mr-2 h-4 w-4 animate-spin" />Import...
					{:else}
						<Download class="mr-2 h-4 w-4" />Importă Toate
					{/if}
				</Button>
			</div>
		</Card>
	{/if}

	<!-- Download from URL Panel -->
	{#if showUrlDownload}
		<Card class="p-4 space-y-3">
			<p class="text-sm font-medium">Download factură din link Google Payments</p>
			<p class="text-xs text-muted-foreground">
				Deschide Google Ads → Billing → Documents, click dreapta pe "Download" și copiază link-ul.
			</p>
			<div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
				<div class="sm:col-span-2">
					<Input bind:value={urlPdfLink} placeholder="URL-ul PDF (payments.google.com/...)" />
				</div>
				<div>
					<select bind:value={urlCustomerId} class="w-full rounded-md border px-3 py-2 text-sm bg-background">
						<option value="">Selectează contul</option>
						{#each monthlySpend as account}
							<option value={account.googleAdsCustomerId}>{account.accountName}</option>
						{/each}
					</select>
				</div>
			</div>
			<div class="flex items-center gap-2">
				<Input bind:value={urlInvoiceId} placeholder="Nr. factură (opțional)" class="max-w-[200px]" />
				<Button size="sm" onclick={handleUrlDownload} disabled={urlDownloading}>
					{#if urlDownloading}
						<Download class="mr-2 h-4 w-4 animate-spin" />Descărcare...
					{:else}
						<Download class="mr-2 h-4 w-4" />Descarcă
					{/if}
				</Button>
			</div>
		</Card>
	{/if}

	<!-- Session warning -->
	{#if sessionWarning}
		<div class="rounded-md p-4 bg-red-50 border border-red-200">
			<p class="text-sm text-red-800">
				{sessionWarning}
				<a href="/{tenantSlug}/settings/google-ads" class="underline font-medium ml-1">Settings → Google Ads</a>
			</p>
		</div>
	{/if}

	<!-- Spending cards per client (Meta-style) -->
	{#if monthlyLoading || loading}
		<div class="space-y-4">
			{#each Array(2) as _, idx (idx)}<Card class="p-6"><Skeleton class="h-48 w-full" /></Card>{/each}
		</div>
	{:else if monthlySpend.length === 0 && invoices.length === 0}
		<Card class="p-12 text-center">
			<div class="flex flex-col items-center gap-3">
				<div class="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
					<DollarSignIcon class="h-7 w-7 text-muted-foreground" />
				</div>
				<p class="text-lg font-medium">Nu sunt date de cheltuieli</p>
				<p class="text-sm text-muted-foreground">Apasă "Sync Acum" pentru a importa datele din Google Ads.</p>
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
					{@const totalSpend = group.rows.reduce((s, r) => s + r.spend, 0)}
					{@const totalClicks = group.rows.reduce((s, r) => s + r.clicks, 0)}
					{@const totalImpressions = group.rows.reduce((s, r) => s + r.impressions, 0)}
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
												<p class="text-lg font-bold">{formatCurr(totalSpend, curr)}</p>
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
										{@const prevSpend = group.rows[i + 1]?.spend}
										{@const trend = prevSpend ? ((row.spend - prevSpend) / prevSpend) * 100 : null}
										{@const rowInvoices = getRowInvoices(row)}
										{@const downloadedInvoices = rowInvoices.filter(inv => inv.pdfPath)}
										{@const periodKey = `${group.clientName}:${row.googleAdsCustomerId}:${row.month}`}
										{@const isPeriodExpanded = expandedPeriods.has(periodKey)}
										{@const isInvoiceOnly = row.id.startsWith('inv-')}
										<!-- Period row -->
										<div class="grid grid-cols-[2fr_minmax(100px,1fr)_60px_minmax(80px,1fr)_minmax(80px,1fr)_minmax(90px,auto)] gap-x-2 px-6 py-3 hover:bg-muted/30 transition-colors items-center cursor-pointer" onclick={() => downloadedInvoices.length > 0 && togglePeriod(periodKey)} onkeydown={(e) => e.key === 'Enter' && downloadedInvoices.length > 0 && togglePeriod(periodKey)} role="button" tabindex="0">
											<div class="flex items-center gap-2 min-w-0">
												<CalendarIcon class="h-4 w-4 text-muted-foreground shrink-0" />
												<span class="font-medium capitalize whitespace-nowrap">{formatMonth(row.month)}</span>
												{#if group.hasMultipleAccounts && row.accountName}
													<span class="inline-flex items-center rounded-md border bg-muted/50 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{row.accountName}</span>
												{/if}
											</div>
											<span class="text-base font-semibold text-right whitespace-nowrap">{row.spend === 0 && isInvoiceOnly ? '—' : formatCurr(row.spend, row.currencyCode)}</span>
											<span class="text-right whitespace-nowrap">
												{#if trend !== null && !isInvoiceOnly}
													<span class="text-xs {trend >= 0 ? 'text-red-500' : 'text-green-500'}">{trend >= 0 ? '+' : ''}{trend.toFixed(1)}%</span>
												{/if}
											</span>
											<span class="text-sm text-muted-foreground text-right whitespace-nowrap hidden sm:block">{isInvoiceOnly ? '—' : formatNumber(row.impressions)}</span>
											<span class="text-sm text-right whitespace-nowrap hidden sm:block">{isInvoiceOnly ? '—' : formatNumber(row.clicks)}</span>
											<div class="text-right">
												{#if downloadedInvoices.length > 0}
													<div class="flex items-center gap-1">
														<button class="inline-flex items-center gap-1 rounded-full border border-green-200 px-2.5 py-1 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 transition-colors cursor-pointer whitespace-nowrap" onclick={(e) => { e.stopPropagation(); togglePeriod(periodKey); }}>
															<ChevronRightIcon class="h-3 w-3 transition-transform duration-200 {isPeriodExpanded ? 'rotate-90' : ''}" />
															{downloadedInvoices.length} {downloadedInvoices.length === 1 ? 'factură' : 'facturi'}
														</button>
														<Button variant="ghost" size="icon" class="h-7 w-7" onclick={(e) => { e.stopPropagation(); downloadPeriodZip(downloadedInvoices, `${row.month}-${row.accountName || row.googleAdsCustomerId}`); }} title="Descarcă toate ca ZIP" disabled={zipping}>
															<FileArchive class="h-3.5 w-3.5" />
														</Button>
													</div>
												{:else}
													<span class="text-xs text-orange-500">În așteptare</span>
												{/if}
											</div>
										</div>
										<!-- Expandable invoice list -->
										{#if isPeriodExpanded && downloadedInvoices.length > 0}
											{#each downloadedInvoices as inv}
												<div class="flex items-center gap-3 px-6 py-2 pl-10 bg-muted/10 hover:bg-muted/20 transition-colors">
													<Checkbox checked={selectedInvoices.has(inv.id)} onCheckedChange={() => toggleSelectInvoice(inv.id)} />
													<div class="flex items-center gap-2 min-w-0 flex-1">
														<span class="text-sm font-medium text-blue-600">{inv.invoiceNumber || `Factura ${inv.id.substring(0, 8)}…`}</span>
														{#if inv.totalAmountMicros}
															<span class="text-xs text-muted-foreground">{formatAmount(inv.totalAmountMicros, inv.currencyCode)}</span>
														{/if}
													</div>
													<div class="flex items-center gap-0.5 shrink-0">
														<Button variant="outline" size="sm" class="h-7 text-xs" onclick={() => handleDownloadPDF(inv.id, inv.invoiceNumber)}>
															<Download class="mr-1 h-3 w-3" />PDF
														</Button>
														<Button variant="ghost" size="icon" class="h-7 w-7" onclick={() => handlePreviewPDF(inv.id)} title="Previzualizare"><Eye class="h-3.5 w-3.5" /></Button>
														<DropdownMenu>
															<DropdownMenuTrigger>
																<Button variant="ghost" size="icon" class="h-7 w-7"><EllipsisIcon class="h-3.5 w-3.5" /></Button>
															</DropdownMenuTrigger>
															<DropdownMenuContent align="end">
																<DropdownMenuItem class="text-red-600" onclick={() => handleDelete(inv.id)}>
																	<Trash2 class="mr-2 h-3.5 w-3.5" />Șterge factura
																</DropdownMenuItem>
															</DropdownMenuContent>
														</DropdownMenu>
													</div>
												</div>
											{/each}
										{/if}
									{/each}
								</div>
								<!-- Footer: account emails + Google Billing link -->
								{@const uniqueEmails = [...new Set(group.rows.map(r => r.clientEmail).filter(Boolean))]}
								{#if uniqueEmails.length > 0}
									<div class="border-t px-6 py-3 bg-muted/20 flex items-center justify-between">
										<p class="text-sm text-muted-foreground">Facturi pe contul <strong>{uniqueEmails.join(', ')}</strong></p>
										<a href="https://ads.google.com/aw/billing/documents" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-2 rounded-lg border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors shrink-0">
											<ExternalLink class="h-3.5 w-3.5" />
											Google Billing
										</a>
									</div>
								{/if}
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
