import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { getStripe } from '$lib/server/stripe/client';
import { dispatchStripeEvent } from '$lib/server/stripe/webhook-handlers';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { logInfo, logError } from '$lib/server/logger';
import { eq } from 'drizzle-orm';
import type Stripe from 'stripe';

/**
 * Stripe webhook endpoint — receives events from Stripe and dispatches them.
 *
 * **Critical**:
 *  - Signature verification via `stripe.webhooks.constructEvent` — body must be
 *    RAW bytes, not parsed JSON. Use `request.text()` (NOT request.json()).
 *  - Idempotency: every event.id is logged in `processed_stripe_event` to prevent
 *    double-processing if Stripe retries (e.g., on 5xx response).
 *  - This endpoint MUST be public (no auth middleware). Auth is via Stripe signature.
 *
 * Setup Stripe CLI for local dev:
 *   stripe listen --forward-to localhost:5173/api/stripe/webhook
 *   (prints whsec_... — put in .env STRIPE_WEBHOOK_SECRET)
 */

export const POST: RequestHandler = async ({ request }) => {
	const signature = request.headers.get('stripe-signature');
	if (!signature) {
		return new Response('Missing stripe-signature header', { status: 400 });
	}

	const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
	if (!webhookSecret || webhookSecret.includes('REPLACE_ME')) {
		logError('directadmin', 'STRIPE_WEBHOOK_SECRET nu e configurat', {});
		return new Response('Webhook not configured', { status: 500 });
	}

	// CRITICAL: raw body for signature verification. SvelteKit nu pre-parsează
	// dacă folosim request.text() direct.
	const rawBody = await request.text();

	let event: Stripe.Event;
	try {
		event = getStripe().webhooks.constructEvent(rawBody, signature, webhookSecret);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		logError('directadmin', `Webhook signature verification failed: ${msg}`, {});
		return new Response(`Signature verification failed: ${msg}`, { status: 400 });
	}

	// Idempotency check — bail early dacă am procesat deja event-ul ăsta.
	const tenantId =
		(event.data.object as { metadata?: { crmTenantId?: string } })?.metadata?.crmTenantId ?? null;
	try {
		await db.insert(table.processedStripeEvent).values({
			id: event.id,
			eventType: event.type,
			tenantId
		});
	} catch {
		// PRIMARY KEY constraint → event-ul a fost deja procesat
		logInfo('directadmin', `Webhook duplicate event ignored: ${event.type} (${event.id})`, {});
		return new Response(JSON.stringify({ received: true, duplicate: true }), {
			status: 200,
			headers: { 'content-type': 'application/json' }
		});
	}

	// Procesează event-ul (handler-ul propriu loghează)
	try {
		const result = await dispatchStripeEvent(event);
		logInfo('directadmin', `Webhook processed: ${event.type} → ${result}`, {
			metadata: { eventId: event.id }
		});
		return new Response(JSON.stringify({ received: true, result }), {
			status: 200,
			headers: { 'content-type': 'application/json' }
		});
	} catch (e) {
		// Dacă handler-ul aruncă, RETUNĂM 500 ca Stripe să retry-uiască.
		// Dar ștergem entry-ul din processed_stripe_event ca să nu blocăm retry-ul.
		await db
			.delete(table.processedStripeEvent)
			.where(eq(table.processedStripeEvent.id, event.id))
			.catch(() => {});
		const msg = e instanceof Error ? e.message : String(e);
		return new Response(`Handler failed: ${msg}`, { status: 500 });
	}
};

