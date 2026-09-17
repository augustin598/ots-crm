/**
 * Why DA refuses `suspendUser` — header-by-header.
 *
 * On 2026-09-16 manual suspend started returning DA's login payload
 * (`HTTP 401 {"error":"Not logged in","success":"no"}`) in ~9ms, while the SAME
 * Basic-auth credential kept serving `/api/users/*` reads and legacy GETs (the
 * 03:00 sync ran clean). Suspend itself worked on 2026-08-13/14 with the same
 * code, so the refusal is DA-side and header/method-specific. This script sends
 * the same POST with one variable flipped at a time so the cause is visible
 * instead of guessed.
 *
 * NON-MUTATING: the POST body carries `location` + `select0` but NO action
 * button (`dosuspend`/`dounsuspend`/`delete`). DA resolves that to command
 * "none" and answers `error=1&text=Unkown Select Command&details=none` (typo is
 * DA's) without touching the account. So:
 *   "Not logged in"        → DA refused to authenticate this request
 *   "Unkown Select Command" → DA authenticated it; these headers work
 *
 *   bun scripts/_debug-da-suspend-auth.ts --tenant=ots --server=46.4.159.108 --user=solxro
 */
import { createClient } from '@libsql/client';
import { createDecipheriv, pbkdf2Sync } from 'node:crypto';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1];
const tenantSlug = arg('tenant') ?? 'ots';
const serverHint = arg('server');
const daUser = arg('user');
if (!serverHint) throw new Error('Missing --server');
if (!daUser) throw new Error('Missing --user (DA username to name in select0)');

const ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET!;
function deriveKey(tenantId: string): Buffer {
	const salt = pbkdf2Sync(ENCRYPTION_SECRET, tenantId, 1000, 32, 'sha256');
	return pbkdf2Sync(ENCRYPTION_SECRET, salt.toString('hex'), 100000, 32, 'sha256');
}
function decrypt(tenantId: string, ct: string): string {
	const [iv, tag, enc] = ct.split(':');
	const d = createDecipheriv('aes-256-gcm', deriveKey(tenantId), Buffer.from(iv, 'hex'));
	d.setAuthTag(Buffer.from(tag, 'hex'));
	return d.update(enc, 'hex', 'utf8') + d.final('utf8');
}

const sql = createClient({ url: process.env.SQLITE_URI!, authToken: process.env.SQLITE_AUTH_TOKEN });
const t = (await sql.execute({ sql: 'SELECT id FROM tenant WHERE slug=? LIMIT 1', args: [tenantSlug] }))
	.rows[0];
const tenantId = String(t!.id);
const s = (
	await sql.execute({
		sql: 'SELECT hostname, port, use_https, username_encrypted, password_encrypted FROM da_server WHERE tenant_id=? AND (hostname=? OR id=? OR name=?) LIMIT 1',
		args: [tenantId, serverHint, serverHint, serverHint]
	})
).rows[0]!;
const username = decrypt(tenantId, String(s.username_encrypted));
const password = decrypt(tenantId, String(s.password_encrypted));
const base = `${s.use_https ? 'https' : 'http'}://${s.hostname}:${s.port}`;
const auth = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

console.log(`Probing ${base} as DA user "${username}" (credential length ${password.length})\n`);

const SELECT_BODY = new URLSearchParams({
	location: 'CMD_SELECT_USERS',
	select0: daUser
}).toString();

type Probe = {
	label: string;
	method: 'GET' | 'POST';
	path: string;
	headers: Record<string, string>;
	body?: string;
};

const probes: Probe[] = [
	{
		label: 'modern GET /api/users/{u}/config  (control: reads work?)',
		method: 'GET',
		path: `/api/users/${encodeURIComponent(daUser)}/config`,
		headers: { Accept: 'application/json' }
	},
	{
		label: 'legacy GET /CMD_API_PACKAGES_USER  (legacy auth still ok?)',
		method: 'GET',
		path: '/CMD_API_PACKAGES_USER',
		headers: { Accept: 'application/json' }
	},
	{
		label: 'legacy POST  Accept: application/json           (production shape)',
		method: 'POST',
		path: '/CMD_API_SELECT_USERS',
		headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
		body: SELECT_BODY
	},
	{
		label: 'legacy POST  Accept: */*',
		method: 'POST',
		path: '/CMD_API_SELECT_USERS',
		headers: { Accept: '*/*', 'Content-Type': 'application/x-www-form-urlencoded' },
		body: SELECT_BODY
	},
	{
		label: 'legacy POST  Accept: */* + Referer/Origin      (DA referer check?)',
		method: 'POST',
		path: '/CMD_API_SELECT_USERS',
		headers: {
			Accept: '*/*',
			'Content-Type': 'application/x-www-form-urlencoded',
			Referer: `${base}/evo/`,
			Origin: base
		},
		body: SELECT_BODY
	},
	{
		label: 'legacy POST  json + Referer/Origin',
		method: 'POST',
		path: '/CMD_API_SELECT_USERS',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/x-www-form-urlencoded',
			Referer: `${base}/evo/`,
			Origin: base
		},
		body: SELECT_BODY
	},
	{
		label: 'legacy POST  json=yes query hint',
		method: 'POST',
		path: '/CMD_API_SELECT_USERS?json=yes',
		headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
		body: SELECT_BODY
	},
	{
		label: 'GET /api/login-keys/keys  (is the credential a scoped login key?)',
		method: 'GET',
		path: '/api/login-keys/keys',
		headers: { Accept: 'application/json' }
	}
];

for (const p of probes) {
	const t0 = Date.now();
	try {
		const res = await fetch(`${base}${p.path}`, {
			method: p.method,
			headers: { Authorization: auth, ...p.headers },
			body: p.body,
			signal: AbortSignal.timeout(15_000)
		});
		const text = await res.text();
		console.log(`--- ${p.label}`);
		console.log(`    ${p.method} ${p.path} → ${res.status} (${Date.now() - t0}ms) ${res.headers.get('content-type') ?? ''}`);
		console.log(`    ${text.replace(/\s+/g, ' ').slice(0, 300)}\n`);
	} catch (e) {
		console.log(`--- ${p.label}\n    ERROR: ${e instanceof Error ? e.message : String(e)}\n`);
	}
}
