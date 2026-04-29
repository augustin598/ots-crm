#!/usr/bin/env bun
/**
 * One-shot cleanup: șterge draft-ul de campanie creat greșit pe BeautyOneShop.ro
 * și row-ul intern din CRM.
 *
 * Usage: cd app && bun scripts/delete-draft-beone-wrong-account.ts
 */
import { createClient } from '@libsql/client';
import { createHmac } from 'node:crypto';
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(import.meta.dir, '..', '.env') });

const SQLITE_URI = process.env.SQLITE_URI;
const SQLITE_AUTH_TOKEN = process.env.SQLITE_AUTH_TOKEN;
const META_APP_SECRET = process.env.META_APP_SECRET;

const META_GRAPH_URL = 'https://graph.facebook.com/v21.0';

// ── IDs de șters ───────────────────────────────────────────────────────────────
const CRM_CAMPAIGN_ID = 'yy3bg4pmc2vfunr5uh5vvns5';
const AD_ACCOUNT_ID = 'act_275835948024308'; // BeautyOneShop.ro

const META_IDS = {
	ad:       '120244344988670052',
	creative: '851876850552343',
	adset:    '120244344986480052',
	campaign: '120244344985690052',
} as const;

// ──────────────────────────────────────────────────────────────────────────────

if (!SQLITE_URI) { console.error('SQLITE_URI not set'); process.exit(1); }
if (!META_APP_SECRET) { console.error('META_APP_SECRET not set'); process.exit(1); }

const db = createClient({ url: SQLITE_URI, authToken: SQLITE_AUTH_TOKEN });

function appSecretProof(token: string): string {
	return createHmac('sha256', META_APP_SECRET!).update(token).digest('hex');
}

type DeleteOutcome = 'success' | 'already_gone' | { error: string };

async function metaDelete(objectId: string, accessToken: string): Promise<DeleteOutcome> {
	const proof = appSecretProof(accessToken);
	const url = `${META_GRAPH_URL}/${objectId}?access_token=${accessToken}&appsecret_proof=${proof}`;

	let res: Response;
	try {
		res = await fetch(url, {
			method: 'DELETE',
			signal: AbortSignal.timeout(20_000),
		});
	} catch (err) {
		return { error: `network: ${err instanceof Error ? err.message : String(err)}` };
	}

	const body: any = await res.json().catch(() => ({}));

	if (body?.success === true) return 'success';

	const code: number = body?.error?.code ?? 0;
	const msg: string = body?.error?.message ?? JSON.stringify(body);

	if (code === 100 || code === 200 || msg.toLowerCase().includes('does not exist') || msg.toLowerCase().includes('not found')) {
		return 'already_gone';
	}

	return { error: `code=${code} msg=${msg}` };
}

async function main() {
	// 1. Găsește access_token-ul pentru contul de ad
	const accountRow = await db.execute({
		sql: `SELECT a.integration_id, i.access_token
		      FROM meta_ads_account a
		      JOIN meta_ads_integration i ON i.id = a.integration_id
		      WHERE a.meta_ad_account_id = ?
		      LIMIT 1`,
		args: [AD_ACCOUNT_ID],
	});

	if (accountRow.rows.length === 0) {
		console.log(JSON.stringify({
			ok: false,
			reason: 'account_not_found_in_crm',
			ad_account_id: AD_ACCOUNT_ID,
		}, null, 2));
		return;
	}

	const accessToken = accountRow.rows[0].access_token as string;
	const integrationId = accountRow.rows[0].integration_id as string;
	console.error(`[info] integration_id=${integrationId}, token_len=${accessToken?.length ?? 0}`);

	if (!accessToken) {
		console.log(JSON.stringify({ ok: false, reason: 'token_missing' }, null, 2));
		return;
	}

	// 2. DELETE Meta objects (copii înaintea părinților)
	console.error('[info] Ștergere Meta: ad...');
	const adResult     = await metaDelete(META_IDS.ad, accessToken);
	console.error(`[info] ad → ${JSON.stringify(adResult)}`);

	console.error('[info] Ștergere Meta: creative...');
	const creativeResult = await metaDelete(META_IDS.creative, accessToken);
	console.error(`[info] creative → ${JSON.stringify(creativeResult)}`);

	console.error('[info] Ștergere Meta: adset...');
	const adsetResult  = await metaDelete(META_IDS.adset, accessToken);
	console.error(`[info] adset → ${JSON.stringify(adsetResult)}`);

	console.error('[info] Ștergere Meta: campaign...');
	const campaignResult = await metaDelete(META_IDS.campaign, accessToken);
	console.error(`[info] campaign → ${JSON.stringify(campaignResult)}`);

	// Oprire dacă campaign sau adset au erori ne-ignorabile
	const fatal = (r: DeleteOutcome) => typeof r === 'object' && 'error' in r;
	if (fatal(adResult) || fatal(adsetResult) || fatal(campaignResult)) {
		console.log(JSON.stringify({
			ok: false,
			reason: 'meta_delete_failed',
			deleted_at_meta: { ad: adResult, creative: creativeResult, adset: adsetResult, campaign: campaignResult },
			deleted_at_crm: null,
		}, null, 2));
		return;
	}

	// 3. DELETE din CRM DB (cascade elimină campaign_audit și campaign_idempotency)
	console.error(`[info] Ștergere CRM campaign id=${CRM_CAMPAIGN_ID}...`);
	const del = await db.execute({
		sql: `DELETE FROM campaign WHERE id = ?`,
		args: [CRM_CAMPAIGN_ID],
	});

	const rowsAffected = del.rowsAffected ?? 0;
	console.error(`[info] rows_affected=${rowsAffected}`);

	// 4. Output final
	console.log(JSON.stringify({
		ok: true,
		deleted_at_meta: { ad: adResult, creative: creativeResult, adset: adsetResult, campaign: campaignResult },
		deleted_at_crm: { rows_affected: rowsAffected },
	}, null, 2));
}

main().catch(console.error).finally(() => db.close());
