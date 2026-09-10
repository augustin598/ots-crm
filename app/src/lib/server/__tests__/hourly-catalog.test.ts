import { describe, test, expect, mock, beforeEach } from 'bun:test';

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$env/dynamic/public', () => ({ env: {} }));
mock.module('$env/static/public', () => ({}));

mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logError: () => {},
	logWarning: () => {},
	serializeError: (e: unknown) => ({ message: e instanceof Error ? e.message : String(e) })
}));
mock.module('$lib/server/plugins/keez/db-retry', () => ({
	withTursoBusyRetry: (op: () => Promise<unknown>) => op()
}));

const schema = await import('$lib/server/db/schema');

let rateRows: any[] = [];
let modeRows: any[] = [];
let rulesRows: any[] = [];
let inserted: Array<{ table: unknown; rows: any[] }> = [];

function rowsFor(t: unknown): any[] {
	if (t === schema.hourlyRate) return rateRows;
	if (t === schema.hourlyRateMode) return modeRows;
	if (t === schema.hourCreditSettings) return rulesRows;
	throw new Error('tabel neașteptat în test');
}

mock.module('$lib/server/db', () => ({
	db: {
		select: () => ({
			from: (t: unknown) => ({
				where: async () => rowsFor(t)
			})
		}),
		insert: (t: unknown) => ({
			values: (rows: any[]) => ({
				onConflictDoNothing: async () => {
					inserted.push({ table: t, rows });
					rowsFor(t).push(...rows);
				}
			})
		})
	}
}));

const { getHourlyCatalog } = await import('../hourly-catalog');
const { HOURLY_RATES, RATE_MODES } = await import('$lib/constants/ots-catalog');

beforeEach(() => {
	rateRows = [];
	modeRows = [];
	rulesRows = [];
	inserted = [];
});

describe('getHourlyCatalog — seed lazy', () => {
	test('tenant fără rânduri → inserează constantele și le returnează', async () => {
		const catalog = await getHourlyCatalog('t1');
		expect(inserted).toHaveLength(2);
		expect(inserted[0].table).toBe(schema.hourlyRate);
		expect(inserted[0].rows).toHaveLength(HOURLY_RATES.length);
		expect(inserted[0].rows.every((r) => r.tenantId === 't1')).toBe(true);
		expect(
			inserted[0].rows.every((r) => r.createdAt instanceof Date && r.updatedAt instanceof Date)
		).toBe(true);
		expect(inserted[1].table).toBe(schema.hourlyRateMode);
		expect(inserted[1].rows).toHaveLength(RATE_MODES.length);

		expect(catalog.rates.map((r) => [r.slug, r.rateEur])).toEqual(
			HOURLY_RATES.map((r) => [r.slug, r.rate])
		);
		expect(catalog.modes.map((m) => [m.slug, m.multiplierPct, m.maxHours])).toEqual(
			RATE_MODES.map((m) => [m.slug, m.multiplierPct, m.maxHours])
		);
		expect(catalog.rules).toEqual({
			referenceRateSlug: null,
			lowCreditThresholdMinutes: 120,
			stepMinutes: 15,
			notifyEmail: true,
			notifyWhatsapp: true
		});
	});

	test('tenant cu rânduri → nu inserează nimic, nu returnează inactive by default', async () => {
		rateRows = [
			{
				id: 'a',
				tenantId: 't1',
				slug: 'development',
				label: 'Dev',
				rateEur: 70,
				sortOrder: 1,
				isActive: true
			},
			{
				id: 'b',
				tenantId: 't1',
				slug: 'qa',
				label: 'QA',
				rateEur: 40,
				sortOrder: 0,
				isActive: false
			}
		];
		modeRows = [
			{
				id: 'm',
				tenantId: 't1',
				slug: 'standard',
				label: 'Standard',
				suffix: '',
				description: '',
				sla: '',
				multiplierPct: 100,
				maxHours: 100,
				sortOrder: 0,
				isActive: true
			},
			{
				id: 'n',
				tenantId: 't1',
				slug: 'night',
				label: 'Noapte',
				suffix: 'Noapte',
				description: '',
				sla: '',
				multiplierPct: 200,
				maxHours: 16,
				sortOrder: 3,
				isActive: false
			}
		];
		rulesRows = [
			{
				id: 's',
				tenantId: 't1',
				referenceRateSlug: 'development',
				lowCreditThresholdMinutes: 60,
				stepMinutes: 30,
				notifyEmail: false,
				notifyWhatsapp: true
			}
		];

		const catalog = await getHourlyCatalog('t1');
		expect(inserted).toHaveLength(0);
		expect(catalog.rates.map((r) => r.slug)).toEqual(['development']);
		expect(catalog.modes.map((m) => m.slug)).toEqual(['standard']);
		expect(catalog.rules).toEqual({
			referenceRateSlug: 'development',
			lowCreditThresholdMinutes: 60,
			stepMinutes: 30,
			notifyEmail: false,
			notifyWhatsapp: true
		});

		const all = await getHourlyCatalog('t1', { includeInactive: true });
		expect(all.rates.map((r) => r.slug)).toEqual(['qa', 'development']);
		expect(all.modes.map((m) => m.slug)).toEqual(['standard', 'night']);
	});

	test('rândurile de regim cu slug necunoscut sunt ignorate', async () => {
		rateRows = [
			{
				id: 'a',
				tenantId: 't1',
				slug: 'development',
				label: 'Dev',
				rateEur: 65,
				sortOrder: 0,
				isActive: true
			}
		];
		modeRows = [
			{
				id: 'm',
				tenantId: 't1',
				slug: 'standard',
				label: 'Standard',
				suffix: '',
				description: '',
				sla: '',
				multiplierPct: 100,
				maxHours: 100,
				sortOrder: 0,
				isActive: true
			},
			{
				id: 'x',
				tenantId: 't1',
				slug: 'holiday',
				label: '?',
				suffix: '',
				description: '',
				sla: '',
				multiplierPct: 300,
				maxHours: 8,
				sortOrder: 9,
				isActive: true
			}
		];
		const catalog = await getHourlyCatalog('t1');
		expect(catalog.modes.map((m) => m.slug)).toEqual(['standard']);
	});
});
