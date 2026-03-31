import { db } from '../../db';
import * as table from '../../db/schema';
import { eq, and, lt, lte, notInArray } from 'drizzle-orm';
import { sendOverdueReminderEmail, getNotificationRecipients } from '../../email';
import { logInfo, logWarning, logError, serializeError } from '$lib/server/logger';

/**
 * Process invoice overdue reminders - finds overdue invoices (keezStatus='Valid')
 * for tenants with reminders enabled and sends reminder emails to clients
 */
export async function processInvoiceOverdueReminders(params: Record<string, any> = {}) {
	try {
		const now = new Date();
		const nowMidnight = new Date(now);
		nowMidnight.setHours(0, 0, 0, 0);
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
				// Check if SMTP email is configured and enabled for this tenant
				const [emailConfig] = await db
					.select()
					.from(table.emailSettings)
					.where(eq(table.emailSettings.tenantId, settings.tenantId))
					.limit(1);

				if (emailConfig && !emailConfig.isEnabled) {
					logWarning('scheduler', 'Invoice overdue reminders: SMTP email is disabled for tenant, skipping', { tenantId: settings.tenantId });
					continue;
				}

				const daysAfterDue = settings.overdueReminderDaysAfterDue ?? 3;
				const repeatDays = settings.overdueReminderRepeatDays ?? 7;
				const maxCount = settings.overdueReminderMaxCount ?? 3;

				// Auto-transition keezStatus='Valid' invoices past due date to 'overdue'
				// Only for invoices not already overdue/paid/cancelled
				await db
					.update(table.invoice)
					.set({ status: 'overdue', updatedAt: now })
					.where(
						and(
							eq(table.invoice.tenantId, settings.tenantId),
							eq(table.invoice.keezStatus, 'Valid'),
							notInArray(table.invoice.status, ['overdue', 'paid', 'cancelled']),
							lt(table.invoice.dueDate, now)
						)
					);

				// Find overdue invoices: strictly keezStatus='Valid', dueDate past, not paid/cancelled
				const overdueInvoices = await db
					.select()
					.from(table.invoice)
					.where(
						and(
							eq(table.invoice.tenantId, settings.tenantId),
							eq(table.invoice.keezStatus, 'Valid'),
							notInArray(table.invoice.status, ['paid', 'cancelled']),
							lt(table.invoice.dueDate, now),
							lte(table.invoice.overdueReminderCount, maxCount - 1)
						)
					);

				logInfo('scheduler', `Invoice overdue reminders: found ${overdueInvoices.length} overdue invoices for tenant`, {
					tenantId: settings.tenantId,
					metadata: { invoiceCount: overdueInvoices.length, daysAfterDue, repeatDays, maxCount }
				});

				for (const invoice of overdueInvoices) {
					try {
						if (!invoice.dueDate) continue;

						// Normalize to midnight to avoid timezone off-by-one
						const dueDateMidnight = new Date(invoice.dueDate);
						dueDateMidnight.setHours(0, 0, 0, 0);
						const daysOverdue = Math.floor(
							(nowMidnight.getTime() - dueDateMidnight.getTime()) / (1000 * 60 * 60 * 24)
						);

						// Check if it's time for a reminder
						const reminderCount = invoice.overdueReminderCount ?? 0;

						if (reminderCount === 0) {
							// First reminder: check if enough days have passed since due date
							if (daysOverdue < daysAfterDue) {
								logInfo('scheduler', `Invoice overdue reminders: skipping ${invoice.invoiceNumber} - only ${daysOverdue} days overdue (need ${daysAfterDue})`, { tenantId: settings.tenantId });
								continue;
							}
						} else {
							// Subsequent reminders: check repeat interval
							if (repeatDays === 0) continue;
							if (!invoice.lastOverdueReminderAt) continue;

							const lastReminderMidnight = new Date(invoice.lastOverdueReminderAt);
							lastReminderMidnight.setHours(0, 0, 0, 0);
							const daysSinceLastReminder = Math.floor(
								(nowMidnight.getTime() - lastReminderMidnight.getTime()) / (1000 * 60 * 60 * 24)
							);
							if (daysSinceLastReminder < repeatDays) {
								logInfo('scheduler', `Invoice overdue reminders: skipping ${invoice.invoiceNumber} - ${daysSinceLastReminder} days since last reminder (need ${repeatDays})`, { tenantId: settings.tenantId });
								continue;
							}
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
						let atLeastOneSent = false;
						for (const recipientEmail of recipients) {
							try {
								await sendOverdueReminderEmail(
									invoice.id,
									recipientEmail,
									daysOverdue,
									reminderCount + 1
								);
								atLeastOneSent = true;
							} catch (recipientError) {
								const { message } = serializeError(recipientError);
								logWarning('scheduler', `Invoice overdue reminders: failed to send to ${recipientEmail} for invoice ${invoice.invoiceNumber}: ${message}`, { tenantId: settings.tenantId });
							}
						}

						// Update invoice tracking only if at least one email was sent
						if (atLeastOneSent) {
							await db
								.update(table.invoice)
								.set({
									overdueReminderCount: reminderCount + 1,
									lastOverdueReminderAt: now,
									...(invoice.status !== 'overdue' ? { status: 'overdue' as const } : {}),
									updatedAt: now
								})
								.where(eq(table.invoice.id, invoice.id));

							remindersSent++;
						} else {
							logError('scheduler', `Invoice overdue reminders: all recipients failed for invoice ${invoice.invoiceNumber}`, { tenantId: settings.tenantId, metadata: { invoiceId: invoice.id, recipientCount: recipients.length } });
							errors.push({ invoiceId: invoice.id, error: 'All recipient emails failed' });
						}
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
