#!/usr/bin/env bun
/**
 * Analiză metrici DOUBLO GOLD (6891033633402)
 * Fereastra A: 2026-04-01 → 2026-04-29 (ultima lună)
 * Fereastra B: 2026-04-23 → 2026-04-29 (ultimele 7 zile)
 * READ-ONLY — fără modificări în DB
 */
import { createClient } from '@libsql/client';
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(import.meta.dir, '..', '.env') });

const SQLITE_URI = process.env.SQLITE_URI;
const SQLITE_AUTH_TOKEN = process.env.SQLITE_AUTH_TOKEN;
const CAMPAIGN_ID = '6891033633402';

if (!SQLITE_URI) { console.error('SQLITE_URI not set'); process.exit(1); }

const db = createClient({ url: SQLITE_URI, authToken: SQLITE_AUTH_TOKEN });

interface DayRow {
	date: string;
	spend_ron: number;
	impressions: number;
	clicks: number;
	conversions: number;
	cpl_ron: number | null;
	cpc_ron: number | null;
	cpm_ron: number | null;
	ctr: number | null;
	frequency: number | null;
	maturity: string | null;
}

async function fetchWindow(from: string, to: string): Promise<DayRow[]> {
	const res = await db.execute({
		sql: `SELECT
		        date,
		        spend_cents / 100.0 AS spend_ron,
		        impressions,
		        clicks,
		        conversions,
		        cpl_cents / 100.0 AS cpl_ron,
		        cpc_cents / 100.0 AS cpc_ron,
		        cpm_cents / 100.0 AS cpm_ron,
		        ctr,
		        frequency,
		        maturity
		      FROM ad_metric_snapshot
		      WHERE external_campaign_id = ?
		        AND date BETWEEN ? AND ?
		      ORDER BY date ASC`,
		args: [CAMPAIGN_ID, from, to]
	});

	return res.rows.map((r) => ({
		date: r.date as string,
		spend_ron: r.spend_ron as number,
		impressions: r.impressions as number,
		clicks: r.clicks as number,
		conversions: r.conversions as number,
		cpl_ron: r.cpl_ron as number | null,
		cpc_ron: r.cpc_ron as number | null,
		cpm_ron: r.cpm_ron as number | null,
		ctr: r.ctr as number | null,
		frequency: r.frequency as number | null,
		maturity: r.maturity as string | null
	}));
}

function round2(n: number): number {
	return Math.round(n * 100) / 100;
}

function analyzeWindow(rows: DayRow[], compareRef?: ReturnType<typeof buildSummary>) {
	const totals = {
		spend_ron: round2(rows.reduce((s, r) => s + r.spend_ron, 0)),
		conversions: rows.reduce((s, r) => s + r.conversions, 0),
		impressions: rows.reduce((s, r) => s + r.impressions, 0),
		clicks: rows.reduce((s, r) => s + r.clicks, 0)
	};

	const totalSpend = totals.spend_ron;
	const totalConv = totals.conversions;
	const cpl_ron_weighted = totalConv > 0 ? round2(totalSpend / totalConv) : null;

	const rowsWithCtr = rows.filter((r) => r.ctr !== null && r.impressions > 0);
	const avg_ctr = rowsWithCtr.length > 0
		? round2(rowsWithCtr.reduce((s, r) => s + (r.ctr ?? 0), 0) / rowsWithCtr.length * 100) / 100
		: null;

	const rowsWithFreq = rows.filter((r) => r.frequency !== null);
	const avg_frequency = rowsWithFreq.length > 0
		? round2(rowsWithFreq.reduce((s, r) => s + (r.frequency ?? 0), 0) / rowsWithFreq.length)
		: null;

	const days_cpl_over_100 = rows.filter((r) => r.cpl_ron !== null && r.cpl_ron > 100).length;
	const days_cpl_over_200 = rows.filter((r) => r.cpl_ron !== null && r.cpl_ron > 200).length;
	const days_cpl_over_500 = rows.filter((r) => r.cpl_ron !== null && r.cpl_ron > 500).length;
	const days_zero_conversions_with_spend = rows.filter((r) => r.spend_ron > 0 && r.conversions === 0).length;

	// Top 5 worst days by CPL (exclude zile fără conversii — CPL = null)
	const daysWithCpl = rows
		.filter((r) => r.cpl_ron !== null)
		.sort((a, b) => (b.cpl_ron ?? 0) - (a.cpl_ron ?? 0));

	const top_5_worst_days = daysWithCpl.slice(0, 5).map((r) => ({
		date: r.date,
		cpl_ron: round2(r.cpl_ron ?? 0),
		spend_ron: round2(r.spend_ron),
		conversions: r.conversions
	}));

	const daily_breakdown = rows.map((r) => ({
		date: r.date,
		spend_ron: round2(r.spend_ron),
		impressions: r.impressions,
		clicks: r.clicks,
		conversions: r.conversions,
		cpl_ron: r.cpl_ron !== null ? round2(r.cpl_ron) : null,
		cpc_ron: r.cpc_ron !== null ? round2(r.cpc_ron) : null,
		cpm_ron: r.cpm_ron !== null ? round2(r.cpm_ron) : null,
		ctr: r.ctr !== null ? round2(r.ctr * 10000) / 10000 : null,
		frequency: r.frequency !== null ? round2(r.frequency) : null,
		maturity: r.maturity
	}));

	let comparison_vs_30d: Record<string, unknown> | undefined;
	if (compareRef) {
		const cplChange = (compareRef.cpl_ron_weighted && cpl_ron_weighted)
			? round2(((cpl_ron_weighted - compareRef.cpl_ron_weighted) / compareRef.cpl_ron_weighted) * 100)
			: null;
		const ctrChange = (compareRef.avg_ctr && avg_ctr)
			? round2(((avg_ctr - compareRef.avg_ctr) / compareRef.avg_ctr) * 100)
			: null;

		let verdict: 'improving' | 'stable' | 'declining' = 'stable';
		if (cplChange !== null) {
			if (cplChange > 10) verdict = 'declining';
			else if (cplChange < -10) verdict = 'improving';
		}

		comparison_vs_30d = {
			cpl_change_pct: cplChange !== null ? `${cplChange > 0 ? '+' : ''}${cplChange}%` : 'n/a',
			ctr_change_pct: ctrChange !== null ? `${ctrChange > 0 ? '+' : ''}${ctrChange}%` : 'n/a',
			verdict
		};
	}

	return {
		totals,
		averages: {
			cpl_ron_weighted,
			ctr: avg_ctr,
			frequency: avg_frequency,
			...(comparison_vs_30d ? { comparison_vs_30d } : {})
		},
		deviation_breakdown: {
			days_cpl_over_100,
			days_cpl_over_200,
			days_cpl_over_500,
			days_zero_conversions_with_spend
		},
		top_5_worst_days,
		daily_breakdown
	};
}

function buildSummary(analysis: ReturnType<typeof analyzeWindow>) {
	return {
		cpl_ron_weighted: analysis.averages.cpl_ron_weighted,
		avg_ctr: analysis.averages.ctr,
		avg_frequency: analysis.averages.frequency
	};
}

function buildDiagnosticSignals(
	rows30d: DayRow[],
	rows7d: DayRow[],
	analysis30d: ReturnType<typeof analyzeWindow>,
	analysis7d: ReturnType<typeof analyzeWindow>
): string[] {
	const signals: string[] = [];

	// Frequency fatigue
	const freq7d = analysis7d.averages.frequency;
	if (freq7d !== null && freq7d >= 4) {
		signals.push(`Frequency ${freq7d.toFixed(2)} în ultimele 7 zile → risc ad fatigue (prag critic: 4)`);
	} else if (freq7d !== null && freq7d >= 3) {
		signals.push(`Frequency ${freq7d.toFixed(2)} în ultimele 7 zile → aproape de prag ad fatigue`);
	}

	// CTR drop
	const ctr30d = analysis30d.averages.ctr;
	const ctr7d = analysis7d.averages.ctr;
	if (ctr30d && ctr7d && ctr7d < ctr30d * 0.7) {
		signals.push(`CTR ${(ctr7d * 100).toFixed(2)}% în ultimele 7 zile vs ${(ctr30d * 100).toFixed(2)}% medie lună → creative posibil obosit`);
	}

	// Consecutive wasted spend days
	let maxConsecWasted = 0;
	let curConsec = 0;
	for (const r of rows7d) {
		if (r.spend_ron > 0 && r.conversions === 0) curConsec++;
		else curConsec = 0;
		if (curConsec > maxConsecWasted) maxConsecWasted = curConsec;
	}
	if (maxConsecWasted >= 2) {
		signals.push(`${maxConsecWasted} zile consecutive în ultimele 7 zile cu spend > 0 RON și 0 conversii`);
	}

	// CPL worsening trend
	const cmpVs30d = (analysis7d.averages as Record<string, unknown>).comparison_vs_30d as Record<string, string> | undefined;
	if (cmpVs30d?.verdict === 'declining') {
		signals.push(`CPL ultimele 7 zile în creștere față de medie lunii (${cmpVs30d.cpl_change_pct}) → campanie în declin`);
	} else if (cmpVs30d?.verdict === 'improving') {
		signals.push(`CPL ultimele 7 zile în scădere față de medie lunii (${cmpVs30d.cpl_change_pct}) → campanie îmbunătățită`);
	}

	// Many wasted days in 30d
	const wastedDays30d = analysis30d.deviation_breakdown.days_zero_conversions_with_spend;
	const totalDays30d = rows30d.length;
	if (wastedDays30d >= 5 || (totalDays30d > 0 && wastedDays30d / totalDays30d > 0.2)) {
		signals.push(`${wastedDays30d} din ${totalDays30d} zile cu spend și 0 conversii (${((wastedDays30d / totalDays30d) * 100).toFixed(0)}% wasted-spend days în ultimele 30 zile)`);
	}

	// High CPL days
	const highCpl = analysis30d.deviation_breakdown.days_cpl_over_200;
	if (highCpl >= 3) {
		signals.push(`${highCpl} zile cu CPL > 200 RON în ultima lună → eficiență scăzută`);
	}

	return signals;
}

async function main() {
	const [rows30d, rows7d] = await Promise.all([
		fetchWindow('2026-04-01', '2026-04-29'),
		fetchWindow('2026-04-23', '2026-04-29')
	]);

	if (rows30d.length === 0) {
		console.error('Nu s-au găsit date în DB pentru fereastra 30 zile. Rulează mai întâi backfill-doublo-gold-snapshots.ts');
		process.exit(1);
	}

	const analysis30d = analyzeWindow(rows30d);
	const ref30d = buildSummary(analysis30d);
	const analysis7d = analyzeWindow(rows7d, ref30d);

	const diagnostics = buildDiagnosticSignals(rows30d, rows7d, analysis30d, analysis7d);

	const output = {
		last_30_days: {
			period: '2026-04-01 → 2026-04-29',
			totals: analysis30d.totals,
			averages: analysis30d.averages,
			deviation_breakdown: analysis30d.deviation_breakdown,
			top_5_worst_days: analysis30d.top_5_worst_days,
			daily_breakdown: analysis30d.daily_breakdown
		},
		last_7_days: {
			period: '2026-04-23 → 2026-04-29',
			totals: analysis7d.totals,
			averages: analysis7d.averages,
			deviation_breakdown: analysis7d.deviation_breakdown,
			daily_breakdown: analysis7d.daily_breakdown
		},
		diagnostic_signals: diagnostics
	};

	console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
	console.error('FATAL:', err);
	process.exit(1);
}).finally(() => db.close());
