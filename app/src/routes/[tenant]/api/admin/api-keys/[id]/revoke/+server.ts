import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import * as tenantUtils from '$lib/server/tenant';
import { revokeApiKey } from '$lib/server/api-keys/manager';

export const POST: RequestHandler = async (event) => {
	if (!event.locals.user || !event.locals.tenant) {
		throw error(401, 'Unauthorized');
	}

	const tenantId = event.locals.tenant.id;
	const access = await tenantUtils.getTenantById(tenantId, event.locals.user.id);
	if (!access || access.tenantUser.role === 'member') {
		throw error(403, 'Doar admins pot revoca API keys');
	}

	const { id } = event.params;
	if (!id) throw error(400, 'Missing key id');

	await revokeApiKey(id, tenantId);
	return json({ ok: true });
};
