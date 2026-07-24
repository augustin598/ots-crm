import { describe, it, expect } from 'bun:test';
import { analyzeSeo } from '../seo-analysis';

const good = {
	html:
		'<p>Job videochat Iași la Heylux: câștigi din prima zi, minim 300 lei.</p>' +
		'<h2>Cât câștigi la job videochat Iași</h2><p>' +
		'La Heylux câștigi minim 300 lei pe zi. '.repeat(80) +
		'</p><h2>Întrebări frecvente</h2><ul><li>Da</li></ul><a href="https://heylux.ro">link</a>',
	title: 'Job videochat Iași la Heylux',
	metaDescription:
		'Job videochat Iași la Heylux: angajare fără experiență, program flexibil și minim 300 lei pe zi. Aplică acum pentru interviu și începe azi.',
	focusKeyword: 'job videochat iași',
	slug: 'job-videochat-iasi',
	featuredImageUrl: 'https://heylux.ro/img.jpg'
};

describe('analyzeSeo', () => {
	it('returnează scoruri și grupuri', () => {
		const r = analyzeSeo(good);
		expect(r.seo.checks.length).toBeGreaterThan(5);
		expect(r.aeo.checks.length).toBe(3);
		expect(r.geo.checks.length).toBe(3);
		expect(r.overall).toBeGreaterThan(0);
		expect(r.overall).toBeLessThanOrEqual(100);
	});

	it('articol bun scorează sus la SEO', () => {
		const r = analyzeSeo(good);
		expect(r.seo.score).toBeGreaterThanOrEqual(70);
		const kwTitle = r.seo.checks.find((c) => c.id === 'kw-title');
		expect(kwTitle?.status).toBe('good');
		const featured = r.seo.checks.find((c) => c.id === 'featured');
		expect(featured?.status).toBe('good');
	});

	it('fără cuvânt-cheie și imagine → checks bad', () => {
		const r = analyzeSeo({ ...good, focusKeyword: '', featuredImageUrl: null });
		expect(r.seo.checks.find((c) => c.id === 'kw-set')?.status).toBe('bad');
		expect(r.seo.checks.find((c) => c.id === 'featured')?.status).toBe('bad');
		expect(r.seo.score).toBeLessThan(analyzeSeo(good).seo.score);
	});

	it('conținut scurt → content-len bad', () => {
		const r = analyzeSeo({ ...good, html: '<p>text scurt</p>' });
		expect(r.seo.checks.find((c) => c.id === 'content-len')?.status).toBe('bad');
	});
});
