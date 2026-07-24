/**
 * Guard-uri de acces pentru modulul Content, partajate de remote-urile de conținut
 * (content-articles.remote, website-content-profile.remote).
 *
 * Model (pattern F8, ca la seo-links.remote.ts): staff trec prin requireStaff; utilizatorii
 * de portal (isClientUser) sunt scopați forțat la clientul din sesiune + switch-ul admin
 * `websiteContentProfile.allowClientAi`. Când switch-ul e ON, clientul are acces COMPLET la
 * modulul Content pentru website-urile lui (articole, profil brand, politică, publicare).
 */
import { error as svelteError } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { requireStaff } from '$lib/server/get-actor';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';

/**
 * Auth de bază pt content: 401 dacă lipsește user/tenant. Utilizatorii de portal
 * (isClientUser) trec fără requireStaff — accesul per-website se verifică separat
 * cu {@link assertWebsiteClientAccess}. Restul (staff / admin ce vizitează portalul)
 * trec prin requireStaff. Întoarce dacă e client + clientId-ul de scoping.
 */
export async function contentAuth(
	event: RequestEvent
): Promise<{ isClient: boolean; clientId: string | null }> {
	if (!event?.locals.user || !event?.locals.tenant) svelteError(401, 'Unauthorized');
	if (event.locals.isClientUser && event.locals.client) {
		return { isClient: true, clientId: event.locals.client.id };
	}
	await requireStaff(event);
	return { isClient: false, clientId: null };
}

/**
 * Pt utilizatorii de portal: website-ul trebuie să aparțină clientului din sesiune
 * ȘI profilul lui să aibă `allowClientAi = true`; altfel 403. Staff: no-op.
 */
export async function assertWebsiteClientAccess(
	event: RequestEvent,
	tenantId: string,
	websiteId: string | null | undefined
): Promise<void> {
	if (!event?.locals.isClientUser) return;
	const clientId = event.locals.client?.id;
	if (!clientId) svelteError(403, 'Nu ai acces la acest website.');
	if (!websiteId) svelteError(403, 'Nu ai acces la acest website.');
	const rows = await db
		.select({ allow: table.websiteContentProfile.allowClientAi })
		.from(table.clientWebsite)
		.leftJoin(
			table.websiteContentProfile,
			eq(table.websiteContentProfile.websiteId, table.clientWebsite.id)
		)
		.where(
			and(
				eq(table.clientWebsite.id, websiteId),
				eq(table.clientWebsite.tenantId, tenantId),
				eq(table.clientWebsite.clientId, clientId)
			)
		)
		.limit(1);
	if (!rows[0] || !rows[0].allow) svelteError(403, 'Nu ai acces la acest website.');
}

/**
 * Pt utilizatorii de portal: rezolvă website-ul unui articol și aplică access-check-ul.
 * Staff: no-op. 404 dacă articolul lipsește, 403 dacă articolul n-are website sau
 * clientul n-are acces. (Apelanții care au deja rândul articolului pot chema direct
 * assertWebsiteClientAccess cu a.websiteId, evitând a doua citire.)
 */
export async function assertArticleClientAccess(
	event: RequestEvent,
	tenantId: string,
	articleId: string
): Promise<void> {
	if (!event?.locals.isClientUser) return;
	const rows = await db
		.select({ websiteId: table.contentArticle.websiteId })
		.from(table.contentArticle)
		.where(
			and(eq(table.contentArticle.id, articleId), eq(table.contentArticle.tenantId, tenantId))
		)
		.limit(1);
	if (!rows[0]) svelteError(404, 'Articol negăsit');
	await assertWebsiteClientAccess(event, tenantId, rows[0].websiteId);
}
