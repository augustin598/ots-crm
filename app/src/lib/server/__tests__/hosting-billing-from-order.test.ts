import { describe, test, expect, mock } from 'bun:test';

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));

const { buildBillingUpdateFromOrder, buildAddressUpdateFromOrder, decideOrderOwnership } = await import(
	'../hosting/billing-from-order'
);

describe('decideOrderOwnership', () => {
	const primaryNoCui = { isPrimary: true, email: 'Ion@Firma.ro', cui: null };

	test('anonim → nu e contul lui, nu se scrie nimic', () => {
		expect(decideOrderOwnership(null, 'ion@firma.ro')).toEqual({ ordersOnOwnAccount: false, canPatchIdentity: false });
	});

	test('contact primar fără CUI, cu emailul contului (case-insensitive) → poate scrie și identitatea', () => {
		expect(decideOrderOwnership(primaryNoCui, ' ION@firma.RO ')).toEqual({ ordersOnOwnAccount: true, canPatchIdentity: true });
	});

	test('contact primar, dar cu alt email decât al contului → cale anonimă', () => {
		expect(decideOrderOwnership(primaryNoCui, 'altcineva@firma.ro').ordersOnOwnAccount).toBe(false);
	});

	test('contact secundar cu emailul clientului → cale anonimă (nu-i rescrie firma)', () => {
		expect(decideOrderOwnership({ ...primaryNoCui, isPrimary: false }, 'ion@firma.ro')).toEqual({
			ordersOnOwnAccount: false,
			canPatchIdentity: false
		});
	});

	test('client cu CUI deja setat → comanda e a lui, dar identitatea fiscală rămâne', () => {
		expect(decideOrderOwnership({ ...primaryNoCui, cui: '11774376' }, 'ion@firma.ro')).toEqual({
			ordersOnOwnAccount: true,
			canPatchIdentity: false
		});
	});

	test('cont fără email sau email gol → niciodată al lui', () => {
		expect(decideOrderOwnership({ ...primaryNoCui, email: null }, '').ordersOnOwnAccount).toBe(false);
	});
});

describe('buildAddressUpdateFromOrder', () => {
	test('doar adresa/telefonul, fără nume/CUI/formă juridică', () => {
		const r = buildAddressUpdateFromOrder({
			billingType: 'company',
			cui: '12345678',
			companyName: 'Firma SRL',
			phone: '0722 123 456',
			city: 'Suceava',
			address: ''
		});
		expect(r).toEqual({ phone: '0722 123 456', city: 'Suceava' });
		expect('cui' in r).toBe(false);
		expect('name' in r).toBe(false);
	});
});

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
