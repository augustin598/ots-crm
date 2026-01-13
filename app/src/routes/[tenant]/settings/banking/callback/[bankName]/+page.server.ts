import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { connectBankAccount } from '$lib/remotes/banking.remote';

export const load: PageServerLoad = async (event) => {
	const code = event.url.searchParams.get('code');
	const bankName = event.params.bankName;

	if (!code || !bankName) {
		throw redirect(302, `/${event.locals.tenant?.slug}/settings/banking?error=missing_parameters`);
	}

	if (!event.locals.user || !event.locals.tenant) {
		throw redirect(302, '/login');
	}

	redirect(302, `/${event.locals.tenant.slug}/settings/banking?code=${code}&bank=${bankName}`);
};
