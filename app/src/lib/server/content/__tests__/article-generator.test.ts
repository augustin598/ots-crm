import { describe, it, expect } from 'bun:test';
import { buildSystemPrompt, parseGeneration } from '../article-prompt';

describe('buildSystemPrompt', () => {
	it('include profilul + guardrails + direcția', () => {
		const s = buildSystemPrompt(
			{
				tone: 'cald',
				audience: 'femei 18+',
				language: 'ro',
				keywords: 'videochat, Iași',
				guardrails: 'doar claim-uri din sursă',
				doList: null,
				dontList: null,
				topics: null,
				sampleUrls: null,
				extraNotes: null
			},
			'focus pe program flexibil'
		);
		expect(s).toContain('cald');
		expect(s).toContain('femei 18+');
		expect(s).toContain('doar claim-uri din sursă');
		expect(s).toContain('focus pe program flexibil');
	});
	it('merge și cu profil null', () => {
		const s = buildSystemPrompt(null, null);
		expect(typeof s).toBe('string');
		expect(s.length).toBeGreaterThan(0);
	});
});

describe('parseGeneration', () => {
	it('parsează JSON fenced', () => {
		const r = parseGeneration('```json\n{"title":"T","excerpt":"E","body_markdown":"## H\\ntext"}\n```');
		expect(r.title).toBe('T');
		expect(r.excerpt).toBe('E');
		expect(r.bodyMarkdown).toContain('## H');
	});
	it('parsează JSON brut', () => {
		const r = parseGeneration('{"title":"A","excerpt":"B","body_markdown":"C"}');
		expect(r.title).toBe('A');
	});
	it('fallback: text simplu → bodyMarkdown', () => {
		const r = parseGeneration('doar niște text fără json');
		expect(r.bodyMarkdown).toContain('doar niște text');
		expect(r.title).toBe('');
	});
});
