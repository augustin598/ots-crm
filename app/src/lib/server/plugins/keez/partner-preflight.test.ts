import { describe, it, expect } from 'bun:test';
import { isKeezLegalPerson, keezPartnerPreflight } from './partner-preflight';

describe('isKeezLegalPerson', () => {
	it('companyType populat = persoană juridică (import vechi)', () => {
		expect(isKeezLegalPerson({ companyType: 'SRL' })).toBe(true);
	});

	it('legalType din checkout-ul de hosting', () => {
		expect(isKeezLegalPerson({ legalType: 'srl' })).toBe(true);
		expect(isKeezLegalPerson({ legalType: 'pf' })).toBe(false);
		expect(isKeezLegalPerson({ legalType: 'PFA' })).toBe(false);
	});

	it('businessName completat semnalează firmă, dacă nu e explicit PF', () => {
		expect(isKeezLegalPerson({ businessName: 'SOLX S.R.L' })).toBe(true);
		expect(isKeezLegalPerson({ businessName: 'Ion Popescu', legalType: 'pf' })).toBe(false);
	});

	it('fără niciun indiciu = persoană fizică', () => {
		expect(isKeezLegalPerson({})).toBe(false);
	});
});

describe('keezPartnerPreflight', () => {
	it('SOLX S.R.L fără CUI e refuzată înainte de orice apel Keez', () => {
		const problem = keezPartnerPreflight({
			name: 'SOLX S.R.L',
			cui: null,
			companyType: null,
			legalType: null,
			businessName: 'SOLX S.R.L'
		});
		expect(problem?.code).toBe('missing_cui');
		expect(problem?.message).toContain('SOLX S.R.L');
		expect(problem?.message).toContain('CUI');
	});

	it('CUI doar din spații = lipsă', () => {
		expect(keezPartnerPreflight({ name: 'X', cui: '   ', companyType: 'SRL' })?.code).toBe(
			'missing_cui'
		);
	});

	it('persoana juridică cu CUI trece', () => {
		expect(
			keezPartnerPreflight({ name: 'GSM ORIZONT S.R.L.', cui: '53674127', companyType: 'SRL' })
		).toBeNull();
	});

	it('persoana fizică fără CUI trece (Keez nu cere CUI la PF)', () => {
		expect(keezPartnerPreflight({ name: 'Dobos Oana', cui: null, legalType: 'pf' })).toBeNull();
		expect(keezPartnerPreflight({ name: 'Dobos Oana', cui: null })).toBeNull();
	});
});
