import { logError, logInfo, logWarning } from '$lib/server/logger';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { createHmac } from 'crypto';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { META_GRAPH_URL } from './client';

function generateAuditId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

// =============================================================================
// Resumable Meta campaign-create state machine
// =============================================================================
//
// 4 steps, each persisted to `campaign` row immediately on success so retries
// resume exactly where they left off:
//
//   none → campaign → adset → creative → ad → done
//
// Permanent failures (4xx with `is_transient=false`) trigger compensating
// rollback: any partially-created Meta entities are DELETEd in reverse order
// so we never leave orphaned objects in the customer's Business Manager.
//
// Transient failures (5xx, network, timeouts) throw and the worker retries
// using the same Idempotency-Key. The CRM resumes from the saved buildStep.
// =============================================================================

export const MAX_BUILD_ATTEMPTS = 5;

export interface MetaCampaignSpec {
	adAccountId: string; // act_XXXXXXXX (full Meta ID)
	name: string;
	objective: string; // e.g. OUTCOME_LEADS, OUTCOME_TRAFFIC, OUTCOME_SALES
	budget: { type: 'daily' | 'lifetime'; cents: number };
	optimizationGoal: string; // e.g. LEAD_GENERATION, LINK_CLICKS, OFFSITE_CONVERSIONS
	billingEvent?: string; // default IMPRESSIONS
	bidStrategy?: string; // default LOWEST_COST_WITHOUT_CAP
	specialAdCategories?: string[]; // default []
	audience: {
		geoCountries?: string[];
		geoCities?: Array<{ key: string; radius?: number; distance_unit?: 'kilometer' | 'mile' }>;
		ageMin?: number;
		ageMax?: number;
		genders?: number[]; // 1=male, 2=female (omit for all)
		interests?: Array<{ id: string; name: string }>;
		behaviors?: Array<{ id: string; name: string }>;
		customAudiences?: string[];
		locales?: number[];
	};
	creative: {
		pageId: string; // Required for all ad types
		title?: string; // headline
		body?: string;
		linkUrl?: string;
		callToActionType?: string; // LEARN_MORE, SIGN_UP, CONTACT_US, ...
		imageUrl?: string;
		imageHash?: string; // alternative to imageUrl
		videoId?: string;
		leadFormId?: string; // for OUTCOME_LEADS
		instagramActorId?: string;
	};
}

export interface BuildSuccess {
	ok: true;
	buildStep: 'done';
	external: {
		campaignId: string;
		adsetId: string;
		creativeId: string;
		adId: string;
	};
}

export interface BuildFailure {
	ok: false;
	classification: 'transient' | 'permanent' | 'max_attempts_exceeded';
	error: string;
	errorCode?: number;
	rolledBack: boolean;
	buildStep: table.CampaignBuildStep; // last step actually completed (or 'none')
}

export type BuildResult = BuildSuccess | BuildFailure;

export interface BuildInput {
	campaignId: string; // CRM campaign.id (source of truth for state)
	spec: MetaCampaignSpec;
	accessToken: string;
	appSecret: string;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function generateAppSecretProof(accessToken: string, appSecret: string): string {
	return createHmac('sha256', appSecret).update(accessToken).digest('hex');
}

interface MetaApiError extends Error {
	classification: 'transient' | 'permanent';
	errorCode?: number;
	subcode?: number;
}

function isPermanentMetaError(status: number, code: number | undefined): boolean {
	// Meta error codes considered permanent (won't recover on retry):
	// 100  = invalid_param
	// 190  = OAuth token expired / invalid
	// 200  = permission denied
	// 270  = account disabled / closed
	// 1487 = ad/creative validation failed
	// 1885 = page suspended
	if (status >= 400 && status < 500) return true;
	if (code != null && [100, 190, 200, 270, 1487, 1885].includes(code)) return true;
	return false;
}

async function metaPost(
	url: string,
	params: URLSearchParams,
	timeoutMs = 30_000
): Promise<{ data: any; status: number }> {
	const res = await fetch(url, {
		method: 'POST',
		body: params,
		signal: AbortSignal.timeout(timeoutMs)
	});
	const data = await res.json().catch(() => ({}));
	return { data, status: res.status };
}

async function metaDelete(
	entityId: string,
	accessToken: string,
	appSecret: string,
	timeoutMs = 30_000
): Promise<void> {
	const proof = generateAppSecretProof(accessToken, appSecret);
	const params = new URLSearchParams({ access_token: accessToken, appsecret_proof: proof });
	try {
		await fetch(`${META_GRAPH_URL}/${entityId}?${params.toString()}`, {
			method: 'DELETE',
			signal: AbortSignal.timeout(timeoutMs)
		});
	} catch (err) {
		logWarning('meta-ads', 'Rollback DELETE failed (continuing)', {
			metadata: { entityId, error: err instanceof Error ? err.message : String(err) }
		});
	}
}

function classifyResponse(
	status: number,
	data: any,
	context: string
): { ok: boolean; error?: MetaApiError } {
	if (status >= 200 && status < 300 && !data?.error) return { ok: true };
	const code = data?.error?.code;
	const subcode = data?.error?.error_subcode;
	const message = data?.error?.message || `HTTP ${status}`;
	const userMsg = data?.error?.error_user_msg;
	const userTitle = data?.error?.error_user_title;
	const trace = data?.error?.fbtrace_id;
	const detailParts = [
		`Meta ${context}: ${message}`,
		code ? `code=${code}` : null,
		subcode ? `subcode=${subcode}` : null,
		userTitle ? `userTitle="${userTitle}"` : null,
		userMsg ? `userMsg="${userMsg}"` : null,
		trace ? `trace=${trace}` : null
	]
		.filter(Boolean)
		.join(' | ');
	const err = new Error(detailParts) as MetaApiError;
	err.classification = isPermanentMetaError(status, code) ? 'permanent' : 'transient';
	err.errorCode = code;
	err.subcode = subcode;
	return { ok: false, error: err };
}

// ---------------------------------------------------------------------------
// Step builders — each returns the new external ID on success
// ---------------------------------------------------------------------------

function buildTargeting(audience: MetaCampaignSpec['audience']): Record<string, unknown> {
	const targeting: Record<string, unknown> = {};
	const geoLocations: Record<string, unknown> = {};
	if (audience.geoCountries?.length) geoLocations.countries = audience.geoCountries;
	if (audience.geoCities?.length)
		geoLocations.cities = audience.geoCities.map((c) => ({
			key: c.key,
			radius: c.radius ?? 25,
			distance_unit: c.distance_unit ?? 'kilometer'
		}));
	if (Object.keys(geoLocations).length > 0) targeting.geo_locations = geoLocations;
	if (audience.ageMin != null) targeting.age_min = audience.ageMin;
	if (audience.ageMax != null) targeting.age_max = audience.ageMax;
	if (audience.genders?.length) targeting.genders = audience.genders;
	if (audience.interests?.length)
		targeting.interests = audience.interests.map((i) => ({ id: i.id, name: i.name }));
	if (audience.behaviors?.length)
		targeting.behaviors = audience.behaviors.map((b) => ({ id: b.id, name: b.name }));
	if (audience.customAudiences?.length)
		targeting.custom_audiences = audience.customAudiences.map((id) => ({ id }));
	if (audience.locales?.length) targeting.locales = audience.locales;
	// Meta v18+ requires this flag explicitly. 0 = disabled (keep manual targeting),
	// 1 = enabled (Meta expands audience automatically). We default to 0 since
	// the brief specifies explicit demographics — the worker can flip this later
	// for awareness/reach campaigns where Advantage+ audience is preferred.
	targeting.targeting_automation = { advantage_audience: 0 };
	return targeting;
}

function buildCreativeSpec(
	creative: MetaCampaignSpec['creative'],
	objective: string
): Record<string, unknown> {
	const isLead = objective === 'OUTCOME_LEADS';
	const linkData: Record<string, unknown> = {
		message: creative.body || '',
		name: creative.title || '',
		link: creative.linkUrl || creative.leadFormId ? creative.linkUrl ?? '' : creative.linkUrl ?? ''
	};
	if (creative.callToActionType) {
		linkData.call_to_action = {
			type: creative.callToActionType,
			value: isLead && creative.leadFormId ? { lead_gen_form_id: creative.leadFormId } : undefined
		};
	}
	if (creative.imageUrl) linkData.picture = creative.imageUrl;
	if (creative.imageHash) linkData.image_hash = creative.imageHash;
	if (creative.videoId) {
		// For video ads we'd use video_data instead of link_data — out of scope for MVP.
		linkData.video_id = creative.videoId;
	}

	const objectStorySpec: Record<string, unknown> = { page_id: creative.pageId };
	if (creative.instagramActorId) objectStorySpec.instagram_actor_id = creative.instagramActorId;
	objectStorySpec.link_data = linkData;
	return objectStorySpec;
}

async function createCampaignStep(
	spec: MetaCampaignSpec,
	accessToken: string,
	appSecret: string
): Promise<string> {
	const proof = generateAppSecretProof(accessToken, appSecret);
	// Meta v18+ requires `special_ad_categories` to be a non-empty array.
	// Use ["NONE"] when the campaign isn't in a regulated vertical (housing,
	// employment, credit, social-issues). Caller can override with explicit values.
	const specialCats =
		spec.specialAdCategories && spec.specialAdCategories.length > 0
			? spec.specialAdCategories
			: ['NONE'];
	const params = new URLSearchParams({
		access_token: accessToken,
		appsecret_proof: proof,
		name: spec.name,
		objective: spec.objective,
		status: 'PAUSED',
		special_ad_categories: JSON.stringify(specialCats),
		// Meta v18+ requires this to be explicit when campaign-level budget is NOT
		// set. We put budget at adset level, so disable Advantage Campaign Budget
		// (formerly CBO) sharing — each adset keeps its own budget.
		is_adset_budget_sharing_enabled: 'false',
		buying_type: 'AUCTION'
	});
	const { data, status } = await metaPost(`${META_GRAPH_URL}/${spec.adAccountId}/campaigns`, params);
	const cls = classifyResponse(status, data, 'create campaign');
	if (!cls.ok) throw cls.error;
	return data.id as string;
}

function buildPromotedObject(spec: MetaCampaignSpec): Record<string, unknown> | null {
	switch (spec.objective) {
		case 'OUTCOME_LEADS':
			// page_id required for OUTCOME_LEADS regardless of lead form placement
			return { page_id: spec.creative.pageId };
		case 'OUTCOME_SALES':
			// TODO: support pixel_id + custom_event_type: 'PURCHASE' when pixel is wired
			return null;
		case 'OUTCOME_APP_PROMOTION':
			// TODO: support application_id + object_store_url when app campaigns are added
			return null;
		default:
			// OUTCOME_TRAFFIC, OUTCOME_AWARENESS, OUTCOME_ENGAGEMENT — no promoted_object
			return null;
	}
}

async function createAdsetStep(
	spec: MetaCampaignSpec,
	campaignExternalId: string,
	accessToken: string,
	appSecret: string
): Promise<string> {
	const proof = generateAppSecretProof(accessToken, appSecret);
	const targeting = buildTargeting(spec.audience);

	// For OUTCOME_LEADS, default optimization_goal to LEAD_GENERATION if not explicitly set
	const optimizationGoal =
		spec.objective === 'OUTCOME_LEADS' && !spec.optimizationGoal
			? 'LEAD_GENERATION'
			: spec.optimizationGoal;

	// Meta requires destination_type="ON_AD" for OUTCOME_LEADS + Instant Form (lead form on Meta).
	// Without it, the adset is rejected with error 100/1892040 when the creative has lead_gen_form_id.
	const destinationType =
		spec.objective === 'OUTCOME_LEADS' && spec.creative.leadFormId ? 'ON_AD' : null;

	const params = new URLSearchParams({
		access_token: accessToken,
		appsecret_proof: proof,
		name: `${spec.name} — adset`,
		campaign_id: campaignExternalId,
		status: 'PAUSED',
		[spec.budget.type === 'daily' ? 'daily_budget' : 'lifetime_budget']: String(spec.budget.cents),
		optimization_goal: optimizationGoal,
		billing_event: spec.billingEvent ?? 'IMPRESSIONS',
		bid_strategy: spec.bidStrategy ?? 'LOWEST_COST_WITHOUT_CAP',
		targeting: JSON.stringify(targeting)
	});

	if (destinationType) params.set('destination_type', destinationType);

	const promotedObject = buildPromotedObject(spec);
	if (promotedObject) params.set('promoted_object', JSON.stringify(promotedObject));

	if (process.env.NODE_ENV === 'development' || process.env.META_ADS_DEBUG === '1') {
		logInfo('meta-ads', '[DEBUG] createAdsetStep payload', {
			metadata: {
				adAccountId: spec.adAccountId,
				objective: spec.objective,
				optimizationGoal,
				destinationType,
				promotedObject,
				targeting
			}
		});
	}

	const { data, status } = await metaPost(`${META_GRAPH_URL}/${spec.adAccountId}/adsets`, params);
	const cls = classifyResponse(status, data, 'create adset');
	if (!cls.ok) throw cls.error;
	return data.id as string;
}

async function createCreativeStep(
	spec: MetaCampaignSpec,
	accessToken: string,
	appSecret: string
): Promise<string> {
	const proof = generateAppSecretProof(accessToken, appSecret);
	const objectStorySpec = buildCreativeSpec(spec.creative, spec.objective);
	const params = new URLSearchParams({
		access_token: accessToken,
		appsecret_proof: proof,
		name: `${spec.name} — creative`,
		object_story_spec: JSON.stringify(objectStorySpec)
	});
	const { data, status } = await metaPost(
		`${META_GRAPH_URL}/${spec.adAccountId}/adcreatives`,
		params
	);
	const cls = classifyResponse(status, data, 'create creative');
	if (!cls.ok) throw cls.error;
	return data.id as string;
}

async function createAdStep(
	spec: MetaCampaignSpec,
	adsetExternalId: string,
	creativeExternalId: string,
	accessToken: string,
	appSecret: string
): Promise<string> {
	const proof = generateAppSecretProof(accessToken, appSecret);
	const params = new URLSearchParams({
		access_token: accessToken,
		appsecret_proof: proof,
		name: `${spec.name} — ad`,
		adset_id: adsetExternalId,
		creative: JSON.stringify({ creative_id: creativeExternalId }),
		status: 'PAUSED'
	});
	const { data, status } = await metaPost(`${META_GRAPH_URL}/${spec.adAccountId}/ads`, params);
	const cls = classifyResponse(status, data, 'create ad');
	if (!cls.ok) throw cls.error;
	return data.id as string;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function buildMetaCampaign(input: BuildInput): Promise<BuildResult> {
	// Load current state (source of truth lives in DB, never in memory)
	const [currentRow] = await db
		.select()
		.from(table.campaign)
		.where(eq(table.campaign.id, input.campaignId))
		.limit(1);

	if (!currentRow) {
		return {
			ok: false,
			classification: 'permanent',
			error: 'campaign_row_not_found',
			rolledBack: false,
			buildStep: 'none'
		};
	}

	if (currentRow.buildAttempts >= MAX_BUILD_ATTEMPTS) {
		return {
			ok: false,
			classification: 'max_attempts_exceeded',
			error: `Max build attempts (${MAX_BUILD_ATTEMPTS}) exceeded`,
			rolledBack: false,
			buildStep: currentRow.buildStep as table.CampaignBuildStep
		};
	}

	let buildStep = currentRow.buildStep as table.CampaignBuildStep;
	let externalCampaignId = currentRow.externalCampaignId;
	let externalAdsetId = currentRow.externalAdsetId;
	let externalCreativeId = currentRow.externalCreativeId;
	let externalAdId = currentRow.externalAdId;

	// Increment attempt counter + status=building
	await db
		.update(table.campaign)
		.set({
			buildAttempts: currentRow.buildAttempts + 1,
			status: 'building',
			updatedAt: new Date()
		})
		.where(eq(table.campaign.id, input.campaignId));

	const writeAudit = async (action: string, payload: Record<string, unknown>, error?: string) => {
		await db.insert(table.campaignAudit).values({
			id: generateAuditId(),
			tenantId: currentRow.tenantId,
			campaignId: input.campaignId,
			action,
			actorType: 'system',
			actorId: 'meta-state-machine',
			payloadJson: JSON.stringify(payload),
			errorMessage: error ?? null
		});
	};

	try {
		if (buildStep === 'none') {
			externalCampaignId = await createCampaignStep(input.spec, input.accessToken, input.appSecret);
			buildStep = 'campaign';
			await db
				.update(table.campaign)
				.set({
					externalCampaignId,
					externalAdAccountId: input.spec.adAccountId,
					buildStep,
					updatedAt: new Date()
				})
				.where(eq(table.campaign.id, input.campaignId));
			await writeAudit('build.step', { step: 'campaign', externalId: externalCampaignId });
		}

		if (buildStep === 'campaign') {
			if (!externalCampaignId) throw new Error('invariant: externalCampaignId missing');
			externalAdsetId = await createAdsetStep(
				input.spec,
				externalCampaignId,
				input.accessToken,
				input.appSecret
			);
			buildStep = 'adset';
			await db
				.update(table.campaign)
				.set({ externalAdsetId, buildStep, updatedAt: new Date() })
				.where(eq(table.campaign.id, input.campaignId));
			await writeAudit('build.step', { step: 'adset', externalId: externalAdsetId });
		}

		if (buildStep === 'adset') {
			externalCreativeId = await createCreativeStep(input.spec, input.accessToken, input.appSecret);
			buildStep = 'creative';
			await db
				.update(table.campaign)
				.set({ externalCreativeId, buildStep, updatedAt: new Date() })
				.where(eq(table.campaign.id, input.campaignId));
			await writeAudit('build.step', { step: 'creative', externalId: externalCreativeId });
		}

		if (buildStep === 'creative') {
			if (!externalAdsetId || !externalCreativeId) throw new Error('invariant: missing IDs');
			externalAdId = await createAdStep(
				input.spec,
				externalAdsetId,
				externalCreativeId,
				input.accessToken,
				input.appSecret
			);
			buildStep = 'ad';
			await db
				.update(table.campaign)
				.set({ externalAdId, buildStep, updatedAt: new Date() })
				.where(eq(table.campaign.id, input.campaignId));
			await writeAudit('build.step', { step: 'ad', externalId: externalAdId });
		}

		// Final transition: ad → done. Status flips to pending_approval.
		await db
			.update(table.campaign)
			.set({
				buildStep: 'done',
				status: 'pending_approval',
				lastError: null,
				updatedAt: new Date()
			})
			.where(eq(table.campaign.id, input.campaignId));
		await writeAudit('build.step', { step: 'done' });

		logInfo('meta-ads', `Campaign build complete: ${input.campaignId}`, {
			metadata: {
				externalCampaignId,
				externalAdsetId,
				externalCreativeId,
				externalAdId
			}
		});

		return {
			ok: true,
			buildStep: 'done',
			external: {
				campaignId: externalCampaignId!,
				adsetId: externalAdsetId!,
				creativeId: externalCreativeId!,
				adId: externalAdId!
			}
		};
	} catch (err) {
		const isMeta = (err as MetaApiError)?.classification != null;
		const classification = isMeta ? (err as MetaApiError).classification : 'transient';
		const errorCode = isMeta ? (err as MetaApiError).errorCode : undefined;
		const message = err instanceof Error ? err.message : String(err);

		logError('meta-ads', `Build failed at step=${buildStep}`, {
			metadata: { campaignId: input.campaignId, classification, error: message }
		});

		let rolledBack = false;
		if (classification === 'permanent') {
			// Compensating delete: reverse order
			if (externalAdId) await metaDelete(externalAdId, input.accessToken, input.appSecret);
			if (externalCreativeId)
				await metaDelete(externalCreativeId, input.accessToken, input.appSecret);
			if (externalAdsetId) await metaDelete(externalAdsetId, input.accessToken, input.appSecret);
			if (externalCampaignId)
				await metaDelete(externalCampaignId, input.accessToken, input.appSecret);
			rolledBack = true;

			await db
				.update(table.campaign)
				.set({
					status: 'failed',
					lastError: message,
					updatedAt: new Date()
				})
				.where(eq(table.campaign.id, input.campaignId));
			await writeAudit('build.rolled_back', { step: buildStep, errorCode }, message);
		} else {
			// Transient — keep partial state so retry can resume from buildStep+1
			await db
				.update(table.campaign)
				.set({
					lastError: message,
					updatedAt: new Date()
				})
				.where(eq(table.campaign.id, input.campaignId));
			await writeAudit('build.failed', { step: buildStep, errorCode, transient: true }, message);
		}

		return {
			ok: false,
			classification,
			error: message,
			errorCode,
			rolledBack,
			buildStep
		};
	}
}

