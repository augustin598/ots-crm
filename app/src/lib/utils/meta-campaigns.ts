/**
 * Logica pură a paginii Campanii Ads (Meta): view-model, KPI-uri, reguli de
 * insights, formatare și CSV. Fără importuri din $lib/server — modulul e
 * partajat client/server și testat cu bun test.
 */

export interface CampaignRow {
	id: string;
	name: string;
	/** Meta effective status: ACTIVE | PAUSED | CAMPAIGN_PAUSED | WITH_ISSUES | IN_PROCESS | UNKNOWN */
	status: string;
	objective: string;
	/** Unități majore (nu cenți); null = ABO fără buget la nivel de campanie */
	dailyBudget: number | null;
	lifetimeBudget: number | null;
	budgetSource: 'campaign' | 'adset' | null;
	adsetId: string | null;
	previewUrl: string | null;
	startTime: string | null;
	stopTime: string | null;
	spend: number;
	impressions: number;
	reach: number;
	clicks: number;
	/** procent, ex. 2.93 */
	ctr: number;
	conversions: number;
	conversionValue: number;
	cpa: number;
	roas: number;
	cpaLabel: string;
	resultType: string;
	/** spend zilnic pe fereastra selectată, aliniat pe zile */
	spark: number[];
}

export interface CampaignKpis {
	issues: number;
	inProcess: number;
	active: number;
	paused: number;
	spend: number;
	conversions: number;
	cpa: number;
	dailyBudgetActive: number;
	dailyBudgetPaused: number;
	/** plafon = Σ dailyBudget (ACTIVE + WITH_ISSUES) × periodDays */
	budgetCap: number;
	pace: number;
}

export type StatusTone = 'success' | 'muted' | 'warn' | 'danger' | 'outline';

export const CAMPAIGN_STATUS_META: Record<string, { label: string; tone: StatusTone; pulse?: boolean }> = {
	ACTIVE: { label: 'Activă', tone: 'success', pulse: true },
	PAUSED: { label: 'Pauzată', tone: 'muted' },
	CAMPAIGN_PAUSED: { label: 'Pauzată', tone: 'muted' },
	WITH_ISSUES: { label: 'Cu probleme', tone: 'danger' },
	IN_PROCESS: { label: 'În procesare', tone: 'warn' },
	UNKNOWN: { label: 'Necunoscută', tone: 'outline' }
};

export const statusMeta = (s: string) => CAMPAIGN_STATUS_META[s] ?? CAMPAIGN_STATUS_META.UNKNOWN;

const isPaused = (s: string) => s === 'PAUSED' || s === 'CAMPAIGN_PAUSED';

export const OBJECTIVE_LABELS_RO: Record<string, string> = {
	OUTCOME_SALES: 'Vânzări',
	OUTCOME_LEADS: 'Lead-uri',
	OUTCOME_TRAFFIC: 'Trafic',
	OUTCOME_AWARENESS: 'Awareness',
	OUTCOME_ENGAGEMENT: 'Engagement',
	OUTCOME_APP_PROMOTION: 'App promo',
	CONVERSIONS: 'Conversii',
	LEAD_GENERATION: 'Lead-uri',
	MESSAGES: 'Mesaje'
};

export function objectiveLabel(objective: string): string {
	if (OBJECTIVE_LABELS_RO[objective]) return OBJECTIVE_LABELS_RO[objective];
	const pretty = objective.replace(/^OUTCOME_/, '').replace(/_/g, ' ').toLowerCase();
	return pretty.charAt(0).toUpperCase() + pretty.slice(1);
}

export function pacingOf(c: Pick<CampaignRow, 'dailyBudget' | 'spend'>, periodDays: number): number {
	if (!c.dailyBudget || c.dailyBudget <= 0 || periodDays <= 0) return 0;
	return c.spend / (c.dailyBudget * periodDays);
}

export interface InsightRule {
	id: 'issues' | 'budget' | 'ctr' | 'winner';
	label: string;
	hint: string;
	tone: 'warn' | 'danger' | 'success';
	icon: 'alert' | 'dollar' | 'trending' | 'zap';
	test: (c: CampaignRow, periodDays: number) => boolean;
}

export const campaignInsightRules: InsightRule[] = [
	{
		id: 'issues',
		label: 'Cu probleme',
		hint: 'Verifică în Ads Manager',
		tone: 'danger',
		icon: 'alert',
		test: (c) => c.status === 'WITH_ISSUES'
	},
	{
		id: 'budget',
		label: 'Buget aproape epuizat',
		hint: 'Peste 80% din plafon',
		tone: 'danger',
		icon: 'dollar',
		test: (c, d) => c.status === 'ACTIVE' && pacingOf(c, d) >= 0.8
	},
	{
		id: 'ctr',
		label: 'CTR sub 1%',
		hint: 'Creative de rotit',
		tone: 'warn',
		icon: 'trending',
		test: (c) => c.impressions > 10000 && c.ctr < 1
	},
	{
		id: 'winner',
		label: 'Gata de scale',
		hint: 'ROAS ≥ 3x',
		tone: 'success',
		icon: 'zap',
		test: (c) => c.roas >= 3
	}
];

export const insightRuleById: Record<string, InsightRule> = Object.fromEntries(
	campaignInsightRules.map((r) => [r.id, r])
);

export const insightHitsFor = (c: CampaignRow, periodDays: number): InsightRule[] =>
	campaignInsightRules.filter((r) => r.test(c, periodDays));

export function computeKpis(rows: CampaignRow[], periodDays: number): CampaignKpis {
	const active = rows.filter((c) => c.status === 'ACTIVE');
	const issues = rows.filter((c) => c.status === 'WITH_ISSUES');
	const paused = rows.filter((c) => isPaused(c.status));
	const spend = rows.reduce((s, c) => s + c.spend, 0);
	const conversions = rows.reduce((s, c) => s + c.conversions, 0);
	const budgetOf = (list: CampaignRow[]) => list.reduce((s, c) => s + (c.dailyBudget ?? 0), 0);
	const budgetCap = (budgetOf(active) + budgetOf(issues)) * Math.max(periodDays, 0);
	return {
		issues: issues.length,
		inProcess: rows.filter((c) => c.status === 'IN_PROCESS').length,
		active: active.length,
		paused: paused.length,
		spend,
		conversions,
		cpa: conversions > 0 ? spend / conversions : 0,
		dailyBudgetActive: budgetOf(active),
		dailyBudgetPaused: budgetOf(paused),
		budgetCap,
		pace: budgetCap > 0 ? spend / budgetCap : 0
	};
}

export function fmtNum(n: number): string {
	if (n === 0) return '—';
	if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
	if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
	return n.toLocaleString('ro-RO');
}

export function fmtMoney(n: number, currency: string): string {
	if (n === 0) return '—';
	try {
		return new Intl.NumberFormat('ro-RO', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n);
	} catch {
		return `${n.toLocaleString('ro-RO', { minimumFractionDigits: 2 })} ${currency}`;
	}
}

export function fmtMoneyRound(n: number, currency: string): string {
	if (n === 0) return '—';
	try {
		return new Intl.NumberFormat('ro-RO', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
	} catch {
		return `${Math.round(n).toLocaleString('ro-RO')} ${currency}`;
	}
}

export function fmtPct(n: number): string {
	return n === 0
		? '—'
		: n.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
}

export interface CampaignFilters {
	q: string;
	status: string;
	objective: string;
	insight: string;
}

export function filterCampaignRows(rows: CampaignRow[], f: CampaignFilters, periodDays = 30): CampaignRow[] {
	let arr = rows;
	if (f.q) {
		const q = f.q.toLowerCase();
		arr = arr.filter((c) => c.name.toLowerCase().includes(q) || c.id.includes(q));
	}
	if (f.status) {
		arr = f.status === 'PAUSED' ? arr.filter((c) => isPaused(c.status)) : arr.filter((c) => c.status === f.status);
	}
	if (f.objective) arr = arr.filter((c) => c.objective === f.objective);
	if (f.insight) {
		const rule = insightRuleById[f.insight];
		if (rule) arr = arr.filter((c) => rule.test(c, periodDays));
	}
	return arr;
}

export interface SortState {
	key: string;
	dir: 'asc' | 'desc';
}

export function sortCampaignRows(rows: CampaignRow[], sort: SortState): CampaignRow[] {
	const arr = [...rows];
	arr.sort((a, b) => {
		const av = (a as unknown as Record<string, unknown>)[sort.key];
		const bv = (b as unknown as Record<string, unknown>)[sort.key];
		if (typeof av === 'string' && typeof bv === 'string')
			return sort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
		const an = typeof av === 'number' ? av : 0;
		const bn = typeof bv === 'number' ? bv : 0;
		return sort.dir === 'asc' ? an - bn : bn - an;
	});
	return arr;
}

export function buildCampaignsCsv(rows: CampaignRow[], currency: string): string {
	const head = [
		'ID',
		'Campanie',
		'Status',
		'Obiectiv',
		`Buget/zi (${currency})`,
		`Cheltuit (${currency})`,
		'Impresii',
		'Clicuri',
		'CTR %',
		'Conversii',
		`CPA (${currency})`,
		'ROAS'
	];
	const body = rows.map((c) => [
		c.id,
		c.name,
		statusMeta(c.status).label,
		objectiveLabel(c.objective),
		c.dailyBudget ?? '',
		c.spend,
		c.impressions,
		c.clicks,
		c.ctr,
		c.conversions,
		c.cpa,
		c.roas
	]);
	const esc = (v: unknown) => {
		const s = String(v ?? '');
		return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
	};
	return '﻿' + [head, ...body].map((r) => r.map(esc).join(';')).join('\r\n');
}
