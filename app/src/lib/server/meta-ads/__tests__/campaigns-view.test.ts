import { describe, expect, it, mock } from 'bun:test';

// client.ts (importat de campaigns-view) trage $lib/server/logger → $lib/server/db →
// $env/dynamic/private; mock-uim modulele virtuale SvelteKit înainte de import.
mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$lib/server/db', () => ({ db: {} }));
mock.module('$lib/server/db/schema', () => ({}));
mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logError: () => {},
	logWarning: () => {}
}));

import type { MetaAdsCampaignInsight, MetaAdsCampaignInfo } from '../client';

// Import dinamic DUPĂ mock-uri (importurile statice se hoistează peste mock.module).
const { buildCampaignRows, enumerateDays } = await import('../campaigns-view');

const insight = (over: Partial<MetaAdsCampaignInsight> = {}): MetaAdsCampaignInsight => ({
	campaignId: 'c1',
	campaignName: 'C1',
	objective: 'OUTCOME_SALES',
	spend: '10',
	impressions: '1000',
	reach: '400',
	frequency: '1.2',
	clicks: '30',
	cpc: '0.33',
	cpm: '10',
	ctr: '3',
	conversions: 2,
	conversionValue: 40,
	costPerConversion: 5,
	resultType: 'Purchases',
	cpaLabel: 'Cost per purchase',
	purchases: 2,
	leads: 0,
	linkClicks: 20,
	landingPageViews: 10,
	pageEngagement: 0,
	postReactions: 0,
	postComments: 0,
	postSaves: 0,
	postShares: 0,
	videoViews: 0,
	callsPlaced: 0,
	rawActions: [{ action_type: 'purchase', value: '2' }],
	dateStart: '2026-08-01',
	dateStop: '2026-08-01',
	...over
});

const camp = (over: Partial<MetaAdsCampaignInfo> = {}): MetaAdsCampaignInfo => ({
	campaignId: 'c1',
	campaignName: 'C1',
	status: 'ACTIVE',
	effectiveStatus: 'ACTIVE',
	objective: 'OUTCOME_SALES',
	optimizationGoal: 'OFFSITE_CONVERSIONS',
	dailyBudget: '10000',
	lifetimeBudget: null,
	budgetSource: 'campaign',
	adsetId: 'as1',
	startTime: '2026-07-01T00:00:00+0000',
	stopTime: null,
	previewUrl: 'https://fb.com/preview',
	...over
});

describe('enumerateDays', () => {
	it('include capetele', () => {
		expect(enumerateDays('2026-08-01', '2026-08-03')).toEqual(['2026-08-01', '2026-08-02', '2026-08-03']);
	});
	it('o singură zi', () => {
		expect(enumerateDays('2026-08-05', '2026-08-05')).toEqual(['2026-08-05']);
	});
	it('interval invers → gol', () => {
		expect(enumerateDays('2026-08-05', '2026-08-01')).toEqual([]);
	});
});

describe('buildCampaignRows', () => {
	it('agregă zile, aliniază sparkline pe fereastră și ia reach din reachMap', () => {
		const { rows } = buildCampaignRows(
			[insight({ dateStart: '2026-08-01', spend: '10' }), insight({ dateStart: '2026-08-03', spend: '30' })],
			[camp()],
			new Map([['c1', { reach: 900, frequency: 1.4 }]]),
			'2026-08-01',
			'2026-08-03'
		);
		expect(rows).toHaveLength(1);
		expect(rows[0].spend).toBe(40);
		expect(rows[0].spark).toEqual([10, 0, 30]);
		expect(rows[0].reach).toBe(900);
		expect(rows[0].dailyBudget).toBe(100); // cenți string → unități majore
		expect(rows[0].impressions).toBe(2000);
		expect(rows[0].clicks).toBe(60);
		expect(rows[0].ctr).toBeCloseTo((60 / 2000) * 100);
		expect(rows[0].conversions).toBe(4);
		expect(rows[0].conversionValue).toBe(80);
		expect(rows[0].cpa).toBeCloseTo(10);
		expect(rows[0].roas).toBeCloseTo(2);
		expect(rows[0].status).toBe('ACTIVE');
		expect(rows[0].previewUrl).toBe('https://fb.com/preview');
	});

	it('campaniile ACTIVE fără insights apar ca zero-rows; PAUSED fără insights nu apar', () => {
		const { rows } = buildCampaignRows(
			[],
			[camp(), camp({ campaignId: 'c2', campaignName: 'C2', status: 'PAUSED', effectiveStatus: 'PAUSED' })],
			new Map(),
			'2026-08-01',
			'2026-08-03'
		);
		expect(rows.map((r) => r.id)).toEqual(['c1']);
		expect(rows[0].spend).toBe(0);
		expect(rows[0].spark).toEqual([0, 0, 0]);
	});

	it('WITH_ISSUES și IN_PROCESS (effective) fără insights apar și ele', () => {
		const { rows } = buildCampaignRows(
			[],
			[
				camp({ campaignId: 'c3', status: 'ACTIVE', effectiveStatus: 'WITH_ISSUES' }),
				camp({ campaignId: 'c4', status: 'ACTIVE', effectiveStatus: 'IN_PROCESS' })
			],
			new Map(),
			'2026-08-01',
			'2026-08-01'
		);
		expect(rows.map((r) => r.status).sort()).toEqual(['IN_PROCESS', 'WITH_ISSUES']);
	});

	it('statusul rândului e cel EFECTIV, nu cel configurat', () => {
		const { rows } = buildCampaignRows(
			[insight()],
			[camp({ status: 'ACTIVE', effectiveStatus: 'WITH_ISSUES' })],
			new Map(),
			'2026-08-01',
			'2026-08-01'
		);
		expect(rows[0].status).toBe('WITH_ISSUES');
	});

	it('insight-urile orfane devin status UNKNOWN', () => {
		const { rows } = buildCampaignRows(
			[insight({ campaignId: 'cx', campaignName: 'Orfan' })],
			[],
			new Map(),
			'2026-08-01',
			'2026-08-01'
		);
		expect(rows).toHaveLength(1);
		expect(rows[0].status).toBe('UNKNOWN');
		expect(rows[0].dailyBudget).toBeNull();
	});

	it('suprascrie conversiile după optimizationGoal (LEAD_GENERATION numără lead-uri)', () => {
		const { rows } = buildCampaignRows(
			[insight({ conversions: 99, leads: 7, rawActions: [{ action_type: 'lead', value: '7' }] })],
			[camp({ optimizationGoal: 'LEAD_GENERATION' })],
			new Map(),
			'2026-08-01',
			'2026-08-01'
		);
		expect(rows[0].conversions).toBe(7);
		expect(rows[0].cpaLabel).toBe('Per lead');
		expect(rows[0].resultType).toBe('Leads');
	});

	it('goal fără actionType (REACH) păstrează conversiile dar setează etichetele', () => {
		const { rows } = buildCampaignRows(
			[insight({ conversions: 5 })],
			[camp({ optimizationGoal: 'REACH' })],
			new Map(),
			'2026-08-01',
			'2026-08-01'
		);
		expect(rows[0].conversions).toBe(5);
		expect(rows[0].resultType).toBe('Reach');
	});

	it('totalurile zilnice ale contului acoperă toată fereastra', () => {
		const { dailySpend } = buildCampaignRows(
			[insight(), insight({ campaignId: 'c2', campaignName: 'C2', dateStart: '2026-08-01', spend: '5' })],
			[camp(), camp({ campaignId: 'c2', campaignName: 'C2' })],
			new Map(),
			'2026-08-01',
			'2026-08-02'
		);
		expect(dailySpend).toEqual([
			{ date: '2026-08-01', spend: 15 },
			{ date: '2026-08-02', spend: 0 }
		]);
	});

	it('budget de pe adset (ABO) e marcat cu budgetSource adset', () => {
		const { rows } = buildCampaignRows(
			[],
			[camp({ dailyBudget: '5000', budgetSource: 'adset' })],
			new Map(),
			'2026-08-01',
			'2026-08-01'
		);
		expect(rows[0].dailyBudget).toBe(50);
		expect(rows[0].budgetSource).toBe('adset');
	});
});
