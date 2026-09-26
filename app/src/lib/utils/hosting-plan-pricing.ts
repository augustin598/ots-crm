/**
 * Calcule și texte pentru cardurile de pachete hosting — folosite identic pe
 * pagina publică /pachete-hosting și în portalul clientului (Hosting → Pachete).
 *
 * Toggle-ul „lunar / anual" e doar de afișare: estimăm „lunar" și „anual cu −2
 * luni" din ciclul configurat de admin. Checkout-ul facturează ciclul real.
 */

type PriceInput = { price: number; billingCycle: string };

/** Prețul pachetului (bani) → echivalent lunar în unitatea monedei, rotunjit. */
export function monthlyEquivalentRon(pkg: PriceInput): number {
	const ron = pkg.price / 100;
	switch (pkg.billingCycle) {
		case 'annually':
			return Math.round((ron * 12) / 120);
		case 'biennially':
			return Math.round((ron * 12) / 240);
		case 'triennially':
			return Math.round((ron * 12) / 360);
		case 'biannually':
		case 'semiannually':
			return Math.round((ron * 12) / 60);
		case 'quarterly':
			return Math.round((ron * 12) / 36);
		case 'monthly':
		default:
			return Math.round(ron);
	}
}

/** Total anual afișat: 10 luni (−2 luni față de plata lunară). */
export function yearlyTotalRon(pkg: PriceInput): number {
	return monthlyEquivalentRon(pkg) * 10;
}

export function monthlyBilledRon(pkg: PriceInput): number {
	const ron = pkg.price / 100;
	return pkg.billingCycle === 'monthly' ? Math.round(ron) : monthlyEquivalentRon(pkg);
}

/** Cifra mare de pe card („/ lună"), după toggle. */
export function displayPrice(pkg: PriceInput, yearly: boolean): number {
	return yearly ? Math.round(yearlyTotalRon(pkg) / 12) : monthlyBilledRon(pkg);
}

export function mbToGb(mb: number | null | undefined): string {
	if (mb === null || mb === undefined) return 'Nelimitat';
	if (mb < 1024) return `${mb} MB`;
	return `${Math.round(mb / 1024).toLocaleString('ro-RO')} GB`;
}

export function mbToGbNumber(mb: number | null | undefined): number | null {
	if (mb === null || mb === undefined) return null;
	return Math.round(mb / 1024);
}

export function fmtCount(v: number | null | undefined): string {
	if (v === null || v === undefined) return 'Nelimitat';
	return v.toLocaleString('ro-RO');
}

export function isPopular(p: { highlightBadge: string | null }): boolean {
	return !!(p.highlightBadge && p.highlightBadge.trim().length > 0);
}

export function tagFor(p: { description: string | null }): string {
	return (
		(p.description ?? '').trim() || 'Hosting administrat, optimizat pentru WordPress și WooCommerce.'
	);
}

export function backupHint(p: { features: string[] | null }): string {
	const found = (p.features ?? []).find((f) => /backup/i.test(f));
	return found ?? 'zilnic';
}
