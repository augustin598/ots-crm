import { describe, test, expect } from 'bun:test';
import {
	parseDeclaredPeriods,
	periodsOverlap,
	assessCoverage,
	type InvoiceEvidence
} from '../billing-coverage';

const inv = (over: Partial<InvoiceEvidence>): InvoiceEvidence => ({
	invoiceNumber: 'OTS 1',
	issueDate: '2025-07-16',
	status: 'paid',
	linkedToAccount: false,
	identifiesAccount: true,
	text: '',
	...over
});

describe('parseDeclaredPeriods', () => {
	test('parses the Keez note form with slashes and a URL', () => {
		expect(
			parseDeclaredPeriods('Wordpress Standard - https://yards.ro - (09/03/2025 - 09/03/2027)')
		).toEqual([{ start: '2025-03-09', end: '2027-03-09' }]);
	});

	test('parses the CRM description form', () => {
		expect(
			parseDeclaredPeriods('Wordpress_Gold - centrale-lemne-liepsnele.ro (22/04/2026 - 21/04/2027)')
		).toEqual([{ start: '2026-04-22', end: '2027-04-21' }]);
	});

	test('parses the dot-separated form', () => {
		expect(parseDeclaredPeriods('Wordpress_Standard - polytechrubber.ro (perioada 30.12.2025 - 29.12.2026)')).toEqual([
			{ start: '2025-12-30', end: '2026-12-29' }
		]);
	});

	test('ignores same-day pseudo-periods and text without periods', () => {
		expect(parseDeclaredPeriods('yards.ro - 19.12.2023 - 19.12.2023 ')).toEqual([]);
		expect(parseDeclaredPeriods('Web Hosting -')).toEqual([]);
		expect(parseDeclaredPeriods(null)).toEqual([]);
	});
});

describe('periodsOverlap', () => {
	test('half-open ranges: touching ends do not overlap', () => {
		expect(
			periodsOverlap({ start: '2025-01-08', end: '2026-01-08' }, { start: '2026-01-08', end: '2027-01-08' })
		).toBe(false);
	});
	test('containment overlaps', () => {
		expect(
			periodsOverlap({ start: '2025-03-09', end: '2027-03-09' }, { start: '2026-01-08', end: '2027-01-08' })
		).toBe(true);
	});
});

describe('assessCoverage', () => {
	test('THE YARDS REGRESSION: a 2-year prepay covers the gap the issue date would have missed', () => {
		// OTS 477 issued 2025-07-16 — 6 months away from the 2026-01-08 gap start, so
		// issue-date proximity called this gap unbilled and re-billed a paid year.
		const verdict = assessCoverage({ start: '2026-01-08', end: '2027-01-08' }, [
			inv({
				invoiceNumber: 'OTS 477',
				issueDate: '2025-07-16',
				text: 'Hosting | Wordpress Standard - https://yards.ro - (09/03/2025 - 09/03/2027)'
			})
		]);
		expect(verdict.covered).toBe(true);
		if (verdict.covered) {
			expect(verdict.by.invoiceNumber).toBe('OTS 477');
			expect(verdict.declared).toEqual({ start: '2025-03-09', end: '2027-03-09' });
		}
	});

	test('period-less invoice near the gap is UNCERTAIN, never auto-billable', () => {
		const verdict = assessCoverage({ start: '2025-04-22', end: '2026-04-22' }, [
			inv({ invoiceNumber: 'OTS 465', issueDate: '2025-04-27', text: 'Web Hosting -' })
		]);
		expect(verdict.covered).toBe(false);
		if (!verdict.covered) {
			expect(verdict.certainty).toBe('uncertain');
			if (verdict.certainty === 'uncertain') expect(verdict.near[0].invoiceNumber).toBe('OTS 465');
		}
	});

	test('declared periods that all miss the gap → certainly uncovered', () => {
		const verdict = assessCoverage({ start: '2027-03-09', end: '2028-03-09' }, [
			inv({ text: 'Wordpress Standard - https://yards.ro - (09/03/2025 - 09/03/2027)' })
		]);
		expect(verdict.covered).toBe(false);
		if (!verdict.covered) expect(verdict.certainty).toBe('certain');
	});

	test('no invoices at all → certainly uncovered', () => {
		const verdict = assessCoverage({ start: '2026-04-22', end: '2027-04-22' }, []);
		expect(verdict.covered).toBe(false);
		if (!verdict.covered) expect(verdict.certainty).toBe('certain');
	});

	test('a period-less invoice issued long before the gap does not make it uncertain', () => {
		const verdict = assessCoverage({ start: '2026-04-22', end: '2027-04-22' }, [
			inv({ invoiceNumber: 'OTS 401', issueDate: '2024-06-19', text: 'Web Hosting -' })
		]);
		expect(verdict.covered).toBe(false);
		if (!verdict.covered) expect(verdict.certainty).toBe('certain');
	});

	test("another domain's invoice on the same client never covers this account", () => {
		// arenishaorma.ro and nevadasuceava.ro share client FOOD - NELIMITAT: OTSH 4 bills
		// nevada, and must not silently mark arenishaorma's year as billed.
		const verdict = assessCoverage({ start: '2026-05-31', end: '2027-05-31' }, [
			inv({
				invoiceNumber: 'OTSH 4',
				identifiesAccount: false,
				text: 'Wordpress_Silver - nevadasuceava.ro (31/05/2026 - 30/05/2027)'
			})
		]);
		expect(verdict.covered).toBe(false);
	});

	test('a one-month add-on does not cover a one-year gap it merely starts inside', () => {
		// OTS 528: "360 Monitoring - Lite (09/10/2025 - 08/11/2025)" starts exactly on the
		// hosting anniversary — an overlap test alone would call the whole year billed.
		const verdict = assessCoverage({ start: '2025-10-09', end: '2026-10-09' }, [
			inv({
				invoiceNumber: 'OTS 528',
				issueDate: '2026-02-15',
				text: 'Opțiuni suplimentare (yzywashipotesti.ro) - 360 Monitoring - Lite (09/10/2025 - 08/11/2025)'
			})
		]);
		expect(verdict.covered).toBe(false);
		if (!verdict.covered) expect(verdict.certainty).toBe('uncertain');
	});

	test('a renewal shifted a few days still covers the gap (>=80% of the period)', () => {
		// OTS 526 declares 29/01/2026-28/01/2027 against a 25/01 anniversary.
		const verdict = assessCoverage({ start: '2026-01-25', end: '2027-01-25' }, [
			inv({ invoiceNumber: 'OTS 526', text: 'Wordpress Standard - hiwings.ro (29/01/2026 - 28/01/2027)' })
		]);
		expect(verdict.covered).toBe(true);
	});

	test('CRM inclusive end date (one day short) still covers', () => {
		const verdict = assessCoverage({ start: '2026-04-22', end: '2027-04-22' }, [
			inv({ text: 'Wordpress_Gold - centrale-lemne-liepsnele.ro (22/04/2026 - 21/04/2027)' })
		]);
		expect(verdict.covered).toBe(true);
	});

	test('half a year billed on this domain is not coverage but is uncertain', () => {
		const verdict = assessCoverage({ start: '2026-05-25', end: '2027-05-25' }, [
			inv({ invoiceNumber: 'OTS 509', text: 'Wordpress Extreme - heylux-iasi.ro (25/05/2026 - 15/11/2026)' })
		]);
		expect(verdict.covered).toBe(false);
		if (!verdict.covered) expect(verdict.certainty).toBe('uncertain');
	});
});
