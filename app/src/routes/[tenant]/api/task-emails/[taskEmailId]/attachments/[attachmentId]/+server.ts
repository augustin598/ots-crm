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
 */
export const GET: RequestHandler = async (event) => {
	const { params, locals } = event;
	if (!locals.user || !locals.tenant) throw error(401, 'Unauthorized');
	await requireStaff(event);
	const role = locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') {
		throw error(403, 'Doar administratorii pot descărca atașamente din email.');
	}

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
	const meta = email.attachments.find((a) => a.id === params.attachmentId);
	if (!meta) throw error(404, 'Atașament negăsit');

	const buf = await getAttachment(locals.tenant.id, row.gmailMessageId, params.attachmentId);
	return new Response(new Uint8Array(buf), {
		headers: {
			'Content-Type': meta.mimeType,
			'Content-Disposition': `attachment; filename="${meta.filename.replace(/"/g, '')}"`,
			'Cache-Control': 'private, no-store'
		}
	});
};
