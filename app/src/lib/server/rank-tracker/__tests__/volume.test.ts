// Teste pentru reîmprospătarea volumelor de căutare (deps injectate, fără API real).
import { describe, test, expect, mock } from 'bun:test';

await import('$lib/server/db/schema');
mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$lib/server/db', () => ({ db: {} }));
mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logWarning: () => {},
	logError: () => {},
	serializeError: (e: unknown) => ({ message: (e as Error)?.message ?? String(e) })
}));

const { refreshKeywordVolumes } = await import('../volume');
const { processRankVolumeRefresh } = await import('../../scheduler/tasks/rank-volume-refresh');

describe('refreshKeywordVolumes', () => {
	test('fără integrare Google Ads → skip grațios', async () => {
		const r = await refreshKeywordVolumes('t1', {
			loadKeywords: async () => [{ id: 'k1', keyword: 'seo' }],
			fetchVolumes: async () => null,
			saveVolume: async () => {}
		});
		expect(r.skipped).toBe(true);
		expect(r.reason).toContain('Google Ads');
	});

	test('actualizează volumele și bidurile din răspuns (case-insensitive)', async () => {
		const saved: { id: string; vol: number | null; low: number | null; high: number | null }[] = [];
		const r = await refreshKeywordVolumes('t1', {
			loadKeywords: async () => [
				{ id: 'k1', keyword: 'SEO Bucuresti' },
				{ id: 'k2', keyword: 'agentie seo' }
			],
			fetchVolumes: async () =>
				new Map([
					['seo bucuresti', { volume: 1900, cpcLowMicros: 4_155_007, cpcHighMicros: 67_767_750 }],
					['agentie seo', { volume: 480, cpcLowMicros: null, cpcHighMicros: null }]
				]),
			saveVolume: async (id, m) => {
				saved.push({ id, vol: m.volume, low: m.cpcLowMicros, high: m.cpcHighMicros });
			},
			now: () => new Date('2026-09-01T00:00:00Z')
		});
		expect(r.updated).toBe(2);
		expect(saved).toEqual([
			{ id: 'k1', vol: 1900, low: 4_155_007, high: 67_767_750 },
			{ id: 'k2', vol: 480, low: null, high: null }
		]);
	});

	test('fără cuvinte cheie → skip', async () => {
		const r = await refreshKeywordVolumes('t1', { loadKeywords: async () => [] });
		expect(r.skipped).toBe(true);
	});

	test('keyword omis din răspuns → NU se suprascrie (nu se salvează null peste un volum cunoscut)', async () => {
		const saved: (number | null)[] = [];
		const r = await refreshKeywordVolumes('t1', {
			loadKeywords: async () => [{ id: 'k1', keyword: 'necunoscut' }],
			fetchVolumes: async () => new Map(),
			saveVolume: async (_id, m) => {
				saved.push(m.volume);
			}
		});
		expect(saved).toEqual([]); // omis → sărit, volumul anterior rămâne intact
		expect(r.updated).toBe(0);
	});

	test('volum 0 explicit în răspuns → se salvează (0 ≠ omis)', async () => {
		const saved: { id: string; vol: number | null }[] = [];
		await refreshKeywordVolumes('t1', {
			loadKeywords: async () => [{ id: 'k1', keyword: 'nișă rară' }],
			fetchVolumes: async () =>
				new Map([['nișă rară', { volume: 0, cpcLowMicros: null, cpcHighMicros: null }]]),
			saveVolume: async (id, m) => {
				saved.push({ id, vol: m.volume });
			}
		});
		expect(saved).toEqual([{ id: 'k1', vol: 0 }]);
	});
});

describe('processRankVolumeRefresh', () => {
	test('iterează tenanții și însumează actualizările', async () => {
		const r = await processRankVolumeRefresh({
			loadTenants: async () => ['t1', 't2'],
			refresh: async (t) => ({ updated: t === 't1' ? 5 : 3 })
		});
		expect(r.tenants).toBe(2);
		expect(r.updated).toBe(8);
	});

	test('eroarea pe un tenant nu oprește restul', async () => {
		const r = await processRankVolumeRefresh({
			loadTenants: async () => ['t1', 't2'],
			refresh: async (t) => {
				if (t === 't1') throw new Error('API down');
				return { updated: 4 };
			}
		});
		expect(r.updated).toBe(4);
	});
});
