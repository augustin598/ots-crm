import type Stripe from 'stripe';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { hostingAccount } from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { logInfo, logError, logWarning, serializeError } from '$lib/server/logger';
import { runPostPaymentSteps } from './post-payment/dispatcher';
import { notifyHostingPaymentFailed } from '$lib/server/hosting/notifications';
import { translateDeclineCode } from './decline-codes';
import { getStripeForTenant } from '$lib/server/plugins/stripe/factory';

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
	const paidAmountCents = session.amount_total ?? null;
	const paymentReference =
		typeof session.payment_intent === 'string'
			? session.payment_intent
			: session.payment_intent?.id ?? session.id;
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
				updatedAt: new Date(),
				paymentStatus: 'paid',
				paidAt: new Date().toISOString(),
				paidAmountCents,
				paymentReference
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

	// Keep the existing admin/ops log line — it serves a different audience than
	// the customer email (the staff observability channel). Customer email is
	// dispatched separately below via notifyHostingPaymentFailed.
	logError('directadmin', 'invoice.payment_failed — staff intervention needed', {
		tenantId: clientRow.tenantId,
		metadata: {
			stripeInvoiceId: invoice.id,
			clientId: clientRow.id,
			attemptCount: invoice.attempt_count,
			nextRetryAt: invoice.next_payment_attempt
		}
	});

	// Resolve subscription id from the failing invoice. One-off invoices have no
	// subscription — nothing to notify about (no hosting account is linked).
	//
	// Stripe API ≥2025 moved the subscription link onto `invoice.parent.
	// subscription_details.subscription` (the legacy top-level `invoice.subscription`
	// is gone from the SDK types). We check both shapes defensively so the handler
	// also works against older test fixtures or backwards-compat webhook payloads.
	const legacy = (invoice as unknown as { subscription?: string | { id: string } | null })
		.subscription;
	const subRaw =
		invoice.parent?.subscription_details?.subscription ?? legacy ?? null;
	const subscriptionId =
		typeof subRaw === 'string' ? subRaw : subRaw?.id ?? null;
	if (!subscriptionId) return;

	// Find the hosting account linked to this subscription. Tenant-scoped to
	// stop a Stripe customer from accidentally addressing another tenant's
	// account if `metadata.crmTenantId` is ever absent (defense-in-depth — the
	// resolveClientByStripeCustomer check above already covers the happy path).
	const [account] = await db
		.select({ id: hostingAccount.id, tenantId: hostingAccount.tenantId })
		.from(hostingAccount)
		.where(
			and(
				eq(hostingAccount.tenantId, clientRow.tenantId),
				eq(hostingAccount.stripeSubscriptionId, subscriptionId)
			)
		)
		.limit(1);
	if (!account) {
		// Subscription exists but no hosting account linked — likely a
		// misconfiguration (subscription created without DA provisioning, or
		// account row deleted while subscription is still active). Log so ops
		// can investigate "why didn't this customer get a payment-failed email?"
		logInfo('directadmin', 'invoice.payment_failed — no hosting account linked to subscription', {
			tenantId: clientRow.tenantId,
			metadata: {
				stripeInvoiceId: invoice.id,
				subscriptionId,
				clientId: clientRow.id
			}
		});
		return;
	}

	// Resolve the CRM-internal invoice id from Stripe metadata. Convention is
	// `crmInvoiceId` (see post-payment/emit-keez-invoice.ts where we stamp it
	// onto the Stripe invoice metadata at creation time). Without it we can't
	// build the customer's pay URL or look up the invoice row in our schema.
	const internalInvoiceId = invoice.metadata?.crmInvoiceId ?? null;
	if (!internalInvoiceId) {
		logWarning('directadmin', 'invoice.payment_failed — missing crmInvoiceId metadata', {
			tenantId: clientRow.tenantId,
			metadata: { stripeInvoiceId: invoice.id, subscriptionId, clientId: clientRow.id }
		});
		return;
	}

	// Compute a human-readable failure reason. Stripe surfaces this in several
	// places depending on whether it's a card decline (charges[].failure_message)
	// or a SCA / 3DS / finalization issue (last_finalization_error.message).
	// Fall back to a generic Romanian phrase so the template never renders blank.
	const failureReason =
		invoice.last_finalization_error?.message ??
		(invoice as unknown as { charges?: { data?: Array<{ failure_message?: string | null }> } })
			.charges?.data?.[0]?.failure_message ??
		'plată eșuată';

	// Fire the customer notify. Errors are caught + logged here so a notify
	// failure doesn't bubble up and mark the webhook event as `failed` (the
	// existing admin log already surfaces the underlying Stripe failure for
	// staff intervention). `hosted_invoice_url` from Stripe is the canonical
	// "update card / pay invoice" portal link.
	await notifyHostingPaymentFailed(
		clientRow.tenantId,
		account.id,
		internalInvoiceId,
		failureReason,
		invoice.hosted_invoice_url ?? undefined
	).catch((err) => {
		logError('hosting-email', 'payment-failed notify failed', {
			tenantId: clientRow.tenantId,
			metadata: {
				stripeInvoiceId: invoice.id,
				internalInvoiceId,
				error: err instanceof Error ? err.message : String(err)
			}
		});
	});
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

/**
 * Embedded Stripe Elements flow (PaymentIntent / Subscription default_incomplete)
 * surfaces success via `payment_intent.succeeded` — NOT via
 * `checkout.session.completed`. Mirror the checkout completion logic so the
 * client + inquiry transitions to active and the post-payment pipeline runs.
 *
 * Idempotency: `processed_stripe_event` already gates duplicate event delivery;
 * `post_payment_step` is unique on (stripe_session_id, step). We pass the
 * PaymentIntent id as `sessionId` — same dispatcher, separate key space from
 * Checkout Session ids.
 *
 * For subscription flow (default_incomplete), `invoice.payment_succeeded` also
 * fires. The existing `handleInvoicePaid` only logs (no post-payment run), so
 * there is no double-fire risk.
 */
export async function handlePaymentIntentSucceeded(intent: Stripe.PaymentIntent) {
	const md = intent.metadata ?? {};
	const tenantId = md.crmTenantId;
	const clientId = md.crmClientId;
	const inquiryId = md.crmHostingInquiryId;
	const productId = md.crmHostingProductId;

	if (!tenantId || !clientId || !inquiryId || !productId) {
		logWarning('directadmin', 'payment_intent.succeeded fără metadata CRM — ignorat', {
			metadata: { intentId: intent.id, hasMetadata: !!intent.metadata }
		});
		return;
	}

	logInfo('directadmin', '[CHECKOUT][webhook] payment_intent.succeeded received (embedded flow)', {
		tenantId,
		metadata: {
			intentId: intent.id,
			clientId,
			inquiryId,
			productId,
			amount: intent.amount,
			currency: intent.currency,
			subscriptionId: md.crmSubscriptionId ?? null
		}
	});

	// Extract card last4 from the latest charge. Stripe sends `latest_charge` as a
	// string ID on PaymentIntent webhook payloads by default; if expanded (e.g.
	// from a manual sync via paymentIntents.retrieve), it can be an object. We
	// handle both shapes and fall back to a one-shot retrieve when only an id is
	// present so we capture last4 on the first webhook delivery.
	let cardLast4: string | null = null;
	try {
		if (intent.latest_charge && typeof intent.latest_charge === 'object') {
			cardLast4 =
				(intent.latest_charge as Stripe.Charge).payment_method_details?.card?.last4 ?? null;
		} else if (typeof intent.latest_charge === 'string') {
			const stripe = await getStripeForTenant(tenantId);
			const ch = await stripe.charges.retrieve(intent.latest_charge);
			cardLast4 = ch.payment_method_details?.card?.last4 ?? null;
		}
	} catch (err) {
		// Non-fatal — we still mark the inquiry paid even if last4 lookup fails.
		logWarning('directadmin', 'payment_intent.succeeded — could not extract card last4', {
			tenantId,
			metadata: { intentId: intent.id, error: serializeError(err) }
		});
	}

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
				updatedAt: new Date(),
				paymentStatus: 'paid',
				paidAt: new Date().toISOString(),
				paidAmountCents: intent.amount ?? null,
				paymentReference: intent.id,
				cardLast4
			})
			.where(
				and(eq(table.hostingInquiry.id, inquiryId), eq(table.hostingInquiry.tenantId, tenantId))
			);
	});

	// Subscription embedded flow: we stamp `crmSubscriptionId` on the PaymentIntent
	// metadata server-side so we don't need to expand `invoice` on the event payload
	// (the property isn't on Stripe's typed PaymentIntent and the alternative is an
	// extra API round-trip). Provisioning uses it to wire
	// `hostingAccount.stripeSubscriptionId` for later cancel-on-sub-deleted.
	const stripeSubscriptionId = md.crmSubscriptionId ?? null;

	await runPostPaymentSteps({
		tenantId,
		clientId,
		inquiryId,
		productId,
		sessionId: intent.id,
		mode: stripeSubscriptionId ? 'subscription' : 'payment',
		stripeCustomerId:
			typeof intent.customer === 'string' ? intent.customer : intent.customer?.id ?? null,
		stripeSubscriptionId,
		stripePaymentIntentId: intent.id
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

	// Persist decline code + Romanian-translated message so the admin Comenzi
	// hosting drawer can render a friendly red banner ("Card refuzat de bancă ·
	// cod 51") instead of forcing staff to translate Stripe's English error.
	const err = intent.last_payment_error;
	const code = err?.decline_code ?? err?.code ?? null;
	const message = translateDeclineCode(code, err?.message ?? null);

	// Mark the inquiry payment status failed so the Comenzi hosting admin page
	// can surface it with a "Plată eșuată" pill and offer a manual accept path
	// (e.g. the customer pays via OP after a card decline).
	await db
		.update(table.hostingInquiry)
		.set({
			paymentStatus: 'failed',
			paymentErrorCode: code,
			paymentErrorMessage: message,
			updatedAt: new Date()
		})
		.where(
			and(eq(table.hostingInquiry.id, inquiryId), eq(table.hostingInquiry.tenantId, expectedTenantId))
		);
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
			case 'payment_intent.succeeded':
				await handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent);
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
