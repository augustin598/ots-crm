import type Stripe from 'stripe';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { logInfo, logError, serializeError } from '$lib/server/logger';

/**
 * Webhook event handlers — separate per event type, idempotent.
 *
 * Idempotency layer e gestionat OUTSIDE (în route handler), prin
 * `processed_stripe_event` table. Aceste funcții presupun că event-ul nu a fost
 * încă procesat și fac update-uri în DB.
 *
 * Toate handler-urile sunt idempotent prin natură (UPDATE cu where condition),
 * dar ne bazăm și pe idempotency log pentru a evita re-trigger side effects
 * (gen email-uri trimise de două ori).
 */

export async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
	const md = session.metadata ?? {};
	const tenantId = md.crmTenantId;
	const clientId = md.crmClientId;
	const inquiryId = md.crmHostingInquiryId;
	const productId = md.crmHostingProductId;

	if (!tenantId || !clientId || !inquiryId) {
		logError('directadmin', 'checkout.session.completed: lipsesc metadata CRM', {
			metadata: { sessionId: session.id, md }
		});
		return;
	}

	logInfo('directadmin', 'checkout.session.completed received', {
		tenantId,
		metadata: { sessionId: session.id, clientId, inquiryId, productId }
	});

	// 1. Marchează client ca pending_payment → active (plata e confirmată)
	await db
		.update(table.client)
		.set({ onboardingStatus: 'active', status: 'active', updatedAt: new Date() })
		.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, tenantId)));

	// 2. Marchează inquiry ca "converted" (staff vede în /hosting/inquiries)
	await db
		.update(table.hostingInquiry)
		.set({
			status: 'converted',
			contactedAt: new Date(),
			updatedAt: new Date()
		})
		.where(
			and(eq(table.hostingInquiry.id, inquiryId), eq(table.hostingInquiry.tenantId, tenantId))
		);

	// 3. TODO Sprint 8.1: send magic link email pentru access portal
	// TODO Sprint 8.2: create CRM `invoice` row + Keez emit factura fiscală (post-webhook)
	// TODO Sprint 9: auto-provision DA account (acum e MANUAL de staff)

	logInfo('directadmin', 'order processed — staff trebuie să activeze cont DA manual', {
		tenantId,
		metadata: { sessionId: session.id, clientId, inquiryId }
	});
}

export async function handleInvoicePaid(invoice: Stripe.Invoice) {
	// Pentru subscriptions, fiecare reînnoire annuală emite `invoice.paid`.
	// Aici legăm la CRM invoice + trigger Keez emit.
	const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
	if (!customerId) return;

	const [clientRow] = await db
		.select({ id: table.client.id, tenantId: table.client.tenantId, name: table.client.name })
		.from(table.client)
		.where(eq(table.client.stripeCustomerId, customerId))
		.limit(1);
	if (!clientRow) {
		logError('directadmin', 'invoice.paid: stripeCustomerId nu există în CRM', {
			metadata: { stripeCustomerId: customerId, invoiceId: invoice.id }
		});
		return;
	}

	logInfo('directadmin', 'invoice.paid received', {
		tenantId: clientRow.tenantId,
		metadata: {
			stripeInvoiceId: invoice.id,
			clientId: clientRow.id,
			amountPaid: invoice.amount_paid,
			currency: invoice.currency
		}
	});

	// TODO Sprint 8.2: create CRM invoice + trigger Keez fiscal invoice emission
	// Implementation requires careful integration with existing keezPlugin invoice flow.
}

export async function handlePaymentFailed(invoice: Stripe.Invoice) {
	const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
	if (!customerId) return;

	const [clientRow] = await db
		.select({ id: table.client.id, tenantId: table.client.tenantId })
		.from(table.client)
		.where(eq(table.client.stripeCustomerId, customerId))
		.limit(1);
	if (!clientRow) return;

	logError('directadmin', 'invoice.payment_failed — staff intervention needed', {
		tenantId: clientRow.tenantId,
		metadata: {
			stripeInvoiceId: invoice.id,
			clientId: clientRow.id,
			attemptCount: invoice.attempt_count,
			nextRetryAt: invoice.next_payment_attempt
		}
	});
	// TODO: trigger email staff + email client cu Hosted Invoice Page URL
	// (invoice.hosted_invoice_url) pentru a actualiza metoda de plată.
}

export async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
	const customerId =
		typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
	const [clientRow] = await db
		.select({ id: table.client.id, tenantId: table.client.tenantId })
		.from(table.client)
		.where(eq(table.client.stripeCustomerId, customerId))
		.limit(1);
	if (!clientRow) return;

	logInfo('directadmin', 'subscription canceled', {
		tenantId: clientRow.tenantId,
		metadata: { stripeSubscriptionId: subscription.id, clientId: clientRow.id }
	});
	// TODO Sprint 9: suspend hostingAccount(s) for this client automatically.
}

/**
 * Dispatch a Stripe event to its handler. Returns the action taken (for logging).
 */
export async function dispatchStripeEvent(event: Stripe.Event): Promise<string> {
	try {
		switch (event.type) {
			case 'checkout.session.completed':
				await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
				return 'handled';
			case 'invoice.paid':
			case 'invoice.payment_succeeded':
				await handleInvoicePaid(event.data.object as Stripe.Invoice);
				return 'handled';
			case 'invoice.payment_failed':
				await handlePaymentFailed(event.data.object as Stripe.Invoice);
				return 'handled';
			case 'customer.subscription.deleted':
				await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
				return 'handled';
			default:
				return 'ignored';
		}
	} catch (e) {
		const { message } = serializeError(e);
		logError('directadmin', `webhook handler failed for ${event.type}: ${message}`, {
			metadata: { eventId: event.id }
		});
		throw e;
	}
}
