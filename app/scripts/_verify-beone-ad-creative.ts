#!/usr/bin/env bun
import { createClient } from '@libsql/client';
import { createHmac } from 'node:crypto';
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(import.meta.dir, '..', '.env') });

const SQLITE_URI = process.env.SQLITE_URI;
const SQLITE_AUTH_TOKEN = process.env.SQLITE_AUTH_TOKEN;
const META_APP_SECRET = process.env.META_APP_SECRET;
const AD_ACCOUNT_ID = 'act_275835948024308';
const AD_ID = '120244708007500052';
const META_GRAPH_URL = 'https://graph.facebook.com/v25.0';

const db = createClient({ url: SQLITE_URI!, authToken: SQLITE_AUTH_TOKEN });

function proof(token: string) {
	return createHmac('sha256', META_APP_SECRET!).update(token).digest('hex');
}

async function main() {
	// Get token for ad account
	const row = await db.execute({
		sql: `SELECT i.access_token
		      FROM meta_ads_integration i
		      JOIN meta_ads_account a ON a.integration_id = i.id
		      WHERE a.meta_ad_account_id = ?
		        AND a.is_active = 1
		        AND i.is_active = 1
		      LIMIT 1`,
		args: [AD_ACCOUNT_ID]
	});

	let token = (row.rows[0]?.access_token ?? '') as string;

	if (!token) {
		// fallback: any active integration
		const fallback = await db.execute({
			sql: `SELECT access_token FROM meta_ads_integration WHERE is_active = 1 LIMIT 1`,
			args: []
		});
		token = (fallback.rows[0]?.access_token ?? '') as string;
	}

	if (!token) {
		console.log('No active Meta token found in DB for', AD_ACCOUNT_ID);
		return;
	}

	// Decrypt if needed (check if it looks like ciphertext)
	// The project uses encrypt/decrypt from $lib/server/crypto — replicate here
	// Check if token starts with known base64 pattern (encrypted tokens are longer)
	// Try using it directly first; if we need to decrypt, import the util
	const p = proof(token);

	// Step 1: Get ad
	const adUrl = `${META_GRAPH_URL}/${AD_ID}?fields=id,name,status,creative&access_token=${token}&appsecret_proof=${p}`;
	const adRes = await fetch(adUrl, { signal: AbortSignal.timeout(15_000) });
	const adData: any = await adRes.json();

	if (adData.error) {
		console.log('Ad API error:', JSON.stringify(adData.error));
		return;
	}

	const creativeId = adData.creative?.id;
	console.log('ad_id:', adData.id);
	console.log('ad_name:', adData.name);
	console.log('ad_status:', adData.status);
	console.log('creative_id:', creativeId);

	if (!creativeId) {
		console.log('No creative found');
		return;
	}

	// Step 2: Get creative
	const creativeUrl = `${META_GRAPH_URL}/${creativeId}?fields=id,url_tags,object_story_spec{link_data}&access_token=${token}&appsecret_proof=${p}`;
	const creativeRes = await fetch(creativeUrl, { signal: AbortSignal.timeout(15_000) });
	const creativeData: any = await creativeRes.json();

	if (creativeData.error) {
		console.log('Creative API error:', JSON.stringify(creativeData.error));
		return;
	}

	const urlTags = creativeData.url_tags ?? '(empty)';
	const link = creativeData.object_story_spec?.link_data?.link ?? '(no link)';

	console.log('\ncreative_id:', creativeData.id);
	console.log('url_tags:', urlTags);
	console.log('link:', link);

	// Verdict
	const hasAdsetId = urlTags.includes('{{adset.id}}');
	const hasAdId = urlTags.includes('{{ad.id}}');
	const hasAdsetName = urlTags.includes('{{adset.name}}');
	const hasAdName = urlTags.includes('{{ad.name}}');

	console.log('\n--- VERDICT ---');
	if (hasAdsetId && hasAdId && !hasAdsetName && !hasAdName) {
		console.log('CORRECT: url_tags uses numeric IDs ({{adset.id}} + {{ad.id}})');
	} else if (hasAdsetName || hasAdName) {
		console.log('ERROR: url_tags still uses NAMES ({{adset.name}} or {{ad.name}}) — fix NOT applied');
		if (hasAdsetName) console.log('  → contains {{adset.name}}');
		if (hasAdName) console.log('  → contains {{ad.name}}');
	} else {
		console.log('WARNING: url_tags does not contain expected macros');
		console.log('  hasAdsetId:', hasAdsetId, 'hasAdId:', hasAdId);
	}
}

main().catch(console.error).finally(() => db.close());
