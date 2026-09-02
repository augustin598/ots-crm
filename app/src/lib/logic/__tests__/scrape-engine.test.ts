// Teste pentru motorul adaptiv de scraping — logică pură, fără I/O.
import { describe, test, expect } from 'bun:test';
import {
	DEFAULT_ENGINE_CONFIG,
	canStartRun,
	estimateRunMs,
	extraDelayMs,
	initialEngineState,
	onBlock,
	onFailure,
	onSuccess,
	planWindows,
	rolloverDay
} from '../scrape-engine';

const cfg = DEFAULT_ENGINE_CONFIG;
const NOW = 1_756_800_000_000;

describe('AIMD — ritmul reacționează la blocări și se relaxează la succese', () => {
	test('blocarea urcă ritmul ×1.6, plafonat la max', () => {
		let s = initialEngineState('2026-09-02', cfg);
		s = onBlock(s, cfg, NOW);
		expect(s.paceMs).toBe(24_000);
		s = onBlock(s, cfg, NOW + 1000);
		expect(s.paceMs).toBe(38_400);
		for (let i = 0; i < 10; i++) s = onBlock(s, cfg, NOW + 2000 + i);
		expect(s.paceMs).toBe(cfg.maxPaceMs); // plafon
	});

	test('succesele coboară ritmul înapoi spre bază, nu sub ea', () => {
		let s = onBlock(initialEngineState('2026-09-02', cfg), cfg, NOW);
		const elevated = s.paceMs;
		s = onSuccess(s, cfg);
		expect(s.paceMs).toBeLessThan(elevated);
		for (let i = 0; i < 500; i++) s = onSuccess(s, cfg);
		expect(s.paceMs).toBe(cfg.basePaceMs); // nu coboară sub bază
	});

	test('extraDelayMs = doar excedentul peste bază (scraperul doarme deja baza)', () => {
		const fresh = initialEngineState('2026-09-02', cfg);
		expect(extraDelayMs(fresh, cfg)).toBe(0);
		const blocked = onBlock(fresh, cfg, NOW);
		expect(extraDelayMs(blocked, cfg)).toBe(24_000 - cfg.basePaceMs);
	});
});

describe('cooldown exponențial cu iertare', () => {
	test('30 min → 1h → 2h, plafonat la 8h', () => {
		let s = initialEngineState('2026-09-02', cfg);
		s = onBlock(s, cfg, NOW);
		expect(s.cooldownUntil).toBe(NOW + 30 * 60_000);
		s = onBlock(s, cfg, NOW + 1000);
		expect(s.cooldownUntil).toBe(NOW + 1000 + 60 * 60_000);
		for (let i = 0; i < 8; i++) s = onBlock(s, cfg, NOW + 2000 + i);
		expect(s.cooldownUntil! - (NOW + 2000 + 7)).toBe(cfg.cooldownMaxMs);
	});

	test('blocările mai vechi de 24h se iartă — cooldown-ul reîncepe de la bază', () => {
		let s = onBlock(initialEngineState('2026-09-02', cfg), cfg, NOW);
		s = onBlock(s, cfg, NOW + 1000);
		expect(s.blockCount).toBe(2);
		const later = NOW + 25 * 3_600_000;
		s = onBlock(s, cfg, later);
		expect(s.blockCount).toBe(1);
		expect(s.cooldownUntil).toBe(later + cfg.cooldownBaseMs);
	});

	test('canStartRun refuză în cooldown, cu momentul reîncercării', () => {
		const s = onBlock(initialEngineState('2026-09-02', cfg), cfg, NOW);
		const d = canStartRun(s, 26, cfg, NOW + 60_000);
		expect(d.ok).toBe(false);
		if (!d.ok) {
			expect(d.reason).toBe('cooldown');
			expect(d.retryAtMs).toBe(s.cooldownUntil!);
		}
		expect(canStartRun(s, 26, cfg, s.cooldownUntil! + 1).ok).toBe(true);
	});
});

describe('bugetul zilnic', () => {
	test('buget PARȚIAL: batch-ul se taie la ce mai încape, nu se refuză integral', () => {
		let s = initialEngineState('2026-09-02', cfg);
		for (let i = 0; i < 100; i++) s = onSuccess(s, cfg);
		expect(s.queriesToday).toBe(100);
		const d = canStartRun(s, 26, cfg, NOW); // mai încap doar 20 din 120
		expect(d.ok).toBe(true);
		if (d.ok) expect(d.allowedQueries).toBe(20);
	});

	test('buget epuizat complet → refuz cu reîncercare la începutul zilei următoare', () => {
		let s = initialEngineState('2026-09-02', cfg);
		for (let i = 0; i < 120; i++) s = onSuccess(s, cfg);
		const midnight = NOW + 5 * 3_600_000;
		const d = canStartRun(s, 5, cfg, NOW, midnight);
		expect(d.ok).toBe(false);
		if (!d.ok) {
			expect(d.reason).toBe('budget');
			expect(d.retryAtMs).toBe(midnight); // miezul nopții dat de apelant, nu +24h
		}
		const tomorrow = rolloverDay(s, '2026-09-03');
		expect(tomorrow.queriesToday).toBe(0);
		expect(canStartRun(tomorrow, 26, cfg, NOW).ok).toBe(true);
	});

	test('eșecurile soft contorizează bugetul; 3 consecutive urcă ritmul preventiv', () => {
		let s = initialEngineState('2026-09-02', cfg);
		s = onFailure(s, cfg);
		expect(s.queriesToday).toBe(1);
		expect(s.successStreak).toBe(0);
		expect(s.paceMs).toBe(cfg.basePaceMs); // 1-2 eșecuri nu schimbă ritmul
		s = onFailure(s, cfg);
		s = onFailure(s, cfg); // al 3-lea consecutiv = semnal de pre-blocare
		expect(s.paceMs).toBe(Math.round(cfg.basePaceMs * 1.3));
	});

	test('recuperarea accelerează după 20 de succese consecutive', () => {
		// 4 blocări → ritm la plafon (60 s), ca faza rapidă să nu lovească podeaua de bază.
		let s = initialEngineState('2026-09-02', cfg);
		for (let i = 0; i < 4; i++) s = onBlock(s, cfg, NOW + i);
		const before = s.paceMs;
		for (let i = 0; i < 19; i++) s = onSuccess(s, cfg);
		const slowPhase = before - s.paceMs; // 19 pași mici (5%)
		const at19 = s.paceMs;
		for (let i = 0; i < 19; i++) s = onSuccess(s, cfg);
		const fastPhase = at19 - s.paceMs; // pași mari (15%) după prag
		expect(fastPhase).toBeGreaterThan(slowPhase);
	});

	test('iertarea epocii resetează ȘI ritmul, nu doar contorul de blocări', () => {
		let s = onBlock(onBlock(initialEngineState('2026-09-02', cfg), cfg, NOW), cfg, NOW + 1);
		expect(s.paceMs).toBeGreaterThan(cfg.basePaceMs);
		s = onBlock(s, cfg, NOW + 25 * 3_600_000); // epocă nouă
		// ritmul a repornit de la bază înainte de penalizarea noii blocări
		expect(s.paceMs).toBe(Math.round(cfg.basePaceMs * 1.6));
	});
});

describe('planificarea ferestrelor', () => {
	test('proiectele pornesc pe rând: fiecare după durata estimată a celui dinainte + gaura', () => {
		const s = initialEngineState('2026-09-02', cfg);
		const gap = 45 * 60_000;
		const plan = planWindows([26, 26, 26], s, gap);
		expect(plan.delaysMs[0]).toBe(0);
		expect(plan.delaysMs[1]).toBe(estimateRunMs(26, s) + gap);
		expect(plan.delaysMs[2]).toBe(2 * (estimateRunMs(26, s) + gap));
	});

	test('scalează cu numărul de cuvinte: un proiect mare împinge următoarele mai târziu', () => {
		const s = initialEngineState('2026-09-02', cfg);
		const small = planWindows([10, 10], s, 0);
		const big = planWindows([200, 10], s, 0);
		expect(big.delaysMs[1]).toBeGreaterThan(small.delaysMs[1]);
	});

	test('estimarea crește când ritmul e ridicat după blocări', () => {
		const fresh = initialEngineState('2026-09-02', cfg);
		const blocked = onBlock(fresh, cfg, NOW);
		expect(estimateRunMs(26, blocked)).toBeGreaterThan(estimateRunMs(26, fresh));
	});
});
