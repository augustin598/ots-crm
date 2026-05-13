#!/usr/bin/env bun
// Manual one-shot pentru tenant `ots`. Replic logica migrateStripeFromEnv()
// fără SvelteKit env wrapper, ca să bypass-uim issues de loading.
import { createClient } from '@libsql/client';
import { createCipheriv, randomBytes, pbkdf2Sync } from 'node:crypto';
import { encodeBase32LowerCase } from '@oslojs/encoding';

const c = createClient({
	url: process.env.SQLITE_URI!,
	authToken: process.env.SQLITE_AUTH_TOKEN
});

function deriveKey(tenantId: string, secret: string): Buffer {
	const salt = pbkdf2Sync(secret, tenantId, 1000, 32, 'sha256');
	return pbkdf2Sync(secret, salt.toString('hex'), 100000, 32, 'sha256');
}

function encrypt(tenantId: string, data: string, secret: string): string {
	const key = deriveKey(tenantId, secret);
	const iv = randomBytes(16);
	const cipher = createCipheriv('aes-256-gcm', key, iv);
	let encrypted = cipher.update(data, 'utf8', 'hex');
	encrypted += cipher.final('hex');
	const tag = cipher.getAuthTag();
	return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
}

const tenantSlug = process.env.PUBLIC_HOSTING_TENANT_SLUG ?? 'ots';
const stripeSecret = process.env.STRIPE_SECRET_KEY ?? '';
const publishable = process.env.PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? '';
const encSecret = process.env.ENCRYPTION_SECRET ?? '';

if (!encSecret) {
	console.error('ENCRYPTION_SECRET lipsește');
	process.exit(1);
}
if (!stripeSecret.startsWith('sk_')) {
	console.error('STRIPE_SECRET_KEY invalid:', stripeSecret.slice(0, 12));
	process.exit(1);
}

const tenantRes = await c.execute({
	sql: 'SELECT id FROM tenant WHERE slug = ?',
	args: [tenantSlug]
});
if (tenantRes.rows.length === 0) {
	console.error(`Tenant '${tenantSlug}' not found`);
	process.exit(1);
}
const tenantId = (tenantRes.rows[0] as { id: string }).id;

const existing = await c.execute({
	sql: 'SELECT id FROM stripe_integration WHERE tenant_id = ?',
	args: [tenantId]
});
if (existing.rows.length > 0) {
	console.log(`Already migrated for tenant ${tenantSlug}`);
	process.exit(0);
}

const id = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
const secretEncrypted = encrypt(tenantId, stripeSecret, encSecret);
const webhookEncrypted =
	webhookSecret && !webhookSecret.includes('REPLACE_ME')
		? encrypt(tenantId, webhookSecret, encSecret)
		: null;

await c.execute({
	sql: `INSERT INTO stripe_integration
		(id, tenant_id, secret_key_encrypted, publishable_key, webhook_secret_encrypted, is_test_mode, is_active)
		VALUES (?, ?, ?, ?, ?, ?, 1)`,
	args: [id, tenantId, secretEncrypted, publishable, webhookEncrypted, stripeSecret.startsWith('sk_test_') ? 1 : 0]
});

console.log(`✓ Stripe migrated to DB pentru tenant ${tenantSlug} (${stripeSecret.startsWith('sk_test_') ? 'TEST' : 'LIVE'})`);
console.log(`  id=${id}, accountId=null (pending first "Test connection")`);
process.exit(0);
