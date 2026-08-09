import { describe, test, expect } from 'bun:test';
import type Stripe from 'stripe';
import {
	STATEMENT_SPECS,
	buildMonthView,
	csvFileName,
	effectiveInterval,
	monthInterval,
	monthKey,
	monthsForYear,
	pickRunForMonth,
	zonedMidnightUnix,
	type ResolvedReportType,
	type StatementKind
} from '../reports';

const HOUR = 3600;

describe('zonedMidnightUnix / monthInterval (Europe/Bucharest)', () => {
	test('iarna e UTC+2 (EET)', () => {
		// 1 ian 2026 00:00 în București == 31 dec 2025 22:00 UTC
		expect(zonedMidnightUnix(2026, 1, 1)).toBe(Date.UTC(2025, 11, 31, 22, 0, 0) / 1000);
	});

	test('vara e UTC+3 (EEST)', () => {
		// 1 iul 2026 00:00 în București == 30 iun 2026 21:00 UTC
		expect(zonedMidnightUnix(2026, 7, 1)).toBe(Date.UTC(2026, 5, 30, 21, 0, 0) / 1000);
	});

	test('luna care conține trecerea la ora de vară are 1 oră mai puțin decât 31 de zile', () => {
		const march = monthInterval(2026, 3);
		expect(march.end - march.start).toBe(31 * 24 * HOUR - HOUR);
	});

	test('luna care conține trecerea la ora de iarnă are 1 oră în plus', () => {
		const october = monthInterval(2026, 10);
		expect(october.end - october.start).toBe(31 * 24 * HOUR + HOUR);
	});

	test('decembrie se închide pe 1 ianuarie anul următor', () => {
		const dec = monthInterval(2026, 12);
		expect(dec.end).toBe(zonedMidnightUnix(2027, 1, 1));
	});

	test('lunile complet în EET au exact numărul de zile', () => {
		const feb = monthInterval(2026, 2);
		expect(feb.end - feb.start).toBe(28 * 24 * HOUR);
	});
});

describe('monthsForYear', () => {
	test('an trecut → toate cele 12 luni', () => {
		expect(monthsForYear(2026, new Date('2027-03-15T10:00:00Z'))).toHaveLength(12);
	});

	test('anul curent → doar până la luna curentă, inclusiv', () => {
		expect(monthsForYear(2026, new Date('2026-08-05T10:00:00Z'))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
	});

	test('an viitor → nicio lună', () => {
		expect(monthsForYear(2027, new Date('2026-08-05T10:00:00Z'))).toEqual([]);
	});
});

describe('monthKey / csvFileName', () => {
	test('cheia de lună e zero-padded', () => {
		expect(monthKey(2026, 7)).toBe('2026-07');
		expect(monthKey(2026, 11)).toBe('2026-11');
	});

	test('numele fișierelor conțin luna și tipul raportului', () => {
		expect(csvFileName('balance_summary', 2026, 7)).toBe('2026-07_balance-summary.csv');
		expect(csvFileName('activity', 2026, 7)).toBe('2026-07_balance-change-from-activity.csv');
		expect(csvFileName('payouts', 2026, 12)).toBe('2026-12_payouts.csv');
	});
});

describe('coloanele cerute de Keez', () => {
	test('activity are exact cele 11 coloane (Default 9 + customer email + name)', () => {
		const activity = STATEMENT_SPECS.find((s) => s.kind === 'activity');
		expect(activity?.columns).toHaveLength(11);
		expect(activity?.columns).toContain('customer_email');
		expect(activity?.columns).toContain('customer_name');
	});

	test('payouts adaugă payout_type peste cele 11 coloane default', () => {
		const payouts = STATEMENT_SPECS.find((s) => s.kind === 'payouts');
		expect(payouts?.columns).toHaveLength(12);
		expect(payouts?.columns).toContain('payout_type');
	});

	test('balance summary lasă setul default (toate cele 4 coloane)', () => {
		expect(STATEMENT_SPECS.find((s) => s.kind === 'balance_summary')?.columns).toBeNull();
	});
});

// ---------------------------------------------------------------------------

const JULY = monthInterval(2026, 7);

function fakeRun(overrides: Partial<Stripe.Reporting.ReportRun> = {}): Stripe.Reporting.ReportRun {
	return {
		id: 'frr_test',
		object: 'reporting.report_run',
		created: 1_760_000_000,
		error: null,
		livemode: true,
		report_type: 'payouts.itemized.5',
		result: null,
		status: 'succeeded',
		succeeded_at: 1_760_000_100,
		parameters: { interval_start: JULY.start, interval_end: JULY.end },
		...overrides
	} as Stripe.Reporting.ReportRun;
}

describe('pickRunForMonth', () => {
	test('ignoră rulările altui raport sau altei luni', () => {
		const runs = [
			fakeRun({ id: 'frr_alt_type', report_type: 'balance.summary.1' }),
			fakeRun({
				id: 'frr_alt_month',
				parameters: { interval_start: JULY.start - 1000, interval_end: JULY.end }
			})
		];
		expect(pickRunForMonth(runs, 'payouts.itemized.5', JULY, true)).toBeNull();
	});

	test('preferă rularea reușită în fața celei eșuate, chiar dacă e mai veche', () => {
		const runs = [
			fakeRun({ id: 'frr_failed', status: 'failed', created: 2_000 }),
			fakeRun({ id: 'frr_ok', status: 'succeeded', created: 1_000 })
		];
		expect(pickRunForMonth(runs, 'payouts.itemized.5', JULY, true)?.id).toBe('frr_ok');
	});

	test('la egalitate de status ia rularea cea mai recentă', () => {
		const runs = [
			fakeRun({ id: 'frr_old', created: 1_000 }),
			fakeRun({ id: 'frr_new', created: 2_000 })
		];
		expect(pickRunForMonth(runs, 'payouts.itemized.5', JULY, true)?.id).toBe('frr_new');
	});

	test('luna încheiată cere potrivire exactă pe capătul intervalului', () => {
		const partial = fakeRun({
			parameters: { interval_start: JULY.start, interval_end: JULY.end - 86_400 }
		});
		expect(pickRunForMonth([partial], 'payouts.itemized.5', JULY, true)).toBeNull();
	});

	test('luna în curs acceptă o rulare parțială (Stripe n-are încă toată luna)', () => {
		const partial = fakeRun({
			id: 'frr_partial',
			parameters: { interval_start: JULY.start, interval_end: JULY.end - 86_400 }
		});
		expect(pickRunForMonth([partial], 'payouts.itemized.5', JULY, false)?.id).toBe('frr_partial');
	});
});

function types(dataAvailableEnd: number | null): Record<StatementKind, ResolvedReportType> {
	return {
		balance_summary: {
			kind: 'balance_summary',
			reportType: 'balance.summary.1',
			dataAvailableStart: Date.UTC(2026, 0, 1) / 1000,
			dataAvailableEnd
		},
		activity: {
			kind: 'activity',
			reportType: 'balance_change_from_activity.itemized.7',
			dataAvailableStart: Date.UTC(2026, 0, 1) / 1000,
			dataAvailableEnd
		},
		payouts: {
			kind: 'payouts',
			reportType: 'payouts.itemized.5',
			dataAvailableStart: Date.UTC(2026, 0, 1) / 1000,
			dataAvailableEnd
		}
	};
}

describe('buildMonthView', () => {
	const nowAugust = Date.UTC(2026, 7, 5) / 1000;

	test('lună fără rulări → toate cele 3 rapoarte lipsesc', () => {
		const view = buildMonthView(2026, 7, [], types(nowAugust), nowAugust);
		expect(view.reports).toHaveLength(3);
		expect(view.reports.every((r) => r.status === 'missing')).toBe(true);
		expect(view.complete).toBe(true);
	});

	test('rularea reușită se propagă cu runId și dimensiunea fișierului', () => {
		const run = fakeRun({
			id: 'frr_ok',
			result: { id: 'file_1', size: 2048 } as Stripe.File
		});
		const view = buildMonthView(2026, 7, [run], types(nowAugust), nowAugust);
		const payouts = view.reports.find((r) => r.kind === 'payouts');
		expect(payouts?.status).toBe('succeeded');
		expect(payouts?.runId).toBe('frr_ok');
		expect(payouts?.fileSize).toBe(2048);
	});

	test('luna curentă nu e „completă” cât timp Stripe n-are date până la finalul ei', () => {
		const view = buildMonthView(2026, 8, [], types(nowAugust), nowAugust);
		expect(view.complete).toBe(false);
	});

	test('lună anterioară datelor disponibile → unavailable, nu missing', () => {
		const early = types(Date.UTC(2026, 5, 1) / 1000);
		const view = buildMonthView(2026, 7, [], early, nowAugust);
		expect(view.reports.every((r) => r.status === 'unavailable')).toBe(true);
	});

	test('rularea eșuată e raportată ca atare, cu motivul de la Stripe', () => {
		const run = fakeRun({ status: 'failed', error: 'boom' });
		const view = buildMonthView(2026, 7, [run], types(nowAugust), nowAugust);
		const payouts = view.reports.find((r) => r.kind === 'payouts');
		expect(payouts?.status).toBe('failed');
		expect(payouts?.error).toBe('boom');
	});
});

describe('effectiveInterval', () => {
	const type = types(null).payouts;

	test('lună încheiată, date complete → intervalul lunii, neatins', () => {
		const full = { ...type, dataAvailableEnd: JULY.end + 86_400 };
		expect(effectiveInterval(JULY, full)).toEqual(JULY);
	});

	test('lună în curs → capătul se taie la ultima zi cu date', () => {
		const partial = { ...type, dataAvailableEnd: JULY.start + 5 * 86_400 };
		expect(effectiveInterval(JULY, partial)).toEqual({
			start: JULY.start,
			end: JULY.start + 5 * 86_400
		});
	});

	test('lună fără niciun fel de date → null (nu chemăm Stripe degeaba)', () => {
		const none = { ...type, dataAvailableEnd: JULY.start };
		expect(effectiveInterval(JULY, none)).toBeNull();
	});

	test('cont mai nou decât luna cerută → intervalul începe de la prima zi cu date', () => {
		const late = {
			...type,
			dataAvailableStart: JULY.start + 10 * 86_400,
			dataAvailableEnd: JULY.end
		};
		expect(effectiveInterval(JULY, late)).toEqual({
			start: JULY.start + 10 * 86_400,
			end: JULY.end
		});
	});
});
