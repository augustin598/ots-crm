/**
 * GET /[tenant]/api/webhooks/whmcs/status?ids=99,100,101
 *
 * Bulk status query for the WHMCS admin module's invoice table. Returns the
 * sync state + Keez state per WHMCS invoice id, so the WHMCS admin page can
 * show a "Keez status" column in a single round-trip instead of N HMAC
 * requests (one per row).
 *
 * Authenticated by HMAC, same as every other webhook. Empty body on GET.
 *
 * Response shape:
 *   {
 *     "99":  { syncState, matchType, invoiceNumber, keezStatus, keezInvoiceId, crmStatus },
 *     "100": null   // not in CRM
 *   }
 */
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { and, eq, inArray } from 'drizzle-orm';

import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { verifyWhmcsWebhook } from '$lib/server/whmcs/verify-webhook';

const MAX_IDS = 100;

export const GET: RequestHandler = async (event) => {
	const rawBody = '';
	const verify = await verifyWhmcsWebhook(event, rawBody);
	if (!verify.ok) {
		return json({ ok: false, reason: verify.reason }, { status: verify.statusCode });
	}

	const idsParam = event.url.searchParams.get('ids') ?? '';
	const ids = idsParam
		.split(',')
		.map((s) => parseInt(s, 10))
		.filter((n) => Number.isFinite(n) && n > 0)
		.slice(0, MAX_IDS);

	if (ids.length === 0) {
		return json({});
	}

	// Sync rows for the given WHMCS ids (tenant-scoped)
	const syncs = await db
		.select({
			whmcsInvoiceId: table.whmcsInvoiceSync.whmcsInvoiceId,
			state: table.whmcsInvoiceSync.state,
			matchType: table.whmcsInvoiceSync.matchType,
			invoiceId: table.whmcsInvoiceSync.invoiceId
		})
		.from(table.whmcsInvoiceSync)
		.where(
			and(
				eq(table.whmcsInvoiceSync.tenantId, verify.tenant.id),
				inArray(table.whmcsInvoiceSync.whmcsInvoiceId, ids)
			)
		)
		.all();

	// Pull the matching CRM invoices in one query
	const invoiceIds = syncs.map((s) => s.invoiceId).filter((id): id is string => !!id);
	const invoices = invoiceIds.length
		? await db
				.select({
					id: table.invoice.id,
					invoiceNumber: table.invoice.invoiceNumber,
					keezStatus: table.invoice.keezStatus,
					keezInvoiceId: table.invoice.keezInvoiceId,
					status: table.invoice.status
				})
				.from(table.invoice)
				.where(inArray(table.invoice.id, invoiceIds))
				.all()
		: [];

	const invoiceById = new Map(invoices.map((i) => [i.id, i]));

	const result: Record<string, unknown> = {};
	for (const s of syncs) {
		const inv = s.invoiceId ? invoiceById.get(s.invoiceId) : undefined;
		result[String(s.whmcsInvoiceId)] = {
			syncState: s.state,
			matchType: s.matchType,
			invoiceNumber: inv?.invoiceNumber ?? null,
			keezStatus: inv?.keezStatus ?? null,
			keezInvoiceId: inv?.keezInvoiceId ?? null,
			crmStatus: inv?.status ?? null
		};
	}

	return json(result);
};
