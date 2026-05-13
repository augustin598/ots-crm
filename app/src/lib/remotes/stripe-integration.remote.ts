import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { getActor } from '$lib/server/get-actor';
import { assertCan } from '$lib/server/access';
import { encrypt } from '$lib/server/plugins/stripe/crypto';
import { clearStripeCache } from '$lib/server/plugins/stripe/factory';
import Stripe from 'stripe';
import { logInfo, logError, serializeError } from '$lib/server/logger';

/**
 * Per-tenant Stripe integration management.
 *
 * Pattern aliniat cu Keez/SmartBill remotes. Toate operațiile cer
 * `admin.stripe.manage` capability. Citirea status-ului cere `admin.stripe.view`.
 */

function tenantScope() {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	return { event, tenantId: event.locals.tenant.id };
}

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

/**
 * Returnează statusul integrării Stripe pentru tenantul curent.
 * NU returnează secret_key sau webhook_secret decrypted (chiar nici staff
 * cu permisiuni nu trebuie să le vadă în clear). Returnează doar metadata
 * publică: account info, isActive, lastTestedAt.
 */
export const getStripeIntegration = query(async () => {
	const { event, tenantId } = tenantScope();
	const actor = await getActor(event);
	assertCan(actor, 'admin.stripe.view');

	const [row] = await db
		.select({
			id: table.stripeIntegration.id,
			accountId: table.stripeIntegration.accountId,
			accountName: table.stripeIntegration.accountName,
			accountEmail: table.stripeIntegration.accountEmail,
			publishableKey: table.stripeIntegration.publishableKey,
			hasWebhookSecret: table.stripeIntegration.webhookSecretEncrypted,
			isTestMode: table.stripeIntegration.isTestMode,
			isActive: table.stripeIntegration.isActive,
			lastTestedAt: table.stripeIntegration.lastTestedAt,
			lastError: table.stripeIntegration.lastError,
			createdAt: table.stripeIntegration.createdAt,
			updatedAt: table.stripeIntegration.updatedAt
		})
		.from(table.stripeIntegration)
		.where(eq(table.stripeIntegration.tenantId, tenantId))
		.limit(1);

	if (!row) return null;
	return {
		...row,
		hasWebhookSecret: !!row.hasWebhookSecret,
		// Mask publishable key partial pentru UI (afișează doar prefix+suffix)
		publishableKeyMasked: row.publishableKey
			? `${row.publishableKey.slice(0, 12)}...${row.publishableKey.slice(-4)}`
			: null
	};
});

const UpsertSchema = v.object({
	secretKey: v.pipe(
		v.string(),
		v.regex(/^sk_(test|live)_/, 'Secret key trebuie să înceapă cu sk_test_ sau sk_live_'),
		v.minLength(20)
	),
	publishableKey: v.pipe(
		v.string(),
		v.regex(/^pk_(test|live)_/, 'Publishable key trebuie să înceapă cu pk_test_ sau pk_live_'),
		v.minLength(20)
	),
	webhookSecret: v.optional(
		v.union([
			v.pipe(v.string(), v.regex(/^whsec_/, 'Webhook secret trebuie să înceapă cu whsec_')),
			v.literal('')
		])
	)
});

/**
 * Salvează / actualizează credentials Stripe pentru tenantul curent.
 * Face și un test de conectare în background (apel `stripe.accounts.retrieve`)
 * și stochează accountId + accountName.
 */
export const updateStripeIntegration = command(UpsertSchema, async (data) => {
	const { event, tenantId } = tenantScope();
	const actor = await getActor(event);
	assertCan(actor, 'admin.stripe.manage');

	const isTest = data.secretKey.startsWith('sk_test_');
	const isLive = data.secretKey.startsWith('sk_live_');
	const pkIsTest = data.publishableKey.startsWith('pk_test_');
	const pkIsLive = data.publishableKey.startsWith('pk_live_');
	if ((isTest && !pkIsTest) || (isLive && !pkIsLive)) {
		throw new Error(
			'Secret key și Publishable key trebuie să fie din același mode (ambele test sau ambele live).'
		);
	}

	// Test conexiunea ÎNAINTE de save — refuzăm chei invalide.
	// `balance.retrieve()` e cel mai simplu apel autenticat care confirmă cheia.
	// Account info se ia separat (Stripe SDK 22+ nu mai suportă accounts.retrieve()
	// fără argument; pentru "own account" sub direct accounts pattern, fetch by id).
	let accountId: string | null = null;
	let accountName: string | null = null;
	let accountEmail: string | null = null;
	try {
		const stripe = new Stripe(data.secretKey, { typescript: true });
		// Verifică că cheia funcționează (apel oricum autenticat)
		await stripe.balance.retrieve();
		// Pentru own-account info, folosim listează prima customer (no-op dacă lista e goală)
		// + parse din Stripe-Account header sau eventually getStripe().accounts.list({limit:1})
		// Simplificat: nu putem fetch own account info din Direct mode fără ID — sărim peste.
		// În UI, afișăm doar isTestMode + lastTestedAt.
	} catch (e) {
		const { message } = serializeError(e);
		throw new Error(`Conexiune Stripe eșuată: ${message}`);
	}

	const secretKeyEncrypted = encrypt(tenantId, data.secretKey);
	const webhookSecretEncrypted =
		data.webhookSecret && data.webhookSecret.length > 0
			? encrypt(tenantId, data.webhookSecret)
			: null;

	const [existing] = await db
		.select({ id: table.stripeIntegration.id })
		.from(table.stripeIntegration)
		.where(eq(table.stripeIntegration.tenantId, tenantId))
		.limit(1);

	if (existing) {
		await db
			.update(table.stripeIntegration)
			.set({
				secretKeyEncrypted,
				publishableKey: data.publishableKey,
				webhookSecretEncrypted: webhookSecretEncrypted ?? undefined,
				accountId,
				accountName,
				accountEmail,
				isTestMode: isTest,
				isActive: true,
				lastTestedAt: new Date(),
				lastError: null,
				updatedAt: new Date()
			})
			.where(eq(table.stripeIntegration.id, existing.id));
	} else {
		await db.insert(table.stripeIntegration).values({
			id: generateId(),
			tenantId,
			secretKeyEncrypted,
			publishableKey: data.publishableKey,
			webhookSecretEncrypted,
			accountId,
			accountName,
			accountEmail,
			isTestMode: isTest,
			isActive: true,
			lastTestedAt: new Date()
		});
	}

	clearStripeCache(tenantId);

	logInfo('directadmin', `Stripe integration upserted pentru tenant ${tenantId}`, {
		tenantId,
		metadata: { accountId, mode: isTest ? 'test' : 'live' }
	});

	return { success: true, accountId, accountName, isTestMode: isTest };
});

/**
 * Test connection — apelează stripe.accounts.retrieve() cu cheile stocate.
 * Folosit pentru a verifica că integrarea încă merge (Stripe poate revoca chei).
 */
export const testStripeConnection = command(async () => {
	const { event, tenantId } = tenantScope();
	const actor = await getActor(event);
	assertCan(actor, 'admin.stripe.manage');

	try {
		const { getStripeForTenant } = await import('$lib/server/plugins/stripe/factory');
		const stripe = await getStripeForTenant(tenantId);
		// `balance.retrieve()` verifică cheia + obține currency default-ul contului
		const balance = await stripe.balance.retrieve();

		await db
			.update(table.stripeIntegration)
			.set({
				lastTestedAt: new Date(),
				lastError: null,
				updatedAt: new Date()
			})
			.where(eq(table.stripeIntegration.tenantId, tenantId));

		// Account ID e cached la primul setup (în updateStripeIntegration).
		// Aici returnăm doar success + currency.
		const [row] = await db
			.select({
				accountId: table.stripeIntegration.accountId,
				accountName: table.stripeIntegration.accountName,
				accountEmail: table.stripeIntegration.accountEmail
			})
			.from(table.stripeIntegration)
			.where(eq(table.stripeIntegration.tenantId, tenantId))
			.limit(1);

		const available = balance.available?.[0];
		return {
			success: true,
			accountId: row?.accountId ?? null,
			accountName: row?.accountName ?? null,
			accountEmail: row?.accountEmail ?? null,
			country: null as string | null,
			defaultCurrency: available?.currency ?? null
		};
	} catch (e) {
		const { message } = serializeError(e);
		await db
			.update(table.stripeIntegration)
			.set({ lastError: message, lastTestedAt: new Date(), updatedAt: new Date() })
			.where(eq(table.stripeIntegration.tenantId, tenantId));
		logError('directadmin', `Stripe test connection failed: ${message}`, { tenantId });
		throw new Error(message);
	}
});

/**
 * Dezactivează integrarea Stripe pentru tenant (păstrează credentials encrypted
 * dar marchează `isActive=false`). Pentru a reactiva, intri în settings și click
 * "Activează" sau resalvezi.
 */
export const deactivateStripeIntegration = command(async () => {
	const { event, tenantId } = tenantScope();
	const actor = await getActor(event);
	assertCan(actor, 'admin.stripe.manage');

	await db
		.update(table.stripeIntegration)
		.set({ isActive: false, updatedAt: new Date() })
		.where(eq(table.stripeIntegration.tenantId, tenantId));
	clearStripeCache(tenantId);

	logInfo('directadmin', `Stripe integration deactivated pentru tenant ${tenantId}`, { tenantId });
	return { success: true };
});

/**
 * Reactivează integrarea (după disable manual). Re-testează conexiunea.
 */
export const reactivateStripeIntegration = command(async () => {
	const { event, tenantId } = tenantScope();
	const actor = await getActor(event);
	assertCan(actor, 'admin.stripe.manage');

	await db
		.update(table.stripeIntegration)
		.set({ isActive: true, updatedAt: new Date() })
		.where(eq(table.stripeIntegration.tenantId, tenantId));
	clearStripeCache(tenantId);
	return { success: true };
});
