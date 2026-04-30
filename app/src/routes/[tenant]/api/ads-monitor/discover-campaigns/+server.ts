import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { listActiveCampaigns } from '$lib/server/meta-ads/client';
import { getAuthenticatedToken } from '$lib/server/meta-ads/auth';
import { env } from '$env/dynamic/private';
import { logWarning, serializeError } from '$lib/server/logger';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user || !locals.tenant) throw error(401, 'Unauthorized');

	const clientId = url.searchParams.get('clientId');
	if (!clientId) throw error(400, 'clientId obligatoriu');

	// Verify client belongs to tenant
	const [client] = await db
		.select({ id: table.client.id })
		.from(table.client)
		.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, locals.tenant.id)))
		.limit(1);
	if (!client) throw error(404, 'Client inexistent');

	// Find primary ad account
	const [account] = await db
		.select({
			metaAdAccountId: table.metaAdsAccount.metaAdAccountId,
			integrationId: table.metaAdsAccount.integrationId,
			accountName: table.metaAdsAccount.accountName
		})
		.from(table.metaAdsAccount)
		.where(
			and(
				eq(table.metaAdsAccount.clientId, clientId),
				eq(table.metaAdsAccount.tenantId, locals.tenant.id),
				eq(table.metaAdsAccount.isPrimary, true)
			)
		)
		.limit(1);
	if (!account) {
		return json({
			campaigns: [],
			error: 'Clientul nu are un ad account Meta primar. Asignează unul în Settings.'
		});
	}

	const auth = await getAuthenticatedToken(account.integrationId);
	if (!auth) {
		return json({
			campaigns: [],
			error: 'Token Meta lipsă sau expirat. Re-conectează integrarea.'
		});
	}

	const appSecret = env.META_APP_SECRET;
	if (!appSecret) {
		return json({
			campaigns: [],
			error: 'META_APP_SECRET not configured'
		});
	}

	try {
		const campaigns = await listActiveCampaigns(account.metaAdAccountId, auth.accessToken, appSecret);

		// Find which are already being monitored
		const existing = await db
			.select({ externalCampaignId: table.adMonitorTarget.externalCampaignId })
			.from(table.adMonitorTarget)
			.where(
				and(
					eq(table.adMonitorTarget.tenantId, locals.tenant.id),
					eq(table.adMonitorTarget.clientId, clientId)
				)
			);
		const monitored = new Set(existing.map((e) => e.externalCampaignId));

		return json({
			adAccountId: account.metaAdAccountId,
			adAccountName: account.accountName,
			campaigns: campaigns.map((c) => ({
				campaignId: c.campaignId,
				campaignName: c.campaignName,
				status: c.status,
				objective: c.objective,
				optimizationGoal: c.optimizationGoal,
				dailyBudget: c.dailyBudget,
				lifetimeBudget: c.lifetimeBudget,
				startTime: c.startTime,
				stopTime: c.stopTime,
				alreadyMonitored: monitored.has(c.campaignId)
			}))
		});
	} catch (e) {
		const msg = serializeError(e).message;
		logWarning('ads-monitor', `discover-campaigns failed: ${msg}`, { tenantId: locals.tenant.id });
		return json({ campaigns: [], error: msg }, { status: 200 });
	}
};
