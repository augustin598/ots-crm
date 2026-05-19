/**
 * Manually trigger generation from a recurring invoice template.
 * Identical behavior to the scheduler-fired generation (uses the same helper),
 * but operator-initiated.
 *
 *   POST /[tenant]/api/_debug-trigger-template?templateId=<id>
 *
 * Admin-only. Idempotency: the helper itself does not prevent re-triggering;
 * each call produces a fresh invoice. Use carefully.
 */

import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { generateInvoiceFromRecurringTemplate } from '$lib/server/invoice-utils';
import { logInfo, serializeError } from '$lib/server/logger';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	const role = event.locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') {
		throw error(403, 'Forbidden: Admin access required');
	}
	const tenantId = event.locals.tenant.id;
	const templateId = event.url.searchParams.get('templateId');

	if (!templateId) throw error(400, 'templateId query param is required');
	if (!/^[a-z0-9]{20,32}$/i.test(templateId)) {
		throw error(400, 'templateId must be a CRM id (20-32 alphanumeric chars)');
	}

	const [template] = await db
		.select()
		.from(table.recurringInvoice)
		.where(
			and(eq(table.recurringInvoice.id, templateId), eq(table.recurringInvoice.tenantId, tenantId))
		)
		.limit(1);
	if (!template) throw error(404, 'Template not found in this tenant');

	try {
		const result = await generateInvoiceFromRecurringTemplate(templateId);
		const newInvoiceId = result?.invoiceId;
		const [newInvoice] = newInvoiceId
			? await db
					.select({
						id: table.invoice.id,
						invoiceNumber: table.invoice.invoiceNumber,
						invoiceSeries: table.invoice.invoiceSeries,
						status: table.invoice.status,
						keezStatus: table.invoice.keezStatus,
						keezExternalId: table.invoice.keezExternalId,
						amount: table.invoice.amount,
						totalAmount: table.invoice.totalAmount,
						currency: table.invoice.currency
					})
					.from(table.invoice)
					.where(eq(table.invoice.id, newInvoiceId))
					.limit(1)
			: [];

		logInfo(
			'directadmin',
			`Trigger-template: generated invoice ${newInvoice?.invoiceNumber ?? newInvoiceId} from template ${templateId}`,
			{
				tenantId,
				action: 'trigger_recurring_template',
				metadata: { templateId, newInvoiceId, newInvoiceNumber: newInvoice?.invoiceNumber }
			}
		);
		return json({ ok: true, template: { id: templateId, name: template.name }, invoice: newInvoice });
	} catch (err) {
		const e = serializeError(err);
		return json(
			{
				ok: false,
				phase: 'generate',
				error: e.message,
				stack: e.stack?.split('\n').slice(0, 10).join('\n')
			},
			{ status: 500 }
		);
	}
};
