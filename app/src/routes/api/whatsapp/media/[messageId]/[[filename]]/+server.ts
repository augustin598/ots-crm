import type { RequestHandler } from './$types';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { loadMediaBuffer } from '$lib/server/whatsapp/media-handler';

/**
 * Media dintr-un mesaj WhatsApp.
 *
 *   /api/whatsapp/media/<id>
 *   /api/whatsapp/media/<id>/<nume fișier>
 *
 * Ultimul segment e doar cosmetic: nu-l citim, dar browserul îl folosește ca nume
 * la descărcare. Fără el, numele depinde numai de antetul `Content-Disposition`,
 * pe care Chrome îl ignoră când răspunsul vine din cache cu o dispoziție veche,
 * și atunci salvează fișierul cu un nume inventat, fără extensie.
 */
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

	// Pozele, filmele, sunetul și PDF-ul se afișează în pagină. Restul se descarcă:
	// pe „inline" cu un tip pe care nu-l poate reda, browserul salvează fișierul cu
	// un nume inventat, în loc de cel din antet.
	// SVG-ul e o excepție: e o imagine care poate conține script, iar tipul vine de
	// la expeditor. Servit „inline" pe domeniul nostru, ar rula în contul cititorului.
	const renderable =
		(mimeType.startsWith('image/') && mimeType !== 'image/svg+xml') ||
		mimeType.startsWith('video/') ||
		mimeType.startsWith('audio/') ||
		mimeType === 'application/pdf';
	const disposition = renderable ? 'inline' : 'attachment';

	const headers: Record<string, string> = {
		'Content-Type': mimeType,
		'Content-Length': String(buffer.length),
		'Cache-Control': 'private, max-age=3600'
	};
	if (row.mediaFileName) {
		// Numele cu diacritice sau spații are nevoie și de forma codificată RFC 5987,
		// altfel browserele vechi taie tot ce urmează după primul caracter neascii.
		const safe = row.mediaFileName.replace(/["\\\r\n]/g, '');
		headers['Content-Disposition'] =
			`${disposition}; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(row.mediaFileName)}`;
	} else {
		headers['Content-Disposition'] = disposition;
	}
	return new Response(new Uint8Array(buffer), { headers });
};
