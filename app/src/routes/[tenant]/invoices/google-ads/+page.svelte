<script lang="ts">
	import { getGoogleAdsInvoices, getGoogleAdsMonthlySpend, deleteGoogleAdsInvoice, triggerGoogleAdsSync, downloadGoogleInvoiceFromUrl, bulkDownloadGoogleInvoices } from '$lib/remotes/google-ads-invoices.remote';
	import { page } from '$app/state';
	import {
		Table, TableBody, TableCell, TableHead, TableHeader, TableRow
	} from '$lib/components/ui/table';
	import { Card } from '$lib/components/ui/card';
	import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '$lib/components/ui/collapsible';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Download, Search, Eye, Trash2, ExternalLink } from '@lucide/svelte';
	import ArrowUpDownIcon from '@lucide/svelte/icons/arrow-up-down';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
	import DollarSignIcon from '@lucide/svelte/icons/dollar-sign';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import IconGoogleAds from '$lib/components/marketing/icon-google-ads.svelte';
	import DateRangePicker from '$lib/components/reports/date-range-picker.svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { toast } from 'svelte-sonner';

	// Date range — implicit: tot anul curent
	const currentYear = new Date().getFullYear();
	let since = $state(`${currentYear}-01-01`);
	let until = $state(`${currentYear}-12-31`);

	function formatMonth(month: string): string {
		try {
			const parts = month.split('-');
			const d = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
			return isNaN(d.getTime()) ? month : d.toLocaleDateString('ro-RO', { month: 'long', year: 'numeric' });
		} catch { return month; }
	}

	// Match invoices to months: find invoice for a given YYYY-MM
	function getInvoiceMonth(issueDate: any): string | null {
		if (!issueDate) return null;
		// Date object
		if (issueDate instanceof Date && !isNaN(issueDate.getTime())) {
			return `${issueDate.getUTCFullYear()}-${String(issueDate.getUTCMonth() + 1).padStart(2, '0')}`;
		}
		const s = String(issueDate);
		// ISO string "2026-02-28T00:00:00.000Z" or "2026-02-28"
		if (s.match(/^\d{4}-\d{2}/)) return s.substring(0, 7);
		// Unix timestamp (number as string)
		if (s.match(/^\d{10,13}$/)) {
			const d = new Date(Number(s) * (s.length <= 10 ? 1000 : 1));
			return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
		}
		// Try parsing
		const d = new Date(s);
		if (!isNaN(d.getTime())) return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
		return null;
	}

	function findInvoiceForMonth(monthStr: string, customerId?: string) {
		// Normalize to YYYY-MM (monthStr can be "2026-02" or "2026-02-01")
		const targetMonth = monthStr.substring(0, 7);
		const found = invoices.find(inv => {
			const invMonth = getInvoiceMonth(inv.issueDate);
			if (!invMonth || invMonth !== targetMonth) return false;
			if (customerId && inv.googleAdsCustomerId) {
				return inv.googleAdsCustomerId.replace(/-/g, '') === customerId.replace(/-/g, '');
			}
			return true;
		});
		return found;
	}


	function formatCurr(value: number, currency: string): string {
		return new Intl.NumberFormat('ro-RO', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
	}

	const tenantSlug = $derived(page.params.tenant as string);

	const invoicesQuery = getGoogleAdsInvoices();
	const invoices = $derived(invoicesQuery.current || []);
	const loading = $derived(invoicesQuery.loading);

	// Defer to client-side to avoid hydration mismatch from date formatting
	let monthlySpendQuery = $state<ReturnType<typeof getGoogleAdsMonthlySpend> | null>(null);
	const monthlySpend = $derived(monthlySpendQuery?.current || []);
	const monthlyLoading = $derived(monthlySpendQuery?.loading ?? true);

	$effect(() => {
		monthlySpendQuery = getGoogleAdsMonthlySpend();
	});

	// Collapsible + search state for monthly spend cards
	let spendSearchQuery = $state('');
	let expandedAccounts = new SvelteSet<string>();

	function toggleAccount(customerId: string) {
		if (expandedAccounts.has(customerId)) expandedAccounts.delete(customerId);
		else expandedAccounts.add(customerId);
	}

	// Filter months by date range, then filter by search
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

	const filteredMonthlySpend = $derived(
		spendSearchQuery.trim()
			? dateFilteredMonthlySpend.filter((account: any) =>
				account.accountName.toLowerCase().includes(spendSearchQuery.trim().toLowerCase()) ||
				account.googleAdsCustomerId.includes(spendSearchQuery.trim().replace(/-/g, '')) ||
				(account.clientName || '').toLowerCase().includes(spendSearchQuery.trim().toLowerCase())
			)
			: dateFilteredMonthlySpend
	);

	let syncing = $state(false);
	let showUrlDownload = $state(false);
	let urlPdfLink = $state('');
	let urlCustomerId = $state('');
	let urlInvoiceId = $state('');
	let urlDownloading = $state(false);
	let showBulkImport = $state(false);
	let bulkJson = $state('');
	let bulkCustomerId = $state('');
	let bulkDownloading = $state(false);
	let filterMonth = $state(0); // 0 = all
	let filterYear = $state(new Date().getFullYear());
	let searchQuery = $state('');
	let sortColumn = $state<'clientName' | 'invoiceNumber' | 'issueDate' | 'totalAmountMicros'>('issueDate');
	let sortDirection = $state<'asc' | 'desc'>('desc');
	let pageSize = $state(25);
	let currentPage = $state(1);

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
			toast.error(e instanceof Error ? e.message : 'Eroare la descărcare');
		} finally {
			urlDownloading = false;
		}
	}

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
			toast.error(e instanceof Error ? e.message : 'Eroare la descărcare');
		} finally {
			bulkDownloading = false;
		}
	}

	let lastSyncResult = $state<{ imported: number; skipped: number; errors: number; spendingInserted?: number; spendingUpdated?: number; at: Date } | null>(null);

	async function handleSync() {
		syncing = true;
		try {
			const result = await triggerGoogleAdsSync().updates(invoicesQuery);
			lastSyncResult = { ...result, at: new Date() };
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

	// Available years from invoices
	const availableYears = $derived(() => {
		const years = new Set<number>();
		invoices.forEach(inv => {
			if (inv.issueDate) {
				const d = inv.issueDate instanceof Date ? inv.issueDate : new Date(String(inv.issueDate));
				if (!isNaN(d.getTime())) years.add(d.getUTCFullYear());
			}
		});
		return [...years].sort((a, b) => b - a);
	});

	// Filter, sort, paginate
	const filteredInvoices = $derived(
		invoices.filter((inv) => {
			// Text search
			if (searchQuery.trim() !== '') {
				const q = searchQuery.trim().toLowerCase();
				if (!(inv.clientName || '').toLowerCase().includes(q) && !(inv.invoiceNumber || '').toLowerCase().includes(q)) return false;
			}
			// Month/Year filter
			if (filterMonth > 0 || filterYear > 0) {
				if (!inv.issueDate) return false;
				const d = inv.issueDate instanceof Date ? inv.issueDate : new Date(String(inv.issueDate));
				if (isNaN(d.getTime())) return false;
				if (filterYear > 0 && d.getUTCFullYear() !== filterYear) return false;
				if (filterMonth > 0 && (d.getUTCMonth() + 1) !== filterMonth) return false;
			}
			return true;
		})
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
		<div class="flex items-center gap-2">
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
		</div>
		{#if lastSyncResult}
			<p class="text-xs text-muted-foreground text-right">
				{lastSyncResult.at.toLocaleString('ro-RO')} — {lastSyncResult.imported} importate, {lastSyncResult.errors} erori
				{#if lastSyncResult.spendingInserted != null}
					| spend: {lastSyncResult.spendingInserted} noi, {lastSyncResult.spendingUpdated ?? 0} actualizate
				{/if}
			</p>
		{/if}
	</div>

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

	<!-- Monthly Spend Cards -->
	{#if monthlyLoading}
		<div class="space-y-4">
			{#each Array(2) as _, idx (idx)}
				<Card class="p-6"><Skeleton class="h-48 w-full" /></Card>
			{/each}
		</div>
	{:else if monthlySpend.length > 0}
		<!-- Search -->
		<div class="relative">
			<Search class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
			<Input
				bind:value={spendSearchQuery}
				type="text"
				placeholder="Caută cont sau client..."
				class="pl-9"
			/>
		</div>

		{#if filteredMonthlySpend.length === 0}
			<p class="text-sm text-muted-foreground text-center py-4">Niciun cont găsit pentru „{spendSearchQuery}"</p>
		{:else}
			<div class="space-y-4">
				{#each filteredMonthlySpend as account (account.googleAdsCustomerId)}
					{#if account.months.length > 0}
						{@const totalSpend = account.months.reduce((s: number, m: any) => s + m.spend, 0)}
						{@const totalClicks = account.months.reduce((s: number, m: any) => s + m.clicks, 0)}
						{@const totalConv = account.months.reduce((s: number, m: any) => s + m.conversions, 0)}
						{@const curr = account.months[0]?.currencyCode || 'USD'}
						{@const isExpanded = expandedAccounts.has(account.googleAdsCustomerId)}
						<Collapsible open={isExpanded} onOpenChange={() => toggleAccount(account.googleAdsCustomerId)}>
							<Card class="overflow-hidden">
								<!-- Account Header + KPIs (always visible) -->
								<CollapsibleTrigger class="w-full text-left cursor-pointer">
									<div class="px-6 py-4">
										<div class="flex items-center justify-between">
											<div class="flex items-center gap-3">
												<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
													<DollarSignIcon class="h-5 w-5 text-primary" />
												</div>
												<div>
													<h3 class="text-lg font-semibold">{account.accountName}</h3>
													<p class="text-sm text-muted-foreground">{account.months.length} luni</p>
												</div>
											</div>
											<div class="flex items-center gap-4">
												<div class="text-right">
													<p class="text-xs text-muted-foreground">Total cheltuieli</p>
													<p class="text-lg font-bold">{formatCurr(totalSpend, curr)}</p>
												</div>
												<div class="text-right hidden sm:block">
													<p class="text-xs text-muted-foreground">Click-uri</p>
													<p class="text-base font-semibold">{totalClicks.toLocaleString('ro-RO')}</p>
												</div>
												<div class="text-right hidden sm:block">
													<p class="text-xs text-muted-foreground">Conversii</p>
													<p class="text-base font-semibold">{totalConv.toLocaleString('ro-RO')}</p>
												</div>
												<ChevronDownIcon class="h-5 w-5 text-muted-foreground shrink-0 transition-transform duration-200 {isExpanded ? 'rotate-180' : ''}" />
											</div>
										</div>
									</div>
								</CollapsibleTrigger>

								<!-- Expanded: Monthly Rows -->
								<CollapsibleContent>
									<div class="border-t divide-y">
										{#each account.months as m, i (m.month)}
											{@const prevSpend = account.months[i + 1]?.spend}
											{@const trend = prevSpend ? ((m.spend - prevSpend) / prevSpend) * 100 : null}
											{@const monthInvoice = findInvoiceForMonth(m.month, account.googleAdsCustomerId)}
											<div class="grid grid-cols-6 gap-2 px-6 py-3 hover:bg-muted/30 transition-colors items-center">
												<div class="flex items-center gap-2">
													<CalendarIcon class="h-4 w-4 text-muted-foreground shrink-0" />
													<span class="font-medium capitalize whitespace-nowrap">{formatMonth(m.month)}</span>
												</div>
												<div class="text-right whitespace-nowrap">
													<span class="text-base font-semibold">{formatCurr(m.spend, m.currencyCode)}</span>
													{#if trend !== null}
														<span class="ml-1 text-xs {trend >= 0 ? 'text-red-500' : 'text-green-500'}">{trend >= 0 ? '+' : ''}{trend.toFixed(1)}%</span>
													{/if}
												</div>
												<span class="text-sm text-muted-foreground text-right whitespace-nowrap">{m.impressions.toLocaleString('ro-RO')} imp.</span>
												<span class="text-sm text-right whitespace-nowrap">{m.clicks.toLocaleString('ro-RO')} clicks</span>
												<span class="text-sm text-right whitespace-nowrap flex items-center justify-end gap-1"><TrendingUpIcon class="h-3.5 w-3.5 text-primary" />{m.conversions} conv.</span>
												<div class="flex justify-end">
													{#if monthInvoice}
														<Button variant="outline" size="sm" class="whitespace-nowrap w-full" onclick={() => handleDownloadPDF(monthInvoice.id, monthInvoice.invoiceNumber)}>
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
									{#if account.clientEmail}
										<div class="border-t px-6 py-3 bg-muted/20 flex items-center justify-between">
											<p class="text-sm text-muted-foreground">Facturi pe contul <strong>{account.clientEmail}</strong></p>
											<a href="https://ads.google.com/aw/billing/documents" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-2 rounded-lg border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors shrink-0">
												<ExternalLink class="h-3.5 w-3.5" />
												Google Billing
											</a>
										</div>
									{/if}
								</CollapsibleContent>
							</Card>
						</Collapsible>
					{/if}
				{/each}
			</div>
		{/if}
	{/if}

	<!-- Synced Invoices (for monthly invoicing accounts) -->
	{#if loading}
		<Card class="p-6"><Skeleton class="h-32 w-full" /></Card>
	{:else if invoices.length > 0}
		<div class="space-y-4">
			<h2 class="text-lg font-semibold">Facturi sincronizate</h2>
			<div class="flex items-center justify-between gap-4 rounded-md bg-muted/50 px-4 py-3">
				<p class="text-sm text-muted-foreground whitespace-nowrap">{startIndex + 1} - {endIndex} din {totalEntries}</p>
				<div class="flex items-center gap-2">
					<select bind:value={filterMonth} onchange={() => { currentPage = 1; }} class="rounded-md border px-3 py-2 text-sm bg-background">
						<option value={0}>Toate lunile</option>
						{#each Array.from({ length: 12 }, (_, i) => i + 1) as m}
							<option value={m}>{new Date(2000, m - 1).toLocaleString('ro-RO', { month: 'long' })}</option>
						{/each}
					</select>
					<select bind:value={filterYear} onchange={() => { currentPage = 1; }} class="rounded-md border px-3 py-2 text-sm bg-background">
						<option value={0}>Toți anii</option>
						{#each availableYears() as y}
							<option value={y}>{y}</option>
						{/each}
					</select>
					<div class="relative w-48">
						<Search class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
						<Input type="text" placeholder="Caută..." class="pl-9" bind:value={searchQuery} oninput={() => { currentPage = 1; }} />
					</div>
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
