import { describe, test, expect, mock, beforeEach } from 'bun:test';

/**
 * Portal → „Credit de ore".
 *
 * Invariante testate:
 *  - contactul secundar fără flag-ul `hourCredits` e respins: layout-ul portalului
 *    gate-uiește doar navigarea, remote-ul se poate chema direct;
 *  - datele sunt scoped pe clientul din sesiune, niciodată pe un id din payload;
 *  - notele interne ale ajustărilor manuale nu ajung la client.
 */

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$env/dynamic/public', () => ({ env: {} }));

let currentEvent: any = null;

mock.module('$app/server', () => ({
	query: (schemaOrFn: any, fn?: Function) => fn ?? schemaOrFn,
	command: (schemaOrFn: any, fn?: Function) => fn ?? schemaOrFn,
	getRequestEvent: () => currentEvent
}));

let portalFlags: Record<string, boolean> = {};
mock.module('$lib/server/portal-access', () => ({
	getRequestAccessFlags: async () => portalFlags
}));

const viewCalls: Array<[string, string]> = [];
let optedIn = false;
mock.module('$lib/server/hour-credits', () => ({
	getClientHourCredit: async (tenantId: string, clientId: string) => {
		viewCalls.push([tenantId, clientId]);
		return {
			balanceMinutes: 120,
			optedIn,
			entries: [
				{
					id: 'l1',
					deltaMinutes: -60,
					kind: 'manual',
					note: 'corecție internă: client întârzie plățile',
					realMinutes: null,
					createdAt: new Date('2026-09-10T10:00:00Z')
				},
				{
					id: 'l2',
					deltaMinutes: -90,
					kind: 'task_consumption',
					note: 'Configurare GA4 — 90 min Development',
					realMinutes: 76,
					createdAt: new Date('2026-09-11T10:00:00Z')
				}
			]
		};
	}
}));
mock.module('$lib/server/task-credit', () => ({
	computeReservedMinutes: async () => new Map([['c1', 30]])
}));
mock.module('$lib/server/hourly-catalog', () => ({
	getHourlyCatalog: async () => ({
		rates: [{ id: 'r', slug: 'pm', label: 'PM', rateEur: 55, sortOrder: 0, isActive: true }],
		modes: [],
		rules: { referenceRateSlug: null, lowCreditThresholdMinutes: 120, stepMinutes: 15 }
	})
}));

const { getMyHourCredit } = await import('../portal-hour-credits.remote');

function portalEvent(isPrimary: boolean) {
	return {
		locals: {
			user: { id: 'u1', email: 'contact@client.ro' },
			isClientUser: true,
			client: { id: 'c1', tenantId: 't1' },
			clientUser: { isPrimary },
			tenant: { id: 't1' }
		}
	};
}

beforeEach(() => {
	viewCalls.length = 0;
	portalFlags = {};
});

describe('getMyHourCredit', () => {
	test('contactul secundar fără flag-ul hourCredits e respins', async () => {
		currentEvent = portalEvent(false);
		portalFlags = { hourCredits: false };
		await expect((getMyHourCredit as any)()).rejects.toThrow();
		expect(viewCalls).toEqual([]);
	});

	test('contactul cu flag vede soldul propriului client', async () => {
		currentEvent = portalEvent(false);
		portalFlags = { hourCredits: true };
		const view = await (getMyHourCredit as any)();
		expect(viewCalls).toEqual([['t1', 'c1']]);
		expect(view.balanceMinutes).toBe(120);
		expect(view.reservedMinutes).toBe(30);
	});

	test('tariful conversiei apare doar clientului cu alimentare din facturi', async () => {
		currentEvent = portalEvent(true);
		portalFlags = { hourCredits: true };
		optedIn = false;
		const off = await (getMyHourCredit as any)();
		expect(off.subscriptionRateEur).toBeNull();
		expect(off.reference).toBeUndefined();
		expect(off.stepMinutes).toBe(15);
		// Regulile fără termen de expirare → 0 („orele nu expiră").
		expect(off.expiryDays).toBe(0);
		optedIn = true;
		const on = await (getMyHourCredit as any)();
		expect(on.subscriptionRateEur).toBe(55);
		optedIn = false;
	});

	test('nota unei ajustări manuale nu ajunge în portal; restul notelor rămân', async () => {
		currentEvent = portalEvent(true);
		// Contactul primar are mereu toate flag-urile (portal-access.ts).
		portalFlags = { hourCredits: true };
		const view = await (getMyHourCredit as any)();
		const manual = view.entries.find((e: any) => e.id === 'l1');
		const task = view.entries.find((e: any) => e.id === 'l2');
		expect(manual.note).toBeNull();
		expect(manual.realMinutes).toBeNull();
		expect(task.note).toBe('Configurare GA4 — 90 min Development');
	});
});
