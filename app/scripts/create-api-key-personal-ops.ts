// One-shot script: create an API key for PersonalOPS to call OTS CRM.
// Talks directly to Turso via libsql (no SvelteKit), uses the same hashing
// logic as src/lib/server/api-keys/manager.ts.

import { createClient } from '@libsql/client';
import { sha256 } from '@oslojs/crypto/sha2';
import { encodeBase32LowerCase, encodeHexLowerCase } from '@oslojs/encoding';

const SQLITE_URI = process.env.SQLITE_URI;
const SQLITE_AUTH_TOKEN = process.env.SQLITE_AUTH_TOKEN;
if (!SQLITE_URI) {
	console.error('SQLITE_URI is required');
	process.exit(1);
}

const client = createClient({
	url: SQLITE_URI,
	authToken: SQLITE_AUTH_TOKEN
});

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

function generateSecret(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(24));
	return encodeHexLowerCase(bytes);
}

function hashSecret(secret: string): string {
	return encodeHexLowerCase(sha256(new TextEncoder().encode(secret)));
}

async function main() {
	const tenantSlug = process.argv[2] ?? 'ots';

	const tenantRes = await client.execute({
		sql: 'SELECT id, slug FROM tenant WHERE slug = ? LIMIT 1',
		args: [tenantSlug]
	});
	const tenantRow = tenantRes.rows[0];
	if (!tenantRow) {
		console.error(`Tenant "${tenantSlug}" not found`);
		process.exit(1);
	}
	const tenantId = tenantRow.id as string;
	const slug = tenantRow.slug as string;

	const userRes = await client.execute({
		sql: `SELECT u.id FROM user u
		      INNER JOIN tenant_user tu ON tu.user_id = u.id
		      WHERE tu.tenant_id = ? AND tu.role IN ('owner','admin')
		      ORDER BY tu.created_at ASC LIMIT 1`,
		args: [tenantId]
	});
	const userRow = userRes.rows[0];
	if (!userRow) {
		console.error('No admin/owner user found for tenant');
		process.exit(1);
	}
	const userId = userRow.id as string;

	const name = `PersonalOPS — ads automation (${new Date().toISOString().slice(0, 10)})`;
	const scopes = JSON.stringify([
		'campaigns:read',
		'campaigns:write',
		'clients:read',
		'integrations:read',
		'ads_monitor:read',
		'ads_monitor:write'
	]);

	const id = generateId();
	const secret = generateSecret();
	const slugPart = slug.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24);
	const plaintext = `ots_${slugPart}_${secret}`;
	const keyHash = hashSecret(plaintext);
	const keyPrefix = plaintext.slice(0, 12);

	await client.execute({
		sql: `INSERT INTO api_key
		      (id, tenant_id, name, key_prefix, key_hash, scopes, created_by_user_id, last_used_at, revoked_at, expires_at, created_at)
		      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)`,
		args: [id, tenantId, name, keyPrefix, keyHash, scopes, userId, Date.now()]
	});

	console.log('================================================================');
	console.log('  API KEY created — copy NOW (will not be shown again)');
	console.log('================================================================');
	console.log(`Tenant:  ${slug} (${tenantId})`);
	console.log(`Owner:   ${userId}`);
	console.log(`Name:    ${name}`);
	console.log(`Prefix:  ${keyPrefix}…`);
	console.log(`Scopes:  ${JSON.parse(scopes).join(', ')}`);
	console.log('');
	console.log('PLAINTEXT KEY:');
	console.log(plaintext);
	console.log('================================================================');
	console.log('Use it as header:  X-API-Key: <plaintext>');
	console.log('Or test now:');
	console.log(`  curl -H "X-API-Key: ${plaintext}" http://localhost:5173/api/external/ads-monitor/deviations`);
}

main()
	.then(() => process.exit(0))
	.catch((e) => {
		console.error(e);
		process.exit(1);
	});
