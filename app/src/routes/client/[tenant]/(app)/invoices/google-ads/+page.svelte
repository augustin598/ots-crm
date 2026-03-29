<script lang="ts">
	import { getGoogleAdsInvoices, getGoogleAdsSpendingList } from '$lib/remotes/google-ads-invoices.remote';
	import { page } from '$app/state';
	import { Card } from '$lib/components/ui/card';
	import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '$lib/components/ui/collapsible';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Download, Search, Eye, FileArchive, ExternalLink } from '@lucide/svelte';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import DollarSignIcon from '@lucide/svelte/icons/dollar-sign';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import IconGoogleAds from '$lib/components/marketing/icon-google-ads.svelte';
	import DateRangePicker from '$lib/components/reports/date-range-picker.svelte';
	import { getDefaultDateRange, getDatePresets } from '$lib/utils/report-helpers';
	import { SvelteSet } from 'svelte/reactivity';
	import { clientLogger } from '$lib/client-logger';
	import JSZip from 'jszip';

	const tenantSlug = $derived(page.params.tenant as string);

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

	const invoicesQuery = getGoogleAdsInvoices();
	const invoices = $derived(invoicesQuery.current || []);
	const loading = $derived(invoicesQuery.loading);

	// Spending data from DB (synced via Google Ads API, same pattern as Meta/TikTok)
	const spendingQuery = getGoogleAdsSpendingList();
	const spendingRows = $derived(spendingQuery.current || []);
	const monthlyLoading = $derived(spendingQuery.loading);

	// Transform flat DB rows into grouped format
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
				month: row.periodStart.substring(0, 7),
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
		return formatCurr(micros / 1_000_000, currency);
	}

	// ---- Data grouping (mirroring Meta client structure) ----

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

		for (const account of dateFilteredMonthlySpend) {
			const key = account.clientName || account.accountName || 'Neatribuit';
			const group = groups.get(key) || { clientName: key, hasMultipleAccounts: false, rows: [] as SpendRow[] };
			for (const m of account.months) {
				group.rows.push({
					id: `${account.customerId || account.googleAdsCustomerId}:${m.month}`,
					month: m.month,
					accountName: account.accountName,
					googleAdsCustomerId: account.customerId || account.googleAdsCustomerId || '',
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

		// Add invoice-only entries
		for (const inv of invoices) {
			const invMonth = getInvoiceMonth(inv.issueDate);
			if (!invMonth) continue;
			if (invMonth < sinceMonth || invMonth > untilMonth) continue;
			const key = inv.clientName || 'Neatribuit';
			const group = groups.get(key) || { clientName: key, hasMultipleAccounts: false, rows: [] as SpendRow[] };
			const custId = (inv.googleAdsCustomerId || '').replace(/-/g, '');
			const hasRow = group.rows.some(r => r.month.substring(0, 7) === invMonth && r.googleAdsCustomerId.replace(/-/g, '') === custId);
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

	// ---- PDF download/preview ----

	async function handleDownloadPDF(invoiceId: string, invoiceNumber: string | null) {
		try {
			const response = await fetch(`/client/${tenantSlug}/invoices/google-ads/${invoiceId}/pdf`);
			if (!response.ok) throw new Error('Failed to download PDF');
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `GoogleAds-${(invoiceNumber || invoiceId).replace(/[^a-zA-Z0-9-_]/g, '_')}.pdf`;
			a.click();
			URL.revokeObjectURL(url);
		} catch (e) {
			clientLogger.apiError('client_google_ads_download_pdf', e);
		}
	}

	async function handlePreviewPDF(invoiceId: string) {
		try {
			const response = await fetch(`/client/${tenantSlug}/invoices/google-ads/${invoiceId}/pdf`);
			if (!response.ok) throw new Error('Failed to load PDF');
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			window.open(url, '_blank');
		} catch (e) {
			clientLogger.apiError('client_google_ads_preview_pdf', e);
		}
	}

	// ---- ZIP Download ----

	async function downloadAsZip(invoiceIds: string[], zipName: string) {
		zipping = true;
		try {
			const zip = new JSZip();
			for (const id of invoiceIds) {
				const res = await fetch(`/client/${tenantSlug}/invoices/google-ads/${id}/pdf`);
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
			clientLogger.apiError('client_google_ads_zip_download', e, 'EXPORT_GENERATION_FAILED');
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
		<DateRangePicker bind:since bind:until />
	</div>

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
				<div>
					<p class="text-lg font-medium">Nu există date de facturare</p>
					<p class="text-sm text-muted-foreground mt-1">Nu este asociat niciun cont Google Ads sau nu există cheltuieli înregistrate.</p>
				</div>
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
