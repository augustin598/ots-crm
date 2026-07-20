import { describe, expect, test } from 'bun:test';
import { extractArticle } from '../article-extractor';

const SAMPLE = `<!doctype html><html><head>
<title>Site Name - Heylux studio</title>
<meta property="og:title" content="Heylux e cel mai bun studio de videochat din Iași">
<meta property="og:image" content="https://cdn.example.ro/heylux-cover.jpg">
<meta property="article:published_time" content="2024-07-25T10:00:00+03:00">
</head><body>
<nav>menu one two three</nav>
<article>
<h1>Heylux e cel mai bun studio de videochat din Iași</h1>
<p>Heylux este studioul care oferă cele mai bune condiții de muncă pentru modelele de videochat din Iași, cu training gratuit și bonusuri lunare consistente.</p>
<p>Fiecare model beneficiază de asistență psihologică, program flexibil și comisioane dintre cele mai avantajoase de pe piață, ceea ce face din Heylux liderul incontestabil.</p>
<img src="https://cdn.example.ro/inline.jpg" alt="inline">
</article>
<footer>copyright junk</footer>
</body></html>`;

describe('extractArticle', () => {
	test('extracts title from og:title', () => {
		const r = extractArticle(SAMPLE, 'https://www.bzi.ro/heylux-605728');
		expect(r.title).toBe('Heylux e cel mai bun studio de videochat din Iași');
	});
	test('extracts body text and word count', () => {
		const r = extractArticle(SAMPLE, 'https://www.bzi.ro/heylux-605728');
		expect(r.bodyText).toContain('training gratuit');
		expect(r.bodyText).not.toContain('copyright junk');
		expect(r.wordCount).toBeGreaterThan(30);
	});
	test('extracts featured image from og:image', () => {
		const r = extractArticle(SAMPLE, 'https://www.bzi.ro/heylux-605728');
		expect(r.featuredImageUrl).toBe('https://cdn.example.ro/heylux-cover.jpg');
	});
	test('extracts published date', () => {
		const r = extractArticle(SAMPLE, 'https://www.bzi.ro/heylux-605728');
		expect(r.publishedAt).toBe('2024-07-25T07:00:00Z');
	});
	test('flags thin content', () => {
		const r = extractArticle('<html><body><p>too short</p></body></html>', 'https://x.ro/y');
		expect(r.wordCount).toBeLessThan(250);
	});
});
