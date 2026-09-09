import { describe, test, expect } from 'bun:test';
import { reconcileMccAccounts } from '../reconcile-accounts';

describe('reconcileMccAccounts', () => {
	const existing = [
		{ id: 'row-a', googleAdsCustomerId: '1111111111', isActive: true },
		{ id: 'row-b', googleAdsCustomerId: '2222222222', isActive: true },
		{ id: 'row-c', googleAdsCustomerId: '3333333333', isActive: false }
	];

	test('active rows missing from the MCC listing are deactivated', () => {
		const r = reconcileMccAccounts(existing, [{ customerId: '1111111111' }]);
		expect(r.deactivateIds).toEqual(['row-b']);
	});

	test('rows still in the listing are left alone (dashes tolerated)', () => {
		const r = reconcileMccAccounts(existing, [{ customerId: '111-111-1111' }, { customerId: '2222222222' }]);
		expect(r.deactivateIds).toEqual([]);
	});

	test('an empty listing deactivates nothing (API hiccup must not wipe the mapping)', () => {
		expect(reconcileMccAccounts(existing, []).deactivateIds).toEqual([]);
	});
});
