/**
 * email-preview.ts
 *
 * Emailurile noastre referă imaginile prin `cid:` (Content-ID) — logo-ul de
 * antet și pozele din comentariile de task. Într-un client de email asta e
 * corect: piesele MIME sunt atașate lângă HTML. Într-un browser însă nu există
 * niciun MIME, deci `<img src="cid:...">` rămâne mereu o imagine ruptă.
 *
 * Pagina /admin/logs/email-preview randează exact `html_body`-ul salvat, deci
 * moștenea limitarea. Aici rezolvăm fiecare `cid:` la un `data:` URI, ca
 * previzualizarea să arate ce vede efectiv destinatarul. Folosim `data:` și nu
 * URL-uri presemnate ca să nu lărgim CSP-ul strict al paginii și ca preview-ul
 * să nu expire după 5 minute.
 *
 * Best-effort: orice `cid` nerezolvabil rămâne neatins (imagine ruptă, ca
 * înainte) — o previzualizare parțială e preferabilă unui 500.
 */

import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import * as storage from '$lib/server/storage';
import { logWarning, serializeError } from '$lib/server/logger';

/** Plafon peste care nu mai inline-uim în preview (pagina ar deveni imensă). */
const PREVIEW_MAX_TOTAL_BYTES = 12 * 1024 * 1024;

/** `cid:companylogo`, `cid:taskcommentimg-<attachmentId>`, `cid:taskcommentimg0` (vechi). */
const CID_RE = /cid:([A-Za-z0-9][A-Za-z0-9._-]*)/g;

function dataUri(mime: string | null | undefined, buf: Buffer): string {
	return `data:${mime || 'application/octet-stream'};base64,${buf.toString('base64')}`;
}

/** Logo-ul e deja stocat ca data: URI în invoice_settings — îl dăm mai departe ca atare. */
async function resolveCompanyLogo(tenantId: string): Promise<string | null> {
	const [settings] = await db
		.select({ invoiceLogo: table.invoiceSettings.invoiceLogo })
		.from(table.invoiceSettings)
		.where(eq(table.invoiceSettings.tenantId, tenantId))
		.limit(1);
	const logo = settings?.invoiceLogo;
	if (!logo) return null;
	return logo.startsWith('data:') ? logo : `data:image/png;base64,${logo}`;
}

/** Atașament de comentariu după id, cu tenant scoping prin comment → task. */
async function resolveAttachmentById(attachmentId: string, tenantId: string) {
	const [row] = await db
		.select({
			path: table.taskCommentAttachment.path,
			mimeType: table.taskCommentAttachment.mimeType
		})
		.from(table.taskCommentAttachment)
		.innerJoin(
			table.taskComment,
			eq(table.taskCommentAttachment.commentId, table.taskComment.id)
		)
		.innerJoin(table.task, eq(table.taskComment.taskId, table.task.id))
		.where(
			and(eq(table.taskCommentAttachment.id, attachmentId), eq(table.task.tenantId, tenantId))
		)
		.limit(1);
	return row ?? null;
}

/**
 * Emailurile trimise înainte de cid-urile cu id foloseau `taskcommentimg<N>`,
 * unde N e poziția în lista de imagini a comentariului. Le rezolvăm din
 * `commentId`-ul salvat în metadata log-ului, cu aceeași ordine și același
 * filtru de mime ca la trimitere.
 */
async function resolveAttachmentByIndex(commentId: string, index: number, tenantId: string) {
	const rows = await db
		.select({
			path: table.taskCommentAttachment.path,
			mimeType: table.taskCommentAttachment.mimeType
		})
		.from(table.taskCommentAttachment)
		.innerJoin(
			table.taskComment,
			eq(table.taskCommentAttachment.commentId, table.taskComment.id)
		)
		.innerJoin(table.task, eq(table.taskComment.taskId, table.task.id))
		.where(
			and(
				eq(table.taskCommentAttachment.commentId, commentId),
				eq(table.task.tenantId, tenantId)
			)
		)
		.orderBy(table.taskCommentAttachment.createdAt);
	const images = rows.filter((r) => (r.mimeType ?? '').toLowerCase().startsWith('image/'));
	return images[index] ?? null;
}

export type EmailPreviewContext = {
	tenantId: string;
	/** `email_log.metadata` deserializat — folosit pentru cid-urile vechi, pe index. */
	metadata?: Record<string, unknown> | null;
};

/** Înlocuiește toate referințele `cid:` din HTML cu `data:` URI. */
export async function inlineEmailCids(
	html: string,
	ctx: EmailPreviewContext
): Promise<string> {
	const cids = [...new Set([...html.matchAll(CID_RE)].map((m) => m[1]))];
	if (cids.length === 0) return html;

	const commentId =
		typeof ctx.metadata?.commentId === 'string' ? (ctx.metadata.commentId as string) : null;

	const resolved = new Map<string, string>();
	let totalBytes = 0;

	for (const cid of cids) {
		try {
			if (cid === 'companylogo') {
				const logo = await resolveCompanyLogo(ctx.tenantId);
				if (logo) resolved.set(cid, logo);
				continue;
			}

			const byId = cid.match(/^taskcommentimg-([A-Za-z0-9]+)$/);
			const byIndex = cid.match(/^taskcommentimg(\d+)$/);

			const row = byId
				? await resolveAttachmentById(byId[1], ctx.tenantId)
				: byIndex && commentId
					? await resolveAttachmentByIndex(commentId, Number(byIndex[1]), ctx.tenantId)
					: null;
			if (!row) continue;

			const buf = await storage.getFileBuffer(row.path);
			if (totalBytes + buf.length > PREVIEW_MAX_TOTAL_BYTES) continue;
			totalBytes += buf.length;
			resolved.set(cid, dataUri(row.mimeType, buf));
		} catch (error) {
			logWarning('email', 'Nu am putut rezolva un cid: pentru previzualizare', {
				tenantId: ctx.tenantId,
				metadata: { cid, error: serializeError(error).message }
			});
		}
	}

	if (resolved.size === 0) return html;
	return html.replace(CID_RE, (match, cid: string) => resolved.get(cid) ?? match);
}
