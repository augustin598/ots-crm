#!/usr/bin/env bun
/**
 * One-shot: șterge campaniile orfane create pe act_818842774503712 (BeOne Medical)
 * în timpul sesiunii de debug DOUBLO GOLD — create parțial (campaign + adset + creative),
 * dar ad-ul a eșuat, deci nu există în CRM.
 *
 * KEEP (nu șterge): campaign 6930953440602, adset 6930953442802, creative 1445038523574962, ad 6930953451402
 *
 * Usage: cd app && bun scripts/cleanup-orphans-beone-doublo.ts [--dry-run]
 */
import { createClient } from '@libsql/client';
import { createHmac } from 'node:crypto';
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(import.meta.dir, '..', '.env') });

const META_GRAPH_URL = 'https://graph.facebook.com/v25.0';
const AD_ACCOUNT_ID = 'act_818842774503712';
const DRY_RUN = process.argv.includes('--dry-run');

const KEEP_CAMPAIGN_ID = '6930953440602';
const KEEP_ADSET_ID    = '6930953442802';
const KEEP_CREATIVE_ID = '1445038523574962';
const KEEP_AD_ID       = '6930953451402';
const KNOWN_ORPHAN_CREATIVE = '6930953003602';

const SQLITE_URI        = process.env.SQLITE_URI;
const SQLITE_AUTH_TOKEN = process.env.SQLITE_AUTH_TOKEN;
const META_APP_SECRET   = process.env.META_APP_SECRET;

if (!SQLITE_URI) { console.error('SQLITE_URI not set'); process.exit(1); }
if (!META_APP_SECRET) { console.error('META_APP_SECRET not set'); process.exit(1); }

const db = createClient({ url: SQLITE_URI, authToken: SQLITE_AUTH_TOKEN });

function appSecretProof(token: string): string {
	return createHmac('sha256', META_APP_SECRET!).update(token).digest('hex');
}

async function metaGet(path: string, accessToken: string, extraParams: Record<string, string> = {}): Promise<any> {
	const params = new URLSearchParams({
		access_token: accessToken,
		appsecret_proof: appSecretProof(accessToken),
		...extraParams,
	});
	const res = await fetch(`${META_GRAPH_URL}/${path}?${params}`, {
		signal: AbortSignal.timeout(20_000),
	});
	return res.json().catch(() => ({}));
}

type DeleteOutcome = 'success' | 'already_gone' | { error: string };

async function metaDelete(objectId: string, accessToken: string): Promise<DeleteOutcome> {
	if (DRY_RUN) return 'success'; // simulate in dry-run
	const params = new URLSearchParams({
		access_token: accessToken,
		appsecret_proof: appSecretProof(accessToken),
	});
	let res: Response;
	try {
		res = await fetch(`${META_GRAPH_URL}/${objectId}?${params}`, {
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

	if (
		code === 100 || code === 200 ||
		msg.toLowerCase().includes('does not exist') ||
		msg.toLowerCase().includes('not found') ||
		msg.toLowerCase().includes('invalid parameter') ||
		msg.toLowerCase().includes('unsupported delete')
	) return 'already_gone';

	return { error: `code=${code} msg=${msg}` };
}

interface Deleted {
	campaigns: string[];
	adsets: string[];
	creatives: string[];
	ads: string[];
}

async function main() {
	// 1. Obține access token
	const accountRow = await db.execute({
		sql: `SELECT a.integration_id, i.access_token
		      FROM meta_ads_account a
		      JOIN meta_ads_integration i ON i.id = a.integration_id
		      WHERE a.meta_ad_account_id = ?
		      LIMIT 1`,
		args: [AD_ACCOUNT_ID],
	});

	if (accountRow.rows.length === 0) {
		console.log(JSON.stringify({ ok: false, reason: 'account_not_found_in_crm', ad_account_id: AD_ACCOUNT_ID }, null, 2));
		return;
	}

	const accessToken = accountRow.rows[0].access_token as string;
	console.error(`[info] integration_id=${accountRow.rows[0].integration_id} token_len=${accessToken?.length ?? 0}`);

	if (!accessToken) {
		console.log(JSON.stringify({ ok: false, reason: 'token_missing' }, null, 2));
		return;
	}

	// 2. Listează campaniile recente (ultimele 3h) de pe contul BeOne
	const threeHoursAgo = Math.floor((Date.now() - 3 * 60 * 60 * 1000) / 1000);
	const filterJson = JSON.stringify([{ field: 'created_time', operator: 'GREATER_THAN', value: threeHoursAgo }]);

	const campaignsData = await metaGet(
		`${AD_ACCOUNT_ID}/campaigns`,
		accessToken,
		{ fields: 'id,name,status,created_time', limit: '50', filtering: filterJson },
	);

	if (campaignsData?.error) {
		console.log(JSON.stringify({ ok: false, reason: 'meta_api_error', error: campaignsData.error }, null, 2));
		return;
	}

	const allCampaigns: Array<{ id: string; name: string; status: string; created_time: string }> =
		campaignsData?.data ?? [];

	console.error(`[info] Campanii găsite în ultimele 3h: ${allCampaigns.length}`);
	for (const c of allCampaigns) {
		console.error(`  ${c.id === KEEP_CAMPAIGN_ID ? '✓ KEEP' : '? CANDIDATE'} ${c.id}  "${c.name}"  ${c.status}  ${c.created_time}`);
	}

	const orphanCampaigns = allCampaigns.filter(c => c.id !== KEEP_CAMPAIGN_ID);
	console.error(`[info] Campanii orfane candidate: ${orphanCampaigns.length}`);

	const deleted: Deleted = { campaigns: [], adsets: [], creatives: [], ads: [] };
	const errors: Array<{ entity: string; id: string; error: string }> = [];

	// 3. Șterge creative orfan cunoscut (6930953003602) direct, înainte de a umbla la campaign
	console.error(`\n[info] Tentativă ștergere creative orfan cunoscut ${KNOWN_ORPHAN_CREATIVE}...`);
	if (DRY_RUN) {
		console.error(`  [dry-run] Would DELETE creative ${KNOWN_ORPHAN_CREATIVE}`);
	} else {
		const cr = await metaDelete(KNOWN_ORPHAN_CREATIVE, accessToken);
		console.error(`  creative ${KNOWN_ORPHAN_CREATIVE} → ${JSON.stringify(cr)}`);
		if (cr === 'success') deleted.creatives.push(KNOWN_ORPHAN_CREATIVE);
		else if (cr === 'already_gone') console.error('  (already gone — ok)');
		else errors.push({ entity: 'creative', id: KNOWN_ORPHAN_CREATIVE, error: (cr as any).error });
	}

	// 4. Pentru fiecare campanie orfană: listează adset-uri → ads → șterge în ordine
	for (const campaign of orphanCampaigns) {
		console.error(`\n[info] Procesez orphan campaign ${campaign.id} "${campaign.name}"...`);

		// 4a. Adsets
		const adsetsData = await metaGet(`${campaign.id}/adsets?fields=id,name,status`, accessToken);
		const adsets: Array<{ id: string; name: string }> = adsetsData?.data ?? [];
		console.error(`  Adsets: ${adsets.length}`);

		for (const adset of adsets) {
			if (adset.id === KEEP_ADSET_ID) {
				console.error(`  ⚠ SKIP adset ${adset.id} (e cel valid!)`);
				continue;
			}

			// 4b. Ads sub adset
			const adsData = await metaGet(`${adset.id}/ads?fields=id,name,status`, accessToken);
			const ads: Array<{ id: string }> = adsData?.data ?? [];
			console.error(`    Ads în ${adset.id}: ${ads.length}`);

			for (const ad of ads) {
				console.error(`    DELETE ad ${ad.id}...`);
				if (DRY_RUN) { console.error('    [dry-run]'); continue; }
				const r = await metaDelete(ad.id, accessToken);
				console.error(`    ad ${ad.id} → ${JSON.stringify(r)}`);
				if (r === 'success') deleted.ads.push(ad.id);
				else if (r === 'already_gone') { /* ok */ }
				else errors.push({ entity: 'ad', id: ad.id, error: (r as any).error });
			}

			// 4c. DELETE adset
			console.error(`    DELETE adset ${adset.id}...`);
			if (DRY_RUN) { console.error('    [dry-run]'); continue; }
			const r = await metaDelete(adset.id, accessToken);
			console.error(`    adset ${adset.id} → ${JSON.stringify(r)}`);
			if (r === 'success') deleted.adsets.push(adset.id);
			else if (r === 'already_gone') { /* ok */ }
			else errors.push({ entity: 'adset', id: adset.id, error: (r as any).error });
		}

		// 4d. DELETE campaign
		console.error(`  DELETE campaign ${campaign.id}...`);
		if (DRY_RUN) { console.error('  [dry-run]'); continue; }
		const r = await metaDelete(campaign.id, accessToken);
		console.error(`  campaign ${campaign.id} → ${JSON.stringify(r)}`);
		if (r === 'success') deleted.campaigns.push(campaign.id);
		else if (r === 'already_gone') { /* ok */ }
		else errors.push({ entity: 'campaign', id: campaign.id, error: (r as any).error });
	}

	// 5. Output
	console.log(JSON.stringify({
		ok: errors.length === 0,
		dry_run: DRY_RUN,
		kept: {
			campaign: KEEP_CAMPAIGN_ID,
			adset:    KEEP_ADSET_ID,
			creative: KEEP_CREATIVE_ID,
			ad:       KEEP_AD_ID,
		},
		orphans_deleted: {
			campaigns: deleted.campaigns,
			adsets:    deleted.adsets,
			creatives: deleted.creatives,
			ads:       deleted.ads,
			total:     deleted.campaigns.length + deleted.adsets.length + deleted.creatives.length + deleted.ads.length,
		},
		errors: errors.length > 0 ? errors : undefined,
	}, null, 2));
}

main().catch(console.error).finally(() => db.close());
