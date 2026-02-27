import type { PageServerLoad } from './$types';
import { getContract } from '$lib/remotes/contracts.remote';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async (event) => {
	try {
		const contract = await getContract(event.params.contractId);
		return { contract };
	} catch {
		throw error(404, 'Contract not found');
	}
};
