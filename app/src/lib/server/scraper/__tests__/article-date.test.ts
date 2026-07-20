import { describe, expect, test } from 'bun:test';
import {
	extractArticlePublishedDate,
	parseRomanianAbsoluteDate
} from '../article-date';

describe('extractArticlePublishedDate', () => {
	test('reads og:published_time meta', () => {
		const html = `<meta property="article:published_time" content="2024-07-25T10:00:00+03:00">`;
		expect(extractArticlePublishedDate(html)).toBe('2024-07-25T07:00:00Z');
	});
	test('reads JSON-LD datePublished', () => {
		const html = `<script type="application/ld+json">{"datePublished":"2018-12-03"}</script>`;
		expect(extractArticlePublishedDate(html)).toBe('2018-12-03T00:00:00Z');
	});
	test('returns null when no date present', () => {
		expect(extractArticlePublishedDate('<p>no date here</p>')).toBeNull();
	});
});

describe('parseRomanianAbsoluteDate', () => {
	test('parses "25 mai 2023"', () => {
		expect(parseRomanianAbsoluteDate('25 mai 2023')).toBe('2023-05-25T00:00:00Z');
	});
});
