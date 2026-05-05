import { describe, test, expect } from 'bun:test';

// Must mock SvelteKit virtual modules BEFORE any module loads
import { mock } from 'bun:test';
mock.module('$app/server', () => ({
	query: (schema: unknown, fn: unknown) => fn,
	command: (schema: unknown, fn: unknown) => fn,
	getRequestEvent: () => null,
}));
mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$lib/server/db', () => ({ db: {} }));
mock.module('$lib/server/db/schema', () => ({}));
mock.module('$lib/server/logger', () => ({
	logError: () => {},
	logWarning: () => {},
	logInfo: () => {},
	serializeError: (e: unknown) => ({ message: String(e), stack: '' }),
}));

const { validateLineItems } = await import('../recurring-invoice-validation');
const { applyKeezDriftGuard } = await import('../invoice-utils');

describe('validateLineItems', () => {
	test('throws when qty=-1 and isCreditNote=false', () => {
		expect(() =>
			validateLineItems([{ description: 'Service A', quantity: -1, rate: 100 }], false)
		).toThrow('quantity must be positive');
	});

	test('does not throw when qty=-1 and isCreditNote=true', () => {
		expect(() =>
			validateLineItems([{ description: 'Service A', quantity: -1, rate: 100 }], true)
		).not.toThrow();
	});

	test('throws when qty=0 and isCreditNote=false', () => {
		expect(() =>
			validateLineItems([{ description: 'Service B', quantity: 0, rate: 50 }], false)
		).toThrow('quantity must be positive');
	});

	test('does not throw for valid positive qty', () => {
		expect(() =>
			validateLineItems([{ description: 'Service C', quantity: 5, rate: 200 }], false)
		).not.toThrow();
	});
});

describe('applyKeezDriftGuard', () => {
	test('uses template rate when Keez drift >20%', () => {
		const templateRate = 10000; // 100.00
		const liveRate = 13000;    // 130.00 — 30% drift
		const { rate, driftDetected } = applyKeezDriftGuard(liveRate, templateRate);
		expect(rate).toBe(templateRate);
		expect(driftDetected).toBe(true);
	});

	test('uses Keez rate when drift <20%', () => {
		const templateRate = 10000; // 100.00
		const liveRate = 10500;    // 105.00 — 5% drift
		const { rate, driftDetected } = applyKeezDriftGuard(liveRate, templateRate);
		expect(rate).toBe(liveRate);
		expect(driftDetected).toBe(false);
	});

	test('uses Keez rate when templateRate=0 (no stored rate)', () => {
		const { rate, driftDetected } = applyKeezDriftGuard(5000, 0);
		expect(rate).toBe(5000);
		expect(driftDetected).toBe(false);
	});

	test('drift exactly at 20% boundary uses Keez rate', () => {
		const templateRate = 10000;
		const liveRate = 12000; // exactly 20%
		const { rate, driftDetected } = applyKeezDriftGuard(liveRate, templateRate);
		expect(rate).toBe(liveRate);
		expect(driftDetected).toBe(false);
	});
});
