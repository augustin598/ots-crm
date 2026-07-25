/**
 * Publish rewritten Heylux advertorials to the connected WordPress site as
 * SCHEDULED posts (status=future), 3/week (Mon/Wed/Fri) at random hours.
 *
 * Standalone: reuses the connector's HMAC helpers (hmac.ts/url.ts import only
 * `crypto`) and replicates the tenant secret decryption (aes-256-gcm, pbkdf2)
 * from smartbill/crypto.ts. Runs under plain `bun` from app/.
 *
 * Modes:
 *   bun scripts/content-publish.ts health          # verify connector auth (read-only)
 *   bun scripts/content-publish.ts dry-run          # print the schedule, create nothing
 *   bun scripts/content-publish.ts publish          # create the scheduled posts (LIVE)
 *   bun scripts/content-publish.ts images-dry-run   # audit which scheduled posts lack a featured image
 *   bun scripts/content-publish.ts images           # attach og:image as featured on the scheduled posts (LIVE)
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
	method: 'GET' | 'POST' | 'PUT',
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
	try {
		json = JSON.parse(text);
	} catch {
		/* non-json */
	}
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
			try {
				v = JSON.parse(v);
			} catch {
				/* keep raw */
			}
			fm[kv[1]] = v as string;
		}
	}
	return { fm, body: m[2].trim() };
}

function slugify(s: string): string {
	return s
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 60);
}

// Deterministic pseudo-random hour/minute per index (no Math.random — stable reruns)
function randomTime(seed: number): { h: number; m: number } {
	const h = 8 + ((seed * 7 + 3) % 12); // 08..19
	const m = (seed * 17 + 11) % 60;
	return { h, m };
}

// Mon/Wed/Fri slots, N items, starting at (or after) `start`.
function mwfSlotsFrom(start: Date, n: number, strictlyAfter = false): Date[] {
	const days = [1, 3, 5];
	const out: Date[] = [];
	const d = new Date(
		Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(), 0, 0, 0)
	);
	if (strictlyAfter) d.setUTCDate(d.getUTCDate() + 1);
	while (out.length < n) {
		if (days.includes(d.getUTCDay())) out.push(new Date(d));
		d.setUTCDate(d.getUTCDate() + 1);
	}
	return out;
}
// Original pilot schedule: Mon/Wed/Fri from Wed 2026-07-22.
function scheduleSlots(n: number): Date[] {
	return mwfSlotsFrom(new Date(Date.UTC(2026, 6, 22, 0, 0, 0)), n);
}

// ── image download (og:image → base64 for /media upload) ─────────────────────
// Connector only accepts these mimes (see ots-connector.php route_upload_media).
const MIME_EXT: Record<string, string> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/gif': 'gif',
	'image/webp': 'webp',
	'image/svg+xml': 'svg'
};
function normalizeMime(contentType: string | null, url: string): string | null {
	let m = (contentType ?? '').split(';')[0].trim().toLowerCase();
	if (m === 'image/jpg') m = 'image/jpeg';
	if (MIME_EXT[m]) return m;
	// CDNs often serve octet-stream — fall back to the URL extension.
	const ext = (
		url
			.split('?')[0]
			.split('#')[0]
			.match(/\.([a-z0-9]+)$/i)?.[1] ?? ''
	).toLowerCase();
	const byExt: Record<string, string> = {
		png: 'image/png',
		jpg: 'image/jpeg',
		jpeg: 'image/jpeg',
		gif: 'image/gif',
		webp: 'image/webp',
		svg: 'image/svg+xml'
	};
	return byExt[ext] ?? null;
}
async function downloadImage(
	url: string
): Promise<{ mimeType: string; dataBase64: string; filename: string }> {
	const res = await fetch(url, {
		headers: {
			// Some RO news hosts hotlink-protect against non-browser UAs.
			'User-Agent':
				'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
			Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
		},
		signal: AbortSignal.timeout(25000),
		redirect: 'follow'
	});
	if (!res.ok) throw new Error(`download HTTP ${res.status}`);
	const mimeType = normalizeMime(res.headers.get('content-type'), url);
	if (!mimeType) throw new Error(`unsupported content-type "${res.headers.get('content-type')}"`);
	const buf = Buffer.from(await res.arrayBuffer());
	if (buf.length === 0) throw new Error('empty body');
	if (buf.length > 25 * 1024 * 1024)
		throw new Error(`too large (${(buf.length / 1048576).toFixed(1)} MB > 25 MB)`);
	const ext = MIME_EXT[mimeType];
	let base = (url.split('?')[0].split('#')[0].split('/').pop() ?? '')
		.replace(/\.[a-z0-9]+$/i, '')
		.replace(/[^a-zA-Z0-9._-]/g, '-')
		.slice(0, 80);
	if (!base) base = 'featured';
	return { mimeType, dataBase64: buf.toString('base64'), filename: `${base}.${ext}` };
}

// ── main ─────────────────────────────────────────────────────────────────────
const db = createClient({ url: process.env.SQLITE_URI!, authToken: process.env.SQLITE_AUTH_TOKEN });
const [site] = (
	await db.execute({
		sql: 'SELECT id, name, site_url, secret_key, tenant_id, status FROM wordpress_site WHERE id = ?',
		args: [SITE_ID]
	})
).rows as any[];
if (!site) throw new Error(`WP site ${SITE_ID} not found`);
const secret = decrypt(site.tenant_id, site.secret_key);

if (MODE === 'health') {
	const r = await connectorRequest(site.site_url, secret, 'GET', '/health');
	console.log(`[health] ${site.name} (${site.site_url}) -> HTTP ${r.status}`);
	console.log(
		'  auth',
		r.status === 200 ? 'OK ✓' : r.status === 401 || r.status === 403 ? 'REJECTED ✗' : `unexpected`
	);
	console.log('  body:', r.json ? JSON.stringify(r.json).slice(0, 200) : r.text);
	process.exit(0);
}

// Load rewritten files, ordered by publish priority (pilot order)
const files = fs.existsSync(REWRITTEN_DIR)
	? fs
			.readdirSync(REWRITTEN_DIR)
			.filter((f) => f.endsWith('.md'))
			.sort()
	: [];
const slots = scheduleSlots(files.length);
const RO = ['Dum', 'Lun', 'Mar', 'Mie', 'Joi', 'Vin', 'Sam'];

if (MODE === 'dry-run') {
	console.log(`Would schedule ${files.length} posts on ${site.name}:`);
	files.forEach((f, i) => {
		const { fm } = parseMd(fs.readFileSync(path.join(REWRITTEN_DIR, f), 'utf8'));
		const { h, m } = randomTime(i);
		const d = slots[i];
		console.log(
			`  ${RO[d.getUTCDay()]} ${d.toISOString().slice(0, 10)} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} — ${fm.rewrittenTitle}`
		);
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

// ── update-live / publish-rest: reconcile rewritten/ with WP ──────────────────
//   update-live  → push current rewritten content onto posts already on WP
//                  (full PUT, preserving featured image + schedule).
//   publish-rest → schedule rewritten articles NOT yet on WP, on M/W/F slots
//                  continuing strictly AFTER the latest existing scheduled_at.
if (['update-live', 'update-live-dry-run', 'publish-rest', 'publish-rest-dry-run'].includes(MODE)) {
	const dbRows = (
		await db.execute({
			sql: `SELECT id, wp_post_id, scheduled_at FROM content_article WHERE brand='heylux'`
		})
	).rows as any[];
	const byId = new Map<string, any>(dbRows.map((r) => [String(r.id), r]));
	const loaded = files.map((f) => {
		const { fm, body } = parseMd(fs.readFileSync(path.join(REWRITTEN_DIR, f), 'utf8'));
		return { file: f, fm, body, row: byId.get(String(fm.id)) };
	});

	if (MODE.startsWith('update-live')) {
		const live = MODE === 'update-live';
		const targets = loaded.filter((x) => x.row?.wp_post_id);
		console.log(
			`${live ? 'UPDATE content' : 'DRY-RUN update'} on ${targets.length} live posts — ${site.name}\n`
		);
		let ok = 0,
			skip = 0,
			fail = 0;
		for (const t of targets) {
			const id = Number(t.row.wp_post_id);
			const scheduledAt = t.row.scheduled_at ? String(t.row.scheduled_at) : '';
			const label = `#${id}`;
			const g = await connectorRequest(
				site.site_url,
				secret,
				'GET',
				`/posts/${id}?_cb=${Date.now()}`
			);
			if (!g.ok || !g.json?.id) {
				console.log(`  ✗ ${label} GET failed HTTP ${g.status}`);
				fail++;
				continue;
			}
			const cur = g.json;
			if (cur.status !== 'future') {
				console.log(`  ⤼ ${label} skip — status=${cur.status} (not future)`);
				skip++;
				continue;
			}
			if (!scheduledAt) {
				console.log(`  ✗ ${label} no scheduled_at in DB`);
				fail++;
				continue;
			}
			if (!live) {
				console.log(
					`  • ${label} would update → "${t.fm.rewrittenTitle}"  [keep img #${cur.featuredMediaId ?? '—'}, ${scheduledAt}]`
				);
				continue;
			}
			const contentHtml = await marked.parse(t.body);
			const put = await connectorRequest(site.site_url, secret, 'PUT', `/posts/${id}`, {
				title: t.fm.rewrittenTitle,
				contentHtml,
				excerpt: t.fm.rewrittenExcerpt ?? '',
				slug: cur.slug, // preserve existing slug — no URL churn
				status: 'future',
				publishedAt: scheduledAt, // exact original string → identical post_date
				featuredMediaId: cur.featuredMediaId ?? null // preserve attached featured image
			});
			if (!put.ok) {
				console.log(`  ✗ ${label} PUT HTTP ${put.status} ${put.text}`);
				fail++;
				continue;
			}
			if (put.json?.status !== 'future')
				console.log(`  ⚠ ${label} status now ${put.json?.status} — CHECK SCHEDULE`);
			else console.log(`  ✓ ${label} updated — "${t.fm.rewrittenTitle}"`);
			ok++;
		}
		console.log(
			`\n${live ? 'Updated' : 'Would update'}: ${ok} ok · ${skip} skipped · ${fail} failed / ${targets.length}`
		);
		process.exit(0);
	}

	// publish-rest
	const live = MODE === 'publish-rest';
	const pending = loaded.filter((x) => x.row && !x.row.wp_post_id);
	const orphans = loaded.filter((x) => !x.row).length;
	// Start strictly after the latest existing scheduled_at (ISO strings sort chronologically).
	const scheduledStrings = dbRows
		.filter((r) => r.wp_post_id && r.scheduled_at)
		.map((r) => String(r.scheduled_at))
		.sort();
	const lastStr = scheduledStrings.at(-1) ?? '2026-07-22T00:00:00';
	const [Y, M, D] = lastStr.slice(0, 10).split('-').map(Number);
	const restSlots = mwfSlotsFrom(new Date(Date.UTC(Y, M - 1, D)), pending.length, true);
	console.log(
		`${live ? 'SCHEDULE' : 'DRY-RUN schedule'} ${pending.length} new posts, M/W/F after ${lastStr.slice(0, 10)}${orphans ? ` (${orphans} rewritten files have no DB row — skipped)` : ''}\n`
	);
	let created = 0,
		fail = 0;
	for (let i = 0; i < pending.length; i++) {
		const t = pending[i];
		const { h, m } = randomTime(i + 1000);
		const d = restSlots[i];
		const publishedAt = `${d.toISOString().slice(0, 10)}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
		if (!live) {
			console.log(`  • ${RO[d.getUTCDay()]} ${publishedAt} — ${t.fm.rewrittenTitle}`);
			continue;
		}
		const contentHtml = await marked.parse(t.body);
		const r = await connectorRequest(site.site_url, secret, 'POST', '/posts', {
			title: t.fm.rewrittenTitle,
			contentHtml,
			excerpt: t.fm.rewrittenExcerpt ?? '',
			slug: slugify(t.fm.rewrittenTitle ?? t.file),
			status: 'future',
			publishedAt
		});
		if (r.ok && r.json?.id) {
			created++;
			console.log(`  ✓ ${publishedAt} #${r.json.id} — ${t.fm.rewrittenTitle}`);
			await db.execute({
				sql: `UPDATE content_article SET rewrite_status='ready', wp_post_id=?, scheduled_at=?, target_wp_site_id=?, updated_at=? WHERE id=?`,
				args: [r.json.id, publishedAt, SITE_ID, new Date().toISOString(), t.fm.id]
			});
		} else {
			console.log(`  ✗ FAILED ${t.fm.rewrittenTitle}: HTTP ${r.status} ${r.text}`);
			fail++;
		}
	}
	console.log(
		`\n${live ? 'Created' : 'Would create'}: ${created}${fail ? ` · ${fail} failed` : ''} / ${pending.length}`
	);
	process.exit(0);
}

// ── plugins: list active WP plugins (debug — check for an SEO plugin) ─────────
if (MODE === 'plugins') {
	const r = await connectorRequest(site.site_url, secret, 'GET', '/plugins');
	console.log(`HTTP ${r.status}`);
	const items = (r.json?.items ?? r.json?.plugins ?? r.json) as any[];
	if (Array.isArray(items)) {
		for (const p of items) {
			const name = p.name ?? p.plugin ?? p.file ?? JSON.stringify(p).slice(0, 60);
			const active = p.active ?? p.status ?? p.is_active;
			console.log(`  ${active ? '●' : '○'} ${name}${p.version ? ' v' + p.version : ''}`);
		}
	} else {
		console.log(r.text);
	}
	process.exit(0);
}

// ── get <id>: dump the connector's view of a single post (debug) ──────────────
if (MODE === 'get') {
	const id = Number(process.argv[3]);
	const cb = process.argv[4] === 'cb' ? `?_cb=${Date.now()}` : '';
	const g = await connectorRequest(site.site_url, secret, 'GET', `/posts/${id}${cb}`);
	console.log(`HTTP ${g.status}${cb ? ' (cache-buster)' : ''}`);
	if (g.json) {
		const { contentHtml, ...rest } = g.json as any;
		console.log(JSON.stringify(rest, null, 2));
	} else {
		console.log(g.text);
	}
	process.exit(0);
}

// ── images: attach og:image (content_article.featured_image_url) as the ───────
// featured image on the already-scheduled posts (WP IDs from the publish run).
// PUT /posts/{id} is a FULL update (missing status → draft, missing title/body →
// blanked), so we round-trip the live post fields via GET and re-send the exact
// scheduled_at from the DB to keep post_date byte-identical.
if (MODE === 'images' || MODE === 'images-dry-run') {
	const live = MODE === 'images';
	const rows = (
		await db.execute({
			sql: `SELECT wp_post_id, featured_image_url, scheduled_at
		      FROM content_article
		      WHERE brand='heylux' AND wp_post_id IS NOT NULL
		      ORDER BY wp_post_id`
		})
	).rows as any[];
	console.log(
		`${live ? 'ATTACH featured images' : 'DRY-RUN (no writes)'} — ${rows.length} scheduled posts on ${site.name}\n`
	);

	let ok = 0,
		skipped = 0,
		failed = 0;
	for (const row of rows) {
		const id = Number(row.wp_post_id);
		const src = row.featured_image_url ? String(row.featured_image_url).trim() : '';
		const scheduledAt = row.scheduled_at ? String(row.scheduled_at) : '';
		const label = `#${id}`;

		// 1. Read the live post — we need its exact title/content and current thumbnail.
		//    Cache-buster query: heylux.ro (LiteSpeed) page-caches REST GETs keyed on
		//    the URL sans query, so a plain GET can serve a stale pre-write snapshot
		//    and make reruns re-attach duplicates. The connector signs the path
		//    without the query string, so this stays HMAC-valid.
		const g = await connectorRequest(
			site.site_url,
			secret,
			'GET',
			`/posts/${id}?_cb=${Date.now()}`
		);
		if (!g.ok || !g.json?.id) {
			console.log(`  ✗ ${label} GET failed (HTTP ${g.status})`);
			failed++;
			continue;
		}
		const cur = g.json;
		// Guard: never touch a post that is no longer scheduled (already live/edited).
		if (cur.status !== 'future') {
			console.log(`  ⤼ ${label} skip — status=${cur.status} (not future)`);
			skipped++;
			continue;
		}
		if (cur.featuredMediaId) {
			console.log(`  ⤼ ${label} skip — already has featured #${cur.featuredMediaId}`);
			skipped++;
			continue;
		}
		if (!src) {
			console.log(`  ✗ ${label} no source image (featured_image_url null)`);
			failed++;
			continue;
		}
		if (!scheduledAt) {
			console.log(`  ✗ ${label} no scheduled_at in DB (cannot preserve schedule)`);
			failed++;
			continue;
		}

		if (!live) {
			console.log(`  • ${label} would attach → ${src.slice(0, 78)}  [keep ${scheduledAt}]`);
			continue;
		}

		// 2. Download the remote image → base64.
		let img: { mimeType: string; dataBase64: string; filename: string };
		try {
			img = await downloadImage(src);
		} catch (e: any) {
			console.log(`  ✗ ${label} download: ${e.message} — ${src.slice(0, 64)}`);
			failed++;
			continue;
		}

		// 3. Upload to the WP media library.
		const up = await connectorRequest(site.site_url, secret, 'POST', '/media', {
			filename: img.filename,
			mimeType: img.mimeType,
			dataBase64: img.dataBase64
		});
		if (!up.ok || !up.json?.id) {
			console.log(`  ✗ ${label} /media upload HTTP ${up.status} ${up.text}`);
			failed++;
			continue;
		}
		const attachmentId = Number(up.json.id);

		// 4. Full-payload PUT: re-send live content + exact schedule + new featured id.
		const put = await connectorRequest(site.site_url, secret, 'PUT', `/posts/${id}`, {
			title: cur.title,
			contentHtml: cur.contentHtml,
			excerpt: cur.excerpt,
			slug: cur.slug,
			status: 'future',
			publishedAt: scheduledAt,
			featuredMediaId: attachmentId
		});
		if (!put.ok || Number(put.json?.featuredMediaId) !== attachmentId) {
			console.log(
				`  ✗ ${label} PUT HTTP ${put.status} featured=${put.json?.featuredMediaId} (expected ${attachmentId}) ${put.text}`
			);
			failed++;
			continue;
		}
		if (put.json?.status !== 'future') {
			console.log(
				`  ⚠ ${label} featured #${attachmentId} attached BUT status is now ${put.json?.status} — CHECK SCHEDULE`
			);
		} else {
			console.log(`  ✓ ${label} featured #${attachmentId} (future kept) — ${img.filename}`);
		}
		// Idempotent across reruns: the GET featuredMediaId check above skips
		// posts already carrying a thumbnail, so no local state to persist.
		ok++;
	}
	console.log(
		`\n${live ? 'Attached' : 'Would attach'}: ${ok} ok · ${skipped} skipped · ${failed} failed  (of ${rows.length})`
	);
	process.exit(0);
}

console.log(`Unknown mode: ${MODE}`);
