import { error, fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import * as tenantUtils from '$lib/server/tenant';
import { createApiKey, listApiKeys, revokeApiKey } from '$lib/server/api-keys/manager';
import { API_KEY_SCOPES, type ApiKeyScope } from '$lib/server/db/schema';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user || !event.locals.tenant) throw redirect(302, '/login');
	const tenantId = event.locals.tenant.id;

	const access = await tenantUtils.getTenantById(tenantId, event.locals.user.id);
	if (!access || access.tenantUser.role === 'member') {
		throw error(403, 'Doar admins pot gestiona API keys');
	}

	const keys = await listApiKeys(tenantId);
	return { keys, allScopes: [...API_KEY_SCOPES] };
};

export const actions: Actions = {
	create: async (event) => {
		if (!event.locals.user || !event.locals.tenant) throw redirect(302, '/login');
		const tenantId = event.locals.tenant.id;
		const tenantSlug = event.locals.tenant.slug;

		const access = await tenantUtils.getTenantById(tenantId, event.locals.user.id);
		if (!access || access.tenantUser.role === 'member') {
			return fail(403, { error: 'forbidden' });
		}

		const formData = await event.request.formData();
		const name = String(formData.get('name') ?? '').trim();
		const scopesRaw = formData.getAll('scopes').map((s) => String(s)) as ApiKeyScope[];
		const expiresInDaysRaw = String(formData.get('expiresInDays') ?? '').trim();

		if (!name) return fail(400, { error: 'name_required' });
		if (scopesRaw.length === 0) return fail(400, { error: 'scopes_required' });
		for (const s of scopesRaw) {
			if (!API_KEY_SCOPES.includes(s)) return fail(400, { error: 'invalid_scope', scope: s });
		}

		let expiresAt: Date | undefined;
		if (expiresInDaysRaw) {
			const days = parseInt(expiresInDaysRaw, 10);
			if (Number.isFinite(days) && days > 0) {
				expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
			}
		}

		const result = await createApiKey({
			tenantId,
			tenantSlug,
			name,
			scopes: scopesRaw,
			createdByUserId: event.locals.user.id,
			expiresAt
		});

		return { created: true, plaintext: result.plaintext, id: result.id, prefix: result.prefix };
	},

	revoke: async (event) => {
		if (!event.locals.user || !event.locals.tenant) throw redirect(302, '/login');
		const tenantId = event.locals.tenant.id;

		const access = await tenantUtils.getTenantById(tenantId, event.locals.user.id);
		if (!access || access.tenantUser.role === 'member') {
			return fail(403, { error: 'forbidden' });
		}

		const formData = await event.request.formData();
		const id = String(formData.get('id') ?? '');
		if (!id) return fail(400, { error: 'invalid_input' });

		await revokeApiKey(id, tenantId);
		return { revoked: true };
	}
};
