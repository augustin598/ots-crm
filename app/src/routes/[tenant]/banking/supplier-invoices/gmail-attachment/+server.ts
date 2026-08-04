import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { requireStaff } from '$lib/server/get-actor';
import { getEmail, getAttachment } from '$lib/server/gmail/client';
import { recordDownload, sanitizeAttachmentFilename } from '$lib/server/gmail/download-evidence';

/**
 * Descarcă un singur atașament dintr-un email Gmail.
 *
 * REGULĂ: attachmentId-urile Gmail sunt EFEMERE (se schimbă la fiecare
 * `messages.get`), deci nu acceptăm niciodată un attachmentId de la client —
 * refacem `getEmail` și rezolvăm atașamentul după INDEX din răspunsul proaspăt.
 */
export const GET: RequestHandler = async (event) => {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	await requireStaff(event);

	const messageId = event.url.searchParams.get('messageId');
	const indexParam = event.url.searchParams.get('index');
	const bankReference = event.url.searchParams.get('ref');
	if (!messageId || indexParam === null) throw error(400, 'messageId și index sunt obligatorii');

	const index = Number.parseInt(indexParam, 10);
	if (!Number.isInteger(index) || index < 0) throw error(400, 'index invalid');

	const tenantId = event.locals.tenant.id;

	// Refetch: id-urile de atașament sunt efemere — rezolvăm mereu proaspăt, după index
	const email = await getEmail(tenantId, messageId);
	const attachment = email.attachments[index];
	if (!attachment) throw error(404, 'Atașamentul nu există');

	const buffer = await getAttachment(tenantId, messageId, attachment.id);
	await recordDownload(
		tenantId,
		event.locals.user.id,
		messageId,
		attachment.filename,
		bankReference
	);

	const filename = sanitizeAttachmentFilename(attachment.filename);

	return new Response(buffer as unknown as BodyInit, {
		status: 200,
		headers: {
			'Content-Type': attachment.mimeType || 'application/pdf',
			'Content-Disposition': `attachment; filename="${filename}"`,
			'Content-Length': buffer.length.toString()
		}
	});
};
