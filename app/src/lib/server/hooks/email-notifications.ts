import { getHooksManager } from '../plugins/hooks';
import { sendInvoicePaidEmail, getNotificationRecipients } from '../email';
import { db } from '../db';
import * as table from '../db/schema';
import { eq } from 'drizzle-orm';
import type { InvoicePaidEvent } from '../plugins/types';
import { logInfo, logWarning, logError, serializeError } from '$lib/server/logger';

/**
 * Register email notification hooks
 */
export function registerEmailNotificationHooks(): void {
	const hooks = getHooksManager();

	// Listen for invoice.paid events
	hooks.on('invoice.paid', async (event: InvoicePaidEvent) => {
		try {
			const { invoice, tenantId } = event;

			// Check if invoice emails are enabled for this tenant
			const [invoiceSettings] = await db
				.select()
				.from(table.invoiceSettings)
				.where(eq(table.invoiceSettings.tenantId, tenantId))
				.limit(1);

			const masterEnabled = invoiceSettings?.invoiceEmailsEnabled ?? true;
			const paidEmailEnabled = invoiceSettings?.paidConfirmationEmailEnabled ?? true;

			if (!masterEnabled || !paidEmailEnabled) {
				logInfo('email', 'Invoice paid emails disabled, skipping', { tenantId, metadata: { invoiceNumber: invoice.invoiceNumber } });
				return;
			}

			// Get client email
			const [client] = await db
				.select()
				.from(table.client)
				.where(eq(table.client.id, invoice.clientId))
				.limit(1);

			if (!client?.email) {
				logWarning('email', 'Cannot send invoice paid email, client email not found', { tenantId, metadata: { invoiceNumber: invoice.invoiceNumber } });
				return;
			}

			// Send payment confirmation email to primary + secondary with invoices enabled
			const recipients = await getNotificationRecipients(invoice.clientId, 'invoices');
			for (const recipientEmail of recipients) {
				await sendInvoicePaidEmail(invoice.id, recipientEmail);
			}
			logInfo('email', 'Invoice paid email sent', { tenantId, metadata: { invoiceNumber: invoice.invoiceNumber, recipients: recipients.join(', ') } });
		} catch (error) {
			logError('email', 'Failed to send invoice paid email notification', { tenantId: event.tenantId, stackTrace: serializeError(error).stack });
			// Don't throw - hooks are designed to not fail other handlers
		}
	});

	logInfo('email', 'Email notification hooks registered');
}
