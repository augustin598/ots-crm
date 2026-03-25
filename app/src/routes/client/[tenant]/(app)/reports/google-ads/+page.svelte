<script lang="ts">
	import { getMyGoogleAdAccount, getGoogleCampaignInsights, getGoogleActiveCampaigns, getGoogleAdGroupInsights } from '$lib/remotes/google-reports.remote';
	import { page } from '$app/state';
	import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '$lib/components/ui/table';
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
	import { formatCurrency, formatPercent, formatNumber, getDefaultDateRange, computeTotals } from '$lib/utils/report-helpers';
	import { aggregateGoogleInsightsByDate, aggregateGoogleInsightsByCampaign, aggregateGoogleInsightsByAdGroup, type GoogleCampaignAggregate, type GoogleAdGroupAggregate } from '$lib/utils/google-report-helpers';
	import { GOOGLE_COLUMN_PRESETS, GOOGLE_DEFAULT_PRESET, getGooglePreset } from '$lib/utils/google-column-presets';

	const defaults = getDefaultDateRange();
	let since = $state(defaults.since);
	let until = $state(defaults.until);

	const accountsQuery = getMyGoogleAdAccount();
	const accounts = $derived(accountsQuery.current || []);
	const accountsLoading = $derived(accountsQuery.loading);

	let selectedCustomerId = $state<string>('');
	$effect(() => { if (accounts.length > 0 && !selectedCustomerId) selectedCustomerId = accounts[0].googleAdsCustomerId; });
	const currency = $derived('RON');

	function handleAccountChange(e: Event) { selectedCustomerId = (e.target as HTMLSelectElement).value; selectedCampaigns = new Set(); }

	let insightsQuery = $state<ReturnType<typeof getGoogleCampaignInsights> | null>(null);
	let campaignsQuery = $state<ReturnType<typeof getGoogleActiveCampaigns> | null>(null);

	$effect(() => {
		if (selectedCustomerId && since && until) {
			insightsQuery = getGoogleCampaignInsights({ customerId: selectedCustomerId, since, until });
			campaignsQuery = getGoogleActiveCampaigns({ customerId: selectedCustomerId });
		}
	});

	const insights = $derived(insightsQuery?.current || []);
	const insightsLoading = $derived(insightsQuery?.loading ?? false);
	const insightsError = $derived(insightsQuery?.error);
	const campaigns = $derived(campaignsQuery?.current || []);

	let selectedCampaigns = $state<Set<string>>(new Set());
	const filteredInsights = $derived(selectedCampaigns.size > 0 ? insights.filter((i: any) => selectedCampaigns.has(i.campaignId)) : insights);
	const campaignData = $derived(aggregateGoogleInsightsByCampaign(insights));
	const dailyData = $derived(aggregateGoogleInsightsByDate(filteredInsights));
	const totals = $derived(computeTotals(dailyData));

	const resultKpi = $derived.by(() => {
		const withResults = campaignData.filter(c => c.conversions > 0);
		if (withResults.length === 0) return { label: 'Conversii', value: '-', subtext: 'Fără date' };
		const totalResults = withResults.reduce((s, c) => s + c.conversions, 0);
		const totalSpend = withResults.reduce((s, c) => s + c.spend, 0);
		return { label: 'Conversii', value: formatNumber(totalResults), subtext: totalResults > 0 ? `${formatCurrency(totalSpend / totalResults, currency)} Cost/conversie` : 'Fără date' };
	});

	const campaignTableData = $derived.by(() => {
		const insightMap = new Map(campaignData.map(c => [c.campaignId, c]));
		const result: Array<GoogleCampaignAggregate & { status: string; dailyBudget: string | null; startDate: string | null; endDate: string | null }> = [];
		for (const ci of campaigns) {
			const insight = insightMap.get(ci.campaignId);
			if (insight) { result.push({ ...insight, status: ci.status, dailyBudget: ci.dailyBudget || null, startDate: ci.startDate, endDate: ci.endDate }); insightMap.delete(ci.campaignId); }
			else if (ci.status === 'ACTIVE') { result.push({ campaignId: ci.campaignId, campaignName: ci.campaignName, channelType: ci.channelType, spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0, cpc: 0, cpm: 0, ctr: 0, costPerConversion: 0, roas: 0, videoViews: 0, resultType: '', cpaLabel: 'CPA', status: ci.status, dailyBudget: ci.dailyBudget || null, startDate: ci.startDate, endDate: ci.endDate }); }
		}
		for (const [, c] of insightMap) { result.push({ ...c, status: 'UNKNOWN', dailyBudget: null, startDate: null, endDate: null }); }
		return result;
	});

	let statusFilter = $state<'all' | 'active' | 'paused'>('all');
	const filteredCampaigns = $derived.by(() => {
		if (statusFilter === 'all') return campaignTableData;
		if (statusFilter === 'active') return campaignTableData.filter(c => c.status === 'ACTIVE');
		return campaignTableData.filter(c => c.status === 'PAUSED');
	});

	let sortColumn = $state<keyof GoogleCampaignAggregate | 'status'>('status');
	let sortDirection = $state<'asc' | 'desc'>('asc');
	const sortedCampaigns = $derived([...filteredCampaigns].sort((a, b) => {
		const dir = sortDirection === 'asc' ? 1 : -1;
		if (sortColumn === 'status') { const sa = a.status === 'ACTIVE' ? 0 : 1; const sb = b.status === 'ACTIVE' ? 0 : 1; if (sa !== sb) return dir * (sa - sb); return b.spend - a.spend; }
		const av = a[sortColumn as keyof typeof a]; const bv = b[sortColumn as keyof typeof b];
		if (typeof av === 'string' && typeof bv === 'string') return dir * av.localeCompare(bv);
		if (typeof av === 'number' && typeof bv === 'number') return dir * (av - bv);
		return 0;
	}));

	let selectedPresetKey = $state(GOOGLE_DEFAULT_PRESET);
	const activePreset = $derived(getGooglePreset(selectedPresetKey));

	const CHANNEL_CONFIG: Record<string, { label: string; icon: any; color: string }> = {
		SEARCH: { label: 'Search', icon: SearchIcon, color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
		DISPLAY: { label: 'Display', icon: MonitorIcon, color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' },
		VIDEO: { label: 'Video', icon: PlayIcon, color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
		SHOPPING: { label: 'Shopping', icon: ShoppingCartIcon, color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
		PERFORMANCE_MAX: { label: 'PMax', icon: ZapIcon, color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
		DEMAND_GEN: { label: 'Demand Gen', icon: TargetIcon, color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
	};
	function getChannelConfig(ch: string) { return CHANNEL_CONFIG[ch] || { label: ch, icon: TargetIcon, color: 'bg-gray-100 text-gray-700' }; }

	let expandedCampaigns = $state<Set<string>>(new Set());
	let adGroupData = $state<Map<string, GoogleAdGroupAggregate[]>>(new Map());
	let adGroupLoading = $state<Set<string>>(new Set());
	async function toggleExpand(campaignId: string) {
		const next = new Set(expandedCampaigns);
		if (next.has(campaignId)) { next.delete(campaignId); expandedCampaigns = next; return; }
		next.add(campaignId); expandedCampaigns = next;
		if (!adGroupData.has(campaignId) && selectedCustomerId) {
			const loadingNext = new Set(adGroupLoading); loadingNext.add(campaignId); adGroupLoading = loadingNext;
			try {
				const query = getGoogleAdGroupInsights({ customerId: selectedCustomerId, campaignId, since, until });
				const checkInterval = setInterval(() => { if (!query.loading) { clearInterval(checkInterval); const ld = new Set(adGroupLoading); ld.delete(campaignId); adGroupLoading = ld; if (query.current) { const agg = aggregateGoogleInsightsByAdGroup(query.current); const nm = new Map(adGroupData); nm.set(campaignId, agg); adGroupData = nm; } } }, 100);
			} catch { const ld = new Set(adGroupLoading); ld.delete(campaignId); adGroupLoading = ld; }
		}
	}

	function getStatusVariant(s: string): 'success' | 'warning' | 'outline' { return s === 'ACTIVE' ? 'success' : s === 'PAUSED' ? 'warning' : 'outline'; }
	function handleSort(col: typeof sortColumn) { if (sortColumn === col) sortDirection = sortDirection === 'asc' ? 'desc' : 'asc'; else { sortColumn = col; sortDirection = 'desc'; } }
	function handleRefresh() { if (selectedCustomerId && since && until) { insightsQuery = getGoogleCampaignInsights({ customerId: selectedCustomerId, since, until }); campaignsQuery = getGoogleActiveCampaigns({ customerId: selectedCustomerId }); } }
	const allSelected = $derived(sortedCampaigns.length > 0 && sortedCampaigns.every(c => selectedCampaigns.has(c.campaignId)));
	const someSelected = $derived(sortedCampaigns.some(c => selectedCampaigns.has(c.campaignId)));
	function toggleSelectAll() { selectedCampaigns = allSelected ? new Set() : new Set(sortedCampaigns.map(c => c.campaignId)); }
	function toggleSelect(id: string) { const n = new Set(selectedCampaigns); n.has(id) ? n.delete(id) : n.add(id); selectedCampaigns = n; }
</script>

<div class="space-y-6">
	{#if accountsLoading}
		<div class="grid gap-4 md:grid-cols-3 lg:grid-cols-5">{#each Array(5) as _}<Card class="p-4"><Skeleton class="h-16 w-full" /></Card>{/each}</div>
	{:else if accounts.length === 0}
		<Card class="p-8 text-center"><p class="text-muted-foreground">Nu există cont Google Ads asociat acestui client.</p></Card>
	{:else}
		<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
			<div>
				<h1 class="text-3xl font-bold flex items-center gap-3"><IconGoogleAds class="h-8 w-8" />Google Ads</h1>
				<p class="text-muted-foreground">Rapoarte performanță campanii Google Ads</p>
			</div>
			<div class="flex items-center gap-2">
				<DateRangePicker bind:since bind:until />
				{#if accounts.length > 1}
					<select class="h-9 rounded-md border border-input bg-background px-3 text-sm" value={selectedCustomerId} onchange={handleAccountChange}>
						{#each accounts as acc}<option value={acc.googleAdsCustomerId}>{acc.accountName || acc.googleAdsCustomerId}</option>{/each}
					</select>
				{/if}
				<Button variant="outline" size="sm" onclick={handleRefresh}><RefreshCwIcon class="h-4 w-4" /></Button>
			</div>
		</div>

		{#if insightsError}
			<Card class="p-8"><div class="rounded-md bg-red-50 p-4"><p class="text-sm font-medium text-red-800">{insightsError instanceof Error ? insightsError.message : 'Eroare'}</p></div></Card>
		{:else if insightsLoading}
			<div class="grid gap-4 md:grid-cols-3 lg:grid-cols-5">{#each Array(5) as _}<Card class="p-4"><Skeleton class="h-16 w-full" /></Card>{/each}</div>
		{:else}
			<div class="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
				<KpiCard label="Cheltuieli totale" value={formatCurrency(totals.totalSpend, currency)} icon={DollarSignIcon} subtext="{formatNumber(totals.totalImpressions)} impresii" />
				<KpiCard label="CPM" value={formatCurrency(totals.avgCpm, currency)} icon={EyeIcon} subtext="Cost per 1000 impresii" />
				<KpiCard label="CPC" value={formatCurrency(totals.avgCpc, currency)} icon={MousePointerClickIcon} subtext="{formatNumber(totals.totalClicks)} click-uri" />
				<KpiCard label="CTR" value={formatPercent(totals.avgCtr)} icon={PercentIcon} subtext="Click-through rate" />
				<KpiCard label={resultKpi.label} value={resultKpi.value} icon={TrendingUpIcon} subtext={resultKpi.subtext} />
			</div>

			{#if dailyData.length > 0}
				<div class="grid gap-6 xl:grid-cols-2">
					<Card class="p-4"><h3 class="mb-4 text-lg font-semibold">Cheltuieli în timp</h3><SpendChart data={dailyData.map(d => ({ date: d.date, spend: d.spend }))} {currency} /></Card>
					<Card class="p-4"><h3 class="mb-4 text-lg font-semibold">Conversii & Cost per conversie</h3><ConversionsChart data={dailyData.map(d => ({ date: d.date, conversions: d.conversions, costPerConversion: d.costPerConversion }))} {currency} /></Card>
				</div>
			{/if}

			{#if selectedCustomerId}
				<GoogleDemographicsSection customerId={selectedCustomerId} {since} {until} {currency} />
			{/if}

			{#if campaignData.length > 0}
				<div class="space-y-4">
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-3">
							<h3 class="text-lg font-semibold">Performanță campanii</h3>
							<div class="flex items-center gap-1 rounded-lg border p-0.5">
								{#each [{ key: 'all', label: 'Toate', cls: 'bg-primary text-primary-foreground' }, { key: 'active', label: 'Active', cls: 'bg-green-600 text-white' }, { key: 'paused', label: 'Paused', cls: 'bg-amber-500 text-white' }] as sf}
									<button class="px-3 py-1 text-xs rounded-md transition-colors {statusFilter === sf.key ? sf.cls : 'text-muted-foreground hover:text-foreground'}" onclick={() => { statusFilter = sf.key as any; }}>{sf.label}</button>
								{/each}
							</div>
						</div>
						<div class="flex items-center gap-1.5">
							<ColumnsIcon class="h-4 w-4 text-muted-foreground" />
							<select class="h-8 rounded-md border border-input bg-background px-2 text-sm" value={selectedPresetKey} onchange={(e) => selectedPresetKey = e.currentTarget.value}>
								{#each GOOGLE_COLUMN_PRESETS as p}<option value={p.key}>{p.label}</option>{/each}
							</select>
						</div>
					</div>
					<div class="rounded-md border overflow-x-auto">
						<Table>
							<TableHeader><TableRow>
								<TableHead class="w-[40px]"><Checkbox checked={allSelected} indeterminate={someSelected && !allSelected} onCheckedChange={() => toggleSelectAll()} /></TableHead>
								<TableHead><button class="flex items-center gap-2 hover:text-primary" onclick={() => handleSort('campaignName')}>Campanie <ArrowUpDownIcon class="h-4 w-4" /></button></TableHead>
								<TableHead><button class="flex items-center gap-2 hover:text-primary" onclick={() => handleSort('status')}>Status <ArrowUpDownIcon class="h-4 w-4" /></button></TableHead>
								{#each activePreset.columns as col}<TableHead class={col.align === 'right' ? 'text-right' : ''}>{#if col.sortKey}<button class="{col.align === 'right' ? 'ml-auto ' : ''}flex items-center gap-2 hover:text-primary" onclick={() => handleSort(col.sortKey!)}>{col.label} <ArrowUpDownIcon class="h-4 w-4" /></button>{:else}{col.label}{/if}</TableHead>{/each}
							</TableRow></TableHeader>
							<TableBody>
								{#each sortedCampaigns as campaign}
									<TableRow class="cursor-pointer transition-colors hover:bg-muted/40 {expandedCampaigns.has(campaign.campaignId) ? 'bg-muted/30 font-semibold border-l-3 border-l-primary' : ''}" onclick={() => toggleExpand(campaign.campaignId)}>
										<TableCell class="w-[40px]" onclick={(e) => e.stopPropagation()}><Checkbox checked={selectedCampaigns.has(campaign.campaignId)} onCheckedChange={() => toggleSelect(campaign.campaignId)} /></TableCell>
										<TableCell class="font-medium max-w-[250px]">
											<div class="flex items-center gap-1.5">
												{#if expandedCampaigns.has(campaign.campaignId)}<ChevronDownIcon class="h-4 w-4 shrink-0 text-primary" />{:else}<ChevronRightIcon class="h-4 w-4 shrink-0 text-muted-foreground" />{/if}
												<div class="truncate" title={campaign.campaignName}>{campaign.campaignName}</div>
											</div>
											{#if true}{@const ch = getChannelConfig(campaign.channelType)}<div class="flex items-center gap-1.5 ml-5.5 mt-0.5"><span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium {ch.color}"><svelte:component this={ch.icon} class="h-3 w-3" />{ch.label}</span>{#if campaign.startDate}<span class="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground"><CalendarIcon class="h-2.5 w-2.5" />Start: {campaign.startDate}{#if campaign.endDate && campaign.status !== 'ACTIVE'}· End: {campaign.endDate}{/if}</span>{/if}</div>{/if}
										</TableCell>
										<TableCell><Badge variant={getStatusVariant(campaign.status)}>{campaign.status}</Badge></TableCell>
										{#each activePreset.columns as col}<TableCell class={col.align === 'right' ? 'text-right' : ''}><div>{col.getValue(campaign, currency)}</div>{#if col.getSubtext}{@const sub = col.getSubtext(campaign)}{#if sub}<div class="text-xs text-muted-foreground">{sub}</div>{/if}{/if}</TableCell>{/each}
									</TableRow>
									{#if expandedCampaigns.has(campaign.campaignId)}
										{#if adGroupLoading.has(campaign.campaignId)}<TableRow class="bg-muted/20"><TableCell></TableCell><TableCell colspan={activePreset.columns.length + 2}><div class="flex items-center gap-2 py-2 pl-6 text-sm text-muted-foreground"><LoaderIcon class="h-4 w-4 animate-spin" />Se încarcă...</div></TableCell></TableRow>
										{:else if adGroupData.has(campaign.campaignId)}{#each adGroupData.get(campaign.campaignId) || [] as ag}<TableRow class="bg-muted/15 border-l-3 border-l-primary/30"><TableCell></TableCell><TableCell><div class="flex items-center gap-1.5 pl-4"><span class="text-muted-foreground/50">└</span><div class="truncate text-sm text-foreground/80" title={ag.adGroupName}>{ag.adGroupName}</div></div></TableCell><TableCell></TableCell>{#each activePreset.columns as col}<TableCell class="{col.align === 'right' ? 'text-right' : ''} text-sm text-foreground/80"><div>{col.getValue(ag as any, currency)}</div></TableCell>{/each}</TableRow>{/each}{/if}
									{/if}
								{/each}
								<TableRow class="bg-muted/50 font-semibold border-t-2"><TableCell></TableCell><TableCell>Total {campaignTableData.length} campanii</TableCell><TableCell></TableCell>{#each activePreset.columns as col}<TableCell class={col.align === 'right' ? 'text-right' : ''}>{col.getTotalValue ? col.getTotalValue(campaignTableData, currency) : '-'}</TableCell>{/each}</TableRow>
							</TableBody>
						</Table>
					</div>
				</div>
			{:else}
				<Card class="p-8 text-center"><p class="text-muted-foreground">Nu sunt date de campanii pentru perioada selectată.</p></Card>
			{/if}
		{/if}
	{/if}
</div>
