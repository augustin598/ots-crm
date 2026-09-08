import { describe, it, expect } from 'bun:test';
import {
	shouldAutoValidateOnCreate,
	shouldValidateOnPaid,
	statusAfterKeezValidation
} from './auto-validate-policy';

// Incident 2026-09-03: OTSH 12 (service-gsm-suceava.ro) a fost generată de
// scheduler, creată în Keez ca Draft și validată în aceeași secundă → factură
// fiscală depusă la ANAF pentru un serviciu neplătit. Regula de business:
// facturile de hosting sunt PROFORME și devin fiscale DOAR după încasare.

describe('shouldAutoValidateOnCreate', () => {
	it('NU validează niciodată o factură de hosting la creare, nici din scheduler', () => {
		const d = shouldAutoValidateOnCreate({
			isRecurring: true,
			hostingAccountId: '3uzg7o5faezbcwc772rw3bnl'
		});
		expect(d.validate).toBe(false);
		expect(d.reason).toBe('hosting-proforma-until-paid');
	});

	it('NU validează o factură de hosting creată manual', () => {
		const d = shouldAutoValidateOnCreate({ isRecurring: false, hostingAccountId: 'acc' });
		expect(d.validate).toBe(false);
	});

	it('NU validează facturile manuale (rămân proforme, staff-ul validează)', () => {
		const d = shouldAutoValidateOnCreate({ isRecurring: false, hostingAccountId: null });
		expect(d.validate).toBe(false);
		expect(d.reason).toBe('manual-invoice');
	});

	it('păstrează validarea automată pentru șabloanele recurente NON-hosting', () => {
		const d = shouldAutoValidateOnCreate({ isRecurring: true, hostingAccountId: null });
		expect(d.validate).toBe(true);
		expect(d.reason).toBe('recurring-non-hosting');
	});

	it('tratează undefined ca „fără cont de hosting"', () => {
		const d = shouldAutoValidateOnCreate({ isRecurring: true, hostingAccountId: undefined });
		expect(d.validate).toBe(true);
	});
});

describe('shouldValidateOnPaid', () => {
	const base = {
		keezExternalId: '844091798b934c71ae24e7546169bbd2',
		keezStatus: 'Draft',
		status: 'paid',
		isCreditNote: false
	};

	it('validează proforma din Keez când factura a fost încasată', () => {
		const d = shouldValidateOnPaid(base);
		expect(d.validate).toBe(true);
		expect(d.reason).toBe('paid-proforma');
	});

	it('nu face nimic dacă factura nu e în Keez', () => {
		expect(shouldValidateOnPaid({ ...base, keezExternalId: null }).validate).toBe(false);
		expect(shouldValidateOnPaid({ ...base, keezExternalId: '' }).validate).toBe(false);
	});

	it('nu re-validează un document deja fiscal sau stornat', () => {
		expect(shouldValidateOnPaid({ ...base, keezStatus: 'Valid' }).validate).toBe(false);
		expect(shouldValidateOnPaid({ ...base, keezStatus: 'Cancelled' }).validate).toBe(false);
		expect(shouldValidateOnPaid({ ...base, keezStatus: 'Canceled' }).validate).toBe(false);
	});

	it('nu validează dacă statusul CRM nu e „paid" (ex. evenimentul a venit pe partially_paid)', () => {
		expect(shouldValidateOnPaid({ ...base, status: 'partially_paid' }).validate).toBe(false);
		expect(shouldValidateOnPaid({ ...base, status: 'sent' }).validate).toBe(false);
	});

	it('nu atinge notele de credit', () => {
		expect(shouldValidateOnPaid({ ...base, isCreditNote: true }).validate).toBe(false);
	});

	it('un keezStatus lipsă e tratat ca proformă (facturile vechi importate fără status)', () => {
		expect(shouldValidateOnPaid({ ...base, keezStatus: null }).validate).toBe(true);
	});
});

describe('statusAfterKeezValidation', () => {
	it('ridică o ciornă la „sent"', () => {
		expect(statusAfterKeezValidation('draft')).toBe('sent');
	});

	it('NU retrogradează o factură încasată la „sent" (validarea vine DUPĂ plată)', () => {
		expect(statusAfterKeezValidation('paid')).toBe('paid');
		expect(statusAfterKeezValidation('partially_paid')).toBe('partially_paid');
	});

	it('păstrează „overdue" și „sent"', () => {
		expect(statusAfterKeezValidation('overdue')).toBe('overdue');
		expect(statusAfterKeezValidation('sent')).toBe('sent');
	});

	it('status necunoscut/lipsă → „sent"', () => {
		expect(statusAfterKeezValidation(null)).toBe('sent');
		expect(statusAfterKeezValidation('')).toBe('sent');
	});
});
