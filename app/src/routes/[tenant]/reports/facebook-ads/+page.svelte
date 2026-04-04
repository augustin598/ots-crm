<script lang="ts">
	import { getReportAdAccounts, getMetaCampaignInsights, getMetaActiveCampaigns, getMetaAdsetInsights, getMetaAdInsights, updateBudget, toggleCampaignStatus } from '$lib/remotes/reports.remote';
	import { page } from '$app/state';
	import {
		Table, TableBody, TableCell, TableHead, TableHeader, TableRow
	} from '$lib/components/ui/table';
	import { Card } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { Input } from '$lib/components/ui/input';
	import { Switch } from '$lib/components/ui/switch';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Dialog from '$lib/components/ui/dialog';
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
	import PencilIcon from '@lucide/svelte/icons/pencil';
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
	import { toast } from 'svelte-sonner';
	import { clientLogger } from '$lib/client-logger';
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

	const tenantSlug = $derived(page.params.tenant as string);

	// Date range state
	const defaults = getDefaultDateRange();
	let since = $state(defaults.since);
	let until = $state(defaults.until);

	// Ad accounts
	const accountsQuery = getReportAdAccounts();
	const accounts = $derived(accountsQuery.current || []);
	const accountsLoading = $derived(accountsQuery.loading);

	let selectedAccountId = $state<string>('');
	let selectedIntegrationId = $state<string>('');

	// Auto-select account from URL param or first in list
	$effect(() => {
		if (accounts.length > 0 && !selectedAccountId) {
			const urlAccount = page.url.searchParams.get('account');
			const match = urlAccount && accounts.find((a: any) => a.metaAdAccountId === urlAccount);
			const account = match || accounts[0];
			selectedAccountId = account.metaAdAccountId;
			selectedIntegrationId = account.integrationId;
		}
	});

	// Get currency from selected account
	const selectedCurrency = $derived.by(() => {
		const account = accounts.find((a: any) => a.metaAdAccountId === selectedAccountId);
		return account?.currency || 'RON';
	});

	// Payment warning (unpaid balance, grace period, account stopped for payment issues)
	const paymentWarning = $derived.by(() => {
		const account = accounts.find((a: any) => a.metaAdAccountId === selectedAccountId);
		if (!account) return null;
		// Cont dezactivat din cauza problemelor de plată
		if (account.disableReason === 3) {
			return {
				level: 'error' as const,
				text: 'Contul Meta Ads a fost dezactivat din cauza problemelor de plată. Verifică și actualizează metoda de plată în Business Manager.'
			};
		}
		// Factură neachitată – livrarea reclamelor poate fi pauzată
		if (account.accountStatus === 3) {
			return {
				level: 'error' as const,
				text: 'Contul Meta Ads are o factură neachitată (UNSETTLED). Reclamele pot fi oprite până la efectuarea plății.'
			};
		}
		// Perioadă de grație – plată restantă dar contul încă activ
		if (account.accountStatus === 9) {
			return {
				level: 'warning' as const,
				text: 'Contul Meta Ads se află în perioadă de grație pentru plată. Achită factura pentru a evita oprirea reclamelor.'
			};
		}
		return null;
	});

	// Token / integration status warning
	const tokenWarning = $derived.by(() => {
		const account = accounts.find((a: any) => a.metaAdAccountId === selectedAccountId);
		if (!account) return null;
		// Check if integration is deactivated (token revoked/invalid)
		if (account.integrationActive === false) {
			return { expired: true, text: 'Conexiunea Meta Ads pentru acest cont a fost dezactivată (token revocat sau invalid). Reconectează din Settings.' };
		}
		// Check if account itself is inactive
		if (account.isActive === false) {
			return { expired: true, text: 'Acest cont Meta Ads este dezactivat. Verifică starea contului în Business Manager sau reconectează din Settings.' };
		}
		if (!account.tokenExpiresAt) return null;
		const expiresAt = new Date(account.tokenExpiresAt);
		const now = new Date();
		const daysLeft = Math.floor((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
		if (daysLeft < 0) return { expired: true, text: `Tokenul Meta Ads a expirat pe ${expiresAt.toLocaleDateString('ro-RO')}. Reconectează din Settings.` };
		if (daysLeft <= 7) return { expired: false, text: `Tokenul Meta Ads expiră în ${daysLeft} zile (${expiresAt.toLocaleDateString('ro-RO')}). Reconectează din Settings pentru a evita întreruperi.` };
		return null;
	});

	function handleAccountChange(e: Event) {
		const value = (e.target as HTMLSelectElement).value;
		selectedAccountId = value;
		const account = accounts.find((a: any) => a.metaAdAccountId === value);
		selectedIntegrationId = account?.integrationId || '';
		selectedCampaigns = new Set();
		objectiveFilter = 'all';
		currentPage = 1;
	}

	// Campaign insights (reactive based on account + date range)
	let insightsQuery = $state<ReturnType<typeof getMetaCampaignInsights> | null>(null);
	let campaignsQuery = $state<ReturnType<typeof getMetaActiveCampaigns> | null>(null);

	$effect(() => {
		if (selectedAccountId && selectedIntegrationId && since && until) {
			insightsQuery = getMetaCampaignInsights({
				adAccountId: selectedAccountId,
				integrationId: selectedIntegrationId,
				since,
				until,
				timeIncrement: 'daily'
			});
			campaignsQuery = getMetaActiveCampaigns({
				adAccountId: selectedAccountId,
				integrationId: selectedIntegrationId
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

	// KPI cards, charts, demographics use filtered insights when campaigns are selected
	const dailyData = $derived(aggregateInsightsByDate(filteredInsights));
	const totals = $derived(computeTotals(dailyData));

	// Campaign IDs for demographics — respects both selectedCampaigns and objectiveFilter
	const demographicCampaignIds = $derived.by(() => {
		if (selectedCampaigns.size > 0) return [...selectedCampaigns];
		if (objectiveFilter !== 'all') return filteredCampaigns.map(c => c.campaignId);
		return [];
	});

	// Map optimization goals to action types (client-side mirror of OPTIMIZATION_GOAL_MAP)
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

	// Dynamic result KPI — detect dominant result type across filtered campaigns
	const resultKpi = $derived.by(() => {
		const filteredCampaignData = aggregateInsightsByCampaign(filteredInsights);
		const withResults = filteredCampaignData.filter(c => c.conversions > 0);
		if (withResults.length === 0) return { label: 'Rezultate', value: '-', subtext: 'Fără date' };

		const totalResults = withResults.reduce((s, c) => s + c.conversions, 0);
		const totalSpend = withResults.reduce((s, c) => s + c.spend, 0);

		// Find most common result type
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

	// Build campaign table data by merging insights with ALL campaigns (including those without data)
	const campaignTableData = $derived.by(() => {
		const insightMap = new Map(campaignData.map((c) => [c.campaignId, c]));
		const result: Array<CampaignAggregate & { status: string; dailyBudget: string | null; lifetimeBudget: string | null; budgetSource: string; adsetId: string | null; previewUrl: string | null; startTime: string | null; stopTime: string | null }> = [];

		// Merge campaigns with insights; only show campaigns without data if they're ACTIVE
		for (const ci of campaigns) {
			const insight = insightMap.get(ci.campaignId);
			if (insight) {
				result.push({
					...insight,
					status: ci.status,
					dailyBudget: ci.dailyBudget || null,
					lifetimeBudget: ci.lifetimeBudget || null,
					budgetSource: ci.budgetSource || 'campaign',
					adsetId: ci.adsetId || null,
					previewUrl: ci.previewUrl || null,
					startTime: ci.startTime || null,
					stopTime: ci.stopTime || null
				});
				insightMap.delete(ci.campaignId);
			} else if (ci.status === 'ACTIVE' || ci.status === 'WITH_ISSUES' || ci.status === 'IN_PROCESS') {
				// Only show active campaigns without data (skip paused/off with no spend in period)
				result.push({
					campaignId: ci.campaignId,
					campaignName: ci.campaignName,
					objective: ci.objective,
					spend: 0, impressions: 0, reach: 0, frequency: 0, clicks: 0,
					conversions: 0, conversionValue: 0,
					cpc: 0, cpm: 0, ctr: 0,
					costPerConversion: 0, roas: 0,
					resultType: '', cpaLabel: 'CPA',
					purchases: 0, leads: 0,
					linkClicks: 0, landingPageViews: 0, pageEngagement: 0,
					postReactions: 0, postComments: 0, postSaves: 0, postShares: 0, videoViews: 0, callsPlaced: 0,
					status: ci.status,
					dailyBudget: ci.dailyBudget || null,
					lifetimeBudget: ci.lifetimeBudget || null,
					budgetSource: ci.budgetSource || 'campaign',
					adsetId: ci.adsetId || null,
					previewUrl: ci.previewUrl || null,
					startTime: ci.startTime || null,
					stopTime: ci.stopTime || null
				});
			}
		}

		// Add any remaining insights not matched to a campaign
		for (const [, c] of insightMap) {
			result.push({
				...c,
				status: 'UNKNOWN',
				dailyBudget: null,
				lifetimeBudget: null,
				budgetSource: 'campaign' as const,
				adsetId: null,
				previewUrl: null,
				startTime: null,
				stopTime: null
			});
		}

		return result;
	});

	// Status filter
	let statusFilter = $state<'all' | 'active' | 'paused' | 'deleted'>('all');
	const STATUS_FILTERS: { key: typeof statusFilter; label: string; activeClass: string }[] = [
		{ key: 'all', label: 'Toate', activeClass: 'bg-primary text-primary-foreground' },
		{ key: 'active', label: 'Active', activeClass: 'bg-green-600 text-white' },
		{ key: 'paused', label: 'Paused', activeClass: 'bg-amber-500 text-white' },
	];

	// Objective type filter (declared at line 139, before filteredInsights)
	const statusFilteredCampaigns = $derived.by(() => {
		if (statusFilter === 'all') return campaignTableData;
		if (statusFilter === 'active') return campaignTableData.filter(c => c.status === 'ACTIVE' || c.status === 'WITH_ISSUES' || c.status === 'IN_PROCESS');
		if (statusFilter === 'paused') return campaignTableData.filter(c => c.status === 'PAUSED' || c.status === 'CAMPAIGN_PAUSED');
		if (statusFilter === 'deleted') return campaignTableData.filter(c => c.status === 'DELETED' || c.status === 'ARCHIVED');
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
				return b.spend - a.spend; // secondary sort by spend
			}
			const av = a[sortColumn as keyof typeof a];
			const bv = b[sortColumn as keyof typeof b];
			if (typeof av === 'string' && typeof bv === 'string') return dir * av.localeCompare(bv);
			if (typeof av === 'number' && typeof bv === 'number') return dir * (av - bv);
			return 0;
		})
	);

	// Column presets
	let selectedPresetKey = $state(DEFAULT_PRESET);
	const activePreset = $derived(getPreset(selectedPresetKey));

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
		if (selectedAccountId && selectedIntegrationId && since && until) {
			insightsQuery = getMetaCampaignInsights({
				adAccountId: selectedAccountId,
				integrationId: selectedIntegrationId,
				since,
				until,
				timeIncrement: 'daily'
			});
			campaignsQuery = getMetaActiveCampaigns({
				adAccountId: selectedAccountId,
				integrationId: selectedIntegrationId
			});
			toast.success('Se reîncarcă datele...');
		}
	}

	// Budget edit
	let budgetDialogOpen = $state(false);
	let budgetEditCampaign = $state<{ targetId: string; campaignName: string; budgetType: 'daily' | 'lifetime'; currentAmount: number } | null>(null);
	let budgetNewAmount = $state('');
	let budgetSaving = $state(false);

	function openBudgetEdit(campaign: any) {
		const type = campaign.dailyBudget ? 'daily' : 'lifetime';
		const current = campaign.dailyBudget
			? parseFloat(campaign.dailyBudget) / 100
			: campaign.lifetimeBudget ? parseFloat(campaign.lifetimeBudget) / 100 : 0;
		// Use ad set ID for budget update when budget is on ad set, otherwise campaign ID
		const targetId = campaign.budgetSource === 'adset' && campaign.adsetId ? campaign.adsetId : campaign.campaignId;
		budgetEditCampaign = { targetId, campaignName: campaign.campaignName, budgetType: type, currentAmount: current };
		budgetNewAmount = String(current);
		budgetDialogOpen = true;
	}

	async function handleBudgetSave() {
		if (!budgetEditCampaign || !selectedIntegrationId) return;
		const amount = parseFloat(budgetNewAmount);
		if (isNaN(amount) || amount <= 0) {
			clientLogger.warn({ message: 'Sumă invalidă - Introdu o sumă mai mare de 0.', action: 'fb_report_budget_save' });
			return;
		}
		if (amount < 1) {
			clientLogger.warn({ message: 'Buget prea mic - Meta Ads necesită un buget minim de 1 RON/zi.', action: 'fb_report_budget_save' });
			return;
		}

		budgetSaving = true;
		try {
			await updateBudget({
				targetId: budgetEditCampaign.targetId,
				integrationId: selectedIntegrationId,
				budgetType: budgetEditCampaign.budgetType,
				budgetAmount: amount
			});
			const tipBuget = budgetEditCampaign.budgetType === 'daily' ? 'zilnic' : 'total';
			toast.success(`Bugetul ${tipBuget} pentru "${budgetEditCampaign.campaignName}" a fost actualizat la ${amount} ${selectedCurrency}`, {
				description: 'Pagina se va reîncărca cu datele noi.',
				duration: 3000
			});
			budgetDialogOpen = false;
			handleRefresh();
		} catch (e) {
			clientLogger.apiError('fb_report_budget_save', e);
		} finally {
			budgetSaving = false;
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

	// Derive result action types from selected/visible campaigns only
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
		let dominant = 'Rezultate';
		let max = 0;
		for (const [type, count] of typeCounts) {
			if (count > max) { max = count; dominant = type; }
		}
		return dominant;
	});

	let togglingCampaignId = $state<string | null>(null);

	async function handleToggleStatus(campaign: any) {
		if (!selectedIntegrationId) return;
		const newStatus = campaign.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
		const label = newStatus === 'ACTIVE' ? 'pornită' : 'oprită';
		togglingCampaignId = campaign.campaignId;
		try {
			await toggleCampaignStatus({
				campaignId: campaign.campaignId,
				integrationId: selectedIntegrationId,
				newStatus
			});
			toast.success(`Campania "${campaign.campaignName}" a fost ${label}`, { duration: 2000 });
			handleRefresh();
		} catch (e) {
			clientLogger.apiError('fb_report_toggle_status', e);
		} finally {
			togglingCampaignId = null;
		}
	}

	// ---- Objective display config ----
	const OBJECTIVE_CONFIG: Record<string, { label: string; icon: any; color: string }> = {
		OUTCOME_LEADS: { label: 'Leads', icon: UsersIcon, color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
		LEAD_GENERATION: { label: 'Leads', icon: UsersIcon, color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
		OUTCOME_TRAFFIC: { label: 'Trafic', icon: MousePointerIcon, color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
		LINK_CLICKS: { label: 'Trafic', icon: MousePointerIcon, color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
		OUTCOME_SALES: { label: 'Vânzări', icon: ShoppingCartIcon, color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
		CONVERSIONS: { label: 'Conversii', icon: TargetIcon, color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
		OUTCOME_ENGAGEMENT: { label: 'Engagement', icon: HeartIcon, color: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400' },
		POST_ENGAGEMENT: { label: 'Engagement', icon: HeartIcon, color: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400' },
		OUTCOME_AWARENESS: { label: 'Awareness', icon: MegaphoneIcon, color: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400' },
		REACH: { label: 'Reach', icon: MegaphoneIcon, color: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400' },
		OUTCOME_APP_PROMOTION: { label: 'App', icon: DownloadIcon, color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400' },
		APP_INSTALLS: { label: 'App', icon: DownloadIcon, color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400' },
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

		if (!adsetData.has(campaignId) && selectedAccountId && selectedIntegrationId) {
			const loadingNext = new Set(adsetLoading);
			loadingNext.add(campaignId);
			adsetLoading = loadingNext;

			try {
				const query = getMetaAdsetInsights({
					adAccountId: selectedAccountId,
					integrationId: selectedIntegrationId,
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

		if (!adsData.has(adsetId) && selectedAccountId && selectedIntegrationId) {
			const loadingNext = new Set(adsLoading);
			loadingNext.add(adsetId);
			adsLoading = loadingNext;

			try {
				const query = getMetaAdInsights({
					adAccountId: selectedAccountId,
					integrationId: selectedIntegrationId,
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

	function getStatusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' {
		switch (status) {
			case 'ACTIVE': return 'success';
			case 'PAUSED': case 'CAMPAIGN_PAUSED': return 'warning';
			case 'DELETED': return 'destructive';
			case 'ARCHIVED': return 'secondary';
			default: return 'outline';
		}
	}
</script>

<style>
	.table-scroll {
		scrollbar-width: thin;
		scrollbar-color: hsl(var(--muted-foreground) / 0.3) transparent;
	}
	.table-scroll::-webkit-scrollbar {
		height: 8px;
	}
	.table-scroll::-webkit-scrollbar-track {
		background: transparent;
	}
	.table-scroll::-webkit-scrollbar-thumb {
		background-color: hsl(var(--muted-foreground) / 0.3);
		border-radius: 4px;
	}
</style>

<div class="space-y-6">
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
			<DateRangePicker bind:since bind:until onchange={() => { currentPage = 1; objectiveFilter = 'all'; selectedCampaigns = new Set(); }} />
			{#if accounts.length > 0}
				<div class="flex items-center gap-2">
					<IconFacebook class="h-4 w-4" />
					<select
						class="h-9 rounded-md border border-input bg-background px-3 text-sm"
						value={selectedAccountId}
						onchange={handleAccountChange}
					>
						{#each accounts as account}
							<option value={account.metaAdAccountId}>
								{account.accountName || account.metaAdAccountId}
								{#if account.clientName} — {account.clientName}{/if}
								{#if account.integrationActive === false} ⚠ Dezactivat{/if}
							</option>
						{/each}
					</select>
				</div>
			{/if}
			<a href="/api/export/spending?format=excel&platform=meta" download>
				<Button variant="outline" size="sm">
					<DownloadIcon class="h-4 w-4" />
				</Button>
			</a>
			<Button variant="outline" size="sm" onclick={handleRefresh}>
				<RefreshCwIcon class="h-4 w-4" />
			</Button>
		</div>
	</div>

	<!-- Payment warning (unpaid balance / grace period / stopped for payment) -->
	{#if paymentWarning}
		<div class="rounded-md p-4 {paymentWarning.level === 'error' ? 'bg-red-50 border border-red-200' : 'bg-amber-50 border border-amber-200'}">
			<div class="flex items-start gap-2">
				<span class="text-base leading-5">{paymentWarning.level === 'error' ? '💳' : '⚠️'}</span>
				<p class="text-sm {paymentWarning.level === 'error' ? 'text-red-800' : 'text-amber-800'}">
					{paymentWarning.text}
					<a href="https://business.facebook.com/billing" target="_blank" rel="noopener noreferrer" class="underline font-medium ml-1">Mergi la facturare →</a>
				</p>
			</div>
		</div>
	{/if}

	<!-- Token expiration warning -->
	{#if tokenWarning}
		<div class="rounded-md p-4 {tokenWarning.expired ? 'bg-red-50 border border-red-200' : 'bg-amber-50 border border-amber-200'}">
			<p class="text-sm {tokenWarning.expired ? 'text-red-800' : 'text-amber-800'}">
				{tokenWarning.text}
				<a href="/{tenantSlug}/settings/meta-ads" class="underline font-medium ml-1">Settings → Meta Ads</a>
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
			<p class="text-muted-foreground">Nu sunt conturi Meta Ads configurate. Conectează un Business Manager din <a href="/{tenantSlug}/settings/meta-ads" class="text-primary underline">Settings</a>.</p>
		</Card>
	{:else if insightsError}
		<Card class="p-8">
			<div class="rounded-md bg-red-50 p-4 space-y-2">
				<p class="text-sm font-medium text-red-800">{(insightsError as any)?.body?.message || (insightsError instanceof Error ? insightsError.message : null) || (insightsError as any)?.message || 'Eroare la încărcarea datelor'}</p>
				<p class="text-sm text-red-700">
					Dacă tokenul a expirat, reconectează din
					<a href="/{tenantSlug}/settings/meta-ads" class="underline font-medium">Settings → Meta Ads</a>.
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
					{#key objectiveFilter + String(selectedCampaigns.size)}<h3 class="mb-4 text-lg font-semibold">Cheltuieli în timp</h3>
					<SpendChart data={dailyData.map(d => ({ date: d.date, spend: d.spend }))} currency={selectedCurrency} />{/key}
				</Card>
				<Card class="p-4">
					{#key objectiveFilter + String(selectedCampaigns.size)}<h3 class="mb-4 text-lg font-semibold">{resultKpi.label} & Cost per {resultKpi.label.toLowerCase()}</h3>
					<ConversionsChart data={dailyData.map(d => ({ date: d.date, conversions: d.conversions, costPerConversion: d.costPerConversion }))} currency={selectedCurrency} />
				{/key}</Card>
			</div>
		{/if}

		<!-- Demographics -->
		{#if !insightsLoading && selectedAccountId && selectedIntegrationId}
			<DemographicsSection
				adAccountId={selectedAccountId}
				integrationId={selectedIntegrationId}
				{since}
				{until}
				currency={selectedCurrency}
				campaignIds={demographicCampaignIds}
				{resultActionTypes}
				resultLabel={dominantResultLabel}
			/>
		{/if}

		<!-- Campaign Performance Table -->
		{#if !insightsLoading}
			<div class="min-w-0 space-y-4">
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
						{#if availableObjectives.length > 1}
							<div class="flex items-center gap-1.5"><span class="text-xs text-muted-foreground">Tip:</span><div class="flex items-center gap-1 rounded-lg border p-0.5">
								<button
									class="px-3 py-1 text-xs rounded-md transition-colors {objectiveFilter === 'all' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}"
									onclick={() => { objectiveFilter = 'all'; currentPage = 1; }}
								>Toate</button>
								{#each availableObjectives as obj}
									<button
										class="flex items-center gap-1 px-3 py-1 text-xs rounded-md transition-colors {objectiveFilter === obj.label ? obj.color : 'text-muted-foreground hover:text-foreground'}"
										onclick={() => { objectiveFilter = obj.label; currentPage = 1; }}
									><obj.icon class="h-3 w-3" />{obj.label}</button>
								{/each}
							</div></div>
						{/if}
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
								{#each COLUMN_PRESETS as preset}
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
					<div class="relative">
						<div class="rounded-md border overflow-x-auto pb-2 table-scroll">
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
									<TableHead class="w-[50px]">On/Off</TableHead>
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
								{#each paginatedCampaigns as campaign}
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
										<TableCell class="w-[50px]" onclick={(e) => e.stopPropagation()}>
											<Switch
												checked={campaign.status === 'ACTIVE'}
												disabled={togglingCampaignId === campaign.campaignId || (campaign.status !== 'ACTIVE' && campaign.status !== 'PAUSED')}
												onCheckedChange={() => handleToggleStatus(campaign)}
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
											<Badge variant={getStatusVariant(campaign.status)}>
												{campaign.status}
											</Badge>
										</TableCell>
										{#each activePreset.columns as col}
											<TableCell class={col.align === 'right' ? 'text-right' : ''} onclick={(e) => col.key === 'budget' ? e.stopPropagation() : null}>
												{#if col.key === 'budget'}
													<div class="flex items-center justify-end gap-1">
														<span>{col.getValue(campaign, selectedCurrency)}</span>
														{#if campaign.dailyBudget || campaign.lifetimeBudget}
															<button class="text-muted-foreground hover:text-primary" onclick={() => openBudgetEdit(campaign)} title="Editează buget">
																<PencilIcon class="h-3 w-3" />
															</button>
														{/if}
													</div>
													{#if col.getSubtext}
														{@const sub = col.getSubtext(campaign)}
														{#if sub}<div class="text-xs text-muted-foreground">{sub}</div>{/if}
													{/if}
												{:else}
													<div>{col.getValue(campaign, selectedCurrency)}</div>
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
									<!-- Expanded ad set rows -->
									{#if expandedCampaigns.has(campaign.campaignId)}
										{#if adsetLoading.has(campaign.campaignId)}
											<TableRow class="bg-muted/20">
												<TableCell></TableCell>
												<TableCell colspan={activePreset.columns.length + 4}>
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
													<TableCell class="w-[50px]"></TableCell>
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
															<div>{col.getValue(adset as any, selectedCurrency)}</div>
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
															<TableCell colspan={activePreset.columns.length + 4}>
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
																<TableCell class="w-[50px]"></TableCell>
																<TableCell class="max-w-[250px]">
																	<div class="flex items-center gap-1.5 pl-10">
																		<span class="text-muted-foreground/30">└</span>
																		<div class="truncate text-xs text-foreground/70" title={ad.adName}>{ad.adName}</div>
																	</div>
																</TableCell>
																<TableCell></TableCell>
																{#each activePreset.columns as col}
																	<TableCell class="{col.align === 'right' ? 'text-right' : ''} text-xs text-foreground/70">
																		<div>{col.getValue(ad as any, selectedCurrency)}</div>
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
									<TableCell></TableCell>
									<TableCell>Rezultate din {filteredCampaigns.length} campanii{objectiveFilter !== 'all' ? ` (${objectiveFilter})` : ''}</TableCell>
									<TableCell></TableCell>
									{#each activePreset.columns as col}
										<TableCell class={col.align === 'right' ? 'text-right' : ''}>
											{col.getTotalValue ? col.getTotalValue(filteredCampaigns, selectedCurrency) : '-'}
										</TableCell>
									{/each}
									<TableCell></TableCell>
								</TableRow>
							</TableBody>
						</Table>
						</div>
						<div class="pointer-events-none absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-background to-transparent rounded-r-md"></div>
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

<!-- Budget Edit Dialog -->
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
					<Button
						variant={budgetEditCampaign?.budgetType === 'daily' ? 'default' : 'outline'}
						size="sm"
						onclick={() => { if (budgetEditCampaign) budgetEditCampaign.budgetType = 'daily'; }}
					>Zilnic</Button>
					<Button
						variant={budgetEditCampaign?.budgetType === 'lifetime' ? 'default' : 'outline'}
						size="sm"
						onclick={() => { if (budgetEditCampaign) budgetEditCampaign.budgetType = 'lifetime'; }}
					>Total</Button>
				</div>
			</div>
			<div class="space-y-2">
				<label for="budget-amount-input" class="text-sm font-medium">Sumă ({selectedCurrency})</label>
				<Input
					id="budget-amount-input"
					type="number"
					min="1"
					step="0.01"
					bind:value={budgetNewAmount}
					placeholder="Ex: 50.00"
				/>
				{#if budgetEditCampaign?.currentAmount}
					<p class="text-xs text-muted-foreground">Buget actual: {budgetEditCampaign.currentAmount} {selectedCurrency}</p>
				{/if}
			</div>
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => { budgetDialogOpen = false; }}>Anulează</Button>
			<Button onclick={handleBudgetSave} disabled={budgetSaving}>
				{budgetSaving ? 'Se salvează...' : 'Salvează'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

