/**
 * Evidența descărcărilor de atașamente Gmail (facturi furnizori).
 *
 * Scopul: să știm în UI ce factură a fost deja descărcată și încărcată în Keez,
 * ca să nu se descarce de două ori aceeași lună.
 *
 * Notă: `gmail_invoice_download` are un index unic pe
 * (tenant_id, gmail_message_id, attachment_filename) — de aceea scriem cu
 * `onConflictDoUpdate` și nu ne bazăm niciodată pe attachmentId-ul Gmail
 * (acela e efemer și se schimbă la fiecare `messages.get`).
 */

import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, inArray } from 'drizzle-orm';

/** Numele folosit când Gmail nu raportează niciun filename pentru atașament. */
const FALLBACK_FILENAME = 'atasament.pdf';

/** Câte id-uri trimitem într-un singur `IN (...)` (limita de parametri libSQL). */
const ID_CHUNK_SIZE = 200;

/**
 * Curăță un nume de fișier venit din Gmail înainte să ajungă în
 * `Content-Disposition` sau într-o intrare de ZIP.
 *
 * Elimină separatorii de cale și secvențele `..` (path traversal), reduce
 * restul caracterelor la un set sigur ASCII și limitează lungimea păstrând
 * extensia.
 */
export function sanitizeAttachmentFilename(name: string | null | undefined): string {
	if (!name) return FALLBACK_FILENAME;

	let cleaned = name
		.replace(/[\\/]/g, '_') // separatori de cale
		.replace(/\.{2,}/g, '_') // „..” → path traversal
		.replace(/[^a-zA-Z0-9-_. ]/g, '_') // diacritice, ghilimele, control chars
		.replace(/^[.\s]+/, '') // puncte/spații la început
		.trim();

	if (cleaned.length > 120) {
		const dot = cleaned.lastIndexOf('.');
		const ext = dot > 0 && cleaned.length - dot <= 10 ? cleaned.slice(dot) : '';
		cleaned = (cleaned.slice(0, 120 - ext.length) + ext).trim();
	}

	// Un nume rămas doar din separatoare (ex. „...”, „///”) nu spune nimic
	if (/^[._\s]*$/.test(cleaned)) return FALLBACK_FILENAME;

	return cleaned;
}

/**
 * Marchează un atașament ca descărcat. Idempotent: la a doua descărcare doar
 * actualizează momentul și cine a descărcat.
 *
 * Nu aruncă niciodată — o problemă la scrierea evidenței nu trebuie să strice
 * descărcarea propriu-zisă.
 */
export async function recordDownload(
	tenantId: string,
	userId: string | null,
	gmailMessageId: string,
	attachmentFilename: string | null | undefined,
	bankReference?: string | null
): Promise<void> {
	const filename = attachmentFilename?.trim() || FALLBACK_FILENAME;
	const now = new Date();

	try {
		await db
			.insert(table.gmailInvoiceDownload)
			.values({
				id: crypto.randomUUID(),
				tenantId,
				gmailMessageId,
				attachmentFilename: filename,
				bankReference: bankReference || null,
				downloadedAt: now,
				downloadedByUserId: userId
			})
			.onConflictDoUpdate({
				target: [
					table.gmailInvoiceDownload.tenantId,
					table.gmailInvoiceDownload.gmailMessageId,
					table.gmailInvoiceDownload.attachmentFilename
				],
				set: {
					downloadedAt: now,
					downloadedByUserId: userId,
					bankReference: bankReference || null
				}
			});
	} catch (err) {
		console.warn(
			`[Gmail evidență] Nu am putut înregistra descărcarea ${gmailMessageId}/${filename}:`,
			err
		);
	}
}

/**
 * Pentru o listă de mesaje Gmail, întoarce momentul ultimei descărcări
 * (per messageId). Mesajele nedescărcate lipsesc din Map.
 */
export async function getDownloadedMap(
	tenantId: string,
	gmailMessageIds: string[]
): Promise<Map<string, Date>> {
	const result = new Map<string, Date>();
	const ids = [...new Set(gmailMessageIds.filter(Boolean))];
	if (ids.length === 0) return result;

	for (let i = 0; i < ids.length; i += ID_CHUNK_SIZE) {
		const chunk = ids.slice(i, i + ID_CHUNK_SIZE);
		const rows = await db
			.select({
				gmailMessageId: table.gmailInvoiceDownload.gmailMessageId,
				downloadedAt: table.gmailInvoiceDownload.downloadedAt
			})
			.from(table.gmailInvoiceDownload)
			.where(
				and(
					eq(table.gmailInvoiceDownload.tenantId, tenantId),
					inArray(table.gmailInvoiceDownload.gmailMessageId, chunk)
				)
			);

		for (const row of rows) {
			if (!row.downloadedAt) continue;
			const existing = result.get(row.gmailMessageId);
			if (!existing || row.downloadedAt > existing) {
				result.set(row.gmailMessageId, row.downloadedAt);
			}
		}
	}

	return result;
}
