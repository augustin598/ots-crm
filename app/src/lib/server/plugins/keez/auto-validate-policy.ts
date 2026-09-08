/**
 * Politica de validare (Draft/proformă → Valid/fiscală) a documentelor din Keez.
 *
 * Context (incident 2026-09-03, OTSH 12 + OTSH 13): hook-ul `onInvoiceCreated`
 * valida automat ORICE factură venită dintr-un șablon recurent, deci fiecare
 * reînnoire de hosting generată de scheduler devenea factură fiscală (și era
 * depusă la ANAF prin e-Factura) în secunda în care era creată — pentru un
 * serviciu neîncasat. Corecția: storno + reemitere.
 *
 * Regula de business (fixă, nu configurabilă):
 *   - facturile de hosting sunt PROFORME (Keez `Draft`) de fiecare dată;
 *   - devin fiscale DOAR când încasarea e înregistrată în CRM (card Stripe,
 *     OP/cash marcat de staff, „Marchează achitată");
 *   - facturile manuale rămân proforme până le validează staff-ul din UI;
 *   - șabloanele recurente NON-hosting (abonamente lunare OTS) păstrează
 *     validarea la creare, comportamentul de dinainte.
 *
 * Funcții pure, fără DB — testate în `auto-validate-policy.test.ts`.
 */

export type AutoValidateDecision = { validate: boolean; reason: string };

/** Decizia la `invoice.created`: validăm imediat documentul abia creat în Keez? */
export function shouldAutoValidateOnCreate(input: {
	isRecurring: boolean;
	hostingAccountId: string | null | undefined;
}): AutoValidateDecision {
	if (input.hostingAccountId) {
		return { validate: false, reason: 'hosting-proforma-until-paid' };
	}
	if (!input.isRecurring) {
		return { validate: false, reason: 'manual-invoice' };
	}
	return { validate: true, reason: 'recurring-non-hosting' };
}

/** Statusuri Keez care înseamnă că documentul NU mai e o ciornă. */
const NOT_A_DRAFT = ['Valid', 'Cancelled', 'Canceled'];

/** Decizia la `invoice.paid`: proforma din Keez trebuie transformată în factură fiscală? */
export function shouldValidateOnPaid(invoice: {
	keezExternalId?: string | null;
	keezStatus?: string | null;
	status?: string | null;
	isCreditNote?: boolean | null;
}): AutoValidateDecision {
	if (!invoice.keezExternalId) return { validate: false, reason: 'not-in-keez' };
	if (invoice.isCreditNote) return { validate: false, reason: 'credit-note' };
	if (invoice.keezStatus && NOT_A_DRAFT.includes(invoice.keezStatus)) {
		return { validate: false, reason: 'not-a-draft' };
	}
	if (invoice.status !== 'paid') return { validate: false, reason: 'not-fully-paid' };
	return { validate: true, reason: 'paid-proforma' };
}

/**
 * Statusul CRM după validarea în Keez. Înainte se scria necondiționat `sent`,
 * ceea ce ar retrograda o factură deja încasată — exact cazul principal de
 * acum, când validarea se face DUPĂ plată.
 */
export function statusAfterKeezValidation(current: string | null | undefined): string {
	if (!current || current === 'draft') return 'sent';
	return current;
}
