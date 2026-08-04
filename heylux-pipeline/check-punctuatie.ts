/**
 * Verificări mecanice de punctuație și exprimare (Îndreptar ed. V + DOOM + Avram).
 * Usage: bun check-punctuatie.ts <results.json>
 * Flag-urile sunt SUSPICIUNI de verificat manual, nu verdicte — le raportează cu context.
 */
import { readFileSync } from 'fs';

const items = JSON.parse(readFileSync(process.argv[2], 'utf8'));

/** Text „curat" pentru analiză: fără taguri, cu punctuația păstrată. */
const strip = (html: string) =>
	html
		.replace(/<\/(h2|h3|p|li|ul|ol)>/g, ' § ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

interface Rule {
	id: string;
	re: RegExp;
	note: string;
}

const RULES: Rule[] = [
	// Virgula obligatorie înainte de adversative
	{ id: 'virgula-dar', re: /[a-zăâîșț)]\s+dar\s/gi, note: 'lipsă virgulă înainte de „dar"' },
	{ id: 'virgula-iar', re: /[a-zăâîșț)]\s+iar\s+(?!o\b)/gi, note: 'lipsă virgulă înainte de „iar" (dacă e adversativ)' },
	{ id: 'virgula-ci', re: /[a-zăâîșț)]\s+ci\s/gi, note: 'lipsă virgulă înainte de „ci"' },
	// Concesiva: „deși" cere virgulă la finalul subordonatei
	{ id: 'desi', re: /\bdeși\b/gi, note: 'concesiva cu „deși" se izolează ÎNTOTDEAUNA cu virgulă' },
	// „însă/deci/totuși" în interiorul propoziției NU se izolează
	{ id: 'insa-izolat', re: /,\s*(însă|deci|totuși)\s*,/gi, note: '„însă/deci/totuși" în interior NU se pun între virgule' },
	{ id: 'desigur-ca', re: /\b(desigur|sigur)\s*,\s*că\b/gi, note: 'fără virgulă între „desigur" și „că"' },
	// Ghilimele / linii
	{ id: 'ghilimele-en', re: /["""]/g, note: 'ghilimele englezești; corect „…"' },
	{ id: 'dash', re: /[—–]/g, note: 'em/en dash interzis' },
	// Spațiere
	{ id: 'spatiu-inainte', re: /\s+[.,;:!?]/g, note: 'spațiu înainte de semn de punctuație' },
	{ id: 'fara-spatiu-dupa', re: /[.,;:](?=[A-Za-zĂÂÎȘȚăâîșț])/g, note: 'lipsă blanc după semn de punctuație' },
	{ id: 'spatiu-dublu', re: / {2,}/g, note: 'spațiu dublu' },
	{ id: 'cratima-blanc', re: /\s-\s/g, note: 'cratimă cu blancuri (unește fără blancuri; pentru intercalare folosește virgulă)' },
	// Numerale: „de" obligatoriu la ≥20
	{ id: 'numeral-de', re: /\b([2-9]\d|\d{3,}|\d+\.\d{3})\s+(lei|euro|ore|zile|luni|ani|modele|colege|trainerițe|participante)\b/gi, note: 'numeral ≥20 fără „de" (corect: 40 de lei)' },
	// Exprimare
	{ id: 'ca-si', re: /\bca și (?!cum\b|când\b)/gi, note: '„ca și" condamnat de DOOM (excepție: ca și cum/când)' },
	{ id: 'decat-afirmativ', re: /\b(am|ai|are|avem|aveți|au|e|este|sunt|costă|durează|primești|câștigi|iei)\s+decât\b/gi, note: '„decât" fără negație' },
	{ id: 'care-fara-pe', re: /\b(pe care|care)\s+(?:l-|le-|o\s+|i-)?am\s+\w+(?:t|s)\b/gi, note: 'verifică „pe care" la complement direct' },
	{ id: 'optim-grade', re: /\b(cel mai|cea mai|foarte|mai)\s+(optim|excelent|superior|minim|complet|perfect)/gi, note: 'adjectiv fără grade de comparație' },
	{ id: 'calc', re: /\b(inovativ|focusat|impacteaz|a impacta|seamless|expertiz|performez|performeaz)/gi, note: 'calc/anglicism' },
	{ id: 'face-diferenta', re: /face diferența/gi, note: 'calc „a face diferența"' },
	{ id: 'pret-scump', re: /preț\s+scump/gi, note: 'pleonasm: preț mare' },
	{ id: 'vroia', re: /\bvroia/gi, note: '„vroiam" nu există: voiam' },
	{ id: 'mi-ar-place', re: /mi-ar place/gi, note: 'corect: mi-ar plăcea' },
	{ id: 'creaza', re: /\bcrează\b/gi, note: 'corect: creează' }
];

let total = 0;
for (const a of items) {
	const text = strip(a.bodyHtml);
	const all = [a.title, a.seoTitle, a.metaDescription, a.excerpt, text].join(' ¶ ');
	const hits: string[] = [];
	for (const r of RULES) {
		for (const m of all.matchAll(r.re)) {
			const i = m.index ?? 0;
			const ctx = all.slice(Math.max(0, i - 55), i + m[0].length + 45).replace(/\s+/g, ' ');
			hits.push(`  [${r.id}] ${r.note}\n      …${ctx}…`);
		}
	}
	total += hits.length;
	console.log(`\n### ${a.id} — ${hits.length} semnalări`);
	for (const h of hits) console.log(h);
}
console.log(`\nTOTAL semnalări: ${total}`);
