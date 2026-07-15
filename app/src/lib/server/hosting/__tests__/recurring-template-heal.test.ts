import { describe, test, expect, mock } from 'bun:test';

// Mock SvelteKit virtual modules BEFORE importing the module under test
// (recurring-template.ts transitively imports $lib/server/db → $env/dynamic/private).
mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$env/dynamic/public', () => ({ env: {} }));
mock.module('$env/static/public', () => ({}));
// The module under test imports $lib/server/db (throws without DB env) and the
// BNR client transitively. resolveTemplateHeal is pure — stub the DB layer out.
mock.module('$lib/server/db', () => ({ db: {} }));
mock.module('$lib/server/bnr/client', () => ({ getLatestBnrRate: async () => null }));

const { resolveTemplateHeal } = await import('../recurring-template');

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('resolveTemplateHeal', () => {
	test('never-ran template: nextRunDate always snaps to computed (expiry - lead days)', () => {
		const heal = resolveTemplateHeal(
			{ clientId: 'real', nextRunDate: d('2027-04-22'), lastRunDate: null },
			{ clientId: 'real', nextRunDate: d('2027-04-08') }
		);
		expect(heal.nextRunDate.toISOString()).toBe(d('2027-04-08').toISOString());
		expect(heal.changed).toBe(true);
	});

	test('already-generated template: nextRunDate never regresses (double-billing guard)', () => {
		// hotel-castel case: template already generated the current-cycle invoice
		// (nextRun advanced to 2027-06-01) while the account due date is stale at
		// 2026-06-01. Computed 2026-05-18 must NOT win or the cycle is re-billed.
		const heal = resolveTemplateHeal(
			{ clientId: 'real', nextRunDate: d('2027-06-01'), lastRunDate: d('2026-06-01') },
			{ clientId: 'real', nextRunDate: d('2026-05-18') }
		);
		expect(heal.nextRunDate.toISOString()).toBe(d('2027-06-01').toISOString());
		expect(heal.changed).toBe(false);
	});

	test('already-generated template: nextRunDate still moves FORWARD after a payment advanced the due date', () => {
		const heal = resolveTemplateHeal(
			{ clientId: 'real', nextRunDate: d('2027-04-22'), lastRunDate: d('2026-07-15') },
			{ clientId: 'real', nextRunDate: d('2028-04-08') }
		);
		expect(heal.nextRunDate.toISOString()).toBe(d('2028-04-08').toISOString());
		expect(heal.changed).toBe(true);
	});

	test('heals clientId when the template points at a different (duplicate) client', () => {
		const heal = resolveTemplateHeal(
			{ clientId: 'duplicate-no-email', nextRunDate: d('2027-04-08'), lastRunDate: null },
			{ clientId: 'real', nextRunDate: d('2027-04-08') }
		);
		expect(heal.clientId).toBe('real');
		expect(heal.changed).toBe(true);
	});

	test('no client heal when computed clientId is null', () => {
		const heal = resolveTemplateHeal(
			{ clientId: 'existing', nextRunDate: d('2027-04-08'), lastRunDate: null },
			{ clientId: null, nextRunDate: d('2027-04-08') }
		);
		expect(heal.clientId).toBeNull();
		expect(heal.changed).toBe(false);
	});

	test('fully-aligned template reports no change', () => {
		const heal = resolveTemplateHeal(
			{ clientId: 'real', nextRunDate: d('2027-04-08'), lastRunDate: null },
			{ clientId: 'real', nextRunDate: d('2027-04-08') }
		);
		expect(heal.clientId).toBeNull();
		expect(heal.changed).toBe(false);
	});
});
