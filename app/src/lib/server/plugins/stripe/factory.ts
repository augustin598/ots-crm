import Stripe from 'stripe';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { decrypt } from './crypto';
import { logInfo } from '$lib/server/logger';

/**
 * Stripe client factory — returnează o instanță Stripe configurată cu cheile
 * tenant-ului (decrypted din DB).
 *
 * Strategy:
 *  1. Citește `stripe_integration` row pentru tenant.
 *  2. Dacă există + active: decrypt secret_key → return Stripe instance.
 *  3. Dacă NU există dar tenant slug == PUBLIC_HOSTING_TENANT_SLUG (sau echivalent
 *     fallback): folosește `env.STRIPE_SECRET_KEY` ca compat backward pentru
 *     setup-ul Sprint 8 (înainte ca env-migration.ts să-l mute în DB).
 *  4. Altfel: throw `StripeNotConfiguredError`.
 *
 * Cache: Map per-process pentru a evita decrypt + Stripe SDK init repetat.
 * Invalidat manual prin `clearStripeCache(tenantId)` după update credentials.
 */

export class StripeNotConfiguredError extends Error {
	constructor(public tenantId: string) {
		super(`Stripe nu e configurat pentru tenantul ${tenantId}. Accesează /settings/stripe să-l setezi.`);
		this.name = 'StripeNotConfiguredError';
	}
}

interface CachedStripe {
	stripe: Stripe;
	secretFingerprint: string; // primii 8 char din secret, pentru a detecta schimbări
}

const cache = new Map<string, CachedStripe>();

function fingerprint(secret: string): string {
	return secret.slice(0, 12); // sk_test_kIXo / sk_live_xxxx — destul pentru detect change
}

function buildClient(secret: string): Stripe {
	if (!secret.startsWith('sk_test_') && !secret.startsWith('sk_live_')) {
		throw new Error('Stripe secret key format invalid (trebuie sk_test_ sau sk_live_).');
	}
	return new Stripe(secret, {
		// Pin explicit ca să detectăm contract drift când facem `bun update stripe`.
		// Update conștient când vrei features noi (https://stripe.com/docs/upgrades).
		apiVersion: '2026-04-22.dahlia',
		// 10s timeout pe orice apel HTTP — fără asta default Stripe e 80s, ceea ce
		// poate bloca worker BullMQ + handler webhook la latență Stripe ridicată.
		timeout: 10_000,
		// SDK retry-uiește built-in pe 5xx, 429, networking errors (idempotency-key
		// auto-generated pe POST). Două încercări = 3 încercări total.
		maxNetworkRetries: 2,
		typescript: true,
		appInfo: { name: 'OTS CRM', version: '1.0.0' }
	});
}

export async function getStripeForTenant(tenantId: string): Promise<Stripe> {
	const [integration] = await db
		.select()
		.from(table.stripeIntegration)
		.where(eq(table.stripeIntegration.tenantId, tenantId))
		.limit(1);

	if (integration && integration.isActive) {
		const secret = decrypt(tenantId, integration.secretKeyEncrypted);
		const fp = fingerprint(secret);
		const cached = cache.get(tenantId);
		if (cached && cached.secretFingerprint === fp) {
			return cached.stripe;
		}
		const stripe = buildClient(secret);
		cache.set(tenantId, { stripe, secretFingerprint: fp });
		return stripe;
	}

	// Fallback: tenant-ul actual `ots` care încă rulează pe env vars (Sprint 8 setup).
	// Migration script va muta cheia în DB; după aceea fallback-ul ăsta devine inutil
	// și poate fi șters.
	const fallbackTenantSlug = env.PUBLIC_HOSTING_TENANT_SLUG ?? 'ots';
	const [fallbackTenant] = await db
		.select({ id: table.tenant.id, slug: table.tenant.slug })
		.from(table.tenant)
		.where(eq(table.tenant.id, tenantId))
		.limit(1);

	if (
		fallbackTenant?.slug === fallbackTenantSlug &&
		env.STRIPE_SECRET_KEY &&
		!env.STRIPE_SECRET_KEY.includes('REPLACE_ME')
	) {
		logInfo('directadmin', 'Stripe FALLBACK env vars folosit', {
			tenantId,
			metadata: { reason: 'no integration row + matches PUBLIC_HOSTING_TENANT_SLUG' }
		});
		const cached = cache.get(`${tenantId}:env`);
		if (cached) return cached.stripe;
		const stripe = buildClient(env.STRIPE_SECRET_KEY);
		cache.set(`${tenantId}:env`, { stripe, secretFingerprint: fingerprint(env.STRIPE_SECRET_KEY) });
		return stripe;
	}

	throw new StripeNotConfiguredError(tenantId);
}

/**
 * Sync helper — verifică dacă tenantul are stripe configurat (DB sau fallback)
 * fără să arunce. Folosit pentru gate-uri UI / feature flags.
 */
export async function isStripeConfiguredForTenant(tenantId: string): Promise<boolean> {
	try {
		await getStripeForTenant(tenantId);
		return true;
	} catch {
		return false;
	}
}

/**
 * Invalidate cache pentru un tenant — apelat după save credentials din settings UI.
 */
export function clearStripeCache(tenantId: string) {
	cache.delete(tenantId);
	cache.delete(`${tenantId}:env`);
}

/**
 * Obține webhook secret per-tenant (decrypted) sau fallback la env.
 * Returnează null dacă tenant n-are webhook secret configurat (UI trebuie să
 * afișeze un warning + prompt configure).
 */
export async function getWebhookSecretForTenant(tenantId: string): Promise<string | null> {
	const [integration] = await db
		.select({ webhookSecretEncrypted: table.stripeIntegration.webhookSecretEncrypted })
		.from(table.stripeIntegration)
		.where(eq(table.stripeIntegration.tenantId, tenantId))
		.limit(1);

	if (integration?.webhookSecretEncrypted) {
		return decrypt(tenantId, integration.webhookSecretEncrypted);
	}

	// Fallback env (same logic ca Stripe instance)
	const fallbackTenantSlug = env.PUBLIC_HOSTING_TENANT_SLUG ?? 'ots';
	const [fallbackTenant] = await db
		.select({ slug: table.tenant.slug })
		.from(table.tenant)
		.where(eq(table.tenant.id, tenantId))
		.limit(1);
	if (
		fallbackTenant?.slug === fallbackTenantSlug &&
		env.STRIPE_WEBHOOK_SECRET &&
		!env.STRIPE_WEBHOOK_SECRET.includes('REPLACE_ME')
	) {
		return env.STRIPE_WEBHOOK_SECRET;
	}
	return null;
}

/**
 * Get publishable key for tenant (plain text, public-safe).
 * Used pentru a injecta în page data pentru Stripe.js Elements în viitor.
 */
export async function getPublishableKeyForTenant(tenantId: string): Promise<string | null> {
	const [integration] = await db
		.select({ publishableKey: table.stripeIntegration.publishableKey })
		.from(table.stripeIntegration)
		.where(eq(table.stripeIntegration.tenantId, tenantId))
		.limit(1);
	if (integration?.publishableKey) return integration.publishableKey;

	const fallbackTenantSlug = env.PUBLIC_HOSTING_TENANT_SLUG ?? 'ots';
	const [fallbackTenant] = await db
		.select({ slug: table.tenant.slug })
		.from(table.tenant)
		.where(eq(table.tenant.id, tenantId))
		.limit(1);
	if (fallbackTenant?.slug === fallbackTenantSlug && env.PUBLIC_STRIPE_PUBLISHABLE_KEY) {
		return env.PUBLIC_STRIPE_PUBLISHABLE_KEY;
	}
	return null;
}
