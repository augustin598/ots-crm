import { json, error } from '@sveltejs/kit';
import * as v from 'valibot';
import { requireStaff } from '$lib/server/get-actor';
import { logInfo, logWarning, logError, serializeError } from '$lib/server/logger';
import { formatCustomerId } from '$lib/server/google-ads/client';
import { ingestInvoiceSchema, decodePdfBase64, parseIssueDate } from '$lib/server/google-ads/invoice-parsing';
import { persistGoogleInvoicePdf, GoogleAccountNotMappedError } from '$lib/server/google-ads/invoice-ingest';
import type { RequestHandler } from './$types';

/** One invoice per request keeps every body well under BODY_SIZE_LIMIT (10M). */
const MAX_PDF_BYTES = 6 * 1024 * 1024;

/**
 * Userscript step 2: the PDF bytes were fetched inside the user's own logged-in
 * browser (payments.google.com iframe) and are handed over here as base64.
 * The server never needs a Google session for this path.
 */
export const POST: RequestHandler = async (event) => {
	const { locals, request } = event;
	if (!locals.user || !locals.tenant) throw error(401, 'Unauthorized');
	await requireStaff(event);

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Body-ul trebuie să fie JSON');
	}
	const parsed = v.safeParse(ingestInvoiceSchema, body);
	if (!parsed.success) {
		throw error(400, `Payload invalid: ${parsed.issues[0]?.message ?? 'schema'}`);
	}

	const tenantId = locals.tenant.id;
	const { invoiceId, date, amountText, pdfBase64 } = parsed.output;
	const customerId = formatCustomerId(parsed.output.customerId);

	const decoded = decodePdfBase64(pdfBase64, MAX_PDF_BYTES);
	if (!decoded.ok) {
		const status = decoded.reason === 'too_large' ? 413 : 422;
		logWarning('google-ads-ingest', `Rejected invoice ${invoiceId}: ${decoded.reason}`, {
			tenantId,
			userId: locals.user.id,
			metadata: { customerId, reason: decoded.reason, base64Length: pdfBase64.length }
		});
		return json({ ok: false, error: decoded.reason, invoiceId }, { status });
	}

	const issueDate = parseIssueDate(date);

	try {
		const result = await persistGoogleInvoicePdf({
			tenantId,
			customerId,
			invoiceId,
			issueDate,
			amountText,
			pdfBuffer: decoded.buffer,
			source: 'userscript'
		});
		logInfo('google-ads-ingest', `Invoice ${invoiceId} ${result.status} via userscript`, {
			tenantId,
			userId: locals.user.id,
			metadata: { customerId, status: result.status, bytes: decoded.buffer.length, dateGuessed: !issueDate }
		});
		return json({ ok: true, status: result.status, invoiceId, dateGuessed: !issueDate });
	} catch (e) {
		if (e instanceof GoogleAccountNotMappedError) {
			return json({ ok: false, error: 'account_not_mapped', message: e.message, invoiceId }, { status: 404 });
		}
		const { message, stack } = serializeError(e);
		logError('google-ads-ingest', `Failed to persist invoice ${invoiceId}: ${message}`, {
			tenantId,
			userId: locals.user.id,
			metadata: { customerId },
			stackTrace: stack
		});
		return json({ ok: false, error: 'persist_failed', message, invoiceId }, { status: 500 });
	}
};
