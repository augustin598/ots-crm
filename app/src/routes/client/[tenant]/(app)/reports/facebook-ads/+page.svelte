<script lang="ts">
	import { getMyAdAccounts, getMetaCampaignInsights, getMetaActiveCampaigns, getMetaAdsetInsights, getMetaAdInsights } from '$lib/remotes/reports.remote';
	import { getClientAccountBudgets } from '$lib/remotes/budget.remote';
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
	import DemographicsSection from '$lib/components/reports/demographics-section.svelte';
	import IconFacebook from '$lib/components/marketing/icon-facebook.svelte';
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
	import UsersIcon from '@lucide/svelte/icons/users';
	import MousePointerIcon from '@lucide/svelte/icons/mouse-pointer';
	import ShoppingCartIcon from '@lucide/svelte/icons/shopping-cart';
	import PlayIcon from '@lucide/svelte/icons/play';
	import MegaphoneIcon from '@lucide/svelte/icons/megaphone';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import TargetIcon from '@lucide/svelte/icons/target';
	import HeartIcon from '@lucide/svelte/icons/heart';
	import MessageCircleIcon from '@lucide/svelte/icons/message-circle';
	import PhoneIcon from '@lucide/svelte/icons/phone';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import {
		aggregateInsightsByDate,
		aggregateInsightsByCampaign,
		aggregateInsightsByAdset,
		aggregateInsightsByAd,
		computeTotals,
		formatCurrency,
		formatPercent,
		formatNumber,
		getDefaultDateRange,
		type CampaignAggregate,
		type AdsetAggregate,
		type AdAggregate
	} from '$lib/utils/report-helpers';
	import { COLUMN_PRESETS, DEFAULT_PRESET, getPreset } from '$lib/utils/column-presets';
	import SavedViewSelector from '$lib/components/reports/saved-view-selector.svelte';
	import { detectDatePreset, resolveDatePreset } from '$lib/utils/date-preset-resolver';
	import type { SavedViewFilters } from '$lib/remotes/saved-views.remote';
	import { calculateHealthScore, calculateAverageHealthScore } from '$lib/utils/health-score';
	import HealthScoreBadge from '$lib/components/reports/health-score-badge.svelte';
	import HeartPulseIcon from '@lucide/svelte/icons/heart-pulse';
	import {
		calculateCampaignFatigue,
		calculateBudgetBurnForecast,
		calculateCpaMomentum,
		calculateFunnelAnalysis,
		calculateSaturationMatrix,
		calculateDayOfWeekPerformance,
		generateExecutiveSummary
	} from '$lib/utils/advanced-kpi';
	import CreativeFatigueBadge from '$lib/components/reports/creative-fatigue-badge.svelte';
	import BudgetBurnCard from '$lib/components/reports/budget-burn-card.svelte';
	import CpaMomentumCard from '$lib/components/reports/cpa-momentum-card.svelte';
	import FunnelDropoff from '$lib/components/reports/funnel-dropoff.svelte';
	import SaturationMatrixChart from '$lib/components/reports/saturation-matrix.svelte';
	import DayOfWeekHeatmap from '$lib/components/reports/day-of-week-heatmap.svelte';
	import ExecutiveSummaryCard from '$lib/components/reports/executive-summary.svelte';
	import SaturationDetailList from '$lib/components/reports/saturation-detail-list.svelte';
	import WalletIcon from '@lucide/svelte/icons/wallet';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import * as Popover from '$lib/components/ui/popover';
	import { getConversionTypeConfig, filterDisplayableActions } from '$lib/utils/conversion-type-config';
	import SearchIcon from '@lucide/svelte/icons/search';
	import SmileIcon from '@lucide/svelte/icons/smile';
	import BookmarkIcon from '@lucide/svelte/icons/bookmark';
	import Share2Icon from '@lucide/svelte/icons/share-2';
	import CreditCardIcon from '@lucide/svelte/icons/credit-card';
	import ShoppingBagIcon from '@lucide/svelte/icons/shopping-bag';
	import UserPlusIcon from '@lucide/svelte/icons/user-plus';
	import ContactIcon from '@lucide/svelte/icons/contact';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import ThumbsUpIcon from '@lucide/svelte/icons/thumbs-up';

	const tenantSlug = $derived(page.params.tenant as string);

	// Date range
	const defaults = getDefaultDateRange();
	let since = $state(defaults.since);
	let until = $state(defaults.until);

	// Load all client's ad accounts
	const accountsQuery = getMyAdAccounts();
	const accounts = $derived(accountsQuery.current || []);
	const accountsLoading = $derived(accountsQuery.loading);

	let selectedAccountId = $state<string>('');
	$effect(() => {
		if (accounts.length > 0 && !selectedAccountId) {
			const urlAccount = page.url.searchParams.get('account');
			const match = urlAccount && accounts.find((a: any) => a.metaAdAccountId === urlAccount);
			selectedAccountId = (match || accounts[0]).metaAdAccountId;
		}
	});

	const adAccount = $derived(accounts.find(a => a.metaAdAccountId === selectedAccountId) || null);
	const currency = $derived(adAccount?.currency || 'RON');
	const accountBudgetsQuery = $derived(adAccount?.clientId ? getClientAccountBudgets({ clientId: adAccount.clientId }) : null);
	const monthlyBudget = $derived(() => {
		const budgets = accountBudgetsQuery?.current;
		if (!budgets) return undefined;
		const match = budgets.meta.find(a => a.metaAdAccountId === selectedAccountId);
		return match?.monthlyBudget ?? undefined;
	});

	function handleAccountChange(e: Event) {
		selectedAccountId = (e.target as HTMLSelectElement).value;
		selectedCampaigns = new Set();
		objectiveFilter = 'all';
		expandedCampaigns = new Set();
		adsetData = new Map();
	}

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

	// Selection state (declared early so filteredInsights can use it)
	let selectedCampaigns = $state<Set<string>>(new Set());
	let objectiveFilter = $state<string>('all');

	// Filter insights by selected campaigns AND objective filter
	const filteredInsights = $derived.by(() => {
		let result = insights;
		if (selectedCampaigns.size > 0) {
			result = result.filter((i: any) => selectedCampaigns.has(i.campaignId));
		}
		if (objectiveFilter !== 'all') {
			result = result.filter((i: any) => getObjectiveConfig(i.objective || '').label === objectiveFilter);
		}
		return result;
	});

	// Campaign data always from ALL insights (table always shows full data)
	const campaignData = $derived(aggregateInsightsByCampaign(insights));

	// Health scores
	const healthScores = $derived(new Map(
		campaignData
			.filter((c) => c.spend > 0 && c.impressions >= 1000)
			.map((c) => [c.campaignId, calculateHealthScore(c)])
	));
	const avgHealth = $derived(calculateAverageHealthScore(campaignData));

	// Advanced KPIs — per-campaign daily data for fatigue detection
	const campaignDailyMap = $derived.by(() => {
		const map = new Map<string, import('$lib/utils/report-helpers').DailyAggregate[]>();
		for (const campaign of campaignData) {
			const campaignInsights = insights.filter((i: any) => i.campaignId === campaign.campaignId);
			if (campaignInsights.length > 0) {
				map.set(campaign.campaignId, aggregateInsightsByDate(campaignInsights));
			}
		}
		return map;
	});
	const campaignFatigue = $derived(calculateCampaignFatigue(campaignDailyMap));

	// KPI cards, charts, demographics use filtered insights when campaigns are selected
	const dailyData = $derived(aggregateInsightsByDate(filteredInsights));
	const totals = $derived(computeTotals(dailyData));

	// Advanced KPI derived values
	const budgetForecast = $derived(calculateBudgetBurnForecast(dailyData, monthlyBudget()));
	const cpaMomentum = $derived(calculateCpaMomentum(dailyData));
	const funnelAnalysis = $derived(calculateFunnelAnalysis(campaignData));
	const saturationMatrix = $derived(calculateSaturationMatrix(campaignData));
	const dayOfWeekData = $derived(calculateDayOfWeekPerformance(dailyData));
	const executiveSummary = $derived(generateExecutiveSummary(campaignData, healthScores, campaignFatigue));

	// Campaign IDs for demographics — respects both selectedCampaigns and objectiveFilter
	const demographicCampaignIds = $derived.by(() => {
		if (selectedCampaigns.size > 0) return [...selectedCampaigns];
		if (objectiveFilter !== 'all') return filteredCampaigns.map(c => c.campaignId);
		return [];
	});

	// Merge campaigns with insights to get status
	const campaignTableData = $derived.by(() => {
		const insightMap = new Map(campaignData.map(c => [c.campaignId, c]));
		const result: Array<CampaignAggregate & { status: string; dailyBudget: string | null; lifetimeBudget: string | null; previewUrl: string | null; startTime: string | null; stopTime: string | null }> = [];
		for (const ci of campaigns) {
			const insight = insightMap.get(ci.campaignId);
			if (insight) {
				result.push({ ...insight, status: ci.status, dailyBudget: ci.dailyBudget || null, lifetimeBudget: ci.lifetimeBudget || null, previewUrl: ci.previewUrl || null, startTime: ci.startTime || null, stopTime: ci.stopTime || null });
				insightMap.delete(ci.campaignId);
			} else if (ci.status === 'ACTIVE' || ci.status === 'WITH_ISSUES') {
				result.push({
					campaignId: ci.campaignId, campaignName: ci.campaignName, objective: ci.objective,
					spend: 0, impressions: 0, reach: 0, frequency: 0, clicks: 0,
					conversions: 0, conversionValue: 0, cpc: 0, cpm: 0, ctr: 0,
					costPerConversion: 0, roas: 0, resultType: '', cpaLabel: 'CPA',
					purchases: 0, leads: 0, linkClicks: 0, landingPageViews: 0, pageEngagement: 0,
					postReactions: 0, postComments: 0, postSaves: 0, postShares: 0, videoViews: 0, callsPlaced: 0,
					status: ci.status, dailyBudget: ci.dailyBudget || null, lifetimeBudget: ci.lifetimeBudget || null, previewUrl: ci.previewUrl || null, startTime: ci.startTime || null, stopTime: ci.stopTime || null,
					rawActions: []
				});
			}
		}
		for (const [, c] of insightMap) {
			result.push({ ...c, status: 'UNKNOWN', dailyBudget: null, lifetimeBudget: null, previewUrl: null, startTime: null, stopTime: null });
		}
		return result;
	});

	// Map optimization goals to action types (for demographics)
	const GOAL_TO_ACTION: Record<string, string> = {
		'CALL': 'click_to_call_native_call_placed',
		'QUALITY_CALL': 'click_to_call_native_call_placed',
		'OFFSITE_CONVERSIONS': 'offsite_conversion.fb_pixel_purchase',
		'LINK_CLICKS': 'link_click',
		'LANDING_PAGE_VIEWS': 'landing_page_view',
		'POST_ENGAGEMENT': 'post_engagement',
		'THRUPLAY': 'video_view',
		'VIDEO_VIEWS': 'video_view',
		'LEAD_GENERATION': 'lead',
		'CONVERSATIONS': 'onsite_conversion.messaging_conversation_started_7d',
		'APP_INSTALLS': 'app_install',
		'VALUE': 'offsite_conversion.fb_pixel_purchase'
	};

	const resultActionTypes = $derived.by(() => {
		const types = new Set<string>();
		const relevantCampaigns = selectedCampaigns.size > 0
			? campaigns.filter((c: any) => selectedCampaigns.has(c.campaignId))
			: campaigns;
		for (const c of relevantCampaigns) {
			if (c.optimizationGoal && GOAL_TO_ACTION[c.optimizationGoal]) {
				types.add(GOAL_TO_ACTION[c.optimizationGoal]);
			}
		}
		return [...types];
	});

	const dominantResultLabel = $derived.by(() => {
		const filteredCampaignData = aggregateInsightsByCampaign(filteredInsights);
		const relevantInsights = filteredCampaignData.filter(c => c.conversions > 0 && c.resultType);
		if (relevantInsights.length === 0) return 'Rezultate';
		const typeCounts = new Map<string, number>();
		for (const c of relevantInsights) {
			typeCounts.set(c.resultType, (typeCounts.get(c.resultType) || 0) + c.conversions);
		}
		let dominant = 'Rezultate'; let max = 0;
		for (const [type, count] of typeCounts) { if (count > max) { max = count; dominant = type; } }
		return dominant;
	});

	// Dynamic result KPI — uses filtered insights
	const resultKpi = $derived.by(() => {
		const filteredCampaignData = aggregateInsightsByCampaign(filteredInsights);
		const withResults = filteredCampaignData.filter(c => c.conversions > 0);
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

	// Status filter
	let statusFilter = $state<'all' | 'active' | 'paused'>('all');
	let advancedKpiOpen = $state(false);
	const STATUS_FILTERS: { key: typeof statusFilter; label: string; activeClass: string }[] = [
		{ key: 'all', label: 'Toate', activeClass: 'bg-primary text-primary-foreground' },
		{ key: 'active', label: 'Active', activeClass: 'bg-green-600 text-white' },
		{ key: 'paused', label: 'Paused', activeClass: 'bg-amber-500 text-white' },
	];
	// Objective type filter (declared at line 112, before filteredInsights)
	const statusFilteredCampaigns = $derived.by(() => {
		if (statusFilter === 'all') return campaignTableData;
		if (statusFilter === 'active') return campaignTableData.filter(c => c.status === 'ACTIVE' || c.status === 'WITH_ISSUES' || c.status === 'IN_PROCESS');
		if (statusFilter === 'paused') return campaignTableData.filter(c => c.status === 'PAUSED' || c.status === 'CAMPAIGN_PAUSED');
		return campaignTableData;
	});
	const availableObjectives = $derived.by(() => {
		const types = new Map<string, { label: string; color: string; icon: any }>();
		for (const c of campaignTableData) {
			const config = getObjectiveConfig(c.objective);
			if (!types.has(config.label)) {
				types.set(config.label, { label: config.label, color: config.color, icon: config.icon });
			}
		}
		return Array.from(types.values()).sort((a, b) => a.label.localeCompare(b.label));
	});
	const filteredCampaigns = $derived.by(() => {
		if (objectiveFilter === 'all') return statusFilteredCampaigns;
		return statusFilteredCampaigns.filter(c => getObjectiveConfig(c.objective).label === objectiveFilter);
	});

	// Sorting
	let sortColumn = $state<keyof CampaignAggregate | 'status'>('status');
	let sortDirection = $state<'asc' | 'desc'>('asc');
	const STATUS_ORDER: Record<string, number> = { ACTIVE: 0, WITH_ISSUES: 1, IN_PROCESS: 2, PAUSED: 3, CAMPAIGN_PAUSED: 4, UNKNOWN: 5 };

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

	// ---- Objective display config ----
	const OBJECTIVE_CONFIG: Record<string, { label: string; icon: any; color: string }> = {
		OUTCOME_LEADS: { label: 'Leads', icon: UsersIcon, color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
		LEAD_GENERATION: { label: 'Leads', icon: UsersIcon, color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
		OUTCOME_TRAFFIC: { label: 'Trafic', icon: MousePointerIcon, color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
		LINK_CLICKS: { label: 'Trafic', icon: MousePointerIcon, color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
		OUTCOME_SALES: { label: 'Vânzări', icon: ShoppingCartIcon, color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
		CONVERSIONS: { label: 'Vânzări', icon: ShoppingCartIcon, color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
		OUTCOME_ENGAGEMENT: { label: 'Engagement', icon: HeartIcon, color: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400' },
		POST_ENGAGEMENT: { label: 'Engagement', icon: HeartIcon, color: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400' },
		OUTCOME_AWARENESS: { label: 'Awareness', icon: MegaphoneIcon, color: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400' },
		REACH: { label: 'Reach', icon: MegaphoneIcon, color: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400' },
		OUTCOME_APP_PROMOTION: { label: 'App', icon: DownloadIcon, color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400' },
		MESSAGES: { label: 'Mesaje', icon: MessageCircleIcon, color: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400' },
		VIDEO_VIEWS: { label: 'Video', icon: PlayIcon, color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' },
		CALLS: { label: 'Apeluri', icon: PhoneIcon, color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
	};

	function getObjectiveConfig(objective: string) {
		return OBJECTIVE_CONFIG[objective] || { label: objective, icon: TargetIcon, color: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400' };
	}

	// ---- Expandable ad sets ----
	let expandedCampaigns = $state<Set<string>>(new Set());
	let adsetData = $state<Map<string, AdsetAggregate[]>>(new Map());
	let adsetLoading = $state<Set<string>>(new Set());

	// ---- Expandable ads (under ad sets) ----
	let expandedAdsets = $state<Set<string>>(new Set());
	let adsData = $state<Map<string, AdAggregate[]>>(new Map());
	let adsLoading = $state<Set<string>>(new Set());

	async function toggleExpand(campaignId: string) {
		const next = new Set(expandedCampaigns);
		if (next.has(campaignId)) {
			next.delete(campaignId);
			expandedCampaigns = next;
			return;
		}
		next.add(campaignId);
		expandedCampaigns = next;

		if (!adsetData.has(campaignId) && adAccount?.metaAdAccountId && adAccount?.integrationId) {
			const loadingNext = new Set(adsetLoading);
			loadingNext.add(campaignId);
			adsetLoading = loadingNext;

			try {
				const query = getMetaAdsetInsights({
					adAccountId: adAccount.metaAdAccountId,
					integrationId: adAccount.integrationId,
					campaignId,
					since,
					until
				});
				const checkInterval = setInterval(() => {
					if (!query.loading) {
						clearInterval(checkInterval);
						const loadDone = new Set(adsetLoading);
						loadDone.delete(campaignId);
						adsetLoading = loadDone;

						if (query.current) {
							const aggregated = aggregateInsightsByAdset(query.current);
							const newMap = new Map(adsetData);
							newMap.set(campaignId, aggregated);
							adsetData = newMap;
						}
					}
				}, 100);
			} catch {
				const loadDone = new Set(adsetLoading);
				loadDone.delete(campaignId);
				adsetLoading = loadDone;
			}
		}
	}

	async function toggleExpandAdset(adsetId: string) {
		const next = new Set(expandedAdsets);
		if (next.has(adsetId)) {
			next.delete(adsetId);
			expandedAdsets = next;
			return;
		}
		next.add(adsetId);
		expandedAdsets = next;

		if (!adsData.has(adsetId) && adAccount?.metaAdAccountId && adAccount?.integrationId) {
			const loadingNext = new Set(adsLoading);
			loadingNext.add(adsetId);
			adsLoading = loadingNext;

			try {
				const query = getMetaAdInsights({
					adAccountId: adAccount.metaAdAccountId,
					integrationId: adAccount.integrationId,
					adsetId,
					since,
					until
				});
				const checkInterval = setInterval(() => {
					if (!query.loading) {
						clearInterval(checkInterval);
						const loadDone = new Set(adsLoading);
						loadDone.delete(adsetId);
						adsLoading = loadDone;

						if (query.current) {
							const aggregated = aggregateInsightsByAd(query.current);
							const newMap = new Map(adsData);
							newMap.set(adsetId, aggregated);
							adsData = newMap;
						}
					}
				}, 100);
			} catch {
				const loadDone = new Set(adsLoading);
				loadDone.delete(adsetId);
				adsLoading = loadDone;
			}
		}
	}

	const POPOVER_ICON_MAP: Record<string, any> = {
		'shopping-cart': ShoppingCartIcon, 'shopping-bag': ShoppingBagIcon,
		'users': UsersIcon, 'user-plus': UserPlusIcon, 'credit-card': CreditCardIcon,
		'search': SearchIcon, 'eye': EyeIcon, 'target': TargetIcon,
		'mouse-pointer-click': MousePointerClickIcon, 'file-text': FileTextIcon,
		'thumbs-up': ThumbsUpIcon, 'heart': HeartIcon, 'smile': SmileIcon,
		'message-circle': MessageCircleIcon, 'bookmark': BookmarkIcon,
		'share-2': Share2Icon, 'play': PlayIcon, 'download': DownloadIcon,
		'phone': PhoneIcon, 'contact': ContactIcon
	};

	function getMetaConversionBreakdown(campaign: any): Array<{ name: string; count: number; value: number }> {
		const items: Array<{ name: string; count: number; value: number }> = [];
		if (campaign.purchases > 0) items.push({ name: 'Achiziții', count: campaign.purchases, value: campaign.conversionValue || 0 });
		if (campaign.leads > 0) items.push({ name: 'Leads', count: campaign.leads, value: 0 });
		if (campaign.linkClicks > 0) items.push({ name: 'Link clicks', count: campaign.linkClicks, value: 0 });
		if (campaign.landingPageViews > 0) items.push({ name: 'Landing page views', count: campaign.landingPageViews, value: 0 });
		if (campaign.pageEngagement > 0) items.push({ name: 'Page engagement', count: campaign.pageEngagement, value: 0 });
		if (campaign.postReactions > 0) items.push({ name: 'Reacții', count: campaign.postReactions, value: 0 });
		if (campaign.postComments > 0) items.push({ name: 'Comentarii', count: campaign.postComments, value: 0 });
		if (campaign.postSaves > 0) items.push({ name: 'Salvări', count: campaign.postSaves, value: 0 });
		if (campaign.postShares > 0) items.push({ name: 'Share-uri', count: campaign.postShares, value: 0 });
		if (campaign.videoViews > 0) items.push({ name: 'Video views', count: campaign.videoViews, value: 0 });
		if (campaign.callsPlaced > 0) items.push({ name: 'Apeluri', count: campaign.callsPlaced, value: 0 });
		return items.sort((a, b) => b.count - a.count);
	}

	function getStatusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' {
		switch (status) {
			case 'ACTIVE': return 'success';
			case 'PAUSED': case 'CAMPAIGN_PAUSED': return 'warning';
			case 'DELETED': return 'destructive';
			default: return 'outline';
		}
	}

	const allSelected = $derived(sortedCampaigns.length > 0 && sortedCampaigns.every(c => selectedCampaigns.has(c.campaignId)));
	const someSelected = $derived(sortedCampaigns.some(c => selectedCampaigns.has(c.campaignId)));

	function toggleSelectAll() {
		if (allSelected) {
			selectedCampaigns = new Set();
		} else {
			selectedCampaigns = new Set(sortedCampaigns.map(c => c.campaignId));
		}
	}

	function toggleSelect(campaignId: string) {
		const next = new Set(selectedCampaigns);
		if (next.has(campaignId)) next.delete(campaignId);
		else next.add(campaignId);
		selectedCampaigns = next;
	}

	// ---- Saved Views ----
	const currentFilters = $derived<SavedViewFilters>({
		datePreset: detectDatePreset(since, until),
		since: detectDatePreset(since, until) ? null : since,
		until: detectDatePreset(since, until) ? null : until,
		accountId: selectedAccountId,
		columnPreset: selectedPresetKey,
		objectiveFilter,
		statusFilter,
		pageSize: 25
	});

	function applyView(filters: SavedViewFilters) {
		if (filters.datePreset) {
			const dates = resolveDatePreset(filters.datePreset);
			if (dates) { since = dates.since; until = dates.until; }
		} else if (filters.since && filters.until) {
			since = filters.since;
			until = filters.until;
		}
		if (filters.accountId) {
			const accExists = accounts.find((a: any) => a.metaAdAccountId === filters.accountId);
			if (accExists) selectedAccountId = filters.accountId;
		}
		selectedPresetKey = filters.columnPreset;
		objectiveFilter = filters.objectiveFilter;
		statusFilter = filters.statusFilter as typeof statusFilter;
		selectedCampaigns = new Set();
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
	{#if accountsLoading}
		<div class="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
			{#each Array(5) as _}
				<Card class="p-4"><Skeleton class="h-16 w-full" /></Card>
			{/each}
		</div>
	{:else if accounts.length === 0}
		<Card class="p-8 text-center">
			<p class="text-muted-foreground">Nu există cont Meta Ads asociat acestui client. Asociază un cont din <a href="/{tenantSlug}/settings/meta-ads" class="text-primary underline">Settings → Meta Ads</a>.</p>
		</Card>
	{:else}
		<!-- Header -->
		<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
			<div>
				<h1 class="text-3xl font-bold flex items-center gap-3">
					<IconFacebook class="h-8 w-8" />
					Facebook Ads
				</h1>
				<p class="text-muted-foreground">Rapoarte performanță campanii Meta/Facebook Ads</p>
			</div>
			<div class="flex flex-wrap items-center gap-2">
				<SavedViewSelector platform="meta" {tenantSlug} currentAccountId={selectedAccountId} {currentFilters} onApplyView={applyView} />
			<DateRangePicker bind:since bind:until onchange={() => { objectiveFilter = 'all'; selectedCampaigns = new Set(); }} />
				{#if accounts.length > 0}
					<select class="h-9 rounded-md border border-input bg-background px-3 text-sm" value={selectedAccountId} onchange={handleAccountChange}>
						{#each accounts as account}
							<option value={account.metaAdAccountId}>
								{account.accountName || account.metaAdAccountId}
							</option>
						{/each}
					</select>
				{/if}
				<Button variant="outline" size="sm" onclick={handleRefresh}>
					<RefreshCwIcon class="h-4 w-4" />
				</Button>
			</div>
		</div>

		{#if insightsError}
			<Card class="p-8">
				<div class="rounded-md bg-red-50 p-4 space-y-2">
					<p class="text-sm font-medium text-red-800">{insightsError instanceof Error ? insightsError.message : (insightsError as any)?.body?.message || (insightsError as any)?.message || 'Eroare la încărcarea datelor'}</p>
					<p class="text-sm text-red-700">
						Dacă tokenul a expirat, contactează administratorul pentru reconectare.
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
						{#key objectiveFilter + String(selectedCampaigns.size)}<h3 class="mb-4 text-lg font-semibold">Cheltuieli în timp</h3>
						<SpendChart data={dailyData.map(d => ({ date: d.date, spend: d.spend }))} {currency} />{/key}
					</Card>
					<Card class="p-4">
						{#key objectiveFilter + String(selectedCampaigns.size)}<h3 class="mb-4 text-lg font-semibold">{resultKpi.label} & Cost per {resultKpi.label.toLowerCase()}</h3>
						<ConversionsChart data={dailyData.map(d => ({ date: d.date, conversions: d.conversions, costPerConversion: d.costPerConversion }))} {currency} />{/key}
					</Card>
				</div>
			{/if}

			<!-- Advanced KPI Section (Collapsible) -->
			{#if campaignData.length > 0}
				<Card class="p-5">
				<Collapsible.Root bind:open={advancedKpiOpen}>
					<Collapsible.Trigger class="flex w-full items-center justify-between text-left cursor-pointer rounded-lg -m-1 p-1 hover:bg-accent/50 transition-colors">
						<div>
							<h3 class="text-lg font-semibold">KPI Avansat & Optimizare in Timp Real</h3>
							<p class="text-sm text-muted-foreground mt-1">
								Analiza inteligenta a campaniilor tale: detectie automata a problemelor, proiectii de buget,
								recomandari de optimizare si clasificarea campaniilor pentru decizii rapide de scaling.
							</p>
						</div>
						<div class="flex items-center gap-3 shrink-0 ml-4">
							{#if avgHealth.score > 0}
								<div class="flex items-center gap-2 rounded-lg border px-3 py-1.5">
									<span class="text-xs text-muted-foreground">Health Score</span>
									<span class="text-xl font-bold {avgHealth.level === 'good' ? 'text-green-600 dark:text-green-400' : avgHealth.level === 'warning' ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}">
										{avgHealth.score}
									</span>
									<span class="text-xs {avgHealth.level === 'good' ? 'text-green-600 dark:text-green-400' : avgHealth.level === 'warning' ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}">
										{avgHealth.level === 'good' ? 'Performanță bună' : avgHealth.level === 'warning' ? 'Necesită atenție' : 'Performanță critică'}
									</span>
								</div>
							{/if}
							<ChevronDownIcon class="h-5 w-5 text-muted-foreground transition-transform {advancedKpiOpen ? 'rotate-180' : ''}" />
						</div>
					</Collapsible.Trigger>
					<Collapsible.Content class="mt-4">
						<div class="grid gap-3 lg:grid-cols-12">
							<!-- Left column: Executive Summary + Budget/CPA -->
							<div class="lg:col-span-5 space-y-3">
								<ExecutiveSummaryCard summary={executiveSummary} {currency} />
								<BudgetBurnCard forecast={budgetForecast} {currency} icon={WalletIcon} />
								<CpaMomentumCard momentum={cpaMomentum} {currency} />
							</div>
							<!-- Right column: Funnel + Saturation -->
							<div class="lg:col-span-7">
								<div class="grid gap-3 grid-cols-2 h-full">
									<FunnelDropoff analysis={funnelAnalysis} />
									<SaturationMatrixChart matrix={saturationMatrix} />
								</div>
							</div>
							<!-- Full width: Campaign Detail List -->
							<div class="lg:col-span-12">
								<SaturationDetailList matrix={saturationMatrix} />
							</div>
							<!-- Full width: Day of Week Heatmap -->
							<div class="lg:col-span-12">
								<DayOfWeekHeatmap data={dayOfWeekData} />
							</div>
						</div>
					</Collapsible.Content>
				</Collapsible.Root>
				</Card>
			{/if}

			<!-- Demographics -->
			{#if adAccount}
				<DemographicsSection
					adAccountId={adAccount.metaAdAccountId}
					integrationId={adAccount.integrationId}
					{since}
					{until}
					{currency}
					campaignIds={demographicCampaignIds}
					{resultActionTypes}
					resultLabel={dominantResultLabel}
				/>
			{/if}

			<!-- Campaign Table -->
			{#if campaignData.length > 0}
				<div class="space-y-4">
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-3">
							<h3 class="text-lg font-semibold">Performanță campanii</h3>
							<div class="flex items-center gap-1 rounded-lg border p-0.5">
								{#each STATUS_FILTERS as sf}
									<button
										class="px-3 py-1 text-xs rounded-md transition-colors {statusFilter === sf.key ? sf.activeClass : 'text-muted-foreground hover:text-foreground'}"
										onclick={() => { statusFilter = sf.key; selectedCampaigns = new Set(); }}
									>{sf.label}</button>
								{/each}
							</div>
							{#if availableObjectives.length > 1}
								<div class="flex items-center gap-1.5"><span class="text-xs text-muted-foreground">Tip:</span><div class="flex items-center gap-1 rounded-lg border p-0.5">
									<button
										class="px-3 py-1 text-xs rounded-md transition-colors {objectiveFilter === 'all' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}"
										onclick={() => { objectiveFilter = 'all'; }}
									>Toate</button>
									{#each availableObjectives as obj}
										<button
											class="flex items-center gap-1 px-3 py-1 text-xs rounded-md transition-colors {objectiveFilter === obj.label ? obj.color : 'text-muted-foreground hover:text-foreground'}"
											onclick={() => { objectiveFilter = obj.label; }}
										><obj.icon class="h-3 w-3" />{obj.label}</button>
									{/each}
								</div></div>
							{/if}
						</div>
						<div class="flex items-center gap-3">
							<p class="text-sm text-muted-foreground">{filteredCampaigns.length} campanii</p>
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
									<TableHead class="w-[50px]"></TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{#each sortedCampaigns as campaign}
									<TableRow
										class="cursor-pointer transition-colors hover:bg-muted/40 {expandedCampaigns.has(campaign.campaignId) ? 'bg-muted/30 font-semibold border-l-3 border-l-primary' : ''}"
										onclick={() => toggleExpand(campaign.campaignId)}
									>
										<TableCell class="w-[40px]" onclick={(e) => e.stopPropagation()}>
											<Checkbox
												checked={selectedCampaigns.has(campaign.campaignId)}
												onCheckedChange={() => toggleSelect(campaign.campaignId)}
											/>
										</TableCell>
										<TableCell class="font-medium max-w-[250px]">
											<div class="flex items-center gap-1.5">
												{#if expandedCampaigns.has(campaign.campaignId)}
													<ChevronDownIcon class="h-4 w-4 shrink-0 text-primary" />
												{:else}
													<ChevronRightIcon class="h-4 w-4 shrink-0 text-muted-foreground" />
												{/if}
												<div class="truncate" title={campaign.campaignName}>{campaign.campaignName}</div>
											</div>
											{#if true}
												{@const objConfig = getObjectiveConfig(campaign.objective)}
												{@const ObjIcon = objConfig.icon}
												<div class="flex items-center gap-1.5 ml-5.5 mt-0.5">
													<span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium {objConfig.color}">
														<ObjIcon class="h-3 w-3" />
														{objConfig.label}
													</span>
													{#if campaign.startTime}
														<span class="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
															<CalendarIcon class="h-2.5 w-2.5" />
															Start: {campaign.startTime.slice(0, 10)}
															{#if campaign.stopTime && campaign.status !== 'ACTIVE'}· End: {campaign.stopTime.slice(0, 10)}{/if}
														</span>
													{/if}
												</div>
											{/if}
										</TableCell>
										<TableCell>
											<div class="flex flex-wrap items-center gap-1">
												<Badge variant={getStatusVariant(campaign.status)}>{campaign.status}</Badge>
												{#if healthScores.has(campaign.campaignId)}
													{@const hs = healthScores.get(campaign.campaignId)!}
													<HealthScoreBadge score={hs.score} level={hs.level} issues={hs.issues} />
												{/if}
												{#if campaignFatigue.has(campaign.campaignId) && campaignFatigue.get(campaign.campaignId)!.level !== 'fresh'}
													<CreativeFatigueBadge result={campaignFatigue.get(campaign.campaignId)!} />
												{/if}
											</div>
										</TableCell>
										{#each activePreset.columns as col}
											<TableCell class={col.align === 'right' ? 'text-right' : ''} onclick={(e) => col.key === 'results' ? e.stopPropagation() : null}>
												{#if col.key === 'results' && campaign.rawActions?.length > 0}
													{@const displayActions = filterDisplayableActions(campaign.rawActions, campaign.objective)}
													{#if displayActions.length > 0}
													<Popover.Root>
														<Popover.Trigger class="text-right cursor-pointer hover:underline decoration-dotted underline-offset-2">
															<div>{col.getValue(campaign, currency)}</div>
															{#if col.getSubtext}{@const sub = col.getSubtext(campaign)}{#if sub}<div class="text-xs text-muted-foreground">{sub}</div>{/if}{/if}
														</Popover.Trigger>
														<Popover.Content side="top" align="end" class="w-80 p-3">
															<p class="mb-2 text-xs font-semibold text-muted-foreground">Rezultate Meta Ads</p>
															<div class="space-y-1.5 text-xs">
																{#each displayActions as action (action.label)}
																	{@const ActionIcon = POPOVER_ICON_MAP[action.icon]}
																	<div class="flex items-center justify-between">
																		<span class="inline-flex items-center gap-1.5 text-muted-foreground truncate mr-2">
																			{#if ActionIcon}<ActionIcon class="h-3 w-3 shrink-0" />{/if}
																			{action.label}
																		</span>
																		<span class="font-medium shrink-0">{new Intl.NumberFormat('ro-RO').format(action.value)}</span>
																	</div>
																{/each}
															</div>
														</Popover.Content>
													</Popover.Root>
													{:else}
														<div>{col.getValue(campaign, currency)}</div>
														{#if col.getSubtext}{@const sub = col.getSubtext(campaign)}{#if sub}<div class="text-xs text-muted-foreground">{sub}</div>{/if}{/if}
													{/if}
												{:else}
													<div>{col.getValue(campaign, currency)}</div>
													{#if col.getSubtext}
														{@const sub = col.getSubtext(campaign)}
														{#if sub}
															<div class="text-xs text-muted-foreground">{sub}</div>
														{/if}
													{/if}
												{/if}
											</TableCell>
										{/each}
										<TableCell class="w-[50px] text-center" onclick={(e) => e.stopPropagation()}>
											{#if campaign.previewUrl}
												<a href={campaign.previewUrl} target="_blank" rel="noopener" class="text-muted-foreground hover:text-primary" title="Previzualizare reclamă">
													<EyeIcon class="h-4 w-4 inline-block" />
												</a>
											{/if}
										</TableCell>
									</TableRow>
									{#if expandedCampaigns.has(campaign.campaignId)}
										{#if adsetLoading.has(campaign.campaignId)}
											<TableRow class="bg-muted/20">
												<TableCell></TableCell>
												<TableCell colspan={activePreset.columns.length + 3}>
													<div class="flex items-center gap-2 py-2 pl-6 text-sm text-muted-foreground">
														<LoaderIcon class="h-4 w-4 animate-spin" />
														Se încarcă ad set-urile...
													</div>
												</TableCell>
											</TableRow>
										{:else if adsetData.has(campaign.campaignId)}
											{#each adsetData.get(campaign.campaignId) || [] as adset}
												<TableRow class="bg-muted/15 border-l-3 border-l-primary/30 text-muted-foreground cursor-pointer hover:bg-muted/25" onclick={() => toggleExpandAdset(adset.adsetId)}>
													<TableCell class="w-[40px]"></TableCell>
													<TableCell class="max-w-[250px]">
														<div class="flex items-center gap-1.5 pl-4">
															{#if expandedAdsets.has(adset.adsetId)}
																<ChevronDownIcon class="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
															{:else}
																<ChevronRightIcon class="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
															{/if}
															<div class="truncate text-sm text-foreground/80" title={adset.adsetName}>{adset.adsetName}</div>
														</div>
													</TableCell>
													<TableCell></TableCell>
													{#each activePreset.columns as col}
														<TableCell class="{col.align === 'right' ? 'text-right' : ''} text-sm text-foreground/80">
															<div>{col.getValue(adset as any, currency)}</div>
															{#if col.getSubtext}
																{@const sub = col.getSubtext(adset as any)}
																{#if sub}
																	<div class="text-xs text-muted-foreground">{sub}</div>
																{/if}
															{/if}
														</TableCell>
													{/each}
													<TableCell></TableCell>
												</TableRow>
												<!-- Expanded ad rows -->
												{#if expandedAdsets.has(adset.adsetId)}
													{#if adsLoading.has(adset.adsetId)}
														<TableRow class="bg-muted/10">
															<TableCell></TableCell>
															<TableCell colspan={activePreset.columns.length + 3}>
																<div class="flex items-center gap-2 py-2 pl-12 text-sm text-muted-foreground">
																	<LoaderIcon class="h-4 w-4 animate-spin" />
																	Se încarcă reclamele...
																</div>
															</TableCell>
														</TableRow>
													{:else if adsData.has(adset.adsetId)}
														{#each adsData.get(adset.adsetId) || [] as ad}
															<TableRow class="bg-muted/8 border-l-3 border-l-primary/15 text-muted-foreground/80">
																<TableCell class="w-[40px]"></TableCell>
																<TableCell class="max-w-[250px]">
																	<div class="flex items-center gap-1.5 pl-10">
																		<span class="text-muted-foreground/30">└</span>
																		<div class="truncate text-xs text-foreground/70" title={ad.adName}>{ad.adName}</div>
																	</div>
																</TableCell>
																<TableCell></TableCell>
																{#each activePreset.columns as col}
																	<TableCell class="{col.align === 'right' ? 'text-right' : ''} text-xs text-foreground/70">
																		<div>{col.getValue(ad as any, currency)}</div>
																		{#if col.getSubtext}
																			{@const sub = col.getSubtext(ad as any)}
																			{#if sub}
																				<div class="text-xs text-muted-foreground">{sub}</div>
																			{/if}
																		{/if}
																	</TableCell>
																{/each}
																<TableCell class="w-[50px] text-center">{#if ad.previewUrl}<a href={ad.previewUrl} target="_blank" rel="noopener" class="text-muted-foreground hover:text-primary" title="Previzualizare reclamă" onclick={(e) => e.stopPropagation()}><EyeIcon class="h-3.5 w-3.5 inline-block" /></a>{/if}</TableCell>
															</TableRow>
														{/each}
													{/if}
												{/if}
											{/each}
										{/if}
									{/if}
								{/each}
								<!-- Total row -->
								<TableRow class="bg-muted/50 font-semibold border-t-2">
									<TableCell></TableCell>
									<TableCell>Total {filteredCampaigns.length} campanii{objectiveFilter !== 'all' ? ` (${objectiveFilter})` : ''}</TableCell>
									<TableCell></TableCell>
									{#each activePreset.columns as col}
										<TableCell class={col.align === 'right' ? 'text-right' : ''}>
											{col.getTotalValue ? col.getTotalValue(filteredCampaigns, currency) : '-'}
										</TableCell>
									{/each}
									<TableCell></TableCell>
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

