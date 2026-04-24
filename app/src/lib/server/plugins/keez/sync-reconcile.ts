import { isMissingOnKeez } from './error-classification';

/**
 * Pure reconciliation logic — no DB, no Keez client. Caller injects:
 *   - `seen`: externalIds already observed during this sync run
 *   - `candidates`: CRM invoices with a keezExternalId that COULD be stale
 *     (the caller pre-filters out 'cancelled' ones; we defensively skip
 *     candidates whose externalId is in `seen`)
 *   - `getInvoice`: per-invoice verification call (Keez API)
 *   - `markCancelled`: per-invoice cancellation write (DB)
 *   - `concurrency` (optional, default 1): how many getInvoice calls run in
 *     parallel. Keep this low to avoid hammering Keez during reconciliation.
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
	concurrency?: number;
}): Promise<{ verified: number; cancelled: number; skipped: number }> {
	const { seen, candidates, getInvoice, markCancelled, concurrency = 1 } = input;

	// Pre-filter candidates already seen — separates "skipped" accounting from
	// the parallel verification path, so chunking math stays simple.
	const skippedIds: string[] = [];
	const toVerify: Array<{ id: string; externalId: string }> = [];
	for (const c of candidates) {
		if (seen.has(c.externalId)) {
			skippedIds.push(c.id);
		} else {
			toVerify.push(c);
		}
	}

	let cancelled = 0;
	const chunkSize = Math.max(1, concurrency);

	const verifyOne = async (c: { id: string; externalId: string }): Promise<boolean> => {
		try {
			await getInvoice(c.externalId);
			return false; // still exists upstream
		} catch (err) {
			if (isMissingOnKeez(err)) {
				await markCancelled(c.id);
				return true;
			}
			return false; // transient / unknown — leave alone, retry next sync
		}
	};

	for (let i = 0; i < toVerify.length; i += chunkSize) {
		const chunk = toVerify.slice(i, i + chunkSize);
		const results = await Promise.all(chunk.map(verifyOne));
		cancelled += results.filter(Boolean).length;
	}

	return {
		verified: toVerify.length,
		cancelled,
		skipped: skippedIds.length,
	};
}
