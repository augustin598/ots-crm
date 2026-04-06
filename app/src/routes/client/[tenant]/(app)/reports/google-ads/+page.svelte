<script lang="ts">
	import { getMyGoogleAdAccount, getGoogleCampaignInsights, getGoogleActiveCampaigns, getGoogleAdGroupInsights, getGoogleConversionActions, getGoogleCampaignConversionActions } from '$lib/remotes/google-reports.remote';
	import * as Popover from '$lib/components/ui/popover';
	import { page } from '$app/state';
	import {
		Table, TableBody, TableCell, TableHead, TableHeader, TableRow
	} from '$lib/components/ui/table';
	import { Card } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import KpiCard from '$lib/components/reports/kpi-card.svelte';
	import DateRangePicker from '$lib/components/reports/date-range-picker.svelte';
	import SpendChart from '$lib/components/reports/spend-chart.svelte';
	import ConversionsChart from '$lib/components/reports/conversions-chart.svelte';
	import GoogleDemographicsSection from '$lib/components/reports/google-demographics-section.svelte';
	import IconGoogleAds from '$lib/components/marketing/icon-google-ads.svelte';
	import DollarSignIcon from '@lucide/svelte/icons/dollar-sign';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import MousePointerClickIcon from '@lucide/svelte/icons/mouse-pointer-click';
	import PercentIcon from '@lucide/svelte/icons/percent';
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import ArrowUpDownIcon from '@lucide/svelte/icons/arrow-up-down';
	import ColumnsIcon from '@lucide/svelte/icons/columns-3';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import LoaderIcon from '@lucide/svelte/icons/loader';
	import SearchIcon from '@lucide/svelte/icons/search';
	import MonitorIcon from '@lucide/svelte/icons/monitor';
	import PlayIcon from '@lucide/svelte/icons/play';
	import ShoppingCartIcon from '@lucide/svelte/icons/shopping-cart';
	import ZapIcon from '@lucide/svelte/icons/zap';
	import TargetIcon from '@lucide/svelte/icons/target';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import { toast } from 'svelte-sonner';
	import {
		formatCurrency, formatPercent, formatNumber, getDefaultDateRange, computeTotals
	} from '$lib/utils/report-helpers';
	import {
		aggregateGoogleInsightsByDate, aggregateGoogleInsightsByCampaign, aggregateGoogleInsightsByAdGroup,
		computeGoogleTotals, getGoogleChannelKpiCards,
		type GoogleCampaignAggregate, type GoogleAdGroupAggregate
	} from '$lib/utils/google-report-helpers';
	import { GOOGLE_COLUMN_PRESETS, GOOGLE_DEFAULT_PRESET, getGooglePreset, GOOGLE_CHANNEL_PRESET_MAP } from '$lib/utils/google-column-presets';
	import { getGoogleChartsForChannel } from '$lib/utils/google-chart-config';
	import DynamicChart from '$lib/components/reports/dynamic-chart.svelte';

	const defaults = getDefaultDateRange();
	let since = $state(defaults.since);
	let until = $state(defaults.until);

	const accountsQuery = getMyGoogleAdAccount();
	const accounts = $derived(accountsQuery.current || []);
	const accountsLoading = $derived(accountsQuery.loading);

	let selectedCustomerId = $state<string>('');
	$effect(() => {
		if (accounts.length > 0 && !selectedCustomerId) {
			const urlAccount = page.url.searchParams.get('account');
			const match = urlAccount && accounts.find((a: any) => a.googleAdsCustomerId === urlAccount);
			selectedCustomerId = match ? match.googleAdsCustomerId : accounts[0].googleAdsCustomerId;
		}
	});

	const selectedCurrency = $derived.by(() => {
		const account = accounts.find((a: any) => a.googleAdsCustomerId === selectedCustomerId);
		return account?.currency || 'USD';
	});

	function handleAccountChange(e: Event) {
		selectedCustomerId = (e.target as HTMLSelectElement).value;
		selectedCampaigns = new Set();
		currentPage = 1;
	}

	let insightsQuery = $state<ReturnType<typeof getGoogleCampaignInsights> | null>(null);
	let campaignsQuery = $state<ReturnType<typeof getGoogleActiveCampaigns> | null>(null);
	let convActionsQuery = $state<ReturnType<typeof getGoogleConversionActions> | null>(null);
	let campaignConvQuery = $state<ReturnType<typeof getGoogleCampaignConversionActions> | null>(null);

	$effect(() => {
		if (selectedCustomerId && since && until) {
			insightsQuery = getGoogleCampaignInsights({ customerId: selectedCustomerId, since, until });
			campaignsQuery = getGoogleActiveCampaigns({ customerId: selectedCustomerId });
			convActionsQuery = getGoogleConversionActions({ customerId: selectedCustomerId, since, until });
			campaignConvQuery = getGoogleCampaignConversionActions({ customerId: selectedCustomerId, since, until });
		}
	});

	const insights = $derived(insightsQuery?.current || []);
	const insightsLoading = $derived(insightsQuery?.loading ?? false);
	const insightsError = $derived(insightsQuery?.error);
	const campaigns = $derived(campaignsQuery?.current || []);
	const conversionActions = $derived(convActionsQuery?.current || []);
	const campaignConversions = $derived(campaignConvQuery?.current || {} as Record<string, Array<{ name: string; conversions: number; conversionValue: number }>>);

	let selectedCampaigns = $state<Set<string>>(new Set());
	// Channel type filter
	let channelFilter = $state<string>('all');
	const CHANNEL_TYPES = [
		{ key: 'all', label: 'Toate' },
		{ key: 'SEARCH', label: 'Search' },
		{ key: 'SHOPPING', label: 'Shopping' },
		{ key: 'DISPLAY', label: 'Display' },
		{ key: 'PERFORMANCE_MAX', label: 'PMax' },
		{ key: 'VIDEO', label: 'Video' },
		{ key: 'DEMAND_GEN', label: 'Demand Gen' }
	];

	const filteredInsights = $derived.by(() => {
		let result = insights;
		if (channelFilter !== 'all') {
			result = result.filter((i: any) => i.channelType === channelFilter);
		}
		if (selectedCampaigns.size > 0) {
			result = result.filter((i: any) => selectedCampaigns.has(i.campaignId));
		}
		return result;
	});
	const campaignData = $derived(aggregateGoogleInsightsByCampaign(insights));
	const dailyData = $derived(aggregateGoogleInsightsByDate(filteredInsights));
	const totals = $derived(computeGoogleTotals(dailyData));

	const availableChannels = $derived(
		CHANNEL_TYPES.filter(ct => ct.key === 'all' || campaignData.some(c => c.channelType === ct.key))
	);
	const dominantChannel = $derived(channelFilter !== 'all' ? channelFilter : '');
	const channelKpis = $derived(getGoogleChannelKpiCards(dominantChannel, totals, selectedCurrency));
	const chartSpecs = $derived(getGoogleChartsForChannel(dominantChannel));

	const KPI_ICON_MAP: Record<string, any> = {
		'target': TargetIcon, 'dollar-sign': DollarSignIcon, 'percent': PercentIcon,
		'mouse-pointer-click': MousePointerClickIcon, 'eye': EyeIcon, 'trending-up': TrendingUpIcon,
		'shopping-cart': ShoppingCartIcon
	};

	const resultKpi = $derived.by(() => {
		const withResults = campaignData.filter(c => c.conversions > 0);
		if (withResults.length === 0) return { label: 'Conversii', value: '-', subtext: 'Fără date' };
		const totalResults = withResults.reduce((s, c) => s + c.conversions, 0);
		const totalSpend = withResults.reduce((s, c) => s + c.spend, 0);
		const costPer = totalResults > 0 ? totalSpend / totalResults : 0;
		return {
			label: 'Conversii',
			value: formatNumber(totalResults),
			subtext: totalResults > 0 ? `${formatCurrency(costPer, selectedCurrency)} Cost/conversie` : 'Fără date'
		};
	});

	const campaignTableData = $derived.by(() => {
		const insightMap = new Map(campaignData.map(c => [c.campaignId, c]));
		const result: Array<GoogleCampaignAggregate & { status: string; dailyBudget: string | null; startDate: string | null; endDate: string | null }> = [];

		for (const ci of campaigns) {
			const insight = insightMap.get(ci.campaignId);
			if (insight) {
				result.push({ ...insight, status: ci.status, dailyBudget: ci.dailyBudget || null, startDate: ci.startDate, endDate: ci.endDate });
				insightMap.delete(ci.campaignId);
			} else if (ci.status === 'ACTIVE') {
				result.push({
					campaignId: ci.campaignId, campaignName: ci.campaignName, channelType: ci.channelType,
					spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0,
					cpc: 0, cpm: 0, ctr: 0, costPerConversion: 0, conversionRate: 0, roas: 0, videoViews: 0,
					resultType: '', cpaLabel: 'CPA',
					status: ci.status, dailyBudget: ci.dailyBudget || null, startDate: ci.startDate, endDate: ci.endDate
				});
			}
		}
		for (const [, c] of insightMap) {
			result.push({ ...c, status: 'UNKNOWN', dailyBudget: null, startDate: null, endDate: null });
		}
		return result;
	});

	let statusFilter = $state<'all' | 'active' | 'paused'>('all');
	const STATUS_FILTERS: { key: typeof statusFilter; label: string; activeClass: string }[] = [
		{ key: 'all', label: 'Toate', activeClass: 'bg-primary text-primary-foreground' },
		{ key: 'active', label: 'Active', activeClass: 'bg-green-600 text-white' },
		{ key: 'paused', label: 'Paused', activeClass: 'bg-amber-500 text-white' },
	];
	const filteredCampaigns = $derived.by(() => {
		let result = campaignTableData;
		if (channelFilter !== 'all') {
			result = result.filter(c => c.channelType === channelFilter);
		}
		if (statusFilter === 'active') return result.filter(c => c.status === 'ACTIVE');
		if (statusFilter === 'paused') return result.filter(c => c.status === 'PAUSED');
		return result;
	});

	let sortColumn = $state<keyof GoogleCampaignAggregate | 'status'>('status');
	let sortDirection = $state<'asc' | 'desc'>('asc');
	const STATUS_ORDER: Record<string, number> = { ACTIVE: 0, PAUSED: 1, UNKNOWN: 2 };

	const sortedCampaigns = $derived(
		[...filteredCampaigns].sort((a, b) => {
			const dir = sortDirection === 'asc' ? 1 : -1;
			if (sortColumn === 'status') {
				const sa = STATUS_ORDER[a.status] ?? 9;
				const sb = STATUS_ORDER[b.status] ?? 9;
				if (sa !== sb) return dir * (sa - sb);
				return b.spend - a.spend;
			}
			const av = a[sortColumn as keyof typeof a];
			const bv = b[sortColumn as keyof typeof b];
			if (typeof av === 'string' && typeof bv === 'string') return dir * av.localeCompare(bv);
			if (typeof av === 'number' && typeof bv === 'number') return dir * (av - bv);
			return 0;
		})
	);

	let selectedPresetKey = $state(GOOGLE_DEFAULT_PRESET);
	const activePreset = $derived(getGooglePreset(selectedPresetKey));

	$effect(() => {
		if (channelFilter !== 'all' && GOOGLE_CHANNEL_PRESET_MAP[channelFilter]) {
			selectedPresetKey = GOOGLE_CHANNEL_PRESET_MAP[channelFilter];
		}
	});

	let pageSize = $state(25);
	let currentPage = $state(1);
	const totalEntries = $derived(sortedCampaigns.length);
	const totalPages = $derived(Math.max(1, Math.ceil(totalEntries / pageSize)));
	const safePage = $derived(Math.min(Math.max(1, currentPage), totalPages));
	const startIndex = $derived((safePage - 1) * pageSize);
	const endIndex = $derived(Math.min(startIndex + pageSize, totalEntries));
	const paginatedCampaigns = $derived(sortedCampaigns.slice(startIndex, endIndex));

	$effect(() => { if (currentPage > totalPages) currentPage = totalPages; });

	// Channel type config
	const CHANNEL_CONFIG: Record<string, { label: string; icon: any; color: string }> = {
		SEARCH: { label: 'Search', icon: SearchIcon, color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
		DISPLAY: { label: 'Display', icon: MonitorIcon, color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' },
		VIDEO: { label: 'Video', icon: PlayIcon, color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
		SHOPPING: { label: 'Shopping', icon: ShoppingCartIcon, color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
		PERFORMANCE_MAX: { label: 'PMax', icon: ZapIcon, color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
		DEMAND_GEN: { label: 'Demand Gen', icon: TargetIcon, color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
	};
	function getChannelConfig(ch: string) {
		return CHANNEL_CONFIG[ch] || { label: ch, icon: TargetIcon, color: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400' };
	}

	// Expandable ad groups
	let expandedCampaigns = $state<Set<string>>(new Set());
	let adGroupData = $state<Map<string, GoogleAdGroupAggregate[]>>(new Map());
	let adGroupLoading = $state<Set<string>>(new Set());

	async function toggleExpand(campaignId: string) {
		const next = new Set(expandedCampaigns);
		if (next.has(campaignId)) { next.delete(campaignId); expandedCampaigns = next; return; }
		next.add(campaignId);
		expandedCampaigns = next;

		if (!adGroupData.has(campaignId) && selectedCustomerId) {
			const loadingNext = new Set(adGroupLoading); loadingNext.add(campaignId); adGroupLoading = loadingNext;
			try {
				const query = getGoogleAdGroupInsights({ customerId: selectedCustomerId, campaignId, since, until });
				const checkInterval = setInterval(() => {
					if (!query.loading) {
						clearInterval(checkInterval);
						const loadDone = new Set(adGroupLoading); loadDone.delete(campaignId); adGroupLoading = loadDone;
						if (query.current) {
							const aggregated = aggregateGoogleInsightsByAdGroup(query.current);
							const newMap = new Map(adGroupData); newMap.set(campaignId, aggregated); adGroupData = newMap;
						}
					}
				}, 100);
			} catch { const loadDone = new Set(adGroupLoading); loadDone.delete(campaignId); adGroupLoading = loadDone; }
		}
	}

	function handleSort(column: typeof sortColumn) {
		if (sortColumn === column) { sortDirection = sortDirection === 'asc' ? 'desc' : 'asc'; }
		else { sortColumn = column; sortDirection = 'desc'; }
		currentPage = 1;
	}

	function handleRefresh() {
		if (selectedCustomerId && since && until) {
			insightsQuery = getGoogleCampaignInsights({ customerId: selectedCustomerId, since, until });
			campaignsQuery = getGoogleActiveCampaigns({ customerId: selectedCustomerId });
			convActionsQuery = getGoogleConversionActions({ customerId: selectedCustomerId, since, until });
			toast.success('Se reîncarcă datele...');
		}
	}

	function getStatusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' {
		switch (status) { case 'ACTIVE': return 'success'; case 'PAUSED': return 'warning'; default: return 'outline'; }
	}

	const allSelected = $derived(paginatedCampaigns.length > 0 && paginatedCampaigns.every(c => selectedCampaigns.has(c.campaignId)));
	const someSelected = $derived(paginatedCampaigns.some(c => selectedCampaigns.has(c.campaignId)));
	function toggleSelectAll() { if (allSelected) { selectedCampaigns = new Set(); } else { selectedCampaigns = new Set(paginatedCampaigns.map(c => c.campaignId)); } }
	function toggleSelect(id: string) { const next = new Set(selectedCampaigns); if (next.has(id)) next.delete(id); else next.add(id); selectedCampaigns = next; }
</script>

<div class="space-y-6">
	<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
		<div>
			<h1 class="text-3xl font-bold flex items-center gap-3">
				<IconGoogleAds class="h-8 w-8" />
				Google Ads
			</h1>
			<p class="text-muted-foreground">Rapoarte performanță campanii Google Ads</p>
		</div>
		<div class="flex flex-wrap items-center gap-2">
			<DateRangePicker bind:since bind:until onchange={() => { currentPage = 1; }} />
			{#if accounts.length > 0}
				<select class="h-9 rounded-md border border-input bg-background px-3 text-sm" value={selectedCustomerId} onchange={handleAccountChange}>
					{#each accounts as account}
						<option value={account.googleAdsCustomerId}>
							{account.accountName || account.googleAdsCustomerId}
						</option>
					{/each}
				</select>
			{/if}
			<Button variant="outline" size="sm" onclick={handleRefresh}><RefreshCwIcon class="h-4 w-4" /></Button>
		</div>
	</div>

	{#if accountsLoading}
		<div class="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
			{#each Array(5) as _}<Card class="p-4"><div class="flex items-center gap-3"><Skeleton class="h-12 w-12 rounded-lg" /><div class="space-y-2"><Skeleton class="h-3 w-20" /><Skeleton class="h-6 w-24" /></div></div></Card>{/each}
		</div>
	{:else if accounts.length === 0}
		<Card class="p-8 text-center">
			<p class="text-muted-foreground">Nu există cont Google Ads asociat acestui client.</p>
		</Card>
	{:else if insightsError}
		<Card class="p-8">
			<div class="rounded-md bg-red-50 p-4 space-y-2">
				<p class="text-sm font-medium text-red-800">{insightsError instanceof Error ? insightsError.message : 'Eroare la încărcarea datelor'}</p>
			</div>
		</Card>
	{:else}
		<!-- Channel type filter -->
		{#if availableChannels.length > 2}
			<div class="flex items-center gap-1.5 rounded-lg border p-0.5 w-fit">
				{#each availableChannels as ct (ct.key)}
					<button
						class="px-3 py-1 text-xs rounded-md transition-colors {channelFilter === ct.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}"
						onclick={() => { channelFilter = ct.key; currentPage = 1; selectedCampaigns = new Set(); }}
					>{ct.label}</button>
				{/each}
			</div>
		{/if}

		{#if insightsLoading}
			<div class="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
				{#each Array(5) as _}<Card class="p-4"><div class="flex items-center gap-3"><Skeleton class="h-12 w-12 rounded-lg" /><div class="space-y-2"><Skeleton class="h-3 w-20" /><Skeleton class="h-6 w-24" /></div></div></Card>{/each}
			</div>
		{:else}
			<div class="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
				{#if channelKpis.length > 0}
					{#each channelKpis as kpi (kpi.key)}
						<KpiCard
							label={kpi.label}
							value={kpi.value}
							icon={KPI_ICON_MAP[kpi.icon] || TrendingUpIcon}
							subtext={kpi.subtext}
							change={kpi.change}
							invertChange={kpi.invertChange}
						/>
					{/each}
				{:else}
					<KpiCard label="Cheltuieli totale" value={formatCurrency(totals.totalSpend, selectedCurrency)} icon={DollarSignIcon} subtext="{formatNumber(totals.totalImpressions)} impresii" />
					<KpiCard label="CPM" value={formatCurrency(totals.avgCpm, selectedCurrency)} icon={EyeIcon} subtext="Cost per 1000 impresii" />
					<KpiCard label="CPC" value={formatCurrency(totals.avgCpc, selectedCurrency)} icon={MousePointerClickIcon} subtext="{formatNumber(totals.totalClicks)} click-uri" />
					<KpiCard label="CTR" value={formatPercent(totals.avgCtr)} icon={PercentIcon} subtext="Click-through rate" />
				{/if}
			</div>
		{/if}

		{#if !insightsLoading}
			{@const totalConv = conversionActions.reduce((s: number, a: any) => s + a.conversions, 0) || resultKpi.value !== '-' ? Number(resultKpi.value.replace(/\./g, '').replace(',', '.')) || 0 : 0}
			{@const COLORS = ['bg-blue-500', 'bg-emerald-500', 'bg-amber-500', 'bg-purple-500', 'bg-rose-500', 'bg-cyan-500', 'bg-orange-500', 'bg-indigo-500']}
			<Card class="p-6">
				<div class="flex items-center justify-between mb-5">
					<div class="flex items-center gap-4">
						<div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10">
							<TrendingUpIcon class="h-6 w-6 text-primary" />
						</div>
						<div>
							<p class="text-base text-muted-foreground">Conversii</p>
							<p class="text-3xl font-bold">{resultKpi.value}</p>
						</div>
					</div>
					{#if resultKpi.subtext && resultKpi.subtext !== 'Fără date'}
						<span class="text-xl font-semibold">{resultKpi.subtext}</span>
					{/if}
				</div>
				{#if conversionActions.length > 0}
					{@const convTotal = conversionActions.reduce((s: number, a: any) => s + a.conversions, 0)}
					<div class="flex h-3 w-full rounded-full overflow-hidden mb-5 bg-muted">
						{#each conversionActions as action, i}
							{@const pct = convTotal > 0 ? (action.conversions / convTotal) * 100 : 0}
							<div class="{COLORS[i % COLORS.length]} transition-all" style="width: {pct}%" title="{action.name}: {action.conversions}"></div>
						{/each}
					</div>
					<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
						{#each conversionActions as action, i}
							{@const pct = convTotal > 0 ? (action.conversions / convTotal) * 100 : 0}
							<div class="flex items-center gap-3 rounded-lg border p-4">
								<div class="h-4 w-4 rounded-full shrink-0 {COLORS[i % COLORS.length]}"></div>
								<div class="min-w-0 flex-1">
									<p class="text-base font-medium truncate" title={action.name}>{action.name}</p>
									<div class="flex items-baseline gap-2">
										<span class="text-2xl font-bold">{action.conversions}</span>
										<span class="text-sm text-muted-foreground">{pct.toFixed(1)}%</span>
									</div>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</Card>
		{/if}

		{#if !insightsLoading && dailyData.length > 0}
			<div class="grid gap-6 xl:grid-cols-2">
				{#each chartSpecs as spec (spec.title + dominantChannel)}
					<Card class="p-4">
						{#key channelFilter}
							<h3 class="mb-4 text-lg font-semibold">{spec.title}</h3>
							<DynamicChart data={dailyData} {spec} currency={selectedCurrency} />
						{/key}
					</Card>
				{/each}
			</div>
		{/if}

		{#if !insightsLoading && selectedCustomerId}
			<GoogleDemographicsSection customerId={selectedCustomerId} {since} {until} currency={selectedCurrency} />
		{/if}

		{#if !insightsLoading}
			<div class="space-y-4">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-3">
						<h3 class="text-lg font-semibold">Performanță campanii</h3>
						<div class="flex items-center gap-1 rounded-lg border p-0.5">
							{#each STATUS_FILTERS as sf}
								<button class="px-3 py-1 text-xs rounded-md transition-colors {statusFilter === sf.key ? sf.activeClass : 'text-muted-foreground hover:text-foreground'}" onclick={() => { statusFilter = sf.key; currentPage = 1; selectedCampaigns = new Set(); }}>{sf.label}</button>
							{/each}
						</div>
					</div>
					<div class="flex items-center gap-3">
						{#if totalEntries > 0}<p class="text-sm text-muted-foreground">{filteredCampaigns.length} campanii</p>{/if}
						<div class="flex items-center gap-1.5">
							<ColumnsIcon class="h-4 w-4 text-muted-foreground" />
							<select class="h-8 rounded-md border border-input bg-background px-2 text-sm" value={selectedPresetKey} onchange={(e) => { selectedPresetKey = e.currentTarget.value; }}>
								{#each GOOGLE_COLUMN_PRESETS as preset}<option value={preset.key}>{preset.label}</option>{/each}
							</select>
						</div>
					</div>
				</div>

				{#if campaignTableData.length === 0}
					<Card class="p-8 text-center"><p class="text-muted-foreground">Nu sunt date de campanii pentru perioada selectată.</p></Card>
				{:else}
					<div class="rounded-md border overflow-x-auto">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead class="w-[40px]"><Checkbox checked={allSelected} indeterminate={someSelected && !allSelected} onCheckedChange={() => toggleSelectAll()} /></TableHead>
									<TableHead><button class="flex items-center gap-2 hover:text-primary" onclick={() => handleSort('campaignName')}>Campanie <ArrowUpDownIcon class="h-4 w-4" /></button></TableHead>
									<TableHead><button class="flex items-center gap-2 hover:text-primary" onclick={() => handleSort('status')}>Status <ArrowUpDownIcon class="h-4 w-4" /></button></TableHead>
									{#each activePreset.columns as col}
										<TableHead class={col.align === 'right' ? 'text-right' : ''}>
											{#if col.sortKey}<button class="{col.align === 'right' ? 'ml-auto ' : ''}flex items-center gap-2 hover:text-primary" onclick={() => handleSort(col.sortKey!)}>{col.label} <ArrowUpDownIcon class="h-4 w-4" /></button>
											{:else}<span class={col.align === 'right' ? 'ml-auto' : ''}>{col.label}</span>{/if}
										</TableHead>
									{/each}
								</TableRow>
							</TableHeader>
							<TableBody>
								{#each paginatedCampaigns as campaign}
									<TableRow class="cursor-pointer transition-colors hover:bg-muted/40 {expandedCampaigns.has(campaign.campaignId) ? 'bg-muted/30 font-semibold border-l-3 border-l-primary' : ''}" onclick={() => toggleExpand(campaign.campaignId)}>
										<TableCell class="w-[40px]" onclick={(e) => e.stopPropagation()}><Checkbox checked={selectedCampaigns.has(campaign.campaignId)} onCheckedChange={() => toggleSelect(campaign.campaignId)} /></TableCell>
										<TableCell class="font-medium max-w-[250px]">
											<div class="flex items-center gap-1.5">
												{#if expandedCampaigns.has(campaign.campaignId)}<ChevronDownIcon class="h-4 w-4 shrink-0 text-primary" />{:else}<ChevronRightIcon class="h-4 w-4 shrink-0 text-muted-foreground" />{/if}
												<div class="truncate" title={campaign.campaignName}>{campaign.campaignName}</div>
											</div>
											{#if true}
												{@const chConfig = getChannelConfig(campaign.channelType)}
												{@const ChIcon = chConfig.icon}
												<div class="flex items-center gap-1.5 ml-5.5 mt-0.5">
													<span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium {chConfig.color}">
														<ChIcon class="h-3 w-3" />
														{chConfig.label}
													</span>
													{#if campaign.startDate}
														<span class="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
															<CalendarIcon class="h-2.5 w-2.5" />
															Start: {campaign.startDate}
															{#if campaign.endDate && campaign.status !== 'ACTIVE'}· End: {campaign.endDate}{/if}
														</span>
													{/if}
												</div>
											{/if}
										</TableCell>
										<TableCell><Badge variant={getStatusVariant(campaign.status)}>{campaign.status}</Badge></TableCell>
										{#each activePreset.columns as col}
											<TableCell class={col.align === 'right' ? 'text-right' : ''} onclick={(e) => col.key === 'results' ? e.stopPropagation() : null}>
												{#if col.key === 'results' && campaign.conversions > 0 && campaignConversions[campaign.campaignId]?.length}
													<Popover.Root>
														<Popover.Trigger class="text-right cursor-pointer hover:underline decoration-dotted underline-offset-2">
															<div>{col.getValue(campaign, selectedCurrency)}</div>
															{#if col.getSubtext}{@const sub = col.getSubtext(campaign)}{#if sub}<div class="text-xs text-muted-foreground">{sub}</div>{/if}{/if}
														</Popover.Trigger>
														<Popover.Content side="top" align="end" class="w-72 p-3">
															<p class="mb-2 text-xs font-semibold text-muted-foreground">Tipuri de conversie</p>
															{@const actions = campaignConversions[campaign.campaignId]}
															{@const totalConv = actions.reduce((s: number, a: any) => s + a.conversions, 0)}
															<div class="space-y-1.5 text-xs">
																{#each actions as action, i (action.name)}
																	{@const pct = totalConv > 0 ? (action.conversions / totalConv) * 100 : 0}
																	<div class="flex items-center justify-between">
																		<span class="text-muted-foreground truncate mr-2">
																			{action.name}
																		</span>
																		<div class="text-right shrink-0">
																			<span class="font-medium">{action.conversions}</span>
																			<span class="text-muted-foreground ml-1">{pct.toFixed(1)}%</span>
																		</div>
																	</div>
																{/each}
																{#if actions.some((a: any) => a.conversionValue > 0)}
																	<div class="border-t pt-1.5 mt-1.5">
																		<div class="flex items-center justify-between text-muted-foreground">
																			<span>Valoare totală</span>
																			<span class="font-medium">{formatCurrency(actions.reduce((s: number, a: any) => s + a.conversionValue, 0), selectedCurrency)}</span>
																		</div>
																	</div>
																{/if}
															</div>
														</Popover.Content>
													</Popover.Root>
												{:else}
													<div>{col.getValue(campaign, selectedCurrency)}</div>
													{#if col.getSubtext}{@const sub = col.getSubtext(campaign)}{#if sub}<div class="text-xs text-muted-foreground">{sub}</div>{/if}{/if}
												{/if}
											</TableCell>
										{/each}
									</TableRow>
									{#if expandedCampaigns.has(campaign.campaignId)}
										{#if adGroupLoading.has(campaign.campaignId)}
											<TableRow class="bg-muted/20"><TableCell></TableCell><TableCell colspan={activePreset.columns.length + 2}><div class="flex items-center gap-2 py-2 pl-6 text-sm text-muted-foreground"><LoaderIcon class="h-4 w-4 animate-spin" />Se încarcă ad group-urile...</div></TableCell></TableRow>
										{:else if adGroupData.has(campaign.campaignId)}
											{#each adGroupData.get(campaign.campaignId) || [] as adgroup}
												<TableRow class="bg-muted/15 border-l-3 border-l-primary/30 text-muted-foreground">
													<TableCell class="w-[40px]"></TableCell>
													<TableCell class="max-w-[250px]"><div class="flex items-center gap-1.5 pl-4"><span class="text-muted-foreground/50">└</span><div class="truncate text-sm text-foreground/80" title={adgroup.adGroupName}>{adgroup.adGroupName}</div></div></TableCell>
													<TableCell></TableCell>
													{#each activePreset.columns as col}
														<TableCell class="{col.align === 'right' ? 'text-right' : ''} text-sm text-foreground/80">
															<div>{col.getValue(adgroup as any, selectedCurrency)}</div>
															{#if col.getSubtext}{@const sub = col.getSubtext(adgroup as any)}{#if sub}<div class="text-xs text-muted-foreground">{sub}</div>{/if}{/if}
														</TableCell>
													{/each}
												</TableRow>
											{/each}
										{/if}
									{/if}
								{/each}
								<TableRow class="bg-muted/50 font-semibold border-t-2">
									<TableCell></TableCell>
									<TableCell>Rezultate din {filteredCampaigns.length} campanii</TableCell>
									<TableCell></TableCell>
									{#each activePreset.columns as col}
										<TableCell class={col.align === 'right' ? 'text-right' : ''}>{col.getTotalValue ? col.getTotalValue(filteredCampaigns, selectedCurrency) : '-'}</TableCell>
									{/each}
								</TableRow>
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
								<span class="text-muted-foreground">{startIndex + 1}-{endIndex} din {totalEntries}</span>
							</div>
							<div class="flex items-center gap-1">
								<Button variant="outline" size="sm" disabled={safePage <= 1} onclick={() => { currentPage = safePage - 1; }}>Anterior</Button>
								<Button variant="outline" size="sm" disabled={safePage >= totalPages} onclick={() => { currentPage = safePage + 1; }}>Următor</Button>
							</div>
						</div>
					{/if}
				{/if}
			</div>
		{/if}
	{/if}
</div>
