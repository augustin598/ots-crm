import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

/**
 * Reset credit notes (storno) that were wrongly marked as 'overdue' by the
 * old overdue cron back to 'sent'. The cron now skips credit notes; this
 * endpoint cleans up the historical drift for the current tenant.
 *
 * GET  → list affected invoices (no changes)
 * POST → flip status from 'overdue' to 'sent' for credit notes in this tenant
 *
 * Admin-only.
 */

function assertAdmin(event: Parameters<RequestHandler>[0]) {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
		throw error(403, 'Admin only');
	}
}

export const GET: RequestHandler = async (event) => {
	assertAdmin(event);
	const tenantId = event.locals.tenant!.id;

	const affected = await db
		.select({
			id: table.invoice.id,
			invoiceNumber: table.invoice.invoiceNumber,
			status: table.invoice.status,
			totalAmount: table.invoice.totalAmount,
			dueDate: table.invoice.dueDate
		})
		.from(table.invoice)
		.where(
			and(
				eq(table.invoice.tenantId, tenantId),
				eq(table.invoice.isCreditNote, true),
				eq(table.invoice.status, 'overdue')
			)
		);

	return json({ count: affected.length, invoices: affected });
};

export const POST: RequestHandler = async (event) => {
	assertAdmin(event);
	const tenantId = event.locals.tenant!.id;

	const updated = await db
		.update(table.invoice)
		.set({ status: 'sent', updatedAt: new Date() })
		.where(
			and(
				eq(table.invoice.tenantId, tenantId),
				eq(table.invoice.isCreditNote, true),
				eq(table.invoice.status, 'overdue')
			)
		)
		.returning({ id: table.invoice.id, invoiceNumber: table.invoice.invoiceNumber });

	return json({ updatedCount: updated.length, invoices: updated });
};
