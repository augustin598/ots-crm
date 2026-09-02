// Teste pentru jobul de tragere GSC. Toate dependențele sunt injectate (tiparul
// `RankDailyDeps` din rank-daily-check) — fără DB, fără rețea.
import { describe, test, expect, mock } from 'bun:test';

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$lib/server/db', () => ({ db: {} }));
mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logWarning: () => {},
	logError: () => {},
	serializeError: (e: unknown) => ({ message: String(e) })
}));

import type { GscDailyRow } from '../gsc-daily-pull';

const { processGscDailyPull } = await import('../gsc-daily-pull');

const baseDeps = () => ({
	now: () => new Date('2026-09-02T08:00:00Z'),
	loadIntegrations: async () => [{ tenantId: 't1' }],
	loadProjects: async () => [{ id: 'p1', gscProperty: 'sc-domain:heylux.ro' }],
	loadKeywords: async () => [
		{ id: 'k1', keyword: 'videochat iasi' },
		{ id: 'k2', keyword: 'studio videochat' }
	],
	queryGsc: async () => [
		{
			keys: ['videochat iasi', 'DESKTOP', '2026-09-01'],
			clicks: 3,
			impressions: 120,
			ctr: 0.025,
			position: 8.2
		},
		{
			keys: ['cuvant neurmarit', 'DESKTOP', '2026-09-01'],
			clicks: 1,
			impressions: 5,
			ctr: 0.2,
			position: 3
		}
	],
	saveRows: async () => {},
	markSynced: async () => {}
});

describe('processGscDailyPull', () => {
	test('scrie doar rândurile care se potrivesc cu cuvintele urmărite', async () => {
		const saved: GscDailyRow[] = [];
		const result = await processGscDailyPull({
			...baseDeps(),
			saveRows: async (rows) => {
				saved.push(...rows);
			}
		});
		expect(saved.length).toBe(1);
		expect(saved[0]).toMatchObject({
			keywordId: 'k1',
			device: 'desktop',
			gscDate: '2026-09-01',
			clicks: 3,
			impressions: 120,
			position: 8.2
		});
		expect(result).toMatchObject({ tenants: 1, properties: 1, rowsSaved: 1 });
	});

	test('potrivirea ignoră majusculele și spațiile duble', async () => {
		const saved: GscDailyRow[] = [];
		await processGscDailyPull({
			...baseDeps(),
			loadKeywords: async () => [{ id: 'k9', keyword: 'Studio   Videochat' }],
			queryGsc: async () => [
				{
					keys: ['studio videochat', 'MOBILE', '2026-09-01'],
					clicks: 0,
					impressions: 9,
					ctr: 0,
					position: 22
				}
			],
			saveRows: async (rows) => {
				saved.push(...rows);
			}
		});
		expect(saved.length).toBe(1);
		expect(saved[0]).toMatchObject({ keywordId: 'k9', device: 'mobile' });
	});

	test('proiect fără proprietate configurată → sărit, fără apel la API', async () => {
		let called = 0;
		const result = await processGscDailyPull({
			...baseDeps(),
			loadProjects: async () => [{ id: 'p1', gscProperty: null }],
			queryGsc: async () => {
				called++;
				return [];
			}
		});
		expect(called).toBe(0);
		expect(result).toMatchObject({ properties: 0, rowsSaved: 0 });
	});

	test('o proprietate care crapă NU oprește restul cozii', async () => {
		const saved: GscDailyRow[] = [];
		const result = await processGscDailyPull({
			...baseDeps(),
			loadProjects: async () => [
				{ id: 'p1', gscProperty: 'sc-domain:rupt.ro' },
				{ id: 'p2', gscProperty: 'sc-domain:heylux.ro' }
			],
			queryGsc: async (_t, property) => {
				if (property.includes('rupt')) throw new Error('403 insufficient permissions');
				return [
					{
						keys: ['videochat iasi', 'DESKTOP', '2026-09-01'],
						clicks: 1,
						impressions: 10,
						ctr: 0.1,
						position: 5
					}
				];
			},
			saveRows: async (rows) => {
				saved.push(...rows);
			}
		});
		expect(saved.length).toBe(1);
		expect(result.failed).toBe(1);
	});

	test('fără integrări active → iese curat', async () => {
		const result = await processGscDailyPull({
			...baseDeps(),
			loadIntegrations: async () => []
		});
		expect(result).toMatchObject({ tenants: 0, properties: 0, rowsSaved: 0, failed: 0 });
	});
});
