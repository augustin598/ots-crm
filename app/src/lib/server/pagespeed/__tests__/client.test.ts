// Teste pentru clientul Google PageSpeed Insights API v5: parsarea răspunsului
// și politica de rețea (timeout, retry cu backoff, clasificarea erorilor).
import { describe, test, expect, mock } from 'bun:test';
import fixture from './fixtures/psi-response.json';

mock.module('$env/dynamic/private', () => ({ env: { PSI_API_KEY: 'test-key-123' } }));
mock.module('$env/static/private', () => ({}));

const { parsePsiResponse, fetchPagespeed, PsiApiError } = await import('../client');

describe('parsePsiResponse', () => {
	const parsed = parsePsiResponse(fixture);

	test('scoruri de categorie ×100, rotunjite', () => {
		expect(parsed.performance).toBe(58);
		expect(parsed.accessibility).toBe(87);
		expect(parsed.bestPractices).toBe(93);
		expect(parsed.seo).toBe(99);
	});

	test('metrici de laborator din audits (ms rotunjite, CLS zecimal)', () => {
		expect(parsed.lcpMs).toBe(3422);
		expect(parsed.cls).toBe(0.083);
		expect(parsed.tbtMs).toBe(412);
		expect(parsed.fcpMs).toBe(1834);
		expect(parsed.speedIndexMs).toBe(4211);
		expect(parsed.inpMs).toBe(246);
		expect(parsed.ttfbMs).toBe(512);
		expect(parsed.totalBytes).toBe(2891342);
		expect(parsed.requestCount).toBe(3);
	});

	test('date reale CrUX: p75, CLS împărțit la 100', () => {
		expect(parsed.fieldLcpMs).toBe(2143);
		expect(parsed.fieldInpMs).toBe(190);
		expect(parsed.fieldCls).toBe(0.08);
	});

	test('recomandări: audituri picate cu economii, sortate (performanță întâi, desc)', () => {
		expect(parsed.opportunities.map((o) => o.id)).toEqual([
			'render-blocking-resources',
			'unused-javascript',
			'link-name'
		]);
		const first = parsed.opportunities[0];
		expect(first.title).toBe('Eliminați resursele care blochează redarea');
		expect(first.savingsMs).toBe(1350);
		expect(first.category).toBe('performance');
		expect(first.displayValue).toBe('Economii estimate de 1.350 ms');
		// descrierea vine fără link-urile markdown
		expect(first.description).toContain('Solicitările blochează redarea');
		expect(first.description).not.toContain('](');
	});

	test('recomandări: elementele afectate (URL-uri cu durată/greutate, selectori DOM)', () => {
		const render = parsed.opportunities.find((o) => o.id === 'render-blocking-resources')!;
		expect(render.items[0]).toEqual({
			label: 'https://www.heylux.ro/wp-content/css/frontend.min.css',
			detail: '6,9 KB · 480 ms'
		});
		const unusedJs = parsed.opportunities.find((o) => o.id === 'unused-javascript')!;
		expect(unusedJs.items[0].detail).toContain('176 KB');

		const linkName = parsed.opportunities.find((o) => o.id === 'link-name')!;
		expect(linkName.category).toBe('accessibility');
		expect(linkName.savingsMs).toBe(0);
		expect(linkName.items.map((i) => i.label)).toEqual([
			'a.custom-mobile-logo-link',
			'a.elementor-icon'
		]);
		expect(linkName.items[0].detail).toContain('<a href=');
	});

	test('recomandări: details.items non-array (debugdata) nu crapă parserul', () => {
		const weird = parsePsiResponse({
			lighthouseResult: {
				categories: {
					performance: { score: 0.5, auditRefs: [{ id: 'weird-audit' }] }
				},
				audits: {
					'weird-audit': {
						title: 'Audit ciudat',
						score: 0.3,
						details: { type: 'debugdata', items: { nu: 'e array' } }
					}
				}
			}
		});
		// nu crapă; fără economie și fără elemente, insight-ul de performanță e filtrat ca zgomot
		expect(weird.opportunities).toEqual([]);
	});

	test('recomandări: auditurile trecute (score 1) și metricile de bază nu apar', () => {
		const ids = parsed.opportunities.map((o) => o.id);
		expect(ids).not.toContain('modern-image-formats'); // scor 1, economie 0
		expect(ids).not.toContain('color-contrast'); // trece
		expect(ids).not.toContain('largest-contentful-paint'); // grup „metrics"
	});

	test('câmpuri lipsă → null, fără crash', () => {
		const minimal = parsePsiResponse({
			lighthouseResult: { categories: { performance: { score: 0.91 } }, audits: {} }
		});
		expect(minimal.performance).toBe(91);
		expect(minimal.accessibility).toBeNull();
		expect(minimal.inpMs).toBeNull();
		expect(minimal.fieldLcpMs).toBeNull();
		expect(minimal.opportunities).toEqual([]);
	});

	test('INP: fallback pe experimental-interaction-to-next-paint', () => {
		const withExperimental = parsePsiResponse({
			lighthouseResult: {
				categories: {},
				audits: { 'experimental-interaction-to-next-paint': { numericValue: 312 } }
			}
		});
		expect(withExperimental.inpMs).toBe(312);
	});
});

describe('fetchPagespeed — rețea', () => {
	const okResponse = () =>
		new Response(JSON.stringify(fixture), { status: 200, headers: { 'content-type': 'application/json' } });

	test('construiește URL-ul cu toate categoriile, strategia, locale=ro și cheia', async () => {
		let calledUrl = '';
		const fakeFetch = async (url: RequestInfo | URL) => {
			calledUrl = String(url);
			return okResponse();
		};
		await fetchPagespeed('https://example.ro/', 'mobile', { fetch: fakeFetch, sleep: async () => {} });
		expect(calledUrl).toContain('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
		expect(calledUrl).toContain('url=https%3A%2F%2Fexample.ro%2F');
		expect(calledUrl).toContain('strategy=mobile');
		expect(calledUrl).toContain('category=performance');
		expect(calledUrl).toContain('category=accessibility');
		expect(calledUrl).toContain('category=best-practices');
		expect(calledUrl).toContain('category=seo');
		expect(calledUrl).toContain('locale=ro');
		expect(calledUrl).toContain('key=test-key-123');
	});

	test('500 → retry cu backoff, apoi succes', async () => {
		let calls = 0;
		const delays: number[] = [];
		const fakeFetch = async () => {
			calls++;
			if (calls < 3) return new Response('upstream error', { status: 500 });
			return okResponse();
		};
		const result = await fetchPagespeed('https://example.ro/', 'desktop', {
			fetch: fakeFetch,
			sleep: async (ms: number) => {
				delays.push(ms);
			}
		});
		expect(calls).toBe(3);
		expect(delays.length).toBe(2);
		expect(delays[1]).toBeGreaterThan(delays[0]); // backoff exponențial
		expect(result.performance).toBe(58);
	});

	test('400 (URL invalid) → fără retry, eroare permanentă', async () => {
		let calls = 0;
		const fakeFetch = async () => {
			calls++;
			return new Response(JSON.stringify({ error: { message: 'Invalid URL' } }), { status: 400 });
		};
		await expect(
			fetchPagespeed('https://invalid', 'mobile', { fetch: fakeFetch, sleep: async () => {} })
		).rejects.toThrow(PsiApiError);
		expect(calls).toBe(1);
	});

	test('429 → se retrimite (tranzitorie)', async () => {
		let calls = 0;
		const fakeFetch = async () => {
			calls++;
			if (calls === 1) return new Response('quota', { status: 429 });
			return okResponse();
		};
		const result = await fetchPagespeed('https://example.ro/', 'mobile', {
			fetch: fakeFetch,
			sleep: async () => {}
		});
		expect(calls).toBe(2);
		expect(result.performance).toBe(58);
	});

	test('eșec persistent → aruncă după 3 încercări (1 + 2 retry)', async () => {
		let calls = 0;
		const fakeFetch = async () => {
			calls++;
			return new Response('boom', { status: 503 });
		};
		await expect(
			fetchPagespeed('https://example.ro/', 'mobile', { fetch: fakeFetch, sleep: async () => {} })
		).rejects.toThrow();
		expect(calls).toBe(3);
	});
});
