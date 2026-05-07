import { error, redirect } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { getActor } from './get-actor';
import { assertCan } from './access';

/**
 * Throws redirect/error if the actor cannot access tenant team management.
 * Now powered by the unified capability engine — anyone with `admin.team.view`
 * can access. (Default: owner, admin.)
 */
export async function ensureAdminTeamAccess(event: RequestEvent): Promise<void> {
	if (!event.locals.user) {
		throw redirect(302, '/login?redirect=' + encodeURIComponent(event.url.pathname));
	}
	if (!event.locals.tenant || !event.locals.tenantUser) {
		throw error(403, 'Forbidden');
	}
	const actor = await getActor(event);
	assertCan(actor, 'admin.team.view');
}

/**
 * Throws redirect/error if the actor cannot manage their client portal team.
 * Now powered by the unified capability engine — anyone with
 * `portal.team.manage` can access (which currently means primary contact only).
 */
export async function ensureClientTeamAccess(event: RequestEvent): Promise<void> {
	if (!event.locals.user) {
		const slug = event.params.tenant ?? '';
		throw redirect(302, `/client/${slug}/login`);
	}
	if (!event.locals.client || !event.locals.clientUser) {
		throw error(403, 'Forbidden');
	}
	const actor = await getActor(event);
	assertCan(actor, 'portal.team.manage');
}
