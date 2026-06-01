import { getStripeForTenant } from '$lib/server/plugins/stripe/factory';

/**
 * Create a Stripe Checkout Session for a hosting order.
 *
 * Use mode='subscription' for recurring billing (renewal auto la 1 an).
 * Stripe gestionează SCA / 3DS automat în UI-ul hosted.
 *
 * Metadata e cheia critică: pun aici toate IDs interne (CRM client, inquiry,
 * tenant) ca să le pot rezolva în webhook fără re-query.
 */
export async function createHostingCheckoutSession(opts: {
	tenantId: string;
	stripeCustomerId: string;
	stripePriceId: string;
	mode: 'subscription' | 'payment';
	successUrl: string;
	cancelUrl: string;
	metadata: {
		crmTenantId: string;
		crmClientId: string;
		crmHostingInquiryId: string;
		crmHostingProductId: string;
	};
	// Stripe Tax Rate id (rate_...) pentru TVA. Obligatoriu de fapt pentru a
	// încasa brutul (net+TVA) astfel încât suma de pe pagina Stripe == totalul
	// afișat clientului == totalul facturii Keez (audit C1). Optional ca să nu
	// rupem caller-i vechi, dar submitHostingOrder îl pasează mereu.
	taxRateId?: string;
	// Locale RO + Europa
	locale?: 'ro' | 'en';
}) {
	const stripe = await getStripeForTenant(opts.tenantId);
	const session = await stripe.checkout.sessions.create({
		customer: opts.stripeCustomerId,
		mode: opts.mode,
		line_items: [
			{
				price: opts.stripePriceId,
				quantity: 1,
				// Atașăm Tax Rate-ul tenantului (inclusive:false) ca Stripe să adauge
				// TVA peste prețul NET al Price-ului. Pentru subscription, tax rate-ul
				// se propagă pe item → se aplică și la reînnoiri. Fără asta, Stripe
				// încasa doar netul deși UI + factura Keez erau pe brut (C1).
				...(opts.taxRateId ? { tax_rates: [opts.taxRateId] } : {})
			}
		],
		// Stripe calculează TVA din Tax Rate-ul de pe line item (NU din Stripe Tax
		// automat), ca să rămână sincron cu `defaultTaxRate` din CRM și cu factura
		// Keez. `automatic_tax:false` rămâne — nu folosim Stripe Tax engine.
		automatic_tax: { enabled: false },
		// Pentru mode='payment', Stripe creează propria factură (PDF + Hosted Invoice
		// Page) — utilă pentru clientul care vrea dovada plății imediat, separat de
		// factura fiscală RO emisă ulterior de Keez. Pentru subscription, Stripe
		// creează automat o factură per ciclu (controlăm doar emiterea Keez).
		invoice_creation: opts.mode === 'payment' ? { enabled: true } : undefined,
		success_url: opts.successUrl + '?session_id={CHECKOUT_SESSION_ID}',
		cancel_url: opts.cancelUrl,
		locale: opts.locale ?? 'ro',
		metadata: opts.metadata,
		// Sub `subscription_data` pun tot ce vreau pe Subscription object
		subscription_data:
			opts.mode === 'subscription'
				? {
						metadata: opts.metadata,
						description: `Hosting recurring — ${opts.metadata.crmHostingProductId}`
					}
				: undefined,
		// Allow customers to enter promo codes
		allow_promotion_codes: true,
		// Save tax ID dacă apare în checkout (Stripe poate cere CUI dacă tax_behavior=exclusive)
		tax_id_collection: { enabled: true },
		// Pentru audit + GDPR
		consent_collection: {
			terms_of_service: 'required'
		}
	});

	return session;
}
