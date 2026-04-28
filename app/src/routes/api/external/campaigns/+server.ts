import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import { withApiKey } from '$lib/server/api-keys/middleware';
import { getCampaignInsightsSnapshot } from '$lib/server/campaigns/insights';

export const GET: RequestHandler = (event) =>
	withApiKey(event, 'campaigns:read', async (event, ctx) => {
		const url = event.url;
		const status = url.searchParams.get('status');
		const platform = url.searchParams.get('platform');
		const withInsights = url.searchParams.get('withInsights') === 'true';
		const limitRaw = parseInt(url.searchParams.get('limit') ?? '50', 10);
		const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;

		const conditions = [eq(table.campaign.tenantId, ctx.tenantId)];
		if (status) conditions.push(eq(table.campaign.status, status));
		if (platform) conditions.push(eq(table.campaign.platform, platform));

		const rows = await db
			.select({
				id: table.campaign.id,
				clientId: table.campaign.clientId,
				platform: table.campaign.platform,
				status: table.campaign.status,
				buildStep: table.campaign.buildStep,
				buildAttempts: table.campaign.buildAttempts,
				name: table.campaign.name,
				objective: table.campaign.objective,
				budgetType: table.campaign.budgetType,
				budgetCents: table.campaign.budgetCents,
				currencyCode: table.campaign.currencyCode,
				externalCampaignId: table.campaign.externalCampaignId,
				externalAdAccountId: table.campaign.externalAdAccountId,
				createdAt: table.campaign.createdAt,
				updatedAt: table.campaign.updatedAt,
				approvedAt: table.campaign.approvedAt,
				lastError: table.campaign.lastError
			})
			.from(table.campaign)
			.where(and(...conditions))
			.orderBy(desc(table.campaign.createdAt))
			.limit(limit);

		// Enrich active campaigns with cached insights when requested.
		// Cache TTL is 60s — concurrent calls within that window are free.
		let items: Array<(typeof rows)[number] & { insights?: unknown }> = rows;
		if (withInsights) {
			items = await Promise.all(
				rows.map(async (r) => {
					if (r.status !== 'active') return r;
					const ins = await getCampaignInsightsSnapshot(r.id, ctx.tenantId);
					return { ...r, insights: ins };
				})
			);
		}

		return {
			status: 200,
			body: {
				items,
				total: items.length,
				query: { status, platform, limit, withInsights }
			}
		};
	});
