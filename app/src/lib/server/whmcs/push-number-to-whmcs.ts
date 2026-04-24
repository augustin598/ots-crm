/**
 * Reverse-direction sync: CRM → WHMCS.
 *
 * After the CRM assigns a fiscal invoice number (e.g. "HOST 568") to an
 * invoice that originated in WHMCS, we tell WHMCS to replace its own
 * `invoicenum` (e.g. "OTS567") with the CRM number. That way the client
 * sees the Keez-validated number in PDFs, emails, and the client portal.
 *
 * Auth: same HMAC shared secret used for the inbound webhook. The PHP side
 * reads it from the addon-module settings table and uses identical canonical
 * payload rules (see app/src/lib/server/whmcs/hmac.ts).
 *
 * When to call:
 *   - Auto: after `syncInvoiceToKeez` succeeds (invoice.keezStatus = 'Valid')
 *     AND the invoice originated in WHMCS. The Keez-confirmed number is the
 *     authoritative one to propagate back.
 *   - Manual: admin UI button "Trimite număr la WHMCS" per row. Useful for
 *     dry-run tenants that haven't enabled Keez push but still want number
 *     alignment.
 *
 * Never throws — always returns a structured result.
 */
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { decrypt, DecryptionError } from '$lib/server/plugins/smartbill/crypto';
import { signRequest } from './hmac';
import { logError, logInfo, logWarning } from '$lib/server/logger';

export type PushNumberResult =
	| { ok: true; oldNumber: string; newNumber: string }
	| {
			ok: false;
			reason:
				| 'invoice_not_found'
				| 'not_whmcs_invoice'
				| 'tenant_mismatch'
				| 'integration_not_configured'
				| 'integration_inactive'
				| 'tenant_not_found'
				| 'decrypt_failed'
				| 'bad_whmcs_url'
				| 'network_error'
				| 'http_error'
				| 'whmcs_rejected';
			detail?: string;
			httpStatus?: number;
	  };

const DEFAULT_CALLBACK_PATH = '/modules/addons/ots_crm_connector/callback.php';

export async function pushInvoiceNumberToWhmcs(
	tenantId: string,
	invoiceId: string
): Promise<PushNumberResult> {
	// 1. Load invoice, validate it's WHMCS-sourced and belongs to the tenant.
	const invoice = await db
		.select()
		.from(table.invoice)
		.where(eq(table.invoice.id, invoiceId))
		.get();

	if (!invoice) {
		return { ok: false, reason: 'invoice_not_found' };
	}
	if (invoice.tenantId !== tenantId) {
		return { ok: false, reason: 'tenant_mismatch' };
	}
	if (invoice.externalSource !== 'whmcs' || !invoice.externalInvoiceId) {
		return { ok: false, reason: 'not_whmcs_invoice' };
	}
	if (!invoice.invoiceNumber) {
		// Shouldn't happen (number is assigned at create), but defensive.
		return { ok: false, reason: 'not_whmcs_invoice', detail: 'crm_invoice_number_empty' };
	}

	// 2. Load tenant + integration row.
	const tenant = await db
		.select()
		.from(table.tenant)
		.where(eq(table.tenant.id, tenantId))
		.get();
	if (!tenant) {
		return { ok: false, reason: 'tenant_not_found' };
	}

	const integration = await db
		.select()
		.from(table.whmcsIntegration)
		.where(eq(table.whmcsIntegration.tenantId, tenantId))
		.get();
	if (!integration) {
		return { ok: false, reason: 'integration_not_configured' };
	}
	if (!integration.isActive) {
		return { ok: false, reason: 'integration_inactive' };
	}

	// 3. Decrypt the shared secret.
	let secret: string;
	try {
		secret = decrypt(tenantId, integration.sharedSecret);
	} catch (err) {
		logWarning('whmcs', 'Decrypt failed during push-back to WHMCS', {
			tenantId,
			metadata: {
				invoiceId,
				error: err instanceof Error ? err.message : String(err),
				isDecryptionError: err instanceof DecryptionError
			}
		});
		return { ok: false, reason: 'decrypt_failed' };
	}

	// 4. Build signed POST to the WHMCS callback endpoint.
	let url: URL;
	try {
		url = new URL(DEFAULT_CALLBACK_PATH, integration.whmcsUrl);
	} catch {
		return { ok: false, reason: 'bad_whmcs_url', detail: integration.whmcsUrl };
	}

	const body = JSON.stringify({
		whmcsInvoiceId: invoice.externalInvoiceId,
		invoiceNumber: invoice.invoiceNumber
	});

	const timestamp = Math.floor(Date.now() / 1000);
	const nonce = crypto.randomUUID();
	const signature = signRequest(
		secret,
		timestamp,
		'POST',
		url.pathname,
		tenant.slug,
		nonce,
		body
	);

	// 5. Fire. Wrap everything in try/catch — AbortSignal, DNS failures, etc.
	let response: Response;
	try {
		response = await fetch(url.toString(), {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-OTS-Timestamp': String(timestamp),
				'X-OTS-Signature': signature,
				'X-OTS-Tenant': tenant.slug,
				'X-OTS-Nonce': nonce
			},
			body,
			signal: AbortSignal.timeout(15_000)
		});
	} catch (err) {
		logError('whmcs', 'Push-back to WHMCS failed: network error', {
			tenantId,
			metadata: {
				invoiceId,
				whmcsInvoiceId: invoice.externalInvoiceId,
				url: url.toString(),
				error: err instanceof Error ? err.message : String(err)
			}
		});
		return {
			ok: false,
			reason: 'network_error',
			detail: err instanceof Error ? err.message : String(err)
		};
	}

	const responseBody = await response.json().catch(() => null);

	if (!response.ok) {
		logError('whmcs', 'WHMCS callback rejected number push', {
			tenantId,
			metadata: {
				invoiceId,
				httpStatus: response.status,
				response: responseBody
			}
		});
		return {
			ok: false,
			reason: 'http_error',
			httpStatus: response.status,
			detail: JSON.stringify(responseBody ?? {}).slice(0, 200)
		};
	}

	if (!responseBody || responseBody.ok !== true) {
		return {
			ok: false,
			reason: 'whmcs_rejected',
			detail: responseBody?.reason ?? 'unknown',
			httpStatus: response.status
		};
	}

	const oldNumber = String(responseBody.oldNumber ?? '');
	const newNumber = String(responseBody.newNumber ?? invoice.invoiceNumber);

	logInfo('whmcs', 'Pushed invoice number back to WHMCS', {
		tenantId,
		metadata: {
			invoiceId,
			whmcsInvoiceId: invoice.externalInvoiceId,
			oldNumber,
			newNumber
		}
	});

	return { ok: true, oldNumber, newNumber };
}
