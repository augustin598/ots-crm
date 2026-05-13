import type { Plugin, PluginConfig, HooksManager } from '../types';
import { logInfo } from '$lib/server/logger';

/**
 * Stripe plugin manifest.
 *
 * Configurarea credentials e per-tenant prin `stripe_integration` table
 * (vezi `factory.ts`). Plugin-ul aici e doar declaration pentru registry-ul
 * de plugin-uri + lifecycle hooks viitoare.
 *
 * Hook handlers (`webhook-handlers.ts`) sunt invocate direct de webhook
 * endpoint `/api/stripe/webhook` (NU prin pluginHooks system), pentru că
 * Stripe webhook signing și body raw cer un endpoint dedicat.
 */
export class StripePlugin implements Plugin {
	id = 'stripe';
	name = 'stripe';
	version = '1.0.0';
	displayName = 'Stripe Payments';
	description =
		'Plăți online prin Stripe (carduri Visa/Mastercard). Per-tenant credentials. Suport subscriptions, checkout hosted, SCA automat.';

	async initialize(_config: PluginConfig): Promise<void> {
		// No-op. Configurarea e per-tenant (vezi /[tenant]/settings/stripe).
	}

	registerHooks(_hooks: HooksManager): void {
		// Stripe webhook events arrive prin endpoint dedicat, NU prin pluginHooks.
		// Aici ar fi un loc bun să reagisterăm pe `invoice.created` pentru a crea
		// auto Stripe Invoice (post-MVP, când vom suporta și factura via Stripe).
	}

	async onEnable(tenantId: string): Promise<void> {
		logInfo('directadmin', 'Stripe plugin enabled for tenant', { tenantId });
	}

	async onDisable(tenantId: string): Promise<void> {
		// Nu ștergem credentials la disable — doar marchează `stripe_integration.isActive=false`.
		// La re-enable, credentials sunt fix unde le-am lăsat.
		logInfo('directadmin', 'Stripe plugin disabled for tenant', { tenantId });
	}
}

export const stripePlugin = new StripePlugin();
