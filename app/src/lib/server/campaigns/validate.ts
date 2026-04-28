import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { getAuthenticatedToken } from '$lib/server/meta-ads/auth';
import { env } from '$env/dynamic/private';
import type { MetaCampaignSpec } from '$lib/server/meta-ads/campaign-create';

// Allowed Meta objectives & optimization goals (subset relevant to MVP).
// Workers MUST pick from these; anything else is rejected at /draft/validate.
export const META_OBJECTIVES = [
	'OUTCOME_LEADS',
	'OUTCOME_TRAFFIC',
	'OUTCOME_SALES',
	'OUTCOME_AWARENESS',
	'OUTCOME_ENGAGEMENT',
	'OUTCOME_APP_PROMOTION'
] as const;
export type MetaObjective = (typeof META_OBJECTIVES)[number];

export const META_OPTIMIZATION_GOALS = [
	'LEAD_GENERATION',
	'LINK_CLICKS',
	'OFFSITE_CONVERSIONS',
	'REACH',
	'IMPRESSIONS',
	'POST_ENGAGEMENT',
	'APP_INSTALLS',
	'LANDING_PAGE_VIEWS'
] as const;

export const META_CALL_TO_ACTIONS = [
	'LEARN_MORE',
	'SIGN_UP',
	'CONTACT_US',
	'BOOK_TRAVEL',
	'GET_QUOTE',
	'SHOP_NOW',
	'DOWNLOAD',
	'GET_OFFER',
	'SUBSCRIBE'
] as const;

export interface DraftBriefInput {
	clientId: string;
	platform: 'meta' | 'tiktok' | 'google';
	/** Optional: pin to a specific Meta ad account (e.g. "act_818842774503712").
	 *  Must belong to clientId and have isActive=true. Fallback: first active account. */
	adAccountId?: string;
	brief: {
		name?: string;
		objective: string;
		budget: { type: 'daily' | 'lifetime'; cents: number };
		audience?: MetaCampaignSpec['audience'];
		creative?: Partial<MetaCampaignSpec['creative']>;
		optimizationGoal?: string;
		billingEvent?: string;
	};
	workerId?: string;
}

export interface ValidationResult {
	valid: boolean;
	errors: Array<{ field: string; code: string; message: string }>;
	expandedSpec?: MetaCampaignSpec;
	resolved?: {
		tenantId: string;
		clientId: string;
		clientName: string;
		integrationId: string;
		adAccountId: string;
		appSecretConfigured: boolean;
		tokenStatus: 'valid' | 'expired' | 'missing';
	};
}

/**
 * Validate a draft campaign brief WITHOUT touching Meta. Used by /draft/validate
 * for early failure detection before consuming Meta API quota.
 *
 * Checks:
 *   - tenant ownership of client
 *   - platform supported (only 'meta' in MVP)
 *   - objective + optimizationGoal in allowed enums
 *   - budget integer cents > minimum
 *   - client has an active metaAdsAccount with a Meta integration
 *   - integration token is present and not permanently expired
 *   - META_APP_SECRET env var is set
 */
export async function validateDraftBrief(
	input: DraftBriefInput,
	tenantId: string
): Promise<ValidationResult> {
	const errors: Array<{ field: string; code: string; message: string }> = [];

	if (input.platform !== 'meta') {
		errors.push({
			field: 'platform',
			code: 'platform_not_implemented',
			message: `MVP supports only 'meta'; received '${input.platform}'`
		});
		return { valid: false, errors };
	}

	if (!input.clientId || typeof input.clientId !== 'string') {
		errors.push({ field: 'clientId', code: 'invalid_input', message: 'clientId required' });
	}
	if (!input.brief?.objective || !META_OBJECTIVES.includes(input.brief.objective as MetaObjective)) {
		errors.push({
			field: 'brief.objective',
			code: 'invalid_input',
			message: `objective must be one of: ${META_OBJECTIVES.join(', ')}`
		});
	}
	if (
		!input.brief?.budget ||
		!['daily', 'lifetime'].includes(input.brief.budget.type) ||
		!Number.isInteger(input.brief.budget.cents) ||
		input.brief.budget.cents < 100
	) {
		errors.push({
			field: 'brief.budget',
			code: 'invalid_input',
			message: 'budget.type must be daily|lifetime and budget.cents an integer >= 100'
		});
	}
	if (
		input.brief?.optimizationGoal &&
		!META_OPTIMIZATION_GOALS.includes(input.brief.optimizationGoal as any)
	) {
		errors.push({
			field: 'brief.optimizationGoal',
			code: 'invalid_input',
			message: `optimizationGoal must be one of: ${META_OPTIMIZATION_GOALS.join(', ')}`
		});
	}

	if (errors.length > 0) return { valid: false, errors };

	// Tenant ownership of client
	const [clientRow] = await db
		.select()
		.from(table.client)
		.where(and(eq(table.client.id, input.clientId), eq(table.client.tenantId, tenantId)))
		.limit(1);
	if (!clientRow) {
		errors.push({
			field: 'clientId',
			code: 'not_found',
			message: 'Client not found in this tenant'
		});
		return { valid: false, errors };
	}

	// Find an active Meta ad account for this client.
	// If adAccountId is specified, pin to that account (ownership + isActive validated).
	// Otherwise fall back to the first active account ordered by creation date (oldest first).
	let adAccount: typeof table.metaAdsAccount.$inferSelect | undefined;
	if (input.adAccountId) {
		[adAccount] = await db
			.select()
			.from(table.metaAdsAccount)
			.where(
				and(
					eq(table.metaAdsAccount.tenantId, tenantId),
					eq(table.metaAdsAccount.clientId, input.clientId),
					eq(table.metaAdsAccount.metaAdAccountId, input.adAccountId),
					eq(table.metaAdsAccount.isActive, true)
				)
			)
			.limit(1);
		if (!adAccount) {
			errors.push({
				field: 'adAccountId',
				code: 'ad_account_not_found',
				message: `Ad account '${input.adAccountId}' not found, not active, or does not belong to this client`
			});
			return { valid: false, errors };
		}
	} else {
		[adAccount] = await db
			.select()
			.from(table.metaAdsAccount)
			.where(
				and(
					eq(table.metaAdsAccount.tenantId, tenantId),
					eq(table.metaAdsAccount.clientId, input.clientId),
					eq(table.metaAdsAccount.isActive, true)
				)
			)
			.orderBy(table.metaAdsAccount.createdAt)
			.limit(1);
		if (!adAccount) {
			errors.push({
				field: 'clientId',
				code: 'no_meta_account',
				message: 'Client has no active Meta ad account assigned'
			});
			return { valid: false, errors };
		}
	}

	const [integration] = await db
		.select()
		.from(table.metaAdsIntegration)
		.where(
			and(
				eq(table.metaAdsIntegration.id, adAccount.integrationId),
				eq(table.metaAdsIntegration.isActive, true)
			)
		)
		.limit(1);

	if (!integration) {
		errors.push({
			field: 'integration',
			code: 'integration_inactive',
			message: 'Meta integration is inactive or missing'
		});
		return { valid: false, errors };
	}

	let tokenStatus: 'valid' | 'expired' | 'missing' = 'missing';
	if (integration.accessToken) {
		if (
			integration.tokenExpiresAt &&
			integration.tokenExpiresAt.getTime() < Date.now() - 1000
		) {
			tokenStatus = 'expired';
		} else {
			tokenStatus = 'valid';
		}
	}
	if (tokenStatus !== 'valid') {
		errors.push({
			field: 'integration',
			code: 'token_unavailable',
			message: 'Meta access token is missing or expired — re-auth required'
		});
	}

	const appSecretConfigured = Boolean(env.META_APP_SECRET);
	if (!appSecretConfigured) {
		errors.push({
			field: 'env',
			code: 'app_secret_missing',
			message: 'META_APP_SECRET env var not configured'
		});
	}

	if (errors.length > 0) {
		return {
			valid: false,
			errors,
			resolved: {
				tenantId,
				clientId: input.clientId,
				clientName:
					clientRow.name || clientRow.businessName || clientRow.legalRepresentative || clientRow.id,
				integrationId: integration.id,
				adAccountId: adAccount.metaAdAccountId,
				appSecretConfigured,
				tokenStatus
			}
		};
	}

	const objective = input.brief.objective as MetaObjective;
	const optimizationGoal =
		input.brief.optimizationGoal ?? defaultOptimizationGoal(objective);

	const expandedSpec: MetaCampaignSpec = {
		adAccountId: adAccount.metaAdAccountId,
		name: input.brief.name?.trim() || `${objective} — ${new Date().toISOString().slice(0, 10)}`,
		objective,
		budget: input.brief.budget,
		optimizationGoal,
		billingEvent: input.brief.billingEvent ?? 'IMPRESSIONS',
		audience: input.brief.audience ?? {},
		creative: {
			pageId: input.brief.creative?.pageId ?? '',
			title: input.brief.creative?.title,
			body: input.brief.creative?.body,
			linkUrl: input.brief.creative?.linkUrl,
			callToActionType: input.brief.creative?.callToActionType,
			imageUrl: input.brief.creative?.imageUrl,
			imageHash: input.brief.creative?.imageHash,
			videoId: input.brief.creative?.videoId,
			leadFormId: input.brief.creative?.leadFormId,
			instagramActorId: input.brief.creative?.instagramActorId
		}
	};

	if (!expandedSpec.creative.pageId) {
		errors.push({
			field: 'brief.creative.pageId',
			code: 'invalid_input',
			message: 'creative.pageId required (Facebook page ID for the ad)'
		});
	}

	return {
		valid: errors.length === 0,
		errors,
		expandedSpec: errors.length === 0 ? expandedSpec : undefined,
		resolved: {
			tenantId,
			clientId: input.clientId,
			clientName: clientRow.name || clientRow.businessName || clientRow.legalRepresentative || clientRow.id,
			integrationId: integration.id,
			adAccountId: adAccount.metaAdAccountId,
			appSecretConfigured,
			tokenStatus
		}
	};
}

function defaultOptimizationGoal(objective: MetaObjective): string {
	switch (objective) {
		case 'OUTCOME_LEADS':
			return 'LEAD_GENERATION';
		case 'OUTCOME_TRAFFIC':
			return 'LINK_CLICKS';
		case 'OUTCOME_SALES':
			return 'OFFSITE_CONVERSIONS';
		case 'OUTCOME_AWARENESS':
			return 'REACH';
		case 'OUTCOME_ENGAGEMENT':
			return 'POST_ENGAGEMENT';
		case 'OUTCOME_APP_PROMOTION':
			return 'APP_INSTALLS';
		default:
			return 'LINK_CLICKS';
	}
}

/**
 * Used by routes that already loaded an integration — call getAuthenticatedToken
 * to get a refreshed token. Returns null on failure (caller should respond 503).
 */
export async function loadAuthenticatedToken(integrationId: string): Promise<string | null> {
	const tokenInfo = await getAuthenticatedToken(integrationId);
	if (!tokenInfo) return null;
	return tokenInfo.accessToken;
}
