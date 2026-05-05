import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, lt, or, isNull } from 'drizzle-orm';
import type { RequestHandler } from './$types';

/**
 * Reset storno invoices wrongly marked 'overdue' back to 'sent'. Storno
 * detection covers both cases:
 *   - isCreditNote = true (set by manual creation)
 *   - totalAmount  < 0    (synced from Keez; sync doesn't set isCreditNote)
 *
 * Also backfills isCreditNote = true on any negative-amount invoice so
 * future code paths can rely on the flag alone.
 *
 * GET  → list affected invoices (no changes)
 * POST → reset status + backfill isCreditNote
 *
 * Admin-only.
 */

function assertAdmin(event: Parameters<RequestHandler>[0]) {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
		throw error(403, 'Admin only');
	}
}

const stornoCondition = or(eq(table.invoice.isCreditNote, true), lt(table.invoice.totalAmount, 0));

export const GET: RequestHandler = async (event) => {
	assertAdmin(event);
	const tenantId = event.locals.tenant!.id;

	const affected = await db
		.select({
			id: table.invoice.id,
			invoiceNumber: table.invoice.invoiceNumber,
			status: table.invoice.status,
			isCreditNote: table.invoice.isCreditNote,
			totalAmount: table.invoice.totalAmount,
			dueDate: table.invoice.dueDate
		})
		.from(table.invoice)
		.where(and(eq(table.invoice.tenantId, tenantId), stornoCondition));

	const wronglyOverdue = affected.filter((i) => i.status === 'overdue');
	const missingFlag = affected.filter((i) => !i.isCreditNote);

	return json({
		totalStorno: affected.length,
		wronglyOverdueCount: wronglyOverdue.length,
		wronglyOverdue,
		missingIsCreditNoteFlagCount: missingFlag.length,
		missingFlag
	});
};

export const POST: RequestHandler = async (event) => {
	assertAdmin(event);
	const tenantId = event.locals.tenant!.id;
	const now = new Date();

	const statusReset = await db
		.update(table.invoice)
		.set({ status: 'sent', updatedAt: now })
		.where(and(eq(table.invoice.tenantId, tenantId), eq(table.invoice.status, 'overdue'), stornoCondition))
		.returning({ id: table.invoice.id, invoiceNumber: table.invoice.invoiceNumber });

	const flagBackfill = await db
		.update(table.invoice)
		.set({ isCreditNote: true, updatedAt: now })
		.where(
			and(
				eq(table.invoice.tenantId, tenantId),
				lt(table.invoice.totalAmount, 0),
				or(eq(table.invoice.isCreditNote, false), isNull(table.invoice.isCreditNote))
			)
		)
		.returning({ id: table.invoice.id, invoiceNumber: table.invoice.invoiceNumber });

	return json({
		statusResetCount: statusReset.length,
		statusReset,
		flagBackfillCount: flagBackfill.length,
		flagBackfill
	});
};
