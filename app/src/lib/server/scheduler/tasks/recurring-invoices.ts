import { db } from '../../db';
import * as table from '../../db/schema';
import { eq, and, lte } from 'drizzle-orm';
import { generateInvoiceFromRecurringTemplate } from '../../invoice-utils';
import { sendInvoiceEmail, getNotificationRecipients } from '../../email';

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
						console.error(
							`Failed to auto-send recurring invoice ${result.invoiceId}:`,
							autoSendError
						);
					}
				}
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : 'Unknown error';
				console.error(
					`Error generating invoice for recurring invoice ${recurringInvoice.id}:`,
					errorMessage
				);
				errors.push({ id: recurringInvoice.id, error: errorMessage });
			}
		}

		console.log(`Recurring invoices processed: ${invoicesGenerated} invoices generated`);
		if (errors.length > 0) {
			console.error(`Recurring invoice errors: ${errors.length}`, errors);
		}

		return {
			success: true,
			invoicesGenerated,
			errors: errors.length > 0 ? errors : undefined
		};
	} catch (error) {
		console.error('Process recurring invoices error:', error);
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
		console.warn(`Cannot auto-send invoice ${invoiceId}: client email not found`);
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

	console.log(`Auto-sent recurring invoice ${invoice.invoiceNumber} to ${recipients.join(', ')}`);
}
