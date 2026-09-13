/**
 * Expirarea creditului de ore — reguli PURE (fără DB, fără ceas).
 *
 * Creditul intră în ledger ca alimentări („loturi"). Un lot poate avea termen
 * (`expiresAt`); consumul nu e legat de un lot anume, așa că îl alocăm aici,
 * **FIFO pe expirare**: se consumă întâi ce expiră cel mai devreme, iar
 * creditul fără termen se consumă ultimul. Așa clientul pierde cât mai puțin.
 *
 * Rândul de expirare scris de job e el însuși un consum în ledger, deci
 * recalcularea de a doua zi nu-l mai vede ca neconsumat — de aici idempotența
 * naturală a jobului, fără stare separată.
 *
 * Stornările NU sunt loturi (decizie 13 sep 2026):
 *  - `task_reversal` anulează un consum, deci se scade din consum; altfel minutele
 *    restituite deveneau credit fără termen și scăpau de expirare. Restituite după
 *    termenul lotului lor, ele expiră la rularea următoare;
 *  - `invoice_credit_reversal` / `purchase_reversal` retrag exact alimentarea lor
 *    (aceeași sursă), nu lotul care expiră primul.
 */

export interface ExpiryLedgerRow {
	id: string;
	createdAt: Date;
	/** Semnat: pozitiv = alimentare (lot), negativ = consum/expirare. */
	deltaMinutes: number;
	/** Termenul lotului; null la consum și la creditul fără termen. */
	expiresAt: Date | null;
	/** Tipul rândului; lipsă = tratat după semn (alimentare sau consum). */
	kind?: string;
	/** Sursa rândului — leagă o stornare de alimentarea ei și o expirare de lotul ei. */
	sourceId?: string;
}

/** Stornarea de alimentare → tipul alimentării pe care o retrage. */
const CREDIT_REVERSAL_OF: Record<string, string> = {
	invoice_credit_reversal: 'invoice_credit',
	purchase_reversal: 'purchase'
};

export interface CreditBatch {
	id: string;
	createdAt: Date;
	expiresAt: Date | null;
	remainingMinutes: number;
}

export interface ExpiredBatch {
	batchId: string;
	/**
	 * `source_id` al rândului de expirare. Primul = id-ul lotului; un lot care expiră
	 * a doua oară (minute restituite după termen) primește `id#2`, `id#3`… — indexul
	 * unic ar bloca altfel a doua expirare și minutele n-ar mai expira niciodată.
	 */
	expireKey: string;
	minutes: number;
	expiresAt: Date;
}

/**
 * Data la care expiră un credit alimentat la `creditedAt`, după regula
 * tenantului. `days <= 0` (sau invalid) = fără termen.
 */
export function computeExpiryDate(creditedAt: Date, days: number): Date | null {
	if (!Number.isFinite(days) || days <= 0) return null;
	const out = new Date(creditedAt);
	out.setUTCDate(out.getUTCDate() + Math.trunc(days));
	return out;
}

/** Loturile în ordinea în care se consumă: cu termen (cel mai apropiat) întâi. */
function byConsumptionOrder(a: CreditBatch, b: CreditBatch): number {
	if (a.expiresAt && b.expiresAt) {
		return (
			a.expiresAt.getTime() - b.expiresAt.getTime() || a.createdAt.getTime() - b.createdAt.getTime()
		);
	}
	if (a.expiresAt) return -1;
	if (b.expiresAt) return 1;
	return a.createdAt.getTime() - b.createdAt.getTime();
}

/**
 * Ce a mai rămas din fiecare lot după ce tot consumul a fost alocat FIFO.
 * Loturile golite dispar din rezultat.
 */
export function remainingBatches(rows: readonly ExpiryLedgerRow[]): CreditBatch[] {
	const batchRows = rows.filter((r) => r.deltaMinutes > 0 && r.kind !== 'task_reversal');
	const batches: CreditBatch[] = batchRows
		.map((r) => ({
			id: r.id,
			createdAt: r.createdAt,
			expiresAt: r.expiresAt,
			remainingMinutes: r.deltaMinutes
		}))
		.sort(byConsumptionOrder);
	const byId = new Map(batches.map((b) => [b.id, b]));

	let toSpend = 0;
	for (const r of rows) {
		if (r.kind === 'task_reversal') {
			toSpend -= r.deltaMinutes;
			continue;
		}
		if (r.deltaMinutes >= 0) continue;
		const creditKind = r.kind ? CREDIT_REVERSAL_OF[r.kind] : undefined;
		const source = creditKind
			? batchRows.find((b) => b.kind === creditKind && b.sourceId === r.sourceId)
			: undefined;
		const target = source ? byId.get(source.id) : undefined;
		if (target) {
			const taken = Math.min(target.remainingMinutes, -r.deltaMinutes);
			target.remainingMinutes -= taken;
			toSpend += -r.deltaMinutes - taken;
		} else {
			toSpend += -r.deltaMinutes;
		}
	}

	for (const batch of batches) {
		if (toSpend <= 0) break;
		const taken = Math.min(batch.remainingMinutes, toSpend);
		batch.remainingMinutes -= taken;
		toSpend -= taken;
	}

	return batches.filter((b) => b.remainingMinutes > 0);
}

/**
 * Loturile al căror termen a trecut la `now` și care au rămas neconsumate.
 * Fiecare devine un rând `expire` cu minus, în jobul zilnic.
 *
 * La data exactă a expirării creditul e încă valabil (expiră *după*).
 */
export function expiredBatches(
	rows: readonly ExpiryLedgerRow[],
	now: Date,
	opts: { notBefore?: Date | null } = {}
): ExpiredBatch[] {
	const priorExpiries = (batchId: string) =>
		rows.filter(
			(r) =>
				r.kind === 'expire' && (r.sourceId === batchId || r.sourceId?.startsWith(`${batchId}#`))
		).length;
	return (
		remainingBatches(rows)
			.filter((b): b is CreditBatch & { expiresAt: Date } => !!b.expiresAt && b.expiresAt < now)
			// Termenele trecute cât expirarea a fost oprită nu mai expiră (fără retroactiv).
			.filter((b) => !opts.notBefore || b.expiresAt >= opts.notBefore)
			.map((b) => {
				const prior = priorExpiries(b.id);
				return {
					batchId: b.id,
					expireKey: prior === 0 ? b.id : `${b.id}#${prior + 1}`,
					minutes: b.remainingMinutes,
					expiresAt: b.expiresAt
				};
			})
	);
}

/**
 * Cât credit expiră până la `until` (inclusiv) — pentru KPI-ul „expiră luna
 * asta" și pentru cardul de expirare din fișa clientului.
 */
export function expiringUntil(
	rows: readonly ExpiryLedgerRow[],
	until: Date
): { minutes: number; firstExpiryAt: Date | null } {
	const soon = remainingBatches(rows).filter((b) => b.expiresAt && b.expiresAt <= until);
	return {
		minutes: soon.reduce((s, b) => s + b.remainingMinutes, 0),
		firstExpiryAt: soon.length ? soon[0].expiresAt : null
	};
}

/**
 * Momentul de la care se aplică expirarea, după o modificare a regulii (decizie
 * 13 sep 2026). Oprirea (0 zile) golește momentul; repornirea îl fixează la `now`,
 * ca termenele trecute cât expirarea a fost oprită să nu expire retroactiv; o simplă
 * schimbare a numărului de zile îl păstrează.
 */
export function nextExpiryEnabledAt(params: {
	prevDays: number;
	prevEnabledAt: Date | null;
	nextDays: number;
	now: Date;
}): Date | null {
	// `!(x > 0)` prinde și valori lipsă/NaN: tratate ca „oprită".
	if (!(params.nextDays > 0)) return null;
	if (!(params.prevDays > 0)) return params.now;
	return params.prevEnabledAt;
}

/**
 * Loturile cu termen care chiar vor expira — ce afișează UI-ul („expiră la…").
 * Cu expirarea oprită nu expiră nimic; după repornire, doar termenele de după ea.
 */
export function expiringBatches(
	rows: readonly ExpiryLedgerRow[],
	rules: { creditExpiryDays: number; creditExpiryEnabledAt: Date | null }
): CreditBatch[] {
	if (rules.creditExpiryDays <= 0) return [];
	const notBefore = rules.creditExpiryEnabledAt;
	return remainingBatches(rows).filter(
		(b) => !!b.expiresAt && (!notBefore || b.expiresAt >= notBefore)
	);
}
