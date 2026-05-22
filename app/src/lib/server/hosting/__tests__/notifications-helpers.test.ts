import { describe, test, expect } from 'bun:test';
import { dayBucketEET } from '../notifications-helpers';

describe('dayBucketEET', () => {
	test('returns YYYY-MM-DD format for current date in Europe/Bucharest', () => {
		const result = dayBucketEET(new Date('2026-05-22T10:00:00Z'));
		expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	test('returns same bucket for dates within same EET calendar day', () => {
		// 2026-05-22 01:00 EET = 2026-05-21 23:00 UTC (EET = UTC+3 in May)
		const a = dayBucketEET(new Date('2026-05-21T23:00:00Z'));
		// 2026-05-22 22:00 EET = 2026-05-22 19:00 UTC
		const b = dayBucketEET(new Date('2026-05-22T19:00:00Z'));
		expect(a).toBe('2026-05-22');
		expect(b).toBe('2026-05-22');
	});

	test('handles DST transition correctly', () => {
		// Romania uses Europe/Bucharest: EET (UTC+2) winter, EEST (UTC+3) summer
		const summer = dayBucketEET(new Date('2026-07-15T22:00:00Z'));
		expect(summer).toBe('2026-07-16'); // already next day in EEST
	});
});
