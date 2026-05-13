import Stripe from 'stripe';
import { env } from '$env/dynamic/private';

/**
 * Stripe client setup — single instance, configured from env.
 *
 * MVP scope: One Top Solution e single-tenant pe Stripe (un cont Stripe, toate
 * comenzile merg acolo). Dacă viitor adăugăm multi-tenant Stripe, refactor la
 * factory per-tenant cu credențiale encrypted (pattern: smartbill/crypto).
 *
 * Notă: NU stocăm secret key în CRM DB. Singura sursă = `STRIPE_SECRET_KEY` ENV.
 */

let cachedStripe: Stripe | null = null;

export function getStripe(): Stripe {
	if (cachedStripe) return cachedStripe;
	const secret = env.STRIPE_SECRET_KEY;
	if (!secret || secret.includes('REPLACE_ME')) {
		throw new Error(
			'STRIPE_SECRET_KEY nu e configurat în .env (sau e placeholder). Pune cheia test/live din Stripe Dashboard.'
		);
	}
	if (!secret.startsWith('sk_test_') && !secret.startsWith('sk_live_')) {
		throw new Error('STRIPE_SECRET_KEY format invalid (trebuie sk_test_ sau sk_live_).');
	}
	cachedStripe = new Stripe(secret, {
		// Default la API version baked în SDK-ul instalat. Update conștient când
		// vrei features noi (https://stripe.com/docs/upgrades).
		typescript: true,
		appInfo: {
			name: 'OTS CRM',
			version: '1.0.0'
		}
	});
	return cachedStripe;
}

/**
 * Check if Stripe is configured (without throwing). Use to gate features
 * gracefully when keys aren't set up yet (e.g., hide "Plătește online" buton).
 */
export function isStripeConfigured(): boolean {
	const secret = env.STRIPE_SECRET_KEY;
	return !!(secret && !secret.includes('REPLACE_ME') && secret.startsWith('sk_'));
}
