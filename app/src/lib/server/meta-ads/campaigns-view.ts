/**
 * Agregarea server-side pentru pagina Campanii Ads: combină insights zilnice,
 * lista de campanii și reach-ul pe fereastră în CampaignRow[] (VM partajat).
 *
 * Replica logicii din reports.remote.ts (enrichment după optimization_goal +
 * reach care NU se sumează pe zile), dar cu agregarea făcută aici, nu în pagină.
 */
import type { MetaAdsCampaignInsight, MetaAdsCampaignInfo } from './client';
import { OPTIMIZATION_GOAL_MAP, INSIGHT_ACTION_TO_FIELD } from './client';
import type { CampaignRow } from '$lib/utils/meta-campaigns';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Zilele calendaristice între since și until, inclusiv capetele (UTC). */
export function enumerateDays(since: string, until: string): string[] {
	const start = Date.parse(since + 'T00:00:00Z');
	const end = Date.parse(until + 'T00:00:00Z');
	if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
	const days: string[] = [];
	for (let t = start; t <= end; t += DAY_MS) {
		days.push(new Date(t).toISOString().slice(0, 10));
	}
	return days;
}

/** Statusurile care apar în listă chiar și fără insights în fereastră. */
const ALWAYS_VISIBLE_STATUSES = new Set(['ACTIVE', 'WITH_ISSUES', 'IN_PROCESS']);

const centsToMajor = (v: string | null): number | null => {
	if (v == null || v === '') return null;
	const n = parseFloat(v);
	return Number.isFinite(n) ? n / 100 : null;
};

interface Accum {
	spend: number;
	impressions: number;
	clicks: number;
	conversions: number;
	conversionValue: number;
	maxDailyReach: number;
	name: string;
	objective: string;
	resultType: string;
	cpaLabel: string;
	byDay: Map<string, number>;
}

export function buildCampaignRows(
	insights: MetaAdsCampaignInsight[],
	campaigns: MetaAdsCampaignInfo[],
	reachMap: Map<string, { reach: number; frequency: number }>,
	since: string,
	until: string
): { rows: CampaignRow[]; dailySpend: Array<{ date: string; spend: number }> } {
	const days = enumerateDays(since, until);
	const goalByCampaign = new Map<string, string>();
	for (const c of campaigns) {
		if (c.optimizationGoal) goalByCampaign.set(c.campaignId, c.optimizationGoal);
	}

	// 1) Enrichment per rând: conversiile după optimization_goal (ce arată Ads Manager).
	const enriched = insights.map((raw) => {
		const row = { ...raw };
		const goal = goalByCampaign.get(row.campaignId);
		const goalDef = goal ? OPTIMIZATION_GOAL_MAP[goal] : undefined;
		if (goalDef) {
			if (goalDef.actionType) {
				const field = INSIGHT_ACTION_TO_FIELD[goalDef.actionType];
				const count = field ? (row[field] as number) : row.conversions;
				row.conversions = count;
			}
			row.resultType = goalDef.label;
			row.cpaLabel = goalDef.cpaLabel;
		}
		return row;
	});

	// 2) Agregare per campanie + serii zilnice.
	const acc = new Map<string, Accum>();
	const accountByDay = new Map<string, number>(days.map((d) => [d, 0]));
	for (const row of enriched) {
		const spend = parseFloat(row.spend) || 0;
		let a = acc.get(row.campaignId);
		if (!a) {
			a = {
				spend: 0,
				impressions: 0,
				clicks: 0,
				conversions: 0,
				conversionValue: 0,
				maxDailyReach: 0,
				name: row.campaignName,
				objective: row.objective,
				resultType: row.resultType,
				cpaLabel: row.cpaLabel,
				byDay: new Map()
			};
			acc.set(row.campaignId, a);
		}
		a.spend += spend;
		a.impressions += parseFloat(row.impressions) || 0;
		a.clicks += parseFloat(row.clicks) || 0;
		a.conversions += row.conversions || 0;
		a.conversionValue += row.conversionValue || 0;
		a.maxDailyReach = Math.max(a.maxDailyReach, parseFloat(row.reach) || 0);
		a.byDay.set(row.dateStart, (a.byDay.get(row.dateStart) ?? 0) + spend);
		if (accountByDay.has(row.dateStart)) {
			accountByDay.set(row.dateStart, (accountByDay.get(row.dateStart) ?? 0) + spend);
		}
	}

	const campaignById = new Map(campaigns.map((c) => [c.campaignId, c]));

	const toRow = (id: string): CampaignRow => {
		const a = acc.get(id);
		const info = campaignById.get(id);
		const spend = a?.spend ?? 0;
		const impressions = a?.impressions ?? 0;
		const clicks = a?.clicks ?? 0;
		const conversions = a?.conversions ?? 0;
		const conversionValue = a?.conversionValue ?? 0;
		// Reach-ul zilnic nu se sumează — folosim valoarea pe fereastră din
		// listCampaignReachFrequency, cu fallback pe maximul zilnic (aproximare).
		const reach = reachMap.get(id)?.reach ?? a?.maxDailyReach ?? 0;
		const goalDef = info?.optimizationGoal ? OPTIMIZATION_GOAL_MAP[info.optimizationGoal] : undefined;
		return {
			id,
			name: a?.name ?? info?.campaignName ?? id,
			// Statusul EFECTIV de livrare (WITH_ISSUES/IN_PROCESS/... ), nu cel configurat.
			status: info?.effectiveStatus || info?.status || 'UNKNOWN',
			objective: a?.objective ?? info?.objective ?? '',
			dailyBudget: centsToMajor(info?.dailyBudget ?? null),
			lifetimeBudget: centsToMajor(info?.lifetimeBudget ?? null),
			budgetSource: info?.budgetSource ?? null,
			previewUrl: info?.previewUrl ?? null,
			spend,
			impressions,
			reach,
			clicks,
			ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
			conversions,
			conversionValue,
			cpa: conversions > 0 ? spend / conversions : 0,
			roas: spend > 0 ? conversionValue / spend : 0,
			cpaLabel: a?.cpaLabel ?? goalDef?.cpaLabel ?? '',
			resultType: a?.resultType ?? goalDef?.label ?? '',
			spark: days.map((d) => a?.byDay.get(d) ?? 0)
		};
	};

	const ids = new Set<string>();
	for (const id of acc.keys()) ids.add(id);
	for (const c of campaigns) {
		if (ALWAYS_VISIBLE_STATUSES.has(c.effectiveStatus || c.status)) ids.add(c.campaignId);
	}

	const rows = Array.from(ids, toRow);
	rows.sort((a, b) => b.spend - a.spend || a.name.localeCompare(b.name));

	return {
		rows,
		dailySpend: days.map((d) => ({ date: d, spend: accountByDay.get(d) ?? 0 }))
	};
}
