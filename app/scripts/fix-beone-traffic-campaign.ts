#!/usr/bin/env bun
/**
 * Fixează campania Meta 120244706368780052 (Beauty One Pro Shop, traffic):
 *   1. Creative nou cu IG Reel real (shortcode DXyeHaFDA3L) + UTM-uri dinamice
 *   2. AdSet: genders=[2] (women only)
 *   3. AdSet: promoted_object cu pixel activ
 *   4. Ad: înlocuiește creative-ul vechi cu cel nou
 *   5. CRM row v7e26hddtdxv464xj2aujlck: actualizat cu noul creative ID
 *
 * Usage: cd app && bun scripts/fix-beone-traffic-campaign.ts
 */
import { createClient } from '@libsql/client';
import { createHmac } from 'node:crypto';
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(import.meta.dir, '..', '.env') });

const SQLITE_URI = process.env.SQLITE_URI!;
const SQLITE_AUTH_TOKEN = process.env.SQLITE_AUTH_TOKEN;
const META_APP_SECRET = process.env.META_APP_SECRET!;
const META_GRAPH_URL = 'https://graph.facebook.com/v25.0';

// IDs confirmate de user
const CAMPAIGN_ID = '120244706368780052';
const ADSET_ID = '120244706372970052';
const OLD_CREATIVE_ID = '2771853356497245';
const AD_ID = '120244706378930052';
const AD_ACCOUNT_ID = 'act_275835948024308';
const PAGE_ID = '1501568140081986';
const IG_USER_ID = '17841403240155379'; // @beautyoneromania — confirmat de user că e owned de BeautyOne
const IG_SHORTCODE = 'DXyeHaFDA3L';
const CRM_ROW_ID = 'v7e26hddtdxv464xj2aujlck';
const LANDING_URL = 'https://www.beautyone.ro/';
const UTM_URL =
	'https://www.beautyone.ro/?utm_source={{site_source_name}}&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content={{ad.id}}';

if (!SQLITE_URI) { console.error('SQLITE_URI missing'); process.exit(1); }
if (!META_APP_SECRET) { console.error('META_APP_SECRET missing'); process.exit(1); }

const db = createClient({ url: SQLITE_URI, authToken: SQLITE_AUTH_TOKEN });

function hmac(token: string, secret: string): string {
	return createHmac('sha256', secret).update(token).digest('hex');
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

async function findIgMediaId(token: string, warnings: string[]): Promise<string | null> {
	// Strategy 1: List media directly via IG_USER_ID (requires instagram_basic permission)
	console.error(`[info] Strategy 1: Scanning IG media directly on ${IG_USER_ID}...`);
	{
		let nextUrl: string | null =
			`${META_GRAPH_URL}/${IG_USER_ID}/media?fields=id,shortcode,permalink,media_type&limit=50` +
			`&access_token=${encodeURIComponent(token)}` +
			`&appsecret_proof=${hmac(token, META_APP_SECRET)}`;

		let page = 0;
		let permDenied = false;
		while (nextUrl && page < 10) {
			page++;
			const res = await fetch(nextUrl, { signal: AbortSignal.timeout(15_000) });
			const data: any = await res.json();
			if (data?.error) {
				if (data.error.code === 10) {
					permDenied = true;
					console.error(`[warn] Strategy 1 permission denied (code=10): token lacks instagram_basic for ${IG_USER_ID}`);
				} else {
					console.error(`[warn] Strategy 1 error: code=${data.error.code} msg="${data.error.message}"`);
				}
				break;
			}
			for (const m of (data.data ?? []) as Array<{ id: string; shortcode: string; media_type: string }>) {
				if (m.shortcode === IG_SHORTCODE) {
					console.error(`[info] Strategy 1 found: id=${m.id} type=${m.media_type}`);
					return m.id;
				}
			}
			nextUrl = data.paging?.next ?? null;
		}
		if (permDenied) {
			warnings.push(`Strategy 1 (direct IG media list) denied. Token lacks instagram_basic permission for ${IG_USER_ID}. Trying via connected pages.`);
		} else if (page > 0) {
			warnings.push(`Strategy 1: Scanned ${page} pages, shortcode not found.`);
		}
	}

	// Strategy 2: Find which FB page has the IG account connected, then use that page token
	console.error(`[info] Strategy 2: Scanning pages in token for IG connection to ${IG_USER_ID}...`);
	try {
		const meAccounts = await metaGet('me/accounts', token, { fields: 'id,name,instagram_business_account', limit: '50' });
		const pages: Array<{ id: string; name: string; instagram_business_account?: { id: string } }> = meAccounts.data ?? [];
		console.error(`[info] Token manages ${pages.length} pages`);
		for (const page of pages) {
			const igId = page.instagram_business_account?.id;
			console.error(`[info] Page ${page.id} (${page.name}) → IG: ${igId ?? 'none'}`);
			if (igId === IG_USER_ID) {
				console.error(`[info] Found page ${page.id} connected to IG ${IG_USER_ID}. Listing IG media...`);
				// Use same token — page token with instagram access
				let nextUrl: string | null =
					`${META_GRAPH_URL}/${igId}/media?fields=id,shortcode,permalink,media_type&limit=50` +
					`&access_token=${encodeURIComponent(token)}` +
					`&appsecret_proof=${hmac(token, META_APP_SECRET)}`;
				let p = 0;
				while (nextUrl && p < 10) {
					p++;
					const res = await fetch(nextUrl, { signal: AbortSignal.timeout(15_000) });
					const data: any = await res.json();
					if (data?.error) {
						console.error(`[warn] Strategy 2 media page ${p} error: ${data.error.message}`);
						break;
					}
					for (const m of (data.data ?? []) as Array<{ id: string; shortcode: string; media_type: string }>) {
						if (m.shortcode === IG_SHORTCODE) {
							console.error(`[info] Strategy 2 found: id=${m.id} type=${m.media_type}`);
							return m.id;
						}
					}
					nextUrl = data.paging?.next ?? null;
				}
				warnings.push(`Strategy 2: Found connected page ${page.id} but shortcode ${IG_SHORTCODE} not found in ${p} pages.`);
			}
		}
		if (!pages.some(p => p.instagram_business_account?.id === IG_USER_ID)) {
			warnings.push(`Strategy 2: No page in token manages IG ${IG_USER_ID}. IG account may not be linked to any page accessible by this token.`);
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		warnings.push(`Strategy 2 error: ${msg}`);
		console.error(`[warn] Strategy 2 failed: ${msg}`);
	}

	console.error(`[warn] Could not find IG media ID for shortcode ${IG_SHORTCODE}`);
	return null;
}

async function findPixelId(token: string): Promise<string | null> {
	console.error(`[info] Fetching pixels for ${AD_ACCOUNT_ID}...`);
	const data = await metaGet(`${AD_ACCOUNT_ID}/adspixels`, token, { fields: 'id,name,is_active' });
	const pixels: Array<{ id: string; name: string; is_active: boolean }> = data.data ?? [];
	const active = pixels.find(p => p.is_active !== false);
	if (active) {
		console.error(`[info] Pixel: id=${active.id} name="${active.name}"`);
		return active.id;
	}
	if (pixels.length > 0) {
		console.error(`[warn] No active pixel, using first: ${pixels[0]!.id}`);
		return pixels[0]!.id;
	}
	console.error(`[warn] No pixels found for account`);
	return null;
}

async function fetchCurrentTargeting(token: string): Promise<any> {
	console.error(`[info] Fetching current adset targeting...`);
	const data = await metaGet(ADSET_ID, token, { fields: 'targeting,promoted_object' });
	console.error(`[info] Current targeting keys: ${Object.keys(data.targeting ?? {}).join(', ')}`);
	return data.targeting ?? {};
}

async function tryCreateCreativeWithReel(
	token: string,
	igMediaId: string,
): Promise<{ id: string; method: string } | null> {
	// Approach 1: object_story_id = "<page_id>_<ig_media_id>"
	const objectStoryId = `${PAGE_ID}_${igMediaId}`;
	console.error(`[info] Trying creative approach 1: object_story_id=${objectStoryId}`);
	try {
		const data = await metaPost(`${AD_ACCOUNT_ID}/adcreatives`, token, {
			name: `Creative — IG Reel ${IG_SHORTCODE} — fix`,
			object_story_id: objectStoryId,
			url_tags: `utm_source={{site_source_name}}&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content={{ad.id}}`,
		});
		return { id: data.id as string, method: 'object_story_id' };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`[warn] approach 1 (object_story_id) failed: ${msg}`);
	}

	// Approach 2: video_data cu instagram_actor_id
	console.error(`[info] Trying creative approach 2: video_data + instagram_actor_id`);
	try {
		const spec = {
			page_id: PAGE_ID,
			instagram_actor_id: IG_USER_ID,
			video_data: {
				video_id: igMediaId,
				call_to_action: {
					type: 'LEARN_MORE',
					value: { link: UTM_URL },
				},
				title: 'Descoperă produsele Beauty One',
				message: 'Colecție premium pentru saloane și cabinete estetice. Livrare rapidă în toată România.',
			},
		};
		const data = await metaPost(`${AD_ACCOUNT_ID}/adcreatives`, token, {
			name: `Creative — IG Reel ${IG_SHORTCODE} — fix`,
			object_story_spec: JSON.stringify(spec),
		});
		return { id: data.id as string, method: 'video_data_instagram_actor_id' };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`[warn] approach 2 (video_data + instagram_actor_id) failed: ${msg}`);
	}

	// Approach 3: effective_instagram_media_id (direct IG post reference)
	console.error(`[info] Trying creative approach 3: effective_instagram_media_id`);
	try {
		const spec = {
			page_id: PAGE_ID,
			link_data: {
				message: 'Colecție premium pentru saloane și cabinete estetice. Livrare rapidă în toată România.',
				link: UTM_URL,
				call_to_action: { type: 'LEARN_MORE' },
			},
		};
		const data = await metaPost(`${AD_ACCOUNT_ID}/adcreatives`, token, {
			name: `Creative — IG Reel ${IG_SHORTCODE} — fix`,
			object_story_spec: JSON.stringify(spec),
			effective_instagram_media_id: igMediaId,
		});
		return { id: data.id as string, method: 'effective_instagram_media_id' };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`[warn] approach 3 (effective_instagram_media_id) failed: ${msg}`);
	}

	return null;
}

async function main() {
	const warnings: string[] = [];

	// Step 1: Token
	const token = await getToken();
	console.error('[info] Token OK');

	// Step 2: IG media ID
	const igMediaId = await findIgMediaId(token, warnings);
	if (!igMediaId) {
		warnings.push(`IG media not found for shortcode ${IG_SHORTCODE} on account ${IG_USER_ID}. Will use link_data fallback.`);
	}

	// Step 3: Pixel
	const pixelId = await findPixelId(token);
	if (!pixelId) {
		warnings.push('No pixel found for account. Skipping promoted_object pixel update.');
	}

	// Step 4: Current targeting (refetch to preserve interests)
	const currentTargeting = await fetchCurrentTargeting(token);

	// Step 5a: Update adset — genders=[2] only (targeting only, no promoted_object — invalid for traffic)
	console.error('[info] Updating adset targeting: genders=[2] (women only)...');
	const newTargeting = { ...currentTargeting, genders: [2] };

	const adsetUpdateRes = await metaPost(ADSET_ID, token, {
		targeting: JSON.stringify(newTargeting),
	});
	const adsetUpdated = adsetUpdateRes.success === true || !!adsetUpdateRes.id;
	console.error(`[info] Adset gender update result: ${JSON.stringify(adsetUpdateRes)}`);

	// Step 5b: Pixel via tracking_specs
	let adsetPixelUpdated = false;
	if (pixelId) {
		console.error(`[info] Updating adset tracking_specs with pixel ${pixelId}...`);
		try {
			const trackingSpecs = [
				{ action_type: 'offsite_conversion', 'fb_pixel': [pixelId] },
				{ action_type: 'link_click', 'fb_pixel': [pixelId] },
			];
			const pixelRes = await metaPost(ADSET_ID, token, {
				tracking_specs: JSON.stringify(trackingSpecs),
			});
			adsetPixelUpdated = pixelRes.success === true || !!pixelRes.id;
			console.error(`[info] Pixel tracking_specs result: ${JSON.stringify(pixelRes)}`);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			warnings.push(`tracking_specs update failed: ${msg}. Pixel not attached to adset.`);
			console.error(`[warn] tracking_specs failed: ${msg}`);
		}
	}

	// Step 6: New creative
	let newCreativeId: string | null = null;
	let creativeMethod = 'none';

	if (igMediaId) {
		const result = await tryCreateCreativeWithReel(token, igMediaId);
		if (result) {
			newCreativeId = result.id;
			creativeMethod = result.method;
			console.error(`[info] New creative: ${newCreativeId} (method: ${creativeMethod})`);
		} else {
			warnings.push('All IG creative approaches failed. Falling back to link_data with UTM.');
		}
	}

	// Fallback: link_data cu UTM
	if (!newCreativeId) {
		console.error('[info] Creating link_data creative with UTM as fallback...');
		const spec = {
			page_id: PAGE_ID,
			link_data: {
				message: 'Colecție premium pentru saloane și cabinete estetice. Livrare rapidă în toată România.',
				name: 'Beauty One — Produse Profesionale pentru Saloane',
				link: UTM_URL,
				call_to_action: { type: 'LEARN_MORE' },
			},
		};
		const data = await metaPost(`${AD_ACCOUNT_ID}/adcreatives`, token, {
			name: `Creative — IG Reel ${IG_SHORTCODE} — fix (link_data)`,
			object_story_spec: JSON.stringify(spec),
		});
		newCreativeId = data.id as string;
		creativeMethod = 'link_data_utm_fallback';
		console.error(`[info] Fallback creative: ${newCreativeId}`);
	}

	// Step 7: Update ad cu noul creative
	console.error(`[info] Updating ad ${AD_ID} with new creative ${newCreativeId}...`);
	const adUpdateRes = await metaPost(AD_ID, token, {
		creative: JSON.stringify({ creative_id: newCreativeId }),
	});
	const adUpdated = adUpdateRes.success === true || !!adUpdateRes.id;
	console.error(`[info] Ad update result: ${JSON.stringify(adUpdateRes)}`);

	// Step 8: Update CRM row
	console.error(`[info] Updating CRM row ${CRM_ROW_ID}...`);
	const now = new Date().toISOString();
	await db.execute({
		sql: `UPDATE campaign
		      SET external_creative_id = ?,
		          creative_json = json_patch(COALESCE(creative_json, '{}'), ?),
		          updated_at = ?
		      WHERE id = ?`,
		args: [
			newCreativeId,
			JSON.stringify({
				igMediaId,
				igShortcode: IG_SHORTCODE,
				igUserId: IG_USER_ID,
				creativeMethod,
				utmUrl: UTM_URL,
				oldCreativeId: OLD_CREATIVE_ID,
				newCreativeId,
				fixedAt: now,
			}),
			now,
			CRM_ROW_ID,
		],
	});
	console.error(`[info] CRM row updated`);

	const output = {
		ig_media_id: igMediaId,
		pixel_id: pixelId,
		old_creative_id: OLD_CREATIVE_ID,
		new_creative_id: newCreativeId,
		creative_method: creativeMethod,
		ad_updated_with_new_creative: adUpdated,
		adset_updated_genders: '[2] (women only)',
		adset_pixel_via_tracking_specs: adsetPixelUpdated,
		url_with_utm: UTM_URL,
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
