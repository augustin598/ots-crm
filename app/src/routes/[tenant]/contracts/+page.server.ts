import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	// Data is fetched client-side via remotes (getContracts, getClients)
	return {};
};
