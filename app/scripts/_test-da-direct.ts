#!/usr/bin/env bun
// Standalone DA endpoint probe — no SvelteKit imports.
import { createClient } from '@libsql/client';
import { createDecipheriv, pbkdf2Sync } from 'node:crypto';

function deriveKey(tenantId: string, secret: string): Buffer {
	const salt = pbkdf2Sync(secret, tenantId, 1000, 32, 'sha256');
	return pbkdf2Sync(secret, salt.toString('hex'), 100000, 32, 'sha256');
}
function decrypt(tenantId: string, encryptedData: string, secret: string): string {
	const key = deriveKey(tenantId, secret);
	const parts = encryptedData.split(':');
	const [ivHex, tagHex, encrypted] = parts;
	const iv = Buffer.from(ivHex, 'hex');
	const tag = Buffer.from(tagHex, 'hex');
	const decipher = createDecipheriv('aes-256-gcm', key, iv);
	decipher.setAuthTag(tag);
	let dec = decipher.update(encrypted, 'hex', 'utf8');
	dec += decipher.final('utf8');
	return dec;
}

const db = createClient({
	url: process.env.SQLITE_URI!,
	authToken: process.env.SQLITE_AUTH_TOKEN
});

const serverId = 'o6sp6yl3um3cv3ugsmjbr55n';
const r = await db.execute({
	sql: 'SELECT tenant_id, hostname, port, use_https, username_encrypted, password_encrypted FROM da_server WHERE id = ?',
	args: [serverId]
});
const row = r.rows[0] as {
	tenant_id: string;
	hostname: string;
	port: number;
	use_https: number;
	username_encrypted: string;
	password_encrypted: string;
};

const secret = process.env.ENCRYPTION_SECRET!;
const username = decrypt(row.tenant_id, row.username_encrypted, secret);
const password = decrypt(row.tenant_id, row.password_encrypted, secret);
const protocol = row.use_https === 0 ? 'http' : 'https';
const base = `${protocol}://${row.hostname}:${row.port}`;
const auth = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');

console.log(`Testing DA at ${base} as user '${username}'\n`);

async function probe(path: string, accept: string, label: string) {
	try {
		const res = await fetch(`${base}${path}`, {
			method: 'GET',
			headers: { Authorization: auth, Accept: accept, 'User-Agent': 'OTS-CRM/1.0' },
			signal: AbortSignal.timeout(10000)
		});
		const text = await res.text();
		console.log(`-- [${label}] GET ${path}  Accept: ${accept}`);
		console.log(`   status=${res.status} contentType=${res.headers.get('content-type')}`);
		console.log(`   body[0..400]: ${text.slice(0, 400).replace(/\n/g, '\\n')}`);
		console.log('');
	} catch (e) {
		console.log(`-- [${label}] ERROR: ${e instanceof Error ? e.message : String(e)}`);
	}
}

await probe('/CMD_API_PACKAGES_USER', 'application/json', 'json');
await probe('/CMD_API_PACKAGES_USER', '*/*', 'wildcard');
await probe('/CMD_API_PACKAGES_USER', 'text/html', 'html');
await probe('/CMD_API_PACKAGES_USER?json=yes', 'application/json', 'json-param');
await probe('/CMD_API_PACKAGES', '*/*', 'admin-pkgs');
await probe('/CMD_API_ADMIN_PACKAGES', '*/*', 'admin-packages');
await probe('/api/admin-usage', 'application/json', 'admin-usage');
await probe('/api/packages', 'application/json', 'modern-packages');

process.exit(0);
