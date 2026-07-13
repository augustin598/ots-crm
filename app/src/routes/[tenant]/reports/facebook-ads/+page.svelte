<script lang="ts">
	import '$lib/components/reports/rk/rk-report.css';
	import {
		getReportAdAccounts,
		getMetaCampaignInsights,
		getMetaActiveCampaigns,
		getMetaAdsetInsights,
		getMetaAdInsights,
		getMetaDemographicInsights,
		getMetaPlatformSplit,
		updateBudget,
		toggleCampaignStatus
	} from '$lib/remotes/reports.remote';
	import { getClientAccountBudgets } from '$lib/remotes/budget.remote';
	import { page } from '$app/state';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import SavedViewSelector from '$lib/components/reports/saved-view-selector.svelte';
	import DateRangePicker from '$lib/components/reports/date-range-picker.svelte';
	import type { SavedViewFilters } from '$lib/remotes/saved-views.remote';
	import { detectDatePreset, resolveDatePreset } from '$lib/utils/date-preset-resolver';

	import IconFacebook from '$lib/components/marketing/icon-facebook.svelte';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Bookmark from '@lucide/svelte/icons/bookmark';
	import Download from '@lucide/svelte/icons/download';
	import Target from '@lucide/svelte/icons/target';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Eye from '@lucide/svelte/icons/eye';
	import Image from '@lucide/svelte/icons/image';
	import AlertTriangle from '@lucide/svelte/icons/triangle-alert';
	import HeartPulse from '@lucide/svelte/icons/heart-pulse';
	import Check from '@lucide/svelte/icons/check';
	import Check2 from '@lucide/svelte/icons/circle-check';
	import Loader from '@lucide/svelte/icons/loader';
	import Play from '@lucide/svelte/icons/play';
	import Pause from '@lucide/svelte/icons/pause';
	import Search from '@lucide/svelte/icons/search';

	import KpiRow from '$lib/components/reports/rk/KpiRow.svelte';
	import SpendChart from '$lib/components/reports/rk/SpendChart.svelte';
	import ComboChart from '$lib/components/reports/rk/ComboChart.svelte';
	import AdvancedKpi from '$lib/components/reports/rk/AdvancedKpi.svelte';
	import Audience from '$lib/components/reports/rk/Audience.svelte';
	import Funnel from '$lib/components/reports/rk/Funnel.svelte';
	import PlatformSplit from '$lib/components/reports/rk/PlatformSplit.svelte';
	import FilterBar, { type RkFilters } from '$lib/components/reports/rk/FilterBar.svelte';
	import ColumnManager from '$lib/components/reports/rk/ColumnManager.svelte';
	import PresetSelect from '$lib/components/reports/rk/PresetSelect.svelte';
	import { rkIcon } from '$lib/components/reports/rk/rk-icons';
	import {
		aggregateMetrics,
		getObjectiveConfig,
		getObjectiveKpis,
		getDefaultKpis
	} from '$lib/components/reports/rk/rk-helpers';

	import {
		aggregateInsightsByDate,
		aggregateInsightsByCampaign,
		aggregateInsightsByAdset,
		aggregateInsightsByAd,
		formatCurrency,
		getDefaultDateRange,
		type CampaignAggregate,
		type AdsetAggregate,
		type AdAggregate
	} from '$lib/utils/report-helpers';
	import { COLUMN_PRESETS, DEFAULT_PRESET, getPreset, getRecommendedPreset, getColumn } from '$lib/utils/column-presets';
	import {
		calculateBudgetBurnForecast,
		calculateCpaMomentum,
		calculateFunnelAnalysis,
		calculateSaturationMatrix,
		calculateDayOfWeekPerformance,
		generateExecutiveSummary,
		calculateCampaignFatigue
	} from '$lib/utils/advanced-kpi';
	import { detectAnomalies, getAnomalySummary } from '$lib/utils/anomaly-detection';
	import { calculateHealthScore, calculateAverageHealthScore } from '$lib/utils/health-score';
	import { onDestroy } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { clientLogger } from '$lib/client-logger';

	const tenantSlug = $derived(page.params.tenant as string);

	// ---- Date range ----
	const defaults = getDefaultDateRange();
	let since = $state(defaults.since);
	let until = $state(defaults.until);

	// ---- Accounts ----
	const accountsQuery = getReportAdAccounts();
	const accounts = $derived(accountsQuery.current || []);
	const accountsLoading = $derived(accountsQuery.loading);

	let selectedAccountId = $state<string>('');
	let selectedIntegrationId = $state<string>('');

	$effect(() => {
		if (accounts.length > 0 && !selectedAccountId) {
			const urlAccount = page.url.searchParams.get('account');
			const match = urlAccount && accounts.find((a: any) => a.metaAdAccountId === urlAccount);
			const account = match || accounts[0];
			selectedAccountId = account.metaAdAccountId;
			selectedIntegrationId = account.integrationId;
		}
	});

	const selectedAccount = $derived(accounts.find((a: any) => a.metaAdAccountId === selectedAccountId));
	const selectedCurrency = $derived(selectedAccount?.currency || 'RON');
	const selectedClientId = $derived(selectedAccount?.clientId as string | undefined);
	const accountLabel = $derived(selectedAccount?.accountName || selectedAccountId || 'Selectează cont');

	const accountBudgetsQuery = $derived(selectedClientId ? getClientAccountBudgets({ clientId: selectedClientId }) : null);
	const monthlyBudget = $derived.by(() => {
		const budgets = accountBudgetsQuery?.current;
		if (!budgets) return undefined;
		return budgets.meta.find((a) => a.metaAdAccountId === selectedAccountId)?.monthlyBudget ?? undefined;
	});

	// ---- Warnings ----
	const paymentWarning = $derived.by(() => {
		const account = selectedAccount;
		if (!account) return null;
		if (account.disableReason === 3) return { level: 'error' as const, text: 'Contul Meta Ads a fost dezactivat din cauza problemelor de plată. Verifică metoda de plată în Business Manager.' };
		if (account.accountStatus === 3) return { level: 'error' as const, text: 'Contul Meta Ads are o factură neachitată (UNSETTLED). Reclamele pot fi oprite până la plată.' };
		if (account.accountStatus === 9) return { level: 'warning' as const, text: 'Contul Meta Ads e în perioadă de grație pentru plată. Achită factura pentru a evita oprirea reclamelor.' };
		return null;
	});
	const tokenWarning = $derived.by(() => {
		const account = selectedAccount;
		if (!account) return null;
		if (account.integrationActive === false) return { expired: true, text: 'Conexiunea Meta Ads pentru acest cont a fost dezactivată (token revocat/invalid). Reconectează din Settings.' };
		if (account.isActive === false) return { expired: true, text: 'Acest cont Meta Ads este dezactivat. Verifică starea în Business Manager sau reconectează din Settings.' };
		if (!account.tokenExpiresAt) return null;
		const expiresAt = new Date(account.tokenExpiresAt);
		const daysLeft = Math.floor((expiresAt.getTime() - Date.now()) / 86400000);
		if (daysLeft < 0) return { expired: true, text: `Tokenul Meta Ads a expirat pe ${expiresAt.toLocaleDateString('ro-RO')}. Reconectează din Settings.` };
		if (daysLeft <= 7) return { expired: false, text: `Tokenul Meta Ads expiră în ${daysLeft} zile (${expiresAt.toLocaleDateString('ro-RO')}). Reconectează din Settings.` };
		return null;
	});

	function handleAccountChange(value: string) {
		selectedAccountId = value;
		selectedIntegrationId = accounts.find((a: any) => a.metaAdAccountId === value)?.integrationId || '';
		selectedCampaigns = new Set();
		currentPage = 1;
		userOverrodePreset = false;
		filters = emptyFilters();
	}

	// ---- Queries ----
	let insightsQuery = $state<ReturnType<typeof getMetaCampaignInsights> | null>(null);
	let prevInsightsQuery = $state<ReturnType<typeof getMetaCampaignInsights> | null>(null);
	let campaignsQuery = $state<ReturnType<typeof getMetaActiveCampaigns> | null>(null);
	let platformQuery = $state<ReturnType<typeof getMetaPlatformSplit> | null>(null);
	let demographicsQuery = $state<ReturnType<typeof getMetaDemographicInsights> | null>(null);

	const prevPeriod = $derived.by(() => {
		const s = new Date(since + 'T00:00:00');
		const u = new Date(until + 'T00:00:00');
		const durationMs = u.getTime() - s.getTime() + 86400000;
		const prevEnd = new Date(s.getTime() - 86400000);
		const prevStart = new Date(prevEnd.getTime() - durationMs + 86400000);
		const pad = (n: number) => String(n).padStart(2, '0');
		const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
		return { since: fmt(prevStart), until: fmt(prevEnd) };
	});

	$effect(() => {
		if (selectedAccountId && selectedIntegrationId && since && until) {
			insightsQuery = getMetaCampaignInsights({ adAccountId: selectedAccountId, integrationId: selectedIntegrationId, since, until, timeIncrement: 'daily' });
			prevInsightsQuery = getMetaCampaignInsights({ adAccountId: selectedAccountId, integrationId: selectedIntegrationId, since: prevPeriod.since, until: prevPeriod.until, timeIncrement: 'daily' });
			campaignsQuery = getMetaActiveCampaigns({ adAccountId: selectedAccountId, integrationId: selectedIntegrationId });
			platformQuery = getMetaPlatformSplit({ adAccountId: selectedAccountId, integrationId: selectedIntegrationId, since, until });
			demographicsQuery = getMetaDemographicInsights({ adAccountId: selectedAccountId, integrationId: selectedIntegrationId, since, until });
		}
	});

	const insights = $derived(insightsQuery?.current || []);
	const insightsLoading = $derived(insightsQuery?.loading ?? false);
	const insightsError = $derived(insightsQuery?.error);
	const prevInsights = $derived(prevInsightsQuery?.current || []);
	const campaigns = $derived(campaignsQuery?.current || []);
	const platformSplit = $derived(platformQuery?.current ?? null);
	const platformLoading = $derived(platformQuery?.loading ?? false);
	const demographics = $derived(demographicsQuery?.current ?? null);
	const demographicsLoading = $derived(demographicsQuery?.loading ?? false);

	// ---- Build merged campaign table data (campaign meta + insight aggregate) ----
	const campaignData = $derived(aggregateInsightsByCampaign(insights));
	type Row = CampaignAggregate & {
		status: string;
		dailyBudget: string | null;
		lifetimeBudget: string | null;
		budgetSource: string;
		adsetId: string | null;
		previewUrl: string | null;
		startTime: string | null;
		stopTime: string | null;
	};
	const campaignTableData = $derived.by<Row[]>(() => {
		const insightMap = new Map(campaignData.map((c) => [c.campaignId, c]));
		const result: Row[] = [];
		for (const ci of campaigns) {
			const insight = insightMap.get(ci.campaignId);
			if (insight) {
				result.push({ ...insight, status: ci.status, dailyBudget: ci.dailyBudget || null, lifetimeBudget: ci.lifetimeBudget || null, budgetSource: ci.budgetSource || 'campaign', adsetId: ci.adsetId || null, previewUrl: ci.previewUrl || null, startTime: ci.startTime || null, stopTime: ci.stopTime || null });
				insightMap.delete(ci.campaignId);
			} else if (ci.status === 'ACTIVE' || ci.status === 'WITH_ISSUES' || ci.status === 'IN_PROCESS') {
				result.push({
					campaignId: ci.campaignId, campaignName: ci.campaignName, objective: ci.objective,
					spend: 0, impressions: 0, reach: 0, frequency: 0, clicks: 0, conversions: 0, conversionValue: 0,
					cpc: 0, cpm: 0, ctr: 0, costPerConversion: 0, roas: 0, resultType: '', cpaLabel: 'CPA',
					purchases: 0, leads: 0, linkClicks: 0, landingPageViews: 0, pageEngagement: 0,
					postReactions: 0, postComments: 0, postSaves: 0, postShares: 0, videoViews: 0, callsPlaced: 0,
					rawActions: [], status: ci.status, dailyBudget: ci.dailyBudget || null, lifetimeBudget: ci.lifetimeBudget || null,
					budgetSource: ci.budgetSource || 'campaign', adsetId: ci.adsetId || null, previewUrl: ci.previewUrl || null, startTime: ci.startTime || null, stopTime: ci.stopTime || null
				});
			}
		}
		for (const [, c] of insightMap) {
			result.push({ ...c, status: 'UNKNOWN', dailyBudget: null, lifetimeBudget: null, budgetSource: 'campaign', adsetId: null, previewUrl: null, startTime: null, stopTime: null });
		}
		return result;
	});

	// ---- Filters ----
	function emptyFilters(): RkFilters {
		return { q: '', status: [], objectives: [], platforms: [], placements: [], budgetMin: null, budgetMax: null, thresholds: { ctrMin: null, roasMin: null, cpaMax: null }, owner: '' };
	}
	let filters = $state<RkFilters>(emptyFilters());

	// Owner = the client that owns the ad account (Meta has no per-campaign owner field).
	const ownerOptions = $derived([...new Set(accounts.map((a: any) => a.clientName).filter(Boolean))] as string[]);

	const objectiveOptions = $derived.by(() => {
		const map = new Map<string, { key: string; label: string; icon: string; color: string }>();
		for (const c of campaignTableData) {
			const cfg = getObjectiveConfig(c.objective);
			if (!map.has(cfg.label)) map.set(cfg.label, { key: cfg.label, label: cfg.label, icon: cfg.icon, color: cfg.color });
		}
		return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
	});

	function statusMatches(s: string, fs: string): boolean {
		if (fs === 'ACTIVE') return s === 'ACTIVE';
		if (fs === 'WITH_ISSUES') return s === 'WITH_ISSUES';
		if (fs === 'PAUSED') return s === 'PAUSED' || s === 'CAMPAIGN_PAUSED';
		if (fs === 'IN_REVIEW') return s === 'IN_PROCESS' || s === 'IN_REVIEW';
		if (fs === 'DRAFT') return s === 'DRAFT';
		return false;
	}

	function passesFilters(c: Row): boolean {
		const q = filters.q.trim().toLowerCase();
		if (q && !`${c.campaignName} ${c.campaignId}`.toLowerCase().includes(q)) return false;
		if (filters.status.length && !filters.status.some((fs) => statusMatches(c.status, fs))) return false;
		if (filters.objectives.length && !filters.objectives.includes(getObjectiveConfig(c.objective).label)) return false;
		// Platform / placement: kept for UI parity; per-campaign platform breakdown is not
		// available client-side, so these chips do not exclude rows.
		if (filters.budgetMin != null || filters.budgetMax != null) {
			const b = c.dailyBudget ? parseFloat(c.dailyBudget) / 100 : null;
			if (b == null) return false;
			if (filters.budgetMin != null && b < filters.budgetMin) return false;
			if (filters.budgetMax != null && b > filters.budgetMax) return false;
		}
		const t = filters.thresholds;
		const ctrLink = c.impressions > 0 ? (c.linkClicks / c.impressions) * 100 : 0;
		if (t.ctrMin != null && ctrLink < t.ctrMin) return false;
		if (t.roasMin != null && c.roas < t.roasMin) return false;
		if (t.cpaMax != null && (c.conversions === 0 || c.costPerConversion > t.cpaMax)) return false;
		if (filters.owner && selectedAccount?.clientName !== filters.owner) return false;
		return true;
	}

	const filteredRows = $derived(campaignTableData.filter(passesFilters));
	const filteredIds = $derived(new Set(filteredRows.map((c) => c.campaignId)));
	const filteredInsights = $derived(insights.filter((i: any) => filteredIds.has(i.campaignId)));
	const prevFilteredInsights = $derived(prevInsights.filter((i: any) => filteredIds.has(i.campaignId)));

	// ---- KPI / charts source (filtered, else all) ----
	const hasFilter = $derived(filteredRows.length !== campaignTableData.length || filteredRows.length === 0);
	const kpiInsights = $derived(filteredRows.length > 0 ? filteredInsights : insights);
	const kpiCampaignAgg = $derived(aggregateInsightsByCampaign(kpiInsights));
	const prevCampaignAgg = $derived(aggregateInsightsByCampaign(filteredRows.length > 0 ? prevFilteredInsights : prevInsights));
	const metrics = $derived(aggregateMetrics(kpiCampaignAgg));
	const prevMetrics = $derived(aggregateMetrics(prevCampaignAgg));

	const dominantObjective = $derived.by(() => {
		const objs = [...new Set(filteredRows.map((c) => getObjectiveConfig(c.objective).label))];
		if (objs.length !== 1) return '';
		const code = filteredRows.find((c) => getObjectiveConfig(c.objective).label === objs[0])?.objective || '';
		return code;
	});

	const kpis = $derived.by(() => {
		if (dominantObjective) {
			const k = getObjectiveKpis(dominantObjective, metrics, prevMetrics, selectedCurrency);
			if (k) return k;
		}
		return getDefaultKpis(metrics, prevMetrics, selectedCurrency);
	});

	const dailyData = $derived(aggregateInsightsByDate(kpiInsights));
	const comboSeries = $derived(dailyData.map((d) => ({ date: d.date, result: d.conversions, cost: d.conversions > 0 ? d.spend / d.conversions : 0 })));
	const resultLabel = $derived.by(() => {
		const withRes = kpiCampaignAgg.filter((c) => c.conversions > 0 && c.resultType);
		if (!withRes.length) return 'Rezultate';
		const counts = new Map<string, number>();
		for (const c of withRes) counts.set(c.resultType, (counts.get(c.resultType) || 0) + c.conversions);
		return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0] || 'Rezultate';
	});
	const funnelTotals = $derived({
		impressions: kpiCampaignAgg.reduce((s, c) => s + c.impressions, 0),
		linkClicks: kpiCampaignAgg.reduce((s, c) => s + c.linkClicks, 0),
		landingPageViews: kpiCampaignAgg.reduce((s, c) => s + c.landingPageViews, 0),
		conversions: kpiCampaignAgg.reduce((s, c) => s + c.conversions, 0)
	});

	// ---- Health / anomalies / fatigue (over all campaign data) ----
	const healthScores = $derived(new Map(campaignData.filter((c) => c.spend > 0 && c.impressions >= 1000).map((c) => [c.campaignId, calculateHealthScore(c)])));
	const campaignAnomalies = $derived(detectAnomalies(campaignData));
	const anomalySummary = $derived(getAnomalySummary(campaignAnomalies));
	const campaignDailyMap = $derived.by(() => {
		const map = new Map<string, ReturnType<typeof aggregateInsightsByDate>>();
		for (const c of campaignData) {
			const ci = insights.filter((i: any) => i.campaignId === c.campaignId);
			if (ci.length) map.set(c.campaignId, aggregateInsightsByDate(ci));
		}
		return map;
	});
	const campaignFatigue = $derived(calculateCampaignFatigue(campaignDailyMap));

	// ---- Advanced KPI (filtered) ----
	const advHealth = $derived(calculateAverageHealthScore(kpiCampaignAgg));
	const execSummary = $derived(generateExecutiveSummary(kpiCampaignAgg, healthScores, campaignFatigue));
	const budgetForecast = $derived(calculateBudgetBurnForecast(dailyData, monthlyBudget));
	const cpaMomentum = $derived(calculateCpaMomentum(dailyData));
	const funnelAnalysis = $derived(calculateFunnelAnalysis(kpiCampaignAgg));
	const saturationMatrix = $derived(calculateSaturationMatrix(kpiCampaignAgg));
	const dayOfWeekData = $derived(calculateDayOfWeekPerformance(dailyData));
	let advancedOpen = $state(false);

	// ---- Status segment + tip tabs (map onto filters) ----
	const statusTab = $derived(
		filters.status.length === 0
			? 'all'
			: filters.status.length === 2 && filters.status.includes('ACTIVE') && filters.status.includes('WITH_ISSUES')
				? 'active'
				: filters.status.length === 1 && filters.status[0] === 'PAUSED'
					? 'paused'
					: 'custom'
	);
	function setStatusTab(tab: string) {
		filters = { ...filters, status: tab === 'all' ? [] : tab === 'active' ? ['ACTIVE', 'WITH_ISSUES'] : ['PAUSED'] };
		currentPage = 1;
	}
	function setTip(label: string | null) {
		filters = { ...filters, objectives: label ? [label] : [] };
		currentPage = 1;
		userOverrodePreset = false;
	}

	// ---- Column presets + manager ----
	let selectedPresetKey = $state(DEFAULT_PRESET);
	let userOverrodePreset = $state(false);
	let visibleColKeys = $state<string[]>(getPreset(DEFAULT_PRESET).columns.map((c) => c.key));

	$effect(() => {
		if (userOverrodePreset) return;
		const objectives = filteredRows.map((c) => c.objective).filter(Boolean);
		const rec = getRecommendedPreset(objectives);
		if (rec !== selectedPresetKey) {
			selectedPresetKey = rec;
			visibleColKeys = getPreset(rec).columns.map((c) => c.key);
		}
	});

	function onPresetChange(key: string) {
		selectedPresetKey = key;
		visibleColKeys = getPreset(key).columns.map((c) => c.key);
		userOverrodePreset = true;
	}
	const visibleCols = $derived(visibleColKeys.map((k) => getColumn(k)).filter((c): c is NonNullable<typeof c> => !!c));

	// ---- Sorting ----
	let sortColumn = $state<string>('spend');
	let sortDirection = $state<'asc' | 'desc'>('desc');
	function handleSort(key: string) {
		if (sortColumn === key) sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
		else {
			sortColumn = key;
			sortDirection = 'desc';
		}
		currentPage = 1;
	}
	const sortedCampaigns = $derived.by(() => {
		const dir = sortDirection === 'asc' ? 1 : -1;
		return [...filteredRows].sort((a, b) => {
			if (sortColumn === 'campaignName') return dir * a.campaignName.localeCompare(b.campaignName);
			const av = (a as any)[sortColumn] ?? 0;
			const bv = (b as any)[sortColumn] ?? 0;
			if (typeof av === 'string' && typeof bv === 'string') return dir * av.localeCompare(bv);
			return dir * (Number(av) - Number(bv));
		});
	});

	// ---- Pagination ----
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

	// ---- Selection ----
	let selectedCampaigns = $state<Set<string>>(new Set());
	const allSelected = $derived(sortedCampaigns.length > 0 && sortedCampaigns.every((c) => selectedCampaigns.has(c.campaignId)));
	const someSelected = $derived(!allSelected && sortedCampaigns.some((c) => selectedCampaigns.has(c.campaignId)));
	function toggleSelectAll() {
		selectedCampaigns = allSelected ? new Set() : new Set(sortedCampaigns.map((c) => c.campaignId));
	}
	function toggleSelect(id: string) {
		const n = new Set(selectedCampaigns);
		if (n.has(id)) n.delete(id);
		else n.add(id);
		selectedCampaigns = n;
	}

	// ---- Totals budget ----
	const totalsBudget = $derived(
		filteredRows.reduce((s, c) => s + (c.dailyBudget ? parseFloat(c.dailyBudget) / 100 : 0), 0)
	);

	// ---- Saved views ----
	const currentFilters = $derived<SavedViewFilters>({
		datePreset: detectDatePreset(since, until),
		since: detectDatePreset(since, until) ? null : since,
		until: detectDatePreset(since, until) ? null : until,
		accountId: selectedAccountId,
		columnPreset: selectedPresetKey,
		objectiveFilter: filters.objectives[0] ?? 'all',
		statusFilter: statusTab,
		pageSize
	});
	function applyView(f: SavedViewFilters) {
		if (f.datePreset) {
			const d = resolveDatePreset(f.datePreset);
			if (d) {
				since = d.since;
				until = d.until;
			}
		} else if (f.since && f.until) {
			since = f.since;
			until = f.until;
		}
		if (f.accountId) {
			const acc = accounts.find((a: any) => a.metaAdAccountId === f.accountId);
			if (acc) {
				selectedAccountId = f.accountId;
				selectedIntegrationId = acc.integrationId;
			}
		}
		selectedPresetKey = f.columnPreset;
		visibleColKeys = getPreset(f.columnPreset).columns.map((c) => c.key);
		userOverrodePreset = true;
		filters = { ...emptyFilters(), objectives: f.objectiveFilter && f.objectiveFilter !== 'all' ? [f.objectiveFilter] : [], status: f.statusFilter === 'active' ? ['ACTIVE', 'WITH_ISSUES'] : f.statusFilter === 'paused' ? ['PAUSED'] : [] };
		pageSize = f.pageSize;
		currentPage = 1;
		selectedCampaigns = new Set();
	}

	// ---- CSV export ----
	function exportCSV() {
		const headers = ['Campanie', 'Status', ...visibleCols.map((c) => c.label)];
		const rows = sortedCampaigns.map((c) => [`"${c.campaignName.replace(/"/g, '""')}"`, c.status, ...visibleCols.map((col) => `"${col.getValue(c, selectedCurrency).replace(/"/g, '""')}"`)]);
		const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
		const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `facebook-ads-${since}-${until}.csv`;
		a.click();
		URL.revokeObjectURL(url);
		toastMsg('Export CSV generat');
	}

	// ---- Refresh ----
	function handleRefresh() {
		if (selectedAccountId && selectedIntegrationId && since && until) {
			insightsQuery = getMetaCampaignInsights({ adAccountId: selectedAccountId, integrationId: selectedIntegrationId, since, until, timeIncrement: 'daily' });
			campaignsQuery = getMetaActiveCampaigns({ adAccountId: selectedAccountId, integrationId: selectedIntegrationId });
			platformQuery = getMetaPlatformSplit({ adAccountId: selectedAccountId, integrationId: selectedIntegrationId, since, until });
			demographicsQuery = getMetaDemographicInsights({ adAccountId: selectedAccountId, integrationId: selectedIntegrationId, since, until });
			toastMsg('Se reîncarcă datele…');
		}
	}

	// ---- Toast ----
	let toastText = $state<string | null>(null);
	let toastTimer: ReturnType<typeof setTimeout> | null = null;
	function toastMsg(msg: string) {
		toastText = msg;
		if (toastTimer) clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toastText = null), 2600);
	}

	// ---- Budget edit ----
	let budgetDialogOpen = $state(false);
	let budgetEditCampaign = $state<{ targetId: string; campaignName: string; budgetType: 'daily' | 'lifetime'; currentAmount: number } | null>(null);
	let budgetNewAmount = $state('');
	let budgetSaving = $state(false);
	function openBudgetEdit(c: Row) {
		const type = c.dailyBudget ? 'daily' : 'lifetime';
		const current = c.dailyBudget ? parseFloat(c.dailyBudget) / 100 : c.lifetimeBudget ? parseFloat(c.lifetimeBudget) / 100 : 0;
		const targetId = c.budgetSource === 'adset' && c.adsetId ? c.adsetId : c.campaignId;
		budgetEditCampaign = { targetId, campaignName: c.campaignName, budgetType: type, currentAmount: current };
		budgetNewAmount = String(current);
		budgetDialogOpen = true;
	}
	async function handleBudgetSave() {
		if (!budgetEditCampaign || !selectedIntegrationId) return;
		const amount = parseFloat(budgetNewAmount);
		if (isNaN(amount) || amount < 1) {
			clientLogger.warn({ message: 'Buget invalid (minim 1 RON/zi).', action: 'fb_report_budget_save' });
			return;
		}
		budgetSaving = true;
		try {
			await updateBudget({ targetId: budgetEditCampaign.targetId, integrationId: selectedIntegrationId, budgetType: budgetEditCampaign.budgetType, budgetAmount: amount });
			toastMsg(`Buget actualizat: ${amount} ${selectedCurrency}`);
			budgetDialogOpen = false;
			handleRefresh();
		} catch (e) {
			clientLogger.apiError('fb_report_budget_save', e);
		} finally {
			budgetSaving = false;
		}
	}

	// ---- Toggle status (single + bulk) ----
	let togglingCampaignId = $state<string | null>(null);
	async function handleToggleStatus(c: Row) {
		if (!selectedIntegrationId) return;
		const newStatus = c.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
		togglingCampaignId = c.campaignId;
		try {
			await toggleCampaignStatus({ campaignId: c.campaignId, integrationId: selectedIntegrationId, newStatus });
			toastMsg(`Campania "${c.campaignName}" a fost ${newStatus === 'ACTIVE' ? 'pornită' : 'oprită'}`);
			handleRefresh();
		} catch (e) {
			clientLogger.apiError('fb_report_toggle_status', e);
		} finally {
			togglingCampaignId = null;
		}
	}
	async function bulkToggle(toActive: boolean) {
		if (!selectedIntegrationId) return;
		const targets = sortedCampaigns.filter((c) => selectedCampaigns.has(c.campaignId) && (toActive ? c.status !== 'ACTIVE' : c.status === 'ACTIVE'));
		for (const c of targets) {
			try {
				await toggleCampaignStatus({ campaignId: c.campaignId, integrationId: selectedIntegrationId, newStatus: toActive ? 'ACTIVE' : 'PAUSED' });
			} catch (e) {
				clientLogger.apiError('fb_report_bulk_toggle', e);
			}
		}
		toastMsg(toActive ? 'Campanii pornite' : 'Campanii pauzate');
		selectedCampaigns = new Set();
		handleRefresh();
	}

	// ---- Expandable adset/ad ----
	const activeIntervals = new Set<ReturnType<typeof setInterval>>();
	onDestroy(() => {
		for (const id of activeIntervals) clearInterval(id);
		if (toastTimer) clearTimeout(toastTimer);
	});
	let expandedCampaigns = $state<Set<string>>(new Set());
	let adsetData = $state<Map<string, AdsetAggregate[]>>(new Map());
	let adsetLoading = $state<Set<string>>(new Set());
	let expandedAdsets = $state<Set<string>>(new Set());
	let adsData = $state<Map<string, AdAggregate[]>>(new Map());
	let adsLoading = $state<Set<string>>(new Set());

	function toggleExpand(campaignId: string) {
		const next = new Set(expandedCampaigns);
		if (next.has(campaignId)) {
			next.delete(campaignId);
			expandedCampaigns = next;
			return;
		}
		next.add(campaignId);
		expandedCampaigns = next;
		if (!adsetData.has(campaignId) && selectedAccountId && selectedIntegrationId) {
			const l = new Set(adsetLoading);
			l.add(campaignId);
			adsetLoading = l;
			const query = getMetaAdsetInsights({ adAccountId: selectedAccountId, integrationId: selectedIntegrationId, campaignId, since, until });
			const iv = setInterval(() => {
				if (!query.loading) {
					clearInterval(iv);
					activeIntervals.delete(iv);
					const d = new Set(adsetLoading);
					d.delete(campaignId);
					adsetLoading = d;
					if (query.current) {
						const m = new Map(adsetData);
						m.set(campaignId, aggregateInsightsByAdset(query.current));
						adsetData = m;
					}
				}
			}, 100);
			activeIntervals.add(iv);
		}
	}
	function toggleExpandAdset(adsetId: string) {
		const next = new Set(expandedAdsets);
		if (next.has(adsetId)) {
			next.delete(adsetId);
			expandedAdsets = next;
			return;
		}
		next.add(adsetId);
		expandedAdsets = next;
		if (!adsData.has(adsetId) && selectedAccountId && selectedIntegrationId) {
			const l = new Set(adsLoading);
			l.add(adsetId);
			adsLoading = l;
			const query = getMetaAdInsights({ adAccountId: selectedAccountId, integrationId: selectedIntegrationId, adsetId, since, until });
			const iv = setInterval(() => {
				if (!query.loading) {
					clearInterval(iv);
					activeIntervals.delete(iv);
					const d = new Set(adsLoading);
					d.delete(adsetId);
					adsLoading = d;
					if (query.current) {
						const m = new Map(adsData);
						m.set(adsetId, aggregateInsightsByAd(query.current));
						adsData = m;
					}
				}
			}, 100);
			activeIntervals.add(iv);
		}
	}

	// ---- Status badge config ----
	function statusBadge(status: string): { cls: string; label: string; pulse: boolean } {
		switch (status) {
			case 'ACTIVE': return { cls: 'success', label: 'Active', pulse: true };
			case 'WITH_ISSUES': return { cls: 'warn', label: 'Cu probleme', pulse: false };
			case 'PAUSED':
			case 'CAMPAIGN_PAUSED': return { cls: 'muted', label: 'Paused', pulse: false };
			case 'IN_PROCESS': return { cls: 'info', label: 'În review', pulse: false };
			case 'DRAFT': return { cls: 'outline', label: 'Draft', pulse: false };
			case 'DELETED':
			case 'ARCHIVED': return { cls: 'destructive', label: status === 'DELETED' ? 'Șters' : 'Arhivat', pulse: false };
			default: return { cls: 'outline', label: status, pulse: false };
		}
	}

	const colCount = $derived(visibleCols.length + 5);
</script>

<div class="rk-report">
	<div class="rk-content">
		<!-- Page header -->
		<div class="rk-pagehead">
			<div class="rk-pagetitle">
				<span class="rk-fbicon"><IconFacebook class="h-7 w-7" /></span>
				<div><h1>Facebook Ads</h1><p>Rapoarte performanță campanii Meta / Facebook &amp; Instagram</p></div>
			</div>
			<div class="rk-pagehead-actions">
				{#if accounts.length > 0}
					<select class="rk-select" value={selectedAccountId} onchange={(e) => handleAccountChange(e.currentTarget.value)} aria-label="Cont publicitar">
						{#each accounts as account (account.metaAdAccountId)}
							<option value={account.metaAdAccountId}>{account.accountName || account.metaAdAccountId}{#if account.clientName} — {account.clientName}{/if}{#if account.integrationActive === false} ⚠{/if}</option>
						{/each}
					</select>
				{/if}
				<button class="rk-icon-btn" title="Salvează ca favorit" aria-label="Salvează ca favorit"><Bookmark size={15} /></button>
				<SavedViewSelector platform="meta" {tenantSlug} currentAccountId={selectedAccountId} {currentFilters} onApplyView={applyView} />
				<DateRangePicker bind:since bind:until onchange={() => { currentPage = 1; filters = emptyFilters(); selectedCampaigns = new Set(); userOverrodePreset = false; }} />
				<a href="/{tenantSlug}/reports/facebook-ads/monitoring" title="Monitoring target-uri"><button class="rk-hbtn"><Target size={14} /> Monitoring</button></a>
				<button class="rk-icon-btn" title="Reîncarcă" aria-label="Reîncarcă" onclick={handleRefresh}><RefreshCw size={15} /></button>
			</div>
		</div>

		{#if paymentWarning}
			<div class="rk-alert {paymentWarning.level}">
				<span>{paymentWarning.level === 'error' ? '💳' : '⚠️'}</span>
				<span>{paymentWarning.text} <a href="https://business.facebook.com/billing" target="_blank" rel="noopener noreferrer">Mergi la facturare →</a></span>
			</div>
		{/if}
		{#if tokenWarning}
			<div class="rk-alert {tokenWarning.expired ? 'error' : 'warning'}">
				<span>{tokenWarning.text} <a href="/{tenantSlug}/settings/meta-ads">Settings → Meta Ads</a></span>
			</div>
		{/if}

		{#if accountsLoading}
			<div class="rk-kpi-grid">{#each [0, 1, 2, 3, 4] as i (i)}<div class="rk-kpi"><div class="rk-skel" style="width:40px;height:40px;border-radius:11px"></div><div class="rk-kpi-body" style="flex:1"><div class="rk-skel" style="height:12px;width:60%;margin-bottom:8px"></div><div class="rk-skel" style="height:22px;width:80%"></div></div></div>{/each}</div>
		{:else if accounts.length === 0}
			<div class="rk-card" style="text-align:center;padding:32px"><p class="rk-card-sub">Nu sunt conturi Meta Ads configurate. Conectează un Business Manager din <a href="/{tenantSlug}/settings/meta-ads" style="color:var(--rk-accent)">Settings</a>.</p></div>
		{:else if insightsError}
			<div class="rk-card"><div class="rk-alert error"><span>{(insightsError as any)?.body?.message || (insightsError instanceof Error ? insightsError.message : null) || 'Eroare la încărcarea datelor.'} <a href="/{tenantSlug}/settings/meta-ads">Settings → Meta Ads</a></span></div></div>
		{:else}
			{#if !insightsLoading && anomalySummary.total > 0}
				<div class="rk-alert warning"><span>⚠️</span><span><strong>Atenție:</strong> {anomalySummary.criticalCount > 0 ? `${anomalySummary.criticalCount} probleme critice` : ''}{anomalySummary.criticalCount > 0 && anomalySummary.warningCount > 0 ? ' și ' : ''}{anomalySummary.warningCount > 0 ? `${anomalySummary.warningCount} avertismente` : ''} detectate. Verifică campaniile marcate în tabel.</span></div>
			{/if}

			<!-- KPI cards -->
			{#if insightsLoading}
				<div class="rk-kpi-grid">{#each [0, 1, 2, 3, 4] as i (i)}<div class="rk-kpi"><div class="rk-skel" style="width:40px;height:40px;border-radius:11px"></div><div class="rk-kpi-body" style="flex:1"><div class="rk-skel" style="height:12px;width:60%;margin-bottom:8px"></div><div class="rk-skel" style="height:22px;width:80%"></div></div></div>{/each}</div>
			{:else}
				<KpiRow {kpis} />
			{/if}

			<!-- Charts -->
			{#if !insightsLoading && dailyData.length > 0}
				<div class="rk-charts-2">
					<SpendChart daily={dailyData} cur={selectedCurrency} />
					<ComboChart series={comboSeries} {resultLabel} cur={selectedCurrency} />
				</div>
			{/if}

			<!-- Advanced KPI -->
			{#if !insightsLoading && kpiCampaignAgg.length > 0}
				<AdvancedKpi summary={execSummary} forecast={budgetForecast} momentum={cpaMomentum} funnel={funnelAnalysis} matrix={saturationMatrix} dow={dayOfWeekData} avgHealth={advHealth} cur={selectedCurrency} bind:open={advancedOpen} />
			{/if}

			<!-- Audience -->
			{#if !insightsLoading}
				<Audience {demographics} loading={demographicsLoading} cur={selectedCurrency} />
			{/if}

			<!-- Funnel + platform split -->
			{#if !insightsLoading}
				<div class="rk-charts-2">
					<Funnel totals={funnelTotals} />
					<PlatformSplit split={platformSplit} loading={platformLoading} cur={selectedCurrency} />
				</div>
			{/if}

			<!-- Campaign table -->
			{#if !insightsLoading}
				<div class="rk-table-section">
					<div class="rk-table-head">
						<h2 class="rk-section-title" style="margin:0">Performanță campanii</h2>
						<div class="rk-statusseg">
							{#each [['all', 'Toate'], ['active', 'Active'], ['paused', 'Paused']] as [k, l] (k)}
								<button class="rk-statusseg-btn {statusTab === k ? 'active' : ''}" onclick={() => setStatusTab(k)}>{l}</button>
							{/each}
						</div>
						{#if objectiveOptions.length > 0}
							<div class="rk-tiptabs">
								<span class="rk-tip-label">Tip:</span>
								<button class="rk-tip-btn {filters.objectives.length === 0 ? 'active' : ''}" onclick={() => setTip(null)}>Toate</button>
								{#each objectiveOptions as o (o.key)}
									{@const OI = rkIcon(o.icon)}
									{@const on = filters.objectives.length === 1 && filters.objectives[0] === o.key}
									<button class="rk-tip-btn {on ? 'active' : ''}" onclick={() => setTip(on ? null : o.key)}><OI size={12} />{o.label}</button>
								{/each}
							</div>
						{/if}
						<div class="rk-table-head-right">
							<span class="rk-count">{filteredRows.length} campanii</span>
							<ColumnManager bind:visible={visibleColKeys} onchange={() => (userOverrodePreset = true)} />
							<PresetSelect value={selectedPresetKey} onSelect={onPresetChange} />
							<button class="rk-hbtn" onclick={exportCSV}><Download size={14} /> CSV</button>
						</div>
					</div>

					<FilterBar bind:filters objectives={objectiveOptions} owners={ownerOptions} resultCount={filteredRows.length} />

					{#if selectedCampaigns.size > 0}
						<div class="rk-bulkbar">
							<strong>{selectedCampaigns.size}</strong> selectate
							<div style="flex:1"></div>
							<button class="rk-hbtn sm" onclick={() => bulkToggle(true)}><Play size={13} /> Pornește</button>
							<button class="rk-hbtn sm" onclick={() => bulkToggle(false)}><Pause size={13} /> Pauză</button>
							<button class="rk-hbtn sm" onclick={() => (selectedCampaigns = new Set())}>Anulează</button>
						</div>
					{/if}

					<div class="rk-tablewrap">
						<table class="rk-table">
							<thead>
								<tr>
									<th class="rk-chkcell"><span class="rk-check {allSelected ? 'on' : someSelected ? 'ind' : ''}" role="checkbox" tabindex="0" aria-checked={allSelected} onclick={toggleSelectAll} onkeydown={(e) => e.key === 'Enter' && toggleSelectAll()}>{#if allSelected}<Check size={11} />{:else if someSelected}<i class="rk-dash"></i>{/if}</span></th>
									<th class="rk-onoff">On/Off</th>
									<th class="rk-sticky-c rk-th-name sortable" onclick={() => handleSort('campaignName')}>Campanie {#if sortColumn === 'campaignName'}<span class="rk-sortar">{sortDirection === 'asc' ? '↑' : '↓'}</span>{/if}</th>
									<th class="rk-sticky-s">Status</th>
									{#each visibleCols as col (col.key)}
										<th class="rk-num {col.sortKey ? 'sortable' : ''} {sortColumn === col.sortKey ? 'sorted' : ''}" onclick={() => col.sortKey && handleSort(col.sortKey)}>
											{col.label} {#if col.sortKey}<span class="rk-sortar">{sortColumn === col.sortKey ? (sortDirection === 'asc' ? '↑' : '↓') : '↕'}</span>{/if}
										</th>
									{/each}
									<th class="rk-actcell"></th>
								</tr>
							</thead>
							<tbody>
								<!-- Totals row -->
								<tr class="rk-totalsrow">
									<td class="rk-chkcell"></td>
									<td class="rk-onoff"></td>
									<td class="rk-sticky-c rk-namecell"><div class="rk-name-wrap"><div class="rk-campname">Total · {filteredRows.length} campanii</div><div class="rk-campmeta">Rezultate agregate{filters.objectives.length ? ` (${filters.objectives[0]})` : ''}</div></div></td>
									<td class="rk-sticky-s"></td>
									{#each visibleCols as col (col.key)}
										<td class="rk-num rk-totalcell">{col.getTotalValue ? col.getTotalValue(filteredRows, selectedCurrency) : col.key === 'budget' ? (totalsBudget > 0 ? formatCurrency(totalsBudget, selectedCurrency) + '/zi' : '—') : '—'}</td>
									{/each}
									<td class="rk-actcell"></td>
								</tr>

								{#if paginatedCampaigns.length === 0}
									<tr><td colspan={colCount}><div class="rk-empty"><Search size={40} /><div class="rk-empty-t">Nicio campanie găsită</div><div>Ajustează filtrele sau perioada selectată.</div></div></td></tr>
								{:else}
									{#each paginatedCampaigns as c (c.campaignId)}
										{@const objCfg = getObjectiveConfig(c.objective)}
										{@const ObjIcon = rkIcon(objCfg.icon)}
										{@const sb = statusBadge(c.status)}
										{@const hs = healthScores.get(c.campaignId)}
										{@const anomalies = campaignAnomalies.get(c.campaignId)}
										{@const isExpanded = expandedCampaigns.has(c.campaignId)}
										{@const isSelected = selectedCampaigns.has(c.campaignId)}
										{@const isOn = c.status === 'ACTIVE' || c.status === 'WITH_ISSUES'}
										<tr class="rk-camprow {isExpanded ? 'expanded' : ''} {isSelected ? 'selected' : ''}">
											<td class="rk-chkcell"><span class="rk-check {isSelected ? 'on' : ''}" role="checkbox" tabindex="0" aria-checked={isSelected} onclick={() => toggleSelect(c.campaignId)} onkeydown={(e) => e.key === 'Enter' && toggleSelect(c.campaignId)}>{#if isSelected}<Check size={11} />{/if}</span></td>
											<td class="rk-onoff">
												<label class="rk-switch">
													<input type="checkbox" checked={isOn} disabled={togglingCampaignId === c.campaignId || (c.status !== 'ACTIVE' && c.status !== 'PAUSED')} onchange={() => handleToggleStatus(c)} />
													<span class="rk-switch-track"></span>
												</label>
											</td>
											<td class="rk-sticky-c rk-namecell">
												<button class="rk-expand" onclick={() => toggleExpand(c.campaignId)} aria-label="Extinde campania">{#if isExpanded}<ChevronDown size={14} />{:else}<ChevronRight size={14} />{/if}</button>
												<div class="rk-name-wrap">
													<div class="rk-campname">{c.campaignName}{#if anomalies && anomalies.length}<span class="rk-anomaly {anomalies.some((i) => i.severity === 'critical') ? 'critical' : 'warning'}" title={anomalies.map((i) => i.message).join('\n')}><AlertTriangle size={12} /></span>{/if}</div>
													<div class="rk-campmeta">
														<span class="rk-objbadge c-{objCfg.color}"><ObjIcon size={11} />{objCfg.label}</span>
														<span class="rk-dot"></span><span>{c.campaignId}</span>
														{#if c.startTime}<span class="rk-dot"></span><span>Start {c.startTime.slice(0, 10)}</span>{/if}
													</div>
												</div>
											</td>
											<td class="rk-sticky-s">
												<div class="rk-status-stack">
													<span class="rk-badge {sb.cls}">{#if sb.pulse}<i class="rk-pulse"></i>{/if}{sb.label}</span>
													{#if hs}<span class="rk-health {hs.level === 'good' ? 'good' : hs.level === 'warning' ? 'ok' : 'bad'}" title={hs.issues.join('\n')}><HeartPulse size={11} />{hs.score}</span>{/if}
												</div>
											</td>
											{#each visibleCols as col (col.key)}
												<td class="rk-num">
													<div class="rk-cellval">{col.getValue(c, selectedCurrency)}</div>
													{#if col.getSubtext}{@const sub = col.getSubtext(c)}{#if sub}<div class="rk-cellsub">{sub}{#if col.key === 'budget' && (c.dailyBudget || c.lifetimeBudget)}<button onclick={() => openBudgetEdit(c)} title="Editează buget" aria-label="Editează buget"><Pencil size={10} /></button>{/if}</div>{/if}{/if}
												</td>
											{/each}
											<td class="rk-actcell">{#if c.previewUrl}<a class="rk-rowact" href={c.previewUrl} target="_blank" rel="noopener" title="Vezi reclama"><Eye size={14} /></a>{/if}</td>
										</tr>

										{#if isExpanded}
											{#if adsetLoading.has(c.campaignId)}
												<tr class="rk-subrow"><td class="rk-chkcell"></td><td class="rk-onoff"></td><td class="rk-sticky-c" colspan={colCount - 2}><div class="rk-subloader"><Loader size={14} class="rk-spin" /> Se încarcă ad set-urile…</div></td></tr>
											{:else if adsetData.has(c.campaignId)}
												{#each adsetData.get(c.campaignId) || [] as adset (adset.adsetId)}
													{@const adsetExpanded = expandedAdsets.has(adset.adsetId)}
													<tr class="rk-subrow rk-adsetrow">
														<td class="rk-chkcell"></td>
														<td class="rk-onoff"></td>
														<td class="rk-sticky-c rk-namecell" style="padding-left:34px">
															<div class="rk-tree-line"></div>
															<button class="rk-expand sm" onclick={() => toggleExpandAdset(adset.adsetId)} aria-label="Extinde ad set">{#if adsetExpanded}<ChevronDown size={13} />{:else}<ChevronRight size={13} />{/if}</button>
															<div class="rk-name-wrap"><div class="rk-subname">{adset.adsetName}</div></div>
														</td>
														<td class="rk-sticky-s"></td>
														{#each visibleCols as col (col.key)}<td class="rk-num">{col.getValue(adset as any, selectedCurrency)}</td>{/each}
														<td class="rk-actcell"></td>
													</tr>
													{#if adsetExpanded}
														{#if adsLoading.has(adset.adsetId)}
															<tr class="rk-subrow"><td class="rk-chkcell"></td><td class="rk-onoff"></td><td class="rk-sticky-c" colspan={colCount - 2}><div class="rk-subloader" style="padding-left:24px"><Loader size={14} class="rk-spin" /> Se încarcă reclamele…</div></td></tr>
														{:else if adsData.has(adset.adsetId)}
															{#each adsData.get(adset.adsetId) || [] as ad (ad.adId)}
																<tr class="rk-subrow rk-adrow">
																	<td class="rk-chkcell"></td>
																	<td class="rk-onoff"></td>
																	<td class="rk-sticky-c rk-namecell" style="padding-left:56px">
																		<div class="rk-tree-line"></div>
																		<div class="rk-creative-thumb"><Image size={13} /></div>
																		<div class="rk-name-wrap"><div class="rk-subname">{ad.adName}</div></div>
																	</td>
																	<td class="rk-sticky-s"></td>
																	{#each visibleCols as col (col.key)}<td class="rk-num">{col.getValue(ad as any, selectedCurrency)}</td>{/each}
																	<td class="rk-actcell">{#if ad.previewUrl}<a class="rk-rowact" href={ad.previewUrl} target="_blank" rel="noopener" title="Vezi reclama"><Eye size={13} /></a>{/if}</td>
																</tr>
															{/each}
														{/if}
													{/if}
												{/each}
											{/if}
										{/if}
									{/each}
								{/if}
							</tbody>
						</table>
					</div>

					<div class="rk-pagination">
						<span>Afișează <strong>{totalEntries === 0 ? 0 : startIndex + 1}–{endIndex}</strong> din <strong>{totalEntries}</strong> campanii</span>
						<select class="rk-page-select" value={pageSize} onchange={(e) => { pageSize = parseInt(e.currentTarget.value); currentPage = 1; }} aria-label="Campanii pe pagină">
							<option value={10}>10</option>
							<option value={25}>25</option>
							<option value={50}>50</option>
						</select>
						<div style="flex:1"></div>
						<button class="rk-page-btn" disabled={safePage <= 1} onclick={() => (currentPage = safePage - 1)} aria-label="Pagina anterioară"><ChevronLeft size={14} /></button>
						<button class="rk-page-btn active">{safePage}</button>
						<button class="rk-page-btn" disabled={safePage >= totalPages} onclick={() => (currentPage = safePage + 1)} aria-label="Pagina următoare"><ChevronRight size={14} /></button>
					</div>
				</div>
			{/if}
		{/if}
	</div>

	{#if toastText}
		<div class="rk-toast"><Check2 size={16} /> {toastText}</div>
	{/if}
</div>

<!-- Budget edit dialog -->
<Dialog.Root bind:open={budgetDialogOpen}>
	<Dialog.Content class="sm:max-w-[400px]">
		<Dialog.Header>
			<Dialog.Title>Editare buget</Dialog.Title>
			<Dialog.Description>{budgetEditCampaign?.campaignName || ''}</Dialog.Description>
		</Dialog.Header>
		<div class="space-y-4 py-4">
			<div class="space-y-2">
				<p class="text-sm font-medium">Tip buget</p>
				<div class="flex gap-2">
					<Button variant={budgetEditCampaign?.budgetType === 'daily' ? 'default' : 'outline'} size="sm" onclick={() => { if (budgetEditCampaign) budgetEditCampaign.budgetType = 'daily'; }}>Zilnic</Button>
					<Button variant={budgetEditCampaign?.budgetType === 'lifetime' ? 'default' : 'outline'} size="sm" onclick={() => { if (budgetEditCampaign) budgetEditCampaign.budgetType = 'lifetime'; }}>Total</Button>
				</div>
			</div>
			<div class="space-y-2">
				<label for="budget-amount-input" class="text-sm font-medium">Sumă ({selectedCurrency})</label>
				<Input id="budget-amount-input" type="number" min="1" step="0.01" bind:value={budgetNewAmount} placeholder="Ex: 50.00" />
				{#if budgetEditCampaign?.currentAmount}<p class="text-xs text-muted-foreground">Buget actual: {budgetEditCampaign.currentAmount} {selectedCurrency}</p>{/if}
			</div>
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (budgetDialogOpen = false)}>Anulează</Button>
			<Button onclick={handleBudgetSave} disabled={budgetSaving}>{budgetSaving ? 'Se salvează…' : 'Salvează'}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
