/**
 * POST /[tenant]/api/webhooks/whmcs/invoices
 *
 * Receives invoice-lifecycle events from the WHMCS `ots_crm_connector`:
 *   event = 'created' | 'paid' | 'cancelled' | 'refunded'
 *
 * Handler strategy (v1 dry-run):
 *   - Run the business logic synchronously. It's a single transaction + a
 *     few SELECTs, well under the hook timeout WHMCS enforces.
 *   - Keez push is NOT invoked here — it will be added as a BullMQ job in
 *     a later step, gated on `integration.enableKeezPush`.
 *   - Refunds land in DEAD_LETTER with a manual-review flag; v1 does not
 *     auto-create credit notes.
 *
 * Response body:
 *   - 202 + { ok: true, outcome: 'created', invoiceId, invoiceNumber, matchType }
 *   - 202 + { ok: true, outcome: 'updated', invoiceId, event }
 *   - 200 + { ok: true, outcome: 'dedup', invoiceId }
 *   - 202 + { ok: true, outcome: 'dead_letter', reason, detail }  ← WHMCS should
 *         STOP retrying (we intentionally return 2xx; DEAD_LETTER means
 *         we received + classified the event and humans need to intervene).
 *   - 4xx/5xx for verify / parse errors — WHMCS should retry these.
 */
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { createHash, randomBytes } from 'node:crypto';

import { logError, logInfo } from '$lib/server/logger';
import { verifyWhmcsWebhook } from '$lib/server/whmcs/verify-webhook';
import { processWhmcsInvoice } from '$lib/server/whmcs/invoice-handler';
import type { WhmcsInvoicePayload } from '$lib/server/whmcs/types';

function sha256Hex(input: string): string {
	return createHash('sha256').update(input).digest('hex');
}

/**
 * Short opaque ID stamped on every webhook receipt and propagated to all
 * downstream log lines (push, retry hops, validate, push-back) so a single
 * end-to-end request can be reconstructed via grep.
 */
function newCorrelationId(): string {
	return `whk_${randomBytes(6).toString('hex')}`;
}

/**
 * Minimal runtime validation — the sender is our own module, so we trust
 * the shape but guard against the most obvious malformations that would
 * crash the handler.
 */
function isValidInvoicePayload(body: unknown): body is WhmcsInvoicePayload {
	if (!body || typeof body !== 'object') return false;
	const b = body as Record<string, unknown>;
	const validEvent = ['created', 'paid', 'cancelled', 'refunded'].includes(b.event as string);
	if (!validEvent) return false;
	if (typeof b.whmcsInvoiceId !== 'number' || !Number.isFinite(b.whmcsInvoiceId)) return false;
	if (typeof b.total !== 'number') return false;
	if (typeof b.subtotal !== 'number') return false;
	if (typeof b.tax !== 'number') return false;
	if (typeof b.currency !== 'string' || !b.currency) return false;
	if (typeof b.issueDate !== 'string') return false;
	if (!b.client || typeof b.client !== 'object') return false;
	if (!Array.isArray(b.items)) return false;
	return true;
}

export const POST: RequestHandler = async (event) => {
	const rawBody = await event.request.text();

	const verify = await verifyWhmcsWebhook(event, rawBody);
	if (!verify.ok) {
		return json({ ok: false, reason: verify.reason }, { status: verify.statusCode });
	}

	let payload: WhmcsInvoicePayload;
	try {
		const parsed = JSON.parse(rawBody);
		if (!isValidInvoicePayload(parsed)) {
			return json({ ok: false, reason: 'malformed_payload' }, { status: 400 });
		}
		payload = parsed;
	} catch {
		return json({ ok: false, reason: 'invalid_json' }, { status: 400 });
	}

	const payloadHash = sha256Hex(rawBody);
	const correlationId = newCorrelationId();

	logInfo('whmcs', 'Webhook received', {
		tenantId: verify.tenant.id,
		metadata: {
			correlationId,
			event: payload.event,
			whmcsInvoiceId: payload.whmcsInvoiceId,
			whmcsInvoiceNumber: payload.whmcsInvoiceNumber ?? null,
			total: payload.total,
			currency: payload.currency
		}
	});

	let result;
	try {
		result = await processWhmcsInvoice({
			tenant: verify.tenant,
			integration: verify.integration,
			payload,
			payloadHash,
			correlationId
		});
	} catch (err) {
		logError('whmcs', 'Invoice handler threw — transient failure, WHMCS will retry', {
			tenantId: verify.tenant.id,
			metadata: {
				correlationId,
				whmcsInvoiceId: payload.whmcsInvoiceId,
				event: payload.event,
				error: err instanceof Error ? err.message : String(err),
				stack: err instanceof Error ? err.stack : undefined
			}
		});
		return json({ ok: false, reason: 'handler_error', correlationId }, { status: 500 });
	}

	// Map handler outcome → HTTP status
	switch (result.outcome) {
		case 'dedup':
			return json({ ok: true, correlationId, ...result }, { status: 200 });
		case 'created':
		case 'updated':
			return json({ ok: true, correlationId, ...result }, { status: 202 });
		case 'dead_letter':
			// Intentional 202: we received the event cleanly, but need human review.
			// Returning 5xx would invite WHMCS retry storms against a stuck row.
			return json({ ok: true, correlationId, ...result }, { status: 202 });
	}
};
