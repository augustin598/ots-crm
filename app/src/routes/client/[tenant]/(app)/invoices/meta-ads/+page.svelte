<script lang="ts">
	import { getMetaAdsSpendingList, getMetaInvoiceDownloads } from '$lib/remotes/meta-ads-invoices.remote';
	import { page } from '$app/state';
	import { Card } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { Download, Eye } from '@lucide/svelte';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import DollarSignIcon from '@lucide/svelte/icons/dollar-sign';
	import DateRangePicker from '$lib/components/reports/date-range-picker.svelte';
	import { toast } from 'svelte-sonner';

	const tenantSlug = $derived(page.params.tenant as string);

	// Date range — implicit: tot anul curent
	const currentYear = new Date().getFullYear();
	let since = $state(`${currentYear}-01-01`);
	let until = $state(`${currentYear}-12-31`);

	const spendingQuery = getMetaAdsSpendingList();
	const spending = $derived(spendingQuery.current || []);
	const loading = $derived(spendingQuery.loading);

	const invoiceDownloadsQuery = getMetaInvoiceDownloads();
	const invoiceDownloads = $derived((invoiceDownloadsQuery.current || []).filter((d: any) => d.status === 'downloaded'));

	// Map downloads by periodStart+accountId for inline display
	const downloadsByKey = $derived.by(() => {
		const map = new Map<string, typeof invoiceDownloads[0]>();
		for (const dl of invoiceDownloads) {
			const key = `${dl.metaAdAccountId}:${dl.periodStart}`;
			map.set(key, dl);
		}
		return map;
	});

	// Sort spending by period descending, filtered by date range
	const sortedSpending = $derived(
		[...spending]
			.filter((r: any) => {
				if (!r.periodStart) return true;
				const period = r.periodStart.substring(0, 7);
				const sinceMonth = since.substring(0, 7);
				const untilMonth = until.substring(0, 7);
				return period >= sinceMonth && period <= untilMonth;
			})
			.sort((a: any, b: any) => (b.periodStart || '').localeCompare(a.periodStart || ''))
	);

	const totalSpend = $derived(sortedSpending.reduce((s: number, r: any) => s + (r.spendCents || 0), 0));
	const totalClicks = $derived(sortedSpending.reduce((s: number, r: any) => s + (r.clicks || 0), 0));
	const totalImpressions = $derived(sortedSpending.reduce((s: number, r: any) => s + (r.impressions || 0), 0));
	const curr = $derived(sortedSpending[0]?.currencyCode || spending[0]?.currencyCode || 'RON');

	async function handlePreviewInvoicePDF(downloadId: string) {
		try {
			const response = await fetch(`/client/${tenantSlug}/invoices/meta-ads/downloads/${downloadId}/pdf`);
			if (!response.ok) throw new Error('Failed to load PDF');
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			window.open(url, '_blank');
		} catch (e) { toast.error(e instanceof Error ? e.message : 'Eroare la previzualizare'); }
	}

	async function handleDownloadInvoicePDF(downloadId: string, period: string) {
		try {
			const response = await fetch(`/client/${tenantSlug}/invoices/meta-ads/downloads/${downloadId}/pdf`);
			if (!response.ok) throw new Error('Failed to download PDF');
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `MetaAds-Factura-${period}.pdf`;
			a.click();
			URL.revokeObjectURL(url);
		} catch (e) { toast.error(e instanceof Error ? e.message : 'Eroare la descărcare'); }
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
</script>

<div class="space-y-6">
	<div class="flex items-start justify-between">
		<div>
			<h1 class="text-3xl font-bold flex items-center gap-3">
				<svg class="h-8 w-8" viewBox="0 0 24 24" fill="#1877F2"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
				Facturi Meta Ads
			</h1>
			<p class="text-muted-foreground">Cheltuieli lunare și documente de facturare</p>
		</div>
		<DateRangePicker bind:since bind:until />
	</div>

	{#if loading}
		<Card class="p-6"><Skeleton class="h-48 w-full" /></Card>
	{:else if sortedSpending.length === 0}
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
		<Card class="overflow-hidden">
			<div class="border-b bg-muted/30 px-6 py-4">
				<div class="flex items-center gap-3">
					<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
						<DollarSignIcon class="h-5 w-5 text-blue-500" />
					</div>
					<div>
						<h3 class="text-lg font-semibold">Cheltuieli Meta Ads</h3>
						<p class="text-sm text-muted-foreground">Ultimele {sortedSpending.length} luni</p>
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
				{#each sortedSpending as row, i}
					{@const prevSpend = sortedSpending[i + 1]?.spendCents}
					{@const trend = prevSpend ? ((row.spendCents - prevSpend) / prevSpend) * 100 : null}
					{@const invoice = downloadsByKey.get(`${row.metaAdAccountId}:${row.periodStart}`)}
					<div class="grid grid-cols-5 gap-2 px-6 py-4 hover:bg-muted/30 transition-colors items-center">
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
							{#if invoice?.pdfPath}
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
		</Card>
	{/if}

</div>
