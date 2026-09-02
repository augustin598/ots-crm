// Logica de alertare a pozițiilor (PURĂ): decide dacă o schimbare de poziție
// declanșează o alertă și de ce tip. O singură alertă per (keyword, device) pe
// eveniment, cea mai severă: pierdut > ieșit din top 10 > scădere sub prag.
export type RankAlertType = 'drop' | 'out_of_top10' | 'lost';

export interface RankAlertResult {
	type: RankAlertType;
	delta: number | null;
	fromPosition: number | null;
	toPosition: number | null;
}

/**
 * Decide alerta pentru trecerea de la `prev` la `next` (null = peste 100).
 * - `lost`         : era în top 100, acum a dispărut (next null).
 * - `out_of_top10` : era în top 10, acum e sub locul 10.
 * - `drop`         : a scăzut cu ≥ prag poziții (delta = prev − next ≤ −prag).
 * Fără `prev` (keyword nou / era deja afară) → nicio alertă.
 */
export function computeAlert(
	prev: number | null,
	next: number | null,
	threshold: number
): RankAlertResult | null {
	if (prev == null) return null;

	if (next == null) {
		return { type: 'lost', delta: null, fromPosition: prev, toPosition: null };
	}

	const delta = prev - next; // pozitiv = urcare
	if (prev <= 10 && next > 10) {
		return { type: 'out_of_top10', delta, fromPosition: prev, toPosition: next };
	}
	if (delta <= -threshold) {
		return { type: 'drop', delta, fromPosition: prev, toPosition: next };
	}
	return null;
}

/** Eticheta în română pentru un tip de alertă (email, UI). */
export function alertLabelRo(type: RankAlertType): string {
	switch (type) {
		case 'drop':
			return 'scădere';
		case 'out_of_top10':
			return 'ieșit din top 10';
		case 'lost':
			return 'dispărut din top 100';
	}
}
