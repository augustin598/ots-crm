import { describe, it, expect } from 'bun:test';
import { hasLocalCollection, hasPaymentReference, resolveKeezInvoiceStatus } from './invoice-status';

const DUE_PAST = new Date('2026-08-02T22:00:00.000Z');
const DUE_FUTURE = new Date('2099-01-01T00:00:00.000Z');
const TOTAL = 90629;

/** Factura OTSH 8: achitată cu cardul în CRM, încasarea NU e înregistrată în Keez. */
function paidByCard(overrides: Record<string, unknown> = {}) {
	return {
		status: 'paid',
		paidDate: new Date('2026-08-31T00:30:00.829Z'),
		stripePaymentIntentId: 'pi_3U3WuQHcO0rcngck0lebU1yV',
		externalTransactionId: 'pi_3U3WuQHcO0rcngck0lebU1yV',
		...overrides
	};
}

describe('hasLocalCollection', () => {
	it('recunoaște încasarea cu cardul înregistrată în CRM', () => {
		expect(hasLocalCollection(paidByCard())).toBe(true);
	});

	it('recunoaște încasarea OP/cash marcată de staff', () => {
		expect(
			hasLocalCollection({
				status: 'paid',
				paidDate: new Date('2026-08-31T00:30:00.829Z'),
				stripePaymentIntentId: null,
				externalTransactionId: 'OP 1234'
			})
		).toBe(true);
	});

	it('recunoaște încasarea și pe o factură retrogradată deja de un sync anterior', () => {
		// auto-reparare: OTSH 8 rămăsese pe `overdue` după sync-ul din 5 sep
		expect(hasLocalCollection(paidByCard({ status: 'overdue' }))).toBe(true);
	});

	it('NU consideră încasare activă o factură stornată/rambursată', () => {
		expect(hasLocalCollection(paidByCard({ status: 'refunded' }))).toBe(false);
		expect(hasLocalCollection(paidByCard({ status: 'cancelled' }))).toBe(false);
	});

	it('acceptă și marcarea manuală / potrivirea bancară, fără referință de plată', () => {
		// „Marchează achitată" din /invoices și matcher-ul bancar scriu doar
		// status + paidDate — suficient cât să NU fie retrogradate de Keez.
		expect(
			hasLocalCollection({
				status: 'paid',
				paidDate: new Date('2026-08-31T00:30:00.829Z'),
				stripePaymentIntentId: null,
				externalTransactionId: null
			})
		).toBe(true);
	});

	it('NU consideră încasare locală o factură neachitată', () => {
		expect(
			hasLocalCollection({
				status: 'overdue',
				paidDate: null,
				stripePaymentIntentId: null,
				externalTransactionId: 'pi_x'
			})
		).toBe(false);
	});

	it('tratează lipsa facturii locale ca „fără încasare"', () => {
		expect(hasLocalCollection(null)).toBe(false);
		expect(hasLocalCollection(undefined)).toBe(false);
	});
});

describe('hasPaymentReference', () => {
	it('cere referința plății, nu doar paidDate', () => {
		expect(hasPaymentReference(paidByCard())).toBe(true);
		expect(
			hasPaymentReference({
				status: 'paid',
				paidDate: new Date('2026-08-31T00:30:00.829Z'),
				stripePaymentIntentId: null,
				externalTransactionId: null
			})
		).toBe(false);
	});

	it('nu repară o factură rambursată', () => {
		expect(hasPaymentReference(paidByCard({ status: 'refunded' }))).toBe(false);
	});
});

describe('resolveKeezInvoiceStatus', () => {
	it('marchează achitat când Keez nu mai are rest de încasat', () => {
		const r = resolveKeezInvoiceStatus({
			keezStatus: 'Valid',
			remainingAmount: 0,
			totalAmount: TOTAL,
			dueDate: DUE_PAST
		});
		expect(r.status).toBe('paid');
		expect(r.remainingAmountCents).toBe(0);
		expect(r.keptLocalPayment).toBe(false);
	});

	it('marchează restanță când Keez are rest integral și scadența a trecut', () => {
		const r = resolveKeezInvoiceStatus({
			keezStatus: 'Valid',
			remainingAmount: 906.29,
			totalAmount: TOTAL,
			dueDate: DUE_PAST
		});
		expect(r.status).toBe('overdue');
	});

	it('marchează trimisă când Keez are rest integral, dar scadența nu a trecut', () => {
		const r = resolveKeezInvoiceStatus({
			keezStatus: 'Valid',
			remainingAmount: 906.29,
			totalAmount: TOTAL,
			dueDate: DUE_FUTURE
		});
		expect(r.status).toBe('sent');
	});

	it('marchează parțial când Keez are rest sub total', () => {
		const r = resolveKeezInvoiceStatus({
			keezStatus: 'Valid',
			remainingAmount: 100,
			totalAmount: TOTAL,
			dueDate: DUE_PAST
		});
		expect(r.status).toBe('partially_paid');
		expect(r.remainingAmountCents).toBe(10000);
	});

	// Bugul OTSH 8 (2026-09-05): plata cu cardul e înregistrată doar în CRM,
	// Keez rămâne cu rest integral → sync-ul o retrograda la `overdue`,
	// iar factura apărea „Restantă" în /invoices?status=overdue și pe
	// cardul contului de hosting, deși avea dată de plată.
	it('NU retrogradează la overdue o factură cu încasare înregistrată în CRM', () => {
		const r = resolveKeezInvoiceStatus({
			keezStatus: 'Valid',
			remainingAmount: 906.29,
			totalAmount: TOTAL,
			dueDate: DUE_PAST,
			existing: paidByCard()
		});
		expect(r.status).toBe('paid');
		expect(r.keptLocalPayment).toBe(true);
		// restul din Keez rămâne vizibil pentru contabilitate
		expect(r.remainingAmountCents).toBe(TOTAL);
	});

	it('NU retrogradează la partially_paid o factură achitată în CRM', () => {
		const r = resolveKeezInvoiceStatus({
			keezStatus: 'Valid',
			remainingAmount: 100,
			totalAmount: TOTAL,
			dueDate: DUE_PAST,
			existing: paidByCard()
		});
		expect(r.status).toBe('paid');
		expect(r.keptLocalPayment).toBe(true);
	});

	it('lasă stornoul din Keez să anuleze factura chiar și achitată în CRM', () => {
		const r = resolveKeezInvoiceStatus({
			keezStatus: 'Cancelled',
			remainingAmount: 906.29,
			totalAmount: TOTAL,
			dueDate: DUE_PAST,
			existing: paidByCard()
		});
		expect(r.status).toBe('cancelled');
		expect(r.keptLocalPayment).toBe(false);
	});

	it('nu retrogradează nici factura marcată achitată manual (fără referință)', () => {
		// CRM = sursa de adevăr pentru încasări; o încasare ștearsă în Keez se
		// corectează tot din CRM, nu prin retrogradare silențioasă la sync.
		const r = resolveKeezInvoiceStatus({
			keezStatus: 'Valid',
			remainingAmount: 906.29,
			totalAmount: TOTAL,
			dueDate: DUE_PAST,
			existing: { status: 'paid', paidDate: new Date(), stripePaymentIntentId: null, externalTransactionId: null }
		});
		expect(r.status).toBe('paid');
		expect(r.keptLocalPayment).toBe(true);
	});

	it('retrogradează normal o factură fără nicio urmă de încasare', () => {
		const r = resolveKeezInvoiceStatus({
			keezStatus: 'Valid',
			remainingAmount: 906.29,
			totalAmount: TOTAL,
			dueDate: DUE_PAST,
			existing: { status: 'sent', paidDate: null, stripePaymentIntentId: null, externalTransactionId: null }
		});
		expect(r.status).toBe('overdue');
		expect(r.keptLocalPayment).toBe(false);
	});

	it('repară factura retrogradată anterior: overdue → paid la următorul sync', () => {
		const r = resolveKeezInvoiceStatus({
			keezStatus: 'Valid',
			remainingAmount: 906.29,
			totalAmount: TOTAL,
			dueDate: DUE_PAST,
			existing: paidByCard({ status: 'overdue' }),
			fallbackStatus: 'overdue'
		});
		expect(r.status).toBe('paid');
		expect(r.keptLocalPayment).toBe(true);
	});

	it('NU reînvie ca achitată o factură rambursată integral', () => {
		const r = resolveKeezInvoiceStatus({
			keezStatus: 'Valid',
			remainingAmount: 906.29,
			totalAmount: TOTAL,
			dueDate: DUE_PAST,
			existing: paidByCard({ status: 'refunded' }),
			fallbackStatus: 'refunded' as never
		});
		expect(r.status).toBe('overdue');
		expect(r.keptLocalPayment).toBe(false);
	});

	it('rest negativ (storno / încasare în plus) nu schimbă statusul', () => {
		const r = resolveKeezInvoiceStatus({
			keezStatus: 'Valid',
			remainingAmount: -906.29,
			totalAmount: -TOTAL,
			dueDate: DUE_PAST,
			fallbackStatus: 'sent'
		});
		expect(r.status).toBe('sent');
		expect(r.remainingAmountCents).toBe(-TOTAL);
	});

	it('NU repară statusul unei facturi cu paidDate fără referință de plată', () => {
		// paidDate rămas dintr-o marcare greșită, corectată manual pe overdue
		const r = resolveKeezInvoiceStatus({
			keezStatus: 'Valid',
			remainingAmount: 906.29,
			totalAmount: TOTAL,
			dueDate: DUE_PAST,
			existing: {
				status: 'overdue',
				paidDate: new Date('2026-08-31T00:30:00.829Z'),
				stripePaymentIntentId: null,
				externalTransactionId: null
			},
			fallbackStatus: 'overdue'
		});
		expect(r.status).toBe('overdue');
	});

	it('proforma (Draft în Keez) rămâne ciornă', () => {
		const r = resolveKeezInvoiceStatus({
			keezStatus: 'Draft',
			remainingAmount: 0,
			totalAmount: TOTAL,
			dueDate: DUE_PAST
		});
		expect(r.status).toBe('draft');
	});

	it('proforma de hosting trimisă clientului nu e retrogradată la ciornă de sync', () => {
		// OTSH 12 ca proformă: auto-send o pune pe `sent`; `draft` nu ar mai fi
		// plătibilă prin OP/cash din contul de hosting.
		for (const local of ['sent', 'overdue', 'partially_paid'] as const) {
			const r = resolveKeezInvoiceStatus({
				keezStatus: 'Draft',
				remainingAmount: TOTAL / 100,
				totalAmount: TOTAL,
				dueDate: DUE_PAST,
				existing: { status: local, paidDate: null }
			});
			expect(r.status).toBe(local);
		}
	});

	it('proforma încasată în CRM (validarea Keez a eșuat) rămâne achitată', () => {
		const r = resolveKeezInvoiceStatus({
			keezStatus: 'Draft',
			remainingAmount: TOTAL / 100,
			totalAmount: TOTAL,
			dueDate: DUE_PAST,
			existing: paidByCard()
		});
		expect(r.status).toBe('paid');
	});

	it('factura de ore rambursată (Draft în Keez) nu redevine ciornă și nici achitată', () => {
		const r = resolveKeezInvoiceStatus({
			keezStatus: 'Draft',
			remainingAmount: TOTAL / 100,
			totalAmount: TOTAL,
			dueDate: DUE_PAST,
			existing: paidByCard({ status: 'refunded' })
		});
		expect(r.status).toBe('refunded');
	});

	it('proforma încă netrimisă rămâne ciornă', () => {
		const r = resolveKeezInvoiceStatus({
			keezStatus: 'Draft',
			remainingAmount: TOTAL / 100,
			totalAmount: TOTAL,
			dueDate: DUE_FUTURE,
			existing: { status: 'draft', paidDate: null }
		});
		expect(r.status).toBe('draft');
	});

	it('fără remainingAmount pe document validat → trimisă', () => {
		const r = resolveKeezInvoiceStatus({
			keezStatus: 'Valid',
			remainingAmount: undefined,
			totalAmount: TOTAL,
			dueDate: DUE_PAST
		});
		expect(r.status).toBe('sent');
		expect(r.remainingAmountCents).toBeNull();
	});

	it('status necunoscut fără remainingAmount păstrează statusul curent', () => {
		const r = resolveKeezInvoiceStatus({
			keezStatus: null,
			remainingAmount: undefined,
			totalAmount: TOTAL,
			dueDate: DUE_PAST,
			fallbackStatus: 'sent'
		});
		expect(r.status).toBe('sent');
	});
});
