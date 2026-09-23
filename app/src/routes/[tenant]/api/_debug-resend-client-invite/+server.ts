import { json, error } from '@sveltejs/kit';
import { and, eq, sql } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { sendClientTeamInviteEmail } from '$lib/server/email';
import { generateMagicLinkToken, hashToken } from '$lib/server/client-auth';
import { serializeError } from '$lib/server/logger';
import type { RequestHandler } from './$types';

/**
 * Retrimite invitația în portal unui contact secundar DEJA adăugat pe client.
 *
 *   POST { clientId, email }
 *
 * De ce există: până la fix-ul din ClientTeamEditor/TeamClientPanel, modalul
 * „Invită membru nou" din admin adăuga contactul fără să trimită invitația
 * (lipsea `sendInvite: true`). Contactele adăugate atunci n-au primit nimic.
 *
 * Aceeași logică de token ca createClientSecondaryEmail: invalidează tokenii
 * nefolosiți ai adresei, emite unul nou (24h, single-use), șterge tokenul dacă
 * emailul nu pleacă. Destinatarul trebuie să fie emailul secundar al clientului.
 *
 * Owner/admin.
 */
const MAGIC_LINK_EXPIRY_HOURS = 24;

function requireAdmin(event: Parameters<RequestHandler>[0]) {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	const role = event.locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') {
		throw error(403, 'Forbidden: Admin access required');
	}
	return { tenantId: event.locals.tenant.id, tenantSlug: event.locals.tenant.slug };
}

export const POST: RequestHandler = async (event) => {
	const { tenantId, tenantSlug } = requireAdmin(event);
	const body = (await event.request.json().catch(() => ({}))) as {
		clientId?: string;
		email?: string;
	};
	const clientId = body.clientId?.trim();
	const email = body.email?.trim().toLowerCase();
	if (!clientId || !email) throw error(400, 'clientId și email sunt obligatorii');

	const [client] = await db
		.select({ id: table.client.id, name: table.client.name })
		.from(table.client)
		.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, tenantId)))
		.limit(1);
	if (!client) throw error(404, 'Client negăsit');

	const [secondary] = await db
		.select({ id: table.clientSecondaryEmail.id })
		.from(table.clientSecondaryEmail)
		.where(
			and(
				eq(table.clientSecondaryEmail.tenantId, tenantId),
				eq(table.clientSecondaryEmail.clientId, clientId),
				eq(sql`lower(${table.clientSecondaryEmail.email})`, email)
			)
		)
		.limit(1);
	if (!secondary) throw error(404, 'Adresa nu e contact secundar al acestui client');

	await db
		.update(table.magicLinkToken)
		.set({ used: true, usedAt: new Date() })
		.where(
			and(
				eq(table.magicLinkToken.email, email),
				eq(table.magicLinkToken.tenantId, tenantId),
				eq(table.magicLinkToken.used, false)
			)
		);

	const plainToken = generateMagicLinkToken();
	const tokenId = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
	await db.insert(table.magicLinkToken).values({
		id: tokenId,
		token: hashToken(plainToken),
		email,
		clientId,
		matchedClientIds: JSON.stringify([clientId]),
		tenantId,
		expiresAt: new Date(Date.now() + MAGIC_LINK_EXPIRY_HOURS * 60 * 60 * 1000),
		used: false
	});

	const inviter = event.locals.user!;
	const inviterName =
		`${inviter.firstName ?? ''} ${inviter.lastName ?? ''}`.trim() || inviter.email || 'Un coleg';

	try {
		await sendClientTeamInviteEmail(email, plainToken, tenantSlug, client.name ?? 'portal', inviterName);
	} catch (err) {
		await db
			.delete(table.magicLinkToken)
			.where(and(eq(table.magicLinkToken.id, tokenId), eq(table.magicLinkToken.tenantId, tenantId)))
			.catch(() => {});
		return json({ ok: false, error: serializeError(err).message }, { status: 502 });
	}

	return json({ ok: true, email, client: client.name, expiresInHours: MAGIC_LINK_EXPIRY_HOURS });
};
