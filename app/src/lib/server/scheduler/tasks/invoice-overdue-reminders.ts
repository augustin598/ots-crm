import { db } from '../../db';
import * as table from '../../db/schema';
import { eq, and, lt, lte } from 'drizzle-orm';
import { sendOverdueReminderEmail, getNotificationRecipients } from '../../email';
import { logInfo, logWarning, logError, serializeError } from '$lib/server/logger';

/**
 * Process invoice overdue reminders - finds overdue invoices for tenants
 * with reminders enabled and sends reminder emails to clients
 */
export async function processInvoiceOverdueReminders(params: Record<string, any> = {}) {
	try {
		const now = new Date();
		let remindersSent = 0;
		const errors: Array<{ invoiceId: string; error: string }> = [];

		// Get all tenants with overdue reminders enabled
		const enabledSettings = await db
			.select()
			.from(table.invoiceSettings)
			.where(
				and(
					eq(table.invoiceSettings.invoiceEmailsEnabled, true),
					eq(table.invoiceSettings.overdueReminderEnabled, true)
				)
			);

		if (enabledSettings.length === 0) {
			logInfo('scheduler', 'Invoice overdue reminders: no tenants have reminders enabled, skipping');
			return { success: true, remindersSent: 0 };
		}

		for (const settings of enabledSettings) {
			try {
				const daysAfterDue = settings.overdueReminderDaysAfterDue ?? 3;
				const repeatDays = settings.overdueReminderRepeatDays ?? 7;
				const maxCount = settings.overdueReminderMaxCount ?? 3;

				// Find overdue invoices for this tenant
				// Status must be 'sent' (not draft, not paid, not cancelled)
				// dueDate must be in the past
				const overdueInvoices = await db
					.select()
					.from(table.invoice)
					.where(
						and(
							eq(table.invoice.tenantId, settings.tenantId),
							eq(table.invoice.status, 'sent'),
							lt(table.invoice.dueDate, now),
							lte(table.invoice.overdueReminderCount, maxCount - 1)
						)
					);

				for (const invoice of overdueInvoices) {
					try {
						if (!invoice.dueDate) continue;

						const daysOverdue = Math.floor(
							(now.getTime() - new Date(invoice.dueDate).getTime()) / (1000 * 60 * 60 * 24)
						);

						// Check if it's time for a reminder
						const reminderCount = invoice.overdueReminderCount ?? 0;

						if (reminderCount === 0) {
							// First reminder: check if enough days have passed since due date
							if (daysOverdue < daysAfterDue) continue;
						} else {
							// Subsequent reminders: check repeat interval
							if (repeatDays === 0) continue; // No repeat configured
							if (!invoice.lastOverdueReminderAt) continue;

							const daysSinceLastReminder = Math.floor(
								(now.getTime() - new Date(invoice.lastOverdueReminderAt).getTime()) /
									(1000 * 60 * 60 * 24)
							);
							if (daysSinceLastReminder < repeatDays) continue;
						}

						// Get client email
						const [client] = await db
							.select()
							.from(table.client)
							.where(eq(table.client.id, invoice.clientId))
							.limit(1);

						if (!client?.email) {
							logWarning('scheduler', `Invoice overdue reminders: cannot send reminder, client email not found`, { tenantId: settings.tenantId, metadata: { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber } });
							continue;
						}

						// Send reminder email to primary + secondary with invoices enabled
						const recipients = await getNotificationRecipients(invoice.clientId, 'invoices');
						for (const recipientEmail of recipients) {
							await sendOverdueReminderEmail(
								invoice.id,
								recipientEmail,
								daysOverdue,
								reminderCount + 1
							);
						}

						// Update invoice tracking
						await db
							.update(table.invoice)
							.set({
								overdueReminderCount: reminderCount + 1,
								lastOverdueReminderAt: now,
								updatedAt: now
							})
							.where(eq(table.invoice.id, invoice.id));

						remindersSent++;
						logInfo('scheduler', `Invoice overdue reminders: sent reminder #${reminderCount + 1} for invoice ${invoice.invoiceNumber} (${daysOverdue} days overdue)`, { tenantId: settings.tenantId, metadata: { invoiceId: invoice.id, reminderNumber: reminderCount + 1, daysOverdue } });
					} catch (error) {
						const { message, stack } = serializeError(error);
						logError('scheduler', `Invoice overdue reminders: error sending reminder for invoice ${invoice.id}: ${message}`, { tenantId: settings.tenantId, stackTrace: stack });
						errors.push({ invoiceId: invoice.id, error: message });
					}
				}
			} catch (error) {
				const { message, stack } = serializeError(error);
				logError('scheduler', `Invoice overdue reminders: error processing tenant: ${message}`, { tenantId: settings.tenantId, stackTrace: stack });
			}
		}

		logInfo('scheduler', `Invoice overdue reminders processed: ${remindersSent} reminders sent`, { metadata: { remindersSent, errorCount: errors.length } });
		if (errors.length > 0) {
			logError('scheduler', `Invoice overdue reminders: ${errors.length} errors`, { metadata: { errorCount: errors.length } });
		}

		return {
			success: true,
			remindersSent,
			errors: errors.length > 0 ? errors : undefined
		};
	} catch (error) {
		const { message, stack } = serializeError(error);
		logError('scheduler', `Invoice overdue reminders: process error: ${message}`, { stackTrace: stack });
		return {
			success: false,
			remindersSent: 0,
			error: 'Failed to process invoice overdue reminders'
		};
	}
}
