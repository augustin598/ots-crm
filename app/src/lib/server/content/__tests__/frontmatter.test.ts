import { describe, it, expect } from 'vitest';
import { parseFrontmatter } from '../frontmatter';

describe('parseFrontmatter', () => {
	it('parsează frontmatter cu valori citate și corpul', () => {
		const md = `---\nid: "abc123"\nbrand: "heylux"\nrewrittenTitle: "Job videochat Iași — Heylux"\nrewrittenExcerpt: "Angajare fără experiență."\n---\n\nCorpul articolului.\n\n## Secțiune`;
		const { data, body } = parseFrontmatter(md);
		expect(data.id).toBe('abc123');
		expect(data.brand).toBe('heylux');
		expect(data.rewrittenTitle).toBe('Job videochat Iași — Heylux');
		expect(data.rewrittenExcerpt).toBe('Angajare fără experiență.');
		expect(body.startsWith('Corpul articolului.')).toBe(true);
		expect(body.includes('## Secțiune')).toBe(true);
	});

	it('returnează body gol când nu e frontmatter', () => {
		const { data, body } = parseFrontmatter('doar text');
		expect(data).toEqual({});
		expect(body).toBe('doar text');
	});
});
