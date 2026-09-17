/**
 * Creditul de ore — reguli PURE (fără DB, fără rețea).
 *
 * Unitatea creditului: MINUTE reale. Orele cumpărate intră 1:1 și taskurile
 * consumă 1:1, indiferent de specializare. Doar facturile de abonament plătite
 * se convertesc din bani în minute, la tariful de referință (cel mai mic tarif
 * activ, suprascriibil în Settings → Tarife orare).
 */

export type LedgerKind =
	| 'invoice_credit'
	| 'invoice_credit_reversal'
	| 'purchase'
	| 'purchase_reversal'
	| 'manual'
	| 'task_consumption'
	| 'task_reversal'
	| 'overage_invoiced'
	| 'expire'
	| 'correction';

export type LedgerSourceType = 'invoice' | 'hours_order' | 'task' | 'manual' | 'ledger';

export const LEDGER_KIND_LABELS: Record<LedgerKind, string> = {
	invoice_credit: 'Factură plătită',
	invoice_credit_reversal: 'Factură anulată',
	purchase: 'Ore cumpărate',
	purchase_reversal: 'Rambursare ore',
	manual: 'Ajustare manuală',
	task_consumption: 'Consum task',
	task_reversal: 'Task redeschis',
	overage_invoiced: 'Depășire facturată',
	expire: 'Expirare credit',
	correction: 'Corecție'
};

/** Sursele de facturi care NU alimentează creditul (media plătită, nu muncă). */
export const ADS_INVOICE_SOURCES = ['meta-ads', 'google-ads', 'tiktok-ads'] as const;
/** Factura de depășire a orelor nu poate re-credita orele pe care le-a facturat. */
export const HOUR_OVERAGE_INVOICE_SOURCE = 'hour-overage';
/**
 * Factura emisă din „Adaugă ore" (admin): creditul a intrat în ledger la
 * EMITERE, nu la plată. Fără marcajul ăsta, `invoice.paid` ar credita a doua
 * oară aceleași ore.
 */
export const HOUR_CREDIT_INVOICE_SOURCE = 'hour-credit';
export const CREDITABLE_CURRENCIES = ['RON', 'EUR'] as const;

/** Rotunjire la cel mai apropiat pas (ex. 15 min); pasul invalid = minut întreg. */
export function roundToStep(minutes: number, stepMinutes: number): number {
	if (!Number.isFinite(minutes)) return 0;
	const step = Number.isInteger(stepMinutes) && stepMinutes > 0 ? stepMinutes : 1;
	return Math.round(minutes / step) * step;
}

/** Singura rotunjire a timpului LUCRAT: în sus, la pas. Pas invalid = minut întreg. */
export function ceilToStep(minutes: number, stepMinutes: number): number {
	if (!Number.isFinite(minutes) || minutes <= 0) return 0;
	const step = Number.isInteger(stepMinutes) && stepMinutes > 0 ? stepMinutes : 1;
	return Math.ceil(minutes / step) * step;
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

/**
 * Cenți EUR → minute la tariful de referință, ÎN JOS la minut: creditul nu poate
 * depăși banii plătiți. Pasul e regula timpului lucrat, nu a banilor.
 */
export function eurCentsToReferenceMinutes(netEurCents: number, referenceRateEur: number): number {
	if (!Number.isInteger(netEurCents) || netEurCents < 0) {
		throw new Error(`Sumă EUR invalidă: ${netEurCents}`);
	}
	if (!Number.isInteger(referenceRateEur) || referenceRateEur <= 0) {
		throw new Error(`Tarif de referință invalid: ${referenceRateEur}`);
	}
	return Math.floor((netEurCents * 60) / (referenceRateEur * 100));
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
	/**
	 * `true` = factura nu alimentează creditul niciodată (hosting, ads, depășire,
	 * comandă de ore, „Adaugă ore"), deci nu are ce căuta în lista „Necreditate".
	 * Lipsă = eligibilă sau refuzată dintr-un motiv pe care adminul îl poate rezolva.
	 */
	structural?: true;
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
	const excluded = (reason: string): InvoiceEligibility => ({
		eligible: false,
		reason,
		structural: true
	});
	if (invoice.externalSource === HOUR_OVERAGE_INVOICE_SOURCE) {
		return excluded('factură de depășire a orelor');
	}
	if (invoice.externalSource === HOUR_CREDIT_INVOICE_SOURCE) {
		return excluded('ore adăugate manual (creditate la emitere)');
	}
	if (invoice.hostingAccountId) return excluded('factură de hosting');
	if (
		invoice.externalSource &&
		(ADS_INVOICE_SOURCES as readonly string[]).includes(invoice.externalSource)
	) {
		return excluded(`factură din sursă ads (${invoice.externalSource})`);
	}
	if (ctx.isHoursOrderInvoice) {
		return excluded('factura unei comenzi de ore (creditată prin comandă)');
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

// ---- Consumul task-urilor (spec §6) ----------------------------------------
//
// Creditul se ține și se consumă în ore REALE: 1 h cumpărată = 1 h lucrată,
// indiferent de specializare sau regim. Tariful contează la cumpărare (prețul
// orelor) și la depășire (prețul orelor peste credit). Conversia lei → ore la
// tariful de referință rămâne DOAR la facturile de abonament care alimentează
// creditul (`eurCentsToReferenceMinutes`).

export interface TaskSettlementSplit {
	/** Timpul lucrat, rotunjit în sus la pas — singura rotunjire. */
	billedMinutes: number;
	/** Minute scăzute din credit (≤ sold, ≥ 0). */
	consumedMinutes: number;
	/** Restul exact, facturat ca depășire. */
	overageRealMinutes: number;
}

/** consumed + overage == billed, mereu. */
export function splitTaskSettlement(params: {
	realMinutes: number;
	balanceMinutes: number;
	stepMinutes: number;
}): TaskSettlementSplit {
	if (!Number.isInteger(params.realMinutes) || params.realMinutes < 0) {
		throw new Error(`Minute reale invalide: ${params.realMinutes}`);
	}
	const billedMinutes = ceilToStep(params.realMinutes, params.stepMinutes);
	const consumedMinutes = Math.min(billedMinutes, Math.max(0, params.balanceMinutes));
	return { billedMinutes, consumedMinutes, overageRealMinutes: billedMinutes - consumedMinutes };
}

/** Suma liniei de depășire, direct din minute (tarif efectiv în EUR întregi). */
export function overageLineAmountCents(minutes: number, unitRateEur: number): number {
	return Math.round((minutes * unitRateEur * 100) / 60);
}

/**
 * Forma liniei de depășire: cantitate × preț === sumă, EXACT în cenți. Keez primește
 * cantitatea cu 2 zecimale și prețul unitar și își recalculează singur valoarea, deci
 * o cantitate rotunjită (50 min → 0,83 h × 65 € = 53,95 €) ar scoate o factură fiscală
 * diferită de cea din CRM (54,17 €).
 *  - minute multiplu de 15 → orele au cel mult 2 zecimale exacte (,25/,5/,75):
 *    linia rămâne „ore × tarif orar";
 *  - altfel → „1 × suma" (unitate: bucată); minutele și tariful stau în nota liniei.
 */
export function overageLineShape(
	minutes: number,
	unitRateEur: number
): { quantity: number; rateCents: number; amountCents: number; unit: 'hour' | 'piece' } {
	const amountCents = overageLineAmountCents(minutes, unitRateEur);
	const rateCents = unitRateEur * 100;
	const hours = minutes / 60;
	if (minutes % 15 === 0 && hours * rateCents === amountCents) {
		return { quantity: hours, rateCents, amountCents, unit: 'hour' };
	}
	return { quantity: 1, rateCents: amountCents, amountCents, unit: 'piece' };
}

/** Cheia lunii calendaristice (Europe/Bucharest) pentru draftul de depășire. */
export function overageMonthKey(now: Date): string {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Europe/Bucharest',
		year: 'numeric',
		month: '2-digit'
	}).formatToParts(now);
	const y = parts.find((p) => p.type === 'year')?.value;
	const m = parts.find((p) => p.type === 'month')?.value;
	return `${y}-${m}`;
}

export const OVERAGE_NOTES_PREFIX = 'hour-overage:';

export interface OverageDraftHeader {
	externalSource: string | null;
	notes: string | null;
	/** Cenți. */
	amount: number | null;
	/** Puncte de bază (21% = 2100). */
	taxRate: number | null;
	currency: string;
	clientId: string | null;
}

/**
 * De ce nu se poate salva editarea antetului unui draft de depășire (spec §6.3);
 * null = permis. Suma, cota și moneda se recalculează din liniile generate de
 * sistem, clientul e al taskurilor, iar nota poartă marcajul lunii după care
 * decontarea găsește draftul — șters, Done-ul următor ar deschide un draft dublu.
 *
 * Formularul din /invoices retrimite toate câmpurile, deci comparăm valorile,
 * nu prezența lor. `amount` și `taxRate` vin din formular în unități (lei, %).
 */
export function overageDraftEditBlockReason(
	existing: OverageDraftHeader,
	update: {
		amount?: number;
		taxRate?: number;
		currency?: string;
		clientId?: string;
		notes?: string;
	}
): string | null {
	if (existing.externalSource !== HOUR_OVERAGE_INVOICE_SOURCE) return null;
	const locked =
		'Draftul de depășire a orelor e generat din taskuri: suma, cota, moneda și clientul nu se editează din antet.';
	if (update.amount !== undefined && Math.round(update.amount * 100) !== (existing.amount ?? 0)) {
		return locked;
	}
	if (
		update.taxRate !== undefined &&
		Math.round(update.taxRate * 100) !== (existing.taxRate ?? 0)
	) {
		return locked;
	}
	if (update.currency !== undefined && update.currency !== existing.currency) return locked;
	if (update.clientId && update.clientId !== existing.clientId) return locked;
	if (update.notes !== undefined) {
		const marker = (existing.notes ?? '').match(/^hour-overage:\d{4}-\d{2}/)?.[0];
		if (marker && !update.notes.startsWith(marker)) {
			return `Nota draftului trebuie să înceapă cu „${marker}" — după acest marcaj se adaugă depășirile lunii.`;
		}
	}
	return null;
}

/**
 * Starea alertei „credit scăzut" (spec §8), pe DISPONIBIL = sold − rezervat — aceeași
 * regulă ca badge-ul „sub prag" din Bugete ore (decizie 13 sep 2026). O singură
 * alertă la trecerea sub prag; se reînarmează când disponibilul urcă peste prag.
 */
export function lowCreditTransition(params: {
	balanceMinutes: number;
	reservedMinutes: number;
	thresholdMinutes: number;
	notified: boolean;
}): { action: 'notify' | 'rearm' | 'none'; availableMinutes: number } {
	const availableMinutes = params.balanceMinutes - params.reservedMinutes;
	const below = availableMinutes < params.thresholdMinutes;
	if (below && !params.notified) return { action: 'notify', availableMinutes };
	if (!below && params.notified) return { action: 'rearm', availableMinutes };
	return { action: 'none', availableMinutes };
}

/**
 * Creditul disponibil pentru estimarea unui task (spec §6.1: avertizare galbenă
 * când estimarea depășește DISPONIBILUL, nu soldul). La editare, taskul
 * rezervă deja o parte din `reservedMinutes`; fără scăderea ei s-ar număra de două ori.
 */
export function availableForTask(params: {
	balanceMinutes: number;
	reservedMinutes: number;
	ownReservedMinutes: number;
}): number {
	const others = Math.max(0, params.reservedMinutes - params.ownReservedMinutes);
	return params.balanceMinutes - others;
}

/**
 * Eticheta orelor lucrate din notificările de consum (email + WhatsApp): specializarea,
 * fără tarif — prețul apare doar la depășire. Soldul rămâne în ore la tariful de
 * referință; decizie 13 sep 2026: fără explicații despre conversie în mesaj.
 */
export function consumptionWorkedLabel(params: {
	rateLabel: string;
	rateEur: number;
	multiplierPct: number;
	modeLabel: string;
}): string {
	const mode = params.multiplierPct > 100 ? `, ${params.modeLabel}` : '';
	return `${params.rateLabel}${mode}`;
}
