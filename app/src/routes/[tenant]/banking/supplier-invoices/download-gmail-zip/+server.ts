import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import JSZip from 'jszip';
import { requireStaff } from '$lib/server/get-actor';
import { getEmail, getAttachment } from '$lib/server/gmail/client';
import { recordDownload, sanitizeAttachmentFilename } from '$lib/server/gmail/download-evidence';

interface ZipItem {
	messageId: string;
	/** Prefix pentru numele fișierului, ex. referința Keez + comerciant: „12326_HETZNER_180.04EUR” */
	label?: string;
	bankReference?: string;
}

const MAX_ITEMS = 100;

/**
 * Descarcă în bloc, ca ZIP, toate PDF-urile din emailurile selectate.
 *
 * REGULĂ: attachmentId-urile Gmail sunt EFEMERE — pentru fiecare mesaj refacem
 * `getEmail` și folosim id-urile din răspunsul proaspăt. Mesajele care eșuează
 * sau nu au PDF-uri sunt sărite, iar numărul lor pleacă în `X-Skipped-Count`.
 */
export const POST: RequestHandler = async (event) => {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	await requireStaff(event);

	const body = await event.request.json().catch(() => null);
	const items = (body?.items ?? null) as ZipItem[] | null;
	if (!Array.isArray(items) || items.length === 0) throw error(400, 'Niciun email selectat');
	if (items.length > MAX_ITEMS) throw error(400, `Prea multe selectate (max ${MAX_ITEMS})`);

	const tenantId = event.locals.tenant.id;
	const userId = event.locals.user.id;
	const zip = new JSZip();
	const skipped: string[] = [];
	let added = 0;

	for (const item of items) {
		if (!item?.messageId) {
			skipped.push(String(item?.messageId ?? ''));
			continue;
		}

		try {
			// Refetch proaspăt — id-urile de atașament Gmail sunt efemere
			const email = await getEmail(tenantId, item.messageId);
			const pdfs = email.attachments.filter(
				(a) =>
					a.mimeType === 'application/pdf' ||
					(a.filename || '').toLowerCase().endsWith('.pdf')
			);
			if (pdfs.length === 0) {
				skipped.push(item.messageId);
				continue;
			}

			for (const att of pdfs) {
				const buffer = await getAttachment(tenantId, item.messageId, att.id);
				const name = sanitizeAttachmentFilename(att.filename);
				const base = item.label ? `${sanitizeAttachmentFilename(item.label)}_${name}` : name;
				// JSZip suprascrie tacit intrările cu același nume — prefixăm cu un contor
				zip.file(`${String(added + 1).padStart(2, '0')}_${base}`, buffer);
				await recordDownload(tenantId, userId, item.messageId, att.filename, item.bankReference);
				added++;
			}
		} catch (err) {
			console.warn(`[Gmail ZIP] Sar peste mesajul ${item.messageId}:`, err);
			skipped.push(item.messageId);
		}
	}

	if (added === 0) throw error(404, 'Niciun PDF descărcabil în selecție');

	const zipBuffer = await zip.generateAsync({ type: 'uint8array' });
	const date = new Date().toISOString().slice(0, 10);

	return new Response(zipBuffer as unknown as BodyInit, {
		status: 200,
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename="facturi-gmail-${date}.zip"`,
			'Content-Length': zipBuffer.length.toString(),
			'X-Skipped-Count': skipped.length.toString()
		}
	});
};
