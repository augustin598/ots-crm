/**
 * Probes multiple DA endpoints to discover what's available on THIS server.
 * Use to map our wrapper assumptions to reality after seeing _debug-da-try-create
 * return HTML / wrong-shape responses.
 *
 *   bun scripts/_debug-da-explore.ts --tenant=ots --server=46.4.159.108
 */
import { createClient } from '@libsql/client';
import { createDecipheriv, pbkdf2Sync } from 'node:crypto';

const tenantSlug = process.argv.find((a) => a.startsWith('--tenant='))?.split('=')[1] ?? 'ots';
const serverHint = process.argv.find((a) => a.startsWith('--server='))?.split('=')[1];
if (!serverHint) throw new Error('Missing --server');

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
const t = (await sql.execute({ sql: 'SELECT id FROM tenant WHERE slug=? LIMIT 1', args: [tenantSlug] })).rows[0];
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

console.log(`Probing ${base} as ${username}\n`);

const ENDPOINTS = [
	// IP discovery candidates
	'/CMD_API_SHOW_USER_IPS',
	'/CMD_API_SHOW_RESELLER_IPS',
	'/CMD_API_ADDITIONAL_IPS',
	'/CMD_API_IP_MANAGER',
	'/CMD_API_IP_MANAGEMENT',
	'/CMD_API_SHOW_IPS',
	'/api/admin-ips',
	'/api/ip-management/ips',
	'/api/show-reseller-ips',
	// User listings
	'/CMD_API_SHOW_USERS',
	'/CMD_API_SHOW_ALL_USERS',
	'/api/users',
	'/api/search/users?search=admin', // small filter
	'/api/search/users?domain=navitech.ro',
	// Domain listing
	'/CMD_API_ADDITIONAL_DOMAINS?user=admin',
	'/CMD_API_SHOW_DOMAINS',
	// Info
	'/api/version',
	'/api/info'
];

interface Result {
	endpoint: string;
	status: number;
	contentType: string;
	bodySnippet: string;
	looksLikeHtml: boolean;
	looksLikeJson: boolean;
	looksLikeLegacy: boolean;
}

async function probe(endpoint: string): Promise<Result> {
	try {
		const r = await fetch(`${base}${endpoint}`, {
			method: 'GET',
			headers: { Authorization: auth, Accept: 'application/json' },
			signal: AbortSignal.timeout(10_000),
			// @ts-expect-error bun tls
			tls: { rejectUnauthorized: false }
		});
		const body = await r.text();
		const ct = r.headers.get('content-type') ?? '';
		const trimmed = body.trim();
		return {
			endpoint,
			status: r.status,
			contentType: ct,
			bodySnippet: trimmed.slice(0, 200).replace(/\s+/g, ' '),
			looksLikeHtml: trimmed.startsWith('<!') || trimmed.startsWith('<html'),
			looksLikeJson: trimmed.startsWith('{') || trimmed.startsWith('['),
			looksLikeLegacy: /^[a-zA-Z_\[\]]+=/.test(trimmed)
		};
	} catch (e) {
		return {
			endpoint,
			status: 0,
			contentType: '',
			bodySnippet: e instanceof Error ? e.message : String(e),
			looksLikeHtml: false,
			looksLikeJson: false,
			looksLikeLegacy: false
		};
	}
}

const results = await Promise.all(ENDPOINTS.map(probe));

const formatType = (r: Result) =>
	r.looksLikeJson ? 'JSON' : r.looksLikeLegacy ? 'LEGACY' : r.looksLikeHtml ? 'HTML' : '???';

for (const r of results) {
	const tag = formatType(r);
	console.log(`[${tag.padEnd(6)}] ${String(r.status).padStart(3)}  ${r.endpoint}`);
	if (tag !== 'HTML' && r.bodySnippet.length > 0) {
		console.log(`         body: ${r.bodySnippet}`);
	}
}

process.exit(0);
