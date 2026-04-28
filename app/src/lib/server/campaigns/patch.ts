import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { env } from '$env/dynamic/private';
import { logError } from '$lib/server/logger';
import { getHooksManager } from '$lib/server/plugins/hooks';
import { getAuthenticatedToken } from '$lib/server/meta-ads/auth';
import { toggleCampaignStatus } from '$lib/server/meta-ads/client';
import { deleteMetaCampaignEntities } from '$lib/server/meta-ads/campaign-create';

// =============================================================================
// Campaign mutations: approve | pause | archive
//
// All three are unified into one entry: applyCampaignAction(). The external
// route exposes them as `PATCH /api/external/campaigns/:id { action: ... }`.
// The UI form actions call this function directly.
// =============================================================================

export type CampaignAction = 'approve' | 'pause' | 'archive';

export interface PatchActor {
	type: 'api_key' | 'user';
	id: string;
	apiKeyId?: string;
	userId?: string;
}

export interface PatchResult {
	status: 200 | 400 | 403 | 404 | 409 | 422 | 500 | 502 | 503;
	body: {
		error?: string;
		message?: string;
		id?: string;
		status?: table.CampaignStatus;
		/** Populated when archive ran with deleteFromPlatform=true. */
		platformCleanup?: {
			deleted: string[];
			failed: Array<{ id: string; kind: 'campaign' | 'adset' | 'creative' | 'ad'; error: string }>;
		};
	};
}

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

export async function applyCampaignAction(input: {
	campaignId: string;
	tenantId: string;
	action: CampaignAction;
	actor: PatchActor;
	/** Only honored when action='archive'. DELETEs the 4 Meta entities in
	 *  reverse order (ad → creative → adset → campaign). Best-effort —
	 *  per-entity failures are reported but don't fail the archive. */
	deleteFromPlatform?: boolean;
}): Promise<PatchResult> {
	const [row] = await db
		.select()
		.from(table.campaign)
		.where(
			and(eq(table.campaign.id, input.campaignId), eq(table.campaign.tenantId, input.tenantId))
		)
		.limit(1);

	if (!row) {
		return { status: 404, body: { error: 'not_found' } };
	}

	if (row.platform !== 'meta') {
		return {
			status: 409,
			body: { error: 'platform_not_implemented', message: 'Only Meta supported in MVP' }
		};
	}

	const allowedTransitions: Record<CampaignAction, table.CampaignStatus[]> = {
		approve: ['pending_approval', 'paused'],
		pause: ['active', 'pending_approval'],
		archive: ['draft', 'pending_approval', 'active', 'paused', 'failed']
	};

	const currentStatus = row.status as table.CampaignStatus;
	if (!allowedTransitions[input.action].includes(currentStatus)) {
		return {
			status: 409,
			body: {
				error: 'invalid_state',
				message: `Cannot ${input.action} from status='${currentStatus}'`
			}
		};
	}

	if (input.action === 'archive') {
		const now = new Date();
		let platformCleanup: PatchResult['body']['platformCleanup'];

		if (input.deleteFromPlatform && row.externalCampaignId) {
			const [adAccount] = await db
				.select({ integrationId: table.metaAdsAccount.integrationId })
				.from(table.metaAdsAccount)
				.where(
					and(
						eq(table.metaAdsAccount.tenantId, input.tenantId),
						eq(table.metaAdsAccount.metaAdAccountId, row.externalAdAccountId ?? '')
					)
				)
				.limit(1);
			const tokenInfo = adAccount ? await getAuthenticatedToken(adAccount.integrationId) : null;
			const appSecret = env.META_APP_SECRET;
			if (tokenInfo && appSecret) {
				platformCleanup = await deleteMetaCampaignEntities(
					{
						campaignId: row.externalCampaignId,
						adsetId: row.externalAdsetId,
						creativeId: row.externalCreativeId,
						adId: row.externalAdId
					},
					tokenInfo.accessToken,
					appSecret
				);
			} else {
				platformCleanup = {
					deleted: [],
					failed: [
						{
							id: row.externalCampaignId,
							kind: 'campaign',
							error: tokenInfo
								? 'app_secret_missing'
								: 'token_unavailable — campaign archived in CRM only'
						}
					]
				};
			}
		}

		await db
			.update(table.campaign)
			.set({ status: 'archived', updatedAt: now })
			.where(eq(table.campaign.id, input.campaignId));
		await writeAudit({
			campaignId: input.campaignId,
			tenantId: input.tenantId,
			action: 'archived',
			actor: input.actor,
			payload: {
				from: currentStatus,
				deleteFromPlatform: Boolean(input.deleteFromPlatform),
				platformCleanup: platformCleanup ?? null
			}
		});
		return {
			status: 200,
			body: { id: input.campaignId, status: 'archived', platformCleanup }
		};
	}

	// approve / pause both call Meta toggleCampaignStatus
	if (!row.externalCampaignId) {
		return {
			status: 409,
			body: {
				error: 'no_external_campaign',
				message: 'Campaign was never built on Meta — cannot toggle status'
			}
		};
	}

	const tokenInfo = await getAuthenticatedToken(
		// resolve integration via metaAdsAccount
		(
			await db
				.select({ id: table.metaAdsAccount.integrationId })
				.from(table.metaAdsAccount)
				.where(
					and(
						eq(table.metaAdsAccount.tenantId, input.tenantId),
						eq(table.metaAdsAccount.metaAdAccountId, row.externalAdAccountId ?? '')
					)
				)
				.limit(1)
		)[0]?.id ?? ''
	);

	if (!tokenInfo) {
		return {
			status: 503,
			body: {
				error: 'token_refresh_failed',
				message: 'Could not obtain a valid Meta access token'
			}
		};
	}

	const appSecret = env.META_APP_SECRET;
	if (!appSecret) {
		return { status: 500, body: { error: 'app_secret_missing' } };
	}

	const newMetaStatus = input.action === 'approve' ? 'ACTIVE' : 'PAUSED';
	try {
		await toggleCampaignStatus(
			row.externalCampaignId,
			tokenInfo.accessToken,
			appSecret,
			newMetaStatus
		);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		// Be conservative: classify as transient unless message contains a known permanent code
		const isPermanent = /invalid|denied|not allowed|disabled/i.test(message);
		return {
			status: isPermanent ? 422 : (502 as 502),
			body: { error: isPermanent ? 'platform_rejected' : 'platform_transient', message }
		};
	}

	const now = new Date();
	const newCrmStatus: table.CampaignStatus = input.action === 'approve' ? 'active' : 'paused';
	const updates: Partial<typeof table.campaign.$inferInsert> = {
		status: newCrmStatus,
		updatedAt: now,
		lastError: null
	};
	if (input.action === 'approve') {
		updates.approvedAt = now;
		updates.approvedByUserId = input.actor.userId ?? null;
	} else {
		updates.pausedAt = now;
		updates.pausedByUserId = input.actor.userId ?? null;
	}

	await db.update(table.campaign).set(updates).where(eq(table.campaign.id, input.campaignId));

	await writeAudit({
		campaignId: input.campaignId,
		tenantId: input.tenantId,
		action: input.action === 'approve' ? 'approved' : 'paused',
		actor: input.actor,
		payload: { from: currentStatus, to: newCrmStatus, metaStatus: newMetaStatus }
	});

	try {
		if (input.action === 'approve') {
			await getHooksManager().emit({
				type: 'campaign.approved',
				tenantId: input.tenantId,
				campaignId: input.campaignId,
				actorType: input.actor.type,
				actorId: input.actor.id
			});
		} else {
			await getHooksManager().emit({
				type: 'campaign.paused',
				tenantId: input.tenantId,
				campaignId: input.campaignId,
				actorType: input.actor.type,
				actorId: input.actor.id
			});
		}
	} catch (err) {
		logError('meta-ads', 'campaign patch hook emit failed', {
			metadata: { error: err instanceof Error ? err.message : String(err) }
		});
	}

	return { status: 200, body: { id: input.campaignId, status: newCrmStatus } };
}

async function writeAudit(input: {
	campaignId: string;
	tenantId: string;
	action: string;
	actor: PatchActor;
	payload: Record<string, unknown>;
	error?: string;
}): Promise<void> {
	await db.insert(table.campaignAudit).values({
		id: generateId(),
		tenantId: input.tenantId,
		campaignId: input.campaignId,
		action: input.action,
		actorType: input.actor.type,
		actorId: input.actor.id,
		payloadJson: JSON.stringify(input.payload),
		errorMessage: input.error ?? null
	});
}
