/**
 * Scoruri SEO/AEO/GEO persistabile per articol — punte între `analyzeSeo()` (sursa
 * unică a verificărilor) și coloanele `seo_score`/`aeo_score`/`geo_score` din
 * `content_article`. Pure, fără dependențe de server, testabile cu `bun run test`.
 */
import { analyzeSeo } from './seo-analysis';

export interface ArticleScoreInput {
	generatedHtml: string | null;
	generatedTitle: string | null;
	seoTitle: string | null;
	metaDescription: string | null;
	focusKeyword: string | null;
	slug: string | null;
	featuredImageUrl: string | null;
}

export interface ArticleScores {
	seoScore: number | null;
	aeoScore: number | null;
	geoScore: number | null;
}

/** null pe toate axele când articolul nu are conținut generat analizabil. */
export function computeArticleScores(a: ArticleScoreInput): ArticleScores {
	if (!a.generatedHtml) return { seoScore: null, aeoScore: null, geoScore: null };
	const r = analyzeSeo({
		html: a.generatedHtml,
		title: a.seoTitle || a.generatedTitle || '',
		metaDescription: a.metaDescription || '',
		focusKeyword: a.focusKeyword || '',
		slug: a.slug || '',
		featuredImageUrl: a.featuredImageUrl
	});
	return { seoScore: r.seo.score, aeoScore: r.aeo.score, geoScore: r.geo.score };
}

/** Scor general: 50% SEO + 25% AEO + 25% GEO — aceeași formulă ca `analyzeSeo().overall`. */
export function seoOverall(seo: number, aeo: number, geo: number): number {
	return Math.round(seo * 0.5 + aeo * 0.25 + geo * 0.25);
}
