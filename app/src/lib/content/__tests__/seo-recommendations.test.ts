import { describe, it, expect } from 'bun:test';
import {
	buildSeoRecommendations,
	type SeoRecInput,
	type SeoRecWebsiteInput
} from '../seo-recommendations';

const NOW = new Date('2026-08-31T10:00:00Z');

function ws(over: Partial<SeoRecWebsiteInput> = {}): SeoRecWebsiteInput {
	return {
		id: 'w1',
		domain: 'exemplu.ro',
		clientName: 'Clientul SRL',
		hasProfile: true,
		hasWordpress: true,
		failedPublishes: 0,
		sourceArticles: 0,
		analyzedArticles: 10,
		faqSuspect: 0,
		pagespeedMobile: 90,
		cwvPass: true,
		...over
	};
}

function input(over: Partial<SeoRecInput> = {}): SeoRecInput {
	return { websites: [ws()], links: [], discoveryUntracked: 0, discoveryDomain: null, ...over };
}

describe('buildSeoRecommendations', () => {
	it('website sănătos → nicio recomandare', () => {
		expect(buildSeoRecommendations(input(), NOW)).toEqual([]);
	});

	it('fără profil brand → prioritate mare, tip Content', () => {
		const r = buildSeoRecommendations(input({ websites: [ws({ hasProfile: false })] }), NOW);
		expect(r).toHaveLength(1);
		expect(r[0].priority).toBe('mare');
		expect(r[0].type).toBe('Content');
		expect(r[0].websiteId).toBe('w1');
	});

	it('fără WordPress → mare/Tehnic', () => {
		const r = buildSeoRecommendations(input({ websites: [ws({ hasWordpress: false })] }), NOW);
		expect(r[0].priority).toBe('mare');
		expect(r[0].type).toBe('Tehnic');
	});

	it('publicări eșuate → mare/Tehnic cu numărul în impact', () => {
		const r = buildSeoRecommendations(input({ websites: [ws({ failedPublishes: 3 })] }), NOW);
		expect(r[0].priority).toBe('mare');
		expect(r[0].type).toBe('Tehnic');
		expect(r[0].impact).toContain('3');
	});

	it('linkuri stagnante > 14 zile → medie/Linkuri per client', () => {
		const r = buildSeoRecommendations(
			input({ links: [{ clientId: 'c1', clientName: 'Clientul SRL', staleCount: 4 }] }),
			NOW
		);
		expect(r[0].priority).toBe('medie');
		expect(r[0].type).toBe('Linkuri');
		expect(r[0].impact).toContain('4');
	});

	it('linkuri descoperite neînregistrate → medie/Linkuri global', () => {
		const r = buildSeoRecommendations(
			input({ discoveryUntracked: 7, discoveryDomain: 'gandul.ro' }),
			NOW
		);
		expect(r[0].priority).toBe('medie');
		expect(r[0].type).toBe('Linkuri');
		expect(r[0].websiteId).toBeNull();
		expect(r[0].title).toContain('gandul.ro');
	});

	it('peste 50 articole sursă neredactate → medie/Content; la 50 fix nu', () => {
		expect(
			buildSeoRecommendations(input({ websites: [ws({ sourceArticles: 50 })] }), NOW)
		).toEqual([]);
		const r = buildSeoRecommendations(input({ websites: [ws({ sourceArticles: 51 })] }), NOW);
		expect(r[0].priority).toBe('medie');
		expect(r[0].type).toBe('Content');
	});

	it('PageSpeed mobil < 50 sau CWV fail → medie/PageSpeed (o singură dată)', () => {
		const slab = buildSeoRecommendations(
			input({ websites: [ws({ pagespeedMobile: 42 })] }),
			NOW
		);
		expect(slab).toHaveLength(1);
		expect(slab[0].type).toBe('PageSpeed');
		const cwv = buildSeoRecommendations(
			input({ websites: [ws({ pagespeedMobile: 80, cwvPass: false })] }),
			NOW
		);
		expect(cwv).toHaveLength(1);
		expect(cwv[0].type).toBe('PageSpeed');
		// fără măsurătoare → nu speculăm
		const fara = buildSeoRecommendations(
			input({ websites: [ws({ pagespeedMobile: null, cwvPass: null })] }),
			NOW
		);
		expect(fara).toEqual([]);
	});

	it('articole cu check AEO picat → mică/AEO doar când există articole analizate', () => {
		const r = buildSeoRecommendations(
			input({ websites: [ws({ faqSuspect: 5, analyzedArticles: 10 })] }),
			NOW
		);
		expect(r[0].priority).toBe('mică');
		expect(r[0].type).toBe('AEO');
		expect(
			buildSeoRecommendations(
				input({ websites: [ws({ faqSuspect: 5, analyzedArticles: 0 })] }),
				NOW
			)
		).toEqual([]);
	});

	it('sortare: mare > medie > mică; due = +7/+14/+30 zile', () => {
		const r = buildSeoRecommendations(
			input({
				websites: [ws({ hasProfile: false, sourceArticles: 60, faqSuspect: 2 })]
			}),
			NOW
		);
		expect(r.map((x) => x.priority)).toEqual(['mare', 'medie', 'mică']);
		const days = (iso: string) =>
			Math.round((new Date(iso).getTime() - NOW.getTime()) / 86400000);
		expect(days(r[0].due)).toBe(7);
		expect(days(r[1].due)).toBe(14);
		expect(days(r[2].due)).toBe(30);
	});

	it('id-urile sunt deterministe și unice', () => {
		const in1 = input({
			websites: [
				ws({ hasProfile: false }),
				ws({ id: 'w2', domain: 'alt.ro', hasProfile: false })
			]
		});
		const a = buildSeoRecommendations(in1, NOW);
		const b = buildSeoRecommendations(in1, NOW);
		expect(a.map((x) => x.id)).toEqual(b.map((x) => x.id));
		expect(new Set(a.map((x) => x.id)).size).toBe(a.length);
	});
});
