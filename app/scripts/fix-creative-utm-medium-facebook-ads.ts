#!/usr/bin/env bun
/**
 * Fix utm_medium for creative 2405193339946685 / ad 120244708007500052.
 * Changes utm_medium=paid_social → utm_medium=Facebook_Ads.
 * Meta doesn't allow PATCH on creatives → recreate + repoint ad.
 *
 * Usage: cd app && bun scripts/fix-creative-utm-medium-facebook-ads.ts
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

const OLD_CREATIVE_ID = '2405193339946685';
const AD_ID = '120244708007500052';
const AD_ACCOUNT_ID = 'act_275835948024308';

const NEW_URL_TAGS =
	'utm_source={{site_source_name}}&utm_medium=Facebook_Ads&utm_campaign={{campaign.name}}&utm_term={{adset.id}}&utm_content={{ad.id}}&placement={{placement}}';

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
		throw new Error(`Meta GET /${path}: code=${e.code} msg="${e.message}" trace=${e.fbtrace_id ?? ''}`);
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
		throw new Error(`Meta POST /${path}: code=${e.code} msg="${e.message}" trace=${e.fbtrace_id ?? ''}`);
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

	// Step 1: GET old creative — copy object_story_spec exactly
	console.error(`[info] Fetching creative ${OLD_CREATIVE_ID}...`);
	const oldCreative = await metaGet(OLD_CREATIVE_ID, token, {
		fields: 'id,name,url_tags,object_story_spec',
	});
	console.error(`[info] Old creative name: "${oldCreative.name}"`);
	console.error(`[info] Old url_tags: "${oldCreative.url_tags ?? '(empty)'}"`);

	const spec = oldCreative.object_story_spec;
	if (!spec) throw new Error(`Creative ${OLD_CREATIVE_ID} has no object_story_spec`);

	// Step 2: POST new creative with same spec + new url_tags
	console.error('[info] Creating new creative...');
	const newCreativeData = await metaPost(`${AD_ACCOUNT_ID}/adcreatives`, token, {
		name: `Creative — utm_medium=Facebook_Ads fix — ${new Date().toISOString().slice(0, 10)}`,
		object_story_spec: JSON.stringify(spec),
		url_tags: NEW_URL_TAGS,
	});
	const newCreativeId = newCreativeData.id as string;
	console.error(`[info] New creative ID: ${newCreativeId}`);

	// Step 3: Verify new creative url_tags
	const newCreative = await metaGet(newCreativeId, token, {
		fields: 'id,name,url_tags,object_story_spec',
	});
	console.error(`[info] New url_tags verified: "${newCreative.url_tags ?? '(empty)'}"`);

	// Step 4: Repoint ad → new creative
	console.error(`[info] Updating ad ${AD_ID} → creative ${newCreativeId}...`);
	const adUpdateRes = await metaPost(AD_ID, token, {
		creative: JSON.stringify({ creative_id: newCreativeId }),
	});
	console.error(`[info] Ad update response: ${JSON.stringify(adUpdateRes)}`);

	// Verify ad creative pointer
	const adVerify = await metaGet(AD_ID, token, { fields: 'id,name,creative' });
	const adCreativeNow = adVerify.creative?.id ?? adVerify.creative?.creative_id ?? null;
	console.error(`[info] Ad now points to creative: ${adCreativeNow}`);

	const output = {
		old_creative_id: OLD_CREATIVE_ID,
		old_url_tags: oldCreative.url_tags ?? null,
		new_creative_id: newCreativeId,
		new_url_tags_verified: newCreative.url_tags ?? null,
		ad_id: AD_ID,
		ad_now_points_to: adCreativeNow,
		success: adCreativeNow === newCreativeId && newCreative.url_tags === NEW_URL_TAGS,
	};

	console.log(JSON.stringify(output, null, 2));
}

main()
	.catch((err) => {
		console.error('[fatal]', err instanceof Error ? err.message : String(err));
		process.exit(1);
	})
	.finally(() => db.close());
