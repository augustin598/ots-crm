/* ===== Dashboard OTS — illustrative (demo) data =====
 * Deterministic generators (no Math.random / no hardcoded dates) so SSR and the
 * client render identically and the numbers never go stale. Used only for the
 * widgets the CRM does not track yet (revenue/expenses chart, cash-flow forecast,
 * conversion funnel, Ads performance breakdown, today's agenda).
 */
import type { RevenuePoint, CashflowPoint, FunnelStage, AdsPlatform, TodayEvent } from './types';

const RO_MONTHS = ['Ian', 'Feb', 'Mar', 'Apr', 'Mai', 'Iun', 'Iul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthLabel(d: Date): string {
	return `${RO_MONTHS[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`;
}

/** Last 12 months ending in the current month, with a plausible upward trend. */
export function revenue12m(now: Date): RevenuePoint[] {
	const out: RevenuePoint[] = [];
	for (let i = 0; i < 12; i++) {
		const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
		const revenue = Math.round(140000 + 14000 * i + 28000 * Math.sin(i * 0.7));
		const expenses = Math.round(revenue * 0.6 + 9000 * Math.cos(i * 0.5));
		out.push({ m: monthLabel(d), revenue, expenses });
	}
	return out;
}

/** Next 30 days of inflow/outflow, deterministic jitter via trig. */
export function cashflow30d(_now: Date): CashflowPoint[] {
	return Array.from({ length: 30 }, (_, i) => {
		const day = i + 1;
		const jitter = (Math.sin(i * 1.7) + 1) * 1000;
		const inflow = 8000 + Math.sin(i * 0.4) * 4000 + (day % 7 === 0 ? 12000 : 0) + jitter;
		const outflow = 5500 + Math.cos(i * 0.5) * 2500 + (day % 5 === 0 ? 8000 : 0);
		return { day, inflow: Math.max(0, Math.round(inflow)), outflow: Math.max(0, Math.round(outflow)) };
	});
}

/** Conversion funnel (theme-aware colors). */
export function funnel(): FunnelStage[] {
	return [
		{ stage: 'Leads', value: 1247, colorVar: 'var(--chart-1)' },
		{ stage: 'Calificați', value: 542, colorVar: 'var(--chart-2)' },
		{ stage: 'Propuneri', value: 218, colorVar: 'var(--chart-3)' },
		{ stage: 'Clienți', value: 87, colorVar: 'var(--chart-4)' }
	];
}

/** Ads performance per platform (brand colors kept for identity). */
export function adsPlatforms(): AdsPlatform[] {
	return [
		{ id: 'meta', name: 'Facebook & Instagram', color: '#1877F2', spend: 24800, roas: 3.4, conv: 142, ctr: 2.8, cpa: 174, campaigns: 18, budget: 30000 },
		{ id: 'google', name: 'Google Ads', color: '#4285F4', spend: 16200, roas: 4.1, conv: 98, ctr: 4.2, cpa: 165, campaigns: 7, budget: 18000 },
		{ id: 'tiktok', name: 'TikTok', color: '#ff0050', spend: 7750, roas: 2.1, conv: 47, ctr: 1.9, cpa: 165, campaigns: 7, budget: 10000 }
	];
}

/** Today's agenda (calendar not wired to this page). */
export function todayEvents(): TodayEvent[] {
	return [
		{ time: '10:00', title: 'Standup echipă marketing', color: 'primary' },
		{ time: '14:00', title: 'Call client - aprobare creative', color: 'warn' },
		{ time: '16:00', title: 'Review Q2', color: 'info' },
		{ time: '17:30', title: 'Onboarding client nou', color: 'success' }
	];
}

/** A small, stable pseudo-random in [0,1) from a string seed (deterministic). */
export function seeded(seed: string): number {
	let h = 2166136261;
	for (let i = 0; i < seed.length; i++) {
		h ^= seed.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return ((h >>> 0) % 1000) / 1000;
}

/** A gentle ~12-point sparkline ending at `end`, for KPIs without a real series. */
export function synthSpark(end: number, seed: string, points = 12): number[] {
	const drift = 0.78 + seeded(seed) * 0.14; // start at 78–92% of end
	return Array.from({ length: points }, (_, i) => {
		const t = i / (points - 1);
		const wobble = 1 + Math.sin(i * 1.3 + seeded(seed + i) * 2) * 0.03;
		return Math.round(end * (drift + (1 - drift) * t) * wobble);
	});
}
