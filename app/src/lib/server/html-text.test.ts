import { describe, expect, test } from 'bun:test';
import { htmlToPlainText } from './html-text';

/**
 * Run: `bun test src/lib/server/html-text.test.ts`
 *
 * Regression for the comment-notification email that rendered raw TipTap markup
 * (`<p><a target="_blank" ...>`) because commentPreview was only escapeHtml'd,
 * never stripped to plain text first.
 */
describe('htmlToPlainText', () => {
	test('strips the exact TipTap comment that leaked into the email', () => {
		const tiptap =
			'<p><a target="_blank" rel="noopener noreferrer" href="https://asociatie.1topsolution.ro/">https://asociatie.1topsolution.ro/</a> Done. mai ramane de cumparat domeniu</p>';
		expect(htmlToPlainText(tiptap)).toBe(
			'https://asociatie.1topsolution.ro/ Done. mai ramane de cumparat domeniu'
		);
	});

	test('contains no angle-bracket markup after stripping', () => {
		const out = htmlToPlainText('<p>Bold <strong>text</strong> and <em>more</em></p>');
		expect(out).not.toContain('<');
		expect(out).not.toContain('>');
		expect(out).toBe('Bold text and more');
	});

	test('inserts a boundary between adjacent block elements', () => {
		expect(htmlToPlainText('<p>linia 1</p><p>linia 2</p>')).toBe('linia 1 linia 2');
	});

	test('decodes common HTML entities', () => {
		expect(htmlToPlainText('<p>Ben &amp; Jerry &lt;tag&gt; &quot;q&quot; &#39;a&#39;</p>')).toBe(
			'Ben & Jerry <tag> "q" \'a\''
		);
	});

	test('drops script/style content entirely', () => {
		expect(htmlToPlainText('<p>safe</p><script>alert(1)</script>')).toBe('safe');
	});

	test('collapses whitespace and nbsp', () => {
		expect(htmlToPlainText('<p>a&nbsp;&nbsp;b\n\n  c</p>')).toBe('a b c');
	});

	// Replay invariant: emailLog stores the already-processed commentPreview, so a
	// resend re-runs escapeHtml(htmlToPlainText(...)) over it. That composition must
	// be a fixed point or resends would double-escape (&amp; -> &amp;amp;).
	test('escapeHtml(htmlToPlainText(x)) is idempotent under replay', () => {
		const escapeHtml = (s: string) =>
			s
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;')
				.replace(/"/g, '&quot;')
				.replace(/'/g, '&#39;');
		const f = (x: string) => escapeHtml(htmlToPlainText(x));
		for (const c of [
			'<p><a href="https://x.ro/">https://x.ro/</a> Done & gata</p>',
			'<p>a &lt;b&gt; c &amp; d "q" \'z\'</p>',
			'<p>l1</p><p>l2</p>'
		]) {
			const once = f(c);
			expect(f(once)).toBe(once);
		}
	});
});
