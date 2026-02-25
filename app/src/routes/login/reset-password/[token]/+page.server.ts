import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	// SvelteKit automatically decodes URL params
	const token = params.token || '';

	return { token };
};
