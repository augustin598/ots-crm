import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	return {
		// Email settings are loaded via the remote function
	};
};
