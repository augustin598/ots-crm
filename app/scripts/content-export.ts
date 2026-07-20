/**
 * Export parsed content_article rows to markdown files for local rewriting.
 *
 * Standalone (uses @libsql/client directly — does NOT import $lib SvelteKit
 * virtual modules, so it runs under plain `bun`). Read-only on the DB.
 *
 * Usage:
 *   bun scripts/content-export.ts [brand] [status]
 *   bun scripts/content-export.ts heylux ok
 *
 * Writes: content/heylux/raw/<id>__<slug>.md  (frontmatter + original body text)
 */
import { createClient } from '@libsql/client';
import fs from 'fs';
import path from 'path';

const brand = process.argv[2] ?? 'heylux';
const status = process.argv[3] ?? 'ok';

const OUT_DIR = path.resolve(import.meta.dir, '..', '..', 'content', brand, 'raw');

function slugify(s: string): string {
	return (s || 'articol')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 50) || 'articol';
}

const url = process.env.SQLITE_URI;
const authToken = process.env.SQLITE_AUTH_TOKEN;
if (!url) throw new Error('SQLITE_URI not set');

const db = createClient({ url, authToken });

const rows = (
	await db.execute({
		sql: `SELECT id, brand, source_url, source_domain, title, published_at, word_count, body_text
		      FROM content_article WHERE brand = ? AND extract_status = ? ORDER BY word_count DESC`,
		args: [brand, status]
	})
).rows as Array<Record<string, any>>;

fs.mkdirSync(OUT_DIR, { recursive: true });

let written = 0;
for (const r of rows) {
	const slug = slugify(String(r.title ?? ''));
	const file = path.join(OUT_DIR, `${r.id}__${slug}.md`);
	const fm =
		'---\n' +
		`id: ${JSON.stringify(r.id)}\n` +
		`brand: ${JSON.stringify(r.brand)}\n` +
		`sourceUrl: ${JSON.stringify(r.source_url)}\n` +
		`sourceDomain: ${JSON.stringify(r.source_domain)}\n` +
		`originalTitle: ${JSON.stringify(r.title ?? '')}\n` +
		`publishedAt: ${JSON.stringify(r.published_at ?? '')}\n` +
		`wordCount: ${r.word_count ?? 0}\n` +
		'---\n\n';
	fs.writeFileSync(file, fm + String(r.body_text ?? '').trim() + '\n');
	written++;
}

console.log(`Exported ${written} '${brand}' (${status}) articles -> ${OUT_DIR}`);
