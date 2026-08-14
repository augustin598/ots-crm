import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { logInfo, logError, logWarning, serializeError } from '$lib/server/logger';
import { getHooksManager } from '$lib/server/plugins/hooks';
import { isStripeDevTestMode } from '$lib/server/plugins/stripe/factory';
import {
	notifyPaymentSucceeded,
	notifyAdminPaymentReceived
} from '$lib/server/stripe/notifications';

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

	// Pe localhost cu chei de TEST (`stripe listen` local) DB-ul e cel de
	// PRODUCȚIE: o plată cu 4242 ar marca o factură reală „paid" fără bani reali
	// și ar emite hook-urile de plată (DA avansează next_due_date). Permitem
	// bucla completă doar pe facturi marcate explicit de test (număr `TEST-…`),
	// cum folosesc scripturile E2E; restul sunt refuzate cu warning vizibil.
	if (isStripeDevTestMode() && !existing.invoiceNumber?.startsWith('TEST-')) {
		logWarning(
			'directadmin',
			`${eventLabel}: DEV-TEST — refuz să marchez plătită factura reală ${existing.invoiceNumber} (DB partajat cu producția). Folosește o factură cu numărul prefixat TEST- pentru bucla completă.`,
			{ tenantId, metadata: { invoiceId, paymentIntentId } }
		);
		return;
	}

	// Idempotent: a webhook redelivery (or the Checkout + PaymentIntent double-fire
	// for one hosted session) must not re-emit the paid hooks (which advance the
	// due date). Second delivery = no-op.
	if (existing.status === 'paid') {
		// ...dar dacă banii au venit prin ALT PaymentIntent decât cel înregistrat, nu
		// e o redelivery: sunt două plăți reale pe aceeași factură (doi oameni cu
		// același link public, în paralel). Nu putem restitui automat — alertăm.
		if (
			paymentIntentId &&
			existing.stripePaymentIntentId &&
			existing.stripePaymentIntentId !== paymentIntentId
		) {
			logError(
				'directadmin',
				`${eventLabel}: posibilă dublă încasare pe factura ${existing.invoiceNumber} — necesită refund manual`,
				{
					tenantId,
					metadata: {
						invoiceId,
						recordedPaymentIntentId: existing.stripePaymentIntentId,
						incomingPaymentIntentId: paymentIntentId,
						paidAmountCents
					}
				}
			);
			return;
		}

		logInfo('directadmin', `${eventLabel}: invoice ${existing.invoiceNumber} deja 'paid' — skip idempotent`, {
			tenantId,
			metadata: { invoiceId, paymentIntentId }
		});
		return;
	}

	// Suma încasată trebuie să fie exact totalul facturii. Divergența apare când
	// factura a fost editată după crearea PaymentIntent-ului. Marcarea „plătită" pe
	// o sumă greșită ar strica reconcilierea contabilă, deci lăsăm factura
	// neplătită și alertăm — banii sunt deja la Stripe, staff-ul decide.
	if (
		paidAmountCents != null &&
		existing.totalAmount != null &&
		paidAmountCents !== existing.totalAmount
	) {
		logError(
			'directadmin',
			`${eventLabel}: sumă încasată ≠ totalul facturii ${existing.invoiceNumber} — nu marcăm plătită`,
			{
				tenantId,
				metadata: {
					invoiceId,
					paymentIntentId,
					paidAmountCents,
					invoiceTotalCents: existing.totalAmount
				}
			}
		);
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
		let hooksOk = true;
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
			hooksOk = false;
			logError('directadmin', `${eventLabel}: invoice_payment hooks emit failed: ${serializeError(err).message}`, {
				tenantId,
				metadata: { invoiceId, paymentIntentId }
			});
		}

		// Emailurile de confirmare — clientul („Plată primită", cu dedupe pe viață
		// per factură + toggle-urile tenantului în notifyPaymentSucceeded) și
		// adminul. Non-fatal: plata e deja încasată și factura marcată; un SMTP
		// căzut nu are voie să arunce din webhook (Stripe ar intra în retry-storm),
		// iar adminul poate retrimite manual din email logs.
		try {
			await notifyPaymentSucceeded(tenantId, invoiceId);
		} catch (err) {
			logError(
				'directadmin',
				`${eventLabel}: notificarea de plată către client a eșuat: ${serializeError(err).message}`,
				{ tenantId, metadata: { invoiceId, paymentIntentId } }
			);
		}
		try {
			await notifyAdminPaymentReceived(tenantId, invoiceId, {
				'factura-marcata-platita': 'success',
				'hook-uri-hosting': hooksOk ? 'success' : 'failed'
			});
		} catch (err) {
			logError(
				'directadmin',
				`${eventLabel}: notificarea de plată către admin a eșuat: ${serializeError(err).message}`,
				{ tenantId, metadata: { invoiceId, paymentIntentId } }
			);
		}
	}
}
