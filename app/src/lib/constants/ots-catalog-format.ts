/**
 * Helperi de formatare pentru catalogul OTS — modul PUR, fără date.
 *
 * Există separat de `ots-catalog.ts` pentru ca pagina publică `/servicii` să
 * poată folosi formatarea fără să importe (și deci fără să livreze în bundle-ul
 * de client) constantele cu prețuri. Acolo catalogul vine de pe server, doar
 * după ce vizitatorul a introdus parola.
 *
 * `ots-catalog.ts` re-exportă aceste funcții, deci importurile existente
 * (`from '$lib/constants/ots-catalog'`) rămân valabile.
 */

export type FeatureValue = boolean | number | string;

export function formatFeatureValue(value: FeatureValue): string {
	if (value === true) return 'DA';
	if (value === false) return 'NU';
	if (typeof value === 'number') return String(value);
	return value;
}

export function isBooleanFeature(value: FeatureValue): value is boolean {
	return typeof value === 'boolean';
}

/** Preț în EUR, formatat românește (ex. `1.250 €`). `null` → em dash. */
export function formatEur(value: number | null | undefined): string {
	if (value === null || value === undefined) return '—';
	return `${value.toLocaleString('ro-RO')} €`;
}
