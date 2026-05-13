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
	let parsedPreview: { data?: { object?: { metadata?: { crmTenantId?: string } } } } = {};
	try {
		parsedPreview = JSON.parse(rawBody);
	} catch {
		return new Response('Invalid JSON', { status: 400 });
	}
	const tenantId = parsedPreview.data?.object?.metadata?.crmTenantId;

	if (!tenantId) {
		// Event fără tenant context (ex: account-level events Stripe test) — accept dar log
		logInfo('directadmin', 'Stripe webhook fără tenantId în metadata — accept dar skip', {});
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
				retryCount: table.processedStripeEvent.retryCount
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
			// Un alt request paralel îl procesează acum (retry rapid de la Stripe).
			// Returnăm 409 ca Stripe să retry-uiască cu backoff (nu pierdem event-ul).
			logWarning('directadmin', `Webhook event already in flight: ${event.id}`, { tenantId });
			return new Response('Event currently processing, retry later', { status: 409 });
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
