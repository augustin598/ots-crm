import { json, error } from '@sveltejs/kit';
import * as v from 'valibot';
import { requireStaff } from '$lib/server/get-actor';
import { formatCustomerId } from '$lib/server/google-ads/client';
import { checkInvoicesSchema } from '$lib/server/google-ads/invoice-parsing';
import { resolveMappedAccount, listExistingInvoiceIds } from '$lib/server/google-ads/invoice-ingest';
import type { RequestHandler } from './$types';

/**
 * Userscript step 1: "which of these invoice ids are still missing in the CRM?"
 * Lets the browser download/upload only what is needed. Staff only; the
 * tenant comes from the URL (locals.tenant), never from the body.
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
	const parsed = v.safeParse(checkInvoicesSchema, body);
	if (!parsed.success) {
		throw error(400, `Payload invalid: ${parsed.issues[0]?.message ?? 'schema'}`);
	}

	const tenantId = locals.tenant.id;
	const customerId = formatCustomerId(parsed.output.customerId);
	const account = await resolveMappedAccount(tenantId, customerId);
	if (!account) {
		return json(
			{ ok: false, error: 'account_not_mapped', message: `Contul Google Ads ${customerId} nu este asociat unui client în CRM. Asociază-l în Settings → Google Ads.` },
			{ status: 404 }
		);
	}

	const ids = [...new Set(parsed.output.invoiceIds)];
	const existing = await listExistingInvoiceIds(tenantId, ids);
	const missing = ids.filter((id) => !existing.has(id));

	return json({
		ok: true,
		account: { customerId, accountName: account.accountName, clientName: account.clientName },
		missing,
		existing: [...existing]
	});
};
