/**
 * Aplică în DB un fișier de rezultate VALIDAT. Usage: bun apply.ts <results.json>
 * Actualizează doar articolele existente ale website-ului Heylux (safety scoping).
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

const items = JSON.parse(readFileSync(process.argv[2], 'utf8'));
let n = 0;
for (const a of items) {
	const cat = CATS[a.categoryId];
	if (!cat) throw new Error(`categoryId invalid la ${a.id}`);
	const res = await db.execute({
		sql: `UPDATE content_article SET
		        generated_title = ?, generated_html = ?, generated_excerpt = ?,
		        focus_keyword = ?, seo_title = ?, meta_description = ?, slug = ?,
		        wp_categories = ?, updated_at = ?
		      WHERE id = ? AND website_id = ? AND publish_status = 'none'`,
		args: [
			a.title,
			a.bodyHtml,
			a.excerpt,
			a.focusKeyword,
			a.seoTitle,
			a.metaDescription,
			a.slug,
			JSON.stringify([cat]),
			new Date().toISOString(),
			a.id,
			WID
		]
	});
	if (res.rowsAffected !== 1) throw new Error(`UPDATE a atins ${res.rowsAffected} rânduri la ${a.id} — STOP`);
	n++;
}
console.log(`Aplicat: ${n} articole.`);
