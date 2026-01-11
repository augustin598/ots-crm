import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user || !event.locals.tenant) {
		return {
			status: null
		};
	}

	return {
		status: null
	};
};
