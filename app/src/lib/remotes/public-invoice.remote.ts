import { command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { logInfo, logError, serializeError } from '$lib/server/logger';
import { validateInvoiceViewToken } from '$lib/server/invoice-token';
import { checkCardPaymentEligibility } from '$lib/server/stripe/invoice-payable';
import { isStripeConfiguredForTenant } from '$lib/server/plugins/stripe/factory';
import { getOrCreateInvoicePaymentIntent } from '$lib/server/stripe/payment-intent';
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
			const { clientSecret, publishableKey } = await getOrCreateInvoicePaymentIntent({
				tenantId: tenant.id,
				invoice,
				client,
				invoiceLabel,
				logScope: 'invoice-view'
			});

			logInfo('invoice-view', `PaymentIntent public pentru factura ${invoiceLabel}`, {
				tenantId: tenant.id,
				metadata: { invoiceId: invoice.id, ip }
			});

			return {
				alreadyPaid: false as const,
				clientSecret,
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
