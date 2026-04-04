<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import * as Card from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import {
		Table, TableBody, TableCell, TableHead, TableHeader, TableRow
	} from '$lib/components/ui/table';
	import KpiCard from '$lib/components/reports/kpi-card.svelte';
	import DateRangePicker from '$lib/components/reports/date-range-picker.svelte';
	import PlatformDonutChart from '$lib/components/reports/platform-donut-chart.svelte';
	import PlatformStackedChart from '$lib/components/reports/platform-stacked-chart.svelte';
	import IconFacebook from '$lib/components/marketing/icon-facebook.svelte';
	import IconGoogleAds from '$lib/components/marketing/icon-google-ads.svelte';
	import IconTiktok from '$lib/components/marketing/icon-tiktok.svelte';
	import BarChart2Icon from '@lucide/svelte/icons/bar-chart-2';
	import DollarSignIcon from '@lucide/svelte/icons/dollar-sign';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import MousePointerClickIcon from '@lucide/svelte/icons/mouse-pointer-click';
	import PercentIcon from '@lucide/svelte/icons/percent';
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
	import TargetIcon from '@lucide/svelte/icons/target';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import AlertTriangleIcon from '@lucide/svelte/icons/alert-triangle';

	let { data }: { data: any } = $props();

	const tenantSlug = $derived(page.params.tenant as string);

	let since = $state('');
	let until = $state('');

	$effect(() => { since = data.since; until = data.until; });

	function onDateChange() {
		goto(`?since=${since}&until=${until}`, { keepFocus: true, noScroll: true });
	}

	// Helpers
	function centsToAmount(cents: number): number { return cents / 100; }
	function fmtAmount(cents: number): string {
		return (cents / 100).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' RON';
	}
	function fmtNum(n: number): string { return n.toLocaleString('ro-RO', { maximumFractionDigits: 0 }); }
	function fmtPct(n: number): string { return n.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%'; }
	function fmtDec(n: number): string { return n.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

	function pctChange(current: number, previous: number): number | undefined {
		if (previous === 0) return current > 0 ? undefined : undefined;
		return ((current - previous) / previous) * 100;
	}

	// Aggregate metrics
	const pm = $derived(data.platformMetrics);
	const totalSpend = $derived(pm.meta.spend + pm.google.spend + pm.tiktok.spend);
	const totalImpressions = $derived(pm.meta.impressions + pm.google.impressions + pm.tiktok.impressions);
	const totalClicks = $derived(pm.meta.clicks + pm.google.clicks + pm.tiktok.clicks);
	const totalConversions = $derived(pm.google.conversions + pm.tiktok.conversions); // Meta conversions from API (lazy)
	const avgCpc = $derived(totalClicks > 0 ? centsToAmount(totalSpend) / totalClicks : 0);
	const avgCtr = $derived(totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0);

	// Previous period
	const prev = $derived(data.prevMetrics);
	const prevCpc = $derived(prev.totalClicks > 0 ? centsToAmount(prev.totalSpend) / prev.totalClicks : 0);
	const prevCtr = $derived(prev.totalImpressions > 0 ? (prev.totalClicks / prev.totalImpressions) * 100 : 0);

	// Platform rows for comparison table
	const platformRows = $derived([
		{
			name: 'Meta Ads', color: 'text-blue-600', iconKey: 'meta',
			spend: pm.meta.spend, impressions: pm.meta.impressions, clicks: pm.meta.clicks,
			conversions: 0, // Meta conversions not in DB
			href: `/${tenantSlug}/reports/facebook-ads`
		},
		{
			name: 'Google Ads', color: 'text-green-600', iconKey: 'google',
			spend: pm.google.spend, impressions: pm.google.impressions, clicks: pm.google.clicks,
			conversions: pm.google.conversions,
			href: `/${tenantSlug}/reports/google-ads`
		},
		{
			name: 'TikTok Ads', color: 'text-foreground', iconKey: 'tiktok',
			spend: pm.tiktok.spend, impressions: pm.tiktok.impressions, clicks: pm.tiktok.clicks,
			conversions: pm.tiktok.conversions,
			href: `/${tenantSlug}/reports/tiktok-ads`
		}
	]);

	const platforms = $derived([
		{
			label: 'Meta Ads', description: 'Facebook & Instagram Ads',
			href: `/${tenantSlug}/reports/facebook-ads`,
			color: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
			accounts: data.metaAccounts as { accountName: string; accountId: string; isActive: boolean }[]
		},
		{
			label: 'Google Ads', description: 'Search, Display & YouTube',
			href: `/${tenantSlug}/reports/google-ads`,
			color: 'bg-green-500/10 text-green-600 dark:text-green-400',
			accounts: data.googleAccounts as { accountName: string; accountId: string; isActive: boolean }[]
		},
		{
			label: 'TikTok Ads', description: 'TikTok For Business',
			href: `/${tenantSlug}/reports/tiktok-ads`,
			color: 'bg-gray-500/10 text-foreground dark:text-gray-300',
			accounts: data.tiktokAccounts as { accountName: string; accountId: string; isActive: boolean }[]
		}
	]);

	function formatTimeAgo(date: Date | string | null): string {
		if (!date) return '';
		const d = date instanceof Date ? date : new Date(date);
		const diff = Math.floor((Date.now() - d.getTime()) / 1000);
		if (diff < 60) return 'acum câteva secunde';
		if (diff < 3600) return `acum ${Math.floor(diff / 60)} min`;
		if (diff < 86400) return `acum ${Math.floor(diff / 3600)} ore`;
		return `acum ${Math.floor(diff / 86400)} zile`;
	}
</script>

<div class="space-y-6">
	<!-- Header -->
	<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
		<div>
			<h1 class="text-3xl font-bold flex items-center gap-3">
				<BarChart2Icon class="h-8 w-8" />
				Rapoarte
			</h1>
			<p class="text-muted-foreground">Overview cross-platform advertising</p>
		</div>
		<div class="flex items-center gap-2 flex-wrap">
			<DateRangePicker bind:since bind:until onchange={onDateChange} />
			<a
				href="/api/export/spending?format=excel&platform=all&from={since}"
				download
				class="inline-flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground transition-colors"
			>
				<DownloadIcon class="h-4 w-4" />
				Export
			</a>
		</div>
	</div>

	<!-- KPI Cards -->
	<div class="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
		<KpiCard
			label="Cheltuieli totale"
			value={fmtAmount(totalSpend)}
			icon={DollarSignIcon}
			subtext="Toate platformele"
			change={pctChange(totalSpend, prev.totalSpend)}
			invertChange
		/>
		<KpiCard
			label="Impresii"
			value={fmtNum(totalImpressions)}
			icon={EyeIcon}
			subtext="Total afișări"
			change={pctChange(totalImpressions, prev.totalImpressions)}
		/>
		<KpiCard
			label="Click-uri"
			value={fmtNum(totalClicks)}
			icon={MousePointerClickIcon}
			subtext="{fmtAmount(totalSpend)} investiți"
			change={pctChange(totalClicks, prev.totalClicks)}
		/>
		<KpiCard
			label="CTR"
			value={fmtPct(avgCtr)}
			icon={PercentIcon}
			subtext="Click-through rate"
			change={pctChange(avgCtr, prevCtr)}
		/>
		<KpiCard
			label="CPC mediu"
			value={fmtDec(avgCpc) + ' RON'}
			icon={TrendingUpIcon}
			subtext="Cost per click"
			change={pctChange(avgCpc, prevCpc)}
			invertChange
		/>
		<KpiCard
			label="Conversii"
			value={totalConversions > 0 ? fmtNum(totalConversions) : '-'}
			icon={TargetIcon}
			subtext={totalConversions > 0 ? `CPA: ${fmtDec(centsToAmount(totalSpend) / totalConversions)} RON` : 'Google + TikTok'}
		/>
	</div>

	<!-- Charts -->
	<div class="grid gap-6 xl:grid-cols-3">
		<Card.Root class="p-4 xl:col-span-2">
			<h3 class="mb-4 text-lg font-semibold">Cheltuieli în timp per platformă</h3>
			<PlatformStackedChart data={data.dailySpend} />
		</Card.Root>
		<Card.Root class="p-4">
			<h3 class="mb-4 text-lg font-semibold">Distribuție buget</h3>
			<PlatformDonutChart
				meta={centsToAmount(pm.meta.spend)}
				google={centsToAmount(pm.google.spend)}
				tiktok={centsToAmount(pm.tiktok.spend)}
			/>
		</Card.Root>
	</div>

	<!-- Platform Comparison Table -->
	<Card.Root class="p-4">
		<h3 class="mb-4 text-lg font-semibold">Comparație platforme</h3>
		<div class="overflow-x-auto">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Platformă</TableHead>
						<TableHead class="text-right">Cheltuieli</TableHead>
						<TableHead class="text-right">% Buget</TableHead>
						<TableHead class="text-right">Impresii</TableHead>
						<TableHead class="text-right">Click-uri</TableHead>
						<TableHead class="text-right">CPC</TableHead>
						<TableHead class="text-right">CTR</TableHead>
						<TableHead class="text-right">Conversii</TableHead>
						<TableHead class="text-right">CPA</TableHead>
						<TableHead class="w-[40px]"></TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{#each platformRows as p}
						<TableRow>
							<TableCell class="font-medium">
								<div class="flex items-center gap-2">
									{#if p.iconKey === 'meta'}<IconFacebook class="h-5 w-5" />
									{:else if p.iconKey === 'google'}<IconGoogleAds class="h-5 w-5" />
									{:else}<IconTiktok class="h-5 w-5" />{/if}
									<span class={p.color}>{p.name}</span>
								</div>
							</TableCell>
							<TableCell class="text-right">{fmtAmount(p.spend)}</TableCell>
							<TableCell class="text-right">{totalSpend > 0 ? fmtPct((p.spend / totalSpend) * 100) : '-'}</TableCell>
							<TableCell class="text-right">{fmtNum(p.impressions)}</TableCell>
							<TableCell class="text-right">{fmtNum(p.clicks)}</TableCell>
							<TableCell class="text-right">{p.clicks > 0 ? fmtDec(centsToAmount(p.spend) / p.clicks) + ' RON' : '-'}</TableCell>
							<TableCell class="text-right">{p.impressions > 0 ? fmtPct((p.clicks / p.impressions) * 100) : '-'}</TableCell>
							<TableCell class="text-right">{p.conversions > 0 ? fmtNum(p.conversions) : '-'}</TableCell>
							<TableCell class="text-right">{p.conversions > 0 ? fmtDec(centsToAmount(p.spend) / p.conversions) + ' RON' : '-'}</TableCell>
							<TableCell>
								<a href={p.href} class="text-muted-foreground hover:text-primary">
									<ChevronRightIcon class="h-4 w-4" />
								</a>
							</TableCell>
						</TableRow>
					{/each}
					<!-- Total row -->
					<TableRow class="bg-muted/50 font-semibold border-t-2">
						<TableCell>Total</TableCell>
						<TableCell class="text-right">{fmtAmount(totalSpend)}</TableCell>
						<TableCell class="text-right">100%</TableCell>
						<TableCell class="text-right">{fmtNum(totalImpressions)}</TableCell>
						<TableCell class="text-right">{fmtNum(totalClicks)}</TableCell>
						<TableCell class="text-right">{avgCpc > 0 ? fmtDec(avgCpc) + ' RON' : '-'}</TableCell>
						<TableCell class="text-right">{avgCtr > 0 ? fmtPct(avgCtr) : '-'}</TableCell>
						<TableCell class="text-right">{totalConversions > 0 ? fmtNum(totalConversions) : '-'}</TableCell>
						<TableCell class="text-right">{totalConversions > 0 ? fmtDec(centsToAmount(totalSpend) / totalConversions) + ' RON' : '-'}</TableCell>
						<TableCell></TableCell>
					</TableRow>
				</TableBody>
			</Table>
		</div>
	</Card.Root>

	<!-- Platform quick links -->
	<div>
		<h2 class="text-lg font-semibold mb-3">Platforme</h2>
		<div class="grid gap-4 sm:grid-cols-3">
			{#each platforms as platform (platform.label)}
				<div class="rounded-lg border bg-card shadow-sm overflow-hidden">
					<a
						href={platform.href}
						class="group flex items-center justify-between p-4 hover:bg-accent/50 transition-colors"
					>
						<div class="flex items-center gap-3">
							<div class="flex h-10 w-10 items-center justify-center rounded-lg {platform.color}">
								<BarChart2Icon class="h-5 w-5" />
							</div>
							<div>
								<p class="font-semibold">{platform.label}</p>
								<p class="text-xs text-muted-foreground">{platform.description}</p>
							</div>
						</div>
						<ChevronRightIcon class="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
					</a>
					{#if platform.accounts.length > 0}
						<div class="border-t px-4 py-3 flex flex-wrap gap-1.5">
							{#each platform.accounts as account}
								<a
									href="{platform.href}?account={account.accountId}"
									class="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
								>
									<span class="relative flex h-2 w-2 shrink-0">
										{#if account.isActive}
											<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75"></span>
											<span class="relative inline-flex h-2 w-2 rounded-full bg-green-500"></span>
										{:else}
											<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-75"></span>
											<span class="relative inline-flex h-2 w-2 rounded-full bg-orange-500"></span>
										{/if}
									</span>
									{account.accountName}
								</a>
							{/each}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	</div>

	<!-- Sync errors -->
	{#if data.syncErrors.length > 0}
		<div>
			<h2 class="text-lg font-semibold mb-3 flex items-center gap-2">
				<AlertTriangleIcon class="h-5 w-5 text-destructive" />
				Erori sincronizare recente
			</h2>
			<Card.Root>
				<Card.Content class="p-0">
					<ul class="divide-y">
						{#each data.syncErrors as error}
							<li class="flex items-start gap-3 px-4 py-3">
								<AlertTriangleIcon class="h-4 w-4 text-destructive mt-0.5 shrink-0" />
								<div class="min-w-0 flex-1">
									<div class="flex items-center gap-2 flex-wrap">
										<Badge variant="outline" class="text-xs">{error.source}</Badge>
										<span class="text-xs text-muted-foreground">{formatTimeAgo(error.createdAt)}</span>
									</div>
									<p class="text-sm mt-0.5 text-foreground/80 truncate" title={error.message}>{error.message}</p>
								</div>
							</li>
						{/each}
					</ul>
				</Card.Content>
				<Card.Footer class="pt-2 pb-3">
					<a href="/{tenantSlug}/settings/logs" class="text-xs text-primary hover:underline">
						Vezi toate log-urile →
					</a>
				</Card.Footer>
			</Card.Root>
		</div>
	{/if}
</div>
