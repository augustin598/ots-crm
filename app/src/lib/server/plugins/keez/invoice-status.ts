/**
 * Statusul facturii dedus din Keez — singura sursă pentru cele patru locuri
 * care oglindeau aceeași logică (sync.ts, auto-push.ts, keez.remote.ts,
 * mapper.ts).
 *
 * Context (bug 2026-09-05, factura OTSH 8): Keez ține încasările SEPARAT de
 * document, iar CRM-ul nu le împinge (vezi `update-guard.ts` —
 * `payment-only-change`). Deci o factură achitată în CRM (card prin Stripe sau
 * OP/cash marcat de staff) rămâne în Keez cu `remainingAmount` integral, iar
 * sincronizarea o retrograda la `overdue`: apărea „Restantă" în
 * /invoices?status=overdue și pe cardul contului de hosting, deși avea dată de
 * plată și PaymentIntent încasat.
 *
 * Regula: pentru încasări înregistrate în CRM (avem referință de plată),
 * CRM-ul e sursa de adevăr — Keez nu poate anula plata prin lipsa încasării.
 * Stornarea (`Cancelled`) și proforma (`Draft`) rămân autoritare în Keez,
 * pentru că sunt stări ale documentului, nu ale încasării.
 */

export type KeezDerivedStatus =
	| 'draft'
	| 'sent'
	| 'paid'
	| 'partially_paid'
	| 'overdue'
	| 'cancelled';

/** Ce citim din rândul `invoice` existent ca să știm dacă CRM-ul a încasat. */
export type LocalInvoiceCollection = {
	status?: string | null;
	paidDate?: Date | string | null;
	stripePaymentIntentId?: string | null;
	externalTransactionId?: string | null;
};

/**
 * Statusuri în care încasarea a fost anulată explicit — nu se mai restaurează
 * `paid` din ele, oricâte referințe de plată ar avea factura.
 * `refunded` e scris de webhook-ul `charge.refunded` FĂRĂ să șteargă `paidDate`.
 */
const COLLECTION_REVERSED = ['refunded', 'cancelled'];

/**
 * Dovada TARE a unei încasări proprii: referința plății — PaymentIntent-ul
 * Stripe pentru card, nr. de OP/chitanță pentru plățile offline, `transactionId`
 * din WHMCS. Sincronizarea Keez nu scrie niciodată aceste câmpuri (scrie doar
 * `status` + `paidDate`), deci prezența lor înseamnă că banii au intrat prin CRM.
 *
 * Singura dovadă acceptată pentru REPARAREA unui status deja retrogradat: fără
 * ea am reînvia ca „achitată" orice factură cu `paidDate` rămas din greșeală.
 */
export function hasPaymentReference(
	invoice: LocalInvoiceCollection | null | undefined
): boolean {
	if (!invoice) return false;
	if (!invoice.paidDate) return false;
	if (invoice.status && COLLECTION_REVERSED.includes(invoice.status)) return false;
	return Boolean(invoice.stripePaymentIntentId || invoice.externalTransactionId);
}

/**
 * CRM-ul consideră factura încasată? Fie e marcată `paid` cu dată de plată
 * (inclusiv „Marchează achitată" din /invoices sau potrivirea automată din
 * extrasul bancar, care nu lasă referință), fie are referință de plată pe un
 * status retrogradat de o sincronizare anterioară.
 *
 * Suficient pentru a NU retrograda; repararea cere `hasPaymentReference`.
 */
export function hasLocalCollection(
	invoice: LocalInvoiceCollection | null | undefined
): boolean {
	if (!invoice) return false;
	if (!invoice.paidDate) return false;
	if (invoice.status && COLLECTION_REVERSED.includes(invoice.status)) return false;
	if (invoice.status === 'paid') return true;
	return hasPaymentReference(invoice);
}

export type ResolveKeezStatusParams = {
	/** `status` din headerul Keez: 'Draft' | 'Valid' | 'Cancelled' | altceva. */
	keezStatus?: string | null;
	/** `remainingAmount` din Keez, în unități monetare (nu cenți). */
	remainingAmount?: number | null;
	/** Totalul facturii în cenți (din CRM sau recalculat din Keez). */
	totalAmount: number;
	dueDate: Date | null | undefined;
	/** Rândul existent din CRM — lipsește la facturile importate prima dată. */
	existing?: LocalInvoiceCollection | null;
	/** Statusul păstrat când Keez nu oferă nicio informație utilă. */
	fallbackStatus?: KeezDerivedStatus;
	/** Injectabil pentru teste deterministe. */
	now?: Date;
};

export type ResolvedKeezStatus = {
	status: KeezDerivedStatus;
	/** `remainingAmount` convertit în cenți, sau `null` dacă Keez nu l-a trimis. */
	remainingAmountCents: number | null;
	/** Am păstrat `paid` din CRM peste retrogradarea cerută de Keez. */
	keptLocalPayment: boolean;
};

/** Statusuri care ar anula o încasare deja înregistrată în CRM. */
const DOWNGRADES_PAYMENT: KeezDerivedStatus[] = ['sent', 'overdue', 'partially_paid'];

export function resolveKeezInvoiceStatus(params: ResolveKeezStatusParams): ResolvedKeezStatus {
	const { keezStatus, remainingAmount, totalAmount, dueDate, existing, now } = params;
	const reference = now ?? new Date();

	let status: KeezDerivedStatus = params.fallbackStatus ?? 'sent';
	let remainingAmountCents: number | null = null;

	const fromRemaining = (): KeezDerivedStatus | null => {
		if (remainingAmount === undefined || remainingAmount === null) return null;
		remainingAmountCents = Math.round(remainingAmount * 100);
		if (remainingAmountCents === 0) return 'paid';
		// Rest negativ = storno / factură de credit / încasare în plus. Nu e nici
		// „parțial", nici „restanță" — statusul rămâne cel curent (ca înainte de
		// unificare), doar restul se salvează pentru contabilitate.
		if (remainingAmountCents < 0) return null;
		if (remainingAmountCents < totalAmount) return 'partially_paid';
		return dueDate && dueDate < reference ? 'overdue' : 'sent';
	};

	if (keezStatus === 'Cancelled') {
		// Storno: stare a documentului, autoritară în Keez chiar dacă am încasat.
		status = 'cancelled';
	} else if (keezStatus === 'Draft') {
		// Proformă — nu se marchează achitată nici dacă restul e 0.
		status = 'draft';
	} else if (keezStatus === 'Valid') {
		// Document fiscal validat fără rest raportat: nu știm nimic despre
		// încasare → „trimisă" (comportamentul dinainte de unificare).
		status =
			remainingAmount === undefined || remainingAmount === null
				? 'sent'
				: (fromRemaining() ?? status);
	} else {
		// Status necunoscut: singurul indiciu rămâne restul de încasat, iar
		// „achitată" NU se deduce fără niciun status de la Keez.
		const derived = fromRemaining();
		if (derived && !(derived === 'paid' && !keezStatus)) status = derived;
	}

	if (DOWNGRADES_PAYMENT.includes(status) && hasLocalCollection(existing)) {
		return { status: 'paid', remainingAmountCents, keptLocalPayment: true };
	}

	return { status, remainingAmountCents, keptLocalPayment: false };
}
