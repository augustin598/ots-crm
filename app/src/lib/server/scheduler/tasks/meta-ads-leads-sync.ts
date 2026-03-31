import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, or } from 'drizzle-orm';
import { logInfo, logError } from '$lib/server/logger';
import { syncMetaAdsLeadsForTenant } from '$lib/server/meta-ads/leads-sync';
import { createNotification } from '$lib/server/notifications';

/**
 * Process Meta Ads lead sync for all tenants with active integrations.
 * Runs every 4 hours via scheduler.
 */
export async function processMetaAdsLeadsSync() {
	logInfo('scheduler', 'Starting Meta Ads lead sync (scheduled)');

	const integrations = await db
		.select({
			tenantId: table.metaAdsIntegration.tenantId
		})
		.from(table.metaAdsIntegration)
		.where(
			and(
				eq(table.metaAdsIntegration.isActive, true),
				eq(table.metaAdsIntegration.syncEnabled, true)
			)
		);

	const tenantIds = [...new Set(integrations.map((i) => i.tenantId))];

	logInfo('scheduler', `Found ${tenantIds.length} tenants with active Meta Ads integrations for lead sync`);

	let totalImported = 0;
	let totalSkipped = 0;
	let totalErrors = 0;

	for (const tenantId of tenantIds) {
		try {
			const result = await syncMetaAdsLeadsForTenant(tenantId, 'scheduled');
			totalImported += result.imported;
			totalSkipped += result.skipped;
			totalErrors += result.errors;

			// Notify admins if new leads were imported
			if (result.imported > 0) {
				try {
					const admins = await db
						.select({ userId: table.tenantUser.userId })
						.from(table.tenantUser)
						.where(
							and(
								eq(table.tenantUser.tenantId, tenantId),
								or(eq(table.tenantUser.role, 'owner'), eq(table.tenantUser.role, 'admin'))
							)
						);

					const [tenant] = await db
						.select({ slug: table.tenant.slug })
						.from(table.tenant)
						.where(eq(table.tenant.id, tenantId))
						.limit(1);

					const link = tenant ? `/${tenant.slug}/leads/facebook-ads` : undefined;

					for (const admin of admins) {
						await createNotification({
							tenantId,
							userId: admin.userId,
							type: 'system',
							title: `${result.imported} leaduri noi importate`,
							message: `Sync automat: ${result.imported} leaduri noi din Facebook Ads`,
							link
						});
					}
				} catch {
					// Don't fail the sync for notification errors
				}
			}
		} catch (err) {
			logError('scheduler', `Meta Ads lead sync failed for tenant ${tenantId}`, {
				metadata: { error: err instanceof Error ? err.message : String(err) }
			});
			totalErrors++;
		}
	}

	logInfo('scheduler', 'Meta Ads lead sync completed', {
		metadata: { totalImported, totalSkipped, totalErrors, tenantCount: tenantIds.length }
	});

	return { totalImported, totalSkipped, totalErrors };
}
