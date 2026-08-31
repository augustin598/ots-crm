/**
 * Backfill o singură dată: scrie `seo_score` / `aeo_score` / `geo_score` pe toate
 * articolele `content_article` cu conținut generat (migrările 0505–0507). După
 * backfill, scorurile se întrețin singure prin refreshArticleScores() din
 * content-articles.remote.ts + butonul „Recalculează scoruri" din hub-ul SEO.
 *
 * Idempotent: rescrie doar rândurile ale căror scoruri diferă de cele calculate.
 *
 * Usage:
 *   bun run scripts/backfill-content-scores.ts --dry-run
 *   bun run scripts/backfill-content-scores.ts --apply
 */

import 'dotenv/config';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from '../src/lib/server/db/schema.ts';
import { and, eq, isNotNull } from 'drizzle-orm';
import { computeArticleScores } from '../src/lib/content/seo-score.ts';

const DRY_RUN = process.argv.includes('--dry-run');
const APPLY = process.argv.includes('--apply');
if (!DRY_RUN && !APPLY) {
	console.error('Usage: bun run scripts/backfill-content-scores.ts [--dry-run|--apply]');
	process.exit(1);
}

if (!process.env.SQLITE_URI || !process.env.SQLITE_AUTH_TOKEN) {
	throw new Error('SQLITE_URI / SQLITE_AUTH_TOKEN not set');
}

const client = createClient({
	url: process.env.SQLITE_URI,
	authToken: process.env.SQLITE_AUTH_TOKEN
});
const db = drizzle(client, { schema });

async function main() {
	const rows = await db
		.select({
			id: schema.contentArticle.id,
			tenantId: schema.contentArticle.tenantId,
			generatedHtml: schema.contentArticle.generatedHtml,
			generatedTitle: schema.contentArticle.generatedTitle,
			seoTitle: schema.contentArticle.seoTitle,
			metaDescription: schema.contentArticle.metaDescription,
			focusKeyword: schema.contentArticle.focusKeyword,
			slug: schema.contentArticle.slug,
			featuredImageUrl: schema.contentArticle.featuredImageUrl,
			seoScore: schema.contentArticle.seoScore,
			aeoScore: schema.contentArticle.aeoScore,
			geoScore: schema.contentArticle.geoScore
		})
		.from(schema.contentArticle)
		.where(isNotNull(schema.contentArticle.generatedHtml));

	console.log(`[backfill] ${rows.length} articole cu conținut generat`);
	let updated = 0;
	let unchanged = 0;
	for (const a of rows) {
		const s = computeArticleScores(a);
		if (s.seoScore === a.seoScore && s.aeoScore === a.aeoScore && s.geoScore === a.geoScore) {
			unchanged++;
			continue;
		}
		if (APPLY) {
			await db
				.update(schema.contentArticle)
				.set(s)
				.where(
					and(
						eq(schema.contentArticle.id, a.id),
						eq(schema.contentArticle.tenantId, a.tenantId)
					)
				);
		}
		updated++;
	}
	console.log(
		`[backfill] ${DRY_RUN ? '(dry-run) ar actualiza' : 'actualizate'} ${updated} · neschimbate ${unchanged}`
	);
	client.close();
}

await main();
