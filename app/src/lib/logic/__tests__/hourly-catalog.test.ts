import { describe, test, expect } from 'bun:test';
import {
	DEFAULT_HOUR_CREDIT_RULES,
	activeRates,
	activeModes,
	resolveReferenceRate,
	toPublicHourlyRates,
	toPublicRateModes,
	slugifyRateLabel,
	uniqueRateSlug,
	rateDeactivationBlockReason,
	modeUpdateBlockReason,
	referenceRateBlockReason,
	formatMinutes,
	type CatalogRate,
	type CatalogMode
} from '../hourly-catalog';

const rate = (over: Partial<CatalogRate>): CatalogRate => ({
	id: 'r',
	slug: 'development',
	label: 'Development',
	rateEur: 65,
	sortOrder: 0,
	isActive: true,
	...over
});

const mode = (over: Partial<CatalogMode>): CatalogMode => ({
	id: 'm',
	slug: 'standard',
	label: 'Standard',
	suffix: '',
	description: '',
	sla: '',
	multiplierPct: 100,
	maxHours: 100,
	sortOrder: 0,
	isActive: true,
	...over
});

const RATES = [
	rate({ id: 'dev', slug: 'development', label: 'Development', rateEur: 65, sortOrder: 0 }),
	rate({ id: 'des', slug: 'design-ui-ux', label: 'Design UI/UX', rateEur: 70, sortOrder: 1 }),
	rate({
		id: 'pm',
		slug: 'project-management',
		label: 'Project Management',
		rateEur: 55,
		sortOrder: 2
	}),
	rate({
		id: 'ops',
		slug: 'devops-api',
		label: 'DevOps / API',
		rateEur: 80,
		sortOrder: 3,
		isActive: false
	})
];

describe('activeRates / activeModes', () => {
	test('păstrează doar rândurile active, sortate după sortOrder apoi label', () => {
		const shuffled = [RATES[2], RATES[3], RATES[0], RATES[1]];
		expect(activeRates(shuffled).map((r) => r.slug)).toEqual([
			'development',
			'design-ui-ux',
			'project-management'
		]);
		const modes = [
			mode({ id: 'b', slug: 'urgent', sortOrder: 1 }),
			mode({ id: 'a', slug: 'standard', sortOrder: 0 }),
			mode({ id: 'c', slug: 'night', sortOrder: 3, isActive: false })
		];
		expect(activeModes(modes).map((m) => m.slug)).toEqual(['standard', 'urgent']);
	});

	test('sortOrder egal → tie-break alfabetic pe label (pinuiește colația ro: S înaintea lui Ș)', () => {
		const tied = [
			rate({ id: '2', slug: 'a', label: 'Șa', sortOrder: 0 }),
			rate({ id: '1', slug: 'b', label: 'Sb', sortOrder: 0 })
		];
		expect(activeRates(tied).map((r) => r.slug)).toEqual(['b', 'a']);
	});

	test('listă goală → listă goală', () => {
		expect(activeRates([])).toEqual([]);
	});
});

describe('resolveReferenceRate', () => {
	test('fără setare explicită = cel mai mic tarif ACTIV', () => {
		expect(resolveReferenceRate(RATES, DEFAULT_HOUR_CREDIT_RULES)?.slug).toBe('project-management');
	});

	test('setarea explicită câștigă dacă e activă', () => {
		const rules = { ...DEFAULT_HOUR_CREDIT_RULES, referenceRateSlug: 'design-ui-ux' };
		expect(resolveReferenceRate(RATES, rules)?.slug).toBe('design-ui-ux');
	});

	test('setarea explicită pe un tarif inactiv cade înapoi pe cel mai mic activ', () => {
		const rules = { ...DEFAULT_HOUR_CREDIT_RULES, referenceRateSlug: 'devops-api' };
		expect(resolveReferenceRate(RATES, rules)?.slug).toBe('project-management');
	});

	test('fără tarife active → null', () => {
		expect(resolveReferenceRate([rate({ isActive: false })], DEFAULT_HOUR_CREDIT_RULES)).toBeNull();
	});

	test('referință explicită "" (șir gol) se comportă ca null', () => {
		const rules = { ...DEFAULT_HOUR_CREDIT_RULES, referenceRateSlug: '' };
		expect(resolveReferenceRate(RATES, rules)?.slug).toBe('project-management');
	});
});

describe('forme publice', () => {
	test('toPublicHourlyRates: doar active, forma { slug, label, rate }', () => {
		expect(toPublicHourlyRates(RATES)).toEqual([
			{ slug: 'development', label: 'Development', rate: 65 },
			{ slug: 'design-ui-ux', label: 'Design UI/UX', rate: 70 },
			{ slug: 'project-management', label: 'Project Management', rate: 55 }
		]);
	});

	test('toPublicRateModes: doar active, fără id/sortOrder/isActive', () => {
		const out = toPublicRateModes([
			mode({
				id: 'x',
				slug: 'urgent',
				label: 'Urgență',
				suffix: 'Urgență 48h',
				multiplierPct: 150,
				maxHours: 40,
				sortOrder: 1
			}),
			mode({ id: 'y', slug: 'night', sortOrder: 2, isActive: false })
		]);
		expect(out).toEqual([
			{
				slug: 'urgent',
				label: 'Urgență',
				suffix: 'Urgență 48h',
				description: '',
				sla: '',
				multiplierPct: 150,
				maxHours: 40
			}
		]);
	});

	test('listă goală → listă goală', () => {
		expect(toPublicHourlyRates([])).toEqual([]);
	});
});

describe('slug-uri', () => {
	test('slugifyRateLabel elimină diacritice și caractere speciale', () => {
		expect(slugifyRateLabel('Design UI/UX')).toBe('design-ui-ux');
		expect(slugifyRateLabel('  Consultanță & Strategie  ')).toBe('consultanta-strategie');
		expect(slugifyRateLabel('DevOps / API')).toBe('devops-api');
	});

	test('slugifyRateLabel fără caractere alfanumerice → șir gol', () => {
		expect(slugifyRateLabel('!!!')).toBe('');
	});

	test('slugifyRateLabel taie la RATE_SLUG_MAX_LENGTH fără cratimă finală', () => {
		const slug = slugifyRateLabel('a'.repeat(39) + ' bcd');
		expect(slug.length).toBeLessThanOrEqual(40);
		expect(slug.endsWith('-')).toBe(false);
	});

	test('uniqueRateSlug adaugă sufix numeric la coliziune', () => {
		expect(uniqueRateSlug('development', ['development'])).toBe('development-2');
		expect(uniqueRateSlug('development', ['development', 'development-2'])).toBe('development-3');
		expect(uniqueRateSlug('qa', [])).toBe('qa');
	});

	test('uniqueRateSlug rămâne ≤ RATE_SLUG_MAX_LENGTH la coliziune pe bază lungă', () => {
		const base = 'a'.repeat(40);
		const slug = uniqueRateSlug(base, [base]);
		expect(slug.length).toBeLessThanOrEqual(40);
		expect(slug.endsWith('-2')).toBe(true);
	});

	test('uniqueRateSlug fără cratimă dublă când tăierea cade exact pe o cratimă', () => {
		const base = slugifyRateLabel('a'.repeat(37) + ' bc');
		const slug = uniqueRateSlug(base, [base]);
		expect(slug).not.toContain('--');
		expect(slug.length).toBeLessThanOrEqual(40);
		expect(slug.endsWith('-2')).toBe(true);
	});
});

describe('reguli de blocare', () => {
	test('nu poți dezactiva ultima specializare activă', () => {
		const only = [rate({ slug: 'development' }), rate({ id: 'x', slug: 'qa', isActive: false })];
		expect(rateDeactivationBlockReason(only, 'development', DEFAULT_HOUR_CREDIT_RULES)).toMatch(
			/ultima/
		);
	});

	test('nu poți dezactiva tariful de referință ales explicit', () => {
		const rules = { ...DEFAULT_HOUR_CREDIT_RULES, referenceRateSlug: 'development' };
		expect(rateDeactivationBlockReason(RATES, 'development', rules)).toMatch(/referin/);
	});

	test('dezactivarea unei specializări obișnuite e permisă', () => {
		expect(
			rateDeactivationBlockReason(RATES, 'design-ui-ux', DEFAULT_HOUR_CREDIT_RULES)
		).toBeNull();
	});

	test('regimul standard rămâne 100% și activ', () => {
		expect(modeUpdateBlockReason('standard', { multiplierPct: 150, isActive: true })).toMatch(
			/standard/
		);
		expect(modeUpdateBlockReason('standard', { multiplierPct: 100, isActive: false })).toMatch(
			/standard/
		);
		expect(modeUpdateBlockReason('standard', { multiplierPct: 100, isActive: true })).toBeNull();
		expect(modeUpdateBlockReason('urgent', { multiplierPct: 150, isActive: false })).toBeNull();
	});

	test('referința trebuie să fie o specializare activă (sau null)', () => {
		expect(referenceRateBlockReason(RATES, null)).toBeNull();
		expect(referenceRateBlockReason(RATES, 'development')).toBeNull();
		expect(referenceRateBlockReason(RATES, 'devops-api')).toMatch(/activ/);
		expect(referenceRateBlockReason(RATES, 'nu-exista')).toMatch(/exist/);
	});

	test('referința "" (șir gol) e tratată ca null, nu ca slug invalid', () => {
		expect(referenceRateBlockReason(RATES, '')).toBeNull();
	});
});

describe('formatMinutes', () => {
	test('ore și minute în română', () => {
		expect(formatMinutes(0)).toBe('0 min');
		expect(formatMinutes(45)).toBe('45 min');
		expect(formatMinutes(60)).toBe('1 h');
		expect(formatMinutes(135)).toBe('2 h 15 min');
		expect(formatMinutes(-90)).toBe('-1 h 30 min');
	});

	test('input non-finit → em dash', () => {
		expect(formatMinutes(NaN)).toBe('—');
	});
});
