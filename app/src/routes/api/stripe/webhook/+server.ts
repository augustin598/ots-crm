import type { RequestHandler } from './$types';
import { dispatchStripeEvent } from '$lib/server/stripe/webhook-handlers';
import { getWebhookSecretForTenant } from '$lib/server/plugins/stripe/factory';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { logInfo, logError, logWarning, serializeError } from '$lib/server/logger';
import Stripe from 'stripe';

/**
 * Stripe webhook — per-tenant signature verification (Sprint 9) + idempotency
 * lifecycle (audit hardening).
 *
 * Flow:
 *  1. Parse body fără verify (doar JSON.parse) ca să extragem `metadata.crmTenantId`.
 *  2. Fetch webhook secret encrypted din `stripe_integration` (sau fallback env).
 *  3. Verify signature cu secret-ul tenant-ului.
 *  4. Idempotency claim: INSERT/UPDATE `processed_stripe_event` cu status
 *     'processing'. Status lifecycle 'processing' → 'completed' | 'failed' (NU
 *     mai facem DELETE-on-fail care era racey între retry-urile Stripe).
 *  5. Dispatch handler → marchează 'completed' sau 'failed'.
 *
 * **Critical**:
 *  - Body raw — NU JSON.parse pe payload-ul original. Folosim `text()` apoi
 *    `JSON.parse` doar pentru tenantId extract; signature verify se face pe RAW.
 *  - Endpoint MUST be public (no auth middleware). Auth = Stripe signature.
 *  - Pentru Stripe Connect events, `event.account` ar fi sursa pentru tenantId
 *    mapping; aici folosim metadata pentru Direct accounts pattern.
 */

export const POST: RequestHandler = async ({ request }) => {
	const signature = request.headers.get('stripe-signature');
	if (!signature) return new Response('Missing stripe-signature header', { status: 400 });

	const rawBody = await request.text();

	// Step 1: Extract tenantId fără signature verify (doar metadata read).
	let parsedPreview: {
		data?: {
			object?: {
				metadata?: { crmTenantId?: string };
				customer?: string | { id?: string } | null;
				payment_intent?: string | { id?: string } | null;
			};
		};
	} = {};
	try {
		parsedPreview = JSON.parse(rawBody);
	} catch {
		return new Response('Invalid JSON', { status: 400 });
	}
	let tenantId = parsedPreview.data?.object?.metadata?.crmTenantId;

	// Some events don't carry `crmTenantId` on the object metadata — Stripe does
	// NOT copy subscription/PaymentIntent metadata onto renewal invoices, charges
	// (refund), or disputes. Without a fallback these were silently dropped here
	// (200 untenanted), so renewal fiscal invoices + refund/dispute handlers never
	// ran (audit C2 + #45). Resolve the tenant via the Stripe customer → client
	// map. This uses the UNVERIFIED body ONLY to choose which tenant's webhook
	// secret to verify against; a forged body still fails the signature check below.
	if (!tenantId) {
		const obj = parsedPreview.data?.object;
		const customerId = typeof obj?.customer === 'string' ? obj.customer : obj?.customer?.id;
		if (customerId) {
			const [c] = await db
				.select({ tenantId: table.client.tenantId })
				.from(table.client)
				.where(eq(table.client.stripeCustomerId, customerId))
				.limit(1);
			if (c) tenantId = c.tenantId;
		}
	}

	// H3 (audit 2026-05-31): `charge.dispute.created` objects carry NO `customer`
	// field — only `payment_intent`. Without this fallback disputes stayed
	// untenanted (200 + dropped), so the auto-suspend handler never ran. Resolve
	// the tenant via PaymentIntent → CRM invoice. Same trust model as above: this
	// only picks WHICH tenant's webhook secret to verify against; a forged body
	// still fails the signature check below.
	if (!tenantId) {
		const obj = parsedPreview.data?.object;
		const piId =
			typeof obj?.payment_intent === 'string' ? obj.payment_intent : obj?.payment_intent?.id;
		if (piId) {
			const [inv] = await db
				.select({ tenantId: table.invoice.tenantId })
				.from(table.invoice)
				.where(eq(table.invoice.stripePaymentIntentId, piId))
				.limit(1);
			if (inv) tenantId = inv.tenantId;
		}
	}

	if (!tenantId) {
		// Event fără tenant context (ex: account-level events Stripe test) — accept dar log
		logInfo('directadmin', 'Stripe webhook fără tenantId (nici metadata, nici customer-map) — accept dar skip', {});
		return new Response(JSON.stringify({ received: true, untenanted: true }), {
			status: 200,
			headers: { 'content-type': 'application/json' }
		});
	}

	// Step 2: Fetch webhook secret pentru tenant
	const webhookSecret = await getWebhookSecretForTenant(tenantId);
	if (!webhookSecret) {
		logError('directadmin', `Stripe webhook secret nu e configurat pentru tenant ${tenantId}`, {
			tenantId
		});
		return new Response('Tenant webhook nu e configurat', { status: 400 });
	}

	// Step 3: Verify signature
	let event: Stripe.Event;
	try {
		// Use any Stripe instance to verify (webhooks.constructEvent e static-like)
		const stripeForVerify = new Stripe('sk_test_dummy_for_verify_only', { typescript: true });
		event = stripeForVerify.webhooks.constructEvent(rawBody, signature, webhookSecret);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		logError('directadmin', `Webhook signature verification failed for tenant ${tenantId}: ${msg}`, {
			tenantId
		});
		return new Response(`Signature verification failed: ${msg}`, { status: 400 });
	}

	const nowIso = new Date().toISOString();

	// Step 4: Idempotency claim — pattern processing → completed:
	//   - Try INSERT row cu status='processing' + startedAt.
	//   - PRIMARY KEY violation → există row → e duplicate sau retry pe failed:
	//       * 'completed' → 200 duplicate (Stripe oprește retry)
	//       * 'processing' → 409 (Stripe retry-ește mai târziu)
	//       * 'failed' → preluăm retry-ul (UPDATE la 'processing', retryCount++)
	let claimResult: 'fresh' | 'retrying-failed';
	try {
		await db.insert(table.processedStripeEvent).values({
			id: event.id,
			eventType: event.type,
			tenantId,
			status: 'processing',
			startedAt: nowIso
		});
		claimResult = 'fresh';
	} catch {
		const [existing] = await db
			.select({
				status: table.processedStripeEvent.status,
				retryCount: table.processedStripeEvent.retryCount,
				startedAt: table.processedStripeEvent.startedAt
			})
			.from(table.processedStripeEvent)
			.where(eq(table.processedStripeEvent.id, event.id))
			.limit(1);

		if (!existing) {
			logWarning('directadmin', `Webhook claim race: INSERT failed but row absent`, {
				tenantId,
				metadata: { eventId: event.id }
			});
			return new Response(JSON.stringify({ received: true, race: true }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		}

		if (existing.status === 'completed') {
			logInfo('directadmin', `Webhook duplicate event ignored: ${event.type} (${event.id})`, {
				tenantId
			});
			return new Response(JSON.stringify({ received: true, duplicate: true }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		}

		if (existing.status === 'processing') {
			// Recovery pentru worker mort: dacă startedAt > 10 min, tratăm ca abandoned
			// și luăm peste. Fără asta, un kill -9 sau OOM lăsa event-ul "in flight"
			// permanent → toate retry-urile Stripe ulterioare returnau 409 forever.
			const STUCK_THRESHOLD_MS = 10 * 60 * 1000;
			const startedMs = existing.startedAt ? Date.parse(existing.startedAt) : 0;
			const isStuck = startedMs > 0 && Date.now() - startedMs > STUCK_THRESHOLD_MS;

			if (!isStuck) {
				// Un alt request paralel îl procesează acum (retry rapid de la Stripe).
				// Returnăm 409 ca Stripe să retry-uiască cu backoff (nu pierdem event-ul).
				logWarning('directadmin', `Webhook event already in flight: ${event.id}`, { tenantId });
				return new Response('Event currently processing, retry later', { status: 409 });
			}

			logWarning(
				'directadmin',
				`Webhook event stuck >10min, taking over: ${event.id} (started ${existing.startedAt})`,
				{ tenantId, metadata: { eventId: event.id, startedAt: existing.startedAt } }
			);
			// Cădem prin la UPDATE-ul de mai jos care reia status='processing'.
		}

		// 'failed' → reluăm cu retry (UPDATE atomicizat back to 'processing')
		await db
			.update(table.processedStripeEvent)
			.set({
				status: 'processing',
				startedAt: nowIso,
				errorMessage: null,
				retryCount: (existing.retryCount ?? 0) + 1
			})
			.where(eq(table.processedStripeEvent.id, event.id));
		claimResult = 'retrying-failed';
	}

	// Step 5: Dispatch
	try {
		const result = await dispatchStripeEvent(event);
		await db
			.update(table.processedStripeEvent)
			.set({ status: 'completed', completedAt: new Date().toISOString() })
			.where(eq(table.processedStripeEvent.id, event.id));
		logInfo('directadmin', `Webhook processed: ${event.type} → ${result}`, {
			tenantId,
			metadata: { eventId: event.id, claim: claimResult }
		});
		return new Response(JSON.stringify({ received: true, result }), {
			status: 200,
			headers: { 'content-type': 'application/json' }
		});
	} catch (e) {
		const { message } = serializeError(e);
		// Marcăm 'failed' (păstrăm row-ul pentru audit + retry control).
		await db
			.update(table.processedStripeEvent)
			.set({ status: 'failed', errorMessage: message })
			.where(eq(table.processedStripeEvent.id, event.id))
			.catch(() => {});
		logError('directadmin', `Webhook handler failed: ${event.type} (${event.id}): ${message}`, {
			tenantId,
			metadata: { eventId: event.id, claim: claimResult }
		});
		// 500 = Stripe retry-uiește (default schedule: 1h, 6h, ..., max 3 zile).
		return new Response(`Handler failed: ${message}`, { status: 500 });
	}
};
