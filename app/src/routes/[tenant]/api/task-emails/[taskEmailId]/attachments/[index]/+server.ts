import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { requireStaff } from '$lib/server/get-actor';
import { getAttachment, getEmail } from '$lib/server/gmail/client';

/**
 * Descarcă un atașament dintr-un email asociat unui task.
 * Gmail LIVE → doar owner/admin (inboxul e emailul personal al adminului;
 * staff vede doar metadatele salvate, clientul din portal doar subiect+dată).
 *
 * Atașamentul e identificat prin INDEX, nu prin attachmentId: ID-urile de
 * atașamente Gmail sunt efemere (se schimbă la fiecare messages.get), deci un
 * id obținut de client dintr-un fetch anterior nu s-ar mai potrivi aici.
 * Indexul e stabil în payload-ul mesajului; id-ul proaspăt vine din propriul
 * nostru getEmail de mai jos.
 */
export const GET: RequestHandler = async (event) => {
	const { params, locals } = event;
	if (!locals.user || !locals.tenant) throw error(401, 'Unauthorized');
	await requireStaff(event);
	const role = locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') {
		throw error(403, 'Doar administratorii pot descărca atașamente din email.');
	}

	const index = Number.parseInt(params.index, 10);
	if (!Number.isInteger(index) || index < 0) throw error(400, 'Index atașament invalid');

	const [row] = await db
		.select({
			id: table.taskEmail.id,
			gmailMessageId: table.taskEmail.gmailMessageId
		})
		.from(table.taskEmail)
		.where(
			and(
				eq(table.taskEmail.id, params.taskEmailId),
				eq(table.taskEmail.tenantId, locals.tenant.id)
			)
		)
		.limit(1);
	if (!row) throw error(404, 'Email negăsit');

	// Numele/mime-ul vin din mesajul Gmail, nu din query params (nu avem
	// încredere în client pentru Content-Disposition).
	const email = await getEmail(locals.tenant.id, row.gmailMessageId);
	const meta = email.attachments[index];
	if (!meta) throw error(404, 'Atașament negăsit');

	const buf = await getAttachment(locals.tenant.id, row.gmailMessageId, meta.id);
	return new Response(new Uint8Array(buf), {
		headers: {
			'Content-Type': meta.mimeType,
			'Content-Disposition': `attachment; filename="${meta.filename.replace(/[\r\n"]/g, '')}"`,
			'Cache-Control': 'private, no-store'
		}
	});
};
