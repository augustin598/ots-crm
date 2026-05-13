#!/usr/bin/env bun
/**
 * Creates a PAUSED Meta OUTCOME_TRAFFIC campaign using an existing IG reel as creative.
 * Persists result in CRM as pending_approval (status=pending_approval, build_step=done).
 *
 * Usage: cd app && bun scripts/create-traffic-campaign-beone-ig-reel.ts
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

const AD_ACCOUNT_ID = 'act_275835948024308';
const PAGE_ID = '1501568140081986';
const CLIENT_ID = 'g4gjn3qe6o734r64xiystdst';
const IG_SHORTCODE = 'DXyeHaFDA3L';
const CAMPAIGN_NAME = 'Traffic — Beauty One Pro Shop — IG Reel — Mai 2026';
const LANDING_URL = 'https://www.beautyone.ro/';
const DAILY_BUDGET_CENTS = 5000;

if (!SQLITE_URI) { console.error('SQLITE_URI missing'); process.exit(1); }
if (!META_APP_SECRET) { console.error('META_APP_SECRET missing'); process.exit(1); }

const db = createClient({ url: SQLITE_URI, authToken: SQLITE_AUTH_TOKEN });

function hmac(token: string, secret: string): string {
	return createHmac('sha256', secret).update(token).digest('hex');
}

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
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

async function main() {
	const warnings: string[] = [];

	// 1. Get access token for ad account
	let accessToken: string | null = null;
	const tokenRes = await db.execute({
		sql: `SELECT i.access_token
		      FROM meta_ads_integration i
		      JOIN meta_ads_account a ON a.integration_id = i.id
		      WHERE a.meta_ad_account_id = ?
		        AND a.is_active = 1
		        AND i.is_active = 1
		      LIMIT 1`,
		args: [AD_ACCOUNT_ID],
	});

	if (tokenRes.rows.length > 0 && tokenRes.rows[0]!.access_token) {
		accessToken = tokenRes.rows[0]!.access_token as string;
		console.error('[info] Got token via account join');
	} else {
		const fallback = await db.execute({
			sql: `SELECT access_token FROM meta_ads_integration WHERE is_active = 1 LIMIT 1`,
			args: [],
		});
		if (fallback.rows.length === 0 || !fallback.rows[0]!.access_token) {
			console.error('[fatal] No active Meta integration token found in DB');
			process.exit(1);
		}
		accessToken = fallback.rows[0]!.access_token as string;
		warnings.push('Used fallback integration token (no account-specific match found)');
		console.error('[warn] Using fallback token (no account join match)');
	}

	// 2. Get tenant ID for 'ots'
	const tenantRes = await db.execute({
		sql: `SELECT id FROM tenant WHERE slug = 'ots' LIMIT 1`,
		args: [],
	});
	if (tenantRes.rows.length === 0) {
		console.error('[fatal] Tenant "ots" not found in DB');
		process.exit(1);
	}
	const tenantId = tenantRes.rows[0]!.id as string;
	console.error(`[info] Tenant ID: ${tenantId}`);

	// 3. Resolve IG business account connected to page
	console.error(`[info] Fetching IG business account for page ${PAGE_ID}...`);
	const pageData = await metaGet(PAGE_ID, accessToken, { fields: 'instagram_business_account' });
	const igUserId: string | null = pageData?.instagram_business_account?.id ?? null;

	if (!igUserId) {
		warnings.push(`Page ${PAGE_ID} has no IG business account connected. Cannot use object_story_id.`);
		console.error('[warn] No IG business account found on page');
	} else {
		console.error(`[info] IG Business Account ID: ${igUserId}`);
	}

	// 4. Find IG media ID by shortcode
	let igMediaId: string | null = null;
	if (igUserId) {
		console.error(`[info] Listing IG media for shortcode ${IG_SHORTCODE}...`);
		let nextUrl: string | null =
			`${META_GRAPH_URL}/${igUserId}/media?fields=id,shortcode,permalink&limit=50` +
			`&access_token=${encodeURIComponent(accessToken)}` +
			`&appsecret_proof=${hmac(accessToken, META_APP_SECRET)}`;

		let page = 0;
		while (nextUrl && !igMediaId && page < 10) {
			page++;
			const res = await fetch(nextUrl, { signal: AbortSignal.timeout(15_000) });
			const data: any = await res.json();
			if (data?.error) {
				warnings.push(`IG media list page ${page} error: code=${data.error.code} msg="${data.error.message}"`);
				console.error(`[warn] IG media list error: ${data.error.message}`);
				break;
			}
			for (const m of (data.data ?? []) as Array<{ id: string; shortcode: string }>) {
				if (m.shortcode === IG_SHORTCODE) {
					igMediaId = m.id;
					break;
				}
			}
			nextUrl = data.paging?.next ?? null;
		}

		if (igMediaId) {
			console.error(`[info] Found IG media ID: ${igMediaId}`);
		} else {
			warnings.push(`Shortcode ${IG_SHORTCODE} not found in IG media list (${page} pages scanned). Will use link_data fallback.`);
			console.error(`[warn] IG media not found after scanning ${page} pages`);
		}
	}

	// 5. Create Meta campaign
	console.error('[info] Creating Meta campaign...');
	const campaignData = await metaPost(`${AD_ACCOUNT_ID}/campaigns`, accessToken, {
		name: CAMPAIGN_NAME,
		objective: 'OUTCOME_TRAFFIC',
		status: 'PAUSED',
		special_ad_categories: JSON.stringify(['NONE']),
		is_adset_budget_sharing_enabled: 'false',
		buying_type: 'AUCTION',
	});
	const externalCampaignId = campaignData.id as string;
	console.error(`[info] Campaign ID: ${externalCampaignId}`);

	// 6. Create adset
	const interestIds = [
		{ id: '6002839660079', name: 'Cosmetics (personal care)' },
		{ id: '6003088846792', name: 'Beauty salons (cosmetics)' },
		{ id: '664130153728886', name: 'Skin care (cosmetics)' },
		{ id: '6002867432822', name: 'Beauty (social concept)' },
	];
	const targeting = {
		age_min: 25,
		age_max: 55,
		geo_locations: { countries: ['RO'] },
		interests: interestIds,
		targeting_automation: { advantage_audience: 0 },
	};

	console.error('[info] Creating adset...');
	const adsetData = await metaPost(`${AD_ACCOUNT_ID}/adsets`, accessToken, {
		name: 'AdSet — Cosmetics RO 25-55',
		campaign_id: externalCampaignId,
		daily_budget: String(DAILY_BUDGET_CENTS),
		billing_event: 'IMPRESSIONS',
		optimization_goal: 'LANDING_PAGE_VIEWS',
		bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
		destination_type: 'WEBSITE',
		status: 'ACTIVE', // campaign is PAUSED → no delivery until campaign approved
		targeting: JSON.stringify(targeting),
	});
	const externalAdsetId = adsetData.id as string;
	console.error(`[info] Adset ID: ${externalAdsetId}`);

	// 7. Create creative
	// The FB page 1501568140081986 has no IG Business Account connected AND the beautyoneromania
	// IG account (17841403240155379) is not linked to this FB page — so instagram_actor_id is not
	// usable as instagram_actor_id either (Meta returns code=100 "must be a valid Instagram account id").
	// We create a standard link_data creative on the FB page. To use the actual IG reel, the user must:
	//   1. Connect the IG account to the FB page in Business Settings → Accounts → Instagram Accounts
	//   2. Edit the ad creative in Meta Ads Manager to reference the existing post.
	warnings.push(
		'Page 1501568140081986 has no IG Business Account connected. ' +
		'instagram_actor_id=17841403240155379 (beautyoneromania) rejected by Meta (code 100) — IG account not linked to page. ' +
		'Creative is a standard link_data ad on the FB page. ' +
		'ACTION REQUIRED: Connect beautyoneromania IG to this FB page in Business Settings, then edit the ad creative to use the existing reel.'
	);

	let externalCreativeId: string;
	let creativeMethod = 'unknown';

	// If we have the IG media ID (from business account, if connected), try object_story_id first
	if (igMediaId && igUserId) {
		const objectStoryId = `${PAGE_ID}_${igMediaId}`;
		console.error(`[info] Creating creative with object_story_id=${objectStoryId}...`);
		try {
			const creativeData = await metaPost(`${AD_ACCOUNT_ID}/adcreatives`, accessToken, {
				name: `Creative — IG Reel ${IG_SHORTCODE}`,
				object_story_id: objectStoryId,
			});
			externalCreativeId = creativeData.id as string;
			creativeMethod = 'object_story_id';
		} catch (err1) {
			const msg1 = err1 instanceof Error ? err1.message : String(err1);
			warnings.push(`object_story_id failed: ${msg1}`);
			console.error(`[warn] object_story_id failed, falling back to link_data`);
			// Fall through to link_data below
			igMediaId = null;
		}
	}

	if (!igMediaId || creativeMethod === 'unknown') {
		// Standard link_data on the FB page (no instagram_actor_id — IG account not linked to page)
		console.error(`[info] Creating creative with link_data on FB page ${PAGE_ID}...`);
		const spec = {
			page_id: PAGE_ID,
			link_data: {
				message: 'Descoperă colecția de produse profesionale pentru salon și cabinet estetic. Livrare rapidă în toată România.',
				name: 'Beauty One — Produse Profesionale pentru Saloane',
				link: LANDING_URL,
				call_to_action: { type: 'LEARN_MORE' },
			},
		};
		const creativeData = await metaPost(`${AD_ACCOUNT_ID}/adcreatives`, accessToken, {
			name: `Creative — IG Reel ${IG_SHORTCODE} (link_data)`,
			object_story_spec: JSON.stringify(spec),
		});
		externalCreativeId = creativeData.id as string;
		creativeMethod = 'link_data_fb_page_only';
	}
	console.error(`[info] Creative ID: ${externalCreativeId} (method: ${creativeMethod})`);

	// 8. Create ad
	console.error('[info] Creating ad...');
	const adData = await metaPost(`${AD_ACCOUNT_ID}/ads`, accessToken, {
		name: `Ad — IG Reel ${IG_SHORTCODE}`,
		adset_id: externalAdsetId,
		creative: JSON.stringify({ creative_id: externalCreativeId }),
		status: 'ACTIVE', // campaign is PAUSED → no delivery until campaign approved
	});
	const externalAdId = adData.id as string;
	console.error(`[info] Ad ID: ${externalAdId}`);

	// 9. Persist in CRM
	const campaignId = generateId();
	const now = new Date().toISOString();

	await db.execute({
		sql: `INSERT INTO campaign (
			id, tenant_id, client_id, platform, status, build_step, build_attempts,
			external_campaign_id, external_adset_id, external_creative_id, external_ad_id,
			external_ad_account_id, name, objective, budget_type, budget_cents, currency_code,
			audience_json, creative_json, brief_json, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		args: [
			campaignId,
			tenantId,
			CLIENT_ID,
			'meta',
			'pending_approval',
			'done',
			1,
			externalCampaignId,
			externalAdsetId,
			externalCreativeId,
			externalAdId,
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
				interests: interestIds,
			}),
			JSON.stringify({
				igMediaId,
				igShortcode: IG_SHORTCODE,
				igUserId,
				pageId: PAGE_ID,
				landingUrl: LANDING_URL,
				creativeMethod,
			}),
			JSON.stringify({ source: 'manual_script', createdAt: now }),
			now,
			now,
		],
	});
	console.error(`[info] CRM campaign persisted: ${campaignId}`);

	const output = {
		ig_media_id: igMediaId,
		ig_user_id: igUserId,
		creative_method: creativeMethod,
		campaign_id: externalCampaignId,
		adset_id: externalAdsetId,
		creative_id: externalCreativeId,
		ad_id: externalAdId,
		crm_campaign_id: campaignId,
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
