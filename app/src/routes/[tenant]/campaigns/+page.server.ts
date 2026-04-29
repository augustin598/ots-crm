import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// Legacy route — kept as a redirect for any bookmarked URLs from the old structure.
// New canonical path: /[tenant]/campaigns-ads with subpages facebook|tiktok|google.
export const load: PageServerLoad = async (event) => {
	if (!event.locals.user || !event.locals.tenant) throw redirect(302, '/login');
	const status = event.url.searchParams.get('status');
	const target = status
		? `/${event.locals.tenant.slug}/campaigns-ads/facebook?status=${encodeURIComponent(status)}`
		: `/${event.locals.tenant.slug}/campaigns-ads/facebook`;
	throw redirect(302, target);
};
