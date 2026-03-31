import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { getAuthenticatedToken } from './auth';
import { listLeadForms, getLeadsByForm, listPages } from './client';
import type { MetaLeadForm, MetaLeadData } from './client';
import { logInfo, logError } from '$lib/server/logger';
import { getHooksManager } from '$lib/server/plugins/hooks';

/** Concurrency limit for parallel form fetching (respects Meta API rate limits). */
const FORM_BATCH_SIZE = 5;

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
export async function syncMetaAdsLeadsForTenant(tenantId: string, source: 'manual' | 'scheduled' = 'manual') {
	logInfo('meta-ads-leads', 'Starting lead sync for tenant', { tenantId, metadata: { source } });

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
		metadata: { totalImported, totalSkipped, totalErrors, source }
	});

	// Emit notification hook
	if (totalImported > 0) {
		try {
			const hooks = getHooksManager();
			await hooks.emit({
				type: 'leads.imported',
				tenantId,
				imported: totalImported,
				skipped: totalSkipped,
				errors: totalErrors,
				source
			});
		} catch {
			// Don't fail sync for notification errors
		}
	}

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

	// Refresh page access tokens from the user token (picks up new scopes)
	let freshPageTokens: Map<string, string> | null = null;
	try {
		const freshPages = await listPages(auth.accessToken, appSecret);
		freshPageTokens = new Map(freshPages.map((p) => [p.pageId, p.pageAccessToken]));
	} catch (err) {
		logError('meta-ads-leads', 'Failed to refresh page tokens, using stored tokens', {
			tenantId,
			metadata: { error: err instanceof Error ? err.message : String(err) }
		});
	}

	for (const page of pages) {
		try {
			// Update page token if a fresh one is available
			if (freshPageTokens?.has(page.metaPageId)) {
				const freshToken = freshPageTokens.get(page.metaPageId)!;
				if (freshToken !== page.pageAccessToken) {
					await db
						.update(table.metaAdsPage)
						.set({ pageAccessToken: freshToken, updatedAt: new Date() })
						.where(eq(table.metaAdsPage.id, page.id));
					page.pageAccessToken = freshToken;
					logInfo('meta-ads-leads', `Refreshed page token for ${page.pageName}`, {
						tenantId,
						metadata: { pageId: page.metaPageId }
					});
				}
			}

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
 * Filters to ACTIVE forms and processes them in parallel batches.
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
	const allForms = await listLeadForms(page.metaPageId, page.pageAccessToken, appSecret);

	// Only process ACTIVE forms — archived/deleted forms won't have new leads
	const forms = allForms.filter((f) => f.status === 'ACTIVE');
	const skippedForms = allForms.length - forms.length;
	if (skippedForms > 0) {
		logInfo('meta-ads-leads', `Skipped ${skippedForms} inactive forms`, {
			tenantId,
			metadata: { pageId: page.metaPageId, totalForms: allForms.length, activeForms: forms.length }
		});
	}

	// Calculate "since" timestamp — only fetch leads newer than last sync
	const since = page.lastLeadSyncAt
		? Math.floor(page.lastLeadSyncAt.getTime() / 1000)
		: undefined;

	// Process forms in parallel batches of FORM_BATCH_SIZE
	for (let i = 0; i < forms.length; i += FORM_BATCH_SIZE) {
		const batch = forms.slice(i, i + FORM_BATCH_SIZE);
		const results = await Promise.allSettled(
			batch.map((form) => syncSingleForm(tenantId, integrationId, page, form, appSecret, since))
		);

		for (const result of results) {
			if (result.status === 'fulfilled') {
				imported += result.value.imported;
				skipped += result.value.skipped;
				errors += result.value.errors;
			} else {
				errors++;
			}
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

/**
 * Sync leads from a single form. Uses batch dedup (single IN query) instead of per-lead queries.
 */
async function syncSingleForm(
	tenantId: string,
	integrationId: string,
	page: table.MetaAdsPage,
	form: MetaLeadForm,
	appSecret: string,
	since?: number
): Promise<{ imported: number; skipped: number; errors: number }> {
	let imported = 0;
	let skipped = 0;
	let errors = 0;

	try {
		const leads = await getLeadsByForm(form.formId, page.pageAccessToken, appSecret, since);

		if (leads.length === 0) {
			return { imported: 0, skipped: 0, errors: 0 };
		}

		// Batch dedup: single query to find all existing lead IDs
		const externalIds = leads.map((l) => l.leadId);
		const existingRows = await db
			.select({ externalLeadId: table.lead.externalLeadId })
			.from(table.lead)
			.where(
				and(
					inArray(table.lead.externalLeadId, externalIds),
					eq(table.lead.platform, 'facebook')
				)
			);
		const existingSet = new Set(existingRows.map((r) => r.externalLeadId));

		for (const lead of leads) {
			if (existingSet.has(lead.leadId)) {
				skipped++;
				continue;
			}

			try {
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
					clientId: page.clientId || undefined,
					integrationId,
					pageId: page.id,
					externalCreatedAt: lead.createdTime ? new Date(lead.createdTime) : new Date(),
					importedAt: new Date(),
					createdAt: new Date(),
					updatedAt: new Date()
				});

				imported++;
			} catch (err) {
				logError('meta-ads-leads', `Failed to insert lead ${lead.leadId}`, {
					tenantId,
					metadata: { formId: form.formId, error: err instanceof Error ? err.message : String(err) }
				});
				errors++;
			}
		}
	} catch (err) {
		logError('meta-ads-leads', `Failed to sync form ${form.formName}`, {
			tenantId,
			metadata: { formId: form.formId, error: err instanceof Error ? err.message : String(err) }
		});
		errors++;
	}

	return { imported, skipped, errors };
}
