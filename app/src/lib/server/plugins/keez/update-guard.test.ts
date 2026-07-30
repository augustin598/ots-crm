import { describe, it, expect } from 'bun:test';
import { keezUpdateSkipReason } from './update-guard';

// Stand-in minimal pentru rândul `invoice` — guard-ul citește doar câmpurile
// din payload-ul Keez + status/paidDate/keezStatus.
function invoiceRow(overrides: Record<string, unknown> = {}) {
	return {
		id: 'inv_1',
		clientId: 'cli_1',
		invoiceNumber: 'OTSH 9',
		invoiceSeries: null,
		issueDate: new Date('2026-07-24T21:00:00.000Z'),
		dueDate: new Date('2026-08-08T21:00:00.000Z'),
		currency: 'RON',
		invoiceCurrency: null,
		exchangeRate: null,
		amount: 74900,
		taxRate: 2100,
		taxAmount: 15729,
		totalAmount: 90629,
		discountType: null,
		discountValue: null,
		notes: null,
		paymentMethod: null,
		paymentTerms: null,
		taxApplicationType: 'apply',
		vatOnCollection: false,
		isCreditNote: false,
		status: 'sent',
		paidDate: null as Date | null,
		keezStatus: 'Draft' as string | null,
		updatedAt: new Date('2026-07-25T10:00:00.000Z'),
		...overrides
	};
}

describe('keezUpdateSkipReason', () => {
	it('sare peste push pe document validat în Keez', () => {
		const prev = invoiceRow({ keezStatus: 'Valid' });
		const next = invoiceRow({ keezStatus: 'Valid', notes: 'text nou' });
		expect(keezUpdateSkipReason(next, prev)).toBe('validated-document');
	});

	it('sare peste push pe document stornat în Keez', () => {
		const prev = invoiceRow({ keezStatus: 'Cancelled' });
		expect(keezUpdateSkipReason(invoiceRow({ keezStatus: 'Cancelled' }), prev)).toBe(
			'validated-document'
		);
	});

	it('sare peste push când s-a schimbat doar încasarea (markInvoiceAsPaid)', () => {
		const prev = invoiceRow();
		const next = invoiceRow({
			status: 'paid',
			paidDate: new Date('2026-07-30T07:57:18.217Z'),
			updatedAt: new Date('2026-07-30T07:57:18.217Z')
		});
		expect(keezUpdateSkipReason(next, prev)).toBe('payment-only-change');
	});

	it('trimite push când s-a schimbat un câmp din payload odată cu statusul', () => {
		const prev = invoiceRow();
		const next = invoiceRow({ status: 'paid', totalAmount: 100000 });
		expect(keezUpdateSkipReason(next, prev)).toBeNull();
	});

	it('trimite push la editare de conținut (notă, dată, sumă)', () => {
		const prev = invoiceRow();
		expect(keezUpdateSkipReason(invoiceRow({ notes: 'observație' }), prev)).toBeNull();
		expect(
			keezUpdateSkipReason(invoiceRow({ issueDate: new Date('2026-07-28T21:00:00.000Z') }), prev)
		).toBeNull();
		expect(keezUpdateSkipReason(invoiceRow({ amount: 80000 }), prev)).toBeNull();
	});

	it('trimite push la editare doar pe linii (header neschimbat, fără status)', () => {
		// `lineItems` nu vine în `previousInvoice`; dacă header-ul nu s-a mișcat
		// și nici încasarea, nu avem dovadă că e o schimbare irelevantă → push.
		const prev = invoiceRow();
		const next = invoiceRow({ updatedAt: new Date('2026-07-26T10:00:00.000Z') });
		expect(keezUpdateSkipReason(next, prev)).toBeNull();
	});

	it('tratează datele identice ca Date și ca string ISO fără fals-pozitiv', () => {
		const prev = invoiceRow({ issueDate: new Date('2026-07-24T21:00:00.000Z') });
		const next = invoiceRow({
			issueDate: new Date('2026-07-24T21:00:00.000Z'),
			status: 'paid',
			paidDate: new Date('2026-07-30T07:57:18.217Z')
		});
		expect(keezUpdateSkipReason(next, prev)).toBe('payment-only-change');
	});

	it('trimite push când lipsește previousInvoice', () => {
		expect(keezUpdateSkipReason(invoiceRow({ status: 'paid' }), null)).toBeNull();
	});
});
