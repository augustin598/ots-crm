#!/usr/bin/env bun
/**
 * Diagnose + activate adset+ad for BeOne campaign that was approved at campaign level only.
 * Campaign: 120244708005960052, Adset: 120244708006200052, Ad: 120244708007500052
 * Usage: cd app && bun scripts/_fix-beone-campaign-adset-ad-active.ts
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
const AD_ACCOUNT_ID = 'act_275835948024308';

const CAMPAIGN_ID = '120244708005960052';
const ADSET_ID    = '120244708006200052';
const AD_ID       = '120244708007500052';

if (!SQLITE_URI)      { console.error('SQLITE_URI missing'); process.exit(1); }
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
		throw new Error(`Meta GET /${path}: code=${e.code} msg="${e.message}"`);
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
		throw new Error(`Meta POST /${path}: code=${e.code} msg="${e.message}"`);
	}
	return data;
}

async function getEntityStatus(id: string, token: string): Promise<{ id: string; name: string; status: string; effective_status: string }> {
	return metaGet(id, token, { fields: 'id,name,status,effective_status' });
}

async function main() {
	// 1. Get access token
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

	let accessToken: string;
	if (tokenRes.rows.length > 0 && tokenRes.rows[0]!.access_token) {
		accessToken = tokenRes.rows[0]!.access_token as string;
		console.error('[info] Got token via account join');
	} else {
		console.error('[fatal] No active Meta integration token for', AD_ACCOUNT_ID);
		process.exit(1);
	}

	// 2. State BEFORE
	console.error('[step] Fetching current status from Meta...');
	const [campaignBefore, adsetBefore, adBefore] = await Promise.all([
		getEntityStatus(CAMPAIGN_ID, accessToken),
		getEntityStatus(ADSET_ID, accessToken),
		getEntityStatus(AD_ID, accessToken),
	]);

	const meta_state_before = {
		campaign: { id: campaignBefore.id, name: campaignBefore.name, status: campaignBefore.status, effective_status: campaignBefore.effective_status },
		adset:    { id: adsetBefore.id,    name: adsetBefore.name,    status: adsetBefore.status,    effective_status: adsetBefore.effective_status },
		ad:       { id: adBefore.id,       name: adBefore.name,       status: adBefore.status,       effective_status: adBefore.effective_status },
	};
	console.error('[before]', JSON.stringify(meta_state_before, null, 2));

	// 3. Activate adset + ad (only if not already ACTIVE)
	const activation_results: Record<string, unknown> = {};

	if (adsetBefore.status !== 'ACTIVE') {
		console.error(`[step] Activating adset ${ADSET_ID}...`);
		const r = await metaPost(ADSET_ID, accessToken, { status: 'ACTIVE' });
		activation_results.adset_set_active = r;
		console.error('[ok] Adset activated:', r);
	} else {
		activation_results.adset_set_active = 'already_active';
		console.error('[skip] Adset already ACTIVE');
	}

	if (adBefore.status !== 'ACTIVE') {
		console.error(`[step] Activating ad ${AD_ID}...`);
		const r = await metaPost(AD_ID, accessToken, { status: 'ACTIVE' });
		activation_results.ad_set_active = r;
		console.error('[ok] Ad activated:', r);
	} else {
		activation_results.ad_set_active = 'already_active';
		console.error('[skip] Ad already ACTIVE');
	}

	// 4. State AFTER
	console.error('[step] Fetching post-update status from Meta...');
	const [campaignAfter, adsetAfter, adAfter] = await Promise.all([
		getEntityStatus(CAMPAIGN_ID, accessToken),
		getEntityStatus(ADSET_ID, accessToken),
		getEntityStatus(AD_ID, accessToken),
	]);

	const meta_state_after = {
		campaign: { id: campaignAfter.id, name: campaignAfter.name, status: campaignAfter.status, effective_status: campaignAfter.effective_status },
		adset:    { id: adsetAfter.id,    name: adsetAfter.name,    status: adsetAfter.status,    effective_status: adsetAfter.effective_status },
		ad:       { id: adAfter.id,       name: adAfter.name,       status: adAfter.status,       effective_status: adAfter.effective_status },
	};

	// 5. Output JSON
	console.log(JSON.stringify({
		meta_state_before,
		activation_results,
		meta_state_after,
		code_path_for_approve: 'src/lib/server/campaigns/patch.ts:203 — toggleCampaignStatus() called only on externalCampaignId, never touches adsets/ads',
		preventive_fix_proposal: [
			'Option A (preferred): At approve time, after toggling campaign ACTIVE, call GET /<campaignId>/adsets?fields=id,status',
			'  then for each adset that is PAUSED: POST /<adsetId> status=ACTIVE.',
			'  Then for each adset, GET /<adsetId>/ads?fields=id,status and POST each PAUSED ad status=ACTIVE.',
			'Option B (simpler, structural): When creating the campaign on Meta, keep adset+ad ACTIVE',
			'  and only set the campaign itself to PAUSED. When the campaign is PAUSED, children cannot deliver',
			'  regardless of their own status. Approve only needs to flip campaign → ACTIVE and everything',
			'  cascades automatically. Zero extra API calls at approve time.',
		].join('\n'),
		fix_applied: false,
	}, null, 2));
}

main().catch((err) => {
	console.error('[fatal]', err);
	process.exit(1);
}).finally(() => db.close());
