import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import { parse as parseNode } from 'node-html-parser';
import { extractArticlePublishedDate } from '$lib/server/scraper/article-date';

export interface ExtractedArticle {
	title: string;
	bodyHtml: string;
	bodyText: string;
	excerpt: string;
	wordCount: number;
	featuredImageUrl: string | null;
	images: string[];
	publishedAt: string | null;
}

/** Read a meta tag's content by property/name, tolerant of attribute order. */
function metaContent(html: string, key: string): string | null {
	const a = html.match(new RegExp(`<meta[^>]*(?:property|name)=["']${key}["'][^>]*content=["']([^"']+)["']`, 'i'));
	if (a?.[1]) return decodeEntities(a[1].trim());
	const b = html.match(new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']${key}["']`, 'i'));
	if (b?.[1]) return decodeEntities(b[1].trim());
	return null;
}

function safeCodePoint(n: number): string {
	try {
		return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
	} catch {
		return '';
	}
}

function decodeEntities(s: string): string {
	return s
		.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#x27;/gi, "'").replace(/&nbsp;/g, ' ')
		.replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').replace(/&hellip;/g, '…')
		// Generic numeric entities (common in RO press titles: &#8211; en-dash, &#537; ș, …)
		.replace(/&#x([0-9a-fA-F]+);/g, (_m, n) => safeCodePoint(parseInt(n, 16)))
		.replace(/&#(\d+);/g, (_m, n) => safeCodePoint(parseInt(n, 10)));
}

function textToWords(text: string): number {
	const t = text.trim();
	return t ? t.split(/\s+/).length : 0;
}

function absolutize(src: string, base: string): string | null {
	try { return new URL(src, base).href; } catch { return null; }
}

/** Extract a clean article from raw HTML. Pure — no network, no DB. */
export function extractArticle(html: string, sourceUrl: string): ExtractedArticle {
	// 1. Metadata first (regex on raw HTML — Readability mutates the DOM).
	const ogTitle = metaContent(html, 'og:title');
	const rawTitleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
	const titleTag = rawTitleTag ? decodeEntities(rawTitleTag).replace(/\s+/g, ' ').trim() : '';
	const publishedAt = extractArticlePublishedDate(html);
	const ogImage = metaContent(html, 'og:image');

	// 2. Readability over linkedom.
	let bodyHtml = '';
	let bodyText = '';
	let readTitle = '';
	let excerpt = '';
	try {
		const { document } = parseHTML(html);
		const reader = new Readability(document as unknown as Document, { charThreshold: 200 });
		const parsed = reader.parse();
		if (parsed) {
			bodyHtml = parsed.content ?? '';
			bodyText = (parsed.textContent ?? '').replace(/\s+/g, ' ').trim();
			readTitle = (parsed.title ?? '').trim();
			excerpt = (parsed.excerpt ?? '').trim();
		}
	} catch {
		/* fall through to heuristic */
	}

	// 3. Heuristic fallback when Readability produced too little.
	if (textToWords(bodyText) < 40) {
		const root = parseNode(html);
		const container = root.querySelector('article') ?? root.querySelector('main') ?? root.querySelector('body');
		if (container) {
			const ps = container.querySelectorAll('p').map((p) => p.toString());
			if (ps.length) {
				bodyHtml = ps.join('\n');
				bodyText = container.querySelectorAll('p').map((p) => p.text).join(' ').replace(/\s+/g, ' ').trim();
			}
		}
	}

	// 4. Images from the extracted body, absolutized.
	const images: string[] = [];
	const imgRe = /<img[^>]+src=["']([^"']+)["']/gi;
	let m: RegExpExecArray | null;
	while ((m = imgRe.exec(bodyHtml)) !== null) {
		const abs = absolutize(m[1], sourceUrl);
		if (abs && !images.includes(abs)) images.push(abs);
	}

	const title = ogTitle || readTitle || titleTag || '';
	if (!excerpt) excerpt = bodyText.slice(0, 200);
	const featuredImageUrl = (ogImage && absolutize(ogImage, sourceUrl)) || images[0] || null;

	return {
		title,
		bodyHtml,
		bodyText,
		excerpt,
		wordCount: textToWords(bodyText),
		featuredImageUrl,
		images,
		publishedAt
	};
}
