import type { RequestHandler } from './$types';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { loadMediaBuffer } from '$lib/server/whatsapp/media-handler';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) {
		return new Response('Unauthorized', { status: 401 });
	}
	const messageId = params.messageId;
	if (!messageId) return new Response('Bad Request', { status: 400 });

	// Resolve allowed tenants for this user (fallback when /api/* routes have no [tenant] param)
	let tenantIds: string[] = [];
	if (locals.tenant) {
		tenantIds = [locals.tenant.id];
	} else {
		const memberships = await db
			.select({ tenantId: table.tenantUser.tenantId })
			.from(table.tenantUser)
			.where(eq(table.tenantUser.userId, locals.user.id));
		tenantIds = memberships.map((m) => m.tenantId);
	}
	if (tenantIds.length === 0) return new Response('Forbidden', { status: 403 });

	const [row] = await db
		.select({
			mediaPath: table.whatsappMessage.mediaPath,
			mediaMimeType: table.whatsappMessage.mediaMimeType,
			mediaFileName: table.whatsappMessage.mediaFileName
		})
		.from(table.whatsappMessage)
		.where(and(eq(table.whatsappMessage.id, messageId), inArray(table.whatsappMessage.tenantId, tenantIds)))
		.limit(1);

	if (!row?.mediaPath) return new Response('Not Found', { status: 404 });

	const buffer = await loadMediaBuffer(row.mediaPath);
	if (!buffer) return new Response('Not Found', { status: 404 });

	const mimeType = row.mediaMimeType ?? 'application/octet-stream';
	const headers: Record<string, string> = {
		'Content-Type': mimeType,
		'Content-Length': String(buffer.length),
		'Cache-Control': 'private, max-age=3600'
	};
	if (row.mediaFileName) {
		headers['Content-Disposition'] = `inline; filename="${row.mediaFileName.replace(/"/g, '')}"`;
	}
	return new Response(new Uint8Array(buffer), { headers });
};
