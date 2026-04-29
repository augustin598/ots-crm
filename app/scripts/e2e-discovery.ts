#!/usr/bin/env bun
/**
 * Read-only discovery for E2E ads testing.
 * 1. Verifies migrations 0220 + 0221 applied
 * 2. Lists tenants
 * 3. For each tenant: counts clients with active Meta ad accounts
 * 4. Verifies Meta integrations are healthy (token not expired)
 *
 * No writes. Safe to run against production.
 */
import { createClient } from '@libsql/client';
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(import.meta.dir, '..', '.env') });

const url = process.env.SQLITE_URI;
const authToken = process.env.SQLITE_AUTH_TOKEN;
if (!url) {
	console.error('SQLITE_URI not set');
	process.exit(1);
}

const client = createClient({ url, authToken });

async function tableExists(name: string): Promise<boolean> {
	const r = await client.execute({
		sql: `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
		args: [name]
	});
	return r.rows.length > 0;
}

async function main() {
	console.log('=== Migration check ===');
	const apiKeyExists = await tableExists('api_key');
	const campaignExists = await tableExists('campaign');
	const auditExists = await tableExists('campaign_audit');
	const idemExists = await tableExists('campaign_idempotency');
	const targetingExists = await tableExists('meta_targeting_cache');
	console.log(`  api_key:               ${apiKeyExists ? '✓' : '✗ MISSING'}`);
	console.log(`  campaign:              ${campaignExists ? '✓' : '✗ MISSING'}`);
	console.log(`  campaign_audit:        ${auditExists ? '✓' : '✗ MISSING'}`);
	console.log(`  campaign_idempotency:  ${idemExists ? '✓' : '✗ MISSING'}`);
	console.log(`  meta_targeting_cache:  ${targetingExists ? '✓' : '✗ MISSING'}`);
	if (!apiKeyExists || !campaignExists) {
		console.log('\n⚠ Migrations 0220/0221 not applied yet. Restart CRM to trigger runMigrations().');
		process.exit(2);
	}

	console.log('\n=== Tenants ===');
	const tenantsR = await client.execute(`SELECT id, slug, name FROM tenant ORDER BY slug`);
	for (const t of tenantsR.rows) {
		console.log(`  • ${t.slug} (${t.name}) — id=${t.id}`);
	}

	console.log('\n=== Meta integrations (active only) ===');
	const integR = await client.execute(`
		SELECT i.id, i.tenant_id, i.business_id, i.business_name, i.email,
		       i.token_expires_at, i.is_active,
		       (SELECT COUNT(*) FROM meta_ads_account a WHERE a.integration_id = i.id AND a.is_active=1 AND a.client_id IS NOT NULL) AS mapped_active_accounts
		FROM meta_ads_integration i
		WHERE i.is_active = 1
		ORDER BY i.tenant_id
	`);
	const now = Date.now();
	for (const i of integR.rows) {
		const expiresMs = i.token_expires_at ? new Date(i.token_expires_at as string).getTime() : null;
		const days = expiresMs ? Math.floor((expiresMs - now) / 86400000) : null;
		console.log(
			`  • integration=${i.id} tenant=${i.tenant_id} BM="${i.business_name}" email=${i.email} ` +
				`tokenExpires=${days ?? 'never'}d mappedActiveAccounts=${i.mapped_active_accounts}`
		);
	}

	console.log('\n=== Active clients with active Meta ad accounts (top 5 per tenant) ===');
	const clientsR = await client.execute(`
		SELECT c.tenant_id, c.id AS client_id, c.name, a.meta_ad_account_id, a.account_name,
		       a.account_status, a.payment_status
		FROM client c
		JOIN meta_ads_account a ON a.client_id = c.id AND a.is_active = 1
		JOIN meta_ads_integration i ON i.id = a.integration_id AND i.is_active = 1
		WHERE c.status = 'active' OR c.status IS NULL
		ORDER BY c.tenant_id, c.name
		LIMIT 50
	`);
	let lastTenant = '';
	let perTenant = 0;
	for (const c of clientsR.rows) {
		if (c.tenant_id !== lastTenant) {
			lastTenant = c.tenant_id as string;
			perTenant = 0;
			console.log(`  tenant=${lastTenant}:`);
		}
		if (perTenant >= 5) continue;
		perTenant++;
		console.log(
			`    • client="${c.name}" id=${c.client_id} adAccount=${c.meta_ad_account_id} ` +
				`("${c.account_name}") accStatus=${c.account_status} pay=${c.payment_status}`
		);
	}

	console.log('\n=== Existing API keys ===');
	const keysR = await client.execute(
		`SELECT id, tenant_id, name, key_prefix, scopes, last_used_at, revoked_at, expires_at FROM api_key ORDER BY created_at DESC LIMIT 10`
	);
	if (keysR.rows.length === 0) {
		console.log('  (none — must be created via UI or directly inserted)');
	} else {
		for (const k of keysR.rows) {
			console.log(
				`  • ${k.name} prefix=${k.key_prefix} tenant=${k.tenant_id} scopes=${k.scopes} ` +
					`revoked=${k.revoked_at ?? 'no'} lastUsed=${k.last_used_at ?? 'never'}`
			);
		}
	}

	console.log('\n=== Existing campaigns ===');
	const campR = await client.execute(`SELECT COUNT(*) AS n FROM campaign`);
	console.log(`  total rows: ${campR.rows[0].n}`);

	console.log('\nDone.');
	process.exit(0);
}

main().catch((err) => {
	console.error('ERROR:', err);
	process.exit(1);
});
