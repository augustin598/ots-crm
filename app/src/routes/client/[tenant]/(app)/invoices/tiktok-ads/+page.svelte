<script lang="ts">
	import { getTiktokAdsSpendingList, getTiktokInvoiceDownloads } from '$lib/remotes/tiktok-ads.remote';
	import { page } from '$app/state';
	import { Card } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { Download, Eye } from '@lucide/svelte';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import DollarSignIcon from '@lucide/svelte/icons/dollar-sign';
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
	import { toast } from 'svelte-sonner';

	const tenantSlug = $derived(page.params.tenant as string);

	const spendingQuery = getTiktokAdsSpendingList();
	const spending = $derived(spendingQuery.current || []);
	const loading = $derived(spendingQuery.loading);

	const invoiceDownloadsQuery = getTiktokInvoiceDownloads();
	const invoiceDownloads = $derived((invoiceDownloadsQuery.current || []).filter((d: any) => d.status === 'downloaded'));

	const sortedSpending = $derived(
		[...spending].sort((a: any, b: any) => (b.periodStart || '').localeCompare(a.periodStart || ''))
	);

	const totalSpend = $derived(spending.reduce((s: number, r: any) => s + (r.spendCents || 0), 0));
	const totalClicks = $derived(spending.reduce((s: number, r: any) => s + (r.clicks || 0), 0));
	const totalConversions = $derived(spending.reduce((s: number, r: any) => s + (r.conversions || 0), 0));
	const curr = $derived(spending[0]?.currencyCode || 'RON');

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
		} catch (e) { toast.error(e instanceof Error ? e.message : 'Eroare la descărcare'); }
	}

	async function handlePreviewPDF(id: string) {
		try {
			const response = await fetch(`/client/${tenantSlug}/invoices/tiktok-ads/${id}/pdf`);
			if (!response.ok) throw new Error('Failed to load PDF');
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			window.open(url, '_blank');
		} catch (e) { toast.error(e instanceof Error ? e.message : 'Eroare la previzualizare'); }
	}

	async function handlePreviewInvoicePDF(downloadId: string) {
		try {
			const response = await fetch(`/client/${tenantSlug}/invoices/tiktok-ads/downloads/${downloadId}/pdf`);
			if (!response.ok) throw new Error('Failed to load PDF');
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			window.open(url, '_blank');
		} catch (e) { toast.error(e instanceof Error ? e.message : 'Eroare la previzualizare'); }
	}

	async function handleDownloadInvoicePDF(downloadId: string, period: string) {
		try {
			const response = await fetch(`/client/${tenantSlug}/invoices/tiktok-ads/downloads/${downloadId}/pdf`);
			if (!response.ok) throw new Error('Failed to download PDF');
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `TikTokAds-Factura-${period}.pdf`;
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
	<div>
		<h1 class="text-3xl font-bold flex items-center gap-3">
			<svg class="h-8 w-8" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.34-6.34V8.75a8.16 8.16 0 004.76 1.52V6.84a4.84 4.84 0 01-1-.15z"/></svg>
			Facturi TikTok Ads
		</h1>
		<p class="text-muted-foreground">Cheltuieli lunare și documente de facturare</p>
	</div>

	{#if loading}
		<Card class="p-6"><Skeleton class="h-48 w-full" /></Card>
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
		<Card class="overflow-hidden">
			<div class="border-b bg-muted/30 px-6 py-4">
				<div class="flex items-center gap-3">
					<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
						<DollarSignIcon class="h-5 w-5 text-primary" />
					</div>
					<div>
						<h3 class="text-lg font-semibold">Cheltuieli TikTok Ads</h3>
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
					<p class="text-xs text-muted-foreground uppercase tracking-wider">Total conversii</p>
					<p class="text-xl font-bold mt-1">{formatNumber(totalConversions)}</p>
				</div>
			</div>

			<div class="divide-y">
				{#each sortedSpending as row, i}
					{@const prevSpend = sortedSpending[i + 1]?.spendCents}
					{@const trend = prevSpend ? ((row.spendCents - prevSpend) / prevSpend) * 100 : null}
					<div class="flex items-center px-6 py-4 hover:bg-muted/30 transition-colors">
						<div class="flex items-center gap-3 w-48">
							<CalendarIcon class="h-4 w-4 text-muted-foreground" />
							<span class="font-medium capitalize">{formatPeriod(row.periodStart)}</span>
						</div>
						<div class="flex-1 grid grid-cols-4 gap-4 text-right">
							<div>
								<span class="text-base font-semibold">{formatAmount(row.spendCents, row.currencyCode)}</span>
								{#if trend !== null}
									<span class="ml-2 text-xs {trend >= 0 ? 'text-red-500' : 'text-green-500'}">{trend >= 0 ? '+' : ''}{trend.toFixed(1)}%</span>
								{/if}
							</div>
							<span class="text-sm text-muted-foreground">{formatNumber(row.impressions)} imp.</span>
							<span class="text-sm">{formatNumber(row.clicks)} clicks</span>
							<div class="flex items-center justify-end gap-1.5">
								<TrendingUpIcon class="h-3.5 w-3.5 text-primary" />
								<span class="text-sm font-medium">{formatNumber(row.conversions)} conv.</span>
							</div>
						</div>
						<div class="flex items-center gap-1 ml-4">
							{#if row.pdfPath}
								<Button variant="ghost" size="icon" class="h-8 w-8" onclick={() => handlePreviewPDF(row.id)} title="Preview"><Eye class="h-4 w-4" /></Button>
								<Button variant="ghost" size="icon" class="h-8 w-8" onclick={() => handleDownloadPDF(row.id, row.periodStart)} title="Download"><Download class="h-4 w-4" /></Button>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		</Card>
	{/if}

	{#if invoiceDownloads.length > 0}
		<Card class="overflow-hidden">
			<div class="border-b bg-muted/30 px-6 py-4">
				<h2 class="text-lg font-semibold">Facturi PDF TikTok</h2>
				<p class="text-sm text-muted-foreground">Facturi oficiale din TikTok Business Center</p>
			</div>
			<div class="divide-y">
				{#each invoiceDownloads as dl}
					<div class="flex items-center justify-between px-6 py-3 hover:bg-muted/30 transition-colors">
						<div class="flex items-center gap-3">
							<CalendarIcon class="h-4 w-4 text-muted-foreground" />
							<div>
								<span class="font-medium">{dl.adAccountName || dl.tiktokAdvertiserId}</span>
								{#if dl.invoiceNumber}<span class="text-sm text-muted-foreground ml-2">#{dl.invoiceNumber}</span>{/if}
							</div>
							<span class="text-sm text-muted-foreground">{formatPeriod(dl.periodStart)}</span>
							{#if dl.amountCents}<span class="text-sm font-semibold">{formatAmount(dl.amountCents, dl.currencyCode || 'RON')}</span>{/if}
						</div>
						<div class="flex items-center gap-1">
							<Button variant="ghost" size="icon" class="h-8 w-8" onclick={() => handlePreviewInvoicePDF(dl.id)} title="Preview"><Eye class="h-4 w-4" /></Button>
							<Button variant="ghost" size="icon" class="h-8 w-8" onclick={() => handleDownloadInvoicePDF(dl.id, dl.periodStart)} title="Download"><Download class="h-4 w-4" /></Button>
						</div>
					</div>
				{/each}
			</div>
		</Card>
	{/if}
</div>
