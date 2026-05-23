import { getHooksManager } from '../plugins/hooks';
import { logInfo } from '$lib/server/logger';

/**
 * Register email notification hooks.
 *
 * Idempotent: a globalThis symbol prevents double-registration across HMR or
 * accidental double-calls. Handlers are inline arrow functions (new reference
 * each call), so the hooks manager's Set can't dedupe them — this guard does.
 */
const EMAIL_HOOKS_REGISTERED = Symbol.for('ots_crm_email_notification_hooks_registered');
const gt = globalThis as unknown as Record<symbol, boolean>;

export function registerEmailNotificationHooks(): void {
	if (gt[EMAIL_HOOKS_REGISTERED]) return;
	gt[EMAIL_HOOKS_REGISTERED] = true;

	// Touch the hooks manager so a future listener registration here doesn't
	// look out-of-place — and so this function's signature doesn't drift just
	// because we currently have zero active listeners.
	void getHooksManager();

	// ─────────────────────────────────────────────────────────────────────────
	// DISABLED 2026-05-23 (Task 13, hosting-email-flow): payment-succeeded
	// customer email is now driven by the Stripe post-payment dispatcher via
	// `notifyPaymentSucceeded` in $lib/server/stripe/notifications.ts, which is
	// the single source of truth. Re-enabling this listener would cause
	// double-send (the unique index on payment_email_event would block the
	// duplicate, but firing redundant work is still wasteful and confusing).
	// See docs/superpowers/specs/2026-05-22-hosting-email-flow-design.md (Q2).
	//
	// Original listener for reference:
	//
	//   hooks.on('invoice.paid', async (event: InvoicePaidEvent) => {
	//     try {
	//       const { invoice, tenantId } = event;
	//       const [invoiceSettings] = await db
	//         .select()
	//         .from(table.invoiceSettings)
	//         .where(eq(table.invoiceSettings.tenantId, tenantId))
	//         .limit(1);
	//       const masterEnabled = invoiceSettings?.invoiceEmailsEnabled ?? true;
	//       const paidEmailEnabled = invoiceSettings?.paidConfirmationEmailEnabled ?? true;
	//       if (!masterEnabled || !paidEmailEnabled) return;
	//       const [client] = await db
	//         .select()
	//         .from(table.client)
	//         .where(eq(table.client.id, invoice.clientId))
	//         .limit(1);
	//       if (!client?.email) return;
	//       const recipients = await getNotificationRecipients(invoice.clientId, 'invoices');
	//       for (const recipient of recipients) {
	//         await sendInvoicePaidEmail(invoice.id, recipient.email);
	//       }
	//     } catch (error) {
	//       // log + don't throw — hooks must not fail siblings.
	//     }
	//   });
	//
	// IMPORTANT — DO NOT TOUCH the sibling `invoice.paid` listener in
	// `notification-hooks.ts`. That one creates internal CRM notifications
	// (in-app bell/badge), NOT customer emails. Different concern.
	// ─────────────────────────────────────────────────────────────────────────

	logInfo('email', 'Email notification hooks registered');
}
