/**
 * Cancel a "stuck-sent" hosting invoice (status='sent' AND keezExternalId IS NULL)
 * and regenerate the renewal as a fresh invoice from the linked recurring template.
 *
 *   POST /[tenant]/api/_debug-cancel-and-regenerate?invoiceId=<id>            (dry-run; default)
 *   POST /[tenant]/api/_debug-cancel-and-regenerate?invoiceId=<id>&apply=true (mutate)
 *
 * Use case: "OTS 58" was sent to the client but the push to Keez failed and was
 * never retried. The client believes they received "OTS 58" but Keez never
 * minted that number. If we push now it would sequence as 545 (current max+1),
 * not 58 — mismatch with what the customer received.
 *
 * Correct path: mark OTS 58 cancelled locally with a note linking to the
 * replacement, then generate a fresh invoice via the recurring template in the
 * tenant's correct series (OTSH for hosting). Operator emails the corrected
 * invoice with an explanation.
 *
 * Refuses to act if:
 *   - status !== 'sent'  (only sent invoices are the broken case)
 *   - keezExternalId IS NOT NULL  (already in Keez — no longer "stuck")
 *   - hostingAccountId IS NULL  (this endpoint is hosting-only)
 *   - no recurring template linked to the same hostingAccountId
 *
 * Admin-only.
 */

import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { generateInvoiceFromRecurringTemplate } from '$lib/server/invoice-utils';
import { logInfo, logError, serializeError } from '$lib/server/logger';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	const role = event.locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') {
		throw error(403, 'Forbidden: Admin access required');
	}
	const tenantId = event.locals.tenant.id;
	const apply = event.url.searchParams.get('apply') === 'true';
	const invoiceId = event.url.searchParams.get('invoiceId');

	if (!invoiceId) throw error(400, 'invoiceId query param is required');
	if (!/^[a-z0-9]{20,32}$/i.test(invoiceId)) {
		throw error(400, 'invoiceId must be a CRM id (20-32 alphanumeric chars)');
	}

	const [invoice] = await db
		.select()
		.from(table.invoice)
		.where(
			and(eq(table.invoice.id, invoiceId), eq(table.invoice.tenantId, tenantId))
		)
		.limit(1);

	if (!invoice) throw error(404, 'Invoice not found in this tenant');

	// Pre-flight checks — refuse anything that doesn't match the stuck-sent shape.
	const refusals: string[] = [];
	if (invoice.status !== 'sent') {
		refusals.push(`status is "${invoice.status}" (expected "sent")`);
	}
	if (invoice.keezExternalId) {
		refusals.push(`keezExternalId already set (${invoice.keezExternalId}) — invoice is in Keez`);
	}
	if (!invoice.hostingAccountId) {
		refusals.push('hostingAccountId is null — this endpoint only handles hosting invoices');
	}
	if (refusals.length > 0) {
		return json(
			{
				ok: false,
				apply,
				invoiceId,
				refusals,
				invoice: {
					id: invoice.id,
					invoiceNumber: invoice.invoiceNumber,
					status: invoice.status,
					keezExternalId: invoice.keezExternalId,
					hostingAccountId: invoice.hostingAccountId
				}
			},
			{ status: 409 }
		);
	}

	const [template] = await db
		.select({
			id: table.recurringInvoice.id,
			name: table.recurringInvoice.name,
			isActive: table.recurringInvoice.isActive,
			nextRunDate: table.recurringInvoice.nextRunDate
		})
		.from(table.recurringInvoice)
		.where(
			and(
				eq(table.recurringInvoice.tenantId, tenantId),
				eq(table.recurringInvoice.hostingAccountId, invoice.hostingAccountId!)
			)
		)
		.limit(1);

	if (!template) {
		return json(
			{
				ok: false,
				apply,
				invoiceId,
				refusals: ['no recurring template linked to this hostingAccountId — cannot regenerate']
			},
			{ status: 409 }
		);
	}

	const preview = {
		invoiceId: invoice.id,
		invoiceNumber: invoice.invoiceNumber,
		clientId: invoice.clientId,
		hostingAccountId: invoice.hostingAccountId,
		amount: invoice.amount,
		totalAmount: invoice.totalAmount,
		currency: invoice.currency,
		willCancel: true,
		willRegenerateFromTemplate: {
			id: template.id,
			name: template.name,
			isActive: template.isActive,
			nextRunDate: template.nextRunDate
		}
	};

	if (!apply) {
		return json({ ok: true, apply: false, preview });
	}

	// Apply: cancel old, regenerate via template, link them in notes.
	const replacementNotePrefix = '\n\n[Anulată — facturare corectată; vezi factura înlocuitoare ';

	// 1. Generate replacement first so we have its id to put in the cancellation note.
	//    If this fails we abort and leave the old invoice as-is (no destructive change).
	let generated: { success?: boolean; invoiceId?: string } | undefined;
	try {
		generated = await generateInvoiceFromRecurringTemplate(template.id);
	} catch (err) {
		const e = serializeError(err);
		logError(
			'directadmin',
			`Cancel-and-regenerate: generateInvoiceFromRecurringTemplate failed for template ${template.id}: ${e.message}`,
			{ tenantId, stackTrace: e.stack, metadata: { templateId: template.id, invoiceId } }
		);
		return json(
			{
				ok: false,
				phase: 'regenerate',
				error: e.message,
				templateId: template.id,
				stack: e.stack?.split('\n').slice(0, 8).join('\n')
			},
			{ status: 500 }
		);
	}
	const newInvoiceId = generated?.invoiceId;
	if (!newInvoiceId) {
		return json(
			{
				ok: false,
				phase: 'regenerate',
				error: 'generateInvoiceFromRecurringTemplate did not return an invoiceId',
				generated
			},
			{ status: 500 }
		);
	}
	const [newInvoice] = await db
		.select({
			id: table.invoice.id,
			invoiceNumber: table.invoice.invoiceNumber,
			invoiceSeries: table.invoice.invoiceSeries,
			totalAmount: table.invoice.totalAmount
		})
		.from(table.invoice)
		.where(eq(table.invoice.id, newInvoiceId))
		.limit(1);

	// 2. Mark the old invoice cancelled with a pointer to the replacement.
	const newNotes =
		(invoice.notes ?? '') +
		replacementNotePrefix +
		(newInvoice?.invoiceNumber ?? newInvoiceId) +
		' / id ' +
		newInvoiceId +
		']';

	await db
		.update(table.invoice)
		.set({
			status: 'cancelled',
			notes: newNotes,
			updatedAt: new Date()
		})
		.where(and(eq(table.invoice.id, invoice.id), eq(table.invoice.tenantId, tenantId)));

	logInfo(
		'directadmin',
		`Cancel-and-regenerate: cancelled ${invoice.invoiceNumber} (${invoice.id}), regenerated as ${newInvoice?.invoiceNumber ?? '(unknown)'} (${newInvoiceId})`,
		{
			tenantId,
			action: 'cancel_and_regenerate',
			metadata: {
				oldInvoiceId: invoice.id,
				oldInvoiceNumber: invoice.invoiceNumber,
				newInvoiceId,
				newInvoiceNumber: newInvoice?.invoiceNumber
			}
		}
	);

	return json({
		ok: true,
		apply: true,
		cancelled: {
			id: invoice.id,
			invoiceNumber: invoice.invoiceNumber,
			notes: newNotes
		},
		regenerated: {
			id: newInvoiceId,
			invoiceNumber: newInvoice?.invoiceNumber ?? null,
			invoiceSeries: newInvoice?.invoiceSeries ?? null,
			totalAmount: newInvoice?.totalAmount ?? null
		}
	});
};
