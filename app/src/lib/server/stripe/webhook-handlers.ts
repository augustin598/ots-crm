import type Stripe from 'stripe';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { logInfo, logError, logWarning, serializeError } from '$lib/server/logger';
import { runPostPaymentSteps } from './post-payment/dispatcher';

/**
 * Webhook event handlers — separate per event type, idempotent.
 *
 * Idempotency layer e gestionat OUTSIDE (în route handler), prin
 * `processed_stripe_event` table cu status lifecycle 'processing' → 'completed'.
 * Aceste funcții presupun că event-ul nu a fost încă procesat și fac update-uri în DB.
 *
 * Toate handler-urile sunt idempotent prin natură (UPDATE cu where condition + filtru
 * tenantId). Side effects scumpe (email, provisioning, factură Keez) trec prin
 * `post_payment_step` table care e idempotent per (stripe_session_id, step).
 */

/**
 * Resolve clientul CRM legat de Stripe Customer + asertează că tenant-ul din
 * metadata event-ului se potrivește cu tenantul clientului. Defense-in-depth: dacă
 * vreodată activăm Stripe Connect / multi-tenant, blocăm cross-tenant writes.
 *
 * Returns null + log dacă diverge (handler-ul va skip side effects).
 */
async function resolveClientByStripeCustomer(
	stripeCustomerId: string,
	expectedTenantId: string | null,
	context: { eventType: string; eventId: string }
): Promise<{ id: string; tenantId: string; name: string } | null> {
	const [clientRow] = await db
		.select({
			id: table.client.id,
			tenantId: table.client.tenantId,
			name: table.client.name
		})
		.from(table.client)
		.where(eq(table.client.stripeCustomerId, stripeCustomerId))
		.limit(1);
	if (!clientRow) {
		logError('directadmin', `${context.eventType}: stripeCustomerId nu există în CRM`, {
			metadata: { stripeCustomerId, eventId: context.eventId }
		});
		return null;
	}
	if (expectedTenantId && clientRow.tenantId !== expectedTenantId) {
		logError('directadmin', `${context.eventType}: tenantId mismatch (defense-in-depth blocked)`, {
			tenantId: clientRow.tenantId,
			metadata: {
				stripeCustomerId,
				eventId: context.eventId,
				expectedTenantId,
				actualTenantId: clientRow.tenantId
			}
		});
		return null;
	}
	return clientRow;
}

export async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
	const md = session.metadata ?? {};
	const tenantId = md.crmTenantId;
	const clientId = md.crmClientId;
	const inquiryId = md.crmHostingInquiryId;
	const productId = md.crmHostingProductId;

	if (!tenantId || !clientId || !inquiryId || !productId) {
		logError('directadmin', 'checkout.session.completed: lipsesc metadata CRM', {
			metadata: { sessionId: session.id, hasMetadata: !!session.metadata }
		});
		return;
	}

	logInfo('directadmin', 'checkout.session.completed received', {
		tenantId,
		metadata: { sessionId: session.id, clientId, inquiryId, productId }
	});

	// Atomicitate: client + inquiry update într-o singură tranzacție.
	// Pe partial failure (DB busy, network drop), Stripe retry-uiește event-ul și
	// idempotency log-ul previne dublarea — dar dorim să nu lăsăm starea
	// intermediară (client active dar inquiry needit converted) vizibilă.
	await db.transaction(async (tx) => {
		await tx
			.update(table.client)
			.set({ onboardingStatus: 'active', status: 'active', updatedAt: new Date() })
			.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, tenantId)));

		await tx
			.update(table.hostingInquiry)
			.set({
				status: 'converted',
				contactedAt: new Date(),
				updatedAt: new Date()
			})
			.where(
				and(eq(table.hostingInquiry.id, inquiryId), eq(table.hostingInquiry.tenantId, tenantId))
			);
	});

	// Side effects post-payment (idempotent per session_id + step, vezi post_payment_step):
	//   1. magic_link  — email cu link portal pentru client (TTL 7 zile)
	//   2. keez_invoice — emite factura fiscală RO (skipped pentru mode='subscription'
	//                     — așteptăm invoice.paid event)
	//   3. da_provision — auto-create DirectAdmin user account
	// Eșuarea unui pas nu blochează următorii. Staff vede via _debug-stripe-health.
	await runPostPaymentSteps({
		tenantId,
		clientId,
		inquiryId,
		productId,
		sessionId: session.id,
		mode: session.mode === 'subscription' ? 'subscription' : 'payment',
		stripeCustomerId:
			typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null,
		stripeSubscriptionId:
			typeof session.subscription === 'string'
				? session.subscription
				: session.subscription?.id ?? null,
		stripePaymentIntentId:
			typeof session.payment_intent === 'string'
				? session.payment_intent
				: session.payment_intent?.id ?? null
	});
}

export async function handleInvoicePaid(invoice: Stripe.Invoice) {
	// Pentru subscriptions, fiecare reînnoire emite `invoice.paid`.
	// Aici legăm la CRM invoice + trigger Keez emit.
	const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
	if (!customerId) return;

	// Metadata din Subscription se propagă pe Invoice (Stripe).
	const expectedTenantId = invoice.metadata?.crmTenantId ?? null;
	const clientRow = await resolveClientByStripeCustomer(customerId, expectedTenantId, {
		eventType: 'invoice.paid',
		eventId: invoice.id ?? '(no-id)'
	});
	if (!clientRow) return;

	logInfo('directadmin', 'invoice.paid received', {
		tenantId: clientRow.tenantId,
		metadata: {
			stripeInvoiceId: invoice.id,
			clientId: clientRow.id,
			// PII redaction: nu logăm amount/currency în logger general (vezi debugLog
			// dacă vrei detalii, e tabel intern redactat).
			amount: '[redacted]',
			currency: '[redacted]'
		}
	});

	// TODO Sprint 8.2: creează CRM invoice + push Keez fiscal.
	// Wiring-ul va folosi src/lib/server/stripe/post-payment/emit-keez-invoice.ts
	// odată ce designul Keez line-items e finalizat (vezi memorie:
	// project_keez_400_for_missing_invoice + feedback_keez_push_no_overwrite).
}

export async function handlePaymentFailed(invoice: Stripe.Invoice) {
	const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
	if (!customerId) return;

	const expectedTenantId = invoice.metadata?.crmTenantId ?? null;
	const clientRow = await resolveClientByStripeCustomer(customerId, expectedTenantId, {
		eventType: 'invoice.payment_failed',
		eventId: invoice.id ?? '(no-id)'
	});
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
	const expectedTenantId = subscription.metadata?.crmTenantId ?? null;
	const clientRow = await resolveClientByStripeCustomer(customerId, expectedTenantId, {
		eventType: 'customer.subscription.deleted',
		eventId: subscription.id
	});
	if (!clientRow) return;

	logInfo('directadmin', 'subscription canceled', {
		tenantId: clientRow.tenantId,
		metadata: { stripeSubscriptionId: subscription.id, clientId: clientRow.id }
	});

	// Suspend toate hostingAccount-uri legate la acest subscription.
	const linkedAccounts = await db
		.select({
			id: table.hostingAccount.id,
			daUsername: table.hostingAccount.daUsername,
			daServerId: table.hostingAccount.daServerId,
			status: table.hostingAccount.status
		})
		.from(table.hostingAccount)
		.where(
			and(
				eq(table.hostingAccount.tenantId, clientRow.tenantId),
				eq(table.hostingAccount.clientId, clientRow.id),
				eq(table.hostingAccount.stripeSubscriptionId, subscription.id)
			)
		);

	if (linkedAccounts.length === 0) {
		logWarning('directadmin', 'subscription deleted dar 0 hostingAccount legate', {
			tenantId: clientRow.tenantId,
			metadata: { stripeSubscriptionId: subscription.id, clientId: clientRow.id }
		});
		return;
	}

	// Import dinamic ca să evităm bundle leak în non-Stripe paths.
	const { createDAClient } = await import('$lib/server/plugins/directadmin/factory');
	const { withAccountLock, runWithAudit } = await import(
		'$lib/server/plugins/directadmin/audit'
	);

	for (const acc of linkedAccounts) {
		if (acc.status === 'suspended') continue;
		try {
			const [server] = await db
				.select()
				.from(table.daServer)
				.where(eq(table.daServer.id, acc.daServerId))
				.limit(1);
			if (!server) {
				logError('directadmin', 'daServer dispărut — suspend skipped', {
					tenantId: clientRow.tenantId,
					metadata: { hostingAccountId: acc.id, daServerId: acc.daServerId }
				});
				continue;
			}
			const daClient = createDAClient(clientRow.tenantId, server);
			await withAccountLock(`${clientRow.tenantId}:${acc.daUsername}`, async () => {
				await runWithAudit(
					{
						tenantId: clientRow.tenantId,
						hostingAccountId: acc.id,
						daServerId: acc.daServerId,
						action: 'suspend',
						trigger: 'hook:invoice.status.changed'
					},
					() => daClient.suspendUser(acc.daUsername)
				);
				await db
					.update(table.hostingAccount)
					.set({
						status: 'suspended',
						suspendReason: 'subscription_canceled',
						updatedAt: new Date()
					})
					.where(eq(table.hostingAccount.id, acc.id));
			});
			logInfo('directadmin', `hostingAccount ${acc.daUsername} suspended (sub canceled)`, {
				tenantId: clientRow.tenantId,
				metadata: { hostingAccountId: acc.id, stripeSubscriptionId: subscription.id }
			});
		} catch (err) {
			const { message } = serializeError(err);
			logError('directadmin', `Eșec suspend hostingAccount pe sub canceled: ${message}`, {
				tenantId: clientRow.tenantId,
				metadata: { hostingAccountId: acc.id, daUsername: acc.daUsername }
			});
		}
	}
}

export async function handleCheckoutSessionExpired(session: Stripe.Checkout.Session) {
	const md = session.metadata ?? {};
	const tenantId = md.crmTenantId;
	const inquiryId = md.crmHostingInquiryId;
	if (!tenantId || !inquiryId) return;

	await db
		.update(table.hostingInquiry)
		.set({ status: 'abandoned', updatedAt: new Date() })
		.where(
			and(eq(table.hostingInquiry.id, inquiryId), eq(table.hostingInquiry.tenantId, tenantId))
		);

	logInfo('directadmin', 'checkout.session.expired — inquiry marked abandoned', {
		tenantId,
		metadata: { sessionId: session.id, inquiryId }
	});
}

export async function handlePaymentIntentFailed(intent: Stripe.PaymentIntent) {
	const expectedTenantId = intent.metadata?.crmTenantId ?? null;
	const inquiryId = intent.metadata?.crmHostingInquiryId ?? null;
	const clientId = intent.metadata?.crmClientId ?? null;
	if (!expectedTenantId || !inquiryId) {
		logWarning('directadmin', 'payment_intent.payment_failed fără metadata CRM', {
			metadata: { intentId: intent.id }
		});
		return;
	}

	logError('directadmin', 'payment_intent.payment_failed — staff intervention', {
		tenantId: expectedTenantId,
		metadata: {
			intentId: intent.id,
			inquiryId,
			clientId,
			failureCode: intent.last_payment_error?.code ?? null,
			failureMessage: intent.last_payment_error?.message ?? null
		}
	});
}

export async function handleChargeRefunded(charge: Stripe.Charge) {
	const paymentIntentId =
		typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
	if (!paymentIntentId) return;

	const [invoiceRow] = await db
		.select({ id: table.invoice.id, tenantId: table.invoice.tenantId, status: table.invoice.status })
		.from(table.invoice)
		.where(eq(table.invoice.stripePaymentIntentId, paymentIntentId))
		.limit(1);

	if (!invoiceRow) {
		logWarning('directadmin', 'charge.refunded: nu găsim CRM invoice', {
			metadata: { paymentIntentId, chargeId: charge.id }
		});
		return;
	}

	const fullyRefunded = charge.amount_refunded >= charge.amount;
	await db
		.update(table.invoice)
		.set({
			status: fullyRefunded ? 'refunded' : invoiceRow.status,
			updatedAt: new Date()
		})
		.where(eq(table.invoice.id, invoiceRow.id));

	logInfo('directadmin', `charge.refunded — invoice ${fullyRefunded ? 'fully' : 'partially'} refunded`, {
		tenantId: invoiceRow.tenantId,
		metadata: { invoiceId: invoiceRow.id, chargeId: charge.id, paymentIntentId }
	});
}

export async function handleChargeDisputeCreated(dispute: Stripe.Dispute) {
	const paymentIntentId =
		typeof dispute.payment_intent === 'string'
			? dispute.payment_intent
			: dispute.payment_intent?.id;
	if (!paymentIntentId) return;

	const [invoiceRow] = await db
		.select({ id: table.invoice.id, tenantId: table.invoice.tenantId })
		.from(table.invoice)
		.where(eq(table.invoice.stripePaymentIntentId, paymentIntentId))
		.limit(1);

	logError('directadmin', `charge.dispute.created — URGENT staff action needed`, {
		tenantId: invoiceRow?.tenantId ?? null,
		metadata: {
			disputeId: dispute.id,
			paymentIntentId,
			reason: dispute.reason,
			invoiceId: invoiceRow?.id ?? null
		}
	});
	// TODO: trigger email staff URGENT (template nou); pentru moment, log only.
}

export async function handleCustomerUpdated(customer: Stripe.Customer) {
	// Sync înapoi în CRM doar dacă admin a editat direct în Stripe Dashboard.
	// Best practice: editările vin din CRM și se propagă spre Stripe, nu invers.
	const [clientRow] = await db
		.select({ id: table.client.id, tenantId: table.client.tenantId, email: table.client.email })
		.from(table.client)
		.where(eq(table.client.stripeCustomerId, customer.id))
		.limit(1);
	if (!clientRow) return;

	logWarning('directadmin', 'customer.updated — manual edit detectat în Stripe Dashboard', {
		tenantId: clientRow.tenantId,
		metadata: {
			stripeCustomerId: customer.id,
			clientId: clientRow.id,
			crmEmail: '[redacted]',
			stripeEmail: customer.email ? '[present]' : '[absent]'
		}
	});
	// Nu rescriem automat CRM-ul — lăsăm staff să decidă. Log e suficient pentru audit.
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
			case 'checkout.session.expired':
				await handleCheckoutSessionExpired(event.data.object as Stripe.Checkout.Session);
				return 'handled';
			case 'invoice.paid':
			case 'invoice.payment_succeeded':
				await handleInvoicePaid(event.data.object as Stripe.Invoice);
				return 'handled';
			case 'invoice.payment_failed':
				await handlePaymentFailed(event.data.object as Stripe.Invoice);
				return 'handled';
			case 'payment_intent.payment_failed':
				await handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent);
				return 'handled';
			case 'customer.subscription.deleted':
				await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
				return 'handled';
			case 'charge.refunded':
				await handleChargeRefunded(event.data.object as Stripe.Charge);
				return 'handled';
			case 'charge.dispute.created':
				await handleChargeDisputeCreated(event.data.object as Stripe.Dispute);
				return 'handled';
			case 'customer.updated':
				await handleCustomerUpdated(event.data.object as Stripe.Customer);
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
