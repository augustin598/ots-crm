/**
 * List every CRM invoice with hostingAccountId set and probe Keez for the
 * actual current state. Used for cleanup: identifies orphans (CRM points to
 * a Keez externalId that no longer exists), mis-numbered rows (CRM says one
 * series/number, Keez says another), and matched-but-stale rows.
 *
 *   GET /[tenant]/api/_debug-hosting-invoices-list
 *
 * Admin-only. No side effects.
 */

import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, isNotNull, desc } from 'drizzle-orm';
import { createKeezClientForTenant } from '$lib/server/plugins/keez/factory';
import { KeezClientError } from '$lib/server/plugins/keez/errors';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	const role = event.locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') {
		throw error(403, 'Forbidden: Admin access required');
	}
	const tenantId = event.locals.tenant.id;

	const invoices = await db
		.select({
			id: table.invoice.id,
			invoiceNumber: table.invoice.invoiceNumber,
			invoiceSeries: table.invoice.invoiceSeries,
			status: table.invoice.status,
			keezStatus: table.invoice.keezStatus,
			keezExternalId: table.invoice.keezExternalId,
			amount: table.invoice.amount,
			totalAmount: table.invoice.totalAmount,
			hostingAccountId: table.invoice.hostingAccountId,
			clientId: table.invoice.clientId,
			createdAt: table.invoice.createdAt
		})
		.from(table.invoice)
		.where(
			and(eq(table.invoice.tenantId, tenantId), isNotNull(table.invoice.hostingAccountId))
		)
		.orderBy(desc(table.invoice.createdAt))
		.limit(50);

	const [integration] = await db
		.select()
		.from(table.keezIntegration)
		.where(
			and(eq(table.keezIntegration.tenantId, tenantId), eq(table.keezIntegration.isActive, true))
		)
		.limit(1);

	if (!integration) {
		return json({
			ok: false,
			reason: 'no_active_keez_integration',
			invoices
		});
	}

	const client = await createKeezClientForTenant(tenantId, integration);

	const results = [];
	for (const inv of invoices) {
		let keezProbe: {
			attempted: boolean;
			exists?: boolean;
			series?: string;
			number?: number | string;
			status?: string;
			error?: string;
		} = { attempted: false };
		if (inv.keezExternalId) {
			try {
				const keezInv = await client.getInvoice(inv.keezExternalId);
				keezProbe = {
					attempted: true,
					exists: true,
					series: keezInv.series,
					number: keezInv.number,
					status: keezInv.status
				};
			} catch (err) {
				const status = err instanceof KeezClientError ? err.status : null;
				const msg = err instanceof Error ? err.message : String(err);
				const isMissing =
					status === 404 || (status === 400 && /VALIDATION_ERROR|nu exista/i.test(msg));
				keezProbe = {
					attempted: true,
					exists: isMissing ? false : undefined,
					error: msg.slice(0, 150)
				};
			}
		}

		const mismatch = (() => {
			if (!keezProbe.attempted) return 'no_keez_externalId_on_crm';
			if (keezProbe.exists === false) return 'orphan_in_crm (Keez deleted)';
			if (keezProbe.exists !== true) return `keez_probe_inconclusive: ${keezProbe.error ?? ''}`;
			const crmDisplay = `${inv.invoiceSeries ?? '?'} ${inv.invoiceNumber?.replace(inv.invoiceSeries ?? '', '').trim() ?? ''}`.trim();
			const keezDisplay = `${keezProbe.series} ${keezProbe.number}`;
			if (inv.invoiceNumber === keezDisplay) return 'match';
			return `mismatch: CRM=${inv.invoiceNumber} Keez=${keezDisplay}`;
		})();

		results.push({
			id: inv.id,
			crm: {
				invoiceNumber: inv.invoiceNumber,
				invoiceSeries: inv.invoiceSeries,
				status: inv.status,
				keezStatus: inv.keezStatus,
				keezExternalId: inv.keezExternalId,
				totalAmount: inv.totalAmount,
				createdAt: inv.createdAt
			},
			keez: keezProbe,
			mismatch
		});
	}

	return json({
		ok: true,
		count: results.length,
		results
	});
};
