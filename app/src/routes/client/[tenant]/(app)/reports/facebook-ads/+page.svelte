<script lang="ts">
	import { getMyAdAccount, getMetaCampaignInsights, getMetaActiveCampaigns } from '$lib/remotes/reports.remote';
	import { page } from '$app/state';
	import {
		Table, TableBody, TableCell, TableHead, TableHeader, TableRow
	} from '$lib/components/ui/table';
	import { Card } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import KpiCard from '$lib/components/reports/kpi-card.svelte';
	import DateRangePicker from '$lib/components/reports/date-range-picker.svelte';
	import SpendChart from '$lib/components/reports/spend-chart.svelte';
	import ConversionsChart from '$lib/components/reports/conversions-chart.svelte';
	import DollarSignIcon from '@lucide/svelte/icons/dollar-sign';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import MousePointerClickIcon from '@lucide/svelte/icons/mouse-pointer-click';
	import PercentIcon from '@lucide/svelte/icons/percent';
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import ArrowUpDownIcon from '@lucide/svelte/icons/arrow-up-down';
	import ColumnsIcon from '@lucide/svelte/icons/columns-3';
	import {
		aggregateInsightsByDate,
		aggregateInsightsByCampaign,
		computeTotals,
		formatCurrency,
		formatPercent,
		formatNumber,
		getDefaultDateRange,
		type CampaignAggregate
	} from '$lib/utils/report-helpers';
	import { COLUMN_PRESETS, DEFAULT_PRESET, getPreset } from '$lib/utils/column-presets';

	const tenantSlug = $derived(page.params.tenant as string);

	// Date range
	const defaults = getDefaultDateRange();
	let since = $state(defaults.since);
	let until = $state(defaults.until);

	// Auto-detect client's ad account
	const adAccountQuery = getMyAdAccount();
	const adAccount = $derived(adAccountQuery.current);
	const adAccountLoading = $derived(adAccountQuery.loading);

	const currency = $derived(adAccount?.currency || 'RON');

	// Insights (only if ad account exists)
	let insightsQuery = $state<ReturnType<typeof getMetaCampaignInsights> | null>(null);
	let campaignsQuery = $state<ReturnType<typeof getMetaActiveCampaigns> | null>(null);

	$effect(() => {
		if (adAccount?.metaAdAccountId && adAccount?.integrationId && since && until) {
			insightsQuery = getMetaCampaignInsights({
				adAccountId: adAccount.metaAdAccountId,
				integrationId: adAccount.integrationId,
				since,
				until,
				timeIncrement: 'daily'
			});
			campaignsQuery = getMetaActiveCampaigns({
				adAccountId: adAccount.metaAdAccountId,
				integrationId: adAccount.integrationId
			});
		}
	});

	const insights = $derived(insightsQuery?.current || []);
	const insightsLoading = $derived(insightsQuery?.loading ?? false);
	const insightsError = $derived(insightsQuery?.error);
	const campaigns = $derived(campaignsQuery?.current || []);

	// Aggregated data
	const dailyData = $derived(aggregateInsightsByDate(insights));
	const campaignData = $derived(aggregateInsightsByCampaign(insights));
	const totals = $derived(computeTotals(dailyData));

	// Merge campaigns with insights to get status
	const campaignTableData = $derived.by(() => {
		const insightMap = new Map(campaignData.map(c => [c.campaignId, c]));
		const result: Array<CampaignAggregate & { status: string }> = [];
		for (const ci of campaigns) {
			const insight = insightMap.get(ci.campaignId);
			if (insight) {
				result.push({ ...insight, status: ci.status });
				insightMap.delete(ci.campaignId);
			} else if (ci.status === 'ACTIVE' || ci.status === 'WITH_ISSUES') {
				result.push({
					campaignId: ci.campaignId, campaignName: ci.campaignName, objective: ci.objective,
					spend: 0, impressions: 0, reach: 0, frequency: 0, clicks: 0,
					conversions: 0, conversionValue: 0, cpc: 0, cpm: 0, ctr: 0,
					costPerConversion: 0, roas: 0, resultType: '', cpaLabel: 'CPA',
					linkClicks: 0, landingPageViews: 0, pageEngagement: 0,
					postReactions: 0, postComments: 0, postSaves: 0, postShares: 0, videoViews: 0, callsPlaced: 0,
					status: ci.status
				});
			}
		}
		for (const [, c] of insightMap) {
			result.push({ ...c, status: 'UNKNOWN' });
		}
		return result;
	});

	// Dynamic result KPI
	const resultKpi = $derived.by(() => {
		const withResults = campaignData.filter(c => c.conversions > 0);
		if (withResults.length === 0) return { label: 'Rezultate', value: '-', subtext: 'Fără date' };
		const totalResults = withResults.reduce((s, c) => s + c.conversions, 0);
		const totalSpend = withResults.reduce((s, c) => s + c.spend, 0);
		const typeCounts = new Map<string, number>();
		for (const c of withResults) {
			if (c.resultType) typeCounts.set(c.resultType, (typeCounts.get(c.resultType) || 0) + c.conversions);
		}
		let dominantType = '';
		let maxCount = 0;
		for (const [type, count] of typeCounts) {
			if (count > maxCount) { maxCount = count; dominantType = type; }
		}
		const costPer = totalResults > 0 ? totalSpend / totalResults : 0;
		const costLabel = withResults[0]?.cpaLabel || 'Per result';
		return {
			label: dominantType || 'Rezultate',
			value: formatNumber(totalResults),
			subtext: totalResults > 0 ? `${formatCurrency(costPer, currency)} ${costLabel}` : 'Fără date'
		};
	});

	// Column presets
	let selectedPresetKey = $state(DEFAULT_PRESET);
	const activePreset = $derived(getPreset(selectedPresetKey));

	// Sorting
	let sortColumn = $state<keyof CampaignAggregate | 'status'>('status');
	let sortDirection = $state<'asc' | 'desc'>('asc');
	const STATUS_ORDER: Record<string, number> = { ACTIVE: 0, WITH_ISSUES: 1, IN_PROCESS: 2, PAUSED: 3, CAMPAIGN_PAUSED: 4, UNKNOWN: 5 };

	const sortedCampaigns = $derived(
		[...campaignTableData].sort((a, b) => {
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

	function getStatusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' {
		switch (status) {
			case 'ACTIVE': return 'success';
			case 'PAUSED': case 'CAMPAIGN_PAUSED': return 'warning';
			case 'DELETED': return 'destructive';
			default: return 'outline';
		}
	}

	function handleSort(column: typeof sortColumn) {
		if (sortColumn === column) {
			sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
		} else {
			sortColumn = column;
			sortDirection = 'desc';
		}
	}

	function handleRefresh() {
		if (adAccount?.metaAdAccountId && adAccount?.integrationId && since && until) {
			insightsQuery = getMetaCampaignInsights({
				adAccountId: adAccount.metaAdAccountId,
				integrationId: adAccount.integrationId,
				since,
				until,
				timeIncrement: 'daily'
			});
		}
	}
</script>

<div class="space-y-6">
	{#if adAccountLoading}
		<div class="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
			{#each Array(5) as _}
				<Card class="p-4"><Skeleton class="h-16 w-full" /></Card>
			{/each}
		</div>
	{:else if !adAccount}
		<Card class="p-8 text-center">
			<p class="text-muted-foreground">Nu există cont Meta Ads asociat acestui client. Asociază un cont din <a href="/{tenantSlug}/settings/meta-ads" class="text-primary underline">Settings → Meta Ads</a>.</p>
		</Card>
	{:else}
		<!-- Header -->
		<div class="flex items-center justify-between">
			<div>
				<p class="text-sm text-muted-foreground">{adAccount.accountName}</p>
			</div>
			<div class="flex items-center gap-2">
				<DateRangePicker bind:since bind:until />
				<Button variant="outline" size="sm" onclick={handleRefresh}>
					<RefreshCwIcon class="h-4 w-4" />
				</Button>
			</div>
		</div>

		{#if insightsError}
			<Card class="p-8">
				<div class="rounded-md bg-red-50 p-4 space-y-2">
					<p class="text-sm font-medium text-red-800">{insightsError instanceof Error ? insightsError.message : 'Eroare la încărcarea datelor'}</p>
					<p class="text-sm text-red-700">
						Dacă tokenul a expirat, reconectează din
						<a href="/{tenantSlug}/settings/meta-ads" class="underline font-medium">Settings → Meta Ads</a>.
					</p>
				</div>
			</Card>
		{:else if insightsLoading}
			<div class="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
				{#each Array(5) as _}
					<Card class="p-4"><Skeleton class="h-16 w-full" /></Card>
				{/each}
			</div>
		{:else}
			<!-- KPI Cards -->
			<div class="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
				<KpiCard label="Cheltuieli totale" value={formatCurrency(totals.totalSpend, currency)} icon={DollarSignIcon} subtext="{formatNumber(totals.totalImpressions)} impresii" />
				<KpiCard label="CPM" value={formatCurrency(totals.avgCpm, currency)} icon={EyeIcon} subtext="Cost per 1000 impresii" />
				<KpiCard label="CPC" value={formatCurrency(totals.avgCpc, currency)} icon={MousePointerClickIcon} subtext="{formatNumber(totals.totalClicks)} click-uri" />
				<KpiCard label="CTR" value={formatPercent(totals.avgCtr)} icon={PercentIcon} subtext="Click-through rate" />
				<KpiCard label={resultKpi.label} value={resultKpi.value} icon={TrendingUpIcon} subtext={resultKpi.subtext} />
			</div>

			<!-- Charts -->
			{#if dailyData.length > 0}
				<div class="grid gap-6 xl:grid-cols-2">
					<Card class="p-4">
						<h3 class="mb-4 text-lg font-semibold">Cheltuieli în timp</h3>
						<SpendChart data={dailyData.map(d => ({ date: d.date, spend: d.spend }))} {currency} />
					</Card>
					<Card class="p-4">
						<h3 class="mb-4 text-lg font-semibold">Conversii & Cost per conversie</h3>
						<ConversionsChart data={dailyData.map(d => ({ date: d.date, conversions: d.conversions, costPerConversion: d.costPerConversion }))} {currency} />
					</Card>
				</div>
			{/if}

			<!-- Campaign Table -->
			{#if campaignData.length > 0}
				<div class="space-y-4">
					<div class="flex items-center justify-between">
						<h3 class="text-lg font-semibold">Performanță campanii</h3>
						<div class="flex items-center gap-3">
							<p class="text-sm text-muted-foreground">{campaignTableData.length} campanii</p>
							<div class="flex items-center gap-1.5">
								<ColumnsIcon class="h-4 w-4 text-muted-foreground" />
								<select class="h-8 rounded-md border border-input bg-background px-2 text-sm" value={selectedPresetKey} onchange={(e) => { selectedPresetKey = e.currentTarget.value; }}>
									{#each COLUMN_PRESETS as preset}
										<option value={preset.key}>{preset.label}</option>
									{/each}
								</select>
							</div>
						</div>
					</div>

					<div class="rounded-md border overflow-x-auto">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>
										<button class="flex items-center gap-2 hover:text-primary" onclick={() => handleSort('campaignName')}>
											Campanie <ArrowUpDownIcon class="h-4 w-4" />
										</button>
									</TableHead>
									<TableHead>
										<button class="flex items-center gap-2 hover:text-primary" onclick={() => handleSort('status')}>
											Status <ArrowUpDownIcon class="h-4 w-4" />
										</button>
									</TableHead>
									{#each activePreset.columns as col}
										<TableHead class={col.align === 'right' ? 'text-right' : ''}>
											{#if col.sortKey}
												<button class="{col.align === 'right' ? 'ml-auto ' : ''}flex items-center gap-2 hover:text-primary" onclick={() => handleSort(col.sortKey!)}>
													{col.label} <ArrowUpDownIcon class="h-4 w-4" />
												</button>
											{:else}
												<span class={col.align === 'right' ? 'ml-auto' : ''}>{col.label}</span>
											{/if}
										</TableHead>
									{/each}
								</TableRow>
							</TableHeader>
							<TableBody>
								{#each sortedCampaigns as campaign}
									<TableRow>
										<TableCell class="font-medium max-w-[250px]">
											<div class="truncate" title={campaign.campaignName}>{campaign.campaignName}</div>
											<div class="text-xs text-muted-foreground">{campaign.objective}</div>
										</TableCell>
										<TableCell>
											<Badge variant={getStatusVariant(campaign.status)}>{campaign.status}</Badge>
										</TableCell>
										{#each activePreset.columns as col}
											<TableCell class={col.align === 'right' ? 'text-right' : ''}>
												<div>{col.getValue(campaign, currency)}</div>
												{#if col.getSubtext}
													{@const sub = col.getSubtext(campaign)}
													{#if sub}
														<div class="text-xs text-muted-foreground">{sub}</div>
													{/if}
												{/if}
											</TableCell>
										{/each}
									</TableRow>
								{/each}
								<!-- Total row -->
								<TableRow class="bg-muted/50 font-semibold border-t-2">
									<TableCell>Total {campaignTableData.length} campanii</TableCell>
									<TableCell></TableCell>
									{#each activePreset.columns as col}
										<TableCell class={col.align === 'right' ? 'text-right' : ''}>
											{col.getTotalValue ? col.getTotalValue(campaignTableData, currency) : '-'}
										</TableCell>
									{/each}
								</TableRow>
							</TableBody>
						</Table>
					</div>
				</div>
			{:else}
				<Card class="p-8 text-center">
					<p class="text-muted-foreground">Nu sunt date de campanii pentru perioada selectată.</p>
				</Card>
			{/if}
		{/if}
	{/if}
</div>
