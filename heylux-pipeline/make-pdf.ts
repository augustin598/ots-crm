/**
 * Generează un PDF de review din articole (result-*.json) via Chrome headless.
 * Usage: bun make-pdf.ts <results.json> <out.pdf> [etichetă model]
 */
import { readFileSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';

const items = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const out = process.argv[3];
const modelLabel = process.argv[4] ?? '';

const esc = (s: string) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
const sections = items
	.map(
		(a: any) => `
<article>
	${modelLabel ? `<div class="badge">Scris de: ${esc(modelLabel)}</div>` : ''}
	<h1>${esc(a.title)}</h1>
	<table class="meta">
		<tr><td>Focus keyword</td><td>${esc(a.focusKeyword)}</td></tr>
		<tr><td>Titlu SEO</td><td>${esc(a.seoTitle)} <span class="n">(${a.seoTitle.length}/60)</span></td></tr>
		<tr><td>Meta description</td><td>${esc(a.metaDescription)} <span class="n">(${a.metaDescription.length}/160)</span></td></tr>
		<tr><td>Slug</td><td>${esc(a.slug)}</td></tr>
		<tr><td>Excerpt</td><td>${esc(a.excerpt)}</td></tr>
		<tr><td>Categorie WP</td><td>${a.categoryId}</td></tr>
	</table>
	<div class="body">${a.bodyHtml}</div>
</article>`
	)
	.join('\n<div class="pagebreak"></div>\n');

const html = `<!doctype html><html lang="ro"><head><meta charset="utf-8"><style>
	body { font-family: Georgia, 'Times New Roman', serif; color: #1a1a1a; line-height: 1.55; font-size: 11.5pt; margin: 0; }
	article { padding: 4px 8px; }
	h1 { font-size: 19pt; line-height: 1.25; margin: 0 0 12px; color: #4c1d95; }
	h2 { font-size: 14pt; margin: 18px 0 6px; color: #111; }
	h3 { font-size: 12pt; margin: 14px 0 4px; }
	p { margin: 7px 0; }
	ul, ol { margin: 6px 0 6px 22px; }
	table.meta { border-collapse: collapse; width: 100%; margin: 0 0 16px; font-family: Helvetica, Arial, sans-serif; font-size: 8.5pt; }
	table.meta td { border: 1px solid #ddd; padding: 4px 8px; vertical-align: top; }
	table.meta td:first-child { width: 110px; font-weight: 700; background: #f6f4fb; white-space: nowrap; }
	.n { color: #888; }
	.badge { display: inline-block; font-family: Helvetica, Arial, sans-serif; font-size: 8pt; font-weight: 700;
	         letter-spacing: .06em; text-transform: uppercase; color: #fff; background: #4c1d95;
	         padding: 3px 9px; border-radius: 3px; margin-bottom: 10px; }
	.pagebreak { page-break-after: always; }
</style></head><body>${sections}</body></html>`;

const tmpHtml = out.replace(/\.pdf$/, '.html');
writeFileSync(tmpHtml, html);
execFileSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
	'--headless=new',
	'--disable-gpu',
	`--print-to-pdf=${out}`,
	'--no-pdf-header-footer',
	'--virtual-time-budget=4000',
	tmpHtml
]);
console.log('PDF:', out);
