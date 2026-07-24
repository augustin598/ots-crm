/**
 * Logica PURĂ de prompt/parse pentru generarea de articole — fără importuri server
 * (ca să fie testabilă cu `bun test`; article-generator.ts, care apelează Claude, o consumă).
 */

export interface ContentProfileLike {
	tone: string | null;
	audience: string | null;
	language: string | null;
	keywords: string | null;
	topics: string | null;
	doList: string | null;
	dontList: string | null;
	guardrails: string | null;
	sampleUrls: string | null;
	extraNotes: string | null;
}

/**
 * Reguli anti-tipare-AI, condensate din skill-ul „humanizer” (bazat pe ghidul
 * Wikipedia „Signs of AI writing”) și adaptate pentru română. Se aplică la
 * FIECARE generare de articol, indiferent de profil. Exportat pentru teste.
 */
export const HUMANIZER_RULES = [
	'STIL UMAN: evită tiparele tipice de text generat de AI.',
	'- Fără limbaj promoțional gol: „esențial”, „crucial”, „revoluționar”, „de excepție”, „joacă un rol vital”, „într-o lume în care...”. Spune concret ce și cum, nu cât de important e.',
	'- Fără atribuiri vagi („experții spun”, „studiile arată”, „mulți consideră”): ori numești sursa din materialul primit, ori tai afirmația.',
	'- Fără paralelisme negative de tip „nu este doar X, ci Y” și fără false intervale („de la X la Y” când X și Y nu sunt capetele reale ale unui interval).',
	'- Evită grupări de câte trei („rapid, simplu și eficient”): două sau patru elemente sunt la fel de bune; nu forța ritmul ternar.',
	'- Fără em dash (—) ca semn de punctuație în frază; în română folosește virgulă, două puncte sau paranteze (linia de dialog rămâne permisă).',
	'- Fără concluzii generice pozitive („În concluzie, ... rămâne o alegere excelentă”) și fără fraze de umplutură („este important de menționat că”, „merită subliniat faptul că”).',
	'- Fără signposting („În acest articol vom explora...”, „Haideți să vedem...”) și fără deschideri retorice de conversație („V-ați întrebat vreodată...?”).',
	'- Nu abuza de bold; fără emoji; titlurile în sentence case românesc (doar prima literă mare), nu Title Case.',
	'- Variază lungimea frazelor: alternează fraze scurte cu fraze lungi; nu scrie paragrafe cu structură identică și nu transforma totul în liste cu buline.',
	'- Fără ton servil sau exagerat de entuziast; scrie direct, concret, cu substantive și verbe simple.',
	'Dacă profilul brand sau direcția articolului cere explicit altceva, profilul și direcția au prioritate asupra acestor reguli.'
].join('\n');

/** System prompt din profilul brand (general) + direcția per articol. */
export function buildSystemPrompt(
	profile: ContentProfileLike | null,
	direction: string | null
): string {
	const lines: string[] = [
		'Ești copywriter SEO/GEO pentru un brand. Scrii în limba română, cu diacritice, ton profesional și onest.',
		'REGULĂ SUPREMĂ: folosește DOAR fapte/claim-uri prezente în materialul-sursă sau în brief. Nu inventa cifre, procente, garanții.'
	];
	if (profile) {
		if (profile.language) lines.push(`Limbă: ${profile.language}.`);
		if (profile.tone) lines.push(`Ton: ${profile.tone}.`);
		if (profile.audience) lines.push(`Public-țintă: ${profile.audience}.`);
		if (profile.keywords) lines.push(`Cuvinte-cheie SEO: ${profile.keywords}.`);
		if (profile.topics) lines.push(`Subiecte relevante: ${profile.topics}.`);
		if (profile.doList) lines.push(`De făcut: ${profile.doList}.`);
		if (profile.dontList) lines.push(`De evitat: ${profile.dontList}.`);
		if (profile.guardrails) lines.push(`Mesaje INTERZISE / guardrails: ${profile.guardrails}.`);
		if (profile.extraNotes) lines.push(`Context brand suplimentar:\n${profile.extraNotes}`);
	}
	if (direction && direction.trim())
		lines.push(`Direcție specifică pentru ACEST articol: ${direction.trim()}.`);
	lines.push(HUMANIZER_RULES);
	lines.push(
		'Răspunde DOAR cu un obiect JSON valid, fără text în plus, de forma: {"title": "...", "excerpt": "...", "body_markdown": "...", "focus_keyword": "...", "seo_title": "... (≤60 caractere)", "meta_description": "... (120-160 caractere)", "slug": "kebab-case-fara-diacritice"}. body_markdown folosește ## pentru subtitluri și poate include o secțiune de Întrebări frecvente. focus_keyword = expresia principală de căutare; seo_title include focus_keyword; meta_description include focus_keyword.'
	);
	return lines.join('\n');
}

/**
 * System prompt pt butonul „Humanizer”: pass secundar de EDITARE pe articolul
 * generat curent — elimină tiparele de text AI fără a pierde sau adăuga fapte.
 */
export function buildHumanizeSystemPrompt(profile: ContentProfileLike | null): string {
	const lines: string[] = [
		'Ești editor de text. Primești un articol și îl rescrii ÎN ACEEAȘI LIMBĂ în care e scris, ca să sune natural, scris de un om, eliminând tiparele tipice de text generat de AI.',
		'REGULĂ SUPREMĂ: păstrează TOATE faptele, cifrele, numele și afirmațiile din articol. Nu adăuga informații noi și nu elimina informații; schimbi doar formularea, ritmul și stilul.'
	];
	if (profile?.language) lines.push(`Limbă: ${profile.language}.`);
	if (profile?.tone) lines.push(`Ton: ${profile.tone}.`);
	if (profile?.audience) lines.push(`Public-țintă: ${profile.audience}.`);
	if (profile?.dontList) lines.push(`De evitat: ${profile.dontList}.`);
	if (profile?.guardrails) lines.push(`Mesaje INTERZISE / guardrails: ${profile.guardrails}.`);
	lines.push(HUMANIZER_RULES);
	lines.push(
		'Răspunde DOAR cu un obiect JSON valid, fără text în plus, de forma: {"title": "...", "excerpt": "...", "body_markdown": "..."}. body_markdown păstrează subtitlurile existente ale articolului (indiferent de formatul de intrare, redate ca ##; reformulate doar dacă sună a AI).'
	);
	return lines.join('\n');
}

/** System prompt pt generarea DOAR a metadatelor SEO (butonul „Generează AI"). */
export function buildSeoSystemPrompt(profile: ContentProfileLike | null): string {
	const lines: string[] = [
		'Ești specialist SEO/GEO. Pe baza articolului dat, generezi metadate SEO în limba română.'
	];
	if (profile?.keywords) lines.push(`Cuvinte-cheie de brand: ${profile.keywords}.`);
	if (profile?.audience) lines.push(`Public-țintă: ${profile.audience}.`);
	lines.push(
		'Fără limbaj promoțional gol („esențial”, „descoperă”, „revoluționar”) în seo_title și meta_description; formulează concret.'
	);
	lines.push(
		'Răspunde DOAR cu JSON: {"focus_keyword": "expresia principală de căutare", "seo_title": "titlu ≤60 caractere care conține focus_keyword", "meta_description": "120-160 caractere, conține focus_keyword", "slug": "kebab-case-fara-diacritice"}.'
	);
	return lines.join('\n');
}

export interface Generated {
	title: string;
	excerpt: string;
	bodyMarkdown: string;
	focusKeyword: string;
	seoTitle: string;
	metaDescription: string;
	slug: string;
}

/** Extrage primul obiect JSON dintr-un răspuns (fenced ```json / brut). null dacă nu găsește. */
function extractJson(text: string): Record<string, unknown> | null {
	const t = (text ?? '').trim();
	const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
	const candidate = fenced ? fenced[1].trim() : t;
	try {
		const start = candidate.indexOf('{');
		const end = candidate.lastIndexOf('}');
		if (start !== -1 && end > start) {
			return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
		}
	} catch {
		/* fallthrough */
	}
	return null;
}

/** slug kebab-case fără diacritice. */
export function slugify(s: string): string {
	return (s || '')
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '') // diacritice
		.replace(/[ăâ]/gi, 'a')
		.replace(/[îí]/gi, 'i')
		.replace(/ș/gi, 's')
		.replace(/ț/gi, 't')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80);
}

export interface SeoMeta {
	focusKeyword: string;
	seoTitle: string;
	metaDescription: string;
	slug: string;
}

/** Parsează metadatele SEO din răspunsul Claude ({focus_keyword, seo_title, meta_description, slug}). */
export function parseSeoMeta(text: string): SeoMeta {
	const obj = extractJson(text) ?? {};
	const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
	const seoTitle = str(obj.seo_title);
	const rawSlug = str(obj.slug);
	return {
		focusKeyword: str(obj.focus_keyword),
		seoTitle,
		metaDescription: str(obj.meta_description),
		slug: slugify(rawSlug || seoTitle)
	};
}

/** Parsează răspunsul Claude — JSON fenced / brut / fallback text (conținut + SEO). */
export function parseGeneration(text: string): Generated {
	const obj = extractJson(text);
	const str = (v: unknown) => (typeof v === 'string' ? v : '');
	if (!obj) {
		return {
			title: '',
			excerpt: '',
			bodyMarkdown: (text ?? '').trim(),
			focusKeyword: '',
			seoTitle: '',
			metaDescription: '',
			slug: ''
		};
	}
	const seoTitle = str(obj.seo_title).trim();
	const rawSlug = str(obj.slug).trim();
	return {
		title: str(obj.title),
		excerpt: str(obj.excerpt),
		bodyMarkdown: str(obj.body_markdown),
		focusKeyword: str(obj.focus_keyword).trim(),
		seoTitle,
		metaDescription: str(obj.meta_description).trim(),
		slug: slugify(rawSlug || seoTitle || str(obj.title))
	};
}
