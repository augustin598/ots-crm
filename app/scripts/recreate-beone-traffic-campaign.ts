#!/usr/bin/env bun
/**
 * Cleanup + recreate Meta campaign "Traffic — Beauty One Pro Shop — IG Reel — Mai 2026"
 * from scratch so that URL parameters appear correctly in Meta Ads Manager UI.
 *
 * PASUL 1 — Cleanup:
 *   Delete at Meta: ad → creatives → adset → campaign (catch "already gone")
 *   Delete CRM rows: campaign + campaign_audit
 *
 * PASUL 2 — Create:
 *   Check IG connection → try IG video creative (CASE A) or link_data (CASE B)
 *   url_tags passed as separate field (no ? embedded in link URL)
 *
 * Usage: cd app && bun scripts/recreate-beone-traffic-campaign.ts
 */
import { createClient } from '@libsql/client';
import { createHmac } from 'node:crypto';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { encodeBase32LowerCase } from '@oslojs/encoding';

config({ path: resolve(import.meta.dir, '..', '.env') });

const SQLITE_URI = process.env.SQLITE_URI!;
const SQLITE_AUTH_TOKEN = process.env.SQLITE_AUTH_TOKEN;
const META_APP_SECRET = process.env.META_APP_SECRET!;
const META_GRAPH_URL = 'https://graph.facebook.com/v25.0';

// IDs to delete
const DELETE_AD_ID = '120244706378930052';
const DELETE_CREATIVES = ['4203295286589872', '1588617015564997', '2771853356497245'];
const DELETE_ADSET_ID = '120244706372970052';
const DELETE_CAMPAIGN_ID = '120244706368780052';
const DELETE_CRM_ID = 'v7e26hddtdxv464xj2aujlck';

// New campaign params
const AD_ACCOUNT_ID = 'act_275835948024308';
const PAGE_ID = '1501568140081986';
const CLIENT_ID = 'g4gjn3qe6o734r64xiystdst';
const IG_SHORTCODE = 'DXyeHaFDA3L';
const PIXEL_ID = '416796931807282';
const CAMPAIGN_NAME = 'Traffic — Beauty One Pro Shop — IG Reel — Mai 2026';
const LANDING_URL = 'https://www.beautyone.ro/';
const URL_TAGS =
	'utm_source={{site_source_name}}&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_term={{adset.name}}&utm_content={{ad.name}}&placement={{placement}}';
const DAILY_BUDGET_CENTS = 5000;

const INTERESTS = [
	{ id: '6002839660079', name: 'Cosmetics' },
	{ id: '6003088846792', name: 'Beauty salons' },
	{ id: '664130153728886', name: 'Skin care' },
	{ id: '6002867432822', name: 'Beauty' },
];

if (!SQLITE_URI) { console.error('SQLITE_URI missing'); process.exit(1); }
if (!META_APP_SECRET) { console.error('META_APP_SECRET missing'); process.exit(1); }

const db = createClient({ url: SQLITE_URI, authToken: SQLITE_AUTH_TOKEN });

function hmac(token: string, secret: string): string {
	return createHmac('sha256', secret).update(token).digest('hex');
}

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

async function getToken(): Promise<string> {
	const res = await db.execute({
		sql: `SELECT i.access_token
		      FROM meta_ads_integration i
		      JOIN meta_ads_account a ON a.integration_id = i.id
		      WHERE a.meta_ad_account_id = ?
		        AND a.is_active = 1
		        AND i.is_active = 1
		      LIMIT 1`,
		args: [AD_ACCOUNT_ID],
	});
	if (res.rows.length > 0 && res.rows[0]!.access_token) {
		return res.rows[0]!.access_token as string;
	}
	const fallback = await db.execute({
		sql: `SELECT access_token FROM meta_ads_integration WHERE is_active = 1 LIMIT 1`,
		args: [],
	});
	if (!fallback.rows.length || !fallback.rows[0]!.access_token) {
		throw new Error('No active Meta integration token found in DB');
	}
	return fallback.rows[0]!.access_token as string;
}

async function metaDelete(objectId: string, token: string): Promise<'deleted' | 'already_gone' | 'error'> {
	try {
		const proof = hmac(token, META_APP_SECRET);
		const url = new URL(`${META_GRAPH_URL}/${objectId}`);
		url.searchParams.set('access_token', token);
		url.searchParams.set('appsecret_proof', proof);
		const res = await fetch(url.toString(), {
			method: 'DELETE',
			signal: AbortSignal.timeout(20_000),
		});
		const data: any = await res.json();
		if (data?.error) {
			const code = data.error.code;
			const msg: string = data.error.message ?? '';
			// Treat "does not exist" / code 100 / code 803 as already gone
			if (code === 100 || code === 803 || /does not exist/i.test(msg) || /invalid/i.test(msg)) {
				console.error(`[info] DELETE /${objectId}: already gone (code=${code})`);
				return 'already_gone';
			}
			console.error(`[warn] DELETE /${objectId}: code=${code} msg="${msg}"`);
			return 'error';
		}
		if (data?.success === true) {
			console.error(`[info] DELETE /${objectId}: success`);
			return 'deleted';
		}
		// Some objects return {id: ...} on success
		if (data?.id) {
			console.error(`[info] DELETE /${objectId}: success (got id back)`);
			return 'deleted';
		}
		console.error(`[warn] DELETE /${objectId}: unexpected response: ${JSON.stringify(data).slice(0, 120)}`);
		return 'error';
	} catch (err) {
		console.error(`[warn] DELETE /${objectId} threw: ${err instanceof Error ? err.message : String(err)}`);
		return 'error';
	}
}

async function metaGet(path: string, token: string, params: Record<string, string> = {}): Promise<any> {
	const proof = hmac(token, META_APP_SECRET);
	const url = new URL(`${META_GRAPH_URL}/${path}`);
	url.searchParams.set('access_token', token);
	url.searchParams.set('appsecret_proof', proof);
	for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
	const res = await fetch(url.toString(), { signal: AbortSignal.timeout(20_000) });
	const data: any = await res.json();
	if (data?.error) {
		const e = data.error;
		throw new Error(`Meta GET /${path}: code=${e.code} subcode=${e.error_subcode ?? 'none'} msg="${e.message}" trace=${e.fbtrace_id ?? ''}`);
	}
	return data;
}

async function metaPost(path: string, token: string, params: Record<string, string>): Promise<any> {
	const proof = hmac(token, META_APP_SECRET);
	const body = new URLSearchParams({ access_token: token, appsecret_proof: proof, ...params });
	const res = await fetch(`${META_GRAPH_URL}/${path}`, {
		method: 'POST',
		body,
		signal: AbortSignal.timeout(30_000),
	});
	const data: any = await res.json();
	if (data?.error) {
		const e = data.error;
		throw new Error(`Meta POST /${path}: code=${e.code} subcode=${e.error_subcode ?? 'none'} msg="${e.message}" trace=${e.fbtrace_id ?? ''}`);
	}
	return data;
}

async function findIgMediaId(token: string, igUserId: string, warnings: string[]): Promise<string | null> {
	console.error(`[info] Scanning IG media for shortcode ${IG_SHORTCODE} on account ${igUserId}...`);
	let nextUrl: string | null =
		`${META_GRAPH_URL}/${igUserId}/media?fields=id,shortcode,media_type&limit=50` +
		`&access_token=${encodeURIComponent(token)}` +
		`&appsecret_proof=${hmac(token, META_APP_SECRET)}`;
	let page = 0;
	while (nextUrl && page < 10) {
		page++;
		const res = await fetch(nextUrl, { signal: AbortSignal.timeout(15_000) });
		const data: any = await res.json();
		if (data?.error) {
			warnings.push(`IG media scan page ${page} error: code=${data.error.code} msg="${data.error.message}"`);
			console.error(`[warn] IG media scan error: ${data.error.message}`);
			break;
		}
		for (const m of (data.data ?? []) as Array<{ id: string; shortcode: string }>) {
			if (m.shortcode === IG_SHORTCODE) {
				console.error(`[info] Found IG media: id=${m.id}`);
				return m.id;
			}
		}
		nextUrl = data.paging?.next ?? null;
	}
	warnings.push(`Shortcode ${IG_SHORTCODE} not found after scanning ${page} IG media pages.`);
	return null;
}

async function main() {
	const warnings: string[] = [];
	const deletedMeta: string[] = [];

	// ── PASUL 1: CLEANUP ────────────────────────────────────────────────────

	console.error('[info] Getting token...');
	const token = await getToken();
	console.error('[info] Token OK');

	// Delete in order: ad → creatives → adset → campaign
	console.error(`[info] Deleting ad ${DELETE_AD_ID}...`);
	const adDelResult = await metaDelete(DELETE_AD_ID, token);
	if (adDelResult !== 'error') deletedMeta.push(DELETE_AD_ID);

	for (const cid of DELETE_CREATIVES) {
		console.error(`[info] Deleting creative ${cid}...`);
		const r = await metaDelete(cid, token);
		if (r !== 'error') deletedMeta.push(cid);
	}

	console.error(`[info] Deleting adset ${DELETE_ADSET_ID}...`);
	const adsetDelResult = await metaDelete(DELETE_ADSET_ID, token);
	if (adsetDelResult !== 'error') deletedMeta.push(DELETE_ADSET_ID);

	console.error(`[info] Deleting campaign ${DELETE_CAMPAIGN_ID}...`);
	const campaignDelResult = await metaDelete(DELETE_CAMPAIGN_ID, token);
	if (campaignDelResult !== 'error') deletedMeta.push(DELETE_CAMPAIGN_ID);

	// Delete CRM rows
	console.error(`[info] Deleting CRM rows for ${DELETE_CRM_ID}...`);
	const auditDel = await db.execute({
		sql: `DELETE FROM campaign_audit WHERE campaign_id = ?`,
		args: [DELETE_CRM_ID],
	});
	const campaignDel = await db.execute({
		sql: `DELETE FROM campaign WHERE id = ?`,
		args: [DELETE_CRM_ID],
	});
	const deletedCrmRows = (auditDel.rowsAffected ?? 0) + (campaignDel.rowsAffected ?? 0);
	console.error(`[info] CRM rows deleted: ${deletedCrmRows} (campaign=${campaignDel.rowsAffected}, audit=${auditDel.rowsAffected})`);

	// ── PASUL 2: CREATE ──────────────────────────────────────────────────────

	// Get tenant ID
	const tenantRes = await db.execute({
		sql: `SELECT id FROM tenant WHERE slug = 'ots' LIMIT 1`,
		args: [],
	});
	if (tenantRes.rows.length === 0) throw new Error('Tenant "ots" not found');
	const tenantId = tenantRes.rows[0]!.id as string;
	console.error(`[info] Tenant ID: ${tenantId}`);

	// Check IG connection on page
	console.error(`[info] Checking IG business account on page ${PAGE_ID}...`);
	const pageData = await metaGet(PAGE_ID, token, { fields: 'instagram_business_account' });
	const igUserId: string | null = pageData?.instagram_business_account?.id ?? null;
	const igConnected = !!igUserId;
	console.error(`[info] IG connected: ${igConnected} (igUserId=${igUserId ?? 'none'})`);

	// Try to find IG media if connected
	let igMediaId: string | null = null;
	if (igConnected && igUserId) {
		igMediaId = await findIgMediaId(token, igUserId, warnings);
	} else {
		warnings.push(`Page ${PAGE_ID} has no IG business account connected. Using link_data fallback.`);
	}

	// Create campaign
	console.error('[info] Creating campaign...');
	const campaignData = await metaPost(`${AD_ACCOUNT_ID}/campaigns`, token, {
		name: CAMPAIGN_NAME,
		objective: 'OUTCOME_TRAFFIC',
		status: 'PAUSED',
		special_ad_categories: JSON.stringify(['NONE']),
		buying_type: 'AUCTION',
		is_adset_budget_sharing_enabled: 'false',
	});
	const newCampaignId = campaignData.id as string;
	console.error(`[info] Campaign ID: ${newCampaignId}`);

	// Create adset
	const targeting = {
		age_min: 25,
		age_max: 55,
		genders: [2],
		geo_locations: { countries: ['RO'] },
		flexible_spec: [{ interests: INTERESTS }],
		targeting_automation: { advantage_audience: 0 },
	};
	const trackingSpecs = [
		{ action_type: 'offsite_conversion', fb_pixel: [PIXEL_ID] },
		{ action_type: 'link_click', fb_pixel: [PIXEL_ID] },
	];

	console.error('[info] Creating adset...');
	let adsetData: any;
	try {
		adsetData = await metaPost(`${AD_ACCOUNT_ID}/adsets`, token, {
			name: 'AdSet — Cosmetics RO Women 25-55',
			campaign_id: newCampaignId,
			daily_budget: String(DAILY_BUDGET_CENTS),
			billing_event: 'IMPRESSIONS',
			optimization_goal: 'LANDING_PAGE_VIEWS',
			bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
			destination_type: 'WEBSITE',
			status: 'ACTIVE', // campaign is PAUSED → no delivery until campaign approved
			targeting: JSON.stringify(targeting),
			is_adset_budget_sharing_enabled: 'false',
		});
	} catch (err) {
		// Clean up the just-created campaign to avoid orphans
		console.error(`[warn] Adset creation failed — cleaning up campaign ${newCampaignId}...`);
		await metaDelete(newCampaignId, token);
		throw err;
	}
	const newAdsetId = adsetData.id as string;
	console.error(`[info] Adset ID: ${newAdsetId}`);

	// Create creative
	let newCreativeId: string;
	let creativeMethod: string;

	if (igMediaId && igUserId) {
		// CASE A: IG video creative
		console.error(`[info] CASE A: Creating IG video creative (media ${igMediaId})...`);
		let creativeCreated = false;

		// Try object_story_id first
		try {
			const objectStoryId = `${PAGE_ID}_${igMediaId}`;
			console.error(`[info] Trying object_story_id=${objectStoryId}...`);
			const data = await metaPost(`${AD_ACCOUNT_ID}/adcreatives`, token, {
				name: 'Creative — IG Reel DXyeHaFDA3L — Mai 2026',
				object_story_id: objectStoryId,
				url_tags: URL_TAGS,
			});
			newCreativeId = data.id as string;
			creativeMethod = 'ig_video_object_story_id';
			creativeCreated = true;
			console.error(`[info] Creative (object_story_id) ID: ${newCreativeId}`);
		} catch (err1) {
			const msg1 = err1 instanceof Error ? err1.message : String(err1);
			warnings.push(`object_story_id failed: ${msg1}. Trying video_data spec.`);
			console.error(`[warn] object_story_id failed, trying video_data spec...`);
		}

		if (!creativeCreated) {
			// Try video_data spec with instagram_actor_id
			try {
				const spec = {
					page_id: PAGE_ID,
					instagram_actor_id: igUserId,
					video_data: {
						video_id: igMediaId,
						call_to_action: {
							type: 'LEARN_MORE',
							value: { link: LANDING_URL },
						},
						title: 'Descoperă Beauty One',
						message: 'Vezi colecția premium pentru saloane și cabinete estetice',
					},
				};
				const data = await metaPost(`${AD_ACCOUNT_ID}/adcreatives`, token, {
					name: 'Creative — IG Reel DXyeHaFDA3L — Mai 2026',
					object_story_spec: JSON.stringify(spec),
					url_tags: URL_TAGS,
				});
				newCreativeId = data.id as string;
				creativeMethod = 'ig_video_data_spec';
				creativeCreated = true;
				console.error(`[info] Creative (video_data spec) ID: ${newCreativeId}`);
			} catch (err2) {
				const msg2 = err2 instanceof Error ? err2.message : String(err2);
				warnings.push(`video_data spec failed: ${msg2}. Falling back to link_data.`);
				console.error(`[warn] video_data spec failed, falling back to link_data...`);
			}
		}

		if (!creativeCreated) {
			// Fall through to link_data below
			igMediaId = null;
		}
	}

	if (!igMediaId) {
		// CASE B: link_data fallback
		console.error(`[info] CASE B: Creating link_data creative...`);
		const spec = {
			page_id: PAGE_ID,
			link_data: {
				message: 'Vezi colecția premium pentru saloane și cabinete estetice',
				name: 'Descoperă Beauty One',
				description: '',
				link: LANDING_URL,
				call_to_action: { type: 'LEARN_MORE' },
			},
		};
		const data = await metaPost(`${AD_ACCOUNT_ID}/adcreatives`, token, {
			name: 'Creative — BeautyOne Traffic — Mai 2026',
			object_story_spec: JSON.stringify(spec),
			url_tags: URL_TAGS,
		});
		newCreativeId = data.id as string;
		creativeMethod = 'link_data';
		console.error(`[info] Creative (link_data) ID: ${newCreativeId}`);
	}

	// Create ad
	console.error('[info] Creating ad...');
	const adData = await metaPost(`${AD_ACCOUNT_ID}/ads`, token, {
		name: 'Ad — Reel V1',
		adset_id: newAdsetId,
		creative: JSON.stringify({ creative_id: newCreativeId! }),
		status: 'ACTIVE', // campaign is PAUSED → no delivery until campaign approved
	});
	const newAdId = adData.id as string;
	console.error(`[info] Ad ID: ${newAdId}`);

	// Persist CRM row
	const newCrmId = generateId();
	const now = new Date().toISOString();

	await db.execute({
		sql: `INSERT INTO campaign (
			id, tenant_id, client_id, platform, status, build_step, build_attempts,
			external_campaign_id, external_adset_id, external_creative_id, external_ad_id,
			external_ad_account_id, name, objective, budget_type, budget_cents, currency_code,
			audience_json, creative_json, brief_json, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		args: [
			newCrmId,
			tenantId,
			CLIENT_ID,
			'meta',
			'pending_approval',
			'done',
			1,
			newCampaignId,
			newAdsetId,
			newCreativeId!,
			newAdId,
			AD_ACCOUNT_ID,
			CAMPAIGN_NAME,
			'OUTCOME_TRAFFIC',
			'daily',
			DAILY_BUDGET_CENTS,
			'RON',
			JSON.stringify({
				geoCountries: ['RO'],
				ageMin: 25,
				ageMax: 55,
				genders: [2],
				interests: INTERESTS,
				pixelId: PIXEL_ID,
			}),
			JSON.stringify({
				igMediaId,
				igShortcode: IG_SHORTCODE,
				igUserId,
				pageId: PAGE_ID,
				landingUrl: LANDING_URL,
				urlTags: URL_TAGS,
				creativeMethod,
			}),
			JSON.stringify({ source: 'manual_script_recreate', createdAt: now }),
			now,
			now,
		],
	});
	console.error(`[info] CRM row inserted: ${newCrmId}`);

	const output = {
		deleted_meta: deletedMeta,
		deleted_crm_rows: deletedCrmRows,
		ig_connection_check: igConnected ? 'connected' : 'not_connected',
		creative_method: creativeMethod!,
		new_campaign_id: newCampaignId,
		new_adset_id: newAdsetId,
		new_creative_id: newCreativeId!,
		new_ad_id: newAdId,
		new_crm_id: newCrmId,
		url_tags_set: URL_TAGS,
		approval_url: '/ots/campaigns-ads/facebook?status=pending_approval',
		warnings,
	};

	console.log(JSON.stringify(output, null, 2));
}

main()
	.catch((err) => {
		console.error('[fatal]', err instanceof Error ? err.message : String(err));
		process.exit(1);
	})
	.finally(() => db.close());
