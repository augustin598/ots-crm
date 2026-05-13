#!/usr/bin/env bun
// Generate a magic link for any client in tenant 'ots' that has an email.
// Prints the verify URL to paste in browser.
import { createClient } from '@libsql/client';
import { sha256 } from '@oslojs/crypto/sha2';
import { encodeBase64url, encodeBase32LowerCase, encodeHexLowerCase } from '@oslojs/encoding';

const client = createClient({
	url: process.env.SQLITE_URI!,
	authToken: process.env.SQLITE_AUTH_TOKEN
});

const tenantSlug = 'ots';

const tenantRes = await client.execute({
	sql: 'SELECT id, slug FROM tenant WHERE slug = ? LIMIT 1',
	args: [tenantSlug]
});
if (tenantRes.rows.length === 0) {
	console.error(`Tenant '${tenantSlug}' not found`);
	process.exit(1);
}
const tenant = tenantRes.rows[0] as { id: string; slug: string };

const clientRes = await client.execute({
	sql: "SELECT id, name, email FROM client WHERE tenant_id = ? AND email IS NOT NULL AND email != '' ORDER BY created_at DESC LIMIT 5",
	args: [tenant.id]
});
if (clientRes.rows.length === 0) {
	console.error(`No clients with email found in tenant '${tenantSlug}'`);
	process.exit(1);
}
console.log(`Found ${clientRes.rows.length} candidates in tenant '${tenantSlug}'. Using first one:\n`);
const c = clientRes.rows[0] as { id: string; name: string; email: string };
console.log(`  client.id    = ${c.id}`);
console.log(`  client.name  = ${c.name}`);
console.log(`  client.email = ${c.email}`);

const plain = encodeBase64url(crypto.getRandomValues(new Uint8Array(32)));
const hashed = encodeHexLowerCase(sha256(new TextEncoder().encode(plain)));
const id = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

await client.execute({
	sql: `INSERT INTO magic_link_token (id, token, email, client_id, matched_client_ids, tenant_id, expires_at, used)
	      VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
	args: [id, hashed, c.email.toLowerCase(), c.id, JSON.stringify([c.id]), tenant.id, expiresAt.toISOString()]
});

const baseUrl = process.env.PUBLIC_APP_URL || 'http://localhost:5173';
const url = `${baseUrl}/client/${tenantSlug}/verify?token=${encodeURIComponent(plain)}`;
console.log(`\nMagic link (valid 24h):\n  ${url}\n`);
console.log(`After verify it redirects to /client/${tenantSlug}/dashboard.`);
console.log(`Then to test hosting portal go to:`);
console.log(`  ${baseUrl}/client/${tenantSlug}/hosting`);
console.log(`  ${baseUrl}/client/${tenantSlug}/hosting/packages`);
process.exit(0);
