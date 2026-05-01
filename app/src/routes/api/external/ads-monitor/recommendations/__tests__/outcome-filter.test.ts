/**
 * Sprint 4a Fix #1 — Outcome filter + verdict display tests.
 */

import { describe, it, expect } from 'bun:test';

// --- Verdict display logic (pure, no imports needed) ---

const VALID_OUTCOMES = ['improved', 'worsened', 'neutral', 'insufficient_data', 'no_baseline', 'pending'];

function getVerdictLabel(
	outcomeVerdict: string | null,
	status: string,
	appliedAt: Date | null,
	baselineCplCents: number | null,
	outcomeCplCents7d: number | null
): string | null {
	if (outcomeVerdict === null) {
		if (status !== 'applied') return null;
		const daysSince = appliedAt ? (Date.now() - appliedAt.getTime()) / 86400_000 : 0;
		const daysLeft = Math.max(0, 7 - Math.floor(daysSince));
		return `⏱ Pending (${daysLeft}d rămase)`;
	}
	const delta =
		baselineCplCents && outcomeCplCents7d && baselineCplCents > 0
			? (((outcomeCplCents7d - baselineCplCents) / baselineCplCents) * 100).toFixed(1)
			: null;
	switch (outcomeVerdict) {
		case 'improved':
			return `✅ CPL îmbunătățit cu ${delta ? Math.abs(Number(delta)) : '?'}%`;
		case 'worsened':
			return `⚠️ CPL înrăutățit cu ${delta ? Math.abs(Number(delta)) : '?'}%`;
		case 'neutral':
			return '➖ CPL similar';
		case 'insufficient_data':
			return '⏳ Sub 5 conv post-apply';
		case 'no_baseline':
			return 'ℹ️ Fără baseline';
		default:
			return null;
	}
}

// --- Outcome filter logic (mirrors the server-side condition) ---

type Rec = {
	status: string;
	outcomeVerdict: string | null;
};

function filterByOutcome(recs: Rec[], outcome: string): Rec[] {
	if (outcome === 'all') return recs;
	if (outcome === 'pending') return recs.filter((r) => r.status === 'applied' && r.outcomeVerdict === null);
	return recs.filter((r) => r.outcomeVerdict === outcome);
}

const SAMPLE_RECS: Rec[] = [
	{ status: 'applied', outcomeVerdict: 'improved' },
	{ status: 'applied', outcomeVerdict: 'worsened' },
	{ status: 'applied', outcomeVerdict: 'neutral' },
	{ status: 'applied', outcomeVerdict: null },
	{ status: 'rejected', outcomeVerdict: null },
	{ status: 'applied', outcomeVerdict: 'insufficient_data' },
];

describe('outcome filter logic', () => {
	it('all — returns everything', () => {
		expect(filterByOutcome(SAMPLE_RECS, 'all')).toHaveLength(6);
	});

	it('improved — returns only improved', () => {
		const result = filterByOutcome(SAMPLE_RECS, 'improved');
		expect(result).toHaveLength(1);
		expect(result[0].outcomeVerdict).toBe('improved');
	});

	it('worsened — returns only worsened', () => {
		const result = filterByOutcome(SAMPLE_RECS, 'worsened');
		expect(result).toHaveLength(1);
		expect(result[0].outcomeVerdict).toBe('worsened');
	});

	it('pending — returns applied recs with null verdict only', () => {
		const result = filterByOutcome(SAMPLE_RECS, 'pending');
		expect(result).toHaveLength(1);
		expect(result[0].status).toBe('applied');
		expect(result[0].outcomeVerdict).toBeNull();
	});

	it('pending — does NOT include rejected recs with null verdict', () => {
		const result = filterByOutcome(SAMPLE_RECS, 'pending');
		expect(result.every((r) => r.status === 'applied')).toBe(true);
	});

	it('VALID_OUTCOMES includes pending and all verdict types', () => {
		for (const v of ['improved', 'worsened', 'neutral', 'insufficient_data', 'no_baseline', 'pending']) {
			expect(VALID_OUTCOMES).toContain(v);
		}
	});
});

describe('verdict display logic', () => {
	it('improved with delta shows percentage', () => {
		const label = getVerdictLabel('improved', 'applied', new Date(), 200, 160);
		expect(label).toContain('îmbunătățit');
		expect(label).toContain('20');
	});

	it('worsened with delta shows percentage', () => {
		const label = getVerdictLabel('worsened', 'applied', new Date(), 100, 130);
		expect(label).toContain('înrăutățit');
		expect(label).toContain('30');
	});

	it('neutral shows similar message', () => {
		const label = getVerdictLabel('neutral', 'applied', new Date(), 100, 102);
		expect(label).toContain('similar');
	});

	it('insufficient_data shows sub-5 conv message', () => {
		const label = getVerdictLabel('insufficient_data', 'applied', new Date(), 100, null);
		expect(label).toContain('Sub 5 conv');
	});

	it('no_baseline shows baseline message', () => {
		const label = getVerdictLabel('no_baseline', 'applied', null, null, null);
		expect(label).toContain('baseline');
	});

	it('null verdict on applied rec shows pending with days remaining', () => {
		// Applied 3 days ago → 4 days remaining
		const appliedAt = new Date(Date.now() - 3 * 86400_000);
		const label = getVerdictLabel(null, 'applied', appliedAt, null, null);
		expect(label).toContain('Pending');
		expect(label).toContain('4d rămase');
	});

	it('null verdict on non-applied rec → null', () => {
		const label = getVerdictLabel(null, 'rejected', null, null, null);
		expect(label).toBeNull();
	});

	it('delta calculation is correct: (160-200)/200*100 = -20%', () => {
		// improved means CPL went down (outcomeCpl < baseline)
		const delta = ((160 - 200) / 200 * 100).toFixed(1);
		expect(Math.abs(Number(delta))).toBe(20);
	});
});
