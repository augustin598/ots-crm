/** Exportă articolele Ready (nepublicate) ale Heylux în batch-uri JSON pentru agenții de scriere. */
import { createClient } from '@libsql/client';
import { mkdirSync, writeFileSync } from 'fs';

const db = createClient({ url: process.env.SQLITE_URI!, authToken: process.env.SQLITE_AUTH_TOKEN });
const WID = 'a9412aba640f436c8cdf69f8865199';
const OUT = new URL('./batches/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const rows = await db.execute({
	sql: `SELECT id, title, generated_title, generated_excerpt, generated_html, body_text, focus_keyword, seo_title, meta_description, slug, wp_categories
	      FROM content_article
	      WHERE website_id = ? AND rewrite_status = 'ready' AND publish_status = 'none'
	      ORDER BY created_at, id`,
	args: [WID]
});

const items = rows.rows.map((r) => ({
	id: r.id,
	title: (r.generated_title as string) || (r.title as string) || '',
	excerpt: (r.generated_excerpt as string) || '',
	html: (r.generated_html as string) || '',
	sourceText: ((r.body_text as string) || '').slice(0, 6000),
	existing: {
		focusKeyword: r.focus_keyword,
		seoTitle: r.seo_title,
		metaDescription: r.meta_description,
		slug: r.slug,
		wpCategories: r.wp_categories
	}
}));

const SIZE = 5;
let n = 0;
for (let i = 0; i < items.length; i += SIZE) {
	const batch = items.slice(i, i + SIZE);
	writeFileSync(`${OUT}batch-${String(n).padStart(2, '0')}.json`, JSON.stringify(batch, null, 1));
	n++;
}
console.log(`Exported ${items.length} articles in ${n} batches to ${OUT}`);
