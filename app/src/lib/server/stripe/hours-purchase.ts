/**
 * Post-plată pentru cumpărarea orelor de extra work (/servicii, tab „Tarife
 * orare"). Branch-ul `metadata.crmPurpose='hours_purchase'` din
 * payment_intent.succeeded / payment_failed — IZOLAT de pipeline-ul de hosting
 * (fără provisioning DA) și de `invoice_payment` (acolo factura există deja).
 *
 * Idempotență în straturi: `processed_stripe_event` oprește redelivery-ul
 * aceluiași event; guard-ul pe `status==='paid'` oprește dublarea pe replay
 * manual; emitterul Keez e idempotent pe stripePaymentIntentId; emailurile au
 * dedupe propriu per factură.
 */
import type Stripe from 'stripe';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { logError, logInfo, logWarning, serializeError } from '$lib/server/logger';
import { withTursoBusyRetry } from '$lib/server/plugins/keez/db-retry';
import { emitKeezHoursInvoice } from '$lib/server/stripe/post-payment/emit-keez-hours-invoice';
import { sendOnboardingMagicLink } from '$lib/server/stripe/post-payment/send-magic-link';
import {
	notifyPaymentSucceeded,
	notifyAdminPaymentReceived
} from '$lib/server/stripe/notifications';

export const HOURS_PURCHASE_PURPOSE = 'hours_purchase';

export async function handleHoursPurchaseSucceeded(intent: Stripe.PaymentIntent): Promise<void> {
	const md = intent.metadata ?? {};
	const tenantId = md.crmTenantId;
	const clientId = md.crmClientId;
	const orderId = md.crmHoursOrderId;
	if (!tenantId || !clientId || !orderId) {
		logError('packages', 'hours_purchase succeeded fără metadata CRM completă', {
			metadata: { intentId: intent.id, hasTenant: !!tenantId, hasClient: !!clientId, hasOrder: !!orderId }
		});
		return;
	}

	const [order] = await db
		.select()
		.from(table.serviceHoursOrder)
		.where(
			and(eq(table.serviceHoursOrder.id, orderId), eq(table.serviceHoursOrder.tenantId, tenantId))
		)
		.limit(1);
	if (!order) {
		logError('packages', `hours_purchase: comanda ${orderId} nu există`, {
			tenantId,
			metadata: { intentId: intent.id, orderId }
		});
		return;
	}
	if (order.status === 'paid') {
		logInfo('packages', `hours_purchase: comanda ${orderId} e deja plătită — skip`, {
			tenantId,
			metadata: { intentId: intent.id }
		});
		return;
	}
	// PI-ul e creat de noi pe brutul comenzii; o sumă diferită înseamnă
	// manipulare sau bug — nu marcăm plătit automat, cineva se uită.
	if (intent.amount !== order.grossCents) {
		logError(
			'packages',
			`hours_purchase: sumă încasată ${intent.amount} ≠ brut ${order.grossCents} — comanda ${orderId} NEmarcată plătită, verificare manuală`,
			{ tenantId, metadata: { orderId, intentId: intent.id } }
		);
		return;
	}

	await withTursoBusyRetry(
		() =>
			db.transaction(async (tx) => {
				await tx
					.update(table.client)
					.set({ status: 'active', updatedAt: new Date() })
					.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, tenantId)));
				await tx
					.update(table.serviceHoursOrder)
					.set({
						status: 'paid',
						paidAt: new Date(),
						stripePaymentIntentId: intent.id,
						updatedAt: new Date()
					})
					.where(
						and(
							eq(table.serviceHoursOrder.id, orderId),
							eq(table.serviceHoursOrder.tenantId, tenantId)
						)
					);
			}),
		{ tenantId, label: 'hours-purchase/markPaid' }
	);

	// Pașii de mai jos sunt best-effort, fiecare cu catch propriu: factura
	// nereușită NU blochează magic link-ul și invers; admin reia manual.
	let invoiceId: string | null = null;
	try {
		const res = await emitKeezHoursInvoice({
			tenantId,
			clientId,
			orderId,
			stripePaymentIntentId: intent.id
		});
		if ('invoiceId' in res) invoiceId = res.invoiceId;
		else {
			logWarning('packages', `hours_purchase: factura sărită (${res.reason}) pentru comanda ${orderId}`, {
				tenantId,
				metadata: { orderId }
			});
		}
	} catch (err) {
		logError('packages', `hours_purchase: emitere factură eșuată — ${serializeError(err).message}`, {
			tenantId,
			metadata: { orderId, intentId: intent.id }
		});
	}

	try {
		await sendOnboardingMagicLink({ tenantId, clientId });
	} catch (err) {
		logWarning('packages', `hours_purchase: magic link eșuat — ${serializeError(err).message}`, {
			tenantId,
			metadata: { orderId, clientId }
		});
	}

	if (invoiceId) {
		try {
			await notifyPaymentSucceeded(tenantId, invoiceId);
		} catch (err) {
			logWarning('packages', `hours_purchase: email confirmare eșuat — ${serializeError(err).message}`, {
				tenantId,
				metadata: { orderId, invoiceId }
			});
		}
		try {
			await notifyAdminPaymentReceived(tenantId, invoiceId, { hours_order: 'success' });
		} catch (err) {
			logWarning('packages', `hours_purchase: notificare admin eșuată — ${serializeError(err).message}`, {
				tenantId,
				metadata: { orderId, invoiceId }
			});
		}
	}

	logInfo('packages', `hours_purchase: comanda ${orderId} finalizată`, {
		tenantId,
		metadata: { orderId, invoiceId, intentId: intent.id, hours: order.hours, rateSlug: order.rateSlug }
	});
}

export async function handleHoursPurchaseFailed(intent: Stripe.PaymentIntent): Promise<void> {
	const md = intent.metadata ?? {};
	const tenantId = md.crmTenantId;
	const orderId = md.crmHoursOrderId;
	if (!tenantId || !orderId) {
		logWarning('packages', 'hours_purchase payment_failed fără metadata CRM', {
			metadata: { intentId: intent.id }
		});
		return;
	}

	const err = intent.last_payment_error;
	logInfo('packages', `hours_purchase: plata eșuată pentru comanda ${orderId}`, {
		tenantId,
		metadata: {
			intentId: intent.id,
			failureCode: err?.decline_code ?? err?.code ?? null,
			failureMessage: err?.message ?? null
		}
	});

	// Doar din pending_payment — un failed întârziat după succeeded (retry de
	// card în același PI) nu are voie să „desplătească" comanda.
	await db
		.update(table.serviceHoursOrder)
		.set({ status: 'failed', updatedAt: new Date() })
		.where(
			and(
				eq(table.serviceHoursOrder.id, orderId),
				eq(table.serviceHoursOrder.tenantId, tenantId),
				eq(table.serviceHoursOrder.status, 'pending_payment')
			)
		);
}
