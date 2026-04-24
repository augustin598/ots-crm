import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { getIfExists } from '$lib/server/whatsapp/minio-helpers';

export const GET: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user || !locals.tenant) throw error(401, 'Unauthorized');
	const tenantId = locals.tenant.id;
	const clientId = params.clientId;
	if (!clientId) throw error(400, 'clientId required');

	const [row] = await db
		.select({
			avatarPath: table.client.avatarPath,
			updatedAt: table.client.updatedAt
		})
		.from(table.client)
		.where(and(eq(table.client.tenantId, tenantId), eq(table.client.id, clientId)))
		.limit(1);

	if (!row?.avatarPath) throw error(404, 'No avatar');

	const etag = `"${row.updatedAt?.getTime() ?? 0}"`;
	if (request.headers.get('if-none-match') === etag) {
		return new Response(null, { status: 304 });
	}

	const buf = await getIfExists(row.avatarPath);
	if (!buf) throw error(404, 'Avatar missing from storage');

	const mimeFromExt = row.avatarPath.endsWith('.png')
		? 'image/png'
		: row.avatarPath.endsWith('.webp')
			? 'image/webp'
			: 'image/jpeg';

	return new Response(new Uint8Array(buf), {
		status: 200,
		headers: {
			'Content-Type': mimeFromExt,
			'Cache-Control': 'private, max-age=3600',
			ETag: etag
		}
	});
};
