import { describe, expect, test } from 'bun:test';
import { computeRejectionRates, type RecRecord } from './feedback-aggregate';

const NOW = new Date('2026-04-30T00:00:00Z');
const recent = (daysAgo: number) =>
	new Date(NOW.getTime() - daysAgo * 86400_000);

function rec(action: string, status: string, daysAgo: number): RecRecord {
	return { action, status, decidedAt: status === 'draft' ? null : recent(daysAgo) };
}

describe('computeRejectionRates', () => {
	test('returns empty object for empty input', () => {
		expect(computeRejectionRates([], NOW)).toEqual({});
	});

	test('computes rejection rate per action over last 30 days', () => {
		const recs = [
			rec('increase_budget', 'rejected', 5),
			rec('increase_budget', 'rejected', 10),
			rec('increase_budget', 'applied', 15),
			rec('increase_budget', 'rejected', 20),
			rec('increase_budget', 'applied', 25)
		];
		const rates = computeRejectionRates(recs, NOW);
		expect(rates.increase_budget).toBeCloseTo(0.6, 2);
	});

	test('ignores draft (undecided) recommendations', () => {
		const recs = [rec('pause_ad', 'rejected', 5), rec('pause_ad', 'draft', 0)];
		const rates = computeRejectionRates(recs, NOW);
		expect(rates.pause_ad).toBe(1);
	});

	test('ignores recs older than 30 days', () => {
		const recs = [
			rec('refresh_creative', 'rejected', 5),
			rec('refresh_creative', 'applied', 40)
		];
		const rates = computeRejectionRates(recs, NOW);
		expect(rates.refresh_creative).toBe(1);
	});

	test('returns 0 when no rejections in window', () => {
		const recs = [rec('decrease_budget', 'applied', 5), rec('decrease_budget', 'applied', 10)];
		const rates = computeRejectionRates(recs, NOW);
		expect(rates.decrease_budget).toBe(0);
	});

	test('separate rates per action', () => {
		const recs = [
			rec('pause_ad', 'rejected', 5),
			rec('pause_ad', 'applied', 10),
			rec('increase_budget', 'rejected', 5),
			rec('increase_budget', 'rejected', 10)
		];
		const rates = computeRejectionRates(recs, NOW);
		expect(rates.pause_ad).toBe(0.5);
		expect(rates.increase_budget).toBe(1);
	});
});
