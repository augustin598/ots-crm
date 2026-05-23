import { db } from '$lib/server/db';
import { eq, and } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { paymentEmailEvent, invoice as invoiceTable } from '$lib/server/db/schema';
import { sendInvoicePaidEmail, getNotificationRecipients } from '$lib/server/email';
import { logInfo, logError } from '$lib/server/logger';

function generateEventId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

/**
 * Dedupe-aware wrapper around sendInvoicePaidEmail (Task 13).
 *
 * Lifetime dedupe per invoice via the payment_email_event unique index. A
 * second call for the same invoice no-ops cleanly — important because:
 *   1. The Stripe post-payment dispatcher is idempotent (webhook retries are
 *      a normal part of Stripe operation).
 *   2. The legacy invoice.paid hook in email-notifications.ts was disabled in
 *      the same change, making this notify the SOLE driver of the
 *      payment-succeeded customer email. Re-enabling the legacy listener
 *      without removing this would still be safe — the unique index would
 *      block the double-send. But for clarity we disabled the legacy path.
 *
 * Recipient resolution mirrors the legacy hook (getNotificationRecipients with
 * 'invoices' category) so the swap is invisible to customers: primary
 * client.email + any secondary contacts opted into invoice notifications.
 *
 * payload: not threaded — sendInvoicePaidEmail manages its own email_log row
 * with a replayable payload internally. The dedupe row carries no emailLogId
 * back-link; admins can still trace the actual send via email_log filtered by
 * (invoiceId, emailType='invoice-paid'). This matches the simplest-possible
 * audit trail the user signed off on in Task 13.
 *
 * Failure semantics: any error (decryption, missing recipient, SMTP) bubbles
 * to the caller. The caller (dispatcher) catches and logs without unwinding
 * the broader pipeline — the customer is unhappy but the invoice + DA
 * provision succeed and admin can manually re-send.
 */
export async function notifyPaymentSucceeded(
	tenantId: string,
	invoiceId: string
): Promise<void> {
	// 1. Atomic dedupe — lifetime per invoice. Insert FIRST so a concurrent
	//    dispatcher retry can't both pass the check and double-send.
	const dedupeKey = `payment-succeeded:${invoiceId}`;
	const inserted = await db
		.insert(paymentEmailEvent)
		.values({
			id: generateEventId(),
			tenantId,
			invoiceId,
			eventType: 'payment-succeeded',
			dedupeKey
		})
		.onConflictDoNothing({
			target: [paymentEmailEvent.tenantId, paymentEmailEvent.invoiceId, paymentEmailEvent.dedupeKey]
		})
		.returning({ id: paymentEmailEvent.id });

	if (inserted.length === 0) {
		logInfo('hosting-email', `dedupe skip payment-succeeded for invoice ${invoiceId}`, {
			tenantId,
			metadata: { invoiceId }
		});
		return;
	}

	try {
		// 2. Load invoice (tenant-scoped). Defense-in-depth: a malicious caller
		//    that hit the dispatcher with the wrong tenant context still can't
		//    surface another tenant's clientId through this path.
		const [inv] = await db
			.select({
				id: invoiceTable.id,
				tenantId: invoiceTable.tenantId,
				clientId: invoiceTable.clientId,
				invoiceNumber: invoiceTable.invoiceNumber
			})
			.from(invoiceTable)
			.where(and(eq(invoiceTable.id, invoiceId), eq(invoiceTable.tenantId, tenantId)))
			.limit(1);
		if (!inv) {
			throw new Error(`invoice ${invoiceId} not found for tenant ${tenantId}`);
		}

		// 3. Resolve recipients — matches legacy hook behavior exactly (primary
		//    client.email + secondary contacts with the 'invoices' notification
		//    flag enabled). Throws if zero recipients resolve.
		const recipients = await getNotificationRecipients(inv.clientId, 'invoices');
		if (recipients.length === 0) {
			throw new Error(`no recipient resolvable for invoice ${invoiceId}`);
		}

		// 4. Delegate to the existing sender for each recipient. The sender
		//    handles persistence (email_log), brand resolution, and Romanian
		//    template rendering — we're swapping the trigger, not the email.
		for (const recipient of recipients) {
			await sendInvoicePaidEmail(invoiceId, recipient.email);
		}

		logInfo('hosting-email', `sent payment-succeeded for invoice ${invoiceId}`, {
			tenantId,
			metadata: {
				invoiceId,
				invoiceNumber: inv.invoiceNumber,
				recipients: recipients.map((r) => r.email).join(', ')
			}
		});
	} catch (err) {
		logError('hosting-email', `notifyPaymentSucceeded failed for invoice ${invoiceId}`, {
			tenantId,
			metadata: {
				invoiceId,
				error: err instanceof Error ? err.message : String(err)
			}
		});
		throw err;
	}
}
