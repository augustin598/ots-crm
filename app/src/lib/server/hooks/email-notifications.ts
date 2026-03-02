import { getHooksManager } from '../plugins/hooks';
import { sendInvoicePaidEmail } from '../email';
import { db } from '../db';
import * as table from '../db/schema';
import { eq } from 'drizzle-orm';
import type { InvoicePaidEvent } from '../plugins/types';

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
				console.log(
					`Invoice paid emails are disabled for tenant ${tenantId}. Skipping email for invoice ${invoice.invoiceNumber}.`
				);
				return;
			}

			// Get client email
			const [client] = await db
				.select()
				.from(table.client)
				.where(eq(table.client.id, invoice.clientId))
				.limit(1);

			if (!client?.email) {
				console.warn(
					`Cannot send invoice paid email for invoice ${invoice.invoiceNumber}: client email not found`
				);
				return;
			}

			// Send payment confirmation email
			await sendInvoicePaidEmail(invoice.id, client.email);
			console.log(`Invoice paid email sent to ${client.email} for invoice ${invoice.invoiceNumber}`);
		} catch (error) {
			console.error('Failed to send invoice paid email notification:', error);
			// Don't throw - hooks are designed to not fail other handlers
		}
	});

	console.log('Email notification hooks registered');
}
