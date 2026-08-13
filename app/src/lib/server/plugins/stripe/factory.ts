import Stripe from 'stripe';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
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

/**
 * Pe localhost (`vite dev`) plățile nu ating NICIODATĂ Stripe live: dacă `.env`
 * are o cheie de TEST în `STRIPE_SECRET_KEY`, ea câștigă în fața integrării din
 * DB (care pe tenantul `ots` e live). Pe build-ul de producție `dev` e false,
 * deci comportamentul rămâne exact cel de azi.
 *
 * Atenție la consumatori: în modul ăsta NU folosiți `client.stripe_customer_id`
 * (e un `cus_` din contul live — test mode nu-l cunoaște) și NU apelați
 * `getOrCreateStripeCustomer` (ar suprascrie cache-ul live cu un customer de
 * test și ar strica checkout-ul din producție, pentru că DB-ul e partajat).
 */
export function isStripeDevTestMode(): boolean {
	if (!dev) return false;
	const k = env.STRIPE_SECRET_KEY;
	return !!k && (k.startsWith('sk_test_') || k.startsWith('rk_test_'));
}

interface CachedStripe {
	stripe: Stripe;
	secretFingerprint: string; // primii 8 char din secret, pentru a detecta schimbări
}

const cache = new Map<string, CachedStripe>();

function fingerprint(secret: string): string {
	return secret.slice(0, 12); // sk_test_kIXo / sk_live_xxxx — destul pentru detect change
}

/**
 * Prefixele acceptate. `rk_` = restricted key — permisă peste tot, inclusiv la
 * plăți: e varianta recomandată de Stripe (drepturi minime), iar dacă îi lipsește
 * o permisiune, API-ul răspunde cu o eroare explicită, nu cu date greșite.
 */
const STRIPE_KEY_PREFIXES = ['sk_live_', 'sk_test_', 'rk_live_', 'rk_test_'] as const;

function buildClient(secret: string): Stripe {
	if (!STRIPE_KEY_PREFIXES.some((p) => secret.startsWith(p))) {
		throw new Error(`Stripe key format invalid (trebuie ${STRIPE_KEY_PREFIXES.join(' / ')}).`);
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

/**
 * Rezolvă cheia secretă a tenantului (DB sau fallback env), cu aceleași reguli
 * ca `getStripeForTenant`. Sursă unică de adevăr pentru ambele: dacă apar două
 * copii ale logicii, un guard (ex. `isActive`) ajunge inevitabil doar în una.
 *
 * `cacheKey` distinge cheia din DB de cea din env în cache-ul de clienți.
 */
async function resolveStripeSecret(
	tenantId: string
): Promise<{ secret: string; cacheKey: string }> {
	// Localhost = doar chei de test, indiferent ce e configurat în DB.
	if (isStripeDevTestMode()) {
		return { secret: env.STRIPE_SECRET_KEY!, cacheKey: `${tenantId}:dev-test` };
	}

	const [integration] = await db
		.select()
		.from(table.stripeIntegration)
		.where(eq(table.stripeIntegration.tenantId, tenantId))
		.limit(1);

	if (integration && integration.isActive) {
		return { secret: decrypt(tenantId, integration.secretKeyEncrypted), cacheKey: tenantId };
	}

	// H1 (audit 2026-05-31): an EXPLICITLY deactivated integration row must NOT
	// fall through to the env fallback below. Without this guard, toggling Stripe
	// off in admin for the `ots` tenant was silently bypassed by `STRIPE_SECRET_KEY`
	// env vars — checkout + webhooks kept working despite the admin "off" switch.
	// Treat deactivation as "not configured" so isStripeConfiguredForTenant() gates
	// the UI off and the webhook route stops accepting events for this tenant.
	if (integration && !integration.isActive) {
		throw new StripeNotConfiguredError(tenantId);
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
		return { secret: env.STRIPE_SECRET_KEY, cacheKey: `${tenantId}:env` };
	}

	throw new StripeNotConfiguredError(tenantId);
}

export async function getStripeForTenant(tenantId: string): Promise<Stripe> {
	const { secret, cacheKey } = await resolveStripeSecret(tenantId);
	const fp = fingerprint(secret);
	const cached = cache.get(cacheKey);
	if (cached && cached.secretFingerprint === fp) return cached.stripe;

	const stripe = buildClient(secret);
	cache.set(cacheKey, { stripe, secretFingerprint: fp });
	return stripe;
}

/**
 * Cheia secretă în clar, pentru cele câteva apeluri care NU merg prin SDK:
 * descărcarea fișierelor de raport de pe files.stripe.com (`/v1/files/:id/contents`
 * nu e expus de SDK și cere Authorization: Bearer).
 *
 * SERVER-ONLY. Nu returna niciodată valoarea asta către client, nici mascată.
 */
export async function getStripeSecretForTenant(tenantId: string): Promise<string> {
	const { secret } = await resolveStripeSecret(tenantId);
	return secret;
}

// ---------------------------------------------------------------------------
// Cheia de RAPOARTE (extrase contabile) — separată de cea de plăți
// ---------------------------------------------------------------------------

/**
 * De ce o cheie separată: Reporting API rulează DOAR pe date live („A live-mode
 * API key is required”), în timp ce integrarea de plăți poate sta legitim în
 * test mode. Mai mult, în DB avem `client.stripe_customer_id` și
 * `hosting_product.stripe_price_id` cache-uite din TEST — dacă am înlocui cheia
 * de plăți cu una live, checkout-ul ar cere Stripe-ului live niște `cus_`/`price_`
 * care nu există acolo și s-ar rupe.
 *
 * Deci: `STRIPE_REPORTING_KEY` (ideal o restricted key `rk_live_` cu drepturi
 * doar pe rapoarte + fișiere) e folosită EXCLUSIV de extrasele contabile.
 * Dacă nu e setată, cădem pe clientul normal al tenantului (comportament vechi).
 */
async function resolveReportingSecret(
	tenantId: string
): Promise<{ secret: string; cacheKey: string; dedicated: boolean }> {
	const key = env.STRIPE_REPORTING_KEY;
	if (key && !key.includes('REPLACE_ME')) {
		// Aceeași ștachetă ca fallback-ul de plăți: o cheie din env aparține unui
		// singur cont Stripe, deci o dăm doar tenantului care deține contul.
		const fallbackTenantSlug = env.PUBLIC_HOSTING_TENANT_SLUG ?? 'ots';
		const [row] = await db
			.select({ slug: table.tenant.slug })
			.from(table.tenant)
			.where(eq(table.tenant.id, tenantId))
			.limit(1);
		if (row?.slug === fallbackTenantSlug) {
			return { secret: key, cacheKey: `${tenantId}:reporting`, dedicated: true };
		}
	}
	const { secret, cacheKey } = await resolveStripeSecret(tenantId);
	return { secret, cacheKey, dedicated: false };
}

/** Client Stripe pentru rapoartele financiare (vezi `resolveReportingSecret`). */
export async function getStripeReportingClient(tenantId: string): Promise<Stripe> {
	const { secret, cacheKey } = await resolveReportingSecret(tenantId);
	const fp = fingerprint(secret);
	const cached = cache.get(cacheKey);
	if (cached && cached.secretFingerprint === fp) return cached.stripe;

	const stripe = buildClient(secret);
	cache.set(cacheKey, { stripe, secretFingerprint: fp });
	return stripe;
}

/** Cheia în clar pentru descărcarea fișierelor de raport. SERVER-ONLY. */
export async function getStripeReportingSecret(tenantId: string): Promise<string> {
	const { secret } = await resolveReportingSecret(tenantId);
	return secret;
}

/**
 * Ce cheie folosesc rapoartele, fără a expune secretul — pentru badge-ul din UI.
 * `mode` vine din prefixul real al cheii, nu din flagul `is_test_mode` din DB
 * (care descrie integrarea de plăți și ar minți despre rapoarte).
 */
export async function getStripeReportingKeyInfo(
	tenantId: string
): Promise<{ mode: 'live' | 'test'; restricted: boolean; dedicated: boolean }> {
	const { secret, dedicated } = await resolveReportingSecret(tenantId);
	return {
		mode: secret.includes('_live_') ? 'live' : 'test',
		restricted: secret.startsWith('rk_'),
		dedicated
	};
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
	cache.delete(`${tenantId}:dev-test`);
	for (const key of taxRateCache.keys()) {
		if (key.startsWith(`${tenantId}:`)) taxRateCache.delete(key);
	}
}

/**
 * Get/create a Stripe Tax Rate for the tenant's VAT percentage.
 *
 * Used to make Stripe collect VAT on top of the NET catalog price so the amount
 * Stripe charges == the gross total shown to the customer == the Keez fiscal
 * invoice total (audit C1: previously Stripe charged only NET while the UI and
 * Keez invoice were gross → VAT promised + invoiced but never collected).
 *
 * Stripe Tax Rates are IMMUTABLE and can't be deleted (only archived), so we
 * reuse an existing active rate with the same percentage + display_name when one
 * exists, and only create a new one otherwise. Cached per (tenant, percent).
 *
 * `inclusive: false` → the rate is added ON TOP of the line item's unit_amount
 * (which is the NET catalog price). The hosting Price stays `tax_behavior:'exclusive'`.
 */
const taxRateCache = new Map<string, string>(); // `${tenantId}:${percent}` → tax_rate id
export async function getOrCreateStripeTaxRate(
	tenantId: string,
	percent: number
): Promise<string> {
	const key = `${tenantId}:${percent}`;
	const cached = taxRateCache.get(key);
	if (cached) return cached;

	const stripe = await getStripeForTenant(tenantId);

	// Reuse an existing active rate (Tax Rates are immutable + undeletable, so
	// creating one per checkout would leak rows fast). Match on percentage +
	// our display name so we don't pick up a manually-created Stripe Tax rate.
	const existing = await stripe.taxRates.list({ active: true, limit: 100 });
	const match = existing.data.find(
		(r) => Number(r.percentage) === percent && r.inclusive === false && r.display_name === 'TVA'
	);
	if (match) {
		taxRateCache.set(key, match.id);
		return match.id;
	}

	const created = await stripe.taxRates.create({
		display_name: 'TVA',
		description: `TVA ${percent}% (România)`,
		percentage: percent,
		inclusive: false,
		country: 'RO',
		metadata: { crmTenantId: tenantId }
	});
	taxRateCache.set(key, created.id);
	logInfo('directadmin', `Stripe Tax Rate ${created.id} created/cached (TVA ${percent}%)`, {
		tenantId,
		metadata: { taxRateId: created.id, percent }
	});
	return created.id;
}

/**
 * Obține webhook secret per-tenant (decrypted) sau fallback la env.
 * Returnează null dacă tenant n-are webhook secret configurat (UI trebuie să
 * afișeze un warning + prompt configure).
 */
export async function getWebhookSecretForTenant(tenantId: string): Promise<string | null> {
	// Localhost cu chei de test: secretul vine din env (`stripe listen` local),
	// nu din DB — secretul din DB aparține endpoint-ului live din producție.
	if (isStripeDevTestMode() && env.STRIPE_WEBHOOK_SECRET && !env.STRIPE_WEBHOOK_SECRET.includes('REPLACE_ME')) {
		return env.STRIPE_WEBHOOK_SECRET;
	}

	const [integration] = await db
		.select({
			webhookSecretEncrypted: table.stripeIntegration.webhookSecretEncrypted,
			isActive: table.stripeIntegration.isActive
		})
		.from(table.stripeIntegration)
		.where(eq(table.stripeIntegration.tenantId, tenantId))
		.limit(1);

	// Respect admin's "disable" toggle — dacă integrarea a fost marcată inactivă,
	// nu folosim webhook secret-ul din DB. Asta blochează webhook-urile primite
	// fără să facem cleanup pe DB (admin poate reactiva tenant-ul oricând).
	if (integration?.webhookSecretEncrypted && integration.isActive) {
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
	// Perechea publică a override-ului de localhost — fără ea, Elements ar primi
	// un clientSecret de test cu o cheie publishable live și ar eșua criptic.
	const devPublishable = publicEnv.PUBLIC_STRIPE_PUBLISHABLE_KEY;
	if (isStripeDevTestMode() && devPublishable?.startsWith('pk_test_')) {
		return devPublishable;
	}

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
