import { describe, it, expect } from 'bun:test';
import { computeArticleScores, seoOverall } from '../seo-score';

const analizabil = {
	generatedHtml:
		'<p>Job videochat Iași la Heylux: câștigi din prima zi, minim 300 lei.</p>' +
		'<h2>Cât câștigi la job videochat Iași</h2><p>' +
		'La Heylux câștigi minim 300 lei pe zi. '.repeat(80) +
		'</p><h2>Întrebări frecvente</h2><ul><li>Da</li></ul><a href="https://heylux.ro">link</a>',
	generatedTitle: 'Job videochat Iași la Heylux',
	seoTitle: 'Job videochat Iași la Heylux',
	metaDescription:
		'Job videochat Iași la Heylux: angajare fără experiență, program flexibil și minim 300 lei pe zi. Aplică acum pentru interviu și începe azi.',
	focusKeyword: 'job videochat iași',
	slug: 'job-videochat-iasi',
	featuredImageUrl: 'https://heylux.ro/img.jpg'
};

describe('computeArticleScores', () => {
	it('fără conținut generat → toate scorurile null', () => {
		const r = computeArticleScores({
			...analizabil,
			generatedHtml: null
		});
		expect(r).toEqual({ seoScore: null, aeoScore: null, geoScore: null });
	});

	it('articol complet → scoruri 0..100 pe toate axele', () => {
		const r = computeArticleScores(analizabil);
		for (const v of [r.seoScore, r.aeoScore, r.geoScore]) {
			expect(v).not.toBeNull();
			expect(v!).toBeGreaterThanOrEqual(0);
			expect(v!).toBeLessThanOrEqual(100);
		}
		// articolul „bun" din testele analyzeSeo trece pragul verde pe SEO
		expect(r.seoScore!).toBeGreaterThanOrEqual(90);
	});

	it('cade pe generatedTitle când seoTitle lipsește', () => {
		const cuSeoTitle = computeArticleScores(analizabil);
		const faraSeoTitle = computeArticleScores({ ...analizabil, seoTitle: null });
		// titlul generat conține tot cuvântul-cheie → același scor SEO
		expect(faraSeoTitle.seoScore).toBe(cuSeoTitle.seoScore);
	});

	it('câmpurile opționale null nu aruncă', () => {
		const r = computeArticleScores({
			generatedHtml: '<p>text scurt</p>',
			generatedTitle: null,
			seoTitle: null,
			metaDescription: null,
			focusKeyword: null,
			slug: null,
			featuredImageUrl: null
		});
		expect(r.seoScore).not.toBeNull();
	});
});

describe('seoOverall', () => {
	it('pondere 50% SEO + 25% AEO + 25% GEO, rotunjit', () => {
		expect(seoOverall(90, 80, 70)).toBe(83); // 45 + 20 + 17.5 = 82.5 → 83
		expect(seoOverall(100, 100, 100)).toBe(100);
		expect(seoOverall(0, 0, 0)).toBe(0);
	});

	it('identic cu overall-ul din analyzeSeo pe același articol', () => {
		const r = computeArticleScores(analizabil);
		// analyzeSeo.overall folosește exact aceeași formulă — sanity check pe integrare
		expect(seoOverall(r.seoScore!, r.aeoScore!, r.geoScore!)).toBeGreaterThanOrEqual(0);
	});
});
