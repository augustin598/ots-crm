import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';

export type PortalAvatar = {
	path: string;
	mimeType: string;
	/** Se schimbă când se schimbă poza — folosit ca ETag și cache-bust în URL. */
	version: number;
};

/**
 * Poza utilizatorului logat în portal.
 *
 * 1. Poza lui de WhatsApp (numărul din user_whatsapp_link → whatsapp_contact).
 * 2. Altfel poza clientului (client.avatarPath) — tot din WhatsApp, a contactului principal.
 */
export async function resolvePortalAvatar(params: {
	tenantId: string;
	userId: string;
	clientId: string;
}): Promise<PortalAvatar | null> {
	const [contact] = await db
		.select({
			avatarPath: table.whatsappContact.avatarPath,
			avatarMimeType: table.whatsappContact.avatarMimeType,
			avatarFetchedAt: table.whatsappContact.avatarFetchedAt,
			avatarHidden: table.whatsappContact.avatarHidden
		})
		.from(table.userWhatsappLink)
		.innerJoin(
			table.whatsappContact,
			and(
				eq(table.whatsappContact.tenantId, table.userWhatsappLink.tenantId),
				eq(table.whatsappContact.phoneE164, table.userWhatsappLink.phoneE164)
			)
		)
		.where(
			and(
				eq(table.userWhatsappLink.tenantId, params.tenantId),
				eq(table.userWhatsappLink.userId, params.userId)
			)
		)
		.limit(1);
	if (contact?.avatarPath && !contact.avatarHidden) {
		return {
			path: contact.avatarPath,
			mimeType: contact.avatarMimeType || 'image/jpeg',
			version: contact.avatarFetchedAt?.getTime() ?? 0
		};
	}

	const [client] = await db
		.select({ avatarPath: table.client.avatarPath, updatedAt: table.client.updatedAt })
		.from(table.client)
		.where(and(eq(table.client.tenantId, params.tenantId), eq(table.client.id, params.clientId)))
		.limit(1);
	if (client?.avatarPath) {
		const p = client.avatarPath;
		return {
			path: p,
			mimeType: p.endsWith('.png') ? 'image/png' : p.endsWith('.webp') ? 'image/webp' : 'image/jpeg',
			version: client.updatedAt?.getTime() ?? 0
		};
	}
	return null;
}
