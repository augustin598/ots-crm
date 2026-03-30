import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { getAuthenticatedToken } from './auth';
import { listLeadForms, getLeadsByForm, listPages } from './client';
import { logInfo, logError } from '$lib/server/logger';

/**
 * Extract a structured field value from Facebook's field_data array.
 */
function getFieldValue(fieldData: Array<{ name: string; values: string[] }>, fieldName: string): string | null {
	const field = fieldData.find((f) => f.name === fieldName);
	return field?.values?.[0] || null;
}

/**
 * Sync Facebook Lead Ads for a specific tenant.
 * Iterates over ALL active integrations → monitored pages → forms → leads.
 */
export async function syncMetaAdsLeadsForTenant(tenantId: string) {
	logInfo('meta-ads-leads', 'Starting lead sync for tenant', { tenantId });

	const integrations = await db
		.select()
		.from(table.metaAdsIntegration)
		.where(
			and(
				eq(table.metaAdsIntegration.tenantId, tenantId),
				eq(table.metaAdsIntegration.isActive, true)
			)
		);

	if (integrations.length === 0) {
		logInfo('meta-ads-leads', 'No active integrations found', { tenantId });
		return { imported: 0, skipped: 0, errors: 0 };
	}

	let totalImported = 0;
	let totalSkipped = 0;
	let totalErrors = 0;

	for (const integration of integrations) {
		const result = await syncLeadsForIntegration(tenantId, integration);
		totalImported += result.imported;
		totalSkipped += result.skipped;
		totalErrors += result.errors;
	}

	logInfo('meta-ads-leads', 'Lead sync completed', {
		tenantId,
		metadata: { totalImported, totalSkipped, totalErrors }
	});

	return { imported: totalImported, skipped: totalSkipped, errors: totalErrors };
}

/**
 * Sync leads for a single integration (Business Manager).
 */
async function syncLeadsForIntegration(
	tenantId: string,
	integration: table.MetaAdsIntegration
) {
	const appSecret = env.META_APP_SECRET!;
	let imported = 0;
	let skipped = 0;
	let errors = 0;

	// Get authenticated token (auto-refreshes if needed)
	const auth = await getAuthenticatedToken(integration.id);
	if (!auth) {
		logError('meta-ads-leads', 'Failed to get auth token', {
			tenantId,
			metadata: { integrationId: integration.id }
		});
		return { imported: 0, skipped: 0, errors: 1 };
	}

	// Get monitored pages for this integration
	const pages = await db
		.select()
		.from(table.metaAdsPage)
		.where(
			and(
				eq(table.metaAdsPage.integrationId, integration.id),
				eq(table.metaAdsPage.isMonitored, true)
			)
		);

	if (pages.length === 0) {
		logInfo('meta-ads-leads', 'No monitored pages for integration', {
			tenantId,
			metadata: { integrationId: integration.id }
		});
		return { imported: 0, skipped: 0, errors: 0 };
	}

	for (const page of pages) {
		try {
			const result = await syncLeadsForPage(tenantId, integration.id, page, appSecret);
			imported += result.imported;
			skipped += result.skipped;
			errors += result.errors;
		} catch (err) {
			logError('meta-ads-leads', `Failed to sync page ${page.pageName}`, {
				tenantId,
				metadata: { pageId: page.metaPageId, error: err instanceof Error ? err.message : String(err) }
			});
			errors++;
		}
	}

	return { imported, skipped, errors };
}

/**
 * Sync leads for a single Facebook Page.
 */
async function syncLeadsForPage(
	tenantId: string,
	integrationId: string,
	page: table.MetaAdsPage,
	appSecret: string
) {
	let imported = 0;
	let skipped = 0;
	let errors = 0;

	// Get all lead forms for this page
	const forms = await listLeadForms(page.metaPageId, page.pageAccessToken, appSecret);

	// Calculate "since" timestamp — only fetch leads newer than last sync
	const since = page.lastLeadSyncAt
		? Math.floor(page.lastLeadSyncAt.getTime() / 1000)
		: undefined;

	for (const form of forms) {
		try {
			const leads = await getLeadsByForm(form.formId, page.pageAccessToken, appSecret, since);

			for (const lead of leads) {
				// Dedup check
				const existing = await db
					.select({ id: table.lead.id })
					.from(table.lead)
					.where(
						and(
							eq(table.lead.externalLeadId, lead.leadId),
							eq(table.lead.platform, 'facebook')
						)
					)
					.limit(1);

				if (existing.length > 0) {
					skipped++;
					continue;
				}

				// Extract structured fields
				const fullName = getFieldValue(lead.fieldData, 'full_name');
				const email = getFieldValue(lead.fieldData, 'email');
				const phoneNumber = getFieldValue(lead.fieldData, 'phone_number');

				await db.insert(table.lead).values({
					id: crypto.randomUUID(),
					tenantId,
					platform: 'facebook',
					externalLeadId: lead.leadId,
					externalFormId: lead.formId,
					externalAdId: lead.adId,
					formName: form.formName,
					fullName,
					email,
					phoneNumber,
					fieldData: lead.fieldData,
					status: 'new',
					integrationId,
					pageId: page.id,
					externalCreatedAt: lead.createdTime ? new Date(lead.createdTime) : new Date(),
					importedAt: new Date(),
					createdAt: new Date(),
					updatedAt: new Date()
				});

				imported++;
			}
		} catch (err) {
			logError('meta-ads-leads', `Failed to sync form ${form.formName}`, {
				tenantId,
				metadata: { formId: form.formId, error: err instanceof Error ? err.message : String(err) }
			});
			errors++;
		}
	}

	// Update lastLeadSyncAt
	await db
		.update(table.metaAdsPage)
		.set({ lastLeadSyncAt: new Date(), updatedAt: new Date() })
		.where(eq(table.metaAdsPage.id, page.id));

	logInfo('meta-ads-leads', `Page sync done: ${page.pageName}`, {
		tenantId,
		metadata: { pageId: page.metaPageId, imported, skipped, errors }
	});

	return { imported, skipped, errors };
}
