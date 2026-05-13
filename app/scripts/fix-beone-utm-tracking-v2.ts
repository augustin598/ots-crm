#!/usr/bin/env bun
/**
 * Quick verify + fix for ad 120244706378930052 (creative 4203295286589872).
 * Checks if url_tags is populated in Meta; recreates creative if empty.
 *
 * Usage: cd app && bun scripts/fix-beone-utm-tracking-v2.ts
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

const CREATIVE_ID = '4203295286589872';
const AD_ID = '120244706378930052';
const AD_ACCOUNT_ID = 'act_275835948024308';
const PAGE_ID = '1501568140081986';
const CRM_ROW_ID = 'v7e26hddtdxv464xj2aujlck';
const LANDING_URL = 'https://www.beautyone.ro/';

const TARGET_URL_TAGS =
	'utm_source={{site_source_name}}&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_term={{adset.name}}&utm_content={{ad.name}}&placement={{placement}}';

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

async function main() {
	const token = await getToken();
	console.error('[info] Token OK');

	// Step 1: GET live creative state
	console.error(`[info] Fetching creative ${CREATIVE_ID}...`);
	const creativeBefore = await metaGet(CREATIVE_ID, token, {
		fields: 'id,name,object_story_spec,url_tags,link_url,asset_feed_spec',
	});
	console.error(`[info] Creative name: "${creativeBefore.name}"`);
	console.error(`[info] url_tags (before): "${creativeBefore.url_tags ?? '(null/empty)'}"`);
	console.error(`[info] link_url: "${creativeBefore.link_url ?? '(none)'}"`);

	const urlTagsBefore = creativeBefore.url_tags ?? null;
	const linkInSpec = creativeBefore.object_story_spec?.link_data?.link ?? null;
	console.error(`[info] object_story_spec.link_data.link: "${linkInSpec ?? '(none)'}"`);

	// Determine if fix is needed
	const needsFix = !urlTagsBefore || urlTagsBefore.trim() === '';
	console.error(`[info] Needs fix: ${needsFix}`);

	let fixApplied = false;
	let newCreativeId: string | null = null;
	let creativeAfter: any = null;
	let adCreativeIdAfter: string | null = null;

	if (needsFix) {
		const existingSpec = creativeBefore.object_story_spec;
		if (!existingSpec) {
			throw new Error(`Creative ${CREATIVE_ID} has no object_story_spec — cannot reuse structure`);
		}

		// Build spec with bare landing URL (no embedded UTMs)
		let specToUse = existingSpec;
		if (existingSpec.link_data) {
			specToUse = {
				...existingSpec,
				link_data: {
					...existingSpec.link_data,
					link: LANDING_URL,
					...(existingSpec.link_data.call_to_action?.value?.link
						? {
							call_to_action: {
								...existingSpec.link_data.call_to_action,
								value: {
									...existingSpec.link_data.call_to_action.value,
									link: LANDING_URL,
								},
							},
						}
						: {}),
				},
			};
		}
		if (!specToUse.page_id) {
			specToUse = { page_id: PAGE_ID, ...specToUse };
		}

		// Create new creative with url_tags
		console.error('[info] Creating new creative with url_tags...');
		const newCreativeData = await metaPost(`${AD_ACCOUNT_ID}/adcreatives`, token, {
			name: `Creative — BeautyOne Traffic — utm_fix-v2 — ${new Date().toISOString().slice(0, 10)}`,
			object_story_spec: JSON.stringify(specToUse),
			url_tags: TARGET_URL_TAGS,
		});
		newCreativeId = newCreativeData.id as string;
		console.error(`[info] New creative ID: ${newCreativeId}`);

		// Verify new creative
		creativeAfter = await metaGet(newCreativeId!, token, {
			fields: 'id,name,url_tags,object_story_spec',
		});
		console.error(`[info] url_tags (after create): "${creativeAfter.url_tags ?? '(null/empty)'}"`);

		// Point ad to new creative
		console.error(`[info] Updating ad ${AD_ID} → creative ${newCreativeId}...`);
		const adUpdateRes = await metaPost(AD_ID, token, {
			creative: JSON.stringify({ creative_id: newCreativeId }),
		});
		console.error(`[info] Ad update response: ${JSON.stringify(adUpdateRes)}`);

		// Verify ad
		const adVerify = await metaGet(AD_ID, token, { fields: 'id,name,creative' });
		adCreativeIdAfter = adVerify.creative?.id ?? adVerify.creative?.creative_id ?? null;
		console.error(`[info] Ad creative after update: ${adCreativeIdAfter}`);

		// Update CRM row
		const now = new Date().toISOString();
		const crmRes = await db.execute({
			sql: `UPDATE campaign
			      SET external_creative_id = ?,
			          creative_json = json_patch(COALESCE(creative_json, '{}'), ?),
			          updated_at = ?
			      WHERE id = ?`,
			args: [
				newCreativeId,
				JSON.stringify({
					fixV2OldCreativeId: CREATIVE_ID,
					fixV2NewCreativeId: newCreativeId,
					fixV2UrlTags: TARGET_URL_TAGS,
					fixV2At: now,
				}),
				now,
				CRM_ROW_ID,
			],
		});
		console.error(`[info] CRM rows affected: ${crmRes.rowsAffected}`);

		fixApplied = true;
	} else {
		console.error('[info] url_tags already populated — no fix needed. Fetching ad creative pointer...');
		const adVerify = await metaGet(AD_ID, token, { fields: 'id,name,creative' });
		adCreativeIdAfter = adVerify.creative?.id ?? adVerify.creative?.creative_id ?? null;
		creativeAfter = creativeBefore;
	}

	const output = {
		creative_state_before: {
			id: creativeBefore.id,
			name: creativeBefore.name,
			url_tags: urlTagsBefore,
			link_data_link: linkInSpec,
			has_asset_feed_spec: !!creativeBefore.asset_feed_spec,
		},
		url_tags_actual: urlTagsBefore,
		fix_applied: fixApplied,
		creative_state_after: creativeAfter
			? {
				id: creativeAfter.id,
				name: creativeAfter.name,
				url_tags: creativeAfter.url_tags ?? null,
			}
			: null,
		ad_id_pointed_to_creative: adCreativeIdAfter,
	};

	console.log(JSON.stringify(output, null, 2));
}

main()
	.catch((err) => {
		console.error('[fatal]', err instanceof Error ? err.message : String(err));
		process.exit(1);
	})
	.finally(() => db.close());
