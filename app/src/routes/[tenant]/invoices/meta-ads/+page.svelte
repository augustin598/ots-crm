<script lang="ts">
	import { getMetaAdsSpendingList, triggerMetaAdsSync, getMetaInvoiceDownloads, triggerInvoiceDownload, redownloadInvoice, deleteInvoiceDownload, getMetaTokenStatus } from '$lib/remotes/meta-ads-invoices.remote';
	import { page } from '$app/state';
	import { Card } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { Download, Eye, Trash2 } from '@lucide/svelte';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import DollarSignIcon from '@lucide/svelte/icons/dollar-sign';
	import { toast } from 'svelte-sonner';

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

	// Group spending by client
	const groupedByClient = $derived.by(() => {
		const groups = new Map<string, { clientName: string; businessName: string; rows: typeof spending }>();
		for (const row of spending) {
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
		<Button variant="outline" size="sm" onclick={handleSync} disabled={syncing}>
			{#if syncing}<RefreshCwIcon class="mr-2 h-4 w-4 animate-spin" />Sincronizare...{:else}<RefreshCwIcon class="mr-2 h-4 w-4" />Sync Acum{/if}
		</Button>
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
			{#each Array(2) as _}<Card class="p-6"><Skeleton class="h-48 w-full" /></Card>{/each}
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
		<div class="space-y-6">
			{#each groupedByClient as group}
				{@const totalSpend = group.rows.reduce((s, r) => s + (r.spendCents || 0), 0)}
				{@const totalClicks = group.rows.reduce((s, r) => s + (r.clicks || 0), 0)}
				{@const totalImpressions = group.rows.reduce((s, r) => s + (r.impressions || 0), 0)}
				{@const curr = group.rows[0]?.currencyCode || 'RON'}
				<Card class="overflow-hidden">
					<div class="border-b bg-muted/30 px-6 py-4">
						<div class="flex items-center gap-3">
							<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
								<DollarSignIcon class="h-5 w-5 text-blue-500" />
							</div>
							<div>
								<h3 class="text-lg font-semibold">{group.clientName}</h3>
								{#if group.businessName}<p class="text-sm text-muted-foreground">{group.businessName}</p>{/if}
							</div>
						</div>
					</div>

					<div class="grid grid-cols-3 divide-x border-b">
						<div class="px-6 py-4 text-center">
							<p class="text-xs text-muted-foreground uppercase tracking-wider">Total cheltuieli</p>
							<p class="text-xl font-bold mt-1">{formatAmount(totalSpend, curr)}</p>
						</div>
						<div class="px-6 py-4 text-center">
							<p class="text-xs text-muted-foreground uppercase tracking-wider">Total click-uri</p>
							<p class="text-xl font-bold mt-1">{formatNumber(totalClicks)}</p>
						</div>
						<div class="px-6 py-4 text-center">
							<p class="text-xs text-muted-foreground uppercase tracking-wider">Total impresii</p>
							<p class="text-xl font-bold mt-1">{formatNumber(totalImpressions)}</p>
						</div>
					</div>

					<div class="divide-y">
						{#each group.rows as row, i}
							{@const prevSpend = group.rows[i + 1]?.spendCents}
							{@const trend = prevSpend ? ((row.spendCents - prevSpend) / prevSpend) * 100 : null}
							{@const invoice = downloadsByKey.get(`${row.metaAdAccountId}:${row.periodStart}`)}
							<div class="flex items-center px-6 py-4 hover:bg-muted/30 transition-colors">
								<div class="flex items-center gap-3 w-44">
									<CalendarIcon class="h-4 w-4 text-muted-foreground" />
									<span class="font-medium capitalize">{formatPeriod(row.periodStart)}</span>
								</div>
								<div class="flex-1 grid grid-cols-3 gap-4 text-right">
									<div>
										<span class="text-base font-semibold">{formatAmount(row.spendCents, row.currencyCode)}</span>
										{#if trend !== null}
											<span class="ml-2 text-xs {trend >= 0 ? 'text-red-500' : 'text-green-500'}">{trend >= 0 ? '+' : ''}{trend.toFixed(1)}%</span>
										{/if}
									</div>
									<span class="text-sm text-muted-foreground">{formatNumber(row.impressions)} imp.</span>
									<span class="text-sm">{formatNumber(row.clicks)} clicks</span>
								</div>
								<div class="ml-2 border-l pl-2 w-36 flex justify-end">
									{#if invoice?.status === 'downloaded' && invoice.pdfPath}
										<Button variant="outline" size="sm" class="h-7 gap-1.5 text-xs" onclick={() => handleDownloadInvoicePDF(invoice.id, row.periodStart)}>
											<Download class="h-3.5 w-3.5" />Descarcă factura
										</Button>
									{:else if invoice?.status === 'pending'}
										<span class="text-xs text-muted-foreground">Pending...</span>
									{:else if invoice?.status === 'error'}
										<span class="text-xs text-red-500" title={invoice.errorMessage || ''}>Eroare</span>
									{:else}
										<span class="text-xs text-muted-foreground">-</span>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				</Card>
			{/each}
		</div>
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
