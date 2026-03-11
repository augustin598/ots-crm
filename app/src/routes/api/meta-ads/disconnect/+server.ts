import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { disconnectMetaAds } from '$lib/server/meta-ads/auth';

export const POST: RequestHandler = async ({ request }) => {
	const { integrationId } = await request.json();

	if (!integrationId) {
		return json({ error: 'Integration ID is required' }, { status: 400 });
	}

	try {
		await disconnectMetaAds(integrationId);
		return json({ success: true });
	} catch (err) {
		return json({ error: 'Failed to disconnect' }, { status: 500 });
	}
};
