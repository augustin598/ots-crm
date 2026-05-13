import { getStripe } from './client';

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
	const stripe = getStripe();
	const session = await stripe.checkout.sessions.create({
		customer: opts.stripeCustomerId,
		mode: opts.mode,
		line_items: [
			{
				price: opts.stripePriceId,
				quantity: 1
			}
		],
		// Auto-collect TVA prin Stripe Tax. Dacă nu e activat Stripe Tax pe cont,
		// `tax_behavior` de pe Price face Stripe să afișeze "Tax exclusive" și
		// CRM-ul calculează TVA pe factura Keez la final.
		automatic_tax: { enabled: true },
		// Trimite factura proforma Stripe la email (separat de factura Keez RO)
		invoice_creation: opts.mode === 'payment' ? { enabled: true } : undefined,
		// Pentru subscription, Stripe creează automat invoice la fiecare ciclu
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
