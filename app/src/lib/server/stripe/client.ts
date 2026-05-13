/**
 * Thin compatibility layer — Sprint 9 a mutat client-ul real la
 * `plugins/stripe/factory.ts` ca să suporte per-tenant credentials.
 *
 * Acest fișier rămâne pentru a păstra compatibilitatea cu importurile existente
 * (`getStripe` și `isStripeConfigured`). Va fi eliminat după ce toate apelurile
 * sunt migrate la `getStripeForTenant(tenantId)`.
 *
 * @deprecated Folosește `getStripeForTenant(tenantId)` din
 *  `$lib/server/plugins/stripe/factory` în loc.
 */
import { env } from '$env/dynamic/private';
export {
	getStripeForTenant,
	isStripeConfiguredForTenant,
	StripeNotConfiguredError,
	clearStripeCache,
	getWebhookSecretForTenant,
	getPublishableKeyForTenant
} from '$lib/server/plugins/stripe/factory';

/**
 * @deprecated Folosit doar de check-uri legacy. Pentru flow nou, folosește
 * `isStripeConfiguredForTenant(tenantId)`.
 */
export function isStripeConfigured(): boolean {
	const secret = env.STRIPE_SECRET_KEY;
	return !!(secret && !secret.includes('REPLACE_ME') && secret.startsWith('sk_'));
}
