import { describe, it, expect } from 'bun:test';
import { buildHealth } from '../health.utils';

const NOW = new Date('2026-01-01T12:00:00Z').getTime();

function makeDate(daysFromNow: number): Date {
	return new Date(NOW + daysFromNow * 86400000);
}

describe('buildHealth', () => {
	it('google with 0 failures → healthy, daysUntilExpiry=null', () => {
		const result = buildHealth('google', 'id-1', makeDate(0), null, null, true, NOW, 0);
		expect(result.status).toBe('healthy');
		expect(result.daysUntilExpiry).toBeNull();
	});

	it('google with failures > 0 → broken', () => {
		const result = buildHealth('google', 'id-1', makeDate(0), null, null, true, NOW, 3);
		expect(result.status).toBe('broken');
	});

	it('meta token expiring in 5 days → expiring_soon', () => {
		const result = buildHealth('meta', 'id-2', makeDate(5), null, null, true, NOW, 0);
		expect(result.status).toBe('expiring_soon');
		expect(result.daysUntilExpiry).toBe(5);
	});

	it('meta token expired → expired', () => {
		const result = buildHealth('meta', 'id-2', makeDate(-1), null, null, true, NOW, 0);
		expect(result.status).toBe('expired');
		expect(result.daysUntilExpiry).toBe(-1);
	});

	it('meta token healthy (30 days) → healthy', () => {
		const result = buildHealth('meta', 'id-2', makeDate(30), null, null, true, NOW, 0);
		expect(result.status).toBe('healthy');
		expect(result.daysUntilExpiry).toBe(30);
	});

	it('inactive integration → inactive regardless of platform', () => {
		const result = buildHealth('google', 'id-3', null, null, null, false, NOW, 0);
		expect(result.status).toBe('inactive');
	});

	it('inactive beats failures', () => {
		const result = buildHealth('meta', 'id-3', makeDate(-5), null, 'some error', false, NOW, 5);
		expect(result.status).toBe('inactive');
	});

	it('tiktok token expiring in 3 days → expiring_soon', () => {
		const result = buildHealth('tiktok', 'id-4', makeDate(3), null, null, true, NOW, 0);
		expect(result.status).toBe('expiring_soon');
	});
});
