/**
 * Diagnostic snapshot of the DA hosting → Recurring → Keez pipeline.
 *
 *   GET /[tenant]/api/_debug-hosting-invoices-state
 *
 * No side effects. Operator uses this after migration / deploys to confirm the
 * pipeline is healthy:
 *   - hostingAccountsActive vs recurringTemplatesActive — should match (no orphans)
 *   - recurringOverdue — templates whose nextRunDate is in the past
 *     (scheduler hasn't picked them up / blocked by an error)
 *   - invoicesHostingNotPushed — drafts that never made it to Keez
 *   - bySeries — confirms OTSH invoices stop landing in the OTS pool
 *
 * Admin-only. Pattern-mirrors `_debug-keez-health/+server.ts`.
 */

import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, isNotNull, isNull, sql, desc, count } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	const role = event.locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') {
		throw error(403, 'Forbidden: Admin access required');
	}
	const tenantId = event.locals.tenant.id;

	// 1. Hosting accounts active for this tenant
	const [hostingAccountsRow] = await db
		.select({ n: count() })
		.from(table.hostingAccount)
		.where(
			and(
				eq(table.hostingAccount.tenantId, tenantId),
				eq(table.hostingAccount.status, 'active')
			)
		);
	const hostingAccountsActive = hostingAccountsRow?.n ?? 0;

	// 2. Recurring templates active for this tenant that point at a hostingAccount
	const [recurringTemplatesRow] = await db
		.select({ n: count() })
		.from(table.recurringInvoice)
		.where(
			and(
				eq(table.recurringInvoice.tenantId, tenantId),
				eq(table.recurringInvoice.isActive, true),
				isNotNull(table.recurringInvoice.hostingAccountId)
			)
		);
	const recurringTemplatesActive = recurringTemplatesRow?.n ?? 0;

	// 3. Hosting accounts active WITHOUT any linked recurring template.
	// Drizzle subquery: LEFT JOIN + WHERE recurring.id IS NULL.
	const orphans = await db
		.select({
			id: table.hostingAccount.id,
			domain: table.hostingAccount.domain,
			clientId: table.hostingAccount.clientId,
			recurringAmount: table.hostingAccount.recurringAmount,
			currency: table.hostingAccount.currency,
			billingCycle: table.hostingAccount.billingCycle
		})
		.from(table.hostingAccount)
		.leftJoin(
			table.recurringInvoice,
			and(
				eq(table.recurringInvoice.hostingAccountId, table.hostingAccount.id),
				eq(table.recurringInvoice.tenantId, table.hostingAccount.tenantId)
			)
		)
		.where(
			and(
				eq(table.hostingAccount.tenantId, tenantId),
				eq(table.hostingAccount.status, 'active'),
				isNull(table.recurringInvoice.id)
			)
		)
		.limit(50);

	// 4. Recurring templates overdue (nextRunDate < now and still active)
	const now = new Date();
	const overdue = await db
		.select({
			id: table.recurringInvoice.id,
			name: table.recurringInvoice.name,
			hostingAccountId: table.recurringInvoice.hostingAccountId,
			nextRunDate: table.recurringInvoice.nextRunDate,
			lastRunDate: table.recurringInvoice.lastRunDate,
			currency: table.recurringInvoice.currency
		})
		.from(table.recurringInvoice)
		.where(
			and(
				eq(table.recurringInvoice.tenantId, tenantId),
				eq(table.recurringInvoice.isActive, true),
				isNotNull(table.recurringInvoice.hostingAccountId),
				sql`${table.recurringInvoice.nextRunDate} < ${now}`
			)
		)
		.orderBy(table.recurringInvoice.nextRunDate)
		.limit(50);

	// 5. Invoices with hostingAccountId — pushed-to-Keez counts + sample of not-pushed.
	const [invoicesTotalRow] = await db
		.select({ n: count() })
		.from(table.invoice)
		.where(
			and(eq(table.invoice.tenantId, tenantId), isNotNull(table.invoice.hostingAccountId))
		);
	const invoicesWithHostingAccountId = invoicesTotalRow?.n ?? 0;

	const [invoicesPushedRow] = await db
		.select({ n: count() })
		.from(table.invoice)
		.where(
			and(
				eq(table.invoice.tenantId, tenantId),
				isNotNull(table.invoice.hostingAccountId),
				isNotNull(table.invoice.keezExternalId)
			)
		);
	const invoicesHostingPushedToKeez = invoicesPushedRow?.n ?? 0;
	const invoicesHostingNotPushed = invoicesWithHostingAccountId - invoicesHostingPushedToKeez;

	const notPushedSample = await db
		.select({
			id: table.invoice.id,
			invoiceNumber: table.invoice.invoiceNumber,
			invoiceSeries: table.invoice.invoiceSeries,
			status: table.invoice.status,
			keezStatus: table.invoice.keezStatus,
			hostingAccountId: table.invoice.hostingAccountId,
			createdAt: table.invoice.createdAt
		})
		.from(table.invoice)
		.where(
			and(
				eq(table.invoice.tenantId, tenantId),
				isNotNull(table.invoice.hostingAccountId),
				isNull(table.invoice.keezExternalId)
			)
		)
		.orderBy(desc(table.invoice.createdAt))
		.limit(20);

	// 6. Distribution by invoiceSeries for hosting invoices — confirms OTSH segregation.
	const bySeries = await db
		.select({
			invoiceSeries: table.invoice.invoiceSeries,
			total: count(),
			pushed: sql<number>`SUM(CASE WHEN ${table.invoice.keezExternalId} IS NOT NULL THEN 1 ELSE 0 END)`.mapWith(Number)
		})
		.from(table.invoice)
		.where(
			and(eq(table.invoice.tenantId, tenantId), isNotNull(table.invoice.hostingAccountId))
		)
		.groupBy(table.invoice.invoiceSeries);

	// 7. Drift detection — surfaces what the cleanup endpoints would touch.
	const [settingsRow] = await db
		.select({ defaultTaxRate: table.invoiceSettings.defaultTaxRate })
		.from(table.invoiceSettings)
		.where(eq(table.invoiceSettings.tenantId, tenantId))
		.limit(1);
	const tenantDefaultTaxRateBps = (settingsRow?.defaultTaxRate ?? 21) * 100;

	// 7a. Draft hosting invoices with taxRate ≠ current tenant default (typical:
	//     drafts generated under 19% that need patching to 21%).
	const draftsWithStaleTaxRate = await db
		.select({
			id: table.invoice.id,
			invoiceNumber: table.invoice.invoiceNumber,
			invoiceTaxRate: table.invoice.taxRate,
			currentTaxRate: sql<number>`${tenantDefaultTaxRateBps}`.mapWith(Number)
		})
		.from(table.invoice)
		.where(
			and(
				eq(table.invoice.tenantId, tenantId),
				eq(table.invoice.status, 'draft'),
				isNotNull(table.invoice.hostingAccountId),
				isNull(table.invoice.keezExternalId),
				sql`${table.invoice.taxRate} != ${tenantDefaultTaxRateBps}`
			)
		)
		.limit(50);

	// 7b. Draft hosting invoices whose amount differs from the linked hostingAccount
	//     (catalog/snapshot drift). Caller may then choose to patch.
	const draftsWithStaleAmount = await db
		.select({
			id: table.invoice.id,
			invoiceNumber: table.invoice.invoiceNumber,
			invoiceAmount: table.invoice.amount,
			haAmount: table.hostingAccount.recurringAmount,
			productPrice: table.hostingProduct.price
		})
		.from(table.invoice)
		.innerJoin(
			table.hostingAccount,
			eq(table.invoice.hostingAccountId, table.hostingAccount.id)
		)
		.leftJoin(
			table.hostingProduct,
			eq(table.hostingAccount.hostingProductId, table.hostingProduct.id)
		)
		.where(
			and(
				eq(table.invoice.tenantId, tenantId),
				eq(table.invoice.status, 'draft'),
				isNotNull(table.invoice.hostingAccountId),
				isNull(table.invoice.keezExternalId),
				sql`${table.invoice.amount} != ${table.hostingAccount.recurringAmount}`
			)
		)
		.limit(50);

	// 7c. Legacy hosting invoices already pushed to Keez but with NULL invoiceSeries
	//     (pre-Phase-2 — column wasn't populated). Backfill candidates.
	const legacyInvoicesNullSeries = await db
		.select({
			id: table.invoice.id,
			invoiceNumber: table.invoice.invoiceNumber,
			keezExternalId: table.invoice.keezExternalId,
			createdAt: table.invoice.createdAt
		})
		.from(table.invoice)
		.where(
			and(
				eq(table.invoice.tenantId, tenantId),
				isNotNull(table.invoice.hostingAccountId),
				isNull(table.invoice.invoiceSeries),
				isNotNull(table.invoice.keezExternalId)
			)
		)
		.orderBy(desc(table.invoice.createdAt))
		.limit(50);

	// 7d. "Stuck-sent" — status='sent' but never pushed to Keez (the OTS 58 case).
	const stuckSentNotPushed = await db
		.select({
			id: table.invoice.id,
			invoiceNumber: table.invoice.invoiceNumber,
			invoiceSeries: table.invoice.invoiceSeries,
			hostingAccountId: table.invoice.hostingAccountId,
			amount: table.invoice.amount,
			totalAmount: table.invoice.totalAmount,
			createdAt: table.invoice.createdAt
		})
		.from(table.invoice)
		.where(
			and(
				eq(table.invoice.tenantId, tenantId),
				isNotNull(table.invoice.hostingAccountId),
				eq(table.invoice.status, 'sent'),
				isNull(table.invoice.keezExternalId)
			)
		)
		.orderBy(desc(table.invoice.createdAt))
		.limit(20);

	return json({
		ok: true,
		tenantId,
		summary: {
			hostingAccountsActive,
			recurringTemplatesActive,
			hostingAccountsWithoutRecurring: orphans.length,
			recurringOverdue: overdue.length,
			invoicesWithHostingAccountId,
			invoicesHostingPushedToKeez,
			invoicesHostingNotPushed,
			draftsWithStaleTaxRate: draftsWithStaleTaxRate.length,
			draftsWithStaleAmount: draftsWithStaleAmount.length,
			legacyInvoicesNullSeries: legacyInvoicesNullSeries.length,
			stuckSentNotPushed: stuckSentNotPushed.length
		},
		anomalies: {
			hostingAccountsMissingRecurring: orphans,
			recurringOverdue: overdue,
			invoicesNotPushed: notPushedSample,
			draftsWithStaleTaxRate,
			draftsWithStaleAmount,
			legacyInvoicesNullSeries,
			stuckSentNotPushed
		},
		bySeries
	});
};
