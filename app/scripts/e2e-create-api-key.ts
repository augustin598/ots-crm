#!/usr/bin/env bun
/**
 * Creates an API key for E2E testing of the ads automation pipeline.
 * Picks the first owner/admin user of the 'ots' tenant.
 * Outputs the plaintext key ONCE — copy it from the script output.
 *
 * Idempotent on key NAME — if "e2e-test" already exists and is not revoked,
 * we revoke it and create a fresh one (since plaintext is not retrievable).
 */
import { createClient } from '@libsql/client';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { encodeBase32LowerCase, encodeHexLowerCase } from '@oslojs/encoding';
import { sha256 } from '@oslojs/crypto/sha2';

config({ path: resolve(import.meta.dir, '..', '.env') });

const TENANT_SLUG = 'ots';
const KEY_NAME = 'e2e-test';
const SCOPES = ['campaigns:read', 'campaigns:write', 'clients:read', 'integrations:read'];

const url = process.env.SQLITE_URI;
const authToken = process.env.SQLITE_AUTH_TOKEN;
if (!url) {
	console.error('SQLITE_URI not set');
	process.exit(1);
}
const c = createClient({ url, authToken });

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}
function generateSecret(): string {
	return encodeHexLowerCase(crypto.getRandomValues(new Uint8Array(24)));
}
function hashKey(plaintext: string): string {
	return encodeHexLowerCase(sha256(new TextEncoder().encode(plaintext)));
}

async function main() {
	// Resolve tenant
	const tenantR = await c.execute({
		sql: `SELECT id, slug FROM tenant WHERE slug = ?`,
		args: [TENANT_SLUG]
	});
	if (tenantR.rows.length === 0) {
		console.error(`Tenant '${TENANT_SLUG}' not found`);
		process.exit(2);
	}
	const tenant = tenantR.rows[0];
	const tenantId = tenant.id as string;

	// Resolve owner/admin user on this tenant
	const userR = await c.execute({
		sql: `SELECT u.id, u.email, tu.role FROM user u
			JOIN tenant_user tu ON tu.user_id = u.id
			WHERE tu.tenant_id = ? AND tu.role IN ('owner', 'admin')
			ORDER BY tu.role, tu.created_at LIMIT 1`,
		args: [tenantId]
	});
	if (userR.rows.length === 0) {
		console.error(`No owner/admin user found on tenant '${TENANT_SLUG}'`);
		process.exit(3);
	}
	const user = userR.rows[0];
	const userId = user.id as string;
	console.log(`Using tenant=${tenantId} (${TENANT_SLUG}) owner=${user.email} role=${user.role}`);

	// Revoke existing 'e2e-test' if present
	const existing = await c.execute({
		sql: `SELECT id FROM api_key WHERE tenant_id = ? AND name = ? AND revoked_at IS NULL`,
		args: [tenantId, KEY_NAME]
	});
	for (const row of existing.rows) {
		await c.execute({
			sql: `UPDATE api_key SET revoked_at = ? WHERE id = ?`,
			args: [new Date().toISOString(), row.id as string]
		});
		console.log(`Revoked existing key id=${row.id}`);
	}

	// Generate new key
	const id = generateId();
	const secret = generateSecret();
	const plaintext = `ots_ots_${secret}`;
	const keyHash = hashKey(plaintext);
	const keyPrefix = plaintext.slice(0, 12);

	await c.execute({
		sql: `INSERT INTO api_key (id, tenant_id, name, key_prefix, key_hash, scopes,
			created_by_user_id, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		args: [
			id,
			tenantId,
			KEY_NAME,
			keyPrefix,
			keyHash,
			JSON.stringify(SCOPES),
			userId,
			new Date().toISOString()
		]
	});

	console.log('\n=== NEW API KEY (plaintext shown ONCE) ===');
	console.log(`id:        ${id}`);
	console.log(`prefix:    ${keyPrefix}`);
	console.log(`scopes:    ${SCOPES.join(', ')}`);
	console.log(`plaintext: ${plaintext}`);
	console.log('==========================================\n');
	console.log('Use this key as X-API-Key header for all subsequent requests.');
	process.exit(0);
}

main().catch((err) => {
	console.error('ERROR:', err);
	process.exit(1);
});
