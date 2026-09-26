import { describe, test, expect, mock } from 'bun:test';

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));

const { buildBillingUpdateFromOrder } = await import('../hosting/billing-from-order');

const ADDRESS = {
	phone: '0722 123 456',
	address: 'Str. Universității 12',
	city: 'Suceava',
	county: 'Suceava',
	postalCode: '720229'
};

describe('buildBillingUpdateFromOrder', () => {
	test('persoană juridică plătitoare de TVA', () => {
		expect(
			buildBillingUpdateFromOrder({
				billingType: 'company',
				cui: 'RO12345678',
				vatPayer: true,
				companyName: '  Helen’s SRL ',
				registrationNumber: 'J33/206/1999',
				...ADDRESS
			})
		).toEqual({
			name: 'Helen’s SRL',
			businessName: 'Helen’s SRL',
			cui: '12345678',
			vatNumber: 'RO12345678',
			registrationNumber: 'J33/206/1999',
			legalType: 'srl',
			country: 'RO',
			...ADDRESS
		});
	});

	test('persoană juridică neplătitoare: vatNumber = CUI fără RO', () => {
		const r = buildBillingUpdateFromOrder({
			billingType: 'company',
			cui: '12345678',
			vatPayer: false,
			companyName: 'Monte Pizza SRL'
		});
		expect(r.vatNumber).toBe('12345678');
		expect(r.cui).toBe('12345678');
	});

	test('persoană fizică: nume din prenume + nume, câmpurile de firmă golite explicit', () => {
		expect(
			buildBillingUpdateFromOrder({
				billingType: 'person',
				firstName: ' Ion ',
				lastName: 'Popescu',
				...ADDRESS
			})
		).toEqual({
			name: 'Ion Popescu',
			businessName: null,
			cui: null,
			vatNumber: null,
			registrationNumber: null,
			legalType: 'pf',
			country: 'RO',
			...ADDRESS
		});
	});

	test('câmpurile de adresă lipsă nu apar (nu suprascriu ce avea clientul)', () => {
		const r = buildBillingUpdateFromOrder({ billingType: 'person', firstName: 'Ana', lastName: 'Ionescu' });
		expect('address' in r).toBe(false);
		expect('phone' in r).toBe(false);
		expect('city' in r).toBe(false);
	});

	test('firmă fără registrationNumber → cheia lipsește, nu null', () => {
		const r = buildBillingUpdateFromOrder({
			billingType: 'company',
			cui: '12345678',
			vatPayer: true,
			companyName: 'Firma SRL'
		});
		expect('registrationNumber' in r).toBe(false);
	});
});
