import type { MetaAdsCampaignInsight, MetaAdsAdsetInsight, MetaAdsAdInsight } from '$lib/server/meta-ads/client';

export interface DailyAggregate {
	date: string;
	spend: number;
	impressions: number;
	reach: number;
	clicks: number;
	conversions: number;
	conversionValue: number;
	cpc: number;
	cpm: number;
	ctr: number;
	ctrLink: number;
	costPerConversion: number;
	roas: number;
	frequency: number;
	linkClicks: number;
	landingPageViews: number;
	pageEngagement: number;
	postReactions: number;
	postComments: number;
	postSaves: number;
	postShares: number;
	videoViews: number;
	leads: number;
	purchases: number;
	callsPlaced: number;
}

export interface CampaignAggregate {
	campaignId: string;
	campaignName: string;
	objective: string;
	spend: number;
	impressions: number;
	reach: number;
	frequency: number;
	clicks: number;
	conversions: number;
	conversionValue: number;
	cpc: number;
	cpm: number;
	ctr: number;
	costPerConversion: number;
	roas: number;
	resultType: string;
	cpaLabel: string;
	purchases: number;
	leads: number;
	linkClicks: number;
	landingPageViews: number;
	pageEngagement: number;
	postReactions: number;
	postComments: number;
	postSaves: number;
	postShares: number;
	videoViews: number;
	callsPlaced: number;
	/** Aggregated raw actions from Meta API for conversion breakdown */
	rawActions: Array<{ action_type: string; value: number }>;
}

export function calculateROAS(revenue: number, spend: number): number {
	if (spend <= 0) return 0;
	return revenue / spend;
}

/** Aggregate campaign insights by date for time-series charts */
export function aggregateInsightsByDate(insights: MetaAdsCampaignInsight[]): DailyAggregate[] {
	type Acc = {
		spend: number; impressions: number; reach: number; clicks: number;
		conversions: number; conversionValue: number;
		linkClicks: number; landingPageViews: number; pageEngagement: number;
		postReactions: number; postComments: number; postSaves: number; postShares: number;
		videoViews: number; leads: number; purchases: number; callsPlaced: number;
	};
	const byDate = new Map<string, Acc>();

	for (const row of insights) {
		const date = row.dateStart;
		const existing = byDate.get(date) || {
			spend: 0, impressions: 0, reach: 0, clicks: 0,
			conversions: 0, conversionValue: 0,
			linkClicks: 0, landingPageViews: 0, pageEngagement: 0,
			postReactions: 0, postComments: 0, postSaves: 0, postShares: 0,
			videoViews: 0, leads: 0, purchases: 0, callsPlaced: 0
		};
		existing.spend += parseFloat(row.spend);
		existing.impressions += parseInt(row.impressions);
		existing.reach += parseInt(row.reach || '0');
		existing.clicks += parseInt(row.clicks);
		existing.conversions += row.conversions;
		existing.conversionValue += row.conversionValue;
		existing.linkClicks += row.linkClicks;
		existing.landingPageViews += row.landingPageViews;
		existing.pageEngagement += row.pageEngagement;
		existing.postReactions += row.postReactions;
		existing.postComments += row.postComments;
		existing.postSaves += row.postSaves;
		existing.postShares += row.postShares;
		existing.videoViews += row.videoViews;
		existing.leads += row.leads;
		existing.purchases += row.purchases;
		existing.callsPlaced += row.callsPlaced;
		byDate.set(date, existing);
	}

	return Array.from(byDate.entries())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([date, d]) => ({
			date,
			spend: d.spend,
			impressions: d.impressions,
			reach: d.reach,
			clicks: d.clicks,
			conversions: d.conversions,
			conversionValue: d.conversionValue,
			cpc: d.clicks > 0 ? d.spend / d.clicks : 0,
			cpm: d.impressions > 0 ? (d.spend / d.impressions) * 1000 : 0,
			ctr: d.impressions > 0 ? (d.clicks / d.impressions) * 100 : 0,
			ctrLink: d.impressions > 0 ? (d.linkClicks / d.impressions) * 100 : 0,
			costPerConversion: d.conversions > 0 ? d.spend / d.conversions : 0,
			roas: calculateROAS(d.conversionValue, d.spend),
			frequency: d.reach > 0 ? d.impressions / d.reach : 0,
			linkClicks: d.linkClicks,
			landingPageViews: d.landingPageViews,
			pageEngagement: d.pageEngagement,
			postReactions: d.postReactions,
			postComments: d.postComments,
			postSaves: d.postSaves,
			postShares: d.postShares,
			videoViews: d.videoViews,
			leads: d.leads,
			purchases: d.purchases,
			callsPlaced: d.callsPlaced
		}));
}

/** Aggregate campaign insights by campaign for the table */
export function aggregateInsightsByCampaign(insights: MetaAdsCampaignInsight[]): CampaignAggregate[] {
	type Acc = { name: string; objective: string; spend: number; impressions: number; reach: number; frequency: number; clicks: number; conversions: number; conversionValue: number; resultType: string; cpaLabel: string; purchases: number; leads: number; linkClicks: number; landingPageViews: number; pageEngagement: number; postReactions: number; postComments: number; postSaves: number; postShares: number; videoViews: number; callsPlaced: number; rawActionsMap: Map<string, number> };
	const byCampaign = new Map<string, Acc>();

	for (const row of insights) {
		const existing = byCampaign.get(row.campaignId) || {
			name: row.campaignName, objective: row.objective,
			spend: 0, impressions: 0, reach: 0, frequency: 0, clicks: 0, conversions: 0, conversionValue: 0,
			resultType: row.resultType || '', cpaLabel: row.cpaLabel || 'CPA',
			purchases: 0, leads: 0, linkClicks: 0, landingPageViews: 0, pageEngagement: 0, postReactions: 0, postComments: 0, postSaves: 0, postShares: 0, videoViews: 0, callsPlaced: 0,
			rawActionsMap: new Map<string, number>()
		};
		existing.spend += parseFloat(row.spend);
		existing.impressions += parseInt(row.impressions);
		existing.reach += parseInt(row.reach || '0');
		existing.clicks += parseInt(row.clicks);
		existing.conversions += row.conversions;
		existing.conversionValue += row.conversionValue;
		existing.purchases += row.purchases;
		existing.leads += row.leads;
		existing.linkClicks += row.linkClicks;
		existing.landingPageViews += row.landingPageViews;
		existing.pageEngagement += row.pageEngagement;
		existing.postReactions += row.postReactions;
		existing.postComments += row.postComments;
		existing.postSaves += row.postSaves;
		existing.postShares += row.postShares;
		existing.videoViews += row.videoViews;
		existing.callsPlaced += row.callsPlaced;
		if (row.resultType && !existing.resultType) existing.resultType = row.resultType;
		if (row.cpaLabel && existing.cpaLabel === 'CPA') existing.cpaLabel = row.cpaLabel;
		// Aggregate raw actions
		for (const a of row.rawActions || []) {
			existing.rawActionsMap.set(a.action_type, (existing.rawActionsMap.get(a.action_type) || 0) + parseFloat(a.value));
		}
		byCampaign.set(row.campaignId, existing);
	}

	return Array.from(byCampaign.entries()).map(([campaignId, d]) => ({
		campaignId,
		campaignName: d.name,
		objective: d.objective,
		spend: d.spend,
		impressions: d.impressions,
		reach: d.reach,
		frequency: d.reach > 0 ? d.impressions / d.reach : 0,
		clicks: d.clicks,
		conversions: d.conversions,
		conversionValue: d.conversionValue,
		cpc: d.clicks > 0 ? d.spend / d.clicks : 0,
		cpm: d.impressions > 0 ? (d.spend / d.impressions) * 1000 : 0,
		ctr: d.impressions > 0 ? (d.clicks / d.impressions) * 100 : 0,
		costPerConversion: d.conversions > 0 ? d.spend / d.conversions : 0,
		roas: calculateROAS(d.conversionValue, d.spend),
		resultType: d.resultType,
		cpaLabel: d.cpaLabel,
		purchases: d.purchases,
		leads: d.leads,
		linkClicks: d.linkClicks,
		landingPageViews: d.landingPageViews,
		pageEngagement: d.pageEngagement,
		postReactions: d.postReactions,
		postComments: d.postComments,
		postSaves: d.postSaves,
		postShares: d.postShares,
		videoViews: d.videoViews,
		callsPlaced: d.callsPlaced,
		rawActions: Array.from(d.rawActionsMap.entries())
			.map(([action_type, value]) => ({ action_type, value: Math.round(value) }))
			.filter(a => a.value > 0)
			.sort((a, b) => b.value - a.value)
	}));
}

/** Compute totals from daily aggregates for KPI cards */
export function computeTotals(dailyData: Pick<DailyAggregate, 'spend' | 'impressions' | 'clicks' | 'conversions' | 'conversionValue'>[]): {
	totalSpend: number;
	totalImpressions: number;
	totalClicks: number;
	totalConversions: number;
	totalConversionValue: number;
	avgCpc: number;
	avgCpm: number;
	avgCtr: number;
	avgCostPerConversion: number;
	roas: number;
} {
	let totalSpend = 0;
	let totalImpressions = 0;
	let totalClicks = 0;
	let totalConversions = 0;
	let totalConversionValue = 0;

	for (const d of dailyData) {
		totalSpend += d.spend;
		totalImpressions += d.impressions;
		totalClicks += d.clicks;
		totalConversions += d.conversions;
		totalConversionValue += d.conversionValue;
	}

	return {
		totalSpend,
		totalImpressions,
		totalClicks,
		totalConversions,
		totalConversionValue,
		avgCpc: totalClicks > 0 ? totalSpend / totalClicks : 0,
		avgCpm: totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0,
		avgCtr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0,
		avgCostPerConversion: totalConversions > 0 ? totalSpend / totalConversions : 0,
		roas: calculateROAS(totalConversionValue, totalSpend)
	};
}

/** KPI card descriptor — icon is a string key mapped to Lucide icons in the page */
export interface KpiDescriptor {
	key: string;
	label: string;
	icon: string;
	value: string;
	subtext: string;
}

/**
 * Get 5 KPI card configs adapted to the dominant campaign objective.
 * Uses campaign-level aggregates for action-specific metrics (linkClicks, leads, etc.)
 * and daily totals for aggregate metrics (spend, impressions, etc.).
 */
export function getObjectiveKpiCards(
	objective: string,
	totals: ReturnType<typeof computeTotals>,
	campaignAggregates: CampaignAggregate[],
	currency: string,
	resultKpi: { label: string; value: string; subtext: string }
): KpiDescriptor[] {
	// Sum campaign-level action metrics
	const sum = (fn: (c: CampaignAggregate) => number) => campaignAggregates.reduce((s, c) => s + fn(c), 0);
	const totalLinkClicks = sum(c => c.linkClicks);
	const totalLPV = sum(c => c.landingPageViews);
	const totalReach = sum(c => c.reach);
	const totalVideoViews = sum(c => c.videoViews);
	const totalEngagement = sum(c => c.pageEngagement);
	const totalReactions = sum(c => c.postReactions);
	const totalComments = sum(c => c.postComments);
	const totalLeads = sum(c => c.leads);
	const totalPurchases = sum(c => c.purchases);
	const totalConvValue = sum(c => c.conversionValue);

	const avgFreq = totalReach > 0 ? totals.totalImpressions / totalReach : 0;
	const cpcLink = totalLinkClicks > 0 ? totals.totalSpend / totalLinkClicks : 0;
	const ctrLink = totals.totalImpressions > 0 ? (totalLinkClicks / totals.totalImpressions) * 100 : 0;
	const costPerLPV = totalLPV > 0 ? totals.totalSpend / totalLPV : 0;
	const cpe = totalEngagement > 0 ? totals.totalSpend / totalEngagement : 0;
	const cpl = totalLeads > 0 ? totals.totalSpend / totalLeads : 0;
	const roas = totals.totalSpend > 0 ? totalConvValue / totals.totalSpend : 0;
	const cpa = totalPurchases > 0 ? totals.totalSpend / totalPurchases : 0;

	switch (objective) {
		case 'OUTCOME_AWARENESS':
		case 'REACH':
		case 'BRAND_AWARENESS':
			return [
				{ key: 'reach', label: 'Reach', icon: 'users', value: formatNumber(totalReach), subtext: `${formatDecimal(avgFreq)} frecvență medie` },
				{ key: 'frequency', label: 'Frecvență', icon: 'repeat', value: formatDecimal(avgFreq), subtext: `${formatNumber(totalReach)} persoane unice` },
				{ key: 'cpm', label: 'CPM', icon: 'eye', value: formatCurrency(totals.avgCpm, currency), subtext: 'Cost per 1000 impresii' },
				{ key: 'impressions', label: 'Impresii', icon: 'eye', value: formatNumber(totals.totalImpressions), subtext: formatCurrency(totals.totalSpend, currency) + ' cheltuieli' },
				{ key: 'videoViews', label: 'Video views', icon: 'play', value: formatNumber(totalVideoViews), subtext: totalVideoViews > 0 ? formatCurrency(totals.totalSpend / totalVideoViews, currency) + '/view' : 'Fără date' }
			];

		case 'OUTCOME_TRAFFIC':
		case 'LINK_CLICKS':
			return [
				{ key: 'linkClicks', label: 'Link clicks', icon: 'mouse-pointer-click', value: formatNumber(totalLinkClicks), subtext: formatCurrency(cpcLink, currency) + ' per click' },
				{ key: 'cpc', label: 'CPC (link)', icon: 'dollar-sign', value: formatCurrency(cpcLink, currency), subtext: `${formatNumber(totalLinkClicks)} click-uri` },
				{ key: 'ctrLink', label: 'CTR (link)', icon: 'percent', value: formatPercent(ctrLink), subtext: 'Click-through rate' },
				{ key: 'lpv', label: 'Landing page views', icon: 'file-text', value: formatNumber(totalLPV), subtext: totalLPV > 0 ? formatCurrency(costPerLPV, currency) + '/vizită' : 'Fără date' },
				{ key: 'spend', label: 'Cheltuieli', icon: 'dollar-sign', value: formatCurrency(totals.totalSpend, currency), subtext: `${formatNumber(totals.totalImpressions)} impresii` }
			];

		case 'OUTCOME_ENGAGEMENT':
		case 'POST_ENGAGEMENT':
			return [
				{ key: 'engagement', label: 'Engagement total', icon: 'heart', value: formatNumber(totalEngagement), subtext: formatCurrency(cpe, currency) + ' per engagement' },
				{ key: 'cpe', label: 'Cost/engagement', icon: 'dollar-sign', value: totalEngagement > 0 ? formatCurrency(cpe, currency) : '-', subtext: `${formatNumber(totalEngagement)} interacțiuni` },
				{ key: 'reactions', label: 'Reacții', icon: 'thumbs-up', value: formatNumber(totalReactions), subtext: `${formatNumber(totalComments)} comentarii` },
				{ key: 'videoViews', label: 'Video views', icon: 'play', value: formatNumber(totalVideoViews), subtext: totalVideoViews > 0 ? formatCurrency(totals.totalSpend / totalVideoViews, currency) + '/view' : 'Fără date' },
				{ key: 'spend', label: 'Cheltuieli', icon: 'dollar-sign', value: formatCurrency(totals.totalSpend, currency), subtext: `${formatNumber(totals.totalImpressions)} impresii` }
			];

		case 'OUTCOME_LEADS':
		case 'LEAD_GENERATION':
			return [
				{ key: 'leads', label: 'Leads', icon: 'users', value: formatNumber(totalLeads > 0 ? totalLeads : totals.totalConversions), subtext: totalLeads > 0 ? formatCurrency(cpl, currency) + ' per lead' : resultKpi.subtext },
				{ key: 'cpl', label: 'Cost per lead', icon: 'dollar-sign', value: totalLeads > 0 ? formatCurrency(cpl, currency) : formatCurrency(totals.avgCostPerConversion, currency), subtext: `${formatNumber(totalLeads > 0 ? totalLeads : totals.totalConversions)} leads` },
				{ key: 'linkClicks', label: 'Link clicks', icon: 'mouse-pointer-click', value: formatNumber(totalLinkClicks), subtext: formatCurrency(cpcLink, currency) + ' CPC' },
				{ key: 'lpv', label: 'Landing page views', icon: 'file-text', value: formatNumber(totalLPV), subtext: totalLPV > 0 ? formatCurrency(costPerLPV, currency) + '/vizită' : 'Fără date' },
				{ key: 'spend', label: 'Cheltuieli', icon: 'dollar-sign', value: formatCurrency(totals.totalSpend, currency), subtext: `${formatNumber(totals.totalImpressions)} impresii` }
			];

		case 'OUTCOME_SALES':
		case 'CONVERSIONS':
			return [
				{ key: 'purchases', label: 'Vânzări', icon: 'shopping-cart', value: formatNumber(totalPurchases > 0 ? totalPurchases : totals.totalConversions), subtext: totalPurchases > 0 ? formatCurrency(cpa, currency) + ' per vânzare' : resultKpi.subtext },
				{ key: 'roas', label: 'ROAS', icon: 'trending-up', value: roas > 0 ? formatROAS(roas) : '-', subtext: roas > 0 ? formatCurrency(totalConvValue, currency) + ' venituri' : 'Fără date' },
				{ key: 'revenue', label: 'Venituri', icon: 'dollar-sign', value: totalConvValue > 0 ? formatCurrency(totalConvValue, currency) : '-', subtext: `din ${formatNumber(totalPurchases > 0 ? totalPurchases : totals.totalConversions)} conversii` },
				{ key: 'cpa', label: 'Cost per conversie', icon: 'dollar-sign', value: totalPurchases > 0 ? formatCurrency(cpa, currency) : formatCurrency(totals.avgCostPerConversion, currency), subtext: `din ${formatNumber(totalPurchases > 0 ? totalPurchases : totals.totalConversions)} vânzări` },
				{ key: 'linkClicks', label: 'Link clicks', icon: 'mouse-pointer-click', value: formatNumber(totalLinkClicks), subtext: formatCurrency(cpcLink, currency) + ' CPC' }
			];

		case 'OUTCOME_APP_PROMOTION':
		case 'APP_INSTALLS':
			return [
				{ key: 'results', label: resultKpi.label, value: resultKpi.value, icon: 'download', subtext: resultKpi.subtext },
				{ key: 'cpi', label: 'Cost per install', icon: 'dollar-sign', value: formatCurrency(totals.avgCostPerConversion, currency), subtext: `${formatNumber(totals.totalConversions)} installs` },
				{ key: 'linkClicks', label: 'Link clicks', icon: 'mouse-pointer-click', value: formatNumber(totalLinkClicks), subtext: formatCurrency(cpcLink, currency) + ' CPC' },
				{ key: 'ctr', label: 'CTR', icon: 'percent', value: formatPercent(totals.avgCtr), subtext: 'Click-through rate' },
				{ key: 'spend', label: 'Cheltuieli', icon: 'dollar-sign', value: formatCurrency(totals.totalSpend, currency), subtext: `${formatNumber(totals.totalImpressions)} impresii` }
			];

		default:
			// Mixed / unknown — default KPIs
			return [];
	}
}

export function formatCurrency(value: number, currency = 'RON'): string {
	return new Intl.NumberFormat('ro-RO', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
}

export function formatPercent(value: number): string {
	return new Intl.NumberFormat('ro-RO', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value / 100);
}

export function formatNumber(value: number): string {
	return new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 0 }).format(value);
}

export function formatDecimal(value: number, digits = 2): string {
	return new Intl.NumberFormat('ro-RO', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

export function formatROAS(value: number): string {
	if (value <= 0) return '-';
	return `${value.toFixed(2)}x`;
}

// ---- Demographic label maps ----

export const GENDER_LABELS: Record<string, string> = {
	male: 'Bărbați',
	female: 'Femei',
	unknown: 'Necunoscut'
};

export const DEVICE_LABELS: Record<string, string> = {
	mobile_app: 'Mobil App',
	mobile_web: 'Mobil Web',
	desktop: 'Desktop',
	unknown: 'Necunoscut'
};

export const COUNTRY_NAMES: Record<string, string> = {
	RO: 'România', DE: 'Germania', AT: 'Austria', HU: 'Ungaria',
	IT: 'Italia', ES: 'Spania', FR: 'Franța', GB: 'UK', US: 'SUA',
	BG: 'Bulgaria', MD: 'Moldova', PL: 'Polonia', NL: 'Olanda',
	CZ: 'Cehia', BE: 'Belgia', CH: 'Elveția', GR: 'Grecia',
	TR: 'Turcia', SE: 'Suedia', PT: 'Portugalia', HR: 'Croația',
	RS: 'Serbia', UA: 'Ucraina', SK: 'Slovacia', SI: 'Slovenia',
	DK: 'Danemarca', FI: 'Finlanda', NO: 'Norvegia', IE: 'Irlanda',
	CA: 'Canada', AU: 'Australia', BR: 'Brazilia', IN: 'India',
	JP: 'Japonia', KR: 'Coreea de Sud', MX: 'Mexic', AR: 'Argentina',
	CL: 'Chile', CO: 'Columbia', ZA: 'Africa de Sud', EG: 'Egipt',
	IL: 'Israel', AE: 'Emiratele Arabe', SA: 'Arabia Saudită'
};

export function getCountryName(code: string): string {
	return COUNTRY_NAMES[code] || code;
}

export function getDemographicLabel(type: 'gender' | 'age' | 'region' | 'devicePlatform', label: string): string {
	switch (type) {
		case 'gender': return GENDER_LABELS[label] || label;
		case 'region': return label; // Meta API returns region names directly (e.g. "Bacau")
		case 'devicePlatform': return DEVICE_LABELS[label] || label;
		case 'age': return label;
		default: return label;
	}
}

/** Get date presets for the date range picker (Facebook Ads Manager style) */
export function getDatePresets(): { label: string; since: string; until: string }[] {
	const today = new Date();
	const pad = (n: number) => String(n).padStart(2, '0');
	const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

	const todayStr = fmt(today);

	const yesterday = new Date(today);
	yesterday.setDate(yesterday.getDate() - 1);
	const yesterdayStr = fmt(yesterday);

	// FB Ads Manager uses yesterday as "until" for "Last X days" presets
	// because today's data is incomplete
	const daysAgo = (n: number) => {
		const d = new Date(yesterday);
		d.setDate(d.getDate() - (n - 1));
		return fmt(d);
	};

	// This week (Monday to today)
	const thisWeekStart = new Date(today);
	const dayOfWeek = today.getDay() === 0 ? 6 : today.getDay() - 1; // Monday = 0
	thisWeekStart.setDate(today.getDate() - dayOfWeek);

	// Last week (Monday to Sunday)
	const lastWeekEnd = new Date(thisWeekStart);
	lastWeekEnd.setDate(lastWeekEnd.getDate() - 1);
	const lastWeekStart = new Date(lastWeekEnd);
	lastWeekStart.setDate(lastWeekStart.getDate() - 6);

	const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);

	const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
	const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);

	// Maximum = last 2 years
	const maximum = new Date(today.getFullYear() - 2, today.getMonth(), today.getDate());

	return [
		{ label: 'Maximum', since: fmt(maximum), until: todayStr },
		{ label: 'Azi', since: todayStr, until: todayStr },
		{ label: 'Ieri', since: fmt(yesterday), until: fmt(yesterday) },
		{ label: 'Azi și ieri', since: fmt(yesterday), until: todayStr },
		{ label: 'Ultimele 7 zile', since: daysAgo(7), until: yesterdayStr },
		{ label: 'Ultimele 14 zile', since: daysAgo(14), until: yesterdayStr },
		{ label: 'Ultimele 28 zile', since: daysAgo(28), until: yesterdayStr },
		{ label: 'Ultimele 30 zile', since: daysAgo(30), until: yesterdayStr },
		{ label: 'Săptămâna aceasta', since: fmt(thisWeekStart), until: todayStr },
		{ label: 'Săptămâna trecută', since: fmt(lastWeekStart), until: fmt(lastWeekEnd) },
		{ label: 'Luna aceasta', since: fmt(thisMonthStart), until: todayStr },
		{ label: 'Luna trecută', since: fmt(lastMonthStart), until: fmt(lastMonthEnd) }
	];
}

export interface AdsetAggregate {
	adsetId: string;
	adsetName: string;
	campaignId: string;
	spend: number;
	impressions: number;
	reach: number;
	frequency: number;
	clicks: number;
	conversions: number;
	conversionValue: number;
	cpc: number;
	cpm: number;
	ctr: number;
	costPerConversion: number;
	roas: number;
	resultType: string;
	cpaLabel: string;
	purchases: number;
	leads: number;
	linkClicks: number;
	landingPageViews: number;
	pageEngagement: number;
	postReactions: number;
	postComments: number;
	postSaves: number;
	postShares: number;
	videoViews: number;
	callsPlaced: number;
	dailyBudget: string | null;
	lifetimeBudget: string | null;
	optimizationGoal: string;
}

/** Aggregate Meta ad set insights by ad set for expandable table rows */
export function aggregateInsightsByAdset(insights: MetaAdsAdsetInsight[]): AdsetAggregate[] {
	type Acc = {
		name: string; campaignId: string;
		spend: number; impressions: number; reach: number; clicks: number; conversions: number; conversionValue: number;
		resultType: string; cpaLabel: string;
		purchases: number; leads: number; linkClicks: number; landingPageViews: number; pageEngagement: number;
		postReactions: number; postComments: number; postSaves: number; postShares: number; videoViews: number; callsPlaced: number;
		dailyBudget: string | null; lifetimeBudget: string | null; optimizationGoal: string;
	};
	const byAdset = new Map<string, Acc>();

	for (const row of insights) {
		const existing = byAdset.get(row.adsetId) || {
			name: row.adsetName, campaignId: row.campaignId,
			spend: 0, impressions: 0, reach: 0, clicks: 0, conversions: 0, conversionValue: 0,
			resultType: row.resultType || '', cpaLabel: row.cpaLabel || 'CPA',
			purchases: 0, leads: 0, linkClicks: 0, landingPageViews: 0, pageEngagement: 0,
			postReactions: 0, postComments: 0, postSaves: 0, postShares: 0, videoViews: 0, callsPlaced: 0,
			dailyBudget: row.dailyBudget, lifetimeBudget: row.lifetimeBudget, optimizationGoal: row.optimizationGoal
		};
		existing.spend += parseFloat(row.spend);
		existing.impressions += parseInt(row.impressions);
		existing.reach += parseInt(row.reach || '0');
		existing.clicks += parseInt(row.clicks);
		existing.conversions += row.conversions;
		existing.conversionValue += row.conversionValue;
		existing.purchases += row.purchases;
		existing.leads += row.leads;
		existing.linkClicks += row.linkClicks;
		existing.landingPageViews += row.landingPageViews;
		existing.pageEngagement += row.pageEngagement;
		existing.postReactions += row.postReactions;
		existing.postComments += row.postComments;
		existing.postSaves += row.postSaves;
		existing.postShares += row.postShares;
		existing.videoViews += row.videoViews;
		existing.callsPlaced += row.callsPlaced;
		if (row.resultType && !existing.resultType) existing.resultType = row.resultType;
		if (row.cpaLabel && existing.cpaLabel === 'CPA') existing.cpaLabel = row.cpaLabel;
		byAdset.set(row.adsetId, existing);
	}

	return Array.from(byAdset.entries()).map(([adsetId, d]) => ({
		adsetId,
		adsetName: d.name,
		campaignId: d.campaignId,
		spend: d.spend,
		impressions: d.impressions,
		reach: d.reach,
		frequency: d.reach > 0 ? d.impressions / d.reach : 0,
		clicks: d.clicks,
		conversions: d.conversions,
		conversionValue: d.conversionValue,
		cpc: d.clicks > 0 ? d.spend / d.clicks : 0,
		cpm: d.impressions > 0 ? (d.spend / d.impressions) * 1000 : 0,
		ctr: d.impressions > 0 ? (d.clicks / d.impressions) * 100 : 0,
		costPerConversion: d.conversions > 0 ? d.spend / d.conversions : 0,
		roas: calculateROAS(d.conversionValue, d.spend),
		resultType: d.resultType,
		cpaLabel: d.cpaLabel,
		purchases: d.purchases,
		leads: d.leads,
		linkClicks: d.linkClicks,
		landingPageViews: d.landingPageViews,
		pageEngagement: d.pageEngagement,
		postReactions: d.postReactions,
		postComments: d.postComments,
		postSaves: d.postSaves,
		postShares: d.postShares,
		videoViews: d.videoViews,
		callsPlaced: d.callsPlaced,
		dailyBudget: d.dailyBudget,
		lifetimeBudget: d.lifetimeBudget,
		optimizationGoal: d.optimizationGoal
	}));
}

/** Get default date range (current month) */
export function getDefaultDateRange(): { since: string; until: string } {
	const presets = getDatePresets();
	const thisMonth = presets.find(p => p.label === 'Luna aceasta');
	return thisMonth ? { since: thisMonth.since, until: thisMonth.until } : { since: presets[10].since, until: presets[10].until };
}

export interface AdAggregate {
	adId: string;
	adName: string;
	adsetId: string;
	campaignId: string;
	spend: number;
	impressions: number;
	reach: number;
	frequency: number;
	clicks: number;
	conversions: number;
	conversionValue: number;
	cpc: number;
	cpm: number;
	ctr: number;
	costPerConversion: number;
	roas: number;
	resultType: string;
	cpaLabel: string;
	purchases: number;
	leads: number;
	linkClicks: number;
	landingPageViews: number;
	pageEngagement: number;
	postReactions: number;
	postComments: number;
	postSaves: number;
	postShares: number;
	videoViews: number;
	callsPlaced: number;
	previewUrl: string | null;
}

/** Aggregate Meta ad insights by ad for expandable table rows */
export function aggregateInsightsByAd(insights: MetaAdsAdInsight[]): AdAggregate[] {
	type Acc = {
		name: string; adsetId: string; campaignId: string;
		spend: number; impressions: number; reach: number; clicks: number; conversions: number; conversionValue: number;
		resultType: string; cpaLabel: string;
		purchases: number; leads: number; linkClicks: number; landingPageViews: number; pageEngagement: number;
		postReactions: number; postComments: number; postSaves: number; postShares: number; videoViews: number; callsPlaced: number;
		previewUrl: string | null;
	};
	const byAd = new Map<string, Acc>();

	for (const row of insights) {
		const existing = byAd.get(row.adId) || {
			name: row.adName, adsetId: row.adsetId, campaignId: row.campaignId,
			spend: 0, impressions: 0, reach: 0, clicks: 0, conversions: 0, conversionValue: 0,
			resultType: row.resultType || '', cpaLabel: row.cpaLabel || 'CPA',
			purchases: 0, leads: 0, linkClicks: 0, landingPageViews: 0, pageEngagement: 0,
			postReactions: 0, postComments: 0, postSaves: 0, postShares: 0, videoViews: 0, callsPlaced: 0,
			previewUrl: row.previewUrl || null
		};
		existing.spend += parseFloat(row.spend);
		existing.impressions += parseInt(row.impressions);
		existing.reach += parseInt(row.reach || '0');
		existing.clicks += parseInt(row.clicks);
		existing.conversions += row.conversions;
		existing.conversionValue += row.conversionValue;
		existing.purchases += row.purchases;
		existing.leads += row.leads;
		existing.linkClicks += row.linkClicks;
		existing.landingPageViews += row.landingPageViews;
		existing.pageEngagement += row.pageEngagement;
		existing.postReactions += row.postReactions;
		existing.postComments += row.postComments;
		existing.postSaves += row.postSaves;
		existing.postShares += row.postShares;
		existing.videoViews += row.videoViews;
		existing.callsPlaced += row.callsPlaced;
		if (row.resultType && !existing.resultType) existing.resultType = row.resultType;
		if (row.cpaLabel && existing.cpaLabel === 'CPA') existing.cpaLabel = row.cpaLabel;
		byAd.set(row.adId, existing);
	}

	return Array.from(byAd.entries()).map(([adId, d]) => ({
		adId,
		adName: d.name,
		adsetId: d.adsetId,
		campaignId: d.campaignId,
		spend: d.spend,
		impressions: d.impressions,
		reach: d.reach,
		frequency: d.reach > 0 ? d.impressions / d.reach : 0,
		clicks: d.clicks,
		conversions: d.conversions,
		conversionValue: d.conversionValue,
		cpc: d.clicks > 0 ? d.spend / d.clicks : 0,
		cpm: d.impressions > 0 ? (d.spend / d.impressions) * 1000 : 0,
		ctr: d.impressions > 0 ? (d.clicks / d.impressions) * 100 : 0,
		costPerConversion: d.conversions > 0 ? d.spend / d.conversions : 0,
		roas: calculateROAS(d.conversionValue, d.spend),
		resultType: d.resultType,
		cpaLabel: d.cpaLabel,
		purchases: d.purchases,
		leads: d.leads,
		linkClicks: d.linkClicks,
		landingPageViews: d.landingPageViews,
		pageEngagement: d.pageEngagement,
		postReactions: d.postReactions,
		postComments: d.postComments,
		postSaves: d.postSaves,
		postShares: d.postShares,
		videoViews: d.videoViews,
		callsPlaced: d.callsPlaced,
		previewUrl: d.previewUrl
	}));
}
