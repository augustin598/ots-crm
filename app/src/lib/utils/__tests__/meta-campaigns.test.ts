import { describe, expect, it } from 'bun:test';
import {
	statusMeta,
	objectiveLabel,
	computeKpis,
	insightHitsFor,
	fmtNum,
	fmtMoney,
	fmtPct,
	pacingOf,
	filterCampaignRows,
	sortCampaignRows,
	buildCampaignsCsv,
	type CampaignRow
} from '../meta-campaigns';

const row = (over: Partial<CampaignRow> = {}): CampaignRow => ({
	id: '100',
	name: 'Test',
	status: 'ACTIVE',
	objective: 'OUTCOME_SALES',
	dailyBudget: 100,
	lifetimeBudget: null,
	budgetSource: 'campaign',
	previewUrl: null,
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

describe('statusMeta', () => {
	it('mapează statusurile Meta la etichete RO', () => {
		expect(statusMeta('ACTIVE').label).toBe('Activă');
		expect(statusMeta('CAMPAIGN_PAUSED').label).toBe('Pauzată');
		expect(statusMeta('WITH_ISSUES').tone).toBe('danger');
	});
	it('fallback pe necunoscut', () => {
		expect(statusMeta('whatever').label).toBe('Necunoscută');
	});
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
	it('CAMPAIGN_PAUSED contează ca pauzată', () => {
		expect(computeKpis([row({ status: 'CAMPAIGN_PAUSED' })], 5).paused).toBe(1);
	});
	it('pace 0 când nu există buget', () => {
		expect(computeKpis([row({ dailyBudget: null, status: 'PAUSED' })], 10).pace).toBe(0);
	});
});

describe('reguli de insights', () => {
	it('issues pe WITH_ISSUES', () => {
		expect(insightHitsFor(row({ status: 'WITH_ISSUES' }), 10).map((r) => r.id)).toContain('issues');
	});
	it('budget la pacing >= 80%', () => {
		const c = row({ status: 'ACTIVE', dailyBudget: 10, spend: 85 });
		expect(pacingOf(c, 10)).toBeCloseTo(0.85);
		expect(insightHitsFor(c, 10).map((r) => r.id)).toContain('budget');
	});
	it('budget nu se aplică pe campanii pauzate', () => {
		const c = row({ status: 'PAUSED', dailyBudget: 10, spend: 85 });
		expect(insightHitsFor(c, 10).map((r) => r.id)).not.toContain('budget');
	});
	it('ctr sub 1% doar cu peste 10k impresii', () => {
		expect(insightHitsFor(row({ ctr: 0.5, impressions: 20000 }), 10).map((r) => r.id)).toContain('ctr');
		expect(insightHitsFor(row({ ctr: 0.5, impressions: 500 }), 10).map((r) => r.id)).not.toContain('ctr');
	});
	it('winner la ROAS >= 3', () => {
		expect(insightHitsFor(row({ roas: 3.2 }), 10).map((r) => r.id)).toContain('winner');
		expect(insightHitsFor(row({ roas: 2.9 }), 10).map((r) => r.id)).not.toContain('winner');
	});
});

describe('formatare', () => {
	it('fmtNum k/M și em dash pe 0', () => {
		expect(fmtNum(0)).toBe('—');
		expect(fmtNum(1500)).toBe('1.5k');
		expect(fmtNum(2_300_000)).toBe('2.3M');
		expect(fmtNum(950)).toBe('950');
	});
	it('fmtMoney cu valuta contului (ro-RO folosește codul valutei)', () => {
		expect(fmtMoney(0, 'EUR')).toBe('—');
		expect(fmtMoney(1234.5, 'EUR')).toContain('EUR');
		expect(fmtMoney(1234.5, 'EUR')).toContain('1.234,50');
		expect(fmtMoney(1234.5, 'RON')).toMatch(/RON|lei/i);
	});
	it('fmtMoney nu aruncă pe cod de valută invalid', () => {
		expect(fmtMoney(10, 'XXX_BAD')).toContain('XXX_BAD');
	});
	it('fmtPct', () => {
		expect(fmtPct(0)).toBe('—');
		expect(fmtPct(2.34)).toBe('2,34%');
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
	it('filtrează după status; PAUSED include CAMPAIGN_PAUSED', () => {
		expect(filterCampaignRows(rows, { q: '', status: 'ACTIVE', objective: '', insight: '' })).toHaveLength(2);
		const withCp = [...rows, row({ id: '4', status: 'CAMPAIGN_PAUSED' })];
		expect(filterCampaignRows(withCp, { q: '', status: 'PAUSED', objective: '', insight: '' })).toHaveLength(2);
	});
	it('filtrează după obiectiv', () => {
		expect(filterCampaignRows(rows, { q: '', status: '', objective: 'OUTCOME_LEADS', insight: '' })[0].id).toBe('2');
	});
	it('filtrează după insight', () => {
		expect(filterCampaignRows(rows, { q: '', status: '', objective: '', insight: 'ctr' }, 10)[0].id).toBe('3');
	});
	it('sortează numeric desc/asc și string', () => {
		expect(sortCampaignRows(rows, { key: 'spend', dir: 'desc' })[0].id).toBe('2');
		expect(sortCampaignRows(rows, { key: 'name', dir: 'asc' })[0].name).toBe('Alpha');
	});
	it('sortarea nu mutează originalul', () => {
		const before = rows.map((r) => r.id);
		sortCampaignRows(rows, { key: 'spend', dir: 'desc' });
		expect(rows.map((r) => r.id)).toEqual(before);
	});
});

describe('buildCampaignsCsv', () => {
	it('CSV cu separator ; și BOM, escape pe ghilimele', () => {
		const csv = buildCampaignsCsv([row({ name: 'Cu "ghilimele"; test' })], 'EUR');
		expect(csv.startsWith('﻿')).toBe(true);
		expect(csv).toContain('"Cu ""ghilimele""; test"');
		expect(csv.split('\r\n')[0]).toContain('Campanie;Status');
		expect(csv.split('\r\n')[0]).toContain('(EUR)');
	});
	it('gardă anti-injecție de formule Excel pe nume periculoase', () => {
		const csv = buildCampaignsCsv([row({ name: '=HYPERLINK("http://x")' })], 'EUR');
		expect(csv).toContain('\'=HYPERLINK');
		expect(csv).not.toMatch(/;\s*=HYPERLINK/);
	});
	it('zecimalele folosesc virgulă (dialect Excel ro-RO)', () => {
		const csv = buildCampaignsCsv([row({ spend: 1234.56, ctr: 2.93, cpa: 10.5, roas: 4.2 })], 'EUR');
		expect(csv).toContain('1234,56');
		expect(csv).toContain('2,93');
		expect(csv).toContain('4,2');
	});
});
