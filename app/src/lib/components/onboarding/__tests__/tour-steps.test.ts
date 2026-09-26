import { describe, test, expect } from 'bun:test';
import { getTourSteps, getChecklistItems } from '../tour-steps';

describe('getTourSteps', () => {
	test('contactul primar vede toți pașii, inclusiv Hosting', () => {
		const ids = getTourSteps(true).map((s) => s.id);
		expect(ids).toContain('hosting');
		expect(ids).toContain('contracts');
		expect(ids[0]).toBe('dashboard');
		expect(ids[ids.length - 1]).toBe('settings');
	});

	test('contactul secundar nu vede pașii doar-pentru-primar', () => {
		const ids = getTourSteps(false).map((s) => s.id);
		expect(ids).not.toContain('hosting');
		expect(ids).not.toContain('invoices');
		expect(ids).toContain('tasks');
	});

	test("scope 'hosting': doar dashboard, invoices, hosting, settings — în ordinea meniului", () => {
		expect(getTourSteps(true, 'hosting').map((s) => s.id)).toEqual([
			'dashboard',
			'invoices',
			'hosting',
			'settings'
		]);
	});

	test("scope 'hosting': descrierile nu mai vorbesc de task-uri, contracte sau ads", () => {
		const text = getTourSteps(true, 'hosting')
			.map((s) => s.description)
			.join(' ')
			.toLowerCase();
		expect(text).not.toMatch(/task|contract|ads/);
		expect(text).toMatch(/hosting/);
	});

	test("scope 'hosting' + contact secundar: rămân doar pașii publici din set", () => {
		expect(getTourSteps(false, 'hosting').map((s) => s.id)).toEqual(['dashboard', 'settings']);
	});

	test('scope necunoscut / lipsă = full', () => {
		expect(getTourSteps(true, 'altceva')).toEqual(getTourSteps(true));
		expect(getTourSteps(true)).toEqual(getTourSteps(true, 'full'));
	});
});

describe('getChecklistItems', () => {
	test('oglindește pașii, cu label și path', () => {
		expect(getChecklistItems(true, 'hosting')).toEqual([
			{ id: 'dashboard', label: 'Bine ai venit!', path: 'dashboard' },
			{ id: 'invoices', label: 'Facturi', path: 'invoices' },
			{ id: 'hosting', label: 'Hosting', path: 'hosting' },
			{ id: 'settings', label: 'Setări', path: 'settings' }
		]);
	});
});
