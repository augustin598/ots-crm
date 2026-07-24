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
	lines.push(
		'Răspunde DOAR cu un obiect JSON valid, fără text în plus, de forma: {"title": "...", "excerpt": "...", "body_markdown": "..."}. body_markdown folosește ## pentru subtitluri și poate include o secțiune de Întrebări frecvente.'
	);
	return lines.join('\n');
}

export interface Generated {
	title: string;
	excerpt: string;
	bodyMarkdown: string;
}

/** Parsează răspunsul Claude — JSON fenced / brut / fallback text. */
export function parseGeneration(text: string): Generated {
	const t = (text ?? '').trim();
	const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
	const candidate = fenced ? fenced[1].trim() : t;
	try {
		const start = candidate.indexOf('{');
		const end = candidate.lastIndexOf('}');
		if (start !== -1 && end > start) {
			const obj = JSON.parse(candidate.slice(start, end + 1)) as {
				title?: unknown;
				excerpt?: unknown;
				body_markdown?: unknown;
			};
			return {
				title: typeof obj.title === 'string' ? obj.title : '',
				excerpt: typeof obj.excerpt === 'string' ? obj.excerpt : '',
				bodyMarkdown: typeof obj.body_markdown === 'string' ? obj.body_markdown : ''
			};
		}
	} catch {
		/* fallthrough */
	}
	return { title: '', excerpt: '', bodyMarkdown: t };
}
