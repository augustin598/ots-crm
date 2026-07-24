/**
 * Analiză SEO / AEO / GEO per articol — stil RankMath, euristici pure (fără dependențe/server),
 * ca să fie folosită în UI (client) și testată cu `bun test`.
 * SEO = search engine; AEO = answer engine (Google AI Overviews, extractibilitate);
 * GEO = generative engine (ChatGPT/Claude/Perplexity, semnale factuale/structură).
 */

export interface SeoInput {
	html: string;
	title: string;
	metaDescription: string;
	focusKeyword: string;
	slug: string;
	featuredImageUrl: string | null;
}

export type CheckStatus = 'good' | 'warn' | 'bad';

export interface SeoCheck {
	id: string;
	label: string;
	status: CheckStatus;
	hint: string;
}

export interface SeoGroup {
	score: number; // 0-100
	checks: SeoCheck[];
}

export interface SeoAnalysis {
	overall: number;
	seo: SeoGroup;
	aeo: SeoGroup;
	geo: SeoGroup;
}

function stripHtml(html: string): string {
	return (html || '')
		.replace(/<script[\s\S]*?<\/script>/gi, ' ')
		.replace(/<style[\s\S]*?<\/style>/gi, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function headings(html: string): string[] {
	const out: string[] = [];
	const re = /<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>/gi;
	let m: RegExpExecArray | null;
	while ((m = re.exec(html || ''))) out.push(stripHtml(m[1]).toLowerCase());
	return out;
}

function wordCount(text: string): number {
	return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

function has(html: string, re: RegExp): boolean {
	return re.test(html || '');
}

/** kw „job videochat iași" → „job-videochat-iasi", forma în care apare într-un slug. */
function slugifyPhrase(s: string): string {
	return s
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[ăâ]/gi, 'a')
		.replace(/[îí]/gi, 'i')
		.replace(/ș/gi, 's')
		.replace(/ț/gi, 't')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

function scoreOf(checks: SeoCheck[]): number {
	if (!checks.length) return 0;
	const sum = checks.reduce((s, c) => s + (c.status === 'good' ? 1 : c.status === 'warn' ? 0.5 : 0), 0);
	return Math.round((sum / checks.length) * 100);
}

export function analyzeSeo(input: SeoInput): SeoAnalysis {
	const text = stripHtml(input.html);
	const lower = text.toLowerCase();
	const kw = (input.focusKeyword || '').trim().toLowerCase();
	const title = (input.title || '').trim();
	const meta = (input.metaDescription || '').trim();
	const slug = (input.slug || '').trim().toLowerCase();
	const words = wordCount(text);
	const hs = headings(input.html);
	const firstChunk = lower.slice(0, 600);
	const kwCount = kw ? (lower.match(new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length : 0;
	const density = words > 0 && kw ? (kwCount / words) * 100 : 0;

	// ===== SEO =====
	const seo: SeoCheck[] = [
		kw
			? { id: 'kw-set', label: 'Cuvânt-cheie focus setat', status: 'good', hint: `„${kw}"` }
			: { id: 'kw-set', label: 'Cuvânt-cheie focus setat', status: 'bad', hint: 'Adaugă un cuvânt-cheie focus.' },
		{
			id: 'kw-title',
			label: 'Cuvântul-cheie în titlul SEO',
			status: kw && title.toLowerCase().includes(kw) ? 'good' : 'bad',
			hint: 'Titlul SEO ar trebui să conțină cuvântul-cheie.'
		},
		{
			id: 'kw-meta',
			label: 'Cuvântul-cheie în meta description',
			status: kw && meta.toLowerCase().includes(kw) ? 'good' : 'warn',
			hint: 'Include cuvântul-cheie în meta description.'
		},
		{
			id: 'kw-intro',
			label: 'Cuvântul-cheie în primul paragraf',
			status: kw && firstChunk.includes(kw) ? 'good' : 'warn',
			hint: 'Menționează cuvântul-cheie la început.'
		},
		{
			id: 'kw-heading',
			label: 'Cuvântul-cheie într-un subtitlu',
			status: kw && hs.some((h) => h.includes(kw)) ? 'good' : 'warn',
			hint: 'Folosește cuvântul-cheie într-un H2/H3.'
		},
		{
			id: 'kw-slug',
			label: 'Cuvântul-cheie în slug (URL)',
			// slug-ul e fără diacritice — normalizăm și kw la aceeași formă înainte de comparație
			status: kw && slug.includes(slugifyPhrase(kw)) ? 'good' : 'warn',
			hint: 'URL-ul ar trebui să conțină cuvântul-cheie.'
		},
		{
			id: 'title-len',
			label: 'Lungime titlu SEO (≤ 60 caractere)',
			status: title.length === 0 ? 'bad' : title.length <= 60 ? 'good' : 'warn',
			hint: `${title.length} caractere.`
		},
		{
			id: 'meta-len',
			label: 'Lungime meta description (120–160)',
			status: meta.length === 0 ? 'bad' : meta.length >= 120 && meta.length <= 160 ? 'good' : 'warn',
			hint: `${meta.length} caractere.`
		},
		{
			id: 'content-len',
			label: 'Lungime conținut (≥ 600 cuvinte)',
			status: words >= 600 ? 'good' : words >= 300 ? 'warn' : 'bad',
			hint: `${words} cuvinte.`
		},
		{
			id: 'featured',
			label: 'Imagine featured setată',
			status: input.featuredImageUrl ? 'good' : 'bad',
			hint: 'Adaugă o imagine reprezentativă.'
		},
		{
			id: 'links',
			label: 'Conține linkuri',
			status: has(input.html, /<a\s[^>]*href/i) ? 'good' : 'warn',
			hint: 'Adaugă linkuri interne/externe relevante.'
		},
		{
			id: 'density',
			label: 'Densitate cuvânt-cheie (0.5–2.5%)',
			status: !kw ? 'warn' : density >= 0.5 && density <= 2.5 ? 'good' : density > 2.5 ? 'bad' : 'warn',
			hint: `${density.toFixed(1)}%.`
		}
	];

	// ===== AEO (answer engine) =====
	const aeo: SeoCheck[] = [
		{
			id: 'faq',
			label: 'Secțiune de întrebări / FAQ',
			status: hs.some((h) => h.includes('?') || h.includes('întreb')) ? 'good' : 'warn',
			hint: 'O secțiune de întrebări frecvente ajută extractibilitatea.'
		},
		{
			id: 'lists',
			label: 'Liste (extractibile de AI)',
			status: has(input.html, /<(ul|ol)[\s>]/i) ? 'good' : 'warn',
			hint: 'Listele sunt ușor de citat de motoarele AI.'
		},
		{
			id: 'answer-intro',
			label: 'Răspuns direct la început',
			status: kw && firstChunk.includes(kw) && wordCount(firstChunk) < 90 ? 'good' : 'warn',
			hint: 'Primul paragraf să răspundă direct și concis.'
		}
	];

	// ===== GEO (generative engine) =====
	const geo: SeoCheck[] = [
		{
			id: 'stats',
			label: 'Cifre / date factuale',
			status: /\d/.test(text) ? 'good' : 'warn',
			hint: 'Datele concrete cresc credibilitatea și citabilitatea.'
		},
		{
			id: 'structure',
			label: 'Structură cu subtitluri (≥ 2 H2/H3)',
			status: hs.length >= 2 ? 'good' : hs.length === 1 ? 'warn' : 'bad',
			hint: `${hs.length} subtitluri.`
		},
		{
			id: 'scannable',
			label: 'Text scanabil (paragrafe scurte)',
			status: words > 0 && words / Math.max(1, (input.html.match(/<p[\s>]/gi) || []).length) <= 120 ? 'good' : 'warn',
			hint: 'Paragrafe scurte, ușor de parcurs.'
		}
	];

	const seoScore = scoreOf(seo);
	const aeoScore = scoreOf(aeo);
	const geoScore = scoreOf(geo);
	return {
		seo: { score: seoScore, checks: seo },
		aeo: { score: aeoScore, checks: aeo },
		geo: { score: geoScore, checks: geo },
		overall: Math.round(seoScore * 0.5 + aeoScore * 0.25 + geoScore * 0.25)
	};
}
