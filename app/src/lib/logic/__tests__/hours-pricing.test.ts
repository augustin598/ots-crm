import { describe, test, expect } from 'bun:test';
import {
	HOURS_MIN,
	HOURS_MAX,
	isValidHours,
	hoursNetCents,
	eurCentsToRonCents,
	formatExchangeRate,
	effectiveRateEur,
	isRateModeSlug,
	RATE_MODE_SLUGS,
	DEFAULT_RATE_MODE
} from '../hours-pricing';
import {
	HOURLY_RATES,
	RATE_MODES,
	getRateMode,
	hourlyRateLabelFor
} from '$lib/constants/ots-catalog';

describe('isValidHours', () => {
	test('acceptă limitele și întregii din interval', () => {
		expect(isValidHours(HOURS_MIN)).toBe(true);
		expect(isValidHours(50)).toBe(true);
		expect(isValidHours(HOURS_MAX)).toBe(true);
	});

	test('respinge 0, negative, peste max, fracții și non-numere', () => {
		expect(isValidHours(0)).toBe(false);
		expect(isValidHours(-3)).toBe(false);
		expect(isValidHours(HOURS_MAX + 1)).toBe(false);
		expect(isValidHours(2.5)).toBe(false);
		expect(isValidHours(NaN)).toBe(false);
		expect(isValidHours(Infinity)).toBe(false);
	});
});

describe('hoursNetCents', () => {
	test('net = ore × tarif × 100 (EUR → cenți)', () => {
		expect(hoursNetCents(65, 1)).toBe(6500);
		expect(hoursNetCents(65, 10)).toBe(65000);
		expect(hoursNetCents(80, 7)).toBe(56000);
		expect(hoursNetCents(55, HOURS_MAX)).toBe(550000);
	});

	test('aruncă pe ore invalide sau tarif nepozitiv/fracționar', () => {
		expect(() => hoursNetCents(65, 0)).toThrow();
		expect(() => hoursNetCents(65, HOURS_MAX + 1)).toThrow();
		expect(() => hoursNetCents(65, 2.5)).toThrow();
		expect(() => hoursNetCents(0, 5)).toThrow();
		expect(() => hoursNetCents(-65, 5)).toThrow();
		expect(() => hoursNetCents(65.5, 5)).toThrow();
	});
});

describe('eurCentsToRonCents', () => {
	test('convertește cenți EUR în bani RON la cursul dat, rotunjit la ban', () => {
		expect(eurCentsToRonCents(45500, 5.2534)).toBe(239030); // 455 € × 5,2534 = 2.390,297 lei
		expect(eurCentsToRonCents(9555, 5.2534)).toBe(50196); // 95,55 € × 5,2534 = 501,96 lei
		expect(eurCentsToRonCents(0, 5.2534)).toBe(0);
	});
	test('aruncă pe curs nepozitiv sau non-finit', () => {
		expect(() => eurCentsToRonCents(100, 0)).toThrow();
		expect(() => eurCentsToRonCents(100, -1)).toThrow();
		expect(() => eurCentsToRonCents(100, NaN)).toThrow();
	});
});

describe('formatExchangeRate', () => {
	test('4 zecimale, cu punct — formatul citit de mapper-ul Keez și de UI', () => {
		expect(formatExchangeRate(5.2534)).toBe('5.2534');
		expect(formatExchangeRate(5)).toBe('5.0000');
		expect(formatExchangeRate(5.25346)).toBe('5.2535');
	});
});

describe('effectiveRateEur', () => {
	test('standard nu schimbă tariful', () => {
		expect(effectiveRateEur(65, 100)).toBe(65);
		expect(effectiveRateEur(80, 100)).toBe(80);
	});

	test('rotunjește la euro întreg (jumătățile în sus)', () => {
		expect(effectiveRateEur(65, 150)).toBe(98); // 97,5
		expect(effectiveRateEur(55, 150)).toBe(83); // 82,5
		expect(effectiveRateEur(65, 170)).toBe(111); // 110,5
		expect(effectiveRateEur(70, 150)).toBe(105); // exact
	});

	test('rezultatul e mereu un tarif valid pentru hoursNetCents', () => {
		const rate = effectiveRateEur(55, 150);
		expect(Number.isInteger(rate)).toBe(true);
		expect(hoursNetCents(rate, 3)).toBe(24900);
	});

	test('aruncă pe bază fracționară/nepozitivă sau multiplicator sub 100', () => {
		expect(() => effectiveRateEur(65.5, 150)).toThrow();
		expect(() => effectiveRateEur(0, 150)).toThrow();
		expect(() => effectiveRateEur(-65, 150)).toThrow();
		expect(() => effectiveRateEur(65, 99)).toThrow();
		expect(() => effectiveRateEur(65, 150.5)).toThrow();
	});
});

describe('isRateModeSlug', () => {
	test('acceptă doar regimurile cunoscute', () => {
		for (const slug of RATE_MODE_SLUGS) expect(isRateModeSlug(slug)).toBe(true);
		expect(isRateModeSlug('standard')).toBe(true);
		expect(isRateModeSlug('URGENT')).toBe(false);
		expect(isRateModeSlug('holiday')).toBe(false);
		expect(isRateModeSlug('')).toBe(false);
	});

	test('DEFAULT_RATE_MODE e un slug valid și nu majorează', () => {
		expect(isRateModeSlug(DEFAULT_RATE_MODE)).toBe(true);
		expect(getRateMode(DEFAULT_RATE_MODE)?.multiplierPct).toBe(100);
	});
});

/**
 * Golden: grila completă de tarife, ca o schimbare de tarif de bază sau de
 * multiplicator să apară în diff-ul unui PR, nu direct pe factura clientului.
 */
describe('grila de tarife efective (golden)', () => {
	const EXPECTED: Record<string, Record<string, number>> = {
		standard: { development: 65, 'design-ui-ux': 70, 'project-management': 55, 'devops-api': 80 },
		urgent: { development: 98, 'design-ui-ux': 105, 'project-management': 83, 'devops-api': 120 },
		weekend: { development: 111, 'design-ui-ux': 119, 'project-management': 94, 'devops-api': 136 },
		night: { development: 130, 'design-ui-ux': 140, 'project-management': 110, 'devops-api': 160 }
	};

	test('cele 16 tarife efective sunt cele publicate', () => {
		const actual = Object.fromEntries(
			RATE_MODES.map((mode) => [
				mode.slug,
				Object.fromEntries(
					HOURLY_RATES.map((r) => [r.slug, effectiveRateEur(r.rate, mode.multiplierPct)])
				)
			])
		);
		expect(actual).toEqual(EXPECTED);
	});

	test('slug-urile din catalog sunt exact cele din modulul pur', () => {
		expect(RATE_MODES.map((m) => m.slug)).toEqual([...RATE_MODE_SLUGS]);
	});

	test('plafonul de ore scade cu regimul și stă sub HOURS_MAX', () => {
		for (const mode of RATE_MODES) {
			expect(mode.maxHours).toBeGreaterThanOrEqual(HOURS_MIN);
			expect(mode.maxHours).toBeLessThanOrEqual(HOURS_MAX);
		}
		expect(getRateMode('urgent')!.maxHours).toBe(40);
		expect(getRateMode('weekend')!.maxHours).toBe(24);
		expect(getRateMode('night')!.maxHours).toBe(16);
	});

	test('doar regimul standard păstrează denumirea de articol Keez de până acum', () => {
		const dev = HOURLY_RATES[0];
		expect(hourlyRateLabelFor(dev, getRateMode('standard')!)).toBe('Development');
		expect(hourlyRateLabelFor(dev, getRateMode('urgent')!)).toBe('Development (Urgență 48h)');
		expect(hourlyRateLabelFor(dev, getRateMode('night')!)).toBe('Development (Noapte)');
	});
});
