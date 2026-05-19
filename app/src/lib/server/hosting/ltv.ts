import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, sql } from 'drizzle-orm';

/**
 * Recalculate a client's LTV (sum of paid invoice totals, in cents).
 * Safe to call concurrently — last write wins. Tenant-scoped.
 *
 * Call after: invoice paid, invoice refunded, invoice deleted, invoice amount edited.
 */
export async function recalcClientLTV(tenantId: string, clientId: string): Promise<number> {
	const rows = await db
		.select({ sum: sql<number>`COALESCE(SUM(${table.invoice.totalAmount}), 0)` })
		.from(table.invoice)
		.where(
			and(
				eq(table.invoice.tenantId, tenantId),
				eq(table.invoice.clientId, clientId),
				eq(table.invoice.status, 'paid')
			)
		);
	const totalCents = Number(rows[0]?.sum ?? 0);
	await db
		.update(table.client)
		.set({ ltvCents: totalCents })
		.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, tenantId)));
	return totalCents;
}
