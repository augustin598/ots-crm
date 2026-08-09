# Campanii Ads — Facebook Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rescriere completă `/[tenant]/campaigns-ads/facebook` după designul „Campanii Ads" din Claude Design, alimentată de API-ul Meta propriu al CRM-ului, plus ștergerea integrală a fluxului PersonalOPS campaigns (API extern + servicii).

**Architecture:** Pagina nouă nu are `+page.server.ts` — folosește remote functions (pattern-ul din `reports.remote.ts`): un query `listMetaCampaignRows` care combină server-side `listCampaignInsights(daily)` + `listActiveCampaigns` + `listCampaignReachFrequency`, un query lazy `getMetaCampaignAdsets` pentru rândul expandat și comenzi staff-only pentru pauză/pornire + refresh. Toată logica pură (agregare, reguli de insights, formatare, CSV) stă în module testabile cu bun test. UI-ul e compus din componente Svelte 5 cu stiluri scoped portate din `styles.css` al designului.

**Tech Stack:** SvelteKit 5 (remote functions, runes), Bun test, valibot, svelte-sonner, Meta Graph API v25 prin `$lib/server/meta-ads/client.ts`.

---

## Context și decizii (aprobate de user)

- **Se șterge tot fluxul PersonalOPS campaigns**: rutele `/api/external/campaigns/*` (4 rute), `lib/server/campaigns/` (4 fișiere), `meta-ads/campaign-create.ts` + testul lui. Tabelele `campaign`/`campaign_audit`/`campaign_idempotency` RĂMÂN în schema DB (fără migrare). Endpoint-urile `ads-monitor`, `ads-optimization-tasks`, `heartbeat`, `clients`, `meta/targeting-options`, `telegram`, `integrations/health` RĂMÂN.
- **Fără wizard de creare** — butonul „Campanie nouă" nu există în v1; acțiunile edit/duplicate/delete din design NU se implementează (nu au backend). Rămân real: listă + insights, pauză/pornire (individual + bulk), expandare cu ad seturi, preview link, export CSV.
- **Pagina `/[tenant]/reports/facebook-ads` rămâne neatinsă** (confirmat de user). Refolosim `getReportAdAccounts` din ea doar prin import.
- **Sweep opțional de cod mort — DA** (userul a cerut „totul clean"): `withIdempotency`, tipurile `Campaign*Event`, constantele `CAMPAIGN_STATUSES`/`CAMPAIGN_BUILD_STEPS`.

## Referințe

- **Design files (sursa vizuală, salvate local):** `/private/tmp/claude-501/-Users-augustin598-Projects-CRM/8ceff6fd-b1e5-49a8-b25f-dba2ec51b924/scratchpad/design-import/` — `styles.css` (design tokens + toate clasele), `campaign-list.jsx` (KPI/tabel/filtre/paginare), `campaign-insights.jsx` (insights strip/pacing/column manager/confirm/CSV), `app.jsx` (asamblare + interacțiuni), `shell.jsx` (page header + platform tabs). Dacă sesiunea se pierde: proiect Claude Design `019df885-9fe6-79ad-9cb2-b358d7bdaf8c`, fișier „Campanii Ads.html" (re-import cu DesignSync).
- **Pattern date:** `app/src/lib/remotes/reports.remote.ts` — `getMetaCampaignInsights` (linii 317–443), `resolveAccountIntegration` (97), `throwMetaApiError` (127), cache in-process (15–45), enrichment `OPTIMIZATION_GOAL_MAP` (379–415), fix reach (419–435).

## Capcane (din analiza reports.remote.ts) — obligatorii în implementare

1. **Reach NU se sumează pe zile** — folosește `listCampaignReachFrequency` pentru valoarea per campanie pe fereastră.
2. **Conversiile din `listCampaignInsights` sunt provizorii** — trebuie suprascrise per `optimizationGoal` al ad setului (`OPTIMIZATION_GOAL_MAP` + `getActionCount` din client.ts), altfel numerele diferă de Ads Manager și de pagina de rapoarte.
3. **Cheia de cache include `resolvedIntegrationId`** (fix pentru dubluri post-reconnect; cheile vechi din reports nu-l au).
4. **Nu folosi `integrationId` venit de la client pentru auth** — mereu `resolveAccountIntegration(adAccountId, tenantId)` server-side.
5. **Banii/contoarele de la Graph sunt string-uri**; bugetele sunt **cenți string** (`parseFloat(x)/100`).
6. **Valuta** nu vine din insights la nivel de campanie — vine din `getReportAdAccounts` (din `metaAdsSpending`, fallback 'RON'). Nu hardcoda RON/EUR la randare — folosește `Intl.NumberFormat('ro-RO', {style:'currency', currency})`.
7. **Refresh-ul nu invalidează cache-ul serverului** — comanda `refreshMetaCampaigns` invalidează explicit, apoi pagina re-instanțiază query-ul (pattern `handleRefresh` din reports/+page.svelte:500).
8. Guard-uri: pagina e staff-only → toate query-urile/comenzile noi fac `requireStaff()` din `$lib/server/get-actor` (F8).
9. Mesaje de eroare user-facing în **română**.
10. `env.META_APP_SECRET` verificat în fiecare remote (500 `'META_APP_SECret nu este configurat'` — vezi textul exact în reports.remote.ts).

## File Structure

**Create:**
- `app/src/lib/utils/meta-campaigns.ts` — VM types + status map + obiective RO + reguli insights + formatare + CSV + filtrare/sortare client-side (pur, fără importuri $lib/server)
- `app/src/lib/utils/__tests__/meta-campaigns.test.ts`
- `app/src/lib/server/meta-ads/campaigns-view.ts` — merge insights+campaigns+reach → `CampaignRow[]` + serii zilnice (pur)
- `app/src/lib/server/meta-ads/__tests__/campaigns-view.test.ts`
- `app/src/lib/remotes/meta-campaigns.remote.ts` — `listMetaCampaignRows`, `getMetaCampaignAdsets`, `toggleMetaCampaign`, `refreshMetaCampaigns`
- `app/src/lib/components/campaigns-ads/` — `sparkline.svelte`, `mini-bars.svelte`, `status-badge.svelte`, `pacing-bar.svelte`, `kpi-cards.svelte`, `insights-strip.svelte`, `dropdown-chip.svelte`, `column-manager.svelte`, `active-filters.svelte`, `bulk-bar.svelte`, `pagination.svelte`, `confirm-dialog.svelte`, `campaign-detail-row.svelte`, `campaigns-table.svelte`, `filter-toolbar.svelte`
- `app/src/lib/components/campaigns-ads/campaigns-ads.css` — tokenii designului (variabile CSS `--ca-*`) + clase comune badge/btn/chip importate de componente

**Modify:**
- `app/src/routes/[tenant]/campaigns-ads/+layout.svelte` — page header + platform tabs după design (`shell.jsx` PageHeader/PlatformTabs, `styles.css` secțiunea `.platform-tabs`)
- `app/src/routes/[tenant]/campaigns-ads/facebook/+page.svelte` — rescriere completă (asamblare)
- `app/src/routes/[tenant]/campaigns-ads/google/+page.svelte`, `tiktok/+page.svelte` — placeholder curat „În curând", fără referințe PersonalOPS
- `app/src/lib/server/api-keys/middleware.ts` — șterge `IdempotentResult` + `withIdempotency` (liniile ~102–250; păstrează `withApiKey`)
- `app/src/lib/server/plugins/types.ts` — șterge `CampaignCreatedEvent/CampaignApprovedEvent/CampaignPausedEvent/CampaignBuildFailedEvent` (148–180) + membrii din uniunea `PluginEvent` (201–204)
- `app/src/lib/server/db/schema.ts` — șterge `CAMPAIGN_STATUSES` (5420) + `CAMPAIGN_BUILD_STEPS` (5431) + tipurile derivate; tabelele rămân
- `docs/ads-optimizer-system.md:27` — scoate linia `/api/external/campaigns/...` din diagramă
- `app/docs/multi-platform-ads-automation-plan.md` — marchează secțiunile PersonalOPS campaigns ca eliminate (liniile 129, 151, 157, 181, 187, 292, 304, 309–310)

**Delete:**
- `app/src/routes/[tenant]/campaigns-ads/facebook/+page.server.ts`
- `app/src/routes/api/external/campaigns/` (tot directorul — 4 rute, inclusiv `draft/validate`)
- `app/src/lib/server/campaigns/` (tot directorul)
- `app/src/lib/server/meta-ads/campaign-create.ts`
- `app/src/lib/server/meta-ads/__tests__/option-b/`

---

### Task 1: Modul pur `$lib/utils/meta-campaigns.ts` (TDD)

**Files:**
- Create: `app/src/lib/utils/meta-campaigns.ts`
- Test: `app/src/lib/utils/__tests__/meta-campaigns.test.ts`

- [ ] **Step 1.1: Scrie testele (eșuează)** — `app/src/lib/utils/__tests__/meta-campaigns.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import {
	CAMPAIGN_STATUS_META,
	OBJECTIVE_LABELS_RO,
	objectiveLabel,
	computeKpis,
	campaignInsightRules,
	insightHitsFor,
	fmtNum,
	fmtMoney,
	fmtPct,
	pacingOf,
	filterCampaignRows,
	sortCampaignRows,
	buildCampaignsCsv,
	type CampaignRow
} from '$lib/utils/meta-campaigns';

const row = (over: Partial<CampaignRow> = {}): CampaignRow => ({
	id: '123',
	name: 'Test',
	status: 'ACTIVE',
	objective: 'OUTCOME_SALES',
	dailyBudget: 100,
	lifetimeBudget: null,
	budgetSource: 'campaign',
	adsetId: null,
	previewUrl: null,
	startTime: null,
	stopTime: null,
	spend: 500,
	impressions: 50000,
	reach: 20000,
	clicks: 1500,
	ctr: 3,
	conversions: 50,
	conversionValue: 2500,
	cpa: 10,
	roas: 5,
	cpaLabel: 'Cost/Achiziție',
	resultType: 'Achiziții',
	spark: [10, 20, 30],
	...over
});

describe('objectiveLabel', () => {
	it('traduce obiectivele OUTCOME_*', () => {
		expect(objectiveLabel('OUTCOME_SALES')).toBe('Vânzări');
		expect(objectiveLabel('OUTCOME_LEADS')).toBe('Lead-uri');
	});
	it('prettify pentru obiective necunoscute', () => {
		expect(objectiveLabel('LINK_CLICKS')).toBe('Link clicks');
	});
});

describe('computeKpis', () => {
	it('agregă corect pe 10 zile', () => {
		const k = computeKpis(
			[
				row({ status: 'ACTIVE', dailyBudget: 100, spend: 500, conversions: 50 }),
				row({ id: '2', status: 'PAUSED', dailyBudget: 40, spend: 100, conversions: 0 }),
				row({ id: '3', status: 'WITH_ISSUES', dailyBudget: 60, spend: 200, conversions: 10 })
			],
			10
		);
		expect(k.active).toBe(1);
		expect(k.paused).toBe(1);
		expect(k.issues).toBe(1);
		expect(k.spend).toBe(800);
		expect(k.conversions).toBe(60);
		expect(k.cpa).toBeCloseTo(800 / 60);
		expect(k.dailyBudgetActive).toBe(100);
		expect(k.dailyBudgetPaused).toBe(40);
		// cap = (100 activ + 60 with_issues) * 10 zile
		expect(k.budgetCap).toBe(1600);
		expect(k.pace).toBeCloseTo(800 / 1600);
	});
	it('pace 0 când nu există buget', () => {
		expect(computeKpis([row({ dailyBudget: null, status: 'PAUSED' })], 10).pace).toBe(0);
	});
});

describe('campaignInsightRules', () => {
	it('issues pe WITH_ISSUES', () => {
		expect(insightHitsFor(row({ status: 'WITH_ISSUES' }), 10).map((r) => r.id)).toContain('issues');
	});
	it('budget la pacing >= 80%', () => {
		const c = row({ status: 'ACTIVE', dailyBudget: 10, spend: 85 });
		expect(pacingOf(c, 10)).toBeCloseTo(0.85);
		expect(insightHitsFor(c, 10).map((r) => r.id)).toContain('budget');
	});
	it('ctr sub 1% doar cu peste 10k impresii', () => {
		expect(insightHitsFor(row({ ctr: 0.5, impressions: 20000 }), 10).map((r) => r.id)).toContain('ctr');
		expect(insightHitsFor(row({ ctr: 0.5, impressions: 500 }), 10).map((r) => r.id)).not.toContain('ctr');
	});
	it('winner la ROAS >= 3', () => {
		expect(insightHitsFor(row({ roas: 3.2 }), 10).map((r) => r.id)).toContain('winner');
	});
});

describe('formatare', () => {
	it('fmtNum k/M și em dash pe 0', () => {
		expect(fmtNum(0)).toBe('—');
		expect(fmtNum(1500)).toBe('1.5k');
		expect(fmtNum(2_300_000)).toBe('2.3M');
	});
	it('fmtMoney cu valuta contului', () => {
		expect(fmtMoney(0, 'EUR')).toBe('—');
		expect(fmtMoney(1234.5, 'EUR')).toContain('€');
		expect(fmtMoney(1234.5, 'RON')).toMatch(/RON|lei/i);
	});
	it('fmtPct', () => {
		expect(fmtPct(0)).toBe('—');
		expect(fmtPct(2.345)).toBe('2,34%');
	});
});

describe('filterCampaignRows + sortCampaignRows', () => {
	const rows = [
		row({ id: '1', name: 'Alpha', status: 'ACTIVE', spend: 10 }),
		row({ id: '2', name: 'Beta', status: 'PAUSED', spend: 30, objective: 'OUTCOME_LEADS' }),
		row({ id: '3', name: 'Gamma', status: 'ACTIVE', spend: 20, ctr: 0.2, impressions: 20000 })
	];
	it('filtrează după q pe nume și id', () => {
		expect(filterCampaignRows(rows, { q: 'bet', status: '', objective: '', insight: '' })).toHaveLength(1);
		expect(filterCampaignRows(rows, { q: '3', status: '', objective: '', insight: '' })[0].id).toBe('3');
	});
	it('filtrează după status și obiectiv', () => {
		expect(filterCampaignRows(rows, { q: '', status: 'ACTIVE', objective: '', insight: '' })).toHaveLength(2);
		expect(filterCampaignRows(rows, { q: '', status: '', objective: 'OUTCOME_LEADS', insight: '' })[0].id).toBe('2');
	});
	it('filtrează după insight', () => {
		expect(filterCampaignRows(rows, { q: '', status: '', objective: '', insight: 'ctr' }, 10)[0].id).toBe('3');
	});
	it('sortează numeric desc/asc și string', () => {
		expect(sortCampaignRows(rows, { key: 'spend', dir: 'desc' })[0].id).toBe('2');
		expect(sortCampaignRows(rows, { key: 'name', dir: 'asc' })[0].name).toBe('Alpha');
	});
});

describe('buildCampaignsCsv', () => {
	it('CSV cu separator ; și BOM, escape pe ghilimele', () => {
		const csv = buildCampaignsCsv([row({ name: 'Cu "ghilimele"; test' })], 'EUR');
		expect(csv.startsWith('﻿')).toBe(true);
		expect(csv).toContain('"Cu ""ghilimele""; test"');
		expect(csv.split('\r\n')[0]).toContain('Campanie;Status');
	});
});
```

- [ ] **Step 1.2: Rulează testele — trebuie să eșueze** — `cd app && bun test src/lib/utils/__tests__/meta-campaigns.test.ts` → FAIL (modulul nu există).

- [ ] **Step 1.3: Implementează `app/src/lib/utils/meta-campaigns.ts`** (pur, fără importuri `$lib/server`):

```ts
// Tipurile VM partajate client/server pentru pagina Campanii Ads (Meta).
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
	test: (c: CampaignRow, periodDays: number) => boolean;
}
export const campaignInsightRules: InsightRule[] = [
	{ id: 'issues', label: 'Cu probleme', hint: 'Verifică în Ads Manager', tone: 'danger', test: (c) => c.status === 'WITH_ISSUES' },
	{ id: 'budget', label: 'Buget aproape epuizat', hint: 'Peste 80% din plafon', tone: 'danger', test: (c, d) => c.status === 'ACTIVE' && pacingOf(c, d) >= 0.8 },
	{ id: 'ctr', label: 'CTR sub 1%', hint: 'Creative de rotit', tone: 'warn', test: (c) => c.impressions > 10000 && c.ctr < 1 },
	{ id: 'winner', label: 'Gata de scale', hint: 'ROAS ≥ 3x', tone: 'success', test: (c) => c.roas >= 3 }
];
export const insightRuleById = Object.fromEntries(campaignInsightRules.map((r) => [r.id, r]));
export const insightHitsFor = (c: CampaignRow, periodDays: number) =>
	campaignInsightRules.filter((r) => r.test(c, periodDays));

export function computeKpis(rows: CampaignRow[], periodDays: number): CampaignKpis {
	const by = (s: string) => rows.filter((c) => c.status === s);
	const active = by('ACTIVE');
	const issues = by('WITH_ISSUES');
	const paused = rows.filter((c) => c.status === 'PAUSED' || c.status === 'CAMPAIGN_PAUSED');
	const spend = rows.reduce((s, c) => s + c.spend, 0);
	const conversions = rows.reduce((s, c) => s + c.conversions, 0);
	const budgetOf = (list: CampaignRow[]) => list.reduce((s, c) => s + (c.dailyBudget ?? 0), 0);
	const budgetCap = (budgetOf(active) + budgetOf(issues)) * Math.max(periodDays, 0);
	return {
		issues: issues.length,
		inProcess: by('IN_PROCESS').length,
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
	return n === 0 ? '—' : n.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
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
		arr = f.status === 'PAUSED'
			? arr.filter((c) => c.status === 'PAUSED' || c.status === 'CAMPAIGN_PAUSED')
			: arr.filter((c) => c.status === f.status);
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
	const head = ['ID', 'Campanie', 'Status', 'Obiectiv', `Buget/zi (${currency})`, `Cheltuit (${currency})`, 'Impresii', 'Clicuri', 'CTR %', 'Conversii', `CPA (${currency})`, 'ROAS'];
	const body = rows.map((c) => [
		c.id, c.name, statusMeta(c.status).label, objectiveLabel(c.objective),
		c.dailyBudget ?? '', c.spend, c.impressions, c.clicks, c.ctr, c.conversions, c.cpa, c.roas
	]);
	const esc = (v: unknown) => {
		const s = String(v ?? '');
		return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
	};
	return '﻿' + [head, ...body].map((r) => r.map(esc).join(';')).join('\r\n');
}
```

- [ ] **Step 1.4: Rulează testele — PASS** — `cd app && bun test src/lib/utils/__tests__/meta-campaigns.test.ts`.
- [ ] **Step 1.5: Commit** — `git add app/src/lib/utils/meta-campaigns.ts app/src/lib/utils/__tests__/meta-campaigns.test.ts && git commit -m "feat(campanii): modul pur pentru VM, KPI, reguli de insights, CSV"`.

---

### Task 2: Merge server-side `campaigns-view.ts` (TDD)

**Files:**
- Create: `app/src/lib/server/meta-ads/campaigns-view.ts`
- Test: `app/src/lib/server/meta-ads/__tests__/campaigns-view.test.ts`

- [ ] **Step 2.1: Test (eșuează)** — cazuri obligatorii:

```ts
import { describe, expect, it } from 'bun:test';
import { buildCampaignRows, enumerateDays } from '$lib/server/meta-ads/campaigns-view';
import type { MetaAdsCampaignInsight, MetaAdsCampaignInfo } from '$lib/server/meta-ads/client';

const insight = (over: Partial<MetaAdsCampaignInsight>): MetaAdsCampaignInsight =>
	({
		campaignId: 'c1', campaignName: 'C1', objective: 'OUTCOME_SALES',
		spend: '10', impressions: '1000', reach: '400', frequency: '1.2', clicks: '30',
		cpc: '0.33', cpm: '10', ctr: '3',
		conversions: 2, conversionValue: 40, costPerConversion: 5,
		resultType: 'Achiziții', cpaLabel: 'Cost/Achiziție',
		purchases: 2, leads: 0, linkClicks: 20, landingPageViews: 10, pageEngagement: 0,
		postReactions: 0, postComments: 0, postSaves: 0, postShares: 0, videoViews: 0, callsPlaced: 0,
		rawActions: [{ action_type: 'purchase', value: '2' }],
		dateStart: '2026-08-01', dateStop: '2026-08-01',
		...over
	}) as MetaAdsCampaignInsight;

const camp = (over: Partial<MetaAdsCampaignInfo>): MetaAdsCampaignInfo =>
	({
		campaignId: 'c1', campaignName: 'C1', status: 'ACTIVE', objective: 'OUTCOME_SALES',
		optimizationGoal: 'OFFSITE_CONVERSIONS', dailyBudget: '10000', lifetimeBudget: null,
		budgetSource: 'campaign', adsetId: 'as1', startTime: '2026-07-01', stopTime: null,
		previewUrl: 'https://fb.com/preview'
	}) as MetaAdsCampaignInfo;

describe('enumerateDays', () => {
	it('include capetele', () => {
		expect(enumerateDays('2026-08-01', '2026-08-03')).toEqual(['2026-08-01', '2026-08-02', '2026-08-03']);
	});
});

describe('buildCampaignRows', () => {
	it('agregă zile, aliniază sparkline pe fereastră și ia reach din reachMap', () => {
		const { rows } = buildCampaignRows(
			[insight({ dateStart: '2026-08-01', spend: '10' }), insight({ dateStart: '2026-08-03', spend: '30' })],
			[camp({})],
			new Map([['c1', { reach: 900, frequency: 1.4 }]]),
			'2026-08-01',
			'2026-08-03'
		);
		expect(rows).toHaveLength(1);
		expect(rows[0].spend).toBe(40);
		expect(rows[0].spark).toEqual([10, 0, 30]);
		expect(rows[0].reach).toBe(900);
		expect(rows[0].dailyBudget).toBe(100); // cenți string → unități majore
		expect(rows[0].ctr).toBeCloseTo((60 / 2000) * 100); // recalculat din sume
	});
	it('campaniile ACTIVE fără insights apar ca zero-rows; PAUSED fără insights nu apar', () => {
		const { rows } = buildCampaignRows(
			[],
			[camp({}), camp({ campaignId: 'c2', campaignName: 'C2', status: 'PAUSED' })],
			new Map(),
			'2026-08-01',
			'2026-08-03'
		);
		expect(rows.map((r) => r.id)).toEqual(['c1']);
		expect(rows[0].spend).toBe(0);
	});
	it('insight-urile orfane devin status UNKNOWN', () => {
		const { rows } = buildCampaignRows(
			[insight({ campaignId: 'cx', campaignName: 'Orfan' })],
			[],
			new Map(),
			'2026-08-01',
			'2026-08-01'
		);
		expect(rows[0].status).toBe('UNKNOWN');
	});
	it('suprascrie conversiile după optimizationGoal (LEAD_GENERATION numără lead-uri)', () => {
		const { rows } = buildCampaignRows(
			[insight({ conversions: 99, rawActions: [{ action_type: 'lead', value: '7' }], leads: 7 })],
			[camp({ optimizationGoal: 'LEAD_GENERATION' })],
			new Map(),
			'2026-08-01',
			'2026-08-01'
		);
		expect(rows[0].conversions).toBe(7);
	});
	it('totalurile zilnice ale contului', () => {
		const { dailySpend } = buildCampaignRows(
			[insight({}), insight({ campaignId: 'c2', campaignName: 'C2', dateStart: '2026-08-01', spend: '5' })],
			[camp({}), camp({ campaignId: 'c2', campaignName: 'C2' })],
			new Map(),
			'2026-08-01',
			'2026-08-02'
		);
		expect(dailySpend).toEqual([
			{ date: '2026-08-01', spend: 15 },
			{ date: '2026-08-02', spend: 0 }
		]);
	});
});
```

- [ ] **Step 2.2: Rulează — FAIL**, apoi implementează `campaigns-view.ts`. Schelet obligatoriu (importă `OPTIMIZATION_GOAL_MAP`, `getActionCount` din `./client`; VM din `$lib/utils/meta-campaigns`):

```ts
import type { MetaAdsCampaignInsight, MetaAdsCampaignInfo } from './client';
import { OPTIMIZATION_GOAL_MAP, getActionCount } from './client';
import type { CampaignRow } from '$lib/utils/meta-campaigns';

export function enumerateDays(since: string, until: string): string[] { /* buclă UTC pe zile, inclusiv capetele */ }

export function buildCampaignRows(
	insights: MetaAdsCampaignInsight[],
	campaigns: MetaAdsCampaignInfo[],
	reachMap: Map<string, { reach: number; frequency: number }>,
	since: string,
	until: string
): { rows: CampaignRow[]; dailySpend: Array<{ date: string; spend: number }> } {
	// 1) enrichment per rând de insight: dacă campania are optimizationGoal în OPTIMIZATION_GOAL_MAP,
	//    conversions = getActionCount(rawActions, map.actionType); cpaLabel/resultType din map
	//    (replica exactă a buclei din reports.remote.ts:379–415)
	// 2) grupare per campaignId: sume spend/impressions/clicks/conversions/conversionValue,
	//    ctr = clicks/impressions*100 (recalculat), cpa = spend/conversions, roas = conversionValue/spend
	// 3) spark: enumerateDays(since, until) → spend pe zi (0 la lipsă); dailySpend = suma pe cont per zi
	// 4) merge cu campaigns (status/budget cents→major/budgetSource/adsetId/previewUrl/start/stop);
	//    ACTIVE|WITH_ISSUES|IN_PROCESS fără insights → zero-row; insight orfan → status 'UNKNOWN'
	// 5) reach per campanie din reachMap (NU suma zilelor); frequency ignorat în VM v1
}
```

- [ ] **Step 2.3: Rulează — PASS** — `cd app && bun test src/lib/server/meta-ads/__tests__/campaigns-view.test.ts`.
- [ ] **Step 2.4: Commit** — `git commit -m "feat(campanii): agregare server-side insights+campanii+reach în CampaignRow"`.

---

### Task 3: Remote `meta-campaigns.remote.ts`

**Files:**
- Create: `app/src/lib/remotes/meta-campaigns.remote.ts`

- [ ] **Step 3.1: Implementează** — structura (urmează exact pattern-ul din reports.remote.ts cu fixurile din „Capcane"):

```ts
import { query, command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { requireStaff } from '$lib/server/get-actor';
import { getAuthenticatedToken } from '$lib/server/meta-ads/auth';
import {
	listCampaignInsights, listActiveCampaigns, listCampaignReachFrequency,
	toggleCampaignStatus, getCampaignWithAdsets
} from '$lib/server/meta-ads/client';
import { buildCampaignRows } from '$lib/server/meta-ads/campaigns-view';
import type { CampaignRow } from '$lib/utils/meta-campaigns';

// cache in-process 5 min, max 200 chei, FIFO — bloc identic cu reports.remote.ts:15–45
// invalidateCache(...patterns) cu substring match

// resolveAccountIntegration(adAccountId, tenantId) — copie din reports.remote.ts:97
//   (metaAdsAccount ⋈ metaAdsIntegration, preferă integrationActive===true, 404 'Cont Meta Ads negăsit')
// throwMetaApiError(err, ctx) — copie din reports.remote.ts:127 (mesaje RO, mapare 401/403/500)

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface MetaCampaignsPayload {
	rows: CampaignRow[];
	dailySpend: Array<{ date: string; spend: number }>;
}

export const listMetaCampaignRows = query(
	v.object({
		adAccountId: v.pipe(v.string(), v.minLength(1)),
		since: v.pipe(v.string(), v.regex(DATE_RE)),
		until: v.pipe(v.string(), v.regex(DATE_RE))
	}),
	async ({ adAccountId, since, until }): Promise<MetaCampaignsPayload> => {
		const event = await requireStaff(); // staff-only (F8) — vezi semnătura reală în get-actor.ts
		const tenantId = event.locals.tenant.id;
		const integrationId = await resolveAccountIntegration(adAccountId, tenantId);
		const cacheKey = `campanii:${tenantId}:${integrationId}:${adAccountId}:${since}:${until}`;
		const cached = getCached<MetaCampaignsPayload>(cacheKey);
		if (cached) return cached;
		const auth = await getAuthenticatedToken(integrationId);
		if (!auth) throw error(500, 'Nu s-a putut obține token-ul Meta Ads. Reconectează integrarea din Setări.');
		const appSecret = env.META_APP_SECRET;
		if (!appSecret) throw error(500, 'META_APP_SECRET nu este configurat');
		try {
			const [insights, campaigns, reach] = await Promise.all([
				listCampaignInsights(adAccountId, auth.accessToken, appSecret, since, until, 'daily'),
				listActiveCampaigns(adAccountId, auth.accessToken, appSecret),
				listCampaignReachFrequency(adAccountId, auth.accessToken, appSecret, since, until)
			]);
			const payload = buildCampaignRows(insights, campaigns, reach, since, until);
			setCache(cacheKey, payload);
			return payload;
		} catch (err) {
			throwMetaApiError(err, { adAccountId, integrationId });
		}
	}
);

export const getMetaCampaignAdsets = query(
	v.object({ adAccountId: v.pipe(v.string(), v.minLength(1)), campaignId: v.pipe(v.string(), v.minLength(1)) }),
	async ({ adAccountId, campaignId }) => { /* requireStaff → resolve → token → getCampaignWithAdsets, cache `adseturi:${tenantId}:${integrationId}:${campaignId}` */ }
);

export const toggleMetaCampaign = command(
	v.object({
		adAccountId: v.pipe(v.string(), v.minLength(1)),
		campaignId: v.pipe(v.string(), v.minLength(1)),
		status: v.picklist(['ACTIVE', 'PAUSED'])
	}),
	async ({ adAccountId, campaignId, status }) => {
		// requireStaff → resolveAccountIntegration(adAccountId, tenantId) → token →
		// toggleCampaignStatus(campaignId, token, appSecret, status) → invalidateCache(tenantId)
		// return { success: true, campaignId, status }
	}
);

export const refreshMetaCampaigns = command(
	v.object({ adAccountId: v.pipe(v.string(), v.minLength(1)) }),
	async ({ adAccountId }) => { /* requireStaff → invalidateCache(`:${adAccountId}:`) → { success: true } */ }
);
```

  Notă: verifică semnătura reală a `requireStaff` în `get-actor.ts:47` — dacă cere `event`, folosește `const event = getRequestEvent()` + `await requireStaff(event)` ca în restul codului.
- [ ] **Step 3.2: Verifică typecheck-ul** — `cd app && bunx tsc --noEmit -p .` sau lasă pe /build-check din Task 9; minim: `bun test` încă verde.
- [ ] **Step 3.3: Commit** — `git commit -m "feat(campanii): remote functions listă+adseturi+toggle+refresh pentru Meta"`.

---

### Task 4: CSS partajat + componente atomice

**Files:**
- Create: `app/src/lib/components/campaigns-ads/campaigns-ads.css` — port din `styles.css` al designului: variabilele `:root` (redenumite cu prefix `--ca-`), `.badge` (+ `success/muted/warn/danger/info/outline`, `.pulse`), `.btn` (+ `sm/primary/ghost/danger`), `.chip`, `.dropdown`/`.dropdown-item`, `.checkbox`, `.switch`/`.switch-slider` — secțiunile relevante din styles.css (badge ~L320–400, buttons ~L200–260, chips/dropdown ~L400–470, switch ~L780–820; citește fișierul de pe disc pentru valorile exacte). Clasele se aplică sub un wrapper `.ca-page` ca să nu scape global.
- Create: `sparkline.svelte` — props `{ data: number[]; color?: string; w?: number; h?: number }`, SVG polyline+polygon, port 1:1 din `campaign-list.jsx:4–21`.
- Create: `mini-bars.svelte` — props `{ data: number[]; color?: string }`, port din `campaign-list.jsx:23–33` (bare 3px, ultima accentuată).
- Create: `status-badge.svelte` — props `{ status: string }`, folosește `statusMeta()` din utils + clasele `.badge`.
- Create: `pacing-bar.svelte` — props `{ spend: number; dailyBudget: number | null; periodDays: number; currency: string }`, port `campaign-insights.jsx:51–61` (tonuri ok/warn/danger la 80%/95%, title cu `fmtMoneyRound`).

- [ ] **Step 4.1:** Scrie cele 4 componente + CSS-ul (importă `campaigns-ads.css` o singură dată în `+layout.svelte` al rutei).
- [ ] **Step 4.2:** `bunx svelte-autofixer` pe fiecare componentă (MCP svelte) + fix.
- [ ] **Step 4.3: Commit** — `git commit -m "feat(campanii): design tokens + atomi (sparkline, bare, badge, pacing)"`.

---

### Task 5: KPI cards + insights strip

**Files:**
- Create: `kpi-cards.svelte` — props `{ kpis: CampaignKpis; currency: string; dailySpend: {date,spend}[]; statusFilter: string; onPickStatus: (s: string) => void; showSparkline?: boolean }`. Port din `campaign-list.jsx:35–84` cu adaptările: card 1 = „Cu probleme" (issues, ton danger; foot: `{inProcess} în procesare` când >0; click → filtru `WITH_ISSUES`), card 2 = Active + `{fmtMoneyRound(dailyBudgetActive)} / zi alocat` + Sparkline pe `dailySpend` REAL (nu fake), card 3 = Pauzate + buget/zi neutilizat, card 4 = „Cheltuit (perioadă)" + conversii + CPA + pace-bar spre `budgetCap` (ascunde pace-bar când `budgetCap === 0`). CSS: secțiunea `.kpi-grid`/`.kpi` din styles.css (~L470–560).
- Create: `insights-strip.svelte` — props `{ rows: CampaignRow[]; periodDays: number; active: string; onPick: (id: string) => void }`. Port din `campaign-insights.jsx:18–49`: chips cu count per regulă din `campaignInsightRules`, starea „toate în parametri" (`.insights-ok`). Click = toggle filtru insight.

- [ ] **Step 5.1:** Implementare + autofixer.
- [ ] **Step 5.2: Commit** — `git commit -m "feat(campanii): KPI cards cu sparkline real și banda de insights"`.

---

### Task 6: Toolbar (căutare, filtre, coloane, export, refresh) + filtre active

**Files:**
- Create: `dropdown-chip.svelte` — props `{ label: string; value: string | null; options: {id,label}[]; onSelect }`, port `campaign-list.jsx:154–180` (overlay fixed + poziționare absolută).
- Create: `column-manager.svelte` — props `{ all: {id,label,locked?}[]; visible: Set<string>; onToggle; onReset }`, port `campaign-insights.jsx:73–101`.
- Create: `active-filters.svelte` — props `{ filters: CampaignFilters; accountLabel: string | null; resultCount: number; total: number; onChange; onClearAll }`, port `campaign-insights.jsx:125–150` (pill-uri cu X + „Șterge toate").
- Create: `filter-toolbar.svelte` — compune: search input (`⌘K` focus, Esc clear — port `app.jsx:140–153`), DropdownChip Status (Toate/Active/Pauzate/Cu probleme/În procesare), DropdownChip Obiectiv (opțiuni derivate din obiectivele prezente în rows → `objectiveLabel`), DropdownChip Cont (ad accounts de la `getReportAdAccounts`, cu `clientName — accountName`), ColumnManager, buton Export CSV, buton Refresh (icon refresh-cw; apelează `refreshMetaCampaigns` apoi cere re-fetch). Props: `{ filters; onFilters; accounts; selectedAccountId; onSelectAccount; columns...; onExport; onRefresh; refreshing }`.
- Coloanele (`ALL_COLS`): identice cu `campaign-list.jsx:369–383` MINUS `trend` doar dacă nu există date; default fără `clicks` și `cpa` (ca în design).

- [ ] **Step 6.1:** Implementare + autofixer pe fiecare.
- [ ] **Step 6.2: Commit** — `git commit -m "feat(campanii): toolbar cu filtre, manager de coloane, export și refresh"`.

---

### Task 7: Tabel + rând expandat + bulk + paginare + confirm

**Files:**
- Create: `campaigns-table.svelte` — props `{ rows (paged); cols: Set<string>; totalsRows: CampaignRow[] | null; currency; periodDays; selected: Set<string>; expandedId: string | null; sort: SortState; onSort; onSelect; onSelectAll; onExpand; onToggleStatus; adAccountId }`. Port din `campaign-list.jsx:204–474`:
  - rând: checkbox, chevron expand, celulă campanie (icon Meta + nume + `RowFlags` din insightHitsFor + meta: id · updated), switch status (dezactivat pentru `IN_PROCESS`/`UNKNOWN`) + StatusBadge, obiectiv badge, buget/zi, cheltuit + PacingBar, impresii, clicuri, CTR, conversii (cu `cpaLabel` ca title), CPA (roșu peste medie? NU — fără țintă hardcodată; fără highlight), ROAS badge (≥3 success, ≥1 warn, <1 danger), trend MiniBars pe `spark`.
  - acțiuni rând (real): Preview (icon eye — `window.open(previewUrl)`, dezactivat când null), Pauză/Pornire (confirm + toast), expand.
  - `TotalsRow` în tfoot: sume + CTR/CPA/ROAS recalculate din sume (port `campaign-list.jsx:385–409`).
  - empty state: `.empty` cu megafon, „Nicio campanie găsită" (fără buton de creare).
  - header sortabil cu săgeți (port `:430–444`).
- Create: `campaign-detail-row.svelte` — props `{ row: CampaignRow; adAccountId; currency; span: number }`. Secțiuni: stânga „Ad seturi & buget" — lazy `getMetaCampaignAdsets` la mount ($state query, pattern reports), tabel mic: nume adset, status badge, buget/zi (`daily_budget` cenți→major), spend, CPL; dreapta „Performanță (perioada selectată)" — perf-cards Reach/Clicuri/Conversii (FĂRĂ delta-uri fake „+12%" din mock) + link „Deschide preview" când `previewUrl` + „Vezi raportul detaliat" → `/{tenant}/reports/facebook-ads?account={adAccountId}`. CSS: `.expand-row`/`.expand-content`/`.kv`/`.perf-grid` din styles.css.
- Create: `bulk-bar.svelte` — props `{ count; busy; onClear; onBulk: (k: 'activate' | 'pause') => void }` — DOAR Pornește/Pauză + Anulează (fără duplicate/delete). Port `campaign-list.jsx:476–488`.
- Create: `pagination.svelte` — port `campaign-list.jsx:490–520` (window cu elipsă, page-size 8/15/25/50).
- Create: `confirm-dialog.svelte` — port `campaign-insights.jsx:103–123` (Enter/Esc, autofocus, tonuri) ca dialog generic cu props `{ title; body; confirmLabel; tone; onConfirm; onCancel }`.

- [ ] **Step 7.1:** Implementare + autofixer pe fiecare componentă.
- [ ] **Step 7.2: Commit** — `git commit -m "feat(campanii): tabel cu expandare pe ad seturi, bulk pauză/pornire, paginare"`.

---

### Task 8: Asamblare pagină + layout + placeholders TikTok/Google

**Files:**
- Modify: `app/src/routes/[tenant]/campaigns-ads/+layout.svelte` — păstrează href-urile; înlocuiește stilul cu `.page-header` (titlu „Campanii Ads" + subtitlu „Gestionează campaniile tale Meta, TikTok și Google din același loc.") + `.platform-tabs` din design (shell.jsx:82–107 + styles.css secțiunea platform-tabs); importă `campaigns-ads.css`; wrapper `.ca-page`. Atenție: `[tenant]/+layout.svelte` are deja `p-6` pe main — nu adăuga alt padding orizontal mare.
- Rewrite: `app/src/routes/[tenant]/campaigns-ads/facebook/+page.svelte` — asamblare (pattern reports/+page.svelte):

```svelte
<script lang="ts">
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { getReportAdAccounts } from '$lib/remotes/reports.remote';
	import { listMetaCampaignRows, toggleMetaCampaign, refreshMetaCampaigns } from '$lib/remotes/meta-campaigns.remote';
	import { getDefaultDateRange } from '$lib/utils/report-helpers';
	import DateRangePicker from '$lib/components/reports/date-range-picker.svelte';
	import { computeKpis, filterCampaignRows, sortCampaignRows, buildCampaignsCsv, type CampaignFilters, type SortState } from '$lib/utils/meta-campaigns';
	// + componentele campaigns-ads

	const accountsQuery = getReportAdAccounts();
	let selectedAccountId = $state<string | null>(null);
	let { since, until } = $state(getDefaultDateRange());  // vezi forma reală în report-helpers.ts:599
	let campaignsQuery = $state<ReturnType<typeof listMetaCampaignRows> | null>(null);
	let filters = $state<CampaignFilters>({ q: '', status: '', objective: '', insight: '' });
	let sort = $state<SortState>({ key: 'spend', dir: 'desc' });
	let pageNo = $state(1);
	let pageSize = $state(15);
	let selected = $state(new Set<string>());
	let expandedId = $state<string | null>(null);
	let confirmState = $state<null | { title: string; body: string; confirmLabel: string; run: () => void }>(null);

	// auto-select cont: ?account= din URL sau primul din listă (pattern reports:104–112)
	// $effect: când selectedAccountId && since && until → campaignsQuery = listMetaCampaignRows({...})
	// periodDays = zile inclusive între since și until
	// derived: rows → filterCampaignRows → sortCampaignRows → slice pentru pagină
	// derived: currency = contul selectat .currency ?? 'RON'
	// reset page/selecție la schimbare de filtre/cont (pattern app.jsx:137)
	// toggle: confirm → await toggleMetaCampaign(...) → toast RO + re-fetch (re-instanțiere query)
	// bulk: buclă secvențială de toggleMetaCampaign pe selecție, toast cu progres/rezultat
	// export: buildCampaignsCsv(filtered, currency) → Blob download `campanii-meta.csv`
	// refresh: await refreshMetaCampaigns({adAccountId}) → re-instanțiere query
	// ⌘K: handler window keydown (port app.jsx:140–153) cu cleanup
	// warning-uri cont (paymentWarning/tokenWarning — pattern reports:127–146) afișate ca banner amber
</script>
```

  Ordinea în markup (din `app.jsx:282–336`): KpiCards → InsightsStrip → toolbar → ActiveFilters → BulkBar (când selected>0) → CampaignsTable (+ detail row) → Pagination → ConfirmDialog. Stări: loading skeleton (shimmer pe tabel), eroare cu retry, empty.
- Delete: `app/src/routes/[tenant]/campaigns-ads/facebook/+page.server.ts`.
- Rewrite: `google/+page.svelte` și `tiktok/+page.svelte` — card curat `.ca-page`: titlu platformă + badge „În curând", text: gestionarea campaniilor se conectează la API-ul CRM într-o iterație viitoare; link către raportul existent (`/{tenant}/reports/google-ads`, respectiv `/reports/tiktok-ads`). Zero referințe PersonalOPS/workeri.

- [ ] **Step 8.1:** Implementare + autofixer pe pagină și layout.
- [ ] **Step 8.2:** Smoke local: `bun run dev` deja rulează din working dir → deschide `/ots/campaigns-ads/facebook`.
- [ ] **Step 8.3: Commit** — `git commit -m "feat(campanii): pagina Facebook/Meta rescrisă pe API-ul CRM + placeholders curate"`.

---

### Task 9: Ștergerea fluxului PersonalOPS + sweep + docs

Ordinea contează (checklist verificat de agentul de mapare):

- [ ] **Step 9.1:** `git rm -r app/src/routes/api/external/campaigns` (4 rute, inclusiv `draft/validate`).
- [ ] **Step 9.2:** `git rm -r app/src/lib/server/campaigns`.
- [ ] **Step 9.3:** `git rm app/src/lib/server/meta-ads/campaign-create.ts && git rm -r app/src/lib/server/meta-ads/__tests__/option-b`.
- [ ] **Step 9.4:** Sweep: șterge `IdempotentResult` + `withIdempotency` din `api-keys/middleware.ts` (păstrează `withApiKey`); șterge cele 4 tipuri `Campaign*Event` + membrii uniunii din `plugins/types.ts:148–180, 201–204`; șterge `CAMPAIGN_STATUSES`/`CAMPAIGN_BUILD_STEPS` + tipurile derivate din `schema.ts:5420–5432` (tabelele `campaign`/`campaignAudit`/`campaignIdempotency` RĂMÂN).
- [ ] **Step 9.5:** Docs: `docs/ads-optimizer-system.md:27` (scoate linia campaigns din diagramă); `app/docs/multi-platform-ads-automation-plan.md` — notă „(eliminat 2026-08 — fluxul PersonalOPS campaigns a fost scos; pagina folosește API-ul CRM)" la secțiunile listate.
- [ ] **Step 9.6:** `grep -rn "external/campaigns\|applyCampaignAction\|buildMetaCampaign\|campaign-create\|withIdempotency\|CampaignCreatedEvent" app/src docs app/docs` → zero hituri (în afara planurilor istorice din docs/superpowers).
- [ ] **Step 9.7:** `cd app && bun test` → tot verde (testul option-b a dispărut odată cu directorul).
- [ ] **Step 9.8: Commit** — `git commit -m "refactor(campanii): eliminare flux PersonalOPS (API extern, servicii, cod mort)"`.

---

### Task 10: Verificare completă

- [ ] **Step 10.1:** `/build-check` (svelte-check heap 8GB) — fără erori NOI față de baseline (16 err/56 warn pre-existente).
- [ ] **Step 10.2:** `cd app && bun test` — verde.
- [ ] **Step 10.3:** svelte-autofixer (MCP) re-run pe toate componentele noi/modificate — zero issues.
- [ ] **Step 10.4:** testermcp pe `http://localhost:5173/ots/campaigns-ads/facebook` (login `office@onetopsolution.ro`): golden path (cont selectat, KPI + tabel randate, sortare, filtru status din KPI, insight chip, căutare, coloane, export CSV descarcă, expandare rând cu ad seturi, paginare) + edge (cont fără campanii → empty state; schimbare perioadă → refetch; pauzare campanie test DOAR dacă userul confirmă — altfel doar deschide confirm și anulează). Screenshots la fiecare stare.
- [ ] **Step 10.5:** Tabs TikTok/Google se randează curat.

### Task 11: Review + finish

- [ ] **Step 11.1:** superpowers:requesting-code-review (+ gemini second opinion pe securitate/remote guards).
- [ ] **Step 11.2:** Fixuri din review → re-run Task 10.
- [ ] **Step 11.3:** Push branch `feat/facebook-campaigns-redesign`; propune deploy, așteaptă „go".

## Self-Review (făcut)

- Acoperire design: KPI ✓, insights strip ✓, toolbar+filtre+coloane+CSV ✓, tabel+expand+bulk+paginare ✓, confirm ✓, toasts ✓ (sonner), page header+tabs ✓. Excluse deliberat (fără backend): wizard, edit/duplicate/delete, creative modal (înlocuit cu previewUrl + link raport), JSON drawer, tweaks panel, image-slot.
- Fără placeholder-e nerezolvate: pașii cu „port din X" au sursa exactă pe disc (fișier+linii); scheletele marchează explicit ce se copiază din reports.remote.ts (linii exacte).
- Consistență tipuri: `CampaignRow`/`CampaignKpis`/`CampaignFilters`/`SortState` definite în Task 1 și folosite identic în 2/3/7/8.
