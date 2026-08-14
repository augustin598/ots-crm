import { command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { logInfo, logError, serializeError } from '$lib/server/logger';
import { checkPortalCardPaymentEligibility } from '$lib/server/stripe/invoice-payable';
import { isStripeConfiguredForTenant } from '$lib/server/plugins/stripe/factory';
import { getOrCreateInvoicePaymentIntent } from '$lib/server/stripe/payment-intent';
import { rateLimit } from '$lib/server/redis';
import { formatInvoiceNumberDisplay } from '$lib/utils/invoice';

/**
 * Plata cu cardul din PORTALUL clientului (`/client/{slug}/invoices`).
 *
 * Autorizare: sesiunea de portal — spre deosebire de fluxul public (unde tokenul
 * din URL e singura autorizare), aici factura trebuie să aparțină clientului
 * logat (`locals.client.id`), iar contactele secundare sunt refuzate: ele nu văd
 * facturile în portal (`getInvoices` le întoarce listă goală), deci nici nu pot
 * plăti. Suma vine MEREU din DB, niciodată din request.
 *
 * PaymentIntent-ul e partajat cu fluxul public prin
 * `getOrCreateInvoicePaymentIntent`: clientul care deschide și linkul din email
 * și portalul primește ACELAȘI intent → nu se poate încasa de două ori.
 */

/** Câte PaymentIntents poate cere un client într-o oră (toate facturile lui). */
const PAY_ATTEMPTS_PER_CLIENT_HOUR = 30;
/** Aceeași limită per factură ca fluxul public — bugetul e comun. */
const PAY_ATTEMPTS_PER_INVOICE_HOUR = 30;
const WINDOW_SEC = 3600;

const PayIntentInput = v.object({
	invoiceId: v.pipe(v.string(), v.minLength(1), v.maxLength(64))
});

export const createClientInvoicePaymentIntent = command(
	PayIntentInput,
	async ({ invoiceId }) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw error(401, 'Unauthorized');
		}
		if (!event.locals.isClientUser || !event.locals.client) {
			throw error(403, 'Doar clienții pot plăti facturi din portal.');
		}
		// Secundarii nu văd facturile în portal → nici nu le pot plăti.
		if (!event.locals.isClientUserPrimary) {
			throw error(403, 'Contul tău nu are acces la facturi.');
		}

		const tenant = event.locals.tenant;
		const client = event.locals.client;

		const clientRl = await rateLimit({
			kind: 'invoice-pay-portal',
			ip: `${tenant.id}:${client.id}`,
			limit: PAY_ATTEMPTS_PER_CLIENT_HOUR,
			windowSec: WINDOW_SEC
		});
		if (!clientRl.allowed) {
			throw error(429, 'Prea multe încercări de plată. Te rugăm să reîncerci peste o oră.');
		}

		const [invoice] = await db
			.select()
			.from(table.invoice)
			.where(
				and(
					eq(table.invoice.id, invoiceId),
					eq(table.invoice.tenantId, tenant.id),
					eq(table.invoice.clientId, client.id)
				)
			)
			.limit(1);
		if (!invoice) {
			throw error(404, 'Factura nu a fost găsită.');
		}

		// Aceeași cheie ca fluxul public — un atacator nu poate ocoli limita per
		// factură schimbând canalul (link public vs. portal).
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

		const eligibility = checkPortalCardPaymentEligibility(invoice);
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

		const [invoiceSettings] = await db
			.select()
			.from(table.invoiceSettings)
			.where(eq(table.invoiceSettings.tenantId, tenant.id))
			.limit(1);
		const invoiceLabel = formatInvoiceNumberDisplay(invoice, invoiceSettings);

		try {
			const { clientSecret, publishableKey } = await getOrCreateInvoicePaymentIntent({
				tenantId: tenant.id,
				invoice,
				client,
				invoiceLabel,
				logScope: 'invoice-view'
			});

			logInfo('invoice-view', `PaymentIntent din portal pentru factura ${invoiceLabel}`, {
				tenantId: tenant.id,
				metadata: { invoiceId: invoice.id, clientId: client.id }
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
			logError('invoice-view', `PaymentIntent din portal eșuat pentru factura ${invoice.id}: ${message}`, {
				tenantId: tenant.id,
				metadata: { invoiceId: invoice.id, clientId: client.id }
			});
			throw error(500, 'Nu am putut iniția plata. Te rugăm să încerci din nou.');
		}
	}
);
