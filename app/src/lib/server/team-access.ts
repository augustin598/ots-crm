import { error, redirect } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';

/**
 * Throws redirect/error if the actor cannot access tenant team management.
 * Allowed: owner, admin (NOT member).
 */
export function ensureAdminTeamAccess(event: RequestEvent): void {
	if (!event.locals.user) {
		throw redirect(302, '/login?redirect=' + encodeURIComponent(event.url.pathname));
	}
	if (!event.locals.tenant || !event.locals.tenantUser) {
		throw error(403, 'Forbidden');
	}
	const role = event.locals.tenantUser.role;
	if (role !== 'owner' && role !== 'admin') {
		throw error(403, 'Doar owner / admin pot accesa pagina Team');
	}
}

/**
 * Throws redirect/error if the actor cannot manage their client portal team.
 * MVP gate: only the primary client user. (When `canManageTeam` flag ships in
 * accessFlags, secondary users with that flag will also be allowed.)
 */
export function ensureClientTeamAccess(event: RequestEvent): void {
	if (!event.locals.user) {
		const slug = event.params.tenant ?? '';
		throw redirect(302, `/client/${slug}/login`);
	}
	if (!event.locals.client || !event.locals.clientUser) {
		throw error(403, 'Forbidden');
	}
	if (!event.locals.clientUser.isPrimary) {
		throw error(403, 'Doar contul principal poate gestiona echipa.');
	}
}
