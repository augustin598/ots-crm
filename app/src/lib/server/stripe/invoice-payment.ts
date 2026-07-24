import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { logInfo, logError, serializeError } from '$lib/server/logger';
import { getHooksManager } from '$lib/server/plugins/hooks';

/**
 * Reconcile a card payment for an ALREADY-EMITTED hosting invoice (renewal or
 * overdue). DISTINCT from the new-order flow: the CRM invoice AND its Keez fiscal
 * invoice already exist, so we must NOT provision DirectAdmin or re-emit Keez —
 * either would double-bill the customer.
 *
 * We flip the invoice to `paid` and emit the same hook trio as the staff
 * `markInvoiceAsPaid` mutation (invoices.remote.ts). That lets the DirectAdmin
 * plugin's `onInvoicePaid` hook advance `next_due_date` by one billing cycle and
 * un-suspend any account that was suspended for THIS overdue invoice — for free.
 * `onInvoiceStatusChanged` is a no-op for newStatus='paid' (it only acts on
 * 'overdue'), so there is no re-suspend risk.
 *
 * Called from two webhook entry points, both gated on
 * `metadata.crmPurpose === 'invoice_payment'`:
 *   - payment_intent.succeeded   (embedded PaymentElement — portal renew page)
 *   - checkout.session.completed (hosted Checkout link — admin pay-link endpoint)
 *
 * Idempotent: skips when the invoice is already `paid`, and the outer
 * `processed_stripe_event` log already gates duplicate webhook delivery.
 */
export async function handleStripeInvoicePayment(params: {
	tenantId: string;
	invoiceId: string;
	paymentIntentId: string | null;
	paidAmountCents: number | null;
	eventLabel: string;
}) {
	const { tenantId, invoiceId, paymentIntentId, paidAmountCents, eventLabel } = params;

	const [existing] = await db
		.select()
		.from(table.invoice)
		.where(and(eq(table.invoice.id, invoiceId), eq(table.invoice.tenantId, tenantId)))
		.limit(1);

	if (!existing) {
		logError('directadmin', `${eventLabel}: invoice_payment — CRM invoice ${invoiceId} negăsit`, {
			tenantId,
			metadata: { invoiceId, paymentIntentId }
		});
		return;
	}

	// Idempotent: a webhook redelivery (or the Checkout + PaymentIntent double-fire
	// for one hosted session) must not re-emit the paid hooks (which advance the
	// due date). Second delivery = no-op.
	if (existing.status === 'paid') {
		logInfo('directadmin', `${eventLabel}: invoice ${existing.invoiceNumber} deja 'paid' — skip idempotent`, {
			tenantId,
			metadata: { invoiceId, paymentIntentId }
		});
		return;
	}

	const previousStatus = existing.status;

	await db
		.update(table.invoice)
		.set({
			status: 'paid',
			paidDate: new Date(),
			paymentMethod: 'Card',
			// Reconciliation refs — stamp only when we have a PI id (Checkout may
			// resolve it as null on rare shapes; keep any pre-stamped value then).
			stripePaymentIntentId: paymentIntentId ?? existing.stripePaymentIntentId,
			externalTransactionId: paymentIntentId ?? existing.externalTransactionId,
			updatedAt: new Date()
		})
		.where(and(eq(table.invoice.id, invoiceId), eq(table.invoice.tenantId, tenantId)));

	const [updated] = await db
		.select()
		.from(table.invoice)
		.where(eq(table.invoice.id, invoiceId))
		.limit(1);

	logInfo('directadmin', `${eventLabel}: invoice ${existing.invoiceNumber} marcată plătită cu cardul (Stripe)`, {
		tenantId,
		metadata: { invoiceId, paymentIntentId, paidAmountCents, hostingAccountId: existing.hostingAccountId }
	});

	// Emit the same hook trio as staff markInvoiceAsPaid → DA plugin's onInvoicePaid
	// advances next_due_date + un-suspends the linked account if it was suspended
	// for this overdue invoice.
	//
	// Non-fatal: a hook failure must NOT throw out of the webhook (Stripe would
	// retry-storm) — the charge already settled and the invoice is already paid.
	if (updated && previousStatus !== 'paid') {
		try {
			const hooks = getHooksManager();
			await hooks.emit({
				type: 'invoice.updated',
				invoice: updated as never,
				previousInvoice: existing as never,
				tenantId,
				userId: 'system:stripe-invoice-payment'
			});
			await hooks.emit({
				type: 'invoice.status.changed',
				invoice: updated as never,
				previousStatus,
				newStatus: 'paid',
				tenantId,
				userId: 'system:stripe-invoice-payment'
			});
			await hooks.emit({
				type: 'invoice.paid',
				invoice: updated as never,
				tenantId,
				userId: 'system:stripe-invoice-payment'
			});
		} catch (err) {
			logError('directadmin', `${eventLabel}: invoice_payment hooks emit failed: ${serializeError(err).message}`, {
				tenantId,
				metadata: { invoiceId, paymentIntentId }
			});
		}
	}
}
