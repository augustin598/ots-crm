import { describe, it, expect } from 'bun:test';
import { canRollbackCreatedInvoice } from './rollback-policy';

describe('canRollbackCreatedInvoice', () => {
	it('fără document în Keez, rândul CRM poate fi șters', () => {
		expect(canRollbackCreatedInvoice({ keezExternalId: null })).toBe(true);
		expect(canRollbackCreatedInvoice({ keezExternalId: undefined })).toBe(true);
		expect(canRollbackCreatedInvoice({ keezExternalId: '' })).toBe(true);
	});

	it('odată creat în Keez, rândul CRM NU se mai șterge (cazul OTSH 13 orfan)', () => {
		expect(canRollbackCreatedInvoice({ keezExternalId: '55485de071494e9d9361edc5b0f73616' })).toBe(
			false
		);
	});
});
