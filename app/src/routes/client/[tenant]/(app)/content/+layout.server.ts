import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

/**
 * Gate pentru modulul Content în portal. `contentEnabled` e calculat în
 * /client/[tenant]/+layout.server.ts (≥1 website al clientului cu switch-ul
 * „Acces AI" ON și cu articole). Fără el, orice URL /content este respins 403
 * — pe lângă gate-ul per-website impus de remote-uri.
 */
export const load: LayoutServerLoad = async (event) => {
	const parent = await event.parent();
	if (!parent.contentEnabled) {
		throw error(403, 'Modulul Content nu este activat pentru contul tău.');
	}
	return {};
};
