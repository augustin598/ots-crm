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
	errorMessage,
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
	rate({ id: 'pm', slug: 'project-management', label: 'Project Management', rateEur: 55, sortOrder: 2 }),
	rate({ id: 'ops', slug: 'devops-api', label: 'DevOps / API', rateEur: 80, sortOrder: 3, isActive: false })
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
			mode({ id: 'x', slug: 'urgent', label: 'Urgență', suffix: 'Urgență 48h', multiplierPct: 150, maxHours: 40, sortOrder: 1 }),
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
});

describe('slug-uri', () => {
	test('slugifyRateLabel elimină diacritice și caractere speciale', () => {
		expect(slugifyRateLabel('Design UI/UX')).toBe('design-ui-ux');
		expect(slugifyRateLabel('  Consultanță & Strategie  ')).toBe('consultanta-strategie');
		expect(slugifyRateLabel('DevOps / API')).toBe('devops-api');
	});

	test('uniqueRateSlug adaugă sufix numeric la coliziune', () => {
		expect(uniqueRateSlug('development', ['development'])).toBe('development-2');
		expect(uniqueRateSlug('development', ['development', 'development-2'])).toBe('development-3');
		expect(uniqueRateSlug('qa', [])).toBe('qa');
	});
});

describe('reguli de blocare', () => {
	test('nu poți dezactiva ultima specializare activă', () => {
		const only = [rate({ slug: 'development' }), rate({ id: 'x', slug: 'qa', isActive: false })];
		expect(rateDeactivationBlockReason(only, 'development', DEFAULT_HOUR_CREDIT_RULES)).toMatch(/ultima/);
	});

	test('nu poți dezactiva tariful de referință ales explicit', () => {
		const rules = { ...DEFAULT_HOUR_CREDIT_RULES, referenceRateSlug: 'development' };
		expect(rateDeactivationBlockReason(RATES, 'development', rules)).toMatch(/referin/);
	});

	test('dezactivarea unei specializări obișnuite e permisă', () => {
		expect(rateDeactivationBlockReason(RATES, 'design-ui-ux', DEFAULT_HOUR_CREDIT_RULES)).toBeNull();
	});

	test('regimul standard rămâne 100% și activ', () => {
		expect(modeUpdateBlockReason('standard', { multiplierPct: 150, isActive: true })).toMatch(/standard/);
		expect(modeUpdateBlockReason('standard', { multiplierPct: 100, isActive: false })).toMatch(/standard/);
		expect(modeUpdateBlockReason('standard', { multiplierPct: 100, isActive: true })).toBeNull();
		expect(modeUpdateBlockReason('urgent', { multiplierPct: 150, isActive: false })).toBeNull();
	});

	test('referința trebuie să fie o specializare activă (sau null)', () => {
		expect(referenceRateBlockReason(RATES, null)).toBeNull();
		expect(referenceRateBlockReason(RATES, 'development')).toBeNull();
		expect(referenceRateBlockReason(RATES, 'devops-api')).toMatch(/activ/);
		expect(referenceRateBlockReason(RATES, 'nu-exista')).toMatch(/exist/);
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
});

describe('errorMessage', () => {
	test('citește mesajul din Error, din HttpError (body.message) sau dă fallback', () => {
		expect(errorMessage(new Error('x'))).toBe('x');
		expect(errorMessage({ status: 400, body: { message: 'y' } })).toBe('y');
		expect(errorMessage('z')).toBe('A apărut o eroare. Încearcă din nou.');
	});
});
