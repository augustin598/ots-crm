<script lang="ts">
	import { getTiktokReportAdAccounts, getTiktokCampaignInsights, getTiktokActiveCampaigns } from '$lib/remotes/tiktok-reports.remote';
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
	import TiktokDemographicsSection from '$lib/components/reports/tiktok-demographics-section.svelte';
	import IconTiktok from '$lib/components/marketing/icon-tiktok.svelte';
	import DollarSignIcon from '@lucide/svelte/icons/dollar-sign';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import MousePointerClickIcon from '@lucide/svelte/icons/mouse-pointer-click';
	import PercentIcon from '@lucide/svelte/icons/percent';
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import ArrowUpDownIcon from '@lucide/svelte/icons/arrow-up-down';
	import ColumnsIcon from '@lucide/svelte/icons/columns-3';
	import { toast } from 'svelte-sonner';
	import {
		formatCurrency,
		formatPercent,
		formatNumber,
		getDefaultDateRange,
		computeTotals
	} from '$lib/utils/report-helpers';
	import {
		aggregateTiktokInsightsByDate,
		aggregateTiktokInsightsByCampaign,
		type TiktokCampaignAggregate
	} from '$lib/utils/tiktok-report-helpers';
	import { TIKTOK_COLUMN_PRESETS, TIKTOK_DEFAULT_PRESET, getTiktokPreset } from '$lib/utils/tiktok-column-presets';

	const tenantSlug = $derived(page.params.tenant as string);

	// Date range state
	const defaults = getDefaultDateRange();
	let since = $state(defaults.since);
	let until = $state(defaults.until);

	// Ad accounts
	const accountsQuery = getTiktokReportAdAccounts();
	const accounts = $derived(accountsQuery.current || []);
	const accountsLoading = $derived(accountsQuery.loading);

	let selectedAdvertiserId = $state<string>('');
	let selectedIntegrationId = $state<string>('');

	// Auto-select first account when data loads
	$effect(() => {
		if (accounts.length > 0 && !selectedAdvertiserId) {
			selectedAdvertiserId = accounts[0].tiktokAdvertiserId;
			selectedIntegrationId = accounts[0].integrationId;
		}
	});

	// Get currency from selected account
	const selectedCurrency = $derived.by(() => {
		const account = accounts.find((a: any) => a.tiktokAdvertiserId === selectedAdvertiserId);
		return account?.currency || 'RON';
	});

	// Token expiration warning (refresh token for TikTok)
	const tokenWarning = $derived.by(() => {
		const account = accounts.find((a: any) => a.tiktokAdvertiserId === selectedAdvertiserId);
		if (!account?.refreshTokenExpiresAt) return null;
		const expiresAt = new Date(account.refreshTokenExpiresAt);
		const now = new Date();
		const daysLeft = Math.floor((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
		if (daysLeft < 0) return { expired: true, text: `Token-ul TikTok Ads a expirat pe ${expiresAt.toLocaleDateString('ro-RO')}. Reconectează din Settings.` };
		if (daysLeft <= 14) return { expired: false, text: `Token-ul TikTok Ads expiră în ${daysLeft} zile (${expiresAt.toLocaleDateString('ro-RO')}). Reconectează din Settings pentru a evita întreruperi.` };
		return null;
	});

	function handleAccountChange(e: Event) {
		const value = (e.target as HTMLSelectElement).value;
		selectedAdvertiserId = value;
		const account = accounts.find((a: any) => a.tiktokAdvertiserId === value);
		selectedIntegrationId = account?.integrationId || '';
		selectedCampaigns = new Set();
		currentPage = 1;
	}

	// Campaign insights (reactive based on account + date range)
	let insightsQuery = $state<ReturnType<typeof getTiktokCampaignInsights> | null>(null);
	let campaignsQuery = $state<ReturnType<typeof getTiktokActiveCampaigns> | null>(null);

	$effect(() => {
		if (selectedAdvertiserId && selectedIntegrationId && since && until) {
			insightsQuery = getTiktokCampaignInsights({
				advertiserId: selectedAdvertiserId,
				integrationId: selectedIntegrationId,
				since,
				until
			});
			campaignsQuery = getTiktokActiveCampaigns({
				advertiserId: selectedAdvertiserId,
				integrationId: selectedIntegrationId
			});
		}
	});

	const insights = $derived(insightsQuery?.current || []);
	const insightsLoading = $derived(insightsQuery?.loading ?? false);
	const insightsError = $derived(insightsQuery?.error);

	const campaigns = $derived(campaignsQuery?.current || []);

	// Selection state
	let selectedCampaigns = $state<Set<string>>(new Set());

	// Filter insights by selected campaigns
	const filteredInsights = $derived(
		selectedCampaigns.size > 0
			? insights.filter((i: any) => selectedCampaigns.has(i.campaignId))
			: insights
	);

	// Campaign data always from ALL insights (table always shows full data)
	const campaignData = $derived(aggregateTiktokInsightsByCampaign(insights));

	// KPI cards, charts use filtered insights
	const dailyData = $derived(aggregateTiktokInsightsByDate(filteredInsights));
	const totals = $derived(computeTotals(dailyData));

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
			subtext: totalResults > 0 ? `${formatCurrency(costPer, selectedCurrency)} ${costLabel}` : 'Fără date'
		};
	});

	// Build campaign table data by merging insights with ALL campaigns
	const campaignTableData = $derived.by(() => {
		const insightMap = new Map(campaignData.map((c) => [c.campaignId, c]));
		const result: Array<TiktokCampaignAggregate & { status: string; dailyBudget: string | null; lifetimeBudget: string | null }> = [];

		for (const ci of campaigns) {
			const insight = insightMap.get(ci.campaignId);
			if (insight) {
				result.push({
					...insight,
					status: ci.status,
					dailyBudget: ci.dailyBudget || null,
					lifetimeBudget: ci.lifetimeBudget || null
				});
				insightMap.delete(ci.campaignId);
			} else if (ci.status === 'ACTIVE' || ci.status === 'IN_REVIEW') {
				result.push({
					campaignId: ci.campaignId,
					campaignName: ci.campaignName,
					objective: ci.objective,
					spend: 0, impressions: 0, reach: 0, frequency: 0, clicks: 0,
					conversions: 0, cpc: 0, cpm: 0, ctr: 0,
					costPerConversion: 0, resultType: '', cpaLabel: 'CPA',
					likes: 0, comments: 0, shares: 0, follows: 0, profileVisits: 0,
					videoViewsP25: 0, videoViewsP50: 0, videoViewsP75: 0, videoViewsP100: 0,
					videoViews2s: 0, videoViews6s: 0, focusedView6s: 0, averageVideoPlayPerUser: 0,
					status: ci.status,
					dailyBudget: ci.dailyBudget || null,
					lifetimeBudget: ci.lifetimeBudget || null
				});
			}
		}

		for (const [, c] of insightMap) {
			result.push({
				...c,
				status: 'UNKNOWN',
				dailyBudget: null,
				lifetimeBudget: null
			});
		}

		return result;
	});

	// Status filter
	let statusFilter = $state<'all' | 'active' | 'paused'>('all');
	const STATUS_FILTERS: { key: typeof statusFilter; label: string; activeClass: string }[] = [
		{ key: 'all', label: 'Toate', activeClass: 'bg-primary text-primary-foreground' },
		{ key: 'active', label: 'Active', activeClass: 'bg-green-600 text-white' },
		{ key: 'paused', label: 'Paused', activeClass: 'bg-amber-500 text-white' },
	];
	const filteredCampaigns = $derived.by(() => {
		if (statusFilter === 'all') return campaignTableData;
		if (statusFilter === 'active') return campaignTableData.filter(c => c.status === 'ACTIVE' || c.status === 'IN_REVIEW');
		if (statusFilter === 'paused') return campaignTableData.filter(c => c.status === 'PAUSED');
		return campaignTableData;
	});

	// Sorting
	let sortColumn = $state<keyof TiktokCampaignAggregate | 'status'>('status');
	let sortDirection = $state<'asc' | 'desc'>('asc');

	const STATUS_ORDER: Record<string, number> = { ACTIVE: 0, IN_REVIEW: 1, PAUSED: 2, REJECTED: 3, DELETED: 4, UNKNOWN: 5 };

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

	// Column presets
	let selectedPresetKey = $state(TIKTOK_DEFAULT_PRESET);
	const activePreset = $derived(getTiktokPreset(selectedPresetKey));

	// Pagination
	let pageSize = $state(25);
	let currentPage = $state(1);
	const totalEntries = $derived(sortedCampaigns.length);
	const totalPages = $derived(Math.max(1, Math.ceil(totalEntries / pageSize)));
	const safePage = $derived(Math.min(Math.max(1, currentPage), totalPages));
	const startIndex = $derived((safePage - 1) * pageSize);
	const endIndex = $derived(Math.min(startIndex + pageSize, totalEntries));
	const paginatedCampaigns = $derived(sortedCampaigns.slice(startIndex, endIndex));

	$effect(() => {
		if (currentPage > totalPages) currentPage = totalPages;
	});

	function handleSort(column: typeof sortColumn) {
		if (sortColumn === column) {
			sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
		} else {
			sortColumn = column;
			sortDirection = 'desc';
		}
		currentPage = 1;
	}

	function handleRefresh() {
		if (selectedAdvertiserId && selectedIntegrationId && since && until) {
			insightsQuery = getTiktokCampaignInsights({
				advertiserId: selectedAdvertiserId,
				integrationId: selectedIntegrationId,
				since,
				until
			});
			campaignsQuery = getTiktokActiveCampaigns({
				advertiserId: selectedAdvertiserId,
				integrationId: selectedIntegrationId
			});
			toast.success('Se reîncarcă datele...');
		}
	}

	const allSelected = $derived(paginatedCampaigns.length > 0 && paginatedCampaigns.every(c => selectedCampaigns.has(c.campaignId)));
	const someSelected = $derived(paginatedCampaigns.some(c => selectedCampaigns.has(c.campaignId)));

	function toggleSelectAll() {
		if (allSelected) {
			selectedCampaigns = new Set();
		} else {
			selectedCampaigns = new Set(paginatedCampaigns.map(c => c.campaignId));
		}
	}

	function toggleSelect(campaignId: string) {
		const next = new Set(selectedCampaigns);
		if (next.has(campaignId)) next.delete(campaignId);
		else next.add(campaignId);
		selectedCampaigns = next;
	}

	const dominantResultLabel = $derived.by(() => {
		const relevantInsights = selectedCampaigns.size > 0
			? campaignData.filter(c => selectedCampaigns.has(c.campaignId) && c.conversions > 0 && c.resultType)
			: campaignData.filter(c => c.conversions > 0 && c.resultType);
		if (relevantInsights.length === 0) return 'Rezultate';
		const typeCounts = new Map<string, number>();
		for (const c of relevantInsights) {
			typeCounts.set(c.resultType, (typeCounts.get(c.resultType) || 0) + c.conversions);
		}
		let dominant = 'Rezultate';
		let max = 0;
		for (const [type, count] of typeCounts) {
			if (count > max) { max = count; dominant = type; }
		}
		return dominant;
	});

	function getStatusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' {
		switch (status) {
			case 'ACTIVE': return 'success';
			case 'PAUSED': return 'warning';
			case 'DELETED': return 'destructive';
			case 'IN_REVIEW': case 'REJECTED': return 'secondary';
			default: return 'outline';
		}
	}
</script>

<div class="space-y-6">
	<!-- Header -->
	<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
		<div>
			<h1 class="text-3xl font-bold flex items-center gap-3">
				<IconTiktok class="h-8 w-8" />
				TikTok Ads
			</h1>
			<p class="text-muted-foreground">Rapoarte performanță campanii TikTok Ads</p>
		</div>
		<div class="flex flex-wrap items-center gap-2">
			<DateRangePicker bind:since bind:until onchange={() => { currentPage = 1; }} />
			{#if accounts.length > 0}
				<select
					class="h-9 rounded-md border border-input bg-background px-3 text-sm"
					value={selectedAdvertiserId}
					onchange={handleAccountChange}
				>
					{#each accounts as account}
						<option value={account.tiktokAdvertiserId}>
							{account.accountName || account.tiktokAdvertiserId}
							{#if account.clientName} — {account.clientName}{/if}
						</option>
					{/each}
				</select>
			{/if}
			<Button variant="outline" size="sm" onclick={handleRefresh}>
				<RefreshCwIcon class="h-4 w-4" />
			</Button>
		</div>
	</div>

	<!-- Token expiration warning -->
	{#if tokenWarning}
		<div class="rounded-md p-4 {tokenWarning.expired ? 'bg-red-50 border border-red-200' : 'bg-amber-50 border border-amber-200'}">
			<p class="text-sm {tokenWarning.expired ? 'text-red-800' : 'text-amber-800'}">
				{tokenWarning.text}
				<a href="/{tenantSlug}/settings/tiktok-ads" class="underline font-medium ml-1">Settings → TikTok Ads</a>
			</p>
		</div>
	{/if}

	<!-- Loading / Error / Empty states -->
	{#if accountsLoading}
		<div class="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
			{#each Array(5) as _}
				<Card class="p-4">
					<div class="flex items-center gap-3">
						<Skeleton class="h-12 w-12 rounded-lg" />
						<div class="space-y-2">
							<Skeleton class="h-3 w-20" />
							<Skeleton class="h-6 w-24" />
						</div>
					</div>
				</Card>
			{/each}
		</div>
	{:else if accounts.length === 0}
		<Card class="p-8 text-center">
			<p class="text-muted-foreground">Nu sunt conturi TikTok Ads configurate. Conectează un cont din <a href="/{tenantSlug}/settings/tiktok-ads" class="text-primary underline">Settings</a>.</p>
		</Card>
	{:else if insightsError}
		<Card class="p-8">
			<div class="rounded-md bg-red-50 p-4 space-y-2">
				<p class="text-sm font-medium text-red-800">{insightsError instanceof Error ? insightsError.message : 'Eroare la încărcarea datelor'}</p>
				<p class="text-sm text-red-700">
					Dacă tokenul a expirat, reconectează din
					<a href="/{tenantSlug}/settings/tiktok-ads" class="underline font-medium">Settings → TikTok Ads</a>.
				</p>
			</div>
		</Card>
	{:else}
		<!-- KPI Cards -->
		{#if insightsLoading}
			<div class="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
				{#each Array(5) as _}
					<Card class="p-4">
						<div class="flex items-center gap-3">
							<Skeleton class="h-12 w-12 rounded-lg" />
							<div class="space-y-2">
								<Skeleton class="h-3 w-20" />
								<Skeleton class="h-6 w-24" />
							</div>
						</div>
					</Card>
				{/each}
			</div>
		{:else}
			<div class="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
				<KpiCard
					label="Cheltuieli totale"
					value={formatCurrency(totals.totalSpend, selectedCurrency)}
					icon={DollarSignIcon}
					subtext="{formatNumber(totals.totalImpressions)} impresii"
				/>
				<KpiCard
					label="CPM"
					value={formatCurrency(totals.avgCpm, selectedCurrency)}
					icon={EyeIcon}
					subtext="Cost per 1000 impresii"
				/>
				<KpiCard
					label="CPC"
					value={formatCurrency(totals.avgCpc, selectedCurrency)}
					icon={MousePointerClickIcon}
					subtext="{formatNumber(totals.totalClicks)} click-uri"
				/>
				<KpiCard
					label="CTR"
					value={formatPercent(totals.avgCtr)}
					icon={PercentIcon}
					subtext="Click-through rate"
				/>
				<KpiCard
					label={resultKpi.label}
					value={resultKpi.value}
					icon={TrendingUpIcon}
					subtext={resultKpi.subtext}
				/>
			</div>
		{/if}

		<!-- Charts -->
		{#if !insightsLoading && dailyData.length > 0}
			<div class="grid gap-6 xl:grid-cols-2">
				<Card class="p-4">
					<h3 class="mb-4 text-lg font-semibold">Cheltuieli în timp</h3>
					<SpendChart data={dailyData.map(d => ({ date: d.date, spend: d.spend }))} currency={selectedCurrency} />
				</Card>
				<Card class="p-4">
					<h3 class="mb-4 text-lg font-semibold">Conversii & Cost per conversie</h3>
					<ConversionsChart data={dailyData.map(d => ({ date: d.date, conversions: d.conversions, costPerConversion: d.costPerConversion }))} currency={selectedCurrency} />
				</Card>
			</div>
		{/if}

		<!-- Demographics -->
		{#if !insightsLoading && selectedAdvertiserId && selectedIntegrationId}
			<TiktokDemographicsSection
				advertiserId={selectedAdvertiserId}
				integrationId={selectedIntegrationId}
				{since}
				{until}
				currency={selectedCurrency}
				campaignIds={[...selectedCampaigns]}
				resultLabel={dominantResultLabel}
			/>
		{/if}

		<!-- Campaign Performance Table -->
		{#if !insightsLoading}
			<div class="space-y-4">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-3">
						<h3 class="text-lg font-semibold">Performanță campanii</h3>
						<div class="flex items-center gap-1 rounded-lg border p-0.5">
							{#each STATUS_FILTERS as sf}
								<button
									class="px-3 py-1 text-xs rounded-md transition-colors {statusFilter === sf.key ? sf.activeClass : 'text-muted-foreground hover:text-foreground'}"
									onclick={() => { statusFilter = sf.key; currentPage = 1; selectedCampaigns = new Set(); }}
								>{sf.label}</button>
							{/each}
						</div>
					</div>
					<div class="flex items-center gap-3">
						{#if totalEntries > 0}
							<p class="text-sm text-muted-foreground">{filteredCampaigns.length} campanii</p>
						{/if}
						<div class="flex items-center gap-1.5">
							<ColumnsIcon class="h-4 w-4 text-muted-foreground" />
							<select
								class="h-8 rounded-md border border-input bg-background px-2 text-sm"
								value={selectedPresetKey}
								onchange={(e) => { selectedPresetKey = e.currentTarget.value; }}
							>
								{#each TIKTOK_COLUMN_PRESETS as preset}
									<option value={preset.key}>{preset.label}</option>
								{/each}
							</select>
						</div>
					</div>
				</div>

				{#if campaignTableData.length === 0}
					<Card class="p-8 text-center">
						<p class="text-muted-foreground">Nu sunt date de campanii pentru perioada selectată.</p>
					</Card>
				{:else}
					<div class="rounded-md border overflow-x-auto">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead class="w-[40px]">
										<Checkbox
											checked={allSelected}
											indeterminate={someSelected && !allSelected}
											onCheckedChange={() => toggleSelectAll()}
										/>
									</TableHead>
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
								{#each paginatedCampaigns as campaign}
									<TableRow>
										<TableCell class="w-[40px]">
											<Checkbox
												checked={selectedCampaigns.has(campaign.campaignId)}
												onCheckedChange={() => toggleSelect(campaign.campaignId)}
											/>
										</TableCell>
										<TableCell class="font-medium max-w-[250px]">
											<div class="truncate" title={campaign.campaignName}>{campaign.campaignName}</div>
											<div class="text-xs text-muted-foreground">{campaign.objective}</div>
										</TableCell>
										<TableCell>
											<Badge variant={getStatusVariant(campaign.status)}>
												{campaign.status}
											</Badge>
										</TableCell>
										{#each activePreset.columns as col}
											<TableCell class={col.align === 'right' ? 'text-right' : ''}>
												<div>{col.getValue(campaign, selectedCurrency)}</div>
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
									<TableCell></TableCell>
									<TableCell>Rezultate din {filteredCampaigns.length} campanii</TableCell>
									<TableCell></TableCell>
									{#each activePreset.columns as col}
										<TableCell class={col.align === 'right' ? 'text-right' : ''}>
											{col.getTotalValue ? col.getTotalValue(filteredCampaigns, selectedCurrency) : '-'}
										</TableCell>
									{/each}
								</TableRow>
							</TableBody>
						</Table>
					</div>

					{#if totalPages > 1}
						<div class="flex items-center justify-between">
							<div class="flex items-center gap-2 text-sm">
								<span class="text-muted-foreground">Arată</span>
								<select
									class="h-8 w-[70px] rounded-md border border-input bg-background px-2 text-sm"
									value={pageSize.toString()}
									onchange={(e) => { pageSize = parseInt(e.currentTarget.value); currentPage = 1; }}
								>
									<option value="10">10</option>
									<option value="25">25</option>
									<option value="50">50</option>
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
