import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import {
	getStripeForTenant,
	isStripeConfiguredForTenant,
	StripeNotConfiguredError
} from '$lib/server/plugins/stripe/factory';
import { dispatchStripeEvent } from '$lib/server/stripe/webhook-handlers';
import { logInfo, logError, serializeError } from '$lib/server/logger';
import type { RequestHandler } from './$types';

/**
 * Stripe upstream + post-payment pipeline health probe.
 *
 *   GET ?action=ping                 — apel test `balance.retrieve` (latency + valid key)
 *   GET ?action=events&limit=20      — listează ultimele N evenimente webhook
 *   GET ?action=replay&eventId=evt_x — refetch event din Stripe + re-dispatch (force)
 *   GET ?action=webhook-config       — env vars present? endpoint URL recomandat
 *   GET ?action=post-payment-steps&sessionId=cs_x  — toate cele 3 step-uri pe session
 *   GET ?action=pending-steps&limit=50             — toate step-urile failed/pending
 *   GET ?action=client-duplicates                  — listă CUI-uri duplicate (pre-UNIQUE migration)
 *
 * Admin-only. Tenant-scoped pe locals.tenant.
 */

function requireAdmin(event: Parameters<RequestHandler>[0]) {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	const role = event.locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') {
		throw error(403, 'Forbidden: Admin access required');
	}
}

function isValidStripeEventId(s: string): boolean {
	return /^evt_[A-Za-z0-9]{10,64}$/.test(s);
}

function isValidStripeSessionId(s: string): boolean {
	return /^cs_(test|live)_[A-Za-z0-9]{20,128}$/.test(s);
}

export const GET: RequestHandler = async (event) => {
	requireAdmin(event);
	const tenantId = event.locals.tenant!.id;
	const action = event.url.searchParams.get('action') ?? 'ping';

	// === ping === ----------------------------------------------------------
	if (action === 'ping') {
		const stripeConfigured = await isStripeConfiguredForTenant(tenantId);
		if (!stripeConfigured) {
			return json({
				ok: false,
				stripeConfigured: false,
				reason: 'Stripe nu e configurat pentru acest tenant — verifică /settings/stripe sau env fallback'
			});
		}
		const start = performance.now();
		try {
			const stripe = await getStripeForTenant(tenantId);
			const balance = await stripe.balance.retrieve();
			return json({
				ok: true,
				stripeConfigured: true,
				durationMs: Math.round(performance.now() - start),
				livemode: balance.livemode,
				availableCount: balance.available.length,
				pendingCount: balance.pending.length
			});
		} catch (err) {
			const { message } = serializeError(err);
			return json({
				ok: false,
				stripeConfigured: true,
				durationMs: Math.round(performance.now() - start),
				error: message,
				notConfigured: err instanceof StripeNotConfiguredError
			});
		}
	}

	// === events === --------------------------------------------------------
	if (action === 'events') {
		const limit = Math.min(200, Math.max(1, Number(event.url.searchParams.get('limit') ?? '20')));
		const rows = await db
			.select({
				id: table.processedStripeEvent.id,
				eventType: table.processedStripeEvent.eventType,
				tenantId: table.processedStripeEvent.tenantId,
				status: table.processedStripeEvent.status,
				retryCount: table.processedStripeEvent.retryCount,
				errorMessage: table.processedStripeEvent.errorMessage,
				processedAt: table.processedStripeEvent.processedAt,
				startedAt: table.processedStripeEvent.startedAt,
				completedAt: table.processedStripeEvent.completedAt
			})
			.from(table.processedStripeEvent)
			.where(eq(table.processedStripeEvent.tenantId, tenantId))
			.orderBy(desc(table.processedStripeEvent.processedAt))
			.limit(limit);

		// Count breakdown pe status
		const byStatus = await db
			.select({
				status: table.processedStripeEvent.status,
				count: sql<number>`count(*)`.as('count')
			})
			.from(table.processedStripeEvent)
			.where(eq(table.processedStripeEvent.tenantId, tenantId))
			.groupBy(table.processedStripeEvent.status);

		return json({
			ok: true,
			tenantId,
			limit,
			breakdown: byStatus,
			events: rows
		});
	}

	// === replay === --------------------------------------------------------
	if (action === 'replay') {
		const eventId = event.url.searchParams.get('eventId');
		if (!eventId) throw error(400, 'eventId query param is required');
		if (!isValidStripeEventId(eventId)) throw error(400, 'eventId must match evt_[A-Za-z0-9]+');

		let stripeEvent;
		try {
			const stripe = await getStripeForTenant(tenantId);
			stripeEvent = await stripe.events.retrieve(eventId);
		} catch (err) {
			const { message } = serializeError(err);
			return json({ ok: false, reason: 'event fetch failed', error: message }, { status: 502 });
		}

		// Reset row state ca să forțăm re-procesare (idempotent dacă handler-ul însuși e idempotent).
		const nowIso = new Date().toISOString();
		await db
			.update(table.processedStripeEvent)
			.set({
				status: 'processing',
				startedAt: nowIso,
				errorMessage: null,
				retryCount: sql`${table.processedStripeEvent.retryCount} + 1`
			})
			.where(eq(table.processedStripeEvent.id, eventId));

		try {
			const result = await dispatchStripeEvent(stripeEvent);
			await db
				.update(table.processedStripeEvent)
				.set({ status: 'completed', completedAt: new Date().toISOString() })
				.where(eq(table.processedStripeEvent.id, eventId));
			logInfo('directadmin', `Manual replay: ${stripeEvent.type} (${eventId}) → ${result}`, {
				tenantId,
				metadata: { eventId }
			});
			return json({ ok: true, eventType: stripeEvent.type, result });
		} catch (err) {
			const { message } = serializeError(err);
			await db
				.update(table.processedStripeEvent)
				.set({ status: 'failed', errorMessage: message })
				.where(eq(table.processedStripeEvent.id, eventId));
			logError('directadmin', `Manual replay failed for ${eventId}: ${message}`, {
				tenantId,
				metadata: { eventId }
			});
			return json({ ok: false, eventType: stripeEvent.type, error: message }, { status: 500 });
		}
	}

	// === webhook-config === -------------------------------------------------
	if (action === 'webhook-config') {
		const [integration] = await db
			.select({
				accountId: table.stripeIntegration.accountId,
				accountName: table.stripeIntegration.accountName,
				accountEmail: table.stripeIntegration.accountEmail,
				isTestMode: table.stripeIntegration.isTestMode,
				isActive: table.stripeIntegration.isActive,
				hasSecretKey: sql<number>`CASE WHEN length(${table.stripeIntegration.secretKeyEncrypted}) > 0 THEN 1 ELSE 0 END`,
				hasWebhookSecret: sql<number>`CASE WHEN ${table.stripeIntegration.webhookSecretEncrypted} IS NOT NULL THEN 1 ELSE 0 END`,
				publishableKey: table.stripeIntegration.publishableKey,
				lastTestedAt: table.stripeIntegration.lastTestedAt,
				lastError: table.stripeIntegration.lastError
			})
			.from(table.stripeIntegration)
			.where(eq(table.stripeIntegration.tenantId, tenantId))
			.limit(1);

		return json({
			ok: true,
			tenantIntegration: integration ?? null,
			envFallback: {
				secretKeyPresent:
					!!env.STRIPE_SECRET_KEY && !env.STRIPE_SECRET_KEY.includes('REPLACE_ME'),
				webhookSecretPresent:
					!!env.STRIPE_WEBHOOK_SECRET && !env.STRIPE_WEBHOOK_SECRET.includes('REPLACE_ME'),
				testMode: env.STRIPE_SECRET_KEY?.startsWith('sk_test_') ?? false
			},
			webhookEndpointHint:
				'Configurează în Stripe Dashboard → Developers → Webhooks: <APP_URL>/api/stripe/webhook (per-tenant: webhook secret în stripe_integration.webhook_secret_encrypted)',
			recommendedEvents: [
				'checkout.session.completed',
				'checkout.session.expired',
				'invoice.paid',
				'invoice.payment_succeeded',
				'invoice.payment_failed',
				'payment_intent.payment_failed',
				'customer.subscription.deleted',
				'customer.updated',
				'charge.refunded',
				'charge.dispute.created'
			]
		});
	}

	// === post-payment-steps === --------------------------------------------
	if (action === 'post-payment-steps') {
		const sessionId = event.url.searchParams.get('sessionId');
		if (!sessionId) throw error(400, 'sessionId query param is required');
		if (!isValidStripeSessionId(sessionId)) {
			throw error(400, 'sessionId must match cs_(test|live)_[A-Za-z0-9]+');
		}
		const steps = await db
			.select()
			.from(table.postPaymentStep)
			.where(
				and(
					eq(table.postPaymentStep.tenantId, tenantId),
					eq(table.postPaymentStep.stripeSessionId, sessionId)
				)
			);
		return json({ ok: true, sessionId, steps });
	}

	// === pending-steps === --------------------------------------------------
	if (action === 'pending-steps') {
		const limit = Math.min(500, Math.max(1, Number(event.url.searchParams.get('limit') ?? '50')));
		const rows = await db
			.select({
				id: table.postPaymentStep.id,
				stripeSessionId: table.postPaymentStep.stripeSessionId,
				clientId: table.postPaymentStep.clientId,
				inquiryId: table.postPaymentStep.inquiryId,
				step: table.postPaymentStep.step,
				status: table.postPaymentStep.status,
				attempts: table.postPaymentStep.attempts,
				error: table.postPaymentStep.error,
				createdAt: table.postPaymentStep.createdAt,
				updatedAt: table.postPaymentStep.updatedAt
			})
			.from(table.postPaymentStep)
			.where(
				and(
					eq(table.postPaymentStep.tenantId, tenantId),
					inArray(table.postPaymentStep.status, ['pending', 'failed'])
				)
			)
			.orderBy(desc(table.postPaymentStep.updatedAt))
			.limit(limit);
		return json({ ok: true, count: rows.length, steps: rows });
	}

	// === client-duplicates === ----------------------------------------------
	// Verifică duplicate CUI pre-migrație 0299_client_unique_cui. Dacă returnează 0,
	// e safe să rulezi migrarea (UNIQUE constraint nu va eșua).
	if (action === 'client-duplicates') {
		const dups = await db
			.select({
				tenantId: table.client.tenantId,
				cui: table.client.cui,
				count: sql<number>`count(*)`.as('count')
			})
			.from(table.client)
			.where(eq(table.client.tenantId, tenantId))
			.groupBy(table.client.tenantId, table.client.cui)
			.having(sql`count(*) > 1 AND ${table.client.cui} IS NOT NULL`);
		return json({
			ok: true,
			tenantId,
			duplicates: dups,
			safeToApplyUniqueMigration: dups.length === 0
		});
	}

	throw error(400, `Unknown action: ${action}`);
};
