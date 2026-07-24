import type Stripe from 'stripe';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { hostingAccount } from '$lib/server/db/schema';
import { eq, and, or, ne, isNotNull } from 'drizzle-orm';
import { logInfo, logError, logWarning, serializeError } from '$lib/server/logger';
import { runPostPaymentSteps } from './post-payment/dispatcher';
import { emitKeezFiscalInvoice } from './post-payment/emit-keez-invoice';
import { notifyHostingPaymentFailed } from '$lib/server/hosting/notifications';
import { handleStripeInvoicePayment } from './invoice-payment';
import { translateDeclineCode } from './decline-codes';
import { getStripeForTenant } from '$lib/server/plugins/stripe/factory';
import { createDAClient } from '$lib/server/plugins/directadmin/factory';
import { runWithAudit, withAccountLock } from '$lib/server/plugins/directadmin/audit';

/**
 * Resolve the PaymentIntent id from an Invoice across Stripe API shapes.
 * Dahlia (2026-04-22) moved the reference under `payments.data[].payment.
 * payment_intent`; older versions expose top-level `payment_intent`. Used as the
 * idempotency key when emitting renewal fiscal invoices (audit C2).
 */
function resolveInvoicePaymentIntentId(invoice: Stripe.Invoice): string | null {
	type InvoicePayment = { payment?: { payment_intent?: string | { id: string } | null } | null };
	const ext = invoice as Stripe.Invoice & {
		payment_intent?: string | { id: string } | null;
		payments?: { data?: InvoicePayment[] } | null;
	};
	if (ext.payment_intent) {
		return typeof ext.payment_intent === 'string' ? ext.payment_intent : ext.payment_intent.id;
	}
	const pi = ext.payments?.data?.[0]?.payment?.payment_intent;
	if (pi) return typeof pi === 'string' ? pi : pi.id;
	return null;
}

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

	// Pay-an-EXISTING-invoice flow (renewal / overdue), isolated from the new-order
	// pipeline via `crmPurpose`. The CRM invoice + its Keez fiscal invoice already
	// exist, so we ONLY mark the invoice paid — no DA provisioning, no Keez emit
	// (both would double up). Hosted Checkout link path (admin pay-link endpoint).
	if (md.crmPurpose === 'invoice_payment') {
		if (!md.crmTenantId || !md.crmInvoiceId) {
			logError('directadmin', 'checkout.session.completed invoice_payment fără crmTenantId/crmInvoiceId', {
				metadata: { sessionId: session.id }
			});
			return;
		}
		const piId =
			typeof session.payment_intent === 'string'
				? session.payment_intent
				: session.payment_intent?.id ?? null;
		await handleStripeInvoicePayment({
			tenantId: md.crmTenantId,
			invoiceId: md.crmInvoiceId,
			paymentIntentId: piId,
			paidAmountCents: session.amount_total ?? null,
			eventLabel: 'checkout.session.completed'
		});
		return;
	}

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
			// H4 (audit 2026-05-31): mark the paying client `active`, but DON'T set
			// onboardingStatus:'active' here — the post-payment dispatcher promotes it
			// only AFTER DA provisioning succeeds, so a provisioning failure no longer
			// leaves the customer flagged "onboarded" with no hosting account.
			.set({ status: 'active', updatedAt: new Date() })
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

/**
 * Subscription RENEWAL fiscal invoice emission (audit C2).
 *
 * Triggered by `invoice.payment_succeeded` (dispatched ONLY for that event —
 * `invoice.paid` is a synonym Stripe sends for the same payment, so routing both
 * here would double-emit; the dispatcher acks `invoice.paid` separately).
 *
 * Scope:
 *  - ONLY `billing_reason === 'subscription_cycle'` (renewals). The FIRST invoice
 *    (`subscription_create`) is already emitted by payment_intent.succeeded →
 *    dispatcher → emitKeezFiscalInvoice, so emitting here too would double-bill.
 *  - Idempotent: emitKeezFiscalInvoice dedups on the renewal's PaymentIntent id
 *    (a webhook redelivery finds the existing invoice and skips).
 *
 * Errors are swallowed (logged) so a Keez hiccup never 500s the webhook and
 * triggers a Stripe retry storm — the renewal charge already settled; staff can
 * re-push from /invoices.
 */
export async function handleInvoicePaid(invoice: Stripe.Invoice) {
	const billingReason = invoice.billing_reason;
	if (billingReason !== 'subscription_cycle') {
		// First invoice + manual/one-off invoices are emitted elsewhere (or not at all).
		logInfo('directadmin', `invoice.payment_succeeded skip (billing_reason=${billingReason ?? 'null'})`, {
			metadata: { stripeInvoiceId: invoice.id, billingReason }
		});
		return;
	}

	const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
	if (!customerId) return;

	const expectedTenantId = invoice.metadata?.crmTenantId ?? null;
	const clientRow = await resolveClientByStripeCustomer(customerId, expectedTenantId, {
		eventType: 'invoice.payment_succeeded',
		eventId: invoice.id ?? '(no-id)'
	});
	if (!clientRow) return;

	// Resolve subscription id (dahlia: parent.subscription_details.subscription).
	const legacySub = (invoice as unknown as { subscription?: string | { id: string } | null })
		.subscription;
	const subRaw = invoice.parent?.subscription_details?.subscription ?? legacySub ?? null;
	const subscriptionId = typeof subRaw === 'string' ? subRaw : subRaw?.id ?? null;
	if (!subscriptionId) {
		logWarning('directadmin', 'invoice renewal without subscription id — skip', {
			tenantId: clientRow.tenantId,
			metadata: { stripeInvoiceId: invoice.id }
		});
		return;
	}

	// Idempotency key for the Keez emitter — must be stable across webhook
	// redelivery + the invoice.paid/invoice.payment_succeeded synonym pair.
	const renewalPiId = resolveInvoicePaymentIntentId(invoice);
	if (!renewalPiId) {
		logError(
			'keez',
			'invoice renewal — could not resolve PaymentIntent; renewal invoice NOT auto-emitted',
			{ tenantId: clientRow.tenantId, metadata: { stripeInvoiceId: invoice.id, subscriptionId } }
		);
		return;
	}

	// Resolve productId: prefer metadata stamped at first emission, else the
	// hosting_account linked to this subscription.
	let productId = (invoice.metadata?.crmHostingProductId as string | undefined) ?? null;
	if (!productId) {
		try {
			const stripe = await getStripeForTenant(clientRow.tenantId);
			const sub = await stripe.subscriptions.retrieve(subscriptionId);
			productId = (sub.metadata?.crmHostingProductId as string | undefined) ?? null;
		} catch (err) {
			logWarning('directadmin', `invoice renewal — subscription retrieve failed: ${serializeError(err).message}`, {
				tenantId: clientRow.tenantId,
				metadata: { subscriptionId }
			});
		}
	}
	if (!productId) {
		const [acc] = await db
			.select({ hostingProductId: hostingAccount.hostingProductId })
			.from(hostingAccount)
			.where(
				and(
					eq(hostingAccount.tenantId, clientRow.tenantId),
					eq(hostingAccount.stripeSubscriptionId, subscriptionId)
				)
			)
			.limit(1);
		productId = acc?.hostingProductId ?? null;
	}
	if (!productId) {
		logError('keez', 'invoice renewal — cannot resolve productId; renewal invoice NOT emitted', {
			tenantId: clientRow.tenantId,
			metadata: { stripeInvoiceId: invoice.id, subscriptionId }
		});
		return;
	}

	logInfo('directadmin', 'invoice renewal (subscription_cycle) — emitting Keez fiscal invoice', {
		tenantId: clientRow.tenantId,
		metadata: { stripeInvoiceId: invoice.id, subscriptionId, productId, clientId: clientRow.id }
	});

	try {
		const result = await emitKeezFiscalInvoice({
			tenantId: clientRow.tenantId,
			clientId: clientRow.id,
			sessionId: invoice.id ?? renewalPiId,
			stripePaymentIntentId: renewalPiId,
			stripeSubscriptionId: subscriptionId,
			productId
		});
		logInfo(
			'keez',
			`invoice renewal → ${'skipped' in result ? `skipped:${result.reason}` : `invoice ${result.invoiceNumber}`}`,
			{
				tenantId: clientRow.tenantId,
				metadata: {
					stripeInvoiceId: invoice.id,
					outcome: 'skipped' in result ? result.reason : result.invoiceId
				}
			}
		);
	} catch (err) {
		logError('keez', `invoice renewal emit threw: ${serializeError(err).message}`, {
			tenantId: clientRow.tenantId,
			metadata: { stripeInvoiceId: invoice.id, subscriptionId, productId }
		});
	}
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

	// Pay-an-EXISTING-invoice flow (embedded PaymentElement, portal renew page).
	// Same isolation as the Checkout branch — mark invoice paid, skip provisioning
	// + Keez emission (both already exist for a renewal/overdue invoice).
	if (md.crmPurpose === 'invoice_payment') {
		if (!md.crmTenantId || !md.crmInvoiceId) {
			logError('directadmin', 'payment_intent.succeeded invoice_payment fără crmTenantId/crmInvoiceId', {
				metadata: { intentId: intent.id }
			});
			return;
		}
		await handleStripeInvoicePayment({
			tenantId: md.crmTenantId,
			invoiceId: md.crmInvoiceId,
			paymentIntentId: intent.id,
			paidAmountCents: intent.amount ?? null,
			eventLabel: 'payment_intent.succeeded'
		});
		return;
	}

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
			// H4 (audit 2026-05-31): mark the paying client `active`, but DON'T set
			// onboardingStatus:'active' here — the post-payment dispatcher promotes it
			// only AFTER DA provisioning succeeds, so a provisioning failure no longer
			// leaves the customer flagged "onboarded" with no hosting account.
			.set({ status: 'active', updatedAt: new Date() })
			.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, tenantId)));

		await tx
			.update(table.hostingInquiry)
			.set({
				status: 'converted',
				contactedAt: new Date(),
				updatedAt: new Date(),
				paymentStatus: 'paid',
				paidAt: new Date().toISOString(),
				// M1 (audit 2026-05-31): `intent.amount` is now the GROSS amount
				// (net + VAT) — C1 made the PaymentIntent charge the gross — so this
				// reconciles 1:1 with the Keez invoice `totalAmount`. (Before C1 it
				// stored only the net and diverged from the fiscal invoice.)
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

/**
 * Suspend the DirectAdmin hosting account(s) tied to a reversed Stripe payment
 * (audit H3: full refund or dispute). Mirrors the overdue-invoice suspend path
 * in directadmin/hooks.ts — per-account lock → audited DA `suspendUser` → DB
 * flip to `status:'suspended'`. Best-effort + idempotent: an already
 * suspended/terminated account is skipped, and a webhook redelivery re-runs
 * harmlessly.
 *
 * Account resolution — the Stripe-emitted CRM invoice carries no
 * `hostingAccountId`, so we link via two paths:
 *   1. subscription id → `hostingAccount.stripeSubscriptionId` (recurring orders)
 *   2. the hosting inquiry whose `paymentReference` == this PaymentIntent →
 *      `hostingAccountId` (one-time orders + the first charge of a subscription)
 */
async function suspendHostingForChargeReversal(params: {
	tenantId: string;
	paymentIntentId: string;
	subscriptionId: string | null;
	reason: string;
	logLabel: string;
}): Promise<void> {
	const { tenantId, paymentIntentId, subscriptionId, reason, logLabel } = params;
	const ids = new Set<string>();

	if (subscriptionId) {
		const subRows = await db
			.select({ id: hostingAccount.id })
			.from(hostingAccount)
			.where(
				and(
					eq(hostingAccount.tenantId, tenantId),
					eq(hostingAccount.stripeSubscriptionId, subscriptionId)
				)
			);
		subRows.forEach((r) => ids.add(r.id));
	}

	const inqRows = await db
		.select({ hostingAccountId: table.hostingInquiry.hostingAccountId })
		.from(table.hostingInquiry)
		.where(
			and(
				eq(table.hostingInquiry.tenantId, tenantId),
				eq(table.hostingInquiry.paymentReference, paymentIntentId),
				isNotNull(table.hostingInquiry.hostingAccountId)
			)
		);
	inqRows.forEach((r) => {
		if (r.hostingAccountId) ids.add(r.hostingAccountId);
	});

	if (ids.size === 0) {
		logWarning('directadmin', `${logLabel}: no hosting account linked — nothing to suspend`, {
			tenantId,
			metadata: { paymentIntentId, subscriptionId }
		});
		return;
	}

	for (const accountId of ids) {
		const [account] = await db
			.select({
				id: hostingAccount.id,
				daUsername: hostingAccount.daUsername,
				daServerId: hostingAccount.daServerId,
				status: hostingAccount.status
			})
			.from(hostingAccount)
			.where(and(eq(hostingAccount.id, accountId), eq(hostingAccount.tenantId, tenantId)))
			.limit(1);
		if (!account) continue;

		// Idempotent: only suspend a live account. suspended/terminated/cancelled
		// → leave as-is (a webhook redelivery or a manual prior suspend).
		if (account.status !== 'active' && account.status !== 'pending') {
			logInfo('directadmin', `${logLabel}: account ${account.daUsername} already ${account.status} — skip`, {
				tenantId,
				metadata: { accountId }
			});
			continue;
		}

		const [server] = await db
			.select()
			.from(table.daServer)
			.where(and(eq(table.daServer.id, account.daServerId), eq(table.daServer.tenantId, tenantId)))
			.limit(1);
		if (!server) {
			logError('directadmin', `${logLabel}: cannot suspend ${account.daUsername} — server row missing`, {
				tenantId,
				metadata: { accountId }
			});
			continue;
		}

		await withAccountLock(`${tenantId}:${account.daUsername}`, async () => {
			try {
				await runWithAudit(
					{
						tenantId,
						hostingAccountId: account.id,
						daServerId: account.daServerId,
						action: 'suspend',
						trigger: 'stripe-webhook'
					},
					async () => {
						const daClient = createDAClient(tenantId, server);
						// External DA call first (no rollback after this point), then DB flip.
						await daClient.suspendUser(account.daUsername);
						await db
							.update(hostingAccount)
							.set({
								status: 'suspended',
								suspendReason: reason,
								suspendedAt: new Date(),
								reactivatedAt: null,
								updatedAt: new Date()
							})
							.where(eq(hostingAccount.id, account.id));
					}
				);
				logInfo('directadmin', `${logLabel}: suspended ${account.daUsername}`, {
					tenantId,
					metadata: { accountId, reason }
				});
			} catch (err) {
				logError(
					'directadmin',
					`${logLabel}: suspend failed for ${account.daUsername}: ${serializeError(err).message}`,
					{ tenantId, metadata: { accountId } }
				);
			}
		});
	}
}

export async function handleChargeRefunded(charge: Stripe.Charge) {
	const paymentIntentId =
		typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
	if (!paymentIntentId) return;

	const [invoiceRow] = await db
		.select({
			id: table.invoice.id,
			tenantId: table.invoice.tenantId,
			status: table.invoice.status,
			stripeSubscriptionId: table.invoice.stripeSubscriptionId
		})
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

	// H3 (audit 2026-05-31): a FULL refund means the customer got their money
	// back — they must not keep an active hosting account. Suspend (reversible,
	// NEVER delete) the linked DA account(s). Partial refunds leave hosting up.
	if (fullyRefunded) {
		await suspendHostingForChargeReversal({
			tenantId: invoiceRow.tenantId,
			paymentIntentId,
			subscriptionId: invoiceRow.stripeSubscriptionId ?? null,
			reason: `Refund Stripe (charge ${charge.id})`,
			logLabel: 'charge.refunded'
		});
	}
}

export async function handleChargeDisputeCreated(dispute: Stripe.Dispute) {
	const paymentIntentId =
		typeof dispute.payment_intent === 'string'
			? dispute.payment_intent
			: dispute.payment_intent?.id;
	if (!paymentIntentId) return;

	const [invoiceRow] = await db
		.select({
			id: table.invoice.id,
			tenantId: table.invoice.tenantId,
			stripeSubscriptionId: table.invoice.stripeSubscriptionId
		})
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

	// H3 (audit 2026-05-31): a dispute (chargeback) means the funds are held /
	// being clawed back. Suspend the linked DA account(s) immediately — keeping
	// hosting live for a customer who disputed the charge is direct loss. Suspend
	// is reversible: if the dispute is later won, staff unsuspend from the panel.
	// Needs a resolved tenant — disputes carry no `customer`, so the webhook route
	// resolves the tenant via PaymentIntent → invoice before this runs.
	if (invoiceRow) {
		await suspendHostingForChargeReversal({
			tenantId: invoiceRow.tenantId,
			paymentIntentId,
			subscriptionId: invoiceRow.stripeSubscriptionId ?? null,
			reason: `Dispute Stripe (${dispute.reason ?? 'unknown'} · ${dispute.id})`,
			logLabel: 'charge.dispute.created'
		});
	} else {
		logWarning('directadmin', 'charge.dispute.created — no CRM invoice for PI, cannot auto-suspend', {
			tenantId: null,
			metadata: { disputeId: dispute.id, paymentIntentId }
		});
	}
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
				// Synonym Stripe sends for the same successful payment. We emit the
				// renewal fiscal invoice ONLY on invoice.payment_succeeded to avoid a
				// double Keez invoice for one renewal (audit C2). Ack this one.
				logInfo('directadmin', 'invoice.paid received (renewal handled via invoice.payment_succeeded)', {
					metadata: { eventId: event.id }
				});
				return 'handled';
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
