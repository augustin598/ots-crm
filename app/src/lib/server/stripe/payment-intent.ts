import type Stripe from 'stripe';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { logWarning, serializeError, type LogSource } from '$lib/server/logger';
import {
	getStripeForTenant,
	getPublishableKeyForTenant,
	isStripeDevTestMode
} from '$lib/server/plugins/stripe/factory';
import { getOrCreateStripeCustomer } from '$lib/server/stripe/customer';

/**
 * Obține PaymentIntent-ul pentru plata cu cardul a unei facturi DEJA EMISE.
 * Sursă unică pentru pagina publică de factură (`/invoice/{slug}/{token}`) și
 * pentru portalul clientului (`/client/{slug}/invoices`) — regulile de mai jos
 * NU au voie să divergă între cele două fluxuri:
 *
 * - **Refolosirea PaymentIntent-ului deschis e apărarea anti-dublă-încasare**:
 *   două taburi (sau portal + link public în paralel) primesc ACELAȘI
 *   PaymentIntent, iar Stripe confirmă un PaymentIntent o singură dată. NU o
 *   elimina și NU crea necondiționat un intent nou.
 * - Suma și moneda vin MEREU din factura din DB, niciodată din request.
 * - `metadata.crmPurpose='invoice_payment'` e contractul cu webhook-ul care doar
 *   marchează factura plătită (fără provisioning, fără reemitere Keez).
 */

/** Stări în care un PaymentIntent existent mai poate fi confirmat. */
export const REUSABLE_PI_STATUSES = new Set([
	'requires_payment_method',
	'requires_confirmation',
	'requires_action'
]);

export async function getOrCreateInvoicePaymentIntent(opts: {
	tenantId: string;
	invoice: {
		id: string;
		totalAmount: number | null;
		currency: string | null;
		stripePaymentIntentId: string | null;
	};
	client: Parameters<typeof getOrCreateStripeCustomer>[0] | null;
	invoiceLabel: string;
	/** Scope-ul de logging al apelantului (ex. 'invoice-view'). */
	logScope: LogSource;
}): Promise<{ clientSecret: string; publishableKey: string }> {
	const { tenantId, invoice, client, invoiceLabel, logScope } = opts;
	// Apelanții verifică eligibilitatea înainte (sumă peste pragul Stripe) —
	// guard-ul e plasa de siguranță ca să nu creăm niciodată un intent pe 0.
	const totalCents = invoice.totalAmount;
	if (!totalCents || totalCents <= 0) {
		throw new Error('Factura nu are un total valid pentru plată.');
	}
	const currency = invoice.currency ?? 'RON';

	const stripe = await getStripeForTenant(tenantId);
	const publishableKey = await getPublishableKeyForTenant(tenantId);
	if (!publishableKey) {
		throw new Error('Configurare Stripe incompletă (lipsește publishable key).');
	}

	let intent: Stripe.PaymentIntent | null = null;

	if (invoice.stripePaymentIntentId) {
		try {
			const existing = await stripe.paymentIntents.retrieve(invoice.stripePaymentIntentId);
			if (
				REUSABLE_PI_STATUSES.has(existing.status) &&
				existing.amount === totalCents &&
				existing.currency === currency.toLowerCase() &&
				existing.client_secret
			) {
				intent = existing;
			}
		} catch (err) {
			// PaymentIntent șters, cheie Stripe rotită etc. — creăm unul nou.
			logWarning(logScope, `PaymentIntent ${invoice.stripePaymentIntentId} nerecuperabil, creăm altul`, {
				tenantId,
				metadata: { invoiceId: invoice.id, error: serializeError(err).message }
			});
		}
	}

	if (!intent) {
		// `getOrCreateStripeCustomer` aruncă dacă lipsește emailul — plata nu
		// depinde de existența unui Customer, deci continuăm fără el.
		//
		// În modul dev-test (localhost cu chei de test) sărim complet peste
		// customer: `client.stripe_customer_id` e din contul LIVE (test mode nu-l
		// cunoaște), iar crearea unuia de test i-ar suprascrie cache-ul în DB-ul
		// partajat cu producția.
		let customerId: string | undefined;
		if (client?.email && !isStripeDevTestMode()) {
			try {
				customerId = await getOrCreateStripeCustomer(client);
			} catch (err) {
				logWarning(logScope, `Nu am putut crea Stripe Customer: ${serializeError(err).message}`, {
					tenantId,
					metadata: { invoiceId: invoice.id, clientId: client.id }
				});
			}
		}

		// `totalAmount` e deja brut (net + TVA), iar factura fiscală există deja
		// → încasăm exact totalul, fără tax rate atașat.
		intent = await stripe.paymentIntents.create({
			amount: totalCents,
			currency: currency.toLowerCase(),
			...(customerId ? { customer: customerId } : {}),
			automatic_payment_methods: { enabled: true },
			metadata: {
				crmPurpose: 'invoice_payment',
				crmTenantId: tenantId,
				crmInvoiceId: invoice.id
			},
			description: `Factura ${invoiceLabel}`
		});

		await db
			.update(table.invoice)
			.set({ stripePaymentIntentId: intent.id, updatedAt: new Date() })
			.where(and(eq(table.invoice.id, invoice.id), eq(table.invoice.tenantId, tenantId)));
	}

	if (!intent.client_secret) throw new Error('Stripe nu a returnat clientSecret.');

	return { clientSecret: intent.client_secret, publishableKey };
}
