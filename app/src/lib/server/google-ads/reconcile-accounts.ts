/**
 * Accounts that disappear from the MCC (removed, closed, moved) used to keep
 * `is_active = 1` forever, so every sync kept querying them and failing.
 */
export interface StoredAccountRow {
	id: string;
	googleAdsCustomerId: string;
	isActive: boolean;
}

export interface FetchedAccount {
	customerId: string;
}

const digits = (id: string) => id.replace(/\D/g, '');

export function reconcileMccAccounts(
	existing: StoredAccountRow[],
	fetched: FetchedAccount[]
): { deactivateIds: string[] } {
	// An empty listing is far more likely an API hiccup than "every account left".
	if (fetched.length === 0) return { deactivateIds: [] };
	const present = new Set(fetched.map((f) => digits(f.customerId)));
	const deactivateIds = existing
		.filter((row) => row.isActive && !present.has(digits(row.googleAdsCustomerId)))
		.map((row) => row.id);
	return { deactivateIds };
}
