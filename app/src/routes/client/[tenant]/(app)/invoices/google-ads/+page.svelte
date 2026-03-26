<script lang="ts">
	import { getGoogleAdsInvoices, getMyGoogleAdsMonthlySpend } from '$lib/remotes/google-ads-invoices.remote';
	import { page } from '$app/state';
	import {
		Table, TableBody, TableCell, TableHead, TableHeader, TableRow
	} from '$lib/components/ui/table';
	import { Card } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { Download, Eye, ExternalLink } from '@lucide/svelte';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
	import DollarSignIcon from '@lucide/svelte/icons/dollar-sign';
	import IconGoogleAds from '$lib/components/marketing/icon-google-ads.svelte';
	import DateRangePicker from '$lib/components/reports/date-range-picker.svelte';
	import { getDefaultDateRange } from '$lib/utils/report-helpers';

	const tenantSlug = $derived(page.params.tenant as string);

	// Date range
	const defaults = getDefaultDateRange();
	let since = $state(defaults.since);
	let until = $state(defaults.until);

	const invoicesQuery = getGoogleAdsInvoices();
	const invoices = $derived(invoicesQuery.current || []);
	const loading = $derived(invoicesQuery.loading);

	let monthlySpendQuery = $state<ReturnType<typeof getMyGoogleAdsMonthlySpend> | null>(null);
	const monthlySpend = $derived(monthlySpendQuery?.current || []);
	const monthlyLoading = $derived(monthlySpendQuery?.loading ?? true);

	$effect(() => {
		if (since && until) {
			monthlySpendQuery = getMyGoogleAdsMonthlySpend({ since, until });
		}
	});

	function formatMonth(month: string): string {
		try {
			const parts = month.split('-');
			const d = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
			return isNaN(d.getTime()) ? month : d.toLocaleDateString('ro-RO', { month: 'long', year: 'numeric' });
		} catch { return month; }
	}

	function formatCurr(value: number, currency: string): string {
		return new Intl.NumberFormat('ro-RO', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
	}

	function formatAmount(micros: number | null, currency: string): string {
		if (micros == null) return '-';
		return formatCurr(micros / 1_000_000, currency);
	}

	function formatDate(date: Date | string | null): string {
		if (!date) return '-';
		try {
			const d = date instanceof Date ? date : new Date(date);
			return d.toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', year: 'numeric' });
		} catch { return '-'; }
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

	function findInvoiceForMonth(monthStr: string) {
		const targetMonth = monthStr.substring(0, 7);
		return invoices.find(inv => {
			const invMonth = getInvoiceMonth(inv.issueDate);
			return invMonth === targetMonth;
		});
	}

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
			alert(e instanceof Error ? e.message : 'Failed to download PDF');
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
			alert(e instanceof Error ? e.message : 'Failed to preview PDF');
		}
	}
</script>

<div class="space-y-6">
	<!-- Header -->
	<div class="flex items-start justify-between">
		<div>
			<h1 class="text-3xl font-bold flex items-center gap-3">
				<IconGoogleAds class="h-8 w-8" />
				Facturi Google Ads
			</h1>
			<p class="text-muted-foreground">Cheltuieli lunare și documente de facturare</p>
		</div>
		<DateRangePicker bind:since bind:until />
	</div>

	<!-- Monthly Spend -->
	{#if monthlyLoading}
		<Card class="p-6"><Skeleton class="h-48 w-full" /></Card>
	{:else if monthlySpend.length > 0}
		<div class="space-y-6">
			{#each monthlySpend as account}
				{#if account.months.length > 0}
					{@const totalSpend = account.months.reduce((s, m) => s + m.spend, 0)}
					{@const totalClicks = account.months.reduce((s, m) => s + m.clicks, 0)}
					{@const totalConv = account.months.reduce((s, m) => s + m.conversions, 0)}
					{@const curr = account.months[0]?.currencyCode || 'USD'}
					<Card class="overflow-hidden">
						<div class="border-b bg-muted/30 px-6 py-4">
							<div class="flex items-center justify-between">
								<div class="flex items-center gap-3">
									<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
										<DollarSignIcon class="h-5 w-5 text-primary" />
									</div>
									<div>
										<h3 class="text-lg font-semibold">{account.accountName}</h3>
										<p class="text-sm text-muted-foreground">Cheltuieli din {account.months.length} {account.months.length === 1 ? 'lună' : 'luni'}</p>
									</div>
								</div>
								<div class="flex items-center gap-3">
									<p class="text-sm text-muted-foreground">Poți descărca factura conectându-te la contul <strong>{account.clientEmail}</strong></p>
									<a href="https://ads.google.com/aw/billing/documents" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-2 rounded-lg border bg-background px-4 py-2 text-sm font-medium hover:bg-muted transition-colors shrink-0">
										<ExternalLink class="h-4 w-4" />
										Descarcă facturi
									</a>
								</div>
							</div>
						</div>

						<div class="grid grid-cols-3 divide-x border-b">
							<div class="px-6 py-4 text-center">
								<p class="text-xs text-muted-foreground uppercase tracking-wider">Total cheltuieli</p>
								<p class="text-xl font-bold mt-1">{formatCurr(totalSpend, curr)}</p>
							</div>
							<div class="px-6 py-4 text-center">
								<p class="text-xs text-muted-foreground uppercase tracking-wider">Total click-uri</p>
								<p class="text-xl font-bold mt-1">{totalClicks.toLocaleString('ro-RO')}</p>
							</div>
							<div class="px-6 py-4 text-center">
								<p class="text-xs text-muted-foreground uppercase tracking-wider">Total conversii</p>
								<p class="text-xl font-bold mt-1">{totalConv.toLocaleString('ro-RO')}</p>
							</div>
						</div>

						<div class="divide-y">
							{#each account.months as m, i}
								{@const prevSpend = account.months[i + 1]?.spend}
								{@const trend = prevSpend ? ((m.spend - prevSpend) / prevSpend) * 100 : null}
								{@const monthInvoice = findInvoiceForMonth(m.month)}
								<div class="grid grid-cols-6 gap-2 px-6 py-4 hover:bg-muted/30 transition-colors items-center">
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
					</Card>
				{/if}
			{/each}
		</div>
	{/if}


	{#if !monthlyLoading && !loading && monthlySpend.length === 0 && invoices.length === 0}
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
	{/if}
</div>
