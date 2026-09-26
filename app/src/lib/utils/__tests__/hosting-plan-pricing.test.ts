import { describe, test, expect } from 'bun:test';
import {
	monthlyEquivalentRon,
	yearlyTotalRon,
	monthlyBilledRon,
	displayPrice,
	mbToGb,
	mbToGbNumber,
	fmtCount,
	isPopular,
	tagFor,
	backupHint
} from '../hosting-plan-pricing';

const plan = (over: Partial<Parameters<typeof monthlyEquivalentRon>[0]> = {}) => ({
	price: 114900,
	billingCycle: 'annually',
	...over
});

describe('prețuri afișate pe cardurile de pachete', () => {
	test('anual: 1149 RON / an → 115 RON/lună echivalent, 1150 RON/an cu -2 luni', () => {
		expect(monthlyEquivalentRon(plan())).toBe(115);
		expect(yearlyTotalRon(plan())).toBe(1150);
		expect(monthlyBilledRon(plan())).toBe(115);
	});

	test('lunar: prețul lunar e cel facturat', () => {
		const p = plan({ price: 9500, billingCycle: 'monthly' });
		expect(monthlyEquivalentRon(p)).toBe(95);
		expect(monthlyBilledRon(p)).toBe(95);
		expect(yearlyTotalRon(p)).toBe(950);
	});

	test('trimestrial / semestrial / 2-3 ani se normalizează la echivalent lunar', () => {
		expect(monthlyEquivalentRon(plan({ price: 30000, billingCycle: 'quarterly' }))).toBe(100);
		// Semestrial = 5 luni plătite din 6 (o lună gratis, ca anual = 10 din 12).
		expect(monthlyEquivalentRon(plan({ price: 60000, billingCycle: 'semiannually' }))).toBe(120);
		expect(monthlyEquivalentRon(plan({ price: 60000, billingCycle: 'biannually' }))).toBe(120);
		expect(monthlyEquivalentRon(plan({ price: 240000, billingCycle: 'biennially' }))).toBe(120);
		expect(monthlyEquivalentRon(plan({ price: 360000, billingCycle: 'triennially' }))).toBe(120);
	});

	test('displayPrice: anual → total anual / 12; lunar → prețul lunar facturat', () => {
		expect(displayPrice(plan(), true)).toBe(Math.round(1150 / 12));
		expect(displayPrice(plan({ price: 9500, billingCycle: 'monthly' }), false)).toBe(95);
	});
});

describe('formatare resurse', () => {
	test('mbToGb: MB sub 1 GB rămân în MB, altfel GB rotunjit; null = Nelimitat', () => {
		expect(mbToGb(512)).toBe('512 MB');
		expect(mbToGb(25600)).toBe('25 GB');
		expect(mbToGb(null)).toBe('Nelimitat');
		expect(mbToGbNumber(2048)).toBe(2);
		expect(mbToGbNumber(undefined)).toBeNull();
	});

	test('fmtCount: null = Nelimitat, altfel cu separator românesc', () => {
		expect(fmtCount(null)).toBe('Nelimitat');
		expect(fmtCount(5)).toBe('5');
	});
});

describe('texte card', () => {
	test('isPopular doar când badge-ul are text', () => {
		expect(isPopular({ highlightBadge: 'Cel mai ales' })).toBe(true);
		expect(isPopular({ highlightBadge: '  ' })).toBe(false);
		expect(isPopular({ highlightBadge: null })).toBe(false);
	});

	test('tagFor cade pe un text implicit fără descriere', () => {
		expect(tagFor({ description: 'Pentru magazine mari' })).toBe('Pentru magazine mari');
		expect(tagFor({ description: null })).toMatch(/WordPress/);
	});

	test('backupHint ia feature-ul cu „backup" sau „zilnic"', () => {
		expect(backupHint({ features: ['SSL', 'Backup orar'] })).toBe('Backup orar');
		expect(backupHint({ features: null })).toBe('zilnic');
	});
});
