/**
 * Reguli pure pentru „poate fi plătită factura asta cu cardul?".
 *
 * Trăiesc separat de remote și de pagină pentru că AMBELE trebuie să dea același
 * răspuns: pagina decide dacă afișează cardul de plată, remote-ul decide dacă
 * acceptă plata. Divergența dintre ele ar însemna un buton care duce la eroare.
 *
 * Fără I/O — configurarea Stripe pe tenant se verifică separat, la apelant.
 */

/** Statusuri de factură pentru care acceptăm plata cu cardul. */
export const PAYABLE_INVOICE_STATUSES = ['draft', 'sent', 'overdue'] as const;

/**
 * Suma minimă acceptată de Stripe, în subunități (bani/cenți). Sub prag, API-ul
 * întoarce `amount_too_small` cu un mesaj criptic pentru client.
 * Sursa: https://docs.stripe.com/currencies#minimum-and-maximum-charge-amounts
 */
const MIN_CARD_AMOUNT_BY_CURRENCY: Record<string, number> = {
	RON: 200, // 2,00 RON
	EUR: 50, // 0,50 EUR
	USD: 50 // 0,50 USD
};

/** Prag conservator pentru monede necunoscute — mai bine refuzăm decât să eșuăm la Stripe. */
const MIN_CARD_AMOUNT_FALLBACK = 200;

export function minCardAmountCents(currency: string | null | undefined): number {
	if (!currency) return MIN_CARD_AMOUNT_FALLBACK;
	return MIN_CARD_AMOUNT_BY_CURRENCY[currency.toUpperCase()] ?? MIN_CARD_AMOUNT_FALLBACK;
}

export function isPayableInvoiceStatus(status: string | null | undefined): boolean {
	if (!status) return false;
	return (PAYABLE_INVOICE_STATUSES as readonly string[]).includes(status);
}

export type CardPaymentEligibility =
	| { eligible: true }
	| { eligible: false; reason: 'already_paid' | 'status' | 'amount' };

/**
 * `already_paid` e separat de `status` pentru că nu e o eroare: UI-ul arată
 * „factura e deja achitată", nu „nu poți plăti".
 *
 * `partially_paid` e respins intenționat — webhook-ul marchează factura integral
 * plătită, deci plata restului ar produce o factură „paid" pentru o sumă parțială.
 */
export function checkCardPaymentEligibility(invoice: {
	status: string | null | undefined;
	totalAmount: number | null | undefined;
	currency: string | null | undefined;
}): CardPaymentEligibility {
	if (invoice.status === 'paid') return { eligible: false, reason: 'already_paid' };
	if (!isPayableInvoiceStatus(invoice.status)) return { eligible: false, reason: 'status' };

	const total = invoice.totalAmount ?? 0;
	if (total <= 0 || total < minCardAmountCents(invoice.currency)) {
		return { eligible: false, reason: 'amount' };
	}

	return { eligible: true };
}

/**
 * Varianta pentru PORTAL (sesiune de client, fără token): exclude ciornele.
 *
 * Pe fluxul public `draft` e tolerat pentru că tokenul de vizualizare se emite
 * DOAR la trimiterea facturii prin email (deci o ciornă nu are link de plată).
 * Portalul însă listează TOATE facturile clientului, inclusiv ciornele pe care
 * staff-ul încă le editează — o ciornă plătită ar deveni „paid" fără factură
 * fiscală Keez și cu o sumă posibil neterminată. Folosit și de `getInvoices`
 * (butonul din UI) și de `createClientInvoicePaymentIntent` (acceptarea plății),
 * ca cele două să nu poată diverge.
 */
export function checkPortalCardPaymentEligibility(invoice: {
	status: string | null | undefined;
	totalAmount: number | null | undefined;
	currency: string | null | undefined;
}): CardPaymentEligibility {
	if (invoice.status === 'draft') return { eligible: false, reason: 'status' };
	return checkCardPaymentEligibility(invoice);
}
