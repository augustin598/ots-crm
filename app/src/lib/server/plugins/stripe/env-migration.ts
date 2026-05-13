import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { encrypt } from './crypto';
import { logInfo, logError, serializeError } from '$lib/server/logger';

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

/**
 * One-shot: dacă tenant-ul `PUBLIC_HOSTING_TENANT_SLUG` (default 'ots') NU are
 * încă o row în `stripe_integration` dar env vars sunt setate (Sprint 8 setup),
 * migrează cheile în DB (encrypted) ca să poată folosi pattern-ul per-tenant.
 *
 * Idempotent: skip dacă row există deja, sau dacă env vars sunt placeholder.
 *
 * Apelat la pornire în `hooks.server.ts`, cu safety guard să nu se ruleze
 * la fiecare request.
 */

let migrationRanThisProcess = false;

export async function migrateStripeFromEnv(): Promise<void> {
	if (migrationRanThisProcess) return;
	migrationRanThisProcess = true; // best-effort guard; concurrency-safe pentru un singur process

	try {
		const secret: string = env.STRIPE_SECRET_KEY ?? '';
		const publishable: string = env.PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';
		const webhookSecret: string = env.STRIPE_WEBHOOK_SECRET ?? '';

		if (!secret || secret.includes('REPLACE_ME') || !secret.startsWith('sk_')) return;
		if (!publishable || publishable.includes('REPLACE_ME') || !publishable.startsWith('pk_')) return;

		const tenantSlug = env.PUBLIC_HOSTING_TENANT_SLUG ?? 'ots';
		const [tenant] = await db
			.select({ id: table.tenant.id })
			.from(table.tenant)
			.where(eq(table.tenant.slug, tenantSlug))
			.limit(1);
		if (!tenant) {
			logInfo('directadmin', `Stripe migration skipped: tenant '${tenantSlug}' not found`, {});
			return;
		}

		const [existing] = await db
			.select({ id: table.stripeIntegration.id })
			.from(table.stripeIntegration)
			.where(eq(table.stripeIntegration.tenantId, tenant.id))
			.limit(1);
		if (existing) {
			logInfo('directadmin', `Stripe migration skipped: row already exists pentru tenant ${tenantSlug}`, {
				tenantId: tenant.id
			});
			return;
		}

		const isTestMode = secret.startsWith('sk_test_');
		await db.insert(table.stripeIntegration).values({
			id: generateId(),
			tenantId: tenant.id,
			secretKeyEncrypted: encrypt(tenant.id, secret),
			publishableKey: publishable,
			webhookSecretEncrypted:
				webhookSecret && !webhookSecret.includes('REPLACE_ME')
					? encrypt(tenant.id, webhookSecret)
					: null,
			isTestMode,
			isActive: true
		});

		logInfo(
			'directadmin',
			`Stripe migrated from env to DB pentru tenant ${tenantSlug} (${isTestMode ? 'TEST' : 'LIVE'} mode)`,
			{ tenantId: tenant.id }
		);
	} catch (e) {
		const { message, stack } = serializeError(e);
		logError('directadmin', `Stripe env migration failed: ${message}`, { stackTrace: stack });
		// Nu re-throw — failed migration nu trebuie să block-eze app startup.
	}
}
