// Motorul adaptiv de rulare a scrapingului — LOGICĂ PURĂ, fără I/O.
// Starea vine din exterior (Redis, prin engine-store.ts) și se întoarce nouă;
// toate deciziile sunt funcții deterministe cu `now`/`jitter` injectabile.
//
// Modelul: un singur „canal de ieșire" (IP-ul nostru sau un proxy) are o stare de
// sănătate. Ritmul reacționează ca în TCP (AIMD): la blocare crește multiplicativ,
// la succese coboară aditiv înapoi spre bază. Blocările repetate deschid un
// cooldown exponențial în care NU rulăm deloc — a insista pe un IP ars nu face
// decât să prelungească arderea.

export interface EngineState {
	/** Ritmul curent între interogări (ms) — crește la blocări, revine la bază prin succese. */
	paceMs: number;
	/** Blocări în epoca curentă (se resetează după 24h fără blocare). */
	blockCount: number;
	lastBlockAt: number | null;
	/** Până când NU rulăm deloc (epoch ms); null = liber. */
	cooldownUntil: number | null;
	/** Interogări consumate azi (cron + manual + reîncercări). */
	queriesToday: number;
	/** Ziua pentru care e valid contorul de mai sus. */
	dayKey: string;
	/** Succese consecutive de la ultima blocare. */
	successStreak: number;
	/** Eșecuri soft consecutive (timeout/parse) — 3+ e semnal de pre-blocare. */
	softFailStreak: number;
}

export interface EngineConfig {
	/** Ritmul de bază (ms) — scraperul doarme oricum atât; motorul adaugă DOAR excedentul. */
	basePaceMs: number;
	maxPaceMs: number;
	/** Cooldown după prima blocare; se dublează la fiecare blocare următoare. */
	cooldownBaseMs: number;
	cooldownMaxMs: number;
	/** Plafonul de interogări pe zi pe acest canal (backstop global, peste bugetele manuale). */
	dailyQueryBudget: number;
	/** După atâtea ms fără blocare, istoricul de blocări se iartă (epocă nouă). */
	blockDecayMs: number;
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
	basePaceMs: 15_000,
	maxPaceMs: 60_000,
	cooldownBaseMs: 30 * 60_000,
	cooldownMaxMs: 8 * 3_600_000,
	dailyQueryBudget: 120,
	blockDecayMs: 24 * 3_600_000
};

export function initialEngineState(dayKey: string, cfg: EngineConfig = DEFAULT_ENGINE_CONFIG): EngineState {
	return {
		paceMs: cfg.basePaceMs,
		blockCount: 0,
		lastBlockAt: null,
		cooldownUntil: null,
		queriesToday: 0,
		dayKey,
		successStreak: 0,
		softFailStreak: 0
	};
}

/** Trecerea într-o zi nouă resetează contorul zilnic (restul stării persistă). */
export function rolloverDay(state: EngineState, dayKey: string): EngineState {
	if (state.dayKey === dayKey) return state;
	return { ...state, dayKey, queriesToday: 0 };
}

export type StartDecision =
	| { ok: true; allowedQueries: number }
	| { ok: false; reason: 'cooldown' | 'budget'; retryAtMs: number };

/**
 * Putem porni o rulare de `queries` interogări acum?
 * - în cooldown → nu, cu momentul exact al reîncercării;
 * - buget epuizat complet → nu, reîncercare la începutul zilei următoare;
 * - buget PARȚIAL → da, dar doar `allowedQueries` (restul se amână — un batch de 26
 *   nu trebuie refuzat în întregime fiindcă mai încap doar 20).
 * `nextDayStartMs` = miezul nopții următor (Europe/Bucharest), calculat de apelant —
 * fără el, reîncercarea la buget ar fi „+24h", adică 23:00 în loc de 00:05.
 */
export function canStartRun(
	state: EngineState,
	queries: number,
	cfg: EngineConfig,
	nowMs: number,
	nextDayStartMs?: number
): StartDecision {
	if (state.cooldownUntil != null && nowMs < state.cooldownUntil) {
		return { ok: false, reason: 'cooldown', retryAtMs: state.cooldownUntil };
	}
	const remaining = cfg.dailyQueryBudget - state.queriesToday;
	if (remaining <= 0) {
		return { ok: false, reason: 'budget', retryAtMs: nextDayStartMs ?? nowMs + 24 * 3_600_000 };
	}
	return { ok: true, allowedQueries: Math.min(queries, remaining) };
}

/**
 * Excedentul de așteptare peste ritmul de bază (scraperul doarme deja baza+jitter).
 * 0 când suntem sănătoși; crește după blocări până revenim la bază prin succese.
 */
export function extraDelayMs(state: EngineState, cfg: EngineConfig): number {
	return Math.max(0, state.paceMs - cfg.basePaceMs);
}

/**
 * O interogare a reușit: contorizează și relaxează ritmul spre bază.
 * Recuperare în două trepte (review extern: −2% per succes însemna ~150 de succese
 * de la plafon la bază — mai mult decât încape într-o zi): −5% din bază la început,
 * −15% după 20 de succese consecutive (streak-ul dovedit sănătos accelerează).
 */
export function onSuccess(state: EngineState, cfg: EngineConfig): EngineState {
	const successStreak = state.successStreak + 1;
	const step = Math.round(cfg.basePaceMs * (successStreak >= 20 ? 0.15 : 0.05));
	return {
		...state,
		queriesToday: state.queriesToday + 1,
		successStreak,
		softFailStreak: 0,
		paceMs: Math.max(cfg.basePaceMs, state.paceMs - step)
	};
}

/**
 * O interogare a eșuat fără blocare (timeout/parse). 3 eșecuri soft CONSECUTIVE sunt
 * adesea preludiul unui CAPTCHA — ritmul urcă preventiv ×1.3, mai blând decât la
 * blocarea propriu-zisă, și streak-ul se resetează.
 */
export function onFailure(state: EngineState, cfg: EngineConfig): EngineState {
	const softFailStreak = state.softFailStreak + 1;
	const preBlock = softFailStreak >= 3;
	return {
		...state,
		queriesToday: state.queriesToday + 1,
		successStreak: 0,
		softFailStreak: preBlock ? 0 : softFailStreak,
		paceMs: preBlock ? Math.min(cfg.maxPaceMs, Math.round(state.paceMs * 1.3)) : state.paceMs
	};
}

/**
 * Google ne-a blocat: ritmul urcă multiplicativ (×1.6, plafonat) și se deschide un
 * cooldown exponențial — 30 min la prima blocare, dublat la fiecare următoare, cap 8h.
 * Blocările mai vechi de `blockDecayMs` se iartă întâi (epocă nouă).
 */
export function onBlock(state: EngineState, cfg: EngineConfig, nowMs: number): EngineState {
	const decayed =
		state.lastBlockAt != null && nowMs - state.lastBlockAt > cfg.blockDecayMs
			? { ...state, blockCount: 0, paceMs: cfg.basePaceMs } // epocă nouă = și ritm nou
			: state;
	const blockCount = decayed.blockCount + 1;
	const cooldown = Math.min(cfg.cooldownMaxMs, cfg.cooldownBaseMs * 2 ** (blockCount - 1));
	return {
		...decayed,
		blockCount,
		lastBlockAt: nowMs,
		cooldownUntil: nowMs + cooldown,
		successStreak: 0,
		softFailStreak: 0,
		paceMs: Math.min(cfg.maxPaceMs, Math.round(decayed.paceMs * 1.6))
	};
}

/** Overhead mediu al unei interogări dincolo de pauză (navigare + parse + paginare). */
const QUERY_OVERHEAD_MS = 9_000;
/** Pauzele „de cafea" din scraper: ~una la 10 interogări, în medie ~67 s. */
const BREAK_EVERY = 10;
const BREAK_AVG_MS = 67_500;

/**
 * Estimarea duratei unei rulări de `queries` interogări la ritmul curent — folosită
 * la planificarea ferestrelor zilnice. Jitterul e pace..2×pace, deci media e 1.5×pace.
 */
export function estimateRunMs(queries: number, state: EngineState): number {
	if (queries <= 0) return 0;
	const perQuery = state.paceMs * 1.5 + QUERY_OVERHEAD_MS;
	const breaks = Math.floor(queries / BREAK_EVERY) * BREAK_AVG_MS;
	return Math.round(queries * perQuery + breaks);
}

export interface WindowPlan {
	/** Întârzierea de pornire a fiecărui proiect față de ora cronului (ms), în ordinea dată. */
	delaysMs: number[];
	/** Durata totală estimată a zilei de scraping (ms). */
	totalMs: number;
}

/**
 * Planifică ferestrele zilei: proiectele pornesc PE RÂND, fiecare după durata estimată
 * a celui dinainte plus o gaură de răcire. Scalează cu numărul de cuvinte: un proiect
 * de 200 de cuvinte împinge automat următoarele mai târziu — nu mai e nevoie de pas fix.
 */
export function planWindows(
	projectQueries: number[],
	state: EngineState,
	gapMs: number
): WindowPlan {
	const delaysMs: number[] = [];
	let cursor = 0;
	for (const queries of projectQueries) {
		delaysMs.push(cursor);
		cursor += estimateRunMs(queries, state) + gapMs;
	}
	return { delaysMs, totalMs: Math.max(0, cursor - gapMs) };
}
