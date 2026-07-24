/**
 * Rezolvare brand -> clientWebsite pt backfill/import content (F0).
 * Scope: doar cele 3 brand-uri active (heylux/luckystudio/preziosa). Restul -> null (ignorate).
 * Normalizarea domeniului = aceeași convenție ca extractDomainFromUrl din SEO (www + trailing slash).
 */
const BRAND_DOMAIN: Record<string, string> = {
	heylux: 'heylux.ro',
	luckystudio: 'luckystudio.ro',
	preziosa: 'preziosa.ro'
};

export function normalizeDomain(url: string): string {
	let host = url.trim();
	try {
		host = new URL(host.includes('://') ? host : `https://${host}`).hostname;
	} catch {
		host = host.replace(/^https?:\/\//, '').split('/')[0];
	}
	return host.replace(/^www\./i, '').replace(/\/+$/, '').toLowerCase();
}

export function brandToDomain(brand: string): string | null {
	return BRAND_DOMAIN[brand] ?? null;
}

export function resolveWebsiteId(
	brand: string,
	websites: Array<{ id: string; url: string }>
): string | null {
	const domain = brandToDomain(brand);
	if (!domain) return null;
	const match = websites.find((w) => normalizeDomain(w.url) === domain);
	return match ? match.id : null;
}
