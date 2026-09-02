// Teste pentru clientul Search Console: forma cererii trimise la API și tratarea
// răspunsurilor. API-ul e injectat, deci nu atingem rețeaua.
import { describe, test, expect, mock } from 'bun:test';

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$lib/server/db', () => ({ db: {} }));
mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logWarning: () => {},
	logError: () => {},
	serializeError: (e: unknown) => ({ message: String(e) })
}));
mock.module('$lib/server/gsc/auth', () => ({ getAuthenticatedClient: async () => ({}) }));

const { querySearchAnalytics, listProperties } = await import('../client');

describe('querySearchAnalytics', () => {
	test('cere dimensiunile [query, device, date] pe fereastra dată', async () => {
		let sent: Record<string, unknown> | null = null;
		const rows = await querySearchAnalytics(
			't1',
			'sc-domain:heylux.ro',
			{ startDate: '2026-08-27', endDate: '2026-09-02' },
			{
				api: {
					searchanalytics: {
						query: async (params: Record<string, unknown>) => {
							sent = params;
							return { data: { rows: [{ keys: ['a', 'DESKTOP', '2026-09-01'] }] } };
						}
					}
				} as never
			}
		);
		expect(sent!.siteUrl).toBe('sc-domain:heylux.ro');
		// dublu cast: TS îngustează `sent` la `null` (atribuirea se face într-un closure)
		const body = (sent as unknown as { requestBody: Record<string, unknown> }).requestBody;
		expect(body.dimensions).toEqual(['query', 'device', 'date']);
		expect(body.startDate).toBe('2026-08-27');
		expect(body.endDate).toBe('2026-09-02');
		expect(body.dataState).toBe('all');
		expect(body.rowLimit).toBe(25000);
		expect(rows.length).toBe(1);
	});

	test('răspuns fără rânduri → listă goală, nu undefined', async () => {
		const rows = await querySearchAnalytics(
			't1',
			'sc-domain:x.ro',
			{ startDate: '2026-08-27', endDate: '2026-09-02' },
			{ api: { searchanalytics: { query: async () => ({ data: {} }) } } as never }
		);
		expect(rows).toEqual([]);
	});
});

describe('listProperties', () => {
	test('întoarce doar proprietățile cu permisiune de citire', async () => {
		const props = await listProperties('t1', {
			api: {
				sites: {
					list: async () => ({
						data: {
							siteEntry: [
								{ siteUrl: 'sc-domain:a.ro', permissionLevel: 'siteOwner' },
								{ siteUrl: 'https://b.ro/', permissionLevel: 'siteUnverifiedUser' },
								{ siteUrl: 'sc-domain:c.ro', permissionLevel: 'siteFullUser' }
							]
						}
					})
				}
			} as never
		});
		expect(props).toEqual(['sc-domain:a.ro', 'sc-domain:c.ro']);
	});
});
