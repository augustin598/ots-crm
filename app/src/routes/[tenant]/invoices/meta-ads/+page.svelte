<script lang="ts">
	import { getMetaAdsSpendingList, triggerMetaAdsSync, getMetaInvoiceDownloads, triggerInvoiceDownload, redownloadInvoice, deleteInvoiceDownload, getMetaTokenStatus, getMetaAdsConnectionStatus, bulkDownloadMetaInvoices, getAccountsForInvoiceDownload, downloadInvoiceForAccount } from '$lib/remotes/meta-ads-invoices.remote';
	import { page } from '$app/state';
	import { Card } from '$lib/components/ui/card';
	import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '$lib/components/ui/collapsible';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { Download, Search, Eye, Trash2, XCircle } from '@lucide/svelte';
	import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '$lib/components/ui/dialog';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import DollarSignIcon from '@lucide/svelte/icons/dollar-sign';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import DateRangePicker from '$lib/components/reports/date-range-picker.svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { toast } from 'svelte-sonner';
	import { getDefaultDateRange } from '$lib/utils/report-helpers';

	// Date range — implicit: luna curenta (ca in reports)
	const _defaults = getDefaultDateRange();
	let since = $state(_defaults.since);
	let until = $state(_defaults.until);

	const tenantSlug = $derived(page.params.tenant as string);

	// Session (cookie) status check
	const connectionStatusQuery = getMetaAdsConnectionStatus();
	const sessionWarning = $derived.by(() => {
		const connections = connectionStatusQuery.current || [];
		for (const conn of connections) {
			if (conn.fbSessionStatus !== 'active') {
				return `Sesiunea Facebook (${conn.businessName || 'BM'}) nu este activă — facturile PDF nu pot fi descărcate. Setează cookies din Settings.`;
			}
		}
		return null;
	});

	// Token expiration check
	const tokenStatusQuery = getMetaTokenStatus();
	const tokenWarning = $derived.by(() => {
		const integrations = tokenStatusQuery.current || [];
		for (const int of integrations) {
			if (!int.tokenExpiresAt) continue;
			const expiresAt = new Date(int.tokenExpiresAt);
			const now = new Date();
			const daysLeft = Math.floor((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
			if (daysLeft < 0) return { expired: true, text: `Tokenul Meta Ads (${int.businessName}) a expirat pe ${expiresAt.toLocaleDateString('ro-RO')}. Reconectează din Settings.` };
			if (daysLeft <= 7) return { expired: false, text: `Tokenul Meta Ads (${int.businessName}) expiră în ${daysLeft} zile (${expiresAt.toLocaleDateString('ro-RO')}).` };
		}
		return null;
	});

	const spendingQuery = getMetaAdsSpendingList();
	const spending = $derived(spendingQuery.current || []);
	const loading = $derived(spendingQuery.loading);

	let syncing = $state(false);

	async function handleSync() {
		syncing = true;
		try {
			const result = await triggerMetaAdsSync().updates(spendingQuery);
			toast.success(`Sync complet: ${result.imported} noi, ${result.updated} actualizate, ${result.errors} erori`);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la sincronizare');
		} finally {
			syncing = false;
		}
	}

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

	// ---- Invoice Downloads ----
	const downloadsQuery = getMetaInvoiceDownloads();
	const downloads = $derived(downloadsQuery.current || []);
	const downloadsLoading = $derived(downloadsQuery.loading);

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
		const groups = new Map<string, { clientName: string; businessName: string; rows: typeof spending }>();
		// Add spending rows
		for (const row of dateFilteredSpending) {
			const key = row.clientName || 'Neatribuit';
			const existing = groups.get(key) || { clientName: key, businessName: row.businessName || '', rows: [] };
			existing.rows.push(row);
			groups.set(key, existing);
		}
		// Add download-only periods (no matching spending row)
		for (const dl of downloads) {
			const period = dl.periodStart?.substring(0, 7);
			if (period && (period < sinceMonth || period > untilMonth)) continue;
			const clientKey = dl.clientName || 'Neatribuit';
			const group = groups.get(clientKey) || { clientName: clientKey, businessName: dl.bmName || '', rows: [] };
			const hasSpendingRow = group.rows.some(r => r.metaAdAccountId === dl.metaAdAccountId && r.periodStart === dl.periodStart);
			if (!hasSpendingRow) {
				// Check if we already added a virtual row for this account+period
				const alreadyAdded = group.rows.some(r => (r as any)._downloadOnly && r.metaAdAccountId === dl.metaAdAccountId && r.periodStart === dl.periodStart);
				if (!alreadyAdded) {
					group.rows.push({
						id: `dl-${dl.metaAdAccountId}-${dl.periodStart}`,
						tenantId: dl.tenantId,
						integrationId: dl.integrationId,
						clientId: dl.clientId,
						metaAdAccountId: dl.metaAdAccountId,
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

	let downloadingMonth = $state(false);
	let redownloadingId = $state<string | null>(null);

	const MONTHS = ['Ianuarie', 'Februarie', 'Martie', 'Aprilie', 'Mai', 'Iunie', 'Iulie', 'August', 'Septembrie', 'Octombrie', 'Noiembrie', 'Decembrie'];
	const now = new Date();
	const defaultMonth = now.getMonth() === 0 ? 12 : now.getMonth();
	const defaultYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
	let selectedMonth = $state(defaultMonth);
	let selectedYear = $state(defaultYear);

	// ---- Download Dialog State ----
	type DlResult = { accountName: string; clientName: string; adAccountId: string; status: string; httpCode: number | null; invoiceId: string | null; error: string | null };
	let isDownloadDialogOpen = $state(false);
	let dlRunning = $state(false);
	let dlDone = $state(false);
	let dlAborted = $state(false);
	let dlCurrent = $state(0);
	let dlTotal = $state(0);
	let dlCurrentAccount = $state('');
	let dlResults = $state<DlResult[]>([]);

	const dlProgressPct = $derived(dlTotal > 0 ? Math.round((dlCurrent / dlTotal) * 100) : 0);
	const dlDownloaded = $derived(dlResults.filter(r => r.status === 'downloaded').length);
	const dlSkipped = $derived(dlResults.filter(r => r.status === 'skip').length);
	const dlNoInvoice = $derived(dlResults.filter(r => r.status === 'no_invoice').length);
	const dlErrors = $derived(dlResults.filter(r => r.status === 'error').length);

	const accountsQuery = getAccountsForInvoiceDownload();
	const downloadableAccounts = $derived(accountsQuery.current || []);

	function openDownloadDialog() {
		dlRunning = false;
		dlDone = false;
		dlAborted = false;
		dlCurrent = 0;
		dlTotal = 0;
		dlCurrentAccount = '';
		dlResults = [];
		isDownloadDialogOpen = true;
	}

	async function handleDownloadMonth() {
		const accounts = [...downloadableAccounts];
		if (accounts.length === 0) {
			toast.error('Nu există conturi cu sesiune activă');
			return;
		}
		dlRunning = true;
		dlDone = false;
		dlAborted = false;
		dlCurrent = 0;
		dlTotal = accounts.length;
		dlResults = [];
		downloadingMonth = true;

		for (const account of accounts) {
			if (dlAborted) break;
			dlCurrentAccount = account.accountName || account.metaAdAccountId;
			try {
				const result = await downloadInvoiceForAccount({
					adAccountId: account.metaAdAccountId,
					year: selectedYear,
					month: selectedMonth
				}).updates(downloadsQuery);
				dlResults = [...dlResults, {
					accountName: account.accountName || account.metaAdAccountId,
					clientName: account.clientName || '',
					adAccountId: account.metaAdAccountId,
					status: result.status,
					httpCode: result.httpCode,
					invoiceId: result.invoiceId,
					error: result.error
				}];
			} catch (e) {
				dlResults = [...dlResults, {
					accountName: account.accountName || account.metaAdAccountId,
					clientName: account.clientName || '',
					adAccountId: account.metaAdAccountId,
					status: 'error',
					httpCode: null,
					invoiceId: null,
					error: e instanceof Error ? e.message : 'Eroare'
				}];
			}
			dlCurrent++;
			if (dlCurrent < accounts.length && !dlAborted) {
				await new Promise(r => setTimeout(r, 500));
			}
		}

		dlRunning = false;
		dlDone = true;
		dlCurrentAccount = '';
		downloadingMonth = false;
		if (!dlAborted && dlDownloaded > 0) {
			toast.success(`${dlDownloaded} facturi descărcate`);
		}
	}

	async function handleRedownloadInvoice(downloadId: string) {
		redownloadingId = downloadId;
		try {
			await redownloadInvoice(downloadId).updates(downloadsQuery);
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
			await deleteInvoiceDownload(id).updates(downloadsQuery);
			toast.success('Factură ștearsă');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la ștergere');
		}
	}

	async function handlePreviewInvoicePDF(id: string) {
		try {
			const response = await fetch(`/${tenantSlug}/invoices/meta-ads/downloads/${id}/pdf`);
			if (!response.ok) throw new Error('Failed to load PDF');
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			window.open(url, '_blank');
		} catch (e) { toast.error(e instanceof Error ? e.message : 'Eroare la previzualizare'); }
	}

	async function handleDownloadInvoicePDF(id: string, period: string) {
		try {
			const response = await fetch(`/${tenantSlug}/invoices/meta-ads/downloads/${id}/pdf`);
			if (!response.ok) throw new Error('Failed to download PDF');
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `MetaAds-Factura-${period.replace(/[^a-zA-Z0-9-_]/g, '_')}.pdf`;
			a.click();
			URL.revokeObjectURL(url);
		} catch (e) { toast.error(e instanceof Error ? e.message : 'Eroare la descărcare'); }
	}

	// ---- Bulk Import from URLs ----
	let showBulkImport = $state(false);
	let bulkJson = $state('');
	let bulkAdAccountId = $state('');
	let bulkImporting = $state(false);

	// Unique ad accounts from spending + downloads + downloadable accounts for dropdown
	const adAccountOptions = $derived.by(() => {
		const map = new Map<string, string>();
		for (const row of spending) {
			if (row.metaAdAccountId && !map.has(row.metaAdAccountId)) {
				const label = groupedByClient.find(g => g.rows.some(r => r.metaAdAccountId === row.metaAdAccountId))?.clientName || row.metaAdAccountId;
				map.set(row.metaAdAccountId, `${row.metaAdAccountId} — ${label}`);
			}
		}
		for (const dl of downloads) {
			if (dl.metaAdAccountId && !map.has(dl.metaAdAccountId)) {
				map.set(dl.metaAdAccountId, `${dl.metaAdAccountId} — ${dl.adAccountName || dl.metaAdAccountId}`);
			}
		}
		for (const acc of downloadableAccounts) {
			if (acc.metaAdAccountId && !map.has(acc.metaAdAccountId)) {
				map.set(acc.metaAdAccountId, `${acc.metaAdAccountId} — ${acc.accountName || acc.metaAdAccountId}`);
			}
		}
		return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
	});

	async function handleBulkImport() {
		if (!bulkJson.trim()) {
			toast.error('Inserează JSON-ul cu link-uri');
			return;
		}
		let links: { url: string; invoiceId?: string; date?: string; amount?: string }[];
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

		// Auto-detect ad account ID from URLs if not selected
		let accountId = bulkAdAccountId;
		if (!accountId && links.length > 0) {
			const actMatch = links[0].url.match(/act=(\d+)/);
			if (actMatch) {
				accountId = `act_${actMatch[1]}`;
				console.log(`[BULK-IMPORT] Auto-detected ad account: ${accountId}`);
			}
		}
		if (!accountId) {
			toast.error('Selectează contul sau asigură-te că URL-urile conțin parametrul act=');
			return;
		}
		bulkAdAccountId = accountId;
		if (links.length === 0) {
			toast.error('Array-ul de link-uri este gol');
			return;
		}
		bulkImporting = true;
		console.log(`[BULK-IMPORT] Starting: account=${bulkAdAccountId}, links=${links.length}`);
		try {
			const result = await bulkDownloadMetaInvoices({ adAccountId: bulkAdAccountId, links }).updates(downloadsQuery);
			if (result.errors > 0 && result.errorDetails?.length) {
				toast.error(`Import: ${result.downloaded} OK, ${result.errors} erori:\n${result.errorDetails.join('\n')}`);
			} else {
				toast.success(`Import complet: ${result.downloaded} descărcate, ${result.skipped} sărite, ${result.errors} erori`);
			}
			bulkJson = '';
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la import');
		} finally {
			bulkImporting = false;
		}
	}

	const fbBillingScript = `// Facebook Billing → Payment Activity — extrage link-uri facturi
// Tastează "allow pasting" în Console înainte de paste!
(function(){
  var links = [];
  // Găsim toate link-urile de download billing_transaction
  document.querySelectorAll('a[href*="billing_transaction"]').forEach(function(a) {
    var url = a.href;
    if (!url || !url.includes('pdf=true')) return;
    // Urcăm la rândul tabelului pentru a extrage date, amount, invoice ID
    var row = a.closest('[role="row"]') || a.closest('tr');
    var text = row ? row.innerText : '';
    var invoiceMatch = text.match(/(FBADS-[\\w-]+)/);
    var dateMatch = text.match(/(\\d{1,2}\\s+\\w{3,9}\\s+\\d{4})/);
    var amountMatch = text.match(/(RON[\\d.,]+|USD[\\d.,]+|EUR[\\d.,]+)/);
    links.push({
      url: url,
      invoiceId: invoiceMatch ? invoiceMatch[1] : undefined,
      date: dateMatch ? dateMatch[1] : undefined,
      amount: amountMatch ? amountMatch[1] : undefined
    });
  });
  if (links.length === 0) {
    alert('Nu am găsit facturi pe această pagină. Asigură-te că ești pe Payment Activity.');
    return;
  }
  var json = JSON.stringify(links, null, 2);
  copy(json);
  console.log(json);
  console.log('Copiat ' + links.length + ' facturi în clipboard!');
  alert('Copiat ' + links.length + ' facturi Facebook în clipboard!\\nLipește JSON-ul în CRM → Import Facturi.');
})();`;

	function copyScript() {
		navigator.clipboard.writeText(fbBillingScript);
		toast.success('Script copiat în clipboard! Rulează-l în Console pe pagina Facebook Billing.');
	}
</script>

<div class="space-y-6">
	<!-- Header -->
	<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
		<div>
			<h1 class="text-3xl font-bold flex items-center gap-3">
				<svg class="h-8 w-8" viewBox="0 0 24 24" fill="#1877F2"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
				Facturi Meta Ads
			</h1>
			<p class="text-muted-foreground">Cheltuieli lunare și documente de facturare</p>
		</div>
		<div class="flex items-center gap-2 flex-wrap">
			<DateRangePicker bind:since bind:until />
			<Button variant="outline" size="sm" onclick={() => showBulkImport = !showBulkImport}>
				<Download class="mr-2 h-4 w-4" />Import Facturi
			</Button>
			<Button variant="outline" size="sm" onclick={openDownloadDialog} disabled={downloadingMonth}>
				{#if downloadingMonth}<Download class="mr-2 h-4 w-4 animate-bounce" />Descărcare...{:else}<Download class="mr-2 h-4 w-4" />Download Facturi{/if}
			</Button>
			<Button variant="outline" size="sm" onclick={handleSync} disabled={syncing}>
				{#if syncing}<RefreshCwIcon class="mr-2 h-4 w-4 animate-spin" />Sincronizare...{:else}<RefreshCwIcon class="mr-2 h-4 w-4" />Sync Acum{/if}
			</Button>
		</div>
	</div>

	<!-- Bulk Import Panel -->
	{#if showBulkImport}
		<Card class="p-4 space-y-3">
			<p class="text-sm font-medium">Import facturi din Facebook Billing</p>
			<div class="text-xs text-muted-foreground space-y-1">
				<p>1. Instalează <a href="/{tenantSlug}/facebook-ads-invoice-extractor.user.js" class="underline text-blue-600">Tampermonkey Script</a> sau deschide <a href="https://business.facebook.com/billing_hub/payment_activity" target="_blank" class="underline text-blue-600">Facebook Billing → Payment Activity</a></p>
				<p>2. Apasă butonul "Extrage Facturi Facebook" din pagina Facebook, apoi lipește JSON-ul aici:</p>
			</div>
			<textarea bind:value={bulkJson} placeholder='[{{"url":"https://business.facebook.com/ads/manage/billing_transaction/?act=...","txid":"...","invoiceId":"FBADS-...","date":"6 Jan 2025"}}]' class="w-full rounded-md border px-3 py-2 text-sm bg-background font-mono min-h-[100px]"></textarea>
			<div class="flex items-center gap-2">
				<select bind:value={bulkAdAccountId} class="rounded-md border px-3 py-2 text-sm bg-background">
					<option value="">Selectează contul</option>
					{#each adAccountOptions as opt}
						<option value={opt.id}>{opt.label}</option>
					{/each}
				</select>
				<Button size="sm" onclick={handleBulkImport} disabled={bulkImporting}>
					{#if bulkImporting}
						<Download class="mr-2 h-4 w-4 animate-spin" />Import...
					{:else}
						<Download class="mr-2 h-4 w-4" />Importă Toate
					{/if}
				</Button>
				<Button variant="outline" size="sm" onclick={copyScript}>Copiază Script Console</Button>
			</div>
		</Card>
	{/if}

	<!-- Session warning -->
	{#if sessionWarning}
		<div class="rounded-md p-4 bg-red-50 border border-red-200">
			<p class="text-sm text-red-800">
				{sessionWarning}
				<a href="/{tenantSlug}/settings/meta-ads" class="underline font-medium ml-1">Settings → Meta Ads</a>
			</p>
		</div>
	{/if}

	<!-- Token warning -->
	{#if tokenWarning}
		<div class="rounded-md p-4 {tokenWarning.expired ? 'bg-red-50 border border-red-200' : 'bg-amber-50 border border-amber-200'}">
			<p class="text-sm {tokenWarning.expired ? 'text-red-800' : 'text-amber-800'}">
				{tokenWarning.text}
				<a href="/{tenantSlug}/settings/meta-ads" class="underline font-medium ml-1">Settings → Meta Ads</a>
			</p>
		</div>
	{/if}

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
				<p class="text-lg font-medium">Nu sunt date de cheltuieli</p>
				<p class="text-sm text-muted-foreground">Apasă "Sync Acum" pentru a importa datele din Meta Ads.</p>
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
					{@const totalSpend = group.rows.reduce((s, r) => s + (r.spendCents || 0), 0)}
					{@const totalClicks = group.rows.reduce((s, r) => s + (r.clicks || 0), 0)}
					{@const totalImpressions = group.rows.reduce((s, r) => s + (r.impressions || 0), 0)}
					{@const curr = group.rows[0]?.currencyCode || 'RON'}
					{@const isExpanded = expandedAccounts.has(group.clientName)}
					{@const clientDls = downloadsByClient.get(group.clientName) || []}
					{@const dlCount = clientDls.filter(d => d.status === 'downloaded').length}
					<Collapsible open={isExpanded} onOpenChange={() => toggleAccount(group.clientName)}>
						<Card class="overflow-hidden">
							<CollapsibleTrigger class="w-full text-left cursor-pointer">
								<div class="px-6 py-4">
									<div class="flex items-center justify-between">
										<div class="flex items-center gap-3">
											<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
												<DollarSignIcon class="h-5 w-5 text-blue-500" />
											</div>
											<div>
												<div class="flex items-center gap-2">
													<h3 class="text-lg font-semibold">{group.clientName}</h3>
													{#if dlCount > 0}
														<span class="inline-flex items-center rounded-full border border-green-200 px-2 py-0.5 text-xs font-medium text-green-700 bg-green-50">{dlCount} facturi</span>
													{/if}
												</div>
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
												<p class="text-base font-semibold">{formatNumber(totalImpressions)}</p>
											</div>
											<ChevronDownIcon class="h-5 w-5 text-muted-foreground shrink-0 transition-transform duration-200 {isExpanded ? 'rotate-180' : ''}" />
										</div>
									</div>
								</div>
							</CollapsibleTrigger>

							<CollapsibleContent>
								<div class="border-t divide-y">
									{#each group.rows as row, i (row.id)}
										{@const isDownloadOnly = (row as any)._downloadOnly === true}
										{@const prevSpend = !isDownloadOnly ? group.rows[i + 1]?.spendCents : null}
										{@const trend = prevSpend ? ((row.spendCents - prevSpend) / prevSpend) * 100 : null}
										{@const invoices = downloadsByKey.get(`${row.metaAdAccountId}:${row.periodStart}`) || []}
										{@const allDownloaded = invoices.filter(d => d.status === 'downloaded' && d.pdfPath)}
										{@const hasIndividual = allDownloaded.some(d => d.txid)}
										{@const downloadedInvoices = hasIndividual ? allDownloaded.filter(d => d.txid) : allDownloaded}
										<!-- Spending / download-only row -->
										<div class="grid grid-cols-5 gap-2 px-6 py-3 hover:bg-muted/30 transition-colors items-center">
											<div class="flex items-center gap-2">
												<CalendarIcon class="h-4 w-4 text-muted-foreground shrink-0" />
												<span class="font-medium capitalize whitespace-nowrap">{formatPeriod(row.periodStart)}</span>
											</div>
											{#if isDownloadOnly}
												<div class="col-span-3"></div>
											{:else}
												<div class="text-right whitespace-nowrap">
													<span class="text-base font-semibold">{formatAmount(row.spendCents, row.currencyCode)}</span>
													{#if trend !== null}
														<span class="ml-1 text-xs {trend >= 0 ? 'text-red-500' : 'text-green-500'}">{trend >= 0 ? '+' : ''}{trend.toFixed(1)}%</span>
													{/if}
												</div>
												<span class="text-sm text-muted-foreground text-right whitespace-nowrap">{formatNumber(row.impressions)} imp.</span>
												<span class="text-sm text-right whitespace-nowrap">{formatNumber(row.clicks)} clicks</span>
											{/if}
											<div class="flex items-center justify-end gap-1">
												{#if downloadedInvoices.length === 1}
													<Button variant="outline" size="sm" class="whitespace-nowrap" onclick={() => handleDownloadInvoicePDF(downloadedInvoices[0].id, row.periodStart)}>
														<Download class="mr-1.5 h-3.5 w-3.5" />{downloadedInvoices[0].invoiceNumber || 'Descarcă factura'}
													</Button>
													<Button variant="ghost" size="icon" class="h-8 w-8" onclick={() => handlePreviewInvoicePDF(downloadedInvoices[0].id)} title="Preview"><Eye class="h-4 w-4" /></Button>
												{:else if downloadedInvoices.length > 1}
													<span class="text-xs text-green-600 font-medium">{downloadedInvoices.length} facturi</span>
												{:else if !isDownloadOnly}
													<span class="text-xs text-orange-500">În așteptare</span>
												{/if}
											</div>
										</div>
										<!-- Individual invoice rows when multiple -->
										{#if downloadedInvoices.length > 1}
											{#each downloadedInvoices as inv}
												<div class="grid grid-cols-5 gap-2 px-6 py-2 bg-muted/20 items-center">
													<div class="col-span-4 pl-6">
														<span class="text-xs text-blue-600 font-medium">{inv.invoiceNumber || inv.txid || '—'}</span>
													</div>
													<div class="flex items-center justify-end gap-1">
														<Button variant="outline" size="sm" class="whitespace-nowrap h-7 text-xs" onclick={() => handleDownloadInvoicePDF(inv.id, row.periodStart)}>
															<Download class="mr-1 h-3 w-3" />{inv.invoiceNumber || 'PDF'}
														</Button>
														<Button variant="ghost" size="icon" class="h-7 w-7" onclick={() => handlePreviewInvoicePDF(inv.id)} title="Preview"><Eye class="h-3.5 w-3.5" /></Button>
													</div>
												</div>
											{/each}
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

<!-- Download Dialog -->
<Dialog bind:open={isDownloadDialogOpen}>
	<DialogContent class="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
		<DialogHeader>
			<DialogTitle class="flex items-center gap-2">
				<Download class="h-5 w-5" />
				Descărcare facturi
			</DialogTitle>
			<DialogDescription>
				Descarcă facturile PDF din Facebook Business Manager pentru toate conturile active.
			</DialogDescription>
		</DialogHeader>

		<!-- Setup -->
		{#if !dlRunning && !dlDone}
			<div class="space-y-4 py-2">
				<div class="flex items-center gap-2">
					<select class="h-9 rounded-md border border-input bg-background px-3 text-sm flex-1" bind:value={selectedMonth}>
						{#each MONTHS as m, i}<option value={i + 1}>{m}</option>{/each}
					</select>
					<select class="h-9 w-24 rounded-md border border-input bg-background px-3 text-sm" bind:value={selectedYear}>
						{#each [2024, 2025, 2026] as y}<option value={y}>{y}</option>{/each}
					</select>
				</div>
				<div class="rounded-md border bg-muted/40 px-4 py-3">
					<p class="text-sm">
						<span class="text-foreground font-medium">{downloadableAccounts.length} conturi</span>
						<span class="text-muted-foreground"> vor fi verificate pentru </span>
						<span class="font-semibold">{MONTHS[selectedMonth - 1]} {selectedYear}</span>
					</p>
				</div>
			</div>
			<DialogFooter>
				<Button variant="outline" onclick={() => isDownloadDialogOpen = false}>Anulare</Button>
				<Button onclick={handleDownloadMonth} disabled={downloadableAccounts.length === 0}>
					<Download class="mr-2 h-4 w-4" />Pornește Descărcarea
				</Button>
			</DialogFooter>
		{/if}

		<!-- Running -->
		{#if dlRunning}
			<div class="space-y-4 py-2">
				<div class="space-y-2">
					<div class="flex items-center justify-between text-sm">
						<span class="font-medium">Progres descărcare</span>
						<span class="text-muted-foreground">{dlCurrent} / {dlTotal}</span>
					</div>
					<div class="h-2.5 w-full rounded-full bg-muted overflow-hidden">
						<div class="h-2.5 rounded-full bg-primary transition-all duration-300" style="width: {dlProgressPct}%"></div>
					</div>
					<p class="text-xs text-muted-foreground truncate">Se descarcă: {dlCurrentAccount}...</p>
				</div>

				{#if dlResults.length > 0}
					<div class="max-h-60 overflow-y-auto rounded-md border">
						<table class="w-full text-sm">
							<thead class="sticky top-0 bg-muted/80 backdrop-blur">
								<tr>
									<th class="px-3 py-2 text-left font-medium text-muted-foreground">Cont Facebook</th>
									<th class="px-3 py-2 text-left font-medium text-muted-foreground">Client CRM</th>
									<th class="px-3 py-2 text-left font-medium text-muted-foreground">Status</th>
									<th class="px-3 py-2 text-left font-medium text-muted-foreground">HTTP</th>
								</tr>
							</thead>
							<tbody class="divide-y">
								{#each [...dlResults].reverse() as r}
									<tr class="hover:bg-muted/30">
										<td class="px-3 py-2 truncate max-w-[160px]" title={r.accountName}>{r.accountName}</td>
										<td class="px-3 py-2 truncate max-w-[120px] text-muted-foreground">{r.clientName}</td>
										<td class="px-3 py-2">
											{#if r.status === 'downloaded'}
												<span class="text-green-600">Descărcat</span>
											{:else if r.status === 'skip'}
												<span class="text-muted-foreground">Sărit</span>
											{:else if r.status === 'no_invoice'}
												<span class="text-amber-600">Fără factură</span>
											{:else}
												<span class="text-red-600">{r.error || 'Eroare'}</span>
											{/if}
										</td>
										<td class="px-3 py-2 text-muted-foreground">{r.httpCode ?? '—'}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</div>
			<DialogFooter>
				<Button variant="destructive" onclick={() => dlAborted = true}>
					Oprește Descărcarea
				</Button>
			</DialogFooter>
		{/if}

		<!-- Done -->
		{#if dlDone}
			<div class="space-y-4 py-2">
				<div class="grid grid-cols-4 gap-3">
					<div class="rounded-lg border bg-green-50 p-3 text-center">
						<p class="text-2xl font-bold text-green-700">{dlDownloaded}</p>
						<p class="text-xs text-green-600 mt-0.5">Descărcate</p>
					</div>
					<div class="rounded-lg border bg-muted/40 p-3 text-center">
						<p class="text-2xl font-bold text-muted-foreground">{dlSkipped}</p>
						<p class="text-xs text-muted-foreground mt-0.5">Sărite</p>
					</div>
					<div class="rounded-lg border bg-amber-50 p-3 text-center">
						<p class="text-2xl font-bold text-amber-700">{dlNoInvoice}</p>
						<p class="text-xs text-amber-600 mt-0.5">Fără factură</p>
					</div>
					<div class="rounded-lg border bg-red-50 p-3 text-center">
						<p class="text-2xl font-bold text-red-700">{dlErrors}</p>
						<p class="text-xs text-red-600 mt-0.5">Erori</p>
					</div>
				</div>

				{#if dlResults.length > 0}
					<div class="max-h-60 overflow-y-auto rounded-md border">
						<table class="w-full text-sm">
							<thead class="sticky top-0 bg-muted/80 backdrop-blur">
								<tr>
									<th class="px-3 py-2 text-left font-medium text-muted-foreground">Cont Facebook</th>
									<th class="px-3 py-2 text-left font-medium text-muted-foreground">Client CRM</th>
									<th class="px-3 py-2 text-left font-medium text-muted-foreground">Status</th>
									<th class="px-3 py-2 text-left font-medium text-muted-foreground">HTTP</th>
								</tr>
							</thead>
							<tbody class="divide-y">
								{#each dlResults as r}
									<tr class="hover:bg-muted/30">
										<td class="px-3 py-2 truncate max-w-[160px]" title={r.accountName}>{r.accountName}</td>
										<td class="px-3 py-2 truncate max-w-[120px] text-muted-foreground">{r.clientName}</td>
										<td class="px-3 py-2">
											{#if r.status === 'downloaded'}
												<span class="text-green-600">Descărcat</span>
											{:else if r.status === 'skip'}
												<span class="text-muted-foreground">Sărit</span>
											{:else if r.status === 'no_invoice'}
												<span class="text-amber-600">Fără factură</span>
											{:else}
												<span class="text-red-600">{r.error || 'Eroare'}</span>
											{/if}
										</td>
										<td class="px-3 py-2 text-muted-foreground">{r.httpCode ?? '—'}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</div>
			<DialogFooter>
				<Button onclick={() => isDownloadDialogOpen = false}>Închide</Button>
			</DialogFooter>
		{/if}
	</DialogContent>
</Dialog>
