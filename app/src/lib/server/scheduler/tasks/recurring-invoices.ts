import { db } from '../../db';
import * as table from '../../db/schema';
import { eq, and, sql } from 'drizzle-orm';
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
		logInfo('scheduler', `Recurring invoices: checking at ${now.toISOString()}`, { action: 'recurring_start' });

		// Find all active recurring invoices where nextRunDate <= now
		const conditions = [
			eq(table.recurringInvoice.isActive, true),
			sql`${table.recurringInvoice.nextRunDate} <= ${now.toISOString()}`
		];

		const recurringInvoices = await db
			.select()
			.from(table.recurringInvoice)
			.where(and(...conditions));

		// Filter out invoices that have ended (endDate is exclusive — invoices stop BEFORE endDate)
		const activeRecurringInvoices = recurringInvoices.filter((ri) => {
			if (!ri.endDate) return true;
			return new Date(ri.endDate) > now;
		});

		// Debug logging when no templates match
		if (recurringInvoices.length === 0) {
			const allTemplates = await db
				.select({
					id: table.recurringInvoice.id,
					name: table.recurringInvoice.name,
					isActive: table.recurringInvoice.isActive,
					nextRunDate: table.recurringInvoice.nextRunDate,
					endDate: table.recurringInvoice.endDate
				})
				.from(table.recurringInvoice);

			logWarning('scheduler', `Recurring invoices: 0 templates matched. Total in DB: ${allTemplates.length}`, {
				action: 'recurring_zero_debug',
				metadata: {
					totalTemplates: allTemplates.length,
					activeCount: allTemplates.filter((t) => t.isActive).length,
					samples: allTemplates.slice(0, 5).map((t) => ({
						name: t.name,
						isActive: t.isActive,
						nextRunDate: t.nextRunDate?.toISOString?.() ?? String(t.nextRunDate),
						endDate: t.endDate?.toISOString?.() ?? 'none'
					}))
				}
			});
		} else {
			logInfo('scheduler', `Recurring invoices: ${recurringInvoices.length} matched query, ${activeRecurringInvoices.length} after endDate filter`, { action: 'recurring_query_result' });
		}

		let invoicesGenerated = 0;
		const errors: Array<{ id: string; error: string }> = [];

		// Generate invoice for each recurring invoice (sequential to avoid Keez number conflicts)
		for (const recurringInvoice of activeRecurringInvoices) {
			try {
				logInfo('scheduler', `Generating recurring invoice ${invoicesGenerated + 1}/${activeRecurringInvoices.length}: template=${recurringInvoice.id}, client=${recurringInvoice.clientId}`, { tenantId: recurringInvoice.tenantId, action: 'recurring_generate_start' });
				const result = await generateInvoiceFromRecurringTemplate(recurringInvoice.id);
				invoicesGenerated++;
				logInfo('scheduler', `Recurring invoice generated: template=${recurringInvoice.id}, invoiceId=${result?.invoiceId}`, { tenantId: recurringInvoice.tenantId, action: 'recurring_generate_done' });

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

		const logFn = invoicesGenerated === 0 ? logWarning : logInfo;
		logFn('scheduler', `Recurring invoices processed: ${invoicesGenerated} generated`, { metadata: { invoicesGenerated, errorCount: errors.length } });
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

	// Check if SMTP email is configured and enabled for this tenant
	const [emailConfig] = await db
		.select()
		.from(table.emailSettings)
		.where(eq(table.emailSettings.tenantId, tenantId))
		.limit(1);

	if (emailConfig && !emailConfig.isEnabled) {
		logWarning('scheduler', 'Recurring invoices: SMTP email is disabled for tenant, skipping auto-send', { tenantId, metadata: { invoiceId } });
		return;
	}

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
	if (recipients.length === 0) {
		logWarning('scheduler', `Recurring invoices: no notification recipients found for client ${client.name}, invoice ${invoice.invoiceNumber} not sent`, { tenantId, metadata: { invoiceId, clientId: invoice.clientId } });
		return;
	}

	let sentCount = 0;
	for (const recipientEmail of recipients) {
		try {
			await sendInvoiceEmail(invoiceId, recipientEmail);
			sentCount++;
		} catch (emailError) {
			const { message, stack } = serializeError(emailError);
			logError('scheduler', `Recurring invoices: failed to send to ${recipientEmail}: ${message}`, { tenantId, stackTrace: stack, metadata: { invoiceId } });
		}
	}

	if (sentCount > 0) {
		await db
			.update(table.invoice)
			.set({
				status: 'sent',
				lastEmailSentAt: new Date(),
				lastEmailStatus: 'sent',
				updatedAt: new Date()
			})
			.where(eq(table.invoice.id, invoiceId));

		logInfo('scheduler', `Recurring invoices: auto-sent invoice ${invoice.invoiceNumber} to ${sentCount}/${recipients.length} recipients`, { tenantId, metadata: { invoiceId, sentCount, totalRecipients: recipients.length } });
	} else {
		await db
			.update(table.invoice)
			.set({
				lastEmailStatus: 'failed',
				updatedAt: new Date()
			})
			.where(eq(table.invoice.id, invoiceId));

		logError('scheduler', `Recurring invoices: all email sends failed for invoice ${invoice.invoiceNumber}`, { tenantId, metadata: { invoiceId, recipientCount: recipients.length } });
	}
}
