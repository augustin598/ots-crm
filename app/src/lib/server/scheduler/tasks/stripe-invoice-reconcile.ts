import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, isNotNull, lt, ne } from 'drizzle-orm';
import { logInfo, logError, serializeError } from '$lib/server/logger';
import { getStripeForTenant, isStripeConfiguredForTenant } from '$lib/server/plugins/stripe/factory';
import { handleStripeInvoicePayment } from '$lib/server/stripe/invoice-payment';

/**
 * Plasă de siguranță pentru webhook-uri pierdute definitiv.
 *
 * Stripe renunță la redelivery după ~72h. Dacă evenimentul
 * `payment_intent.succeeded` se pierde, clientul a plătit dar factura rămâne
 * restantă — și primește în continuare remindere pentru bani deja încasați.
 *
 * Rulăm zilnic peste facturile care AU un PaymentIntent atașat, nu sunt plătite
 * și n-au mai fost atinse de 24h (fereastră în care webhook-ul normal ar fi
 * trebuit să ajungă), și întrebăm Stripe care e adevărul.
 *
 * Reconcilierea trece prin ACELAȘI `handleStripeInvoicePayment` ca webhook-ul,
 * deci moștenește guard-ul de sumă, idempotența și emiterea hook-urilor.
 */

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const MAX_PER_RUN = 100;

export async function processStripeInvoiceReconcile(): Promise<{
	success: boolean;
	checked: number;
	reconciled: number;
	errors: number;
}> {
	const cutoff = new Date(Date.now() - STALE_AFTER_MS);

	const candidates = await db
		.select({
			id: table.invoice.id,
			tenantId: table.invoice.tenantId,
			stripePaymentIntentId: table.invoice.stripePaymentIntentId,
			totalAmount: table.invoice.totalAmount
		})
		.from(table.invoice)
		.where(
			and(
				isNotNull(table.invoice.stripePaymentIntentId),
				ne(table.invoice.status, 'paid'),
				lt(table.invoice.updatedAt, cutoff)
			)
		)
		.limit(MAX_PER_RUN);

	let reconciled = 0;
	let errors = 0;

	for (const inv of candidates) {
		try {
			// Tenant scoping explicit: fiecare factură își aduce propriul tenantId,
			// nimic nu se deduce din context global (task de background).
			if (!(await isStripeConfiguredForTenant(inv.tenantId))) continue;

			const stripe = await getStripeForTenant(inv.tenantId);
			const intent = await stripe.paymentIntents.retrieve(inv.stripePaymentIntentId!);

			if (intent.status !== 'succeeded') continue;

			await handleStripeInvoicePayment({
				tenantId: inv.tenantId,
				invoiceId: inv.id,
				paymentIntentId: intent.id,
				paidAmountCents: intent.amount ?? null,
				eventLabel: 'reconcile.stripe-invoice'
			});
			reconciled++;

			logInfo('scheduler', `Reconciliere: factura ${inv.id} marcată plătită din Stripe`, {
				tenantId: inv.tenantId,
				metadata: { invoiceId: inv.id, paymentIntentId: intent.id }
			});
		} catch (err) {
			// O factură problematică (PaymentIntent șters, cheie rotită) nu trebuie să
			// oprească reconcilierea celorlalte.
			errors++;
			logError(
				'scheduler',
				`Reconciliere eșuată pentru factura ${inv.id}: ${serializeError(err).message}`,
				{
					tenantId: inv.tenantId,
					metadata: { invoiceId: inv.id, paymentIntentId: inv.stripePaymentIntentId }
				}
			);
		}
	}

	logInfo('scheduler', 'Stripe invoice reconcile finished', {
		metadata: { checked: candidates.length, reconciled, errors }
	});

	return { success: true, checked: candidates.length, reconciled, errors };
}
