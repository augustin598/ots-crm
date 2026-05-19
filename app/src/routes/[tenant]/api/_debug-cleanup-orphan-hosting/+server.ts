/**
 * Delete CRM hosting invoices whose `keezExternalId` no longer exists in Keez.
 * Orphans are produced when a push partially succeeds (CRM thinks it's linked)
 * but the operator later deletes the invoice from Keez UI. Cleanup is safe:
 *
 *  - Only acts on rows with `hostingAccountId IS NOT NULL`.
 *  - Only acts on rows where `getInvoice(keezExternalId)` returns 404 or the
 *    Keez VALIDATION_ERROR / "nu exista" pattern (per memory note).
 *  - Never touches rows that match Keez.
 *  - Cascades line items (FK on delete cascade per schema).
 *  - Also nukes any `keezInvoiceSync` rows for these invoices.
 *
 *   POST /[tenant]/api/_debug-cleanup-orphan-hosting            (dry-run; default)
 *   POST /[tenant]/api/_debug-cleanup-orphan-hosting?apply=true (mutate)
 *
 * Admin-only.
 */

import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, isNotNull, inArray } from 'drizzle-orm';
import { createKeezClientForTenant } from '$lib/server/plugins/keez/factory';
import { KeezClientError } from '$lib/server/plugins/keez/errors';
import { logInfo, serializeError } from '$lib/server/logger';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	const role = event.locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') {
		throw error(403, 'Forbidden: Admin access required');
	}
	const tenantId = event.locals.tenant.id;
	const apply = event.url.searchParams.get('apply') === 'true';

	const [integration] = await db
		.select()
		.from(table.keezIntegration)
		.where(
			and(eq(table.keezIntegration.tenantId, tenantId), eq(table.keezIntegration.isActive, true))
		)
		.limit(1);
	if (!integration) throw error(404, 'No active Keez integration for this tenant');

	const client = await createKeezClientForTenant(tenantId, integration);

	const candidates = await db
		.select({
			id: table.invoice.id,
			invoiceNumber: table.invoice.invoiceNumber,
			invoiceSeries: table.invoice.invoiceSeries,
			status: table.invoice.status,
			keezExternalId: table.invoice.keezExternalId
		})
		.from(table.invoice)
		.where(
			and(
				eq(table.invoice.tenantId, tenantId),
				isNotNull(table.invoice.hostingAccountId),
				isNotNull(table.invoice.keezExternalId)
			)
		);

	const orphans: Array<{
		id: string;
		invoiceNumber: string;
		invoiceSeries: string | null;
		status: string;
		keezExternalId: string;
		probeStatus: number | null;
		probeMessage: string;
	}> = [];
	const matches: Array<{ id: string; invoiceNumber: string }> = [];
	const inconclusive: Array<{ id: string; invoiceNumber: string; error: string }> = [];

	for (const inv of candidates) {
		if (!inv.keezExternalId) continue;
		try {
			await client.getInvoice(inv.keezExternalId);
			matches.push({ id: inv.id, invoiceNumber: inv.invoiceNumber });
		} catch (err) {
			const status = err instanceof KeezClientError ? err.status : null;
			const msg = err instanceof Error ? err.message : String(err);
			// Pattern per memory: 404 OR (400 with VALIDATION_ERROR + "nu exista") = invoice missing in Keez
			const looksMissing =
				status === 404 || (status === 400 && /VALIDATION_ERROR|nu exista/i.test(msg));
			if (looksMissing) {
				orphans.push({
					id: inv.id,
					invoiceNumber: inv.invoiceNumber,
					invoiceSeries: inv.invoiceSeries,
					status: inv.status,
					keezExternalId: inv.keezExternalId,
					probeStatus: status,
					probeMessage: msg.slice(0, 120)
				});
			} else {
				inconclusive.push({ id: inv.id, invoiceNumber: inv.invoiceNumber, error: msg.slice(0, 150) });
			}
		}
	}

	let deletedCount = 0;
	const deletionErrors: Array<{ id: string; error: string }> = [];

	if (apply && orphans.length > 0) {
		const orphanIds = orphans.map((o) => o.id);
		try {
			// First nuke any keezInvoiceSync rows pointing at these invoices (no FK CASCADE)
			await db
				.delete(table.keezInvoiceSync)
				.where(
					and(
						eq(table.keezInvoiceSync.tenantId, tenantId),
						inArray(table.keezInvoiceSync.invoiceId, orphanIds)
					)
				);
			// invoiceLineItem has onDelete cascade per schema
			await db
				.delete(table.invoice)
				.where(
					and(eq(table.invoice.tenantId, tenantId), inArray(table.invoice.id, orphanIds))
				);
			deletedCount = orphans.length;
			logInfo(
				'directadmin',
				`Cleanup orphan hosting: deleted ${deletedCount} orphan invoice(s) — ${orphans.map((o) => o.invoiceNumber).join(', ')}`,
				{ tenantId, action: 'cleanup_orphan_hosting_invoices', metadata: { orphanIds } }
			);
		} catch (err) {
			const e = serializeError(err);
			deletionErrors.push({ id: 'BATCH', error: e.message });
		}
	}

	return json({
		ok: true,
		apply,
		summary: {
			candidatesChecked: candidates.length,
			matchedKeez: matches.length,
			orphans: orphans.length,
			inconclusive: inconclusive.length,
			deleted: deletedCount
		},
		orphans,
		matches,
		inconclusive,
		deletionErrors
	});
};
