// Persistarea stării motorului de scraping (o stare per canal de ieșire — IP-ul
// nostru sau un proxy). Starea e partajată de toate rulările și instanțele prin
// Redis; logica deciziilor e în $lib/logic/scrape-engine.ts (pură, testată separat).
import { env } from '$env/dynamic/private';
import { getRedis } from '$lib/server/redis';
import { rankDayKey } from '$lib/logic/rank-tracker';
import {
	DEFAULT_ENGINE_CONFIG,
	initialEngineState,
	rolloverDay,
	type EngineConfig,
	type EngineState
} from '$lib/logic/scrape-engine';

/** Canalul implicit; când vor exista proxy-uri, fiecare primește starea lui. */
const DEFAULT_EGRESS = 'direct';

function engineKey(egress: string): string {
	return `rank:engine:${egress}`;
}

/** Configurația motorului, cu bazele din env (aceleași variabile ca scraperul). */
export function engineConfig(): EngineConfig {
	const base = Number(env.RANK_PACE_MS ?? DEFAULT_ENGINE_CONFIG.basePaceMs) || DEFAULT_ENGINE_CONFIG.basePaceMs;
	return {
		...DEFAULT_ENGINE_CONFIG,
		basePaceMs: base,
		maxPaceMs: Math.max(base * 4, DEFAULT_ENGINE_CONFIG.maxPaceMs),
		dailyQueryBudget:
			Number(env.RANK_DAILY_QUERY_BUDGET ?? DEFAULT_ENGINE_CONFIG.dailyQueryBudget) ||
			DEFAULT_ENGINE_CONFIG.dailyQueryBudget
	};
}

/** Încarcă starea (cu rollover de zi); stare proaspătă dacă nu există sau e coruptă. */
export async function loadEngineState(
	now: Date = new Date(),
	egress: string = DEFAULT_EGRESS
): Promise<EngineState> {
	const dayKey = rankDayKey(now);
	try {
		const raw = await getRedis().get(engineKey(egress));
		if (!raw) return initialEngineState(dayKey, engineConfig());
		return rolloverDay(JSON.parse(raw) as EngineState, dayKey);
	} catch {
		return initialEngineState(dayKey, engineConfig());
	}
}

export async function saveEngineState(
	state: EngineState,
	egress: string = DEFAULT_EGRESS
): Promise<void> {
	// TTL 14 zile: starea moare singură dacă modulul e oprit.
	await getRedis().set(engineKey(egress), JSON.stringify(state), 'EX', 14 * 24 * 3600);
}
