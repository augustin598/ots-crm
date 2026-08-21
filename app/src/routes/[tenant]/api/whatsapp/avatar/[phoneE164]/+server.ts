import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { getIfExists } from '$lib/server/whatsapp/minio-helpers';
import { isGroupJid } from '$lib/server/whatsapp/group-jid';

/**
 * Poza unei conversații.
 *
 * Parametrul e cheia conversației, nu neapărat un telefon: la grup e JID-ul
 * („120363…@g.us"), iar poza vine din `whatsapp_group`. Numele parametrului a
 * rămas `phoneE164` fiindcă e și numele folderului rutei.
 */
export const GET: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user || !locals.tenant) throw error(401, 'Unauthorized');
	const tenantId = locals.tenant.id;
	const chatKey = params.phoneE164;
	if (!chatKey) throw error(400, 'phoneE164 required');

	let row: {
		avatarPath: string | null;
		avatarMimeType: string | null;
		avatarFetchedAt: Date | null;
	} | null = null;

	if (isGroupJid(chatKey)) {
		const [group] = await db
			.select({
				avatarPath: table.whatsappGroup.avatarPath,
				avatarMimeType: table.whatsappGroup.avatarMimeType,
				avatarFetchedAt: table.whatsappGroup.avatarFetchedAt
			})
			.from(table.whatsappGroup)
			.where(
				and(eq(table.whatsappGroup.tenantId, tenantId), eq(table.whatsappGroup.groupJid, chatKey))
			)
			.limit(1);
		row = group ?? null;
	} else {
		const [contact] = await db
			.select({
				avatarPath: table.whatsappContact.avatarPath,
				avatarMimeType: table.whatsappContact.avatarMimeType,
				avatarFetchedAt: table.whatsappContact.avatarFetchedAt
			})
			.from(table.whatsappContact)
			.where(
				and(
					eq(table.whatsappContact.tenantId, tenantId),
					eq(table.whatsappContact.phoneE164, chatKey)
				)
			)
			.limit(1);
		row = contact ?? null;
	}

	if (!row?.avatarPath) throw error(404, 'No avatar');

	const etag = `"${row.avatarFetchedAt?.getTime() ?? 0}"`;
	if (request.headers.get('if-none-match') === etag) {
		return new Response(null, { status: 304 });
	}

	const buf = await getIfExists(row.avatarPath);
	if (!buf) throw error(404, 'Avatar missing from storage');

	return new Response(new Uint8Array(buf), {
		status: 200,
		headers: {
			'Content-Type': row.avatarMimeType || 'image/jpeg',
			'Cache-Control': 'private, max-age=3600',
			ETag: etag
		}
	});
};
