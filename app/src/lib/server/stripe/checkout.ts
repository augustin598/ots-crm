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
				quantity: 1
			}
		],
		// VAT decision: Keez emite factura fiscală RO autoritate. Stripe colectează
		// doar plata (RON), nu calculează tax. Așa evităm divergențe între tax rate
		// Stripe Dashboard și `defaultTaxRate` din CRM. `automatic_tax: false` =
		// Stripe nu adaugă TVA peste prețul Price (vezi `tax_behavior` pe Price).
		// Dacă pe viitor activăm Stripe Tax, trebuie sincronizat cu Keez ca să nu
		// dublăm TVA pe factură.
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
