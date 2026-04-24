/**
 * GET /[tenant]/api/webhooks/whmcs/health
 *
 * Authenticated health probe for the WHMCS connector. The WHMCS admin page
 * exposes a "Test connection" button that hits this endpoint with a signed
 * GET request; a 200 response proves end-to-end: URL reachable, signature
 * verified against the configured secret, integration active, breaker closed.
 *
 * Response shape on success:
 *   {
 *     ok: true,
 *     tenantSlug: "ots-romania-srl",
 *     connectorVersion: "1.0.0",
 *     dryRun: true,           // !integration.enableKeezPush — lets the PHP
 *                             // module surface dry-run state in its UI.
 *     receivedAt: 1777430999  // unix seconds, for clock-drift diagnostics
 *   }
 *
 * Failure returns the standard verify-webhook reason code + HTTP status.
 * No secrets or DB internals are leaked.
 */
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { verifyWhmcsWebhook } from '$lib/server/whmcs/verify-webhook';

/** Keep in sync with the PHP addon's reported version (package.json on that side). */
const CONNECTOR_VERSION = '1.0.0';

/**
 * Server-side handler version. BUMP THIS EVERY TIME the invoice handler
 * logic changes so ops can verify a deploy landed by hitting /health.
 * Pre-deploy: undefined on the response. Post-deploy: matches expected.
 * History:
 *   synthesize-v1 — PR #26: synthesize invoice from paid/cancelled when
 *                           no prior create row (fixes historical WHMCS
 *                           invoices, obsoletes invoice_missing_for_status_update
 *                           FAILED reason).
 */
const HANDLER_VERSION = 'synthesize-v1';

export const GET: RequestHandler = async (event) => {
	// GET has no body; HMAC canonical still includes the empty string.
	const rawBody = '';
	const result = await verifyWhmcsWebhook(event, rawBody);

	if (!result.ok) {
		return json({ ok: false, reason: result.reason }, { status: result.statusCode });
	}

	return json({
		ok: true,
		tenantSlug: result.tenant.slug,
		connectorVersion: CONNECTOR_VERSION,
		handlerVersion: HANDLER_VERSION,
		dryRun: !result.integration.enableKeezPush,
		receivedAt: result.timestamp
	});
};
