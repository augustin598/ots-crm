import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { getIfExists } from '$lib/server/whatsapp/minio-helpers';
import { resolvePortalAvatar } from '$lib/server/portal-avatar';

/**
 * Poza utilizatorului logat în portal (footer-ul din sidebar).
 * Fără parametri: servește DOAR poza celui logat, deci nu poate fi folosit
 * pentru a citi poza altui client.
 */
export const GET: RequestHandler = async ({ locals, request }) => {
	if (!locals.user || !locals.isClientUser || !locals.client || !locals.tenant) {
		throw error(401, 'Unauthorized');
	}

	const avatar = await resolvePortalAvatar({
		tenantId: locals.tenant.id,
		userId: locals.user.id,
		clientId: locals.client.id
	});
	if (!avatar) throw error(404, 'No avatar');

	const etag = `"${avatar.version}"`;
	if (request.headers.get('if-none-match') === etag) {
		return new Response(null, { status: 304 });
	}

	const buf = await getIfExists(avatar.path);
	if (!buf) throw error(404, 'Avatar missing from storage');

	return new Response(new Uint8Array(buf), {
		status: 200,
		headers: {
			'Content-Type': avatar.mimeType,
			'Cache-Control': 'private, max-age=3600',
			ETag: etag
		}
	});
};
