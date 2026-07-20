/**
 * Publish rewritten Heylux advertorials to the connected WordPress site as
 * SCHEDULED posts (status=future), 3/week (Mon/Wed/Fri) at random hours.
 *
 * Standalone: reuses the connector's HMAC helpers (hmac.ts/url.ts import only
 * `crypto`) and replicates the tenant secret decryption (aes-256-gcm, pbkdf2)
 * from smartbill/crypto.ts. Runs under plain `bun` from app/.
 *
 * Modes:
 *   bun scripts/content-publish.ts health        # verify connector auth (read-only)
 *   bun scripts/content-publish.ts dry-run        # print the schedule, create nothing
 *   bun scripts/content-publish.ts publish        # create the scheduled posts (LIVE)
 */
import { createClient } from '@libsql/client';
import { createDecipheriv, pbkdf2Sync } from 'crypto';
import { marked } from 'marked';
import fs from 'fs';
import path from 'path';
import { buildSignedHeaders } from '../src/lib/server/wordpress/hmac';
import { connectorUrl, connectorSigningPath } from '../src/lib/server/wordpress/url';

const MODE = process.argv[2] ?? 'health';
const SITE_ID = 'npm3eomh56zhzhd2euwkx77e'; // Heylux.ro
const REWRITTEN_DIR = path.resolve(import.meta.dir, '..', '..', 'content', 'heylux', 'rewritten');

// ── tenant secret decryption (mirror of smartbill/crypto.ts) ────────────────
function deriveKey(tenantId: string, secret: string): Buffer {
	const salt = pbkdf2Sync(secret, tenantId, 1000, 32, 'sha256');
	return pbkdf2Sync(secret, salt.toString('hex'), 100000, 32, 'sha256');
}
function decrypt(tenantId: string, enc: string): string {
	const secret = process.env.ENCRYPTION_SECRET;
	if (!secret) throw new Error('ENCRYPTION_SECRET not set');
	const key = deriveKey(tenantId, secret);
	const [ivHex, tagHex, ct] = enc.split(':');
	const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
	decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
	return decipher.update(ct, 'hex', 'utf8') + decipher.final('utf8');
}

// ── connector call ──────────────────────────────────────────────────────────
async function connectorRequest(
	siteUrl: string,
	secret: string,
	method: 'GET' | 'POST',
	apiPath: string,
	body?: unknown
) {
	const bodyString = body === undefined ? '' : JSON.stringify(body);
	const signingPath = connectorSigningPath(apiPath.split('?')[0]);
	const headers = buildSignedHeaders(secret, method, signingPath, bodyString);
	const url = connectorUrl(siteUrl, apiPath);
	const res = await fetch(url, {
		method,
		headers,
		body: method === 'GET' ? undefined : bodyString,
		signal: AbortSignal.timeout(20000),
		redirect: 'follow'
	});
	const text = await res.text();
	let json: any = null;
	try { json = JSON.parse(text); } catch { /* non-json */ }
	return { status: res.status, ok: res.ok, json, text: text.slice(0, 300) };
}

// ── frontmatter parse ────────────────────────────────────────────────────────
function parseMd(raw: string) {
	const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	if (!m) return { fm: {} as Record<string, string>, body: raw };
	const fm: Record<string, string> = {};
	for (const line of m[1].split('\n')) {
		const kv = line.match(/^(\w+):\s*(.*)$/);
		if (kv) {
			let v = kv[2].trim();
			try { v = JSON.parse(v); } catch { /* keep raw */ }
			fm[kv[1]] = v as string;
		}
	}
	return { fm, body: m[2].trim() };
}

function slugify(s: string): string {
	return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

// Deterministic pseudo-random hour/minute per index (no Math.random — stable reruns)
function randomTime(seed: number): { h: number; m: number } {
	const h = 8 + ((seed * 7 + 3) % 12); // 08..19
	const m = (seed * 17 + 11) % 60;
	return { h, m };
}

// Mon/Wed/Fri slots from Wed 2026-07-22, N items
function scheduleSlots(n: number): Date[] {
	const start = new Date(Date.UTC(2026, 6, 22, 0, 0, 0));
	const days = [1, 3, 5];
	const out: Date[] = [];
	const d = new Date(start);
	while (out.length < n) {
		if (days.includes(d.getUTCDay())) out.push(new Date(d));
		d.setUTCDate(d.getUTCDate() + 1);
	}
	return out;
}

// ── main ─────────────────────────────────────────────────────────────────────
const db = createClient({ url: process.env.SQLITE_URI!, authToken: process.env.SQLITE_AUTH_TOKEN });
const [site] = (await db.execute({
	sql: 'SELECT id, name, site_url, secret_key, tenant_id, status FROM wordpress_site WHERE id = ?',
	args: [SITE_ID]
})).rows as any[];
if (!site) throw new Error(`WP site ${SITE_ID} not found`);
const secret = decrypt(site.tenant_id, site.secret_key);

if (MODE === 'health') {
	const r = await connectorRequest(site.site_url, secret, 'GET', '/health');
	console.log(`[health] ${site.name} (${site.site_url}) -> HTTP ${r.status}`);
	console.log('  auth', r.status === 200 ? 'OK ✓' : r.status === 401 || r.status === 403 ? 'REJECTED ✗' : `unexpected`);
	console.log('  body:', r.json ? JSON.stringify(r.json).slice(0, 200) : r.text);
	process.exit(0);
}

// Load rewritten files, ordered by publish priority (pilot order)
const files = fs.existsSync(REWRITTEN_DIR)
	? fs.readdirSync(REWRITTEN_DIR).filter((f) => f.endsWith('.md')).sort()
	: [];
const slots = scheduleSlots(files.length);
const RO = ['Dum', 'Lun', 'Mar', 'Mie', 'Joi', 'Vin', 'Sam'];

if (MODE === 'dry-run') {
	console.log(`Would schedule ${files.length} posts on ${site.name}:`);
	files.forEach((f, i) => {
		const { fm } = parseMd(fs.readFileSync(path.join(REWRITTEN_DIR, f), 'utf8'));
		const { h, m } = randomTime(i);
		const d = slots[i];
		console.log(`  ${RO[d.getUTCDay()]} ${d.toISOString().slice(0, 10)} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} — ${fm.rewrittenTitle}`);
	});
	process.exit(0);
}

if (MODE === 'publish') {
	let created = 0;
	for (let i = 0; i < files.length; i++) {
		const f = files[i];
		const { fm, body } = parseMd(fs.readFileSync(path.join(REWRITTEN_DIR, f), 'utf8'));
		const { h, m } = randomTime(i);
		const d = slots[i];
		const publishedAt = `${d.toISOString().slice(0, 10)}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
		const contentHtml = await marked.parse(body);
		const payload = {
			title: fm.rewrittenTitle,
			contentHtml,
			excerpt: fm.rewrittenExcerpt ?? '',
			slug: slugify(fm.rewrittenTitle ?? f),
			status: 'future',
			publishedAt
		};
		const r = await connectorRequest(site.site_url, secret, 'POST', '/posts', payload);
		if (r.ok && r.json?.id) {
			created++;
			console.log(`  ✓ ${publishedAt} #${r.json.id} — ${fm.rewrittenTitle}`);
			await db.execute({
				sql: `UPDATE content_article SET rewrite_status='ready', wp_post_id=?, scheduled_at=?, target_wp_site_id=?, updated_at=? WHERE id=?`,
				args: [r.json.id, publishedAt, SITE_ID, new Date().toISOString(), fm.id]
			});
		} else {
			console.log(`  ✗ FAILED ${fm.rewrittenTitle}: HTTP ${r.status} ${r.text}`);
		}
	}
	console.log(`Created ${created}/${files.length} scheduled posts.`);
	process.exit(0);
}

console.log(`Unknown mode: ${MODE}`);
