/**
 * Validator: rulează rubrica reală a aplicației (analyzeSeo) + guardrails Heylux pe
 * output-ul unui agent. Usage: bun validate.ts <results.json>
 * Exit 0 = toate trec; altfel listează problemele per articol.
 */
import { analyzeSeo } from '/Users/augustin598/Projects/CRM/app/src/lib/content/seo-analysis';
import { readFileSync } from 'fs';

interface Item {
	id: string;
	title: string;
	focusKeyword: string;
	seoTitle: string;
	metaDescription: string;
	slug: string;
	excerpt: string;
	categoryId: number;
	bodyHtml: string;
}

const CATS: Record<number, { id: number; name: string; slug: string }> = {
	15: { id: 15, name: 'De ce Heylux?', slug: 'de-ce-heylux' },
	14: { id: 14, name: 'Câștiguri financiare videochat', slug: 'castiguri-financiare-videochat' },
	19: { id: 19, name: 'Avantaje videochat', slug: 'avantaje-videochat' },
	18: { id: 18, name: 'Tips and tricks videochat', slug: 'tips-and-tricks-videochat' },
	12: { id: 12, name: 'Vacanțe videochat', slug: 'vacante-videochat' },
	10: { id: 10, name: 'Sfaturi despre videochat', slug: 'sfaturi-despre-videochat' }
};

const words = (html: string) =>
	html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).length;

const items: Item[] = JSON.parse(readFileSync(process.argv[2], 'utf8'));
let failures = 0;

for (const a of items) {
	const problems: string[] = [];
	const body = a.bodyHtml || '';
	const text = body.replace(/<[^>]+>/g, ' ');

	// Norme română (humanizer/romanian.md) — verificări mecanice pe TEXT (nu pe taguri)
	const allText = [a.title, a.seoTitle, a.metaDescription, a.excerpt, text].join(' | ');
	if (/[""]/.test(allText.replace(/\|/g, '')))
		problems.push('RO: ghilimele englezești "…" — folosește „…" (99 jos, 99 sus)');
	// „ca și cum/când" = locuțiuni valide; „ca și X să…" = și adverbial („și ele") — valid.
	// Condamnat e doar „ca și" + funcție/rol fără „să" (evitare de cacofonie).
	if (/\bca și (?!cum\b|când\b)(?![^.!?]{0,60}\bsă\b)/i.test(allText))
		problems.push('RO: „ca și" (DOOM îl condamnă) — folosește „drept/în calitate de"');
	if (/\b(am|are|avem|aveți|au|costă|durează|primești|câștigi)\s+decât\b/i.test(allText))
		problems.push('RO: „decât" afirmativ — corect e „doar/numai"');
	if (/\bvroia/i.test(allText)) problems.push('RO: „vroiam" nu există — voiam');
	if (/mi-ar place\b/i.test(allText)) problems.push('RO: „mi-ar place" — corect „mi-ar plăcea"');
	if (/\bcrează\b/i.test(allText)) problems.push('RO: „crează" — corect „creează"');
	if (/\binovativ/i.test(allText)) problems.push('RO calc: „inovativ" — folosește „inovator"');
	if (/\bfocusat/i.test(allText)) problems.push('RO calc: „focusat" — folosește „concentrat"');
	if (/\bimpacta|impacteaz/i.test(allText)) problems.push('RO calc: „a impacta" — folosește „a afecta"');
	if (/adres(a|ează|ăm)\s+(o\s+)?(problem|nevoi|provoc)/i.test(allText))
		problems.push('RO calc: „a adresa o problemă" — folosește „a rezolva/a aborda"');
	if (/\bperformez|\bperformeaz|să performe\b/i.test(allText)) problems.push('RO calc: „a performa" — reformulează');
	if (/\bseamless/i.test(allText)) problems.push('RO calc: „seamless"');
	if (/face diferența/i.test(allText)) problems.push('RO calc: „a face diferența" — reformulează concret');

	// Guardrails client
	if (/lucky\s*studio/i.test(body + a.seoTitle + a.metaDescription)) problems.push('GUARDRAIL: menționează Lucky Studio');
	if (/[—–]/.test(body + a.seoTitle + a.metaDescription + a.excerpt + (a.title ?? ''))) problems.push('GUARDRAIL: conține em/en dash');
	if (/<a\s/i.test(body)) problems.push('GUARDRAIL: conține linkuri');
	if (/07\d{2}[\s.]?\d{3}[\s.]?\d{3}|heylux\.ro/i.test(body)) problems.push('GUARDRAIL: telefon sau URL în text');
	if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}✨❤]/u.test(body + a.seoTitle)) problems.push('GUARDRAIL: emoji');
	if (/premium/i.test(body) && !/livejasmin[^.]{0,80}premium|premium[^.]{0,80}livejasmin/i.test(body.toLowerCase()))
		problems.push('ATENȚIE: „premium" fără LiveJasmin în aceeași frază (verifică manual)');
	if (/flirt4free/i.test(body)) problems.push('ATENȚIE: menționează Flirt4Free (verifică că nu e numit premium)');

	// Câmpuri
	if (!CATS[a.categoryId]) problems.push(`categoryId invalid: ${a.categoryId}`);
	if (a.metaDescription.length < 120 || a.metaDescription.length > 160)
		problems.push(`meta ${a.metaDescription.length} caractere (vreau 120–160)`);
	if (a.seoTitle.length > 60) problems.push(`seoTitle ${a.seoTitle.length} > 60`);
	const wc = words(body);
	if (wc < 600) problems.push(`doar ${wc} cuvinte (< 600)`);
	if (!/întrebări frecvente/i.test(body)) problems.push('lipsește secțiunea Întrebări frecvente');

	// Rubrica reală a aplicației
	const r = analyzeSeo({
		html: body,
		title: a.seoTitle,
		metaDescription: a.metaDescription,
		focusKeyword: a.focusKeyword,
		slug: a.slug,
		featuredImageUrl: 'x' // toate articolele au deja featured image
	});
	// „links" e singurul warn acceptat (guardrail: fără linkuri)
	const badChecks = [...r.seo.checks, ...r.aeo.checks, ...r.geo.checks].filter(
		(c) => c.status !== 'good' && c.id !== 'links'
	);
	for (const c of badChecks) problems.push(`SEO ${c.status.toUpperCase()} [${c.id}]: ${c.hint}`);

	if (problems.length) {
		failures++;
		console.log(`\nFAIL ${a.id} — „${a.seoTitle}" (scor ${r.overall})`);
		for (const p of problems) console.log('  - ' + p);
	} else {
		console.log(`OK   ${a.id} — scor ${r.overall} — „${a.seoTitle}" [cat ${CATS[a.categoryId].name}] ${wc}w`);
	}
}
console.log(`\n${items.length - failures}/${items.length} trec.`);
process.exit(failures ? 1 : 0);
