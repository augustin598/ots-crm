import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { env } from '$env/dynamic/private';
import { logError, logInfo } from '$lib/server/logger';
import { getHooksManager } from '$lib/server/plugins/hooks';
import { buildMetaCampaign } from '$lib/server/meta-ads/campaign-create';
import { getAuthenticatedToken } from '$lib/server/meta-ads/auth';
import { validateDraftBrief, type DraftBriefInput, type ValidationResult } from './validate';

// =============================================================================
// Draft creation pipeline
// =============================================================================
//
// Called by both the external API (POST /api/external/campaigns/draft) and
// the UI (form action in /[tenant]/campaigns/new). Pure server logic, no
// HTTP framework concerns.
// =============================================================================

export type DraftStatus = 201 | 422 | 502 | 503 | 409 | 500;

export interface DraftActor {
	type: 'api_key' | 'user';
	id: string;
	apiKeyId?: string;
	userId?: string;
}

export interface DraftSuccess {
	status: 201;
	body: {
		campaignId: string;
		status: 'pending_approval';
		buildStep: 'done';
		external: {
			campaignId: string;
			adsetId: string;
			creativeId: string;
			adId: string;
		};
		approvalUrl: string;
	};
}

export interface DraftFailure {
	status: 422 | 502 | 503 | 409 | 500;
	body: {
		error: string;
		message?: string;
		errors?: ValidationResult['errors'];
		campaignId?: string;
		buildStep?: table.CampaignBuildStep;
	};
}

export type DraftResult = DraftSuccess | DraftFailure;

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

function redactBriefForAudit(input: DraftBriefInput): Record<string, unknown> {
	// Strip anything obviously PII-shaped from the brief before audit logging.
	// Keep structural fields; redact creative.body if it includes phone/email patterns.
	const brief = { ...input.brief };
	if (brief.creative) {
		const c = { ...brief.creative };
		if (typeof c.body === 'string') {
			c.body = c.body
				.replace(/\b\d{4}\s?\d{3}\s?\d{3}\b/g, '[phone]')
				.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[email]');
		}
		brief.creative = c;
	}
	return { clientId: input.clientId, platform: input.platform, brief };
}

function approvalUrlFor(tenantSlug: string, _campaignId: string): string {
	// Drafts created here are always Meta in MVP; deep-link to the Facebook tab
	// filtered to pending_approval so the operator sees just-created drafts first.
	return `/${tenantSlug}/campaigns-ads/facebook?status=pending_approval`;
}

/**
 * Create a Meta campaign draft (PAUSED) on behalf of a worker.
 *
 * Flow:
 *   1. Validate the brief (schema + tenant ownership + integration health).
 *   2. Insert a `campaign` row in status='draft'.
 *   3. Run the resumable Meta state machine (4 entities created PAUSED).
 *   4. On success: status='pending_approval'. Audit + hook event emitted.
 *   5. On transient failure: row stays at last successful step; caller retries.
 *   6. On permanent failure: row.status='failed', Meta entities rolled back.
 */
export async function createDraftCampaign(
	input: DraftBriefInput,
	tenantId: string,
	tenantSlug: string,
	actor: DraftActor
): Promise<DraftResult> {
	const validation = await validateDraftBrief(input, tenantId);
	if (!validation.valid || !validation.expandedSpec || !validation.resolved) {
		return {
			status: 422,
			body: {
				error: validation.errors[0]?.code ?? 'invalid_input',
				message: validation.errors.map((e) => `${e.field}: ${e.message}`).join('; '),
				errors: validation.errors
			}
		};
	}

	const tokenInfo = await getAuthenticatedToken(validation.resolved.integrationId);
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
		return {
			status: 500,
			body: { error: 'app_secret_missing', message: 'META_APP_SECRET is not configured' }
		};
	}

	const campaignId = generateId();
	const now = new Date();
	const briefRedacted = redactBriefForAudit(input);

	await db.insert(table.campaign).values({
		id: campaignId,
		tenantId,
		clientId: input.clientId,
		platform: 'meta',
		status: 'draft',
		buildStep: 'none',
		buildAttempts: 0,
		name: validation.expandedSpec.name,
		objective: validation.expandedSpec.objective,
		budgetType: validation.expandedSpec.budget.type,
		budgetCents: validation.expandedSpec.budget.cents,
		audienceJson: JSON.stringify(validation.expandedSpec.audience),
		creativeJson: JSON.stringify(validation.expandedSpec.creative),
		briefJson: JSON.stringify(briefRedacted),
		createdByWorkerId: input.workerId ?? null,
		createdByApiKeyId: actor.type === 'api_key' ? actor.apiKeyId ?? actor.id : null,
		externalAdAccountId: validation.resolved.adAccountId,
		createdAt: now,
		updatedAt: now
	});

	await db.insert(table.campaignAudit).values({
		id: generateId(),
		tenantId,
		campaignId,
		action: 'draft.created',
		actorType: actor.type,
		actorId: actor.id,
		payloadJson: JSON.stringify(briefRedacted)
	});

	const buildResult = await buildMetaCampaign({
		campaignId,
		spec: validation.expandedSpec,
		accessToken: tokenInfo.accessToken,
		appSecret
	});

	if (!buildResult.ok) {
		if (buildResult.classification === 'transient') {
			logInfo('meta-ads', 'Draft transient failure — caller may retry', {
				metadata: { campaignId, step: buildResult.buildStep }
			});
			return {
				status: 502,
				body: {
					error: 'platform_transient',
					message: buildResult.error,
					campaignId,
					buildStep: buildResult.buildStep
				}
			};
		}
		if (buildResult.classification === 'max_attempts_exceeded') {
			return {
				status: 409,
				body: {
					error: 'max_attempts_exceeded',
					message: buildResult.error,
					campaignId
				}
			};
		}
		// Permanent — already rolled back, hook campaign.buildFailed
		try {
			await getHooksManager().emit({
				type: 'campaign.build_failed',
				tenantId,
				campaignId,
				platform: 'meta',
				clientId: input.clientId,
				error: buildResult.error,
				rolledBack: buildResult.rolledBack
			});
		} catch (err) {
			logError('meta-ads', 'hook emit failed', {
				metadata: { error: err instanceof Error ? err.message : String(err) }
			});
		}
		return {
			status: 422,
			body: {
				error: 'platform_rejected',
				message: buildResult.error,
				campaignId,
				buildStep: buildResult.buildStep
			}
		};
	}

	// Hook: campaign.created
	try {
		await getHooksManager().emit({
			type: 'campaign.created',
			tenantId,
			campaignId,
			platform: 'meta',
			clientId: input.clientId,
			workerId: input.workerId ?? null,
			budgetCents: validation.expandedSpec.budget.cents,
			objective: validation.expandedSpec.objective
		});
	} catch (err) {
		logError('meta-ads', 'campaign.created hook emit failed', {
			metadata: { error: err instanceof Error ? err.message : String(err) }
		});
	}

	return {
		status: 201,
		body: {
			campaignId,
			status: 'pending_approval',
			buildStep: 'done',
			external: buildResult.external,
			approvalUrl: approvalUrlFor(tenantSlug, campaignId)
		}
	};
}
