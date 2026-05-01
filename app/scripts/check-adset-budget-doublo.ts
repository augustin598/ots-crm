#!/usr/bin/env bun
/**
 * Verifică daily_budget pe adset 6917166353602 (DOUBLO GOLD #1)
 * și face UPDATE pe recomandarea rjc335xs27idgfrqkstikjzm.
 * Usage: cd app && bun scripts/check-adset-budget-doublo.ts
 */
import { createClient } from '@libsql/client';
import { createHmac } from 'node:crypto';
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(import.meta.dir, '..', '.env') });

const SQLITE_URI = process.env.SQLITE_URI;
const SQLITE_AUTH_TOKEN = process.env.SQLITE_AUTH_TOKEN;
const META_APP_SECRET = process.env.META_APP_SECRET;
const ADSET_ID = '6917166353602';
const AD_ACCOUNT_ID = 'act_818842774503712';
const RECOMMENDATION_ID = 'rjc335xs27idgfrqkstikjzm';
const EXPECTED_BUDGET_CENTS = 2501;

if (!SQLITE_URI) { console.error('SQLITE_URI not set'); process.exit(1); }
if (!META_APP_SECRET) { console.error('META_APP_SECRET not set'); process.exit(1); }

const db = createClient({ url: SQLITE_URI, authToken: SQLITE_AUTH_TOKEN });

function generateAppSecretProof(accessToken: string, appSecret: string): string {
	return createHmac('sha256', appSecret).update(accessToken).digest('hex');
}

async function main() {
	// 1. Fetch access_token din DB pentru contul Meta
	const row = await db.execute({
		sql: `SELECT i.access_token
		      FROM meta_ads_integration i
		      JOIN meta_ads_account a ON a.integration_id = i.id
		      WHERE a.meta_ad_account_id = ?
		        AND a.is_active = 1
		      LIMIT 1`,
		args: [AD_ACCOUNT_ID]
	});

	if (row.rows.length === 0) {
		console.log(JSON.stringify({ error: 'account_not_found', ad_account: AD_ACCOUNT_ID }, null, 2));
		return;
	}

	const accessToken = row.rows[0]!.access_token as string;
	console.error(`[info] access_token present: ${accessToken ? 'DA' : 'NU'} (${accessToken?.length}c)`);

	// 2. Apel Meta API
	const proof = generateAppSecretProof(accessToken, META_APP_SECRET!);
	const url = `https://graph.facebook.com/v25.0/${ADSET_ID}?fields=id,name,daily_budget,status&access_token=${accessToken}&appsecret_proof=${proof}`;

	const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
	const data: any = await res.json();

	if (data.error) {
		console.log(JSON.stringify({ error: 'meta_api_error', details: data.error }, null, 2));
		return;
	}

	const metaResponse = {
		id: data.id,
		name: data.name,
		daily_budget: data.daily_budget,
		status: data.status
	};

	const dailyBudgetCents = parseInt(data.daily_budget ?? '0', 10);
	const match = dailyBudgetCents === EXPECTED_BUDGET_CENTS;

	console.error(`[info] daily_budget din Meta: ${dailyBudgetCents} cents, expected: ${EXPECTED_BUDGET_CENTS}, match: ${match}`);

	// 3. UPDATE recomandare în DB
	let recommendationDbUpdated = false;
	try {
		const rationale = JSON.stringify({
			strategy: 'single_adset',
			isCBO: false,
			adset_count: 1,
			changes: [{ adsetId: '6917166353602', name: '#1 - Salon / Interes- Audience - Leadform – Copy', oldBudget: 3500, newBudget: 2501 }],
			partial: false
		});

		await db.execute({
			sql: `UPDATE ad_optimization_recommendation
			      SET status='applied',
			          applied_at=current_timestamp,
			          apply_error=NULL,
			          decision_rationale_json=?,
			          updated_at=current_timestamp
			      WHERE id = ?`,
			args: [rationale, RECOMMENDATION_ID]
		});
		recommendationDbUpdated = true;
		console.error(`[info] DB updated ok`);
	} catch (e) {
		console.error(`[error] DB update failed: ${e}`);
	}

	console.log(JSON.stringify({
		meta_response: metaResponse,
		expected_budget_cents: EXPECTED_BUDGET_CENTS,
		match,
		recommendation_db_updated: recommendationDbUpdated
	}, null, 2));
}

main().catch(console.error).finally(() => db.close());
