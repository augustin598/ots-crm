/**
 * Creditul de ore — reguli PURE (fără DB, fără rețea).
 *
 * Unitatea creditului: MINUTE la tariful de referință (cel mai mic tarif activ,
 * suprascriibil în Settings → Tarife orare). Alimentarea din bani (facturi
 * plătite, ore cumpărate) se convertește aici; consumul ponderat al task-urilor
 * (faza 3) va folosi același tarif de referință ca numitor.
 */

export type LedgerKind =
	| 'invoice_credit'
	| 'invoice_credit_reversal'
	| 'purchase'
	| 'purchase_reversal'
	| 'manual'
	| 'task_consumption'
	| 'task_reversal'
	| 'overage_invoiced';

export type LedgerSourceType = 'invoice' | 'hours_order' | 'task' | 'manual';

export const LEDGER_KIND_LABELS: Record<LedgerKind, string> = {
	invoice_credit: 'Factură plătită',
	invoice_credit_reversal: 'Factură anulată',
	purchase: 'Ore cumpărate',
	purchase_reversal: 'Rambursare ore',
	manual: 'Ajustare manuală',
	task_consumption: 'Consum task',
	task_reversal: 'Task redeschis',
	overage_invoiced: 'Depășire facturată'
};

/** Sursele de facturi care NU alimentează creditul (media plătită, nu muncă). */
export const ADS_INVOICE_SOURCES = ['meta-ads', 'google-ads', 'tiktok-ads'] as const;
/** Factura de depășire a orelor nu poate re-credita orele pe care le-a facturat. */
export const HOUR_OVERAGE_INVOICE_SOURCE = 'hour-overage';
export const CREDITABLE_CURRENCIES = ['RON', 'EUR'] as const;

/** Rotunjire la cel mai apropiat pas (ex. 15 min); pasul invalid = minut întreg. */
export function roundToStep(minutes: number, stepMinutes: number): number {
	if (!Number.isFinite(minutes)) return 0;
	const step = Number.isInteger(stepMinutes) && stepMinutes > 0 ? stepMinutes : 1;
	return Math.round(minutes / step) * step;
}

/** Cenți RON/EUR → cenți EUR, la cursul BNR (lei per euro) din ziua plății. */
export function netToEurCents(
	netCents: number,
	currency: string,
	ronPerEur: number | null
): number {
	if (!Number.isInteger(netCents) || netCents <= 0) {
		throw new Error(`Sumă netă invalidă: ${netCents}`);
	}
	const cur = currency.toUpperCase();
	if (cur === 'EUR') return netCents;
	if (cur === 'RON') {
		if (!ronPerEur || !Number.isFinite(ronPerEur) || ronPerEur <= 0) {
			throw new Error('Curs BNR indisponibil pentru conversia RON → EUR');
		}
		return Math.round(netCents / ronPerEur);
	}
	throw new Error(`Monedă neacceptată: ${currency}`);
}

/** Cenți EUR → minute la tariful de referință, rotunjite la pas. */
export function eurCentsToReferenceMinutes(
	netEurCents: number,
	referenceRateEur: number,
	stepMinutes: number
): number {
	if (!Number.isInteger(netEurCents) || netEurCents < 0) {
		throw new Error(`Sumă EUR invalidă: ${netEurCents}`);
	}
	if (!Number.isInteger(referenceRateEur) || referenceRateEur <= 0) {
		throw new Error(`Tarif de referință invalid: ${referenceRateEur}`);
	}
	return roundToStep((netEurCents / 100 / referenceRateEur) * 60, stepMinutes);
}

export interface InvoiceCreditCandidate {
	status: string;
	hostingAccountId: string | null;
	externalSource: string | null;
	/** Net, în cenți, în moneda facturii. */
	amount: number | null;
	currency: string;
}

export interface InvoiceEligibility {
	eligible: boolean;
	/** Motivul refuzului, în română; null când e eligibilă. */
	reason: string | null;
}

/**
 * Regulile de eligibilitate ale unei facturi pentru creditul de ore (spec §5.1).
 * Ordinea contează: excluderile structurale înaintea bifei clientului, ca o
 * factură de depășire să nu ajungă niciodată la creditare.
 */
export function invoiceCreditEligibility(
	invoice: InvoiceCreditCandidate,
	ctx: { clientOptedIn: boolean; isHoursOrderInvoice: boolean }
): InvoiceEligibility {
	if (invoice.externalSource === HOUR_OVERAGE_INVOICE_SOURCE) {
		return { eligible: false, reason: 'factură de depășire a orelor' };
	}
	if (invoice.hostingAccountId) return { eligible: false, reason: 'factură de hosting' };
	if (
		invoice.externalSource &&
		(ADS_INVOICE_SOURCES as readonly string[]).includes(invoice.externalSource)
	) {
		return { eligible: false, reason: `factură din sursă ads (${invoice.externalSource})` };
	}
	if (ctx.isHoursOrderInvoice) {
		return { eligible: false, reason: 'factura unei comenzi de ore (creditată prin comandă)' };
	}
	if (invoice.status !== 'paid') return { eligible: false, reason: 'factura nu e plătită' };
	if (!ctx.clientOptedIn) {
		return { eligible: false, reason: 'clientul nu are bifa „facturile alimentează creditul"' };
	}
	if (!invoice.amount || invoice.amount <= 0) return { eligible: false, reason: 'sumă netă zero' };
	if (!(CREDITABLE_CURRENCIES as readonly string[]).includes(invoice.currency.toUpperCase())) {
		return { eligible: false, reason: `monedă neacceptată (${invoice.currency})` };
	}
	return { eligible: true, reason: null };
}

/** Prima zi a lunii (UTC) — fereastra „consum luna curentă". */
export function startOfMonthUtc(now: Date): Date {
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
