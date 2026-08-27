import { describe, test, expect, mock } from 'bun:test';

/**
 * Agregarea spend-ului de ads pe (lună, platformă) pentru pagina KPI Performanță.
 * Partea pură (`aggregateSpend`) e testată fără DB; conversia valutară folosește
 * cursul BNR de la sfârșitul lunii (plafonat la azi pentru luna curentă).
 */

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$env/dynamic/public', () => ({ env: {} }));
// eager-load schema reală înainte de mock-uri (vezi interviuri-client-assoc.test.ts)
await import('$lib/server/db/schema');
mock.module('$lib/server/db', () => ({ db: {} }));
mock.module('$lib/server/bnr/client', () => ({
	loadBnrFxRates: async () => ({}),
	getLatestBnrRate: async () => null
}));

const { aggregateSpend, fxRateDateFor } = await import('$lib/server/interviuri/kpi-data');

const TODAY = '2026-08-27';
const fx = {
	'2026-03-31': { USD: { ronPerUnit: 4.5, rateDate: '2026-03-31' } },
	[TODAY]: { USD: { ronPerUnit: 4.6, rateDate: TODAY } }
};

describe('aggregateSpend', () => {
	test('RON direct din cenți, pe lună și platformă; conturi multiple se adună', () => {
		const { months } = aggregateSpend(
			[
				{ platform: 'tiktok', periodStart: '2026-03-01', periodEnd: '2026-03-31', spendCents: 100050, currencyCode: 'RON' },
				{ platform: 'tiktok', periodStart: '2026-03-01', periodEnd: '2026-03-31', spendCents: 50, currencyCode: 'RON' },
				{ platform: 'meta', periodStart: '2026-04-01', periodEnd: '2026-04-30', spendCents: 200, currencyCode: 'RON' }
			],
			2026,
			fx,
			TODAY
		);
		expect(months).toEqual([
			{ monthNum: 3, spend: { tiktok: 1001, google: 0, meta: 0 } },
			{ monthNum: 4, spend: { tiktok: 0, google: 0, meta: 2 } }
		]);
	});
	test('USD → RON la cursul de la sfârșitul lunii; luna curentă folosește azi', () => {
		const { months, warnings } = aggregateSpend(
			[
				{ platform: 'google', periodStart: '2026-03-01', periodEnd: '2026-03-31', spendCents: 10000, currencyCode: 'USD' },
				{ platform: 'google', periodStart: '2026-08-01', periodEnd: '2026-08-31', spendCents: 10000, currencyCode: 'USD' }
			],
			2026,
			fx,
			TODAY
		);
		expect(months[0].spend.google).toBeCloseTo(450, 6);
		expect(months[1].spend.google).toBeCloseTo(460, 6);
		expect(warnings).toEqual([]);
	});
	test('curs lipsă, fără fallback → suma e exclusă și raportată', () => {
		const { months, warnings } = aggregateSpend(
			[{ platform: 'google', periodStart: '2026-01-01', periodEnd: '2026-01-31', spendCents: 10000, currencyCode: 'EUR' }],
			2026,
			fx,
			TODAY
		);
		expect(months).toEqual([]);
		expect(warnings).toEqual([{ platform: 'google', month: '2026-01', currency: 'EUR', approx: false }]);
	});
	test('curs lipsă la dată, dar cu cel mai recent curs disponibil → convertit și marcat „aproximat"', () => {
		const { months, warnings } = aggregateSpend(
			[{ platform: 'google', periodStart: '2026-01-01', periodEnd: '2026-01-31', spendCents: 10000, currencyCode: 'USD' }],
			2026,
			fx,
			TODAY,
			{ USD: 4.7 }
		);
		expect(months[0].spend.google).toBeCloseTo(470, 6);
		expect(warnings).toEqual([{ platform: 'google', month: '2026-01', currency: 'USD', approx: true }]);
	});
	test('rândurile din alt an sunt ignorate', () => {
		const { months } = aggregateSpend(
			[{ platform: 'meta', periodStart: '2025-12-01', periodEnd: '2025-12-31', spendCents: 100, currencyCode: 'RON' }],
			2026,
			fx,
			TODAY
		);
		expect(months).toEqual([]);
	});
	test('fxRateDateFor plafonează la azi', () => {
		expect(fxRateDateFor('2026-08-31', TODAY)).toBe(TODAY);
		expect(fxRateDateFor('2026-03-31', TODAY)).toBe('2026-03-31');
	});
});
