import { command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import type Stripe from 'stripe';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { logInfo, logError, logWarning, serializeError } from '$lib/server/logger';
import { validateInvoiceViewToken } from '$lib/server/invoice-token';
import { checkCardPaymentEligibility } from '$lib/server/stripe/invoice-payable';
import {
	isStripeConfiguredForTenant,
	getStripeForTenant,
	getPublishableKeyForTenant
} from '$lib/server/plugins/stripe/factory';
import { getOrCreateStripeCustomer } from '$lib/server/stripe/customer';
import { rateLimit } from '$lib/server/redis';
import { formatInvoiceNumberDisplay } from '$lib/utils/invoice';

/**
 * Plata cu cardul pe pagina PUBLICĂ de factură (`/invoice/{slug}/{token}`).
 *
 * Model de securitate: tokenul din URL e singura autorizare — exact ca la
 * vizualizarea facturii și la descărcarea PDF-ului. Nu există sesiune sau cookie,
 * și nicio legătură cu magic link-ul portalului. Oricine are linkul poate plăti;
 * acceptat conștient, pentru că suma vine MEREU din DB (niciodată din request),
 * tokenul e 32 de octeți aleatori, iar frauda de card e acoperită de Stripe/3DS.
 *
 * Factura CRM și factura fiscală Keez EXISTĂ deja, deci webhook-ul care primește
 * `metadata.crmPurpose='invoice_payment'` doar marchează factura plătită — fără
 * provisioning DirectAdmin, fără reemitere Keez (ambele ar dubla facturarea).
 * Vezi `src/lib/server/stripe/invoice-payment.ts`.
 */

/** Câte PaymentIntents poate cere un IP într-o oră. */
const PAY_ATTEMPTS_PER_IP_HOUR = 10;
/**
 * Limită per FACTURĂ, indiferent de IP — altfel un atacator distribuit pe multe
 * IP-uri ar putea genera PaymentIntents la nesfârșit pentru aceeași factură.
 */
const PAY_ATTEMPTS_PER_INVOICE_HOUR = 30;
const WINDOW_SEC = 3600;

/**
 * Stări în care un PaymentIntent mai poate fi confirmat. Refolosirea lui e
 * intenționată, nu o optimizare: două taburi deschise primesc ACELAȘI
 * PaymentIntent, iar Stripe confirmă un PaymentIntent o singură dată → nu se
 * poate încasa de două ori pentru aceeași factură.
 */
const REUSABLE_PI_STATUSES = new Set([
	'requires_payment_method',
	'requires_confirmation',
	'requires_action'
]);

const PayIntentInput = v.object({
	tenantSlug: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
	token: v.pipe(v.string(), v.minLength(1), v.maxLength(256))
});

export const createPublicInvoicePaymentIntent = command(
	PayIntentInput,
	async ({ tenantSlug, token }) => {
		const event = getRequestEvent();
		const ip =
			event?.getClientAddress?.() ??
			event?.request?.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
			'unknown';

		const ipRl = await rateLimit({
			kind: 'invoice-pay-ip',
			ip,
			limit: PAY_ATTEMPTS_PER_IP_HOUR,
			windowSec: WINDOW_SEC
		});
		if (!ipRl.allowed) {
			throw error(429, 'Prea multe încercări de plată. Te rugăm să reîncerci peste o oră.');
		}

		const result = await validateInvoiceViewToken(tenantSlug, token);
		// Mesaj identic pentru „inexistent" și „expirat" — nu confirmăm existența
		// unui token cuiva care ghicește.
		if (!result || 'expired' in result) {
			throw error(400, 'Link invalid sau expirat.');
		}

		const { tenant, invoice, client, invoiceSettings } = result;

		const invoiceRl = await rateLimit({
			kind: 'invoice-pay-inv',
			ip: `${tenant.id}:${invoice.id}`,
			limit: PAY_ATTEMPTS_PER_INVOICE_HOUR,
			windowSec: WINDOW_SEC
		});
		if (!invoiceRl.allowed) {
			throw error(
				429,
				'Prea multe încercări de plată pentru această factură. Te rugăm să reîncerci mai târziu.'
			);
		}

		const eligibility = checkCardPaymentEligibility(invoice);
		if (!eligibility.eligible) {
			if (eligibility.reason === 'already_paid') return { alreadyPaid: true as const };
			throw error(
				400,
				eligibility.reason === 'amount'
					? 'Suma facturii este prea mică pentru plata cu cardul. Te rugăm să folosești transferul bancar.'
					: 'Această factură nu poate fi plătită cu cardul.'
			);
		}

		if (!(await isStripeConfiguredForTenant(tenant.id))) {
			throw error(503, 'Plata cu cardul nu este disponibilă momentan.');
		}

		const totalCents = invoice.totalAmount as number;
		const currency = invoice.currency ?? 'RON';
		const invoiceLabel = formatInvoiceNumberDisplay(invoice, invoiceSettings);

		try {
			const stripe = await getStripeForTenant(tenant.id);
			const publishableKey = await getPublishableKeyForTenant(tenant.id);
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
					logWarning(
						'invoice-view',
						`PaymentIntent ${invoice.stripePaymentIntentId} nerecuperabil, creăm altul`,
						{
							tenantId: tenant.id,
							metadata: { invoiceId: invoice.id, error: serializeError(err).message }
						}
					);
				}
			}

			if (!intent) {
				// `getOrCreateStripeCustomer` aruncă dacă lipsește emailul — plata nu
				// depinde de existența unui Customer, deci continuăm fără el.
				let customerId: string | undefined;
				if (client?.email) {
					try {
						customerId = await getOrCreateStripeCustomer(client);
					} catch (err) {
						logWarning(
							'invoice-view',
							`Nu am putut crea Stripe Customer: ${serializeError(err).message}`,
							{
								tenantId: tenant.id,
								metadata: { invoiceId: invoice.id, clientId: client.id }
							}
						);
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
						crmTenantId: tenant.id,
						crmInvoiceId: invoice.id
					},
					description: `Factura ${invoiceLabel}`
				});

				await db
					.update(table.invoice)
					.set({ stripePaymentIntentId: intent.id, updatedAt: new Date() })
					.where(and(eq(table.invoice.id, invoice.id), eq(table.invoice.tenantId, tenant.id)));
			}

			if (!intent.client_secret) throw new Error('Stripe nu a returnat clientSecret.');

			logInfo('invoice-view', `PaymentIntent public pentru factura ${invoiceLabel}`, {
				tenantId: tenant.id,
				metadata: { invoiceId: invoice.id, paymentIntentId: intent.id, ip }
			});

			return {
				alreadyPaid: false as const,
				clientSecret: intent.client_secret,
				publishableKey,
				total: totalCents,
				currency,
				invoiceLabel
			};
		} catch (err) {
			const { message } = serializeError(err);
			logError('invoice-view', `PaymentIntent public eșuat pentru factura ${invoice.id}: ${message}`, {
				tenantId: tenant.id,
				metadata: { invoiceId: invoice.id, ip }
			});
			throw error(500, 'Nu am putut iniția plata. Te rugăm să încerci din nou.');
		}
	}
);
