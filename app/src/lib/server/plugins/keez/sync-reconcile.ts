import { isMissingOnKeez } from './error-classification';

/**
 * Pure reconciliation logic — no DB, no Keez client. Caller injects:
 *   - `seen`: externalIds already observed during this sync run
 *   - `candidates`: CRM invoices with a keezExternalId that COULD be stale
 *     (the caller pre-filters out 'cancelled' ones; we defensively skip
 *     candidates whose externalId is in `seen`)
 *   - `getInvoice`: per-invoice verification call (Keez API)
 *   - `markCancelled`: per-invoice cancellation write (DB)
 *
 * For each candidate not already seen, we call `getInvoice`. If Keez returns
 * the unambiguous "missing" signal (404 or 400+VALIDATION_ERROR+"nu exista"),
 * the invoice is marked cancelled. Other errors (transient, unknown) are left
 * alone for the next sync run to retry — never false-cancel on a flake.
 *
 * Returns counts for logging + result reporting.
 */
export async function reconcileMissingKeezInvoices(input: {
	seen: Set<string>;
	candidates: Array<{ id: string; externalId: string }>;
	getInvoice: (externalId: string) => Promise<unknown>;
	markCancelled: (id: string) => Promise<void>;
}): Promise<{ verified: number; cancelled: number; skipped: number }> {
	const { seen, candidates, getInvoice, markCancelled } = input;
	let verified = 0;
	let cancelled = 0;
	let skipped = 0;

	for (const c of candidates) {
		// Defensive: a candidate that's in `seen` was processed in pagination
		// — never reconcile-cancel it.
		if (seen.has(c.externalId)) {
			skipped++;
			continue;
		}
		verified++;
		try {
			await getInvoice(c.externalId);
			// 200 → still exists upstream; race with creation. No-op.
		} catch (err) {
			if (isMissingOnKeez(err)) {
				await markCancelled(c.id);
				cancelled++;
			}
			// else: transient / unknown → leave alone, retry next sync.
		}
	}

	return { verified, cancelled, skipped };
}
