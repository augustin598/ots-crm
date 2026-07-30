/**
 * Guard pentru push-ul de update către Keez (`onInvoiceUpdated`).
 *
 * Context (bug 2026-07-30): `markInvoiceAsPaid` emite `invoice.updated`, iar
 * hook-ul trimitea un PUT complet al documentului deși se schimbaseră doar
 * `status` + `paidDate` — câmpuri care nici măcar nu ajung în payload-ul Keez
 * (încasările se țin separat de document). Pe o factură deja validată care nu
 * mai e ultima din serie, Keez respinge orice modificare cu
 * `ERROR_DOCUMENT_DATE_GRATER_THEN_LAST_INVOICE_DATE`, așa că fiecare
 * „marchează ca plătită" pe o factură mai veche decât ultimul storno pica cu 400
 * și lăsa `keez_invoice_sync` pe `error`.
 */

/**
 * Câmpurile de pe `invoice` care ajung efectiv în payload-ul trimis la Keez
 * (vezi `mapInvoiceToKeez`). Doar o modificare pe unul dintre ele justifică un
 * push; restul coloanelor sunt stare internă CRM sau ecou al sincronizării.
 *
 * `lineItems` NU e aici pentru că nu vine în `previousInvoice` — de aceea
 * `payment-only-change` cere explicit o schimbare pe `status`/`paidDate`, ca o
 * editare doar pe linii (care nu mișcă niciun câmp de header) să treacă mai
 * departe la push.
 */
export const KEEZ_PAYLOAD_FIELDS = [
	'clientId',
	'invoiceNumber',
	'invoiceSeries',
	'issueDate',
	'dueDate',
	'currency',
	'invoiceCurrency',
	'exchangeRate',
	'amount',
	'taxRate',
	'taxAmount',
	'totalAmount',
	'discountType',
	'discountValue',
	'notes',
	'paymentMethod',
	'paymentTerms',
	'taxApplicationType',
	'vatOnCollection',
	'isCreditNote'
] as const;

/** Câmpuri pur interne de încasare — Keez ține încasările separat de document. */
export const PAYMENT_ONLY_FIELDS = ['status', 'paidDate'] as const;

export type KeezUpdateSkipReason = 'validated-document' | 'payment-only-change';

type InvoiceLike = Record<string, unknown> & { keezStatus?: string | null };

/** Normalizează pentru comparație: datele vin ba ca `Date`, ba ca string ISO. */
function normalize(value: unknown): unknown {
	if (value instanceof Date) return value.getTime();
	if (value === undefined) return null;
	return value;
}

function changed(a: InvoiceLike, b: InvoiceLike, field: string): boolean {
	return !Object.is(normalize(a[field]), normalize(b[field]));
}

/**
 * Întoarce motivul pentru care push-ul către Keez trebuie sărit, sau `null`
 * dacă update-ul chiar trebuie propagat.
 *
 * @param invoice        factura după update
 * @param previousInvoice factura înainte de update (lipsește la unele emitente)
 */
export function keezUpdateSkipReason(
	invoice: InvoiceLike,
	previousInvoice: InvoiceLike | null | undefined
): KeezUpdateSkipReason | null {
	// 1. Document fiscal emis: imutabil în Keez, se corectează doar prin storno.
	//    Paritate cu `onInvoiceDeleted`, care are deja acest guard.
	if (invoice.keezStatus === 'Valid' || invoice.keezStatus === 'Cancelled') {
		return 'validated-document';
	}

	// 2. Fără `previousInvoice` nu putem calcula diff-ul — trimitem, ca înainte.
	if (!previousInvoice) return null;

	// 3. Schimbare doar de încasare (status/paidDate), fără niciun câmp din
	//    payload atins → Keez nu are ce face cu ea.
	const touchedPayload = KEEZ_PAYLOAD_FIELDS.some((f) => changed(invoice, previousInvoice, f));
	if (touchedPayload) return null;

	const touchedPayment = PAYMENT_ONLY_FIELDS.some((f) => changed(invoice, previousInvoice, f));
	return touchedPayment ? 'payment-only-change' : null;
}
