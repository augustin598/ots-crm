import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, or } from 'drizzle-orm';
import { logInfo, logError } from '$lib/server/logger';
import { syncGoogleAdsInvoicesForTenant } from '$lib/server/google-ads/sync';
import { createNotification } from '$lib/server/notifications';

/**
 * Process Google Ads invoice sync for all active integrations
 * Runs monthly (1st of each month at 6AM)
 */
export async function processGoogleAdsInvoiceSync() {
	logInfo('scheduler', 'Starting Google Ads invoice sync', { metadata: { trigger: 'scheduled' } });

	const integrations = await db
		.select({
			tenantId: table.googleAdsIntegration.tenantId
		})
		.from(table.googleAdsIntegration)
		.where(
			and(
				eq(table.googleAdsIntegration.isActive, true),
				eq(table.googleAdsIntegration.syncEnabled, true)
			)
		);

	logInfo('scheduler', `Found ${integrations.length} active Google Ads integrations`, { metadata: { integrationCount: integrations.length } });

	let totalImported = 0;
	let totalErrors = 0;
	let totalSkipped = 0;

	for (const integration of integrations) {
		try {
			const result = await syncGoogleAdsInvoicesForTenant(integration.tenantId);
			totalImported += result.imported;
			totalErrors += result.errors;
			totalSkipped += result.skipped;
		} catch (err) {
			logError('scheduler', `Google Ads sync failed for tenant ${integration.tenantId}`, {
				metadata: { error: err instanceof Error ? err.message : String(err) }
			});
			totalErrors++;
		}
	}

	// Notify admins about expired sessions
	const tenantIds = [...new Set(integrations.map(i => i.tenantId))];
	for (const tenantId of tenantIds) {
		try {
			const [expired] = await db
				.select({ id: table.googleAdsIntegration.id })
				.from(table.googleAdsIntegration)
				.where(
					and(
						eq(table.googleAdsIntegration.tenantId, tenantId),
						eq(table.googleAdsIntegration.isActive, true),
						eq(table.googleAdsIntegration.googleSessionStatus, 'expired')
					)
				)
				.limit(1);

			if (expired) {
				const admins = await db
					.select({ userId: table.tenantUser.userId })
					.from(table.tenantUser)
					.where(
						and(
							eq(table.tenantUser.tenantId, tenantId),
							or(eq(table.tenantUser.role, 'owner'), eq(table.tenantUser.role, 'admin'))
						)
					);

				for (const admin of admins) {
					await createNotification({
						tenantId,
						userId: admin.userId,
						type: 'sync.error',
						title: 'Sesiune Google Ads expirată',
						message: 'Sesiunea Google Ads a expirat. Deschide pagina Google Ads Facturi și apasă "Scan cu Browser" pentru a reîmprospăta cookie-urile.',
						link: 'invoices/google-ads'
					});
				}
			}
		} catch {
			// Don't fail sync for notification errors
		}
	}

	logInfo('scheduler', `Google Ads invoice sync completed`, {
		metadata: { totalImported, totalErrors, totalSkipped, tenantCount: integrations.length }
	});

	return { totalImported, totalErrors, totalSkipped };
}
