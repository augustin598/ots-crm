import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { withApiKey } from '$lib/server/api-keys/middleware';
import { applyCampaignAction, type CampaignAction } from '$lib/server/campaigns/patch';
import { getCampaignInsightsSnapshot } from '$lib/server/campaigns/insights';

export const GET: RequestHandler = (event) =>
	withApiKey(event, 'campaigns:read', async (event, ctx) => {
		const id = event.params.id!;
		const [row] = await db
			.select()
			.from(table.campaign)
			.where(and(eq(table.campaign.id, id), eq(table.campaign.tenantId, ctx.tenantId)))
			.limit(1);
		if (!row) return { status: 404, body: { error: 'not_found' } };

		// Optional 60s-cached insights for active campaigns.
		// Off by default — opt-in via ?withInsights=true to control Meta API spend.
		const wantInsights = event.url.searchParams.get('withInsights') === 'true';
		const insights =
			wantInsights && row.status === 'active'
				? await getCampaignInsightsSnapshot(row.id, ctx.tenantId)
				: null;

		return {
			status: 200,
			body: {
				id: row.id,
				clientId: row.clientId,
				platform: row.platform,
				status: row.status,
				buildStep: row.buildStep,
				buildAttempts: row.buildAttempts,
				name: row.name,
				objective: row.objective,
				budgetType: row.budgetType,
				budgetCents: row.budgetCents,
				currencyCode: row.currencyCode,
				audience: safeParse(row.audienceJson),
				creative: safeParse(row.creativeJson),
				brief: safeParse(row.briefJson),
				external: {
					campaignId: row.externalCampaignId,
					adsetId: row.externalAdsetId,
					creativeId: row.externalCreativeId,
					adId: row.externalAdId,
					adAccountId: row.externalAdAccountId
				},
				insights,
				createdByWorkerId: row.createdByWorkerId,
				createdByApiKeyId: row.createdByApiKeyId,
				approvedAt: row.approvedAt,
				pausedAt: row.pausedAt,
				lastError: row.lastError,
				createdAt: row.createdAt,
				updatedAt: row.updatedAt
			}
		};
	});

export const PATCH: RequestHandler = (event) =>
	withApiKey(event, 'campaigns:write', async (event, ctx) => {
		const id = event.params.id!;
		const body = (await event.request.json().catch(() => null)) as {
			action?: CampaignAction;
			userId?: string;
		} | null;
		if (!body || !body.action || !['approve', 'pause', 'archive'].includes(body.action)) {
			return {
				status: 400,
				body: { error: 'invalid_action', message: 'action must be approve|pause|archive' }
			};
		}

		const result = await applyCampaignAction({
			campaignId: id,
			tenantId: ctx.tenantId,
			action: body.action,
			actor: { type: 'api_key', id: ctx.apiKeyId, apiKeyId: ctx.apiKeyId, userId: body.userId }
		});

		return { status: result.status, body: result.body };
	});

function safeParse(json: string): unknown {
	try {
		return JSON.parse(json);
	} catch {
		return null;
	}
}
