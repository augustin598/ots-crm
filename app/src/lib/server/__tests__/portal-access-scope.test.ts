import { describe, test, expect, mock } from 'bun:test';

// Modulele virtuale SvelteKit trebuie mock-uite ÎNAINTE de import (portal-access
// importă $lib/server/db → $env/dynamic/private). Funcțiile testate sunt pure.
mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$lib/server/db', () => ({ db: {} }));
mock.module('$lib/server/db/schema', () => ({}));

const { applyPortalScope, routeBlockedByPortalScope, ALL_ACCESS_TRUE, NO_ACCESS } = await import(
	'../portal-access'
);

describe('applyPortalScope', () => {
	test("'full' lasă flag-urile neatinse", () => {
		expect(applyPortalScope(ALL_ACCESS_TRUE, 'full')).toEqual(ALL_ACCESS_TRUE);
	});

	test('null / undefined înseamnă full (clienții vechi, fără coloană setată explicit)', () => {
		expect(applyPortalScope(ALL_ACCESS_TRUE, null)).toEqual(ALL_ACCESS_TRUE);
		expect(applyPortalScope(ALL_ACCESS_TRUE, undefined)).toEqual(ALL_ACCESS_TRUE);
	});

	test("'hosting' păstrează doar hosting + invoices", () => {
		expect(applyPortalScope(ALL_ACCESS_TRUE, 'hosting')).toEqual({
			...NO_ACCESS,
			hosting: true,
			invoices: true
		});
	});

	test("'hosting' nu acordă ce contactul nu avea deja (secundar fără invoices)", () => {
		expect(applyPortalScope({ ...NO_ACCESS, hosting: true }, 'hosting')).toEqual({
			...NO_ACCESS,
			hosting: true
		});
	});

	test('o valoare necunoscută se tratează ca full, nu blochează clientul', () => {
		expect(applyPortalScope(ALL_ACCESS_TRUE, 'altceva')).toEqual(ALL_ACCESS_TRUE);
	});
});

describe('routeBlockedByPortalScope', () => {
	test('sub hosting, Servicii & Oferte și Echipa mea sunt închise', () => {
		expect(routeBlockedByPortalScope('/client/ots/services', 'ots', 'hosting')).toBe(true);
		expect(routeBlockedByPortalScope('/client/ots/services/seo', 'ots', 'hosting')).toBe(true);
		expect(routeBlockedByPortalScope('/client/ots/team', 'ots', 'hosting')).toBe(true);
		expect(routeBlockedByPortalScope('/client/ots/team/abc', 'ots', 'hosting')).toBe(true);
	});

	test('sub hosting, dashboard / hosting / invoices / settings rămân deschise', () => {
		for (const p of [
			'/client/ots/dashboard',
			'/client/ots/hosting',
			'/client/ots/hosting/packages',
			'/client/ots/invoices',
			'/client/ots/settings'
		]) {
			expect(routeBlockedByPortalScope(p, 'ots', 'hosting')).toBe(false);
		}
	});

	test('sub full nimic nu e închis', () => {
		expect(routeBlockedByPortalScope('/client/ots/services', 'ots', 'full')).toBe(false);
		expect(routeBlockedByPortalScope('/client/ots/team', 'ots', null)).toBe(false);
	});

	test('o cale din alt tenant nu e judecată', () => {
		expect(routeBlockedByPortalScope('/client/alt/services', 'ots', 'hosting')).toBe(false);
	});
});
