export type Brand =
	| 'heylux'
	| 'luckystudio'
	| 'preziosa'
	| 'forumvideochat'
	| 'vivadiva'
	| 'unknown';

/**
 * Detect the studio brand for an advertorial.
 *
 * Priority: the URL host+path (slug) is authoritative; page title/body are a
 * fallback only when the slug carries no brand token. Resolution order matters
 * because comparison / "forumvideochat" articles mention Heylux without being
 * Heylux — so Heylux is resolved LAST among the specific brands.
 */
export function detectBrand(sourceUrl: string, title: string, bodyText: string): Brand {
	let hay = sourceUrl.toLowerCase();
	try {
		const u = new URL(sourceUrl);
		hay = (u.hostname + ' ' + decodeURIComponent(u.pathname)).toLowerCase();
	} catch {
		/* keep raw url */
	}

	const fromSlug = matchBrand(hay);
	if (fromSlug) return fromSlug;

	const content = `${title} ${bodyText}`.toLowerCase().slice(0, 4000);
	const fromContent = matchBrand(content);
	return fromContent ?? 'unknown';
}

/** Ordered brand matcher — most-specific first, heylux last. */
function matchBrand(text: string): Brand | null {
	if (/preziosa/.test(text)) return 'preziosa';
	if (/vivadiva|viva[\s-]?diva/.test(text)) return 'vivadiva';
	if (/lucky[\s-]?studio|luckystudio|fetele?[\s-]?norocoase|fetelenorocoase/.test(text)) return 'luckystudio';
	if (/forum[\s-]?videochat|forumvideochat/.test(text)) return 'forumvideochat';
	if (/heylux/.test(text)) return 'heylux';
	return null;
}
