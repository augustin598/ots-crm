/**
 * One-off DA pre-flight probe. Mirrors the
 * /[tenant]/api/_debug-directadmin-health?action=try-create endpoint logic but
 * runs locally without the SvelteKit auth layer — useful when you want to
 * diagnose a failing provision before the endpoint is deployed.
 *
 * Usage:
 *   cd app
 *   bun scripts/_debug-da-try-create.ts \
 *     --tenant=ots \
 *     --server=46.4.159.108 \
 *     --username=navitechsyou6f \
 *     --domain=navitech.ro \
 *     --package=Wordpress_Gold
 *
 * Output:
 *   list-ips     → all IPs DA exposes (shared/owned/admin) with status
 *   check-user   → username exists?
 *   check-domain → domain exists? (shallow + deep)
 *   list-pkgs    → packages on DA + whether requested package is found
 *   would-create → final go/no-go + the exact payload that would be POSTed
 */
import { createClient } from '@libsql/client';
import { createDecipheriv, pbkdf2Sync } from 'node:crypto';

function arg(name: string, fallback?: string): string {
	const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
	const value = hit?.split('=', 2)[1];
	if (!value && fallback === undefined) {
		throw new Error(`Missing --${name}`);
	}
	return value ?? fallback!;
}

const TENANT_SLUG = arg('tenant', 'ots');
const SERVER_HINT = arg('server'); // hostname OR id
const USERNAME = arg('username').toLowerCase();
const DOMAIN = arg('domain').toLowerCase();
const PACKAGE = arg('package');

// Replica deriveKey + decrypt din src/lib/server/plugins/smartbill/crypto.ts —
// scripturile bun nu pot rezolva `$env/dynamic/private`, deci replicăm aici.
const ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET;
if (!ENCRYPTION_SECRET) throw new Error('ENCRYPTION_SECRET env var not set (load .env first)');

function deriveKey(tenantId: string): Buffer {
	const salt = pbkdf2Sync(ENCRYPTION_SECRET!, tenantId, 1000, 32, 'sha256');
	return pbkdf2Sync(ENCRYPTION_SECRET!, salt.toString('hex'), 100000, 32, 'sha256');
}

function decrypt(tenantId: string, ciphertext: string): string {
	const [ivHex, tagHex, encHex] = ciphertext.split(':');
	if (!ivHex || !tagHex || !encHex) throw new Error('ciphertext format invalid');
	const key = deriveKey(tenantId);
	const iv = Buffer.from(ivHex, 'hex');
	const tag = Buffer.from(tagHex, 'hex');
	const decipher = createDecipheriv('aes-256-gcm', key, iv);
	decipher.setAuthTag(tag);
	let out = decipher.update(encHex, 'hex', 'utf8');
	out += decipher.final('utf8');
	return out;
}

// ---------- Load tenant + DA server from Turso ----------
const tursoUrl = process.env.SQLITE_URI;
const tursoAuthToken = process.env.SQLITE_AUTH_TOKEN;
if (!tursoUrl) throw new Error('SQLITE_URI env var not set');
const sql = createClient({ url: tursoUrl, authToken: tursoAuthToken });

const tenantRow = await sql.execute({
	sql: 'SELECT id, slug FROM tenant WHERE slug = ? LIMIT 1',
	args: [TENANT_SLUG]
});
if (tenantRow.rows.length === 0) throw new Error(`Tenant ${TENANT_SLUG} not found`);
const tenantId = String(tenantRow.rows[0].id);

const serverRow = await sql.execute({
	sql: `SELECT id, name, hostname, port, use_https, username_encrypted, password_encrypted
	      FROM da_server
	      WHERE tenant_id = ? AND (id = ? OR hostname = ? OR name = ?)
	      LIMIT 1`,
	args: [tenantId, SERVER_HINT, SERVER_HINT, SERVER_HINT]
});
if (serverRow.rows.length === 0) throw new Error(`Server ${SERVER_HINT} not found`);
const server = serverRow.rows[0] as Record<string, unknown>;

const daUsername = decrypt(tenantId, String(server.username_encrypted));
const daPassword = decrypt(tenantId, String(server.password_encrypted));
const protocol = server.use_https ? 'https' : 'http';
const baseUrl = `${protocol}://${server.hostname}:${server.port}`;
const auth = 'Basic ' + Buffer.from(`${daUsername}:${daPassword}`).toString('base64');

console.log('═'.repeat(72));
console.log(`Tenant: ${TENANT_SLUG} (${tenantId})`);
console.log(`Server: ${server.name} @ ${baseUrl}`);
console.log(`DA admin: ${daUsername}`);
console.log(`Probe:    username=${USERNAME}  domain=${DOMAIN}  package=${PACKAGE}`);
console.log('═'.repeat(72));

// Allow self-signed DA certs (most installs)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function daGet(path: string): Promise<{ status: number; body: string }> {
	const r = await fetch(`${baseUrl}${path}`, {
		method: 'GET',
		headers: { Authorization: auth, Accept: 'application/json' },
		signal: AbortSignal.timeout(15_000),
		// @ts-expect-error Bun extends RequestInit
		tls: { rejectUnauthorized: false }
	});
	return { status: r.status, body: await r.text() };
}

function parseLegacy(text: string): Record<string, string | string[]> {
	const result: Record<string, string | string[]> = {};
	const params = new URLSearchParams(text);
	for (const key of new Set(params.keys())) {
		const values = params.getAll(key);
		const base = key.endsWith('[]') ? key.slice(0, -2) : key;
		if (values.length > 1 || key.endsWith('[]')) result[base] = values;
		else result[base] = values[0];
	}
	return result;
}

// ---------- 1. List IPs (SHOW_RESELLER_IPS — proven endpoint) ----------
console.log('\n┌─ 1. IP DISCOVERY ─────────────────────────────────────────────────────');
{
	const r = await daGet('/CMD_API_SHOW_RESELLER_IPS');
	console.log(`  CMD_API_SHOW_RESELLER_IPS  status=${r.status}`);
	console.log(`    raw body: ${r.body.slice(0, 200)}`);
	const parsed = parseLegacy(r.body);
	const list = parsed.list;
	const ips = Array.isArray(list) ? list : typeof list === 'string' ? [list] : [];
	console.log(`    IPs available: ${ips.join(', ')}`);
	console.log(`    Would pick: ${ips[0] ?? '(none)'}`);
}

// ---------- 2. Check username (SHOW_USERS — proven endpoint) ----------
console.log('\n┌─ 2. USERNAME CHECK ───────────────────────────────────────────────────');
{
	const r = await daGet('/CMD_API_SHOW_USERS');
	const parsed = parseLegacy(r.body);
	const list = parsed.list;
	const usernames = Array.isArray(list)
		? list
		: typeof list === 'string'
		? list.split(',')
		: [];
	const taken = usernames.some((u) => u.toLowerCase() === USERNAME);
	console.log(`  GET /CMD_API_SHOW_USERS  status=${r.status}  (${usernames.length} users)`);
	console.log(`    "${USERNAME}": ${taken ? '❌ TAKEN' : '✓ available'}`);
}

// ---------- 3. Check domain (enumerate users + SHOW_USER_DOMAINS) ----------
console.log('\n┌─ 3. DOMAIN CHECK ─────────────────────────────────────────────────────');
{
	const r = await daGet('/CMD_API_SHOW_USERS');
	const parsed = parseLegacy(r.body);
	const list = parsed.list;
	const usernames = Array.isArray(list)
		? list
		: typeof list === 'string'
		? list.split(',')
		: [];
	const start = Date.now();
	const allDomains = new Set<string>();
	const userDomainMap: Record<string, string[]> = {};
	for (const u of usernames) {
		const ur = await daGet(`/CMD_API_SHOW_USER_DOMAINS?user=${encodeURIComponent(u)}`);
		if (ur.status !== 200) continue;
		const dparsed = parseLegacy(ur.body);
		const ds: string[] = [];
		for (const key of Object.keys(dparsed)) {
			const clean = key.trim().toLowerCase();
			if (clean === 'error' || clean === 'text' || clean === 'details') continue;
			if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(clean)) {
				allDomains.add(clean);
				ds.push(clean);
			}
		}
		if (ds.length) userDomainMap[u] = ds;
	}
	const elapsedMs = Date.now() - start;
	console.log(`  Enumerated ${usernames.length} users in ${elapsedMs}ms → ${allDomains.size} domains`);
	if (allDomains.has(DOMAIN)) {
		const owner = Object.entries(userDomainMap).find(([_, ds]) => ds.includes(DOMAIN));
		console.log(`    "${DOMAIN}": ❌ TAKEN by user "${owner?.[0]}"`);
	} else {
		console.log(`    "${DOMAIN}": ✓ available`);
	}
}

// ---------- 4. List packages ----------
console.log('\n┌─ 4. PACKAGE CHECK ────────────────────────────────────────────────────');
{
	const r = await daGet('/CMD_API_PACKAGES_USER');
	console.log(`  GET /CMD_API_PACKAGES_USER  status=${r.status}`);
	const parsed = parseLegacy(r.body);
	const list = parsed.list ?? parsed['list[]'];
	const pkgs = Array.isArray(list) ? list : typeof list === 'string' ? list.split(',') : [];
	console.log(`    packages on DA: ${pkgs.join(', ')}`);
	const has = pkgs.some((p) => p.toLowerCase() === PACKAGE.toLowerCase());
	console.log(`    requested "${PACKAGE}": ${has ? '✓ exists' : '❌ MISSING'}`);
}

console.log('\n═'.repeat(72));
console.log('DONE.');
process.exit(0);
