import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	// Authentication is handled in hooks.server.ts
	return {};
};
