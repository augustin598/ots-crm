#!/usr/bin/env bun
/**
 * Fix URL tracking parameters on ad 120244706378930052 (BeautyOne traffic campaign).
 * Changes:
 *   - utm_content: {{ad.id}} → {{ad.name}}
 *   - adds:        utm_term={{adset.name}}&placement={{placement}}
 *
 * Workflow:
 *   1. GET creative 1588617015564997 (fields: object_story_spec, url_tags)
 *   2. POST new creative with same object_story_spec + updated url_tags
 *   3. POST ad 120244706378930052 → replace creative
 *   4. UPDATE CRM campaign row v7e26hddtdxv464xj2aujlck
 *
 * Usage: cd app && bun scripts/fix-beone-utm-tracking.ts
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

const OLD_CREATIVE_ID = '1588617015564997';
const AD_ID = '120244706378930052';
const AD_ACCOUNT_ID = 'act_275835948024308';
const PAGE_ID = '1501568140081986';
const CRM_ROW_ID = 'v7e26hddtdxv464xj2aujlck';
const LANDING_URL = 'https://www.beautyone.ro/';

const NEW_URL_TAGS =
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
	const warnings: string[] = [];

	// Step 1: Token
	const token = await getToken();
	console.error('[info] Token OK');

	// Step 2: Fetch current creative to extract object_story_spec
	console.error(`[info] Fetching creative ${OLD_CREATIVE_ID}...`);
	const currentCreative = await metaGet(OLD_CREATIVE_ID, token, {
		fields: 'id,name,object_story_spec,url_tags',
	});
	console.error(`[info] Current creative name: "${currentCreative.name}"`);
	console.error(`[info] Current url_tags: "${currentCreative.url_tags ?? '(none)'}"`);

	const existingSpec = currentCreative.object_story_spec;
	if (!existingSpec) {
		throw new Error(`Creative ${OLD_CREATIVE_ID} has no object_story_spec — cannot reuse structure`);
	}
	console.error(`[info] object_story_spec keys: ${Object.keys(existingSpec).join(', ')}`);

	// Ensure the link in link_data points to the bare landing URL (url_tags handles UTMs)
	let specToUse = existingSpec;
	if (existingSpec.link_data) {
		specToUse = {
			...existingSpec,
			link_data: {
				...existingSpec.link_data,
				// Keep link as bare URL so url_tags appends correctly
				link: LANDING_URL,
				// Remove any existing UTM-embedded call_to_action link
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

	// If no page_id in spec, inject it
	if (!specToUse.page_id) {
		specToUse = { page_id: PAGE_ID, ...specToUse };
	}

	// Step 3: Create new creative with updated url_tags
	console.error('[info] Creating new creative with updated url_tags...');
	const newCreativeData = await metaPost(`${AD_ACCOUNT_ID}/adcreatives`, token, {
		name: `Creative — BeautyOne Traffic — utm_term+placement — ${new Date().toISOString().slice(0, 10)}`,
		object_story_spec: JSON.stringify(specToUse),
		url_tags: NEW_URL_TAGS,
	});
	const newCreativeId = newCreativeData.id as string;
	console.error(`[info] New creative ID: ${newCreativeId}`);

	// Step 4: Verify new creative
	console.error(`[info] Verifying new creative ${newCreativeId}...`);
	const verifiedCreative = await metaGet(newCreativeId, token, { fields: 'id,name,url_tags' });
	console.error(`[info] Verified url_tags: "${verifiedCreative.url_tags ?? '(none)'}"`);
	if (verifiedCreative.url_tags !== NEW_URL_TAGS) {
		warnings.push(`url_tags mismatch after creation. Expected "${NEW_URL_TAGS}", got "${verifiedCreative.url_tags}"`);
	}

	// Step 5: Replace creative on ad
	console.error(`[info] Updating ad ${AD_ID} with new creative ${newCreativeId}...`);
	const adUpdateRes = await metaPost(AD_ID, token, {
		creative: JSON.stringify({ creative_id: newCreativeId }),
	});
	const adUpdated = adUpdateRes.success === true || !!adUpdateRes.id;
	console.error(`[info] Ad update result: ${JSON.stringify(adUpdateRes)}`);

	// Step 6: Verify ad reflects new creative
	console.error(`[info] Verifying ad ${AD_ID}...`);
	const adVerify = await metaGet(AD_ID, token, { fields: 'id,name,creative' });
	const adCreativeId = adVerify.creative?.id ?? adVerify.creative?.creative_id ?? null;
	console.error(`[info] Ad creative after update: ${adCreativeId}`);
	if (adCreativeId !== newCreativeId) {
		warnings.push(`Ad creative ID mismatch after update. Expected ${newCreativeId}, got ${adCreativeId}`);
	}

	// Step 7: Update CRM row
	console.error(`[info] Updating CRM row ${CRM_ROW_ID}...`);
	const now = new Date().toISOString();
	const crmUpdateResult = await db.execute({
		sql: `UPDATE campaign
		      SET external_creative_id = ?,
		          creative_json = json_patch(COALESCE(creative_json, '{}'), ?),
		          updated_at = ?
		      WHERE id = ?`,
		args: [
			newCreativeId,
			JSON.stringify({
				oldCreativeId: OLD_CREATIVE_ID,
				newCreativeId,
				newUrlTags: NEW_URL_TAGS,
				utmFix: 'utm_term+utm_content=ad.name+placement',
				fixedAt: now,
			}),
			now,
			CRM_ROW_ID,
		],
	});
	const rowsAffected = crmUpdateResult.rowsAffected ?? 0;
	console.error(`[info] CRM rows affected: ${rowsAffected}`);
	if (rowsAffected === 0) {
		warnings.push(`CRM row ${CRM_ROW_ID} not found — external_creative_id not updated in DB`);
	}

	const output = {
		old_creative_id: OLD_CREATIVE_ID,
		new_creative_id: newCreativeId,
		new_url_tags: NEW_URL_TAGS,
		final_url_with_tags: `${LANDING_URL}?${NEW_URL_TAGS}`,
		ad_id: AD_ID,
		ad_updated_with_new_creative: adUpdated,
		ad_creative_verified: adCreativeId === newCreativeId,
		crm_row_updated: rowsAffected > 0,
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
