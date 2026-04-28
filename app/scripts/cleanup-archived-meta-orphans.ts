#!/usr/bin/env bun
/**
 * One-shot cleanup: for every CRM campaign with status='archived' that still
 * has external_campaign_id set, DELETE the Meta entities and clear the IDs.
 *
 * Useful after the deleteFromPlatform flag was added — back-fills cleanup for
 * archived campaigns that were created before the flag existed.
 *
 * Run: bun run scripts/cleanup-archived-meta-orphans.ts [--dry-run]
 */
import { createClient } from '@libsql/client';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { createHmac } from 'crypto';

config({ path: resolve(import.meta.dir, '..', '.env') });

const META_GRAPH_URL = 'https://graph.facebook.com/v25.0';
const DRY_RUN = process.argv.includes('--dry-run');

const url = process.env.SQLITE_URI;
const authToken = process.env.SQLITE_AUTH_TOKEN;
const appSecret = process.env.META_APP_SECRET;
if (!url || !appSecret) {
	console.error('Missing SQLITE_URI or META_APP_SECRET');
	process.exit(1);
}

const c = createClient({ url, authToken });

function appsecretProof(token: string): string {
	return createHmac('sha256', appSecret!).update(token).digest('hex');
}

async function metaDelete(
	entityId: string,
	accessToken: string
): Promise<{ ok: boolean; error?: string }> {
	const params = new URLSearchParams({
		access_token: accessToken,
		appsecret_proof: appsecretProof(accessToken)
	});
	try {
		const res = await fetch(`${META_GRAPH_URL}/${entityId}?${params}`, { method: 'DELETE' });
		const data: any = await res.json().catch(() => ({}));
		if (!res.ok || data?.error) {
			return { ok: false, error: data?.error?.message || `HTTP ${res.status}` };
		}
		return { ok: true };
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}
}

async function main() {
	const r = await c.execute(`
		SELECT camp.id, camp.tenant_id, camp.name, camp.external_campaign_id, camp.external_adset_id,
			camp.external_creative_id, camp.external_ad_id, camp.external_ad_account_id,
			ma.integration_id
		FROM campaign camp
		LEFT JOIN meta_ads_account ma
			ON ma.meta_ad_account_id = camp.external_ad_account_id AND ma.tenant_id = camp.tenant_id
		WHERE camp.status = 'archived' AND camp.platform = 'meta' AND camp.external_campaign_id IS NOT NULL
	`);
	console.log(`Found ${r.rows.length} archived campaigns with Meta entities still present.`);
	if (DRY_RUN) console.log('(DRY RUN — no DELETEs will be sent)');

	for (const row of r.rows) {
		const id = row.id as string;
		const integrationId = row.integration_id as string | null;
		const externalIds = [row.external_ad_id, row.external_creative_id, row.external_adset_id, row.external_campaign_id]
			.filter(Boolean) as string[];

		console.log(`\n--- Campaign ${id} (${row.name}) ---`);
		console.log(`  ad=${row.external_ad_id} creative=${row.external_creative_id} adset=${row.external_adset_id} campaign=${row.external_campaign_id}`);

		if (!integrationId) {
			console.log('  ⚠ No integration found for this ad account — skipping');
			continue;
		}

		const tokenR = await c.execute({
			sql: 'SELECT access_token, token_expires_at, is_active FROM meta_ads_integration WHERE id = ?',
			args: [integrationId]
		});
		if (tokenR.rows.length === 0 || !tokenR.rows[0].is_active) {
			console.log('  ⚠ Integration inactive or missing — skipping');
			continue;
		}
		const accessToken = tokenR.rows[0].access_token as string;
		if (!accessToken) {
			console.log('  ⚠ No access token — skipping');
			continue;
		}

		if (DRY_RUN) {
			console.log(`  Would DELETE ${externalIds.length} entities`);
			continue;
		}

		const deleted: string[] = [];
		const failed: Array<{ id: string; error: string }> = [];
		for (const eid of externalIds) {
			process.stdout.write(`  DELETE ${eid} ... `);
			const res = await metaDelete(eid, accessToken);
			if (res.ok) {
				console.log('✓');
				deleted.push(eid);
			} else {
				console.log(`✗ ${res.error}`);
				failed.push({ id: eid, error: res.error ?? 'unknown' });
			}
		}

		// Clear external IDs from CRM row + audit
		await c.execute({
			sql: `UPDATE campaign SET external_campaign_id=NULL, external_adset_id=NULL,
				external_creative_id=NULL, external_ad_id=NULL, updated_at=? WHERE id=?`,
			args: [new Date().toISOString(), id]
		});
		await c.execute({
			sql: `INSERT INTO campaign_audit (id, tenant_id, campaign_id, action, actor_type, actor_id, payload_json, at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			args: [
				crypto.randomUUID().replace(/-/g, '').slice(0, 26),
				row.tenant_id,
				id,
				'platform.cleaned_up',
				'system',
				'cleanup-script',
				JSON.stringify({ deleted, failed }),
				new Date().toISOString()
			]
		});
		console.log(`  Done: deleted=${deleted.length} failed=${failed.length}`);
	}

	console.log('\n✓ Cleanup complete.');
	process.exit(0);
}

main().catch((err) => {
	console.error('ERROR:', err);
	process.exit(1);
});
