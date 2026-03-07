import { db } from '../../db';
import * as table from '../../db/schema';
import { eq, and, lte } from 'drizzle-orm';
import { generateInvoiceFromRecurringTemplate } from '../../invoice-utils';
import { sendInvoiceEmail, getNotificationRecipients } from '../../email';
import { logInfo, logWarning, logError, serializeError } from '$lib/server/logger';

/**
 * Process recurring invoices - finds active recurring invoices that are due
 * and generates invoices for them
 */
export async function processRecurringInvoices(params: Record<string, any> = {}) {
	try {
		const now = new Date();

		// Find all active recurring invoices where nextRunDate <= now
		// and (endDate is null or endDate >= now)
		const conditions = [
			eq(table.recurringInvoice.isActive, true),
			lte(table.recurringInvoice.nextRunDate, now)
		];

		const recurringInvoices = await db
			.select()
			.from(table.recurringInvoice)
			.where(and(...conditions));

		// Filter out invoices that have ended
		const activeRecurringInvoices = recurringInvoices.filter((ri) => {
			if (!ri.endDate) return true;
			return new Date(ri.endDate) >= now;
		});

		let invoicesGenerated = 0;
		const errors: Array<{ id: string; error: string }> = [];

		// Generate invoice for each recurring invoice
		for (const recurringInvoice of activeRecurringInvoices) {
			try {
				const result = await generateInvoiceFromRecurringTemplate(recurringInvoice.id);
				invoicesGenerated++;

				// Auto-send email if enabled for this tenant
				if (result?.invoiceId) {
					try {
						await autoSendRecurringInvoiceIfEnabled(
							recurringInvoice.tenantId,
							result.invoiceId
						);
					} catch (autoSendError) {
						const { message, stack } = serializeError(autoSendError);
						logError('scheduler', `Recurring invoices: failed to auto-send invoice ${result.invoiceId}: ${message}`, { tenantId: recurringInvoice.tenantId, stackTrace: stack });
					}
				}
			} catch (error) {
				const { message, stack } = serializeError(error);
				logError('scheduler', `Recurring invoices: error generating invoice for template ${recurringInvoice.id}: ${message}`, { tenantId: recurringInvoice.tenantId, stackTrace: stack });
				errors.push({ id: recurringInvoice.id, error: message });
			}
		}

		logInfo('scheduler', `Recurring invoices processed: ${invoicesGenerated} generated`, { metadata: { invoicesGenerated, errorCount: errors.length } });
		if (errors.length > 0) {
			logError('scheduler', `Recurring invoices: ${errors.length} errors`, { metadata: { errorCount: errors.length } });
		}

		return {
			success: true,
			invoicesGenerated,
			errors: errors.length > 0 ? errors : undefined
		};
	} catch (error) {
		const { message, stack } = serializeError(error);
		logError('scheduler', `Recurring invoices: process error: ${message}`, { stackTrace: stack });
		return {
			success: false,
			invoicesGenerated: 0,
			error: 'Failed to process recurring invoices'
		};
	}
}

/**
 * Auto-send a recurring invoice email if the tenant has auto-send enabled
 */
async function autoSendRecurringInvoiceIfEnabled(tenantId: string, invoiceId: string) {
	const [settings] = await db
		.select()
		.from(table.invoiceSettings)
		.where(eq(table.invoiceSettings.tenantId, tenantId))
		.limit(1);

	const masterEnabled = settings?.invoiceEmailsEnabled ?? true;
	const autoSendEnabled = settings?.autoSendRecurringInvoices ?? false;

	if (!masterEnabled || !autoSendEnabled) return;

	const [invoice] = await db
		.select()
		.from(table.invoice)
		.where(eq(table.invoice.id, invoiceId))
		.limit(1);

	if (!invoice) return;

	const [client] = await db
		.select()
		.from(table.client)
		.where(eq(table.client.id, invoice.clientId))
		.limit(1);

	if (!client?.email) {
		logWarning('scheduler', `Recurring invoices: cannot auto-send invoice, client email not found`, { tenantId, metadata: { invoiceId } });
		return;
	}

	const recipients = await getNotificationRecipients(invoice.clientId, 'invoices');
	for (const recipientEmail of recipients) {
		await sendInvoiceEmail(invoiceId, recipientEmail);
	}

	await db
		.update(table.invoice)
		.set({
			lastEmailSentAt: new Date(),
			lastEmailStatus: 'sent',
			updatedAt: new Date()
		})
		.where(eq(table.invoice.id, invoiceId));

	logInfo('scheduler', `Recurring invoices: auto-sent invoice ${invoice.invoiceNumber}`, { tenantId, metadata: { invoiceId, recipientCount: recipients.length } });
}
