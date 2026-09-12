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
 */

export interface ExpiryLedgerRow {
	id: string;
	createdAt: Date;
	/** Semnat: pozitiv = alimentare (lot), negativ = consum/expirare. */
	deltaMinutes: number;
	/** Termenul lotului; null la consum și la creditul fără termen. */
	expiresAt: Date | null;
}

export interface CreditBatch {
	id: string;
	createdAt: Date;
	expiresAt: Date | null;
	remainingMinutes: number;
}

export interface ExpiredBatch {
	batchId: string;
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
		return a.expiresAt.getTime() - b.expiresAt.getTime() || a.createdAt.getTime() - b.createdAt.getTime();
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
	const batches: CreditBatch[] = rows
		.filter((r) => r.deltaMinutes > 0)
		.map((r) => ({
			id: r.id,
			createdAt: r.createdAt,
			expiresAt: r.expiresAt,
			remainingMinutes: r.deltaMinutes
		}))
		.sort(byConsumptionOrder);

	let toSpend = rows.reduce((s, r) => (r.deltaMinutes < 0 ? s + Math.abs(r.deltaMinutes) : s), 0);

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
export function expiredBatches(rows: readonly ExpiryLedgerRow[], now: Date): ExpiredBatch[] {
	return remainingBatches(rows)
		.filter((b): b is CreditBatch & { expiresAt: Date } => !!b.expiresAt && b.expiresAt < now)
		.map((b) => ({ batchId: b.id, minutes: b.remainingMinutes, expiresAt: b.expiresAt }));
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
