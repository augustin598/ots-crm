import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { getIfExists } from '$lib/server/whatsapp/minio-helpers';

export const GET: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user || !locals.tenant) throw error(401, 'Unauthorized');
	const tenantId = locals.tenant.id;
	const phoneE164 = params.phoneE164;
	if (!phoneE164) throw error(400, 'phoneE164 required');

	const [row] = await db
		.select({
			avatarPath: table.whatsappContact.avatarPath,
			avatarMimeType: table.whatsappContact.avatarMimeType,
			avatarFetchedAt: table.whatsappContact.avatarFetchedAt
		})
		.from(table.whatsappContact)
		.where(
			and(
				eq(table.whatsappContact.tenantId, tenantId),
				eq(table.whatsappContact.phoneE164, phoneE164)
			)
		)
		.limit(1);

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
