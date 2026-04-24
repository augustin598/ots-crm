/**
 * POST /[tenant]/api/webhooks/whmcs/clients
 *
 * Receives client add/update events from the WHMCS `ots_crm_connector`
 * module. Dispatches synchronously (no BullMQ yet) because client sync is
 * cheap and invoices that follow shortly after need this row to already
 * exist for matching to hit the WHMCS_ID branch.
 *
 * Flow:
 *   1. verifyWhmcsWebhook (HMAC + timestamp + nonce)
 *   2. Parse + validate payload shape
 *   3. Dedupe: if (tenantId, whmcsClientId) already has a row with the
 *      same lastPayloadHash AND state='MATCHED' or 'CREATED', return 200
 *      no-op. This handles WHMCS hook retry storms.
 *   4. Run the matching cascade (WHMCS_ID → CUI → EMAIL → NEW)
 *   5. Upsert whmcs_client_sync row with matchType + hash + raw payload
 *      (redacted) for audit + observability
 *   6. Return 202 Accepted with { clientId, matchType, action }
 *
 * Response shapes:
 *   200 OK        — duplicate request, no state change
 *   202 Accepted  — processed; body has match result
 *   4xx           — verify-webhook failure; body { ok:false, reason }
 *   5xx           — DB/decrypt failure; body { ok:false, reason }
 */
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { encodeBase32LowerCase } from '@oslojs/encoding';

import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { logError, logWarning } from '$lib/server/logger';

import { verifyWhmcsWebhook } from '$lib/server/whmcs/verify-webhook';
import { matchOrCreateClient } from '$lib/server/whmcs/client-matching';
import { redactAndStringify } from '$lib/server/whmcs/redact';
import type { WhmcsClientPayload } from '$lib/server/whmcs/types';

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function generateSyncId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

function sha256Hex(input: string): string {
	return createHash('sha256').update(input).digest('hex');
}

/**
 * Light runtime validation — WHMCS module is ours, so full schema validation
 * is overkill. We just confirm the required shape so a malformed request
 * fails fast with a clear reason rather than exploding in matching.
 */
function isValidClientPayload(body: unknown): body is WhmcsClientPayload {
	if (!body || typeof body !== 'object') return false;
	const b = body as Record<string, unknown>;
	if (b.event !== 'added' && b.event !== 'updated') return false;
	if (typeof b.whmcsClientId !== 'number' || !Number.isFinite(b.whmcsClientId)) return false;
	if (typeof b.isLegalPerson !== 'boolean') return false;
	return true;
}

// ─────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────

export const POST: RequestHandler = async (event) => {
	// Raw body FIRST — needed for HMAC verification bit-for-bit.
	const rawBody = await event.request.text();

	const verify = await verifyWhmcsWebhook(event, rawBody);
	if (!verify.ok) {
		return json({ ok: false, reason: verify.reason }, { status: verify.statusCode });
	}

	const tenantId = verify.tenant.id;

	// Parse + validate
	let payload: WhmcsClientPayload;
	try {
		const parsed = JSON.parse(rawBody);
		if (!isValidClientPayload(parsed)) {
			return json({ ok: false, reason: 'malformed_payload' }, { status: 400 });
		}
		payload = parsed;
	} catch {
		return json({ ok: false, reason: 'invalid_json' }, { status: 400 });
	}

	const payloadHash = sha256Hex(rawBody);

	// Idempotency: exact-dup arriving after successful sync → no-op.
	const existingSync = await db
		.select()
		.from(table.whmcsClientSync)
		.where(
			and(
				eq(table.whmcsClientSync.tenantId, tenantId),
				eq(table.whmcsClientSync.whmcsClientId, payload.whmcsClientId)
			)
		)
		.get();

	if (
		existingSync &&
		existingSync.lastPayloadHash === payloadHash &&
		(existingSync.state === 'MATCHED' || existingSync.state === 'CREATED')
	) {
		return json(
			{
				ok: true,
				dedup: true,
				clientId: existingSync.clientId,
				matchType: existingSync.matchType
			},
			{ status: 200 }
		);
	}

	// Run cascade
	let match;
	try {
		match = await matchOrCreateClient(tenantId, payload);
	} catch (err) {
		logError('whmcs', 'Client matching/creation failed', {
			tenantId,
			metadata: {
				whmcsClientId: payload.whmcsClientId,
				error: err instanceof Error ? err.message : String(err),
				stack: err instanceof Error ? err.stack : undefined
			}
		});

		// Persist failure on sync row so UI can surface it for manual replay.
		const redactedPayload = redactAndStringify(payload);
		if (existingSync) {
			await db
				.update(table.whmcsClientSync)
				.set({
					state: 'FAILED',
					lastEvent: payload.event,
					lastPayloadHash: payloadHash,
					lastErrorMessage: err instanceof Error ? err.message : String(err),
					rawPayload: redactedPayload,
					receivedAt: new Date()
				})
				.where(eq(table.whmcsClientSync.id, existingSync.id));
		} else {
			await db.insert(table.whmcsClientSync).values({
				id: generateSyncId(),
				tenantId,
				whmcsClientId: payload.whmcsClientId,
				clientId: null,
				state: 'FAILED',
				matchType: null,
				lastEvent: payload.event,
				lastPayloadHash: payloadHash,
				lastErrorMessage: err instanceof Error ? err.message : String(err),
				rawPayload: redactedPayload,
				receivedAt: new Date()
			});
		}

		return json({ ok: false, reason: 'client_sync_failed' }, { status: 500 });
	}

	// Persist success
	const terminalState = match.created ? 'CREATED' : 'MATCHED';
	const redactedPayload = redactAndStringify(payload);
	const now = new Date();

	if (existingSync) {
		await db
			.update(table.whmcsClientSync)
			.set({
				clientId: match.clientId,
				state: terminalState,
				matchType: match.matchType,
				lastEvent: payload.event,
				lastPayloadHash: payloadHash,
				lastErrorMessage: null,
				rawPayload: redactedPayload,
				processedAt: now
			})
			.where(eq(table.whmcsClientSync.id, existingSync.id));
	} else {
		await db.insert(table.whmcsClientSync).values({
			id: generateSyncId(),
			tenantId,
			whmcsClientId: payload.whmcsClientId,
			clientId: match.clientId,
			state: terminalState,
			matchType: match.matchType,
			lastEvent: payload.event,
			lastPayloadHash: payloadHash,
			rawPayload: redactedPayload,
			receivedAt: now,
			processedAt: now
		});
	}

	// Observability hook: alert if we've been creating a lot of NEW clients
	// (indicates CUI/email mismatch on the WHMCS side vs CRM).
	if (match.matchType === 'NEW') {
		// Cheap signal — full anomaly detection lives in the admin UI later.
		logWarning('whmcs', 'Created new client from WHMCS payload (no CUI/email match)', {
			tenantId,
			metadata: {
				whmcsClientId: payload.whmcsClientId,
				clientId: match.clientId
			}
		});
	}

	return json(
		{
			ok: true,
			dedup: false,
			clientId: match.clientId,
			matchType: match.matchType,
			action: match.created ? 'created' : 'matched'
		},
		{ status: 202 }
	);
};
