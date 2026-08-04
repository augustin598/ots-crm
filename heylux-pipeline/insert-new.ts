/**
 * Inserează articole NOI (origin 'brief') din result-new-*.json — replică insert-ul din
 * generateArticleFromBrief (content-articles.remote.ts). Usage: bun insert-new.ts <results.json>
 * Rulează din app/ cu .env sourced. Refuză să insereze de două ori același slug.
 */
import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';

const db = createClient({ url: process.env.SQLITE_URI!, authToken: process.env.SQLITE_AUTH_TOKEN });
const WID = 'a9412aba640f436c8cdf69f8865199';
const CATS: Record<number, { id: number; name: string; slug: string }> = {
	15: { id: 15, name: 'De ce Heylux?', slug: 'de-ce-heylux' },
	14: { id: 14, name: 'Câștiguri financiare videochat', slug: 'castiguri-financiare-videochat' },
	19: { id: 19, name: 'Avantaje videochat', slug: 'avantaje-videochat' },
	18: { id: 18, name: 'Tips and tricks videochat', slug: 'tips-and-tricks-videochat' },
	12: { id: 12, name: 'Vacanțe videochat', slug: 'vacante-videochat' },
	10: { id: 10, name: 'Sfaturi despre videochat', slug: 'sfaturi-despre-videochat' }
};

/** encodeBase32LowerCase(@oslojs) echivalent: RFC 4648 lowercase, fără padding. */
function genId(): string {
	const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	let bits = 0, value = 0, out = '';
	for (const b of bytes) {
		value = (value << 8) | b;
		bits += 8;
		while (bits >= 5) {
			out += alphabet[(value >>> (bits - 5)) & 31];
			bits -= 5;
		}
	}
	return out;
}

const ws = await db.execute({ sql: `SELECT tenant_id, client_id FROM client_website WHERE id = ?`, args: [WID] });
const { tenant_id, client_id } = ws.rows[0] as unknown as { tenant_id: string; client_id: string | null };

const items = JSON.parse(readFileSync(process.argv[2], 'utf8'));
for (const a of items) {
	const cat = CATS[a.categoryId];
	if (!cat) throw new Error(`categoryId invalid la ${a.id}`);
	const dup = await db.execute({
		sql: `SELECT id FROM content_article WHERE website_id = ? AND slug = ?`,
		args: [WID, a.slug]
	});
	if (dup.rows.length) {
		console.log(`SKIP ${a.id} — slug „${a.slug}" există deja (articol ${dup.rows[0].id})`);
		continue;
	}
	const id = genId();
	const now = new Date().toISOString();
	await db.execute({
		sql: `INSERT INTO content_article (
		        id, tenant_id, website_id, client_id, brand, origin, source_url, source_domain,
		        brief, generated_title, generated_excerpt, generated_html,
		        seo_title, meta_description, focus_keyword, slug, wp_categories,
		        rewrite_status, extract_status, word_count, generated_at, created_at, updated_at
		      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		args: [
			id, tenant_id, WID, client_id, 'heylux', 'brief', `brief:${id}`, 'brief',
			a.brief ?? a.title, a.title, a.excerpt, a.bodyHtml,
			a.seoTitle, a.metaDescription, a.focusKeyword, a.slug, JSON.stringify([cat]),
			'ready', 'ok', 0, now, now, now
		]
	});
	console.log(`INSERAT ${id} — „${a.title}" [${cat.name}] slug=${a.slug}`);
}
