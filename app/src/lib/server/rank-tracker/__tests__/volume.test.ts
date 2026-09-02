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

	test('actualizează volumele din răspuns (case-insensitive)', async () => {
		const saved: { id: string; vol: number | null }[] = [];
		const r = await refreshKeywordVolumes('t1', {
			loadKeywords: async () => [
				{ id: 'k1', keyword: 'SEO Bucuresti' },
				{ id: 'k2', keyword: 'agentie seo' }
			],
			fetchVolumes: async () => new Map([['seo bucuresti', 1900], ['agentie seo', 480]]),
			saveVolume: async (id, vol) => {
				saved.push({ id, vol });
			},
			now: () => new Date('2026-09-01T00:00:00Z')
		});
		expect(r.updated).toBe(2);
		expect(saved).toEqual([{ id: 'k1', vol: 1900 }, { id: 'k2', vol: 480 }]);
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
			saveVolume: async (_id, vol) => {
				saved.push(vol);
			}
		});
		expect(saved).toEqual([]); // omis → sărit, volumul anterior rămâne intact
		expect(r.updated).toBe(0);
	});

	test('volum 0 explicit în răspuns → se salvează (0 ≠ omis)', async () => {
		const saved: { id: string; vol: number | null }[] = [];
		await refreshKeywordVolumes('t1', {
			loadKeywords: async () => [{ id: 'k1', keyword: 'nișă rară' }],
			fetchVolumes: async () => new Map([['nișă rară', 0]]),
			saveVolume: async (id, vol) => {
				saved.push({ id, vol });
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
