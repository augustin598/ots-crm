export type FieldDiff = { from: unknown; to: unknown };
export type ChangesJson = Record<string, FieldDiff>;

function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (a == null && b == null) return true; // null and undefined treated equal
	if (a == null || b == null) return false;
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) return false;
		return a.every((v, i) => deepEqual(v, b[i]));
	}
	return false;
}

/**
 * Compute structured diff between before and after states.
 * Only fields present in `after` are evaluated. Fields with deep-equal values are omitted.
 */
export function buildDiff(
	before: Record<string, unknown>,
	after: Record<string, unknown>
): ChangesJson {
	const out: ChangesJson = {};
	for (const key of Object.keys(after)) {
		if (!deepEqual(before[key], after[key])) {
			out[key] = { from: before[key] ?? null, to: after[key] ?? null };
		}
	}
	return out;
}
