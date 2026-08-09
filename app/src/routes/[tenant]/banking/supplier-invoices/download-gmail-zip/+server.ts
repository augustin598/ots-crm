import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import JSZip from 'jszip';
import { requireStaff } from '$lib/server/get-actor';
import { getEmail, getAttachment } from '$lib/server/gmail/client';
import { recordDownload, sanitizeAttachmentFilename } from '$lib/server/gmail/download-evidence';
import { mapGmailError } from '$lib/server/gmail/errors';
import { MAX_ZIP_ITEMS } from '$lib/utils/gmail-search';
import { logWarning, serializeError } from '$lib/server/logger';

interface ZipItem {
	messageId: string;
	/** Prefix pentru numele fișierului, ex. referința Keez + comerciant: „12326_HETZNER_180.04EUR” */
	label?: string;
	bankReference?: string;
}

interface PreparedEntry {
	name: string;
	buffer: Buffer;
	messageId: string;
	rawFilename: string;
	bankReference?: string;
}

/**
 * Numărul de emailuri dintr-o selecție. Vine din modulul pur `$lib/utils/gmail-search`
 * (SURSĂ UNICĂ) fiindcă și clientul are nevoie de el ca să spargă selecția în tranșe:
 * un `+server.ts` nu poate fi importat de client, dar invers se poate.
 */
const MAX_ITEMS = MAX_ZIP_ITEMS;

/**
 * Plafon de octeți pe arhivă. MAX_ITEMS limitează doar numărul de emailuri, nu
 * volumul: 100 de facturi scanate pot însemna sute de MB în RAM. Mărimea vine din
 * `getEmail` (metadate), deci sărim peste atașamentele prea mari FĂRĂ să le mai
 * descărcăm.
 */
const MAX_TOTAL_BYTES = 150 * 1024 * 1024;

/**
 * Buget de timp pentru toată arhiva. Ce nu apucăm să descărcăm intră la „sărite”.
 * Rămâne sub timeout-urile uzuale de proxy/browser (60s).
 */
const TIME_BUDGET_MS = 45_000;

/**
 * Câte emailuri procesăm în paralel. 100 de emailuri serializate la ~300-500ms
 * dus-întors înseamnă peste un minut. Gmail permite 250 unități/secundă, iar
 * `messages.get` și `attachments.get` costă 5 unități fiecare — 5 în paralel e
 * confortabil sub cotă.
 */
const CONCURRENCY = 5;

/**
 * Descarcă în bloc, ca ZIP, toate PDF-urile din emailurile selectate.
 *
 * REGULĂ: attachmentId-urile Gmail sunt EFEMERE — pentru fiecare mesaj refacem
 * `getEmail` și folosim id-urile din răspunsul proaspăt. Mesajele care eșuează, nu
 * au PDF-uri sau nu încap în bugete sunt sărite, iar numărul lor pleacă în
 * `X-Skipped-Count`. O problemă de autorizare Gmail însă oprește totul (n-are rost
 * să încercăm restul) și iese ca 409.
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
	const deadline = Date.now() + TIME_BUDGET_MS;

	// Rezultatele stau pe poziția itemului, nu în ordinea în care se termină —
	// altfel numele intrărilor din arhivă ar depinde de cursa de rețea.
	const prepared: PreparedEntry[][] = items.map(() => []);
	const skipped = new Set<number>();
	let totalBytes = 0;
	let authFailure: { status: 409 | 404 | 502; message: string } | null = null;

	const skip = (idx: number, reason: string, err?: unknown) => {
		skipped.add(idx);
		logWarning('gmail', `ZIP: sar peste emailul selectat (${reason})`, {
			tenantId,
			userId,
			metadata: {
				gmailMessageId: items[idx]?.messageId,
				reason,
				...(err ? { error: serializeError(err) } : {})
			}
		});
	};

	const processItem = async (idx: number) => {
		const item = items[idx];
		if (!item?.messageId) return skip(idx, 'messageId lipsă');
		if (Date.now() > deadline) return skip(idx, 'buget de timp depășit');

		try {
			// Refetch proaspăt — id-urile de atașament Gmail sunt efemere
			const email = await getEmail(tenantId, item.messageId);
			const pdfs = email.attachments.filter(
				(a) =>
					a.mimeType === 'application/pdf' || (a.filename || '').toLowerCase().endsWith('.pdf')
			);
			if (pdfs.length === 0) return skip(idx, 'fără atașamente PDF');

			for (const att of pdfs) {
				if (Date.now() > deadline) {
					skip(idx, 'buget de timp depășit');
					break;
				}
				// Mărimea o știm din metadate: refuzăm înainte să plătim dus-întorsul
				if (totalBytes + (att.size || 0) > MAX_TOTAL_BYTES) {
					skip(idx, 'buget de octeți depășit');
					break;
				}
				totalBytes += att.size || 0;

				const buffer = await getAttachment(tenantId, item.messageId, att.id);
				const name = sanitizeAttachmentFilename(att.filename);
				const base = item.label ? `${sanitizeAttachmentFilename(item.label)}_${name}` : name;
				prepared[idx].push({
					name: base,
					buffer,
					messageId: item.messageId,
					rawFilename: att.filename,
					bankReference: item.bankReference
				});
			}
		} catch (err) {
			const mapped = mapGmailError(err);
			if (mapped.kind === 'not-connected') {
				// Autorizarea e globală, nu per-email: oprim toată arhiva.
				authFailure = mapped;
			}
			skip(idx, mapped.kind, err);
		}
	};

	// Pool cu paralelism mărginit: fiecare „worker” ia următorul index liber.
	let cursor = 0;
	const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
		while (cursor < items.length && !authFailure) {
			const idx = cursor++;
			await processItem(idx);
		}
	});
	await Promise.all(workers);

	if (authFailure) {
		const { status, message } = authFailure as { status: 409 | 404 | 502; message: string };
		throw error(status, message);
	}

	const zip = new JSZip();
	let added = 0;
	for (let idx = 0; idx < prepared.length; idx++) {
		const entries = prepared[idx];
		for (let sub = 0; sub < entries.length; sub++) {
			const entry = entries[sub];
			// Numerotarea urmează ORDINEA SELECȚIEI (nu ordinea de finalizare), iar
			// prefixul pe 3 cifre ține sortarea corectă și peste 99 de fișiere.
			// JSZip suprascrie tacit intrările cu același nume — prefixul le face unice.
			const position = `${String(idx + 1).padStart(3, '0')}${entries.length > 1 ? `-${sub + 1}` : ''}`;
			zip.file(`${position}_${entry.name}`, entry.buffer);
			await recordDownload(
				tenantId,
				userId,
				entry.messageId,
				entry.rawFilename,
				entry.bankReference
			);
			added++;
		}
	}

	if (added === 0) throw error(404, 'Niciun PDF descărcabil în selecție');

	// PDF-urile sunt deja comprimate: DEFLATE ar arde CPU pentru ~0% câștig.
	const zipBuffer = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' });
	const date = new Date().toISOString().slice(0, 10);

	return new Response(zipBuffer as unknown as BodyInit, {
		status: 200,
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename="facturi-gmail-${date}.zip"`,
			'Content-Length': zipBuffer.length.toString(),
			'X-Skipped-Count': skipped.size.toString()
		}
	});
};
