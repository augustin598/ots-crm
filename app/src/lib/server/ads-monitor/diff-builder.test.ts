import { describe, expect, test } from 'bun:test';
import { buildDiff, type FieldDiff } from './diff-builder';

describe('buildDiff', () => {
	test('returns empty diff when before and after are identical', () => {
		const result = buildDiff({ targetCplCents: 3000 }, { targetCplCents: 3000 });
		expect(result).toEqual({});
	});

	test('captures changed primitive field with from/to', () => {
		const result = buildDiff({ targetCplCents: 3000 }, { targetCplCents: 2500 });
		expect(result).toEqual({ targetCplCents: { from: 3000, to: 2500 } });
	});

	test('captures multiple changes', () => {
		const before = { targetCplCents: 3000, notes: null, customCooldownHours: null };
		const after = { targetCplCents: 2500, notes: 'reduced', customCooldownHours: 24 };
		expect(buildDiff(before, after)).toEqual({
			targetCplCents: { from: 3000, to: 2500 },
			notes: { from: null, to: 'reduced' },
			customCooldownHours: { from: null, to: 24 }
		});
	});

	test('ignores fields not present in after', () => {
		const result = buildDiff({ a: 1, b: 2 }, { a: 5 });
		expect(result).toEqual({ a: { from: 1, to: 5 } });
	});

	test('treats array fields with deep equality (suppressedActions)', () => {
		const result = buildDiff(
			{ suppressedActions: ['pause_ad'] },
			{ suppressedActions: ['pause_ad'] }
		);
		expect(result).toEqual({});
	});

	test('captures array changes (suppressedActions)', () => {
		const result = buildDiff(
			{ suppressedActions: ['pause_ad'] },
			{ suppressedActions: ['pause_ad', 'increase_budget'] }
		);
		expect(result).toEqual({
			suppressedActions: { from: ['pause_ad'], to: ['pause_ad', 'increase_budget'] }
		});
	});

	test('treats undefined and null as equivalent for nullable fields', () => {
		const result = buildDiff({ notes: undefined }, { notes: null });
		expect(result).toEqual({});
	});
});
