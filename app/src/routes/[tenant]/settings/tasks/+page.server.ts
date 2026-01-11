import type { PageServerLoad } from './$types';
import { getTaskSettings } from '$lib/remotes/task-settings.remote';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user || !event.locals.tenant) {
		return {
			settings: null
		};
	}

	return {
		settings: null
	};
};
