#!/usr/bin/env bun
/**
 * Test which endpoint actually MODIFIES an existing DA package.
 * Try 3 variants on Wordpress_Standard (changing TasksMax from 150 to 999 as canary).
 * After each, GET the package and verify TasksMax to see which worked.
 */
import { createClient } from '@libsql/client';
import { createDecipheriv, pbkdf2Sync } from 'node:crypto';

function deriveKey(t: string, s: string) {
	const salt = pbkdf2Sync(s, t, 1000, 32, 'sha256');
	return pbkdf2Sync(s, salt.toString('hex'), 100000, 32, 'sha256');
}
function dec(t: string, d: string, s: string) {
	const k = deriveKey(t, s);
	const [iv, tag, ct] = d.split(':');
	const dp = createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'hex'));
	dp.setAuthTag(Buffer.from(tag, 'hex'));
	return dp.update(ct, 'hex', 'utf8') + dp.final('utf8');
}

const db = createClient({ url: process.env.SQLITE_URI!, authToken: process.env.SQLITE_AUTH_TOKEN });
const r = await db.execute({sql: 'SELECT tenant_id, username_encrypted, password_encrypted FROM da_server WHERE id = ?', args: ['o6sp6yl3um3cv3ugsmjbr55n']});
const row: any = r.rows[0];
const u = dec(row.tenant_id, row.username_encrypted, process.env.ENCRYPTION_SECRET!);
const p = dec(row.tenant_id, row.password_encrypted, process.env.ENCRYPTION_SECRET!);
const auth = 'Basic ' + Buffer.from(u + ':' + p).toString('base64');
const base = 'https://46.4.159.108:2222';

async function fetchTasksMax(): Promise<string | null> {
	const res = await fetch(`${base}/CMD_API_PACKAGES_USER?package=Wordpress_Standard`, {
		headers: { Authorization: auth, Accept: '*/*' },
		// @ts-ignore
		tls: { rejectUnauthorized: false }
	});
	return new URLSearchParams(await res.text()).get('TasksMax');
}

async function tryEndpoint(label: string, url: string, params: Record<string, string>) {
	console.log(`\n--- ${label} ---`);
	console.log(`URL: POST ${url}`);
	const body = new URLSearchParams(params).toString();
	const res = await fetch(`${base}${url}`, {
		method: 'POST',
		headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded', Accept: '*/*' },
		body,
		// @ts-ignore
		tls: { rejectUnauthorized: false }
	});
	const text = await res.text();
	console.log(`Response status: ${res.status}`);
	console.log(`Body (first 300): ${text.slice(0, 300)}`);
	await new Promise(r => setTimeout(r, 500));
	const tasks = await fetchTasksMax();
	console.log(`TasksMax after: ${tasks} (target: 999)  ${tasks === '999' ? '✓ WORKED' : '✗ unchanged'}`);
}

const TEST_PARAMS = {
	package: 'Wordpress_Standard',
	TasksMax: '999',  // canary value
	bandwidth: '100000',
	quota: '10240'
};

console.log(`Initial TasksMax: ${await fetchTasksMax()}`);

// Variant 1: action=modify
await tryEndpoint(
	'V1: /CMD_API_PACKAGES_USER?action=modify',
	'/CMD_API_PACKAGES_USER',
	{ ...TEST_PARAMS, action: 'modify' }
);

// Variant 2: action=create with confirmed=Confirm (override)
await tryEndpoint(
	'V2: /CMD_API_PACKAGES_USER?action=create&overwrite=yes',
	'/CMD_API_PACKAGES_USER',
	{ ...TEST_PARAMS, action: 'create', add: 'Submit', overwrite: 'yes' }
);

// Variant 3: alternative endpoint /CMD_API_MANAGE_USER_PACKAGES
await tryEndpoint(
	'V3: /CMD_API_MANAGE_USER_PACKAGES?action=modify',
	'/CMD_API_MANAGE_USER_PACKAGES',
	{ ...TEST_PARAMS, action: 'modify' }
);

// Variant 4: /CMD_API_MODIFY_USER_PACKAGE
await tryEndpoint(
	'V4: /CMD_API_MODIFY_USER_PACKAGE',
	'/CMD_API_MODIFY_USER_PACKAGE',
	{ ...TEST_PARAMS, add: 'Submit' }
);

process.exit(0);
