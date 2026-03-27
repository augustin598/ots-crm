<script lang="ts">
	import { getMetaAdsSpendingList, triggerMetaAdsSync, getMetaInvoiceDownloads, triggerInvoiceDownload, redownloadInvoice, deleteInvoiceDownload, getMetaTokenStatus } from '$lib/remotes/meta-ads-invoices.remote';
	import { page } from '$app/state';
	import { Card } from '$lib/components/ui/card';
	import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '$lib/components/ui/collapsible';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { Download, Search, Eye, Trash2 } from '@lucide/svelte';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import DollarSignIcon from '@lucide/svelte/icons/dollar-sign';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import DateRangePicker from '$lib/components/reports/date-range-picker.svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { toast } from 'svelte-sonner';

	// Date range — implicit: tot anul curent
	const currentYear = new Date().getFullYear();
	let since = $state(`${currentYear}-01-01`);
	let until = $state(`${currentYear}-12-31`);

	const tenantSlug = $derived(page.params.tenant as string);

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
	let lastSyncResult = $state<{ imported: number; updated: number; errors: number; at: Date } | null>(null);

	async function handleSync() {
		syncing = true;
		try {
			const result = await triggerMetaAdsSync().updates(spendingQuery);
			lastSyncResult = { imported: result.imported, updated: result.updated, errors: result.errors, at: new Date() };
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

	// Filter by date range then group by client
	const dateFilteredSpending = $derived(
		spending.filter((r: any) => {
			if (!r.periodStart) return true;
			const period = r.periodStart.substring(0, 7);
			return period >= since.substring(0, 7) && period <= until.substring(0, 7);
		})
	);

	const groupedByClient = $derived.by(() => {
		const groups = new Map<string, { clientName: string; businessName: string; rows: typeof spending }>();
		for (const row of dateFilteredSpending) {
			const key = row.clientName || 'Neatribuit';
			const existing = groups.get(key) || { clientName: key, businessName: row.businessName || '', rows: [] };
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
				g.clientName.toLowerCase().includes(spendSearchQuery.trim().toLowerCase()) ||
				g.businessName.toLowerCase().includes(spendSearchQuery.trim().toLowerCase())
			)
			: groupedByClient
	);

	// ---- Invoice Downloads ----
	const downloadsQuery = getMetaInvoiceDownloads();
	const downloads = $derived(downloadsQuery.current || []);
	const downloadsLoading = $derived(downloadsQuery.loading);

	// Map downloads by periodStart+accountId for inline display on spending rows
	const downloadsByKey = $derived.by(() => {
		const map = new Map<string, typeof downloads[0]>();
		for (const dl of downloads) {
			const key = `${dl.metaAdAccountId}:${dl.periodStart}`;
			if (!map.has(key) || dl.status === 'downloaded') map.set(key, dl);
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
	const selectedLabel = $derived(`${MONTHS[selectedMonth - 1]} ${selectedYear}`);

	async function handleDownloadMonth() {
		downloadingMonth = true;
		try {
			const result = await triggerInvoiceDownload({ year: selectedYear, month: selectedMonth }).updates(downloadsQuery);
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
		<div class="flex items-center gap-2">
			<DateRangePicker bind:since bind:until />
			<Button variant="outline" size="sm" onclick={handleSync} disabled={syncing}>
				{#if syncing}<RefreshCwIcon class="mr-2 h-4 w-4 animate-spin" />Sincronizare...{:else}<RefreshCwIcon class="mr-2 h-4 w-4" />Sync Acum{/if}
			</Button>
			{#if lastSyncResult}
				<p class="text-xs text-muted-foreground">
					{lastSyncResult.at.toLocaleString('ro-RO')} — {lastSyncResult.imported} noi, {lastSyncResult.updated} actualizate, {lastSyncResult.errors} erori
				</p>
			{/if}
		</div>
	</div>

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
	{:else if spending.length === 0}
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
										{@const prevSpend = group.rows[i + 1]?.spendCents}
										{@const trend = prevSpend ? ((row.spendCents - prevSpend) / prevSpend) * 100 : null}
										{@const invoice = downloadsByKey.get(`${row.metaAdAccountId}:${row.periodStart}`)}
										<div class="grid grid-cols-5 gap-2 px-6 py-3 hover:bg-muted/30 transition-colors items-center">
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
				{/each}
			</div>
		{/if}
	{/if}

	<!-- Facturi PDF Facebook -->
	<Card class="overflow-hidden">
		<div class="border-b bg-muted/30 px-6 py-4">
			<div class="flex items-center justify-between">
				<div>
					<h2 class="text-lg font-semibold">Facturi PDF Facebook</h2>
					<p class="text-sm text-muted-foreground">Facturi oficiale descărcate din Facebook Business Manager</p>
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

		{#if downloadsLoading}
			<div class="p-6"><Skeleton class="h-32 w-full" /></div>
		{:else if downloads.length === 0}
			<div class="p-8 text-center">
				<p class="text-sm text-muted-foreground">Nu sunt facturi PDF descărcate. Selectează luna și apasă "Download".</p>
			</div>
		{:else}
			<div class="divide-y">
				{#each downloads as dl}
					<div class="flex items-center justify-between px-6 py-3 hover:bg-muted/30 transition-colors">
						<div class="flex items-center gap-3">
							<CalendarIcon class="h-4 w-4 text-muted-foreground" />
							<div>
								<span class="font-medium">{dl.adAccountName || dl.metaAdAccountId}</span>
								{#if dl.clientName}<span class="text-sm text-muted-foreground ml-2">({dl.clientName})</span>{/if}
							</div>
						</div>
						<div class="flex items-center gap-4">
							<span class="text-sm text-muted-foreground">{formatPeriod(dl.periodStart)}</span>
							{#if dl.status === 'downloaded'}
								<span class="inline-flex items-center rounded-full border border-green-200 px-2.5 py-1 text-xs font-medium text-green-700 bg-green-50 dark:border-green-800 dark:text-green-400 dark:bg-green-950">Descărcat</span>
							{:else if dl.status === 'pending'}
								<span class="inline-flex items-center rounded-full border border-yellow-200 px-2.5 py-1 text-xs font-medium text-yellow-700 bg-yellow-50">Pending</span>
							{:else if dl.status === 'error'}
								<span class="inline-flex items-center rounded-full border border-red-200 px-2.5 py-1 text-xs font-medium text-red-700 bg-red-50" title={dl.errorMessage || ''}>Eroare</span>
							{:else if dl.status === 'session_expired'}
								<span class="inline-flex items-center rounded-full border border-orange-200 px-2.5 py-1 text-xs font-medium text-orange-700 bg-orange-50">Sesiune expirată</span>
							{/if}
							<div class="flex items-center gap-1">
								{#if dl.status === 'downloaded' && dl.pdfPath}
									<Button variant="ghost" size="icon" class="h-8 w-8" onclick={() => handlePreviewInvoicePDF(dl.id)} title="Preview"><Eye class="h-4 w-4" /></Button>
									<Button variant="ghost" size="icon" class="h-8 w-8" onclick={() => handleDownloadInvoicePDF(dl.id, dl.periodStart)} title="Download"><Download class="h-4 w-4" /></Button>
								{/if}
								{#if dl.status === 'error' || dl.status === 'session_expired'}
									<Button variant="ghost" size="icon" class="h-8 w-8 text-blue-500" onclick={() => handleRedownloadInvoice(dl.id)} disabled={redownloadingId === dl.id} title="Re-download">
										{#if redownloadingId === dl.id}<RefreshCwIcon class="h-4 w-4 animate-spin" />{:else}<RefreshCwIcon class="h-4 w-4" />{/if}
									</Button>
								{/if}
								<Button variant="ghost" size="icon" class="h-8 w-8 text-red-500 hover:text-red-700" onclick={() => handleDeleteDownload(dl.id)} title="Șterge"><Trash2 class="h-4 w-4" /></Button>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</Card>
</div>
