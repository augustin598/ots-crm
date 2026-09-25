import { describe, test, expect, mock } from 'bun:test';

mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logWarning: () => {},
	serializeError: (e: unknown) => ({ message: e instanceof Error ? e.message : String(e) })
}));

const { classifyPage, productUrlsFromSitemap, checkSiteOnline } = await import('../site-check');

const page = (extra = '') => `<!doctype html><html><head><title>Magazin</title></head><body>${'x'.repeat(2000)}${extra}</body></html>`;

describe('classifyPage', () => {
	test('200 cu HTML normal → fără problemă', () => {
		expect(classifyPage(200, page())).toBeNull();
	});

	test('eroarea critică WordPress (EN și RO) → eroare critică, chiar cu 200', () => {
		expect(classifyPage(500, page('There has been a critical error on this website.'))).toBe(
			'eroare critică PHP (pagina WordPress „critical error")'
		);
		expect(classifyPage(200, page('A apărut o eroare critică pe acest site.'))).toBe(
			'eroare critică PHP (pagina WordPress „critical error")'
		);
		expect(classifyPage(200, page('<b>Fatal error</b>: Uncaught Error in /wp-content/x.php'))).toBe(
			'eroare fatală PHP afișată în pagină'
		);
	});

	test('mentenanță rămasă după un update întrerupt', () => {
		expect(classifyPage(503, 'Briefly unavailable for scheduled maintenance. Check back in a minute.')).toBe(
			'blocat în mentenanță (fișierul .maintenance a rămas după update)'
		);
	});

	test('baza de date indisponibilă', () => {
		expect(classifyPage(500, page('<h1>Error establishing a database connection</h1>'))).toBe(
			'nu se conectează la baza de date'
		);
	});

	test('cod HTTP de eroare fără alt indiciu', () => {
		expect(classifyPage(502, page())).toBe('HTTP 502');
		expect(classifyPage(404, page())).toBe('HTTP 404');
	});

	test('200 dar pagină aproape goală → pagină albă', () => {
		expect(classifyPage(200, '<html><body></body></html>')).toBe('pagină albă (aproape fără conținut)');
	});
});

describe('productUrlsFromSitemap', () => {
	test('primele adrese <loc>, fără duplicate, doar de pe același site', () => {
		const xml = `<urlset>
			<url><loc>https://exemplu.ro/shop/</loc></url>
			<url><loc>https://exemplu.ro/produs-a/</loc></url>
			<url><loc>https://exemplu.ro/produs-a/</loc></url>
			<url><loc>https://alt-site.ro/x/</loc></url>
			<url><loc>https://exemplu.ro/produs-b/</loc></url>
		</urlset>`;
		expect(productUrlsFromSitemap(xml, 'https://exemplu.ro', 2)).toEqual([
			'https://exemplu.ro/shop/',
			'https://exemplu.ro/produs-a/'
		]);
	});

	test('www și fără www sunt același site', () => {
		const xml = '<urlset><url><loc>https://www.exemplu.ro/p/</loc></url></urlset>';
		expect(productUrlsFromSitemap(xml, 'https://exemplu.ro', 2)).toEqual(['https://www.exemplu.ro/p/']);
	});
});

type Route = { status: number; body: string } | 'throw';
function fakeFetch(routes: Record<string, Route>, calls: string[] = []): typeof fetch {
	return (async (url: string) => {
		calls.push(url);
		const r = routes[url];
		if (r === 'throw') throw new Error('The operation timed out.');
		if (!r) return new Response('not found', { status: 404 });
		return new Response(r.body, { status: r.status });
	}) as unknown as typeof fetch;
}

describe('checkSiteOnline', () => {
	test('homepage + primele pagini din sitemap-ul de produse → ok', async () => {
		const calls: string[] = [];
		const r = await checkSiteOnline('https://exemplu.ro', {
			fetchFn: fakeFetch(
				{
					'https://exemplu.ro/': { status: 200, body: page() },
					'https://exemplu.ro/product-sitemap.xml': {
						status: 200,
						body: '<urlset><url><loc>https://exemplu.ro/shop/</loc></url><url><loc>https://exemplu.ro/p/</loc></url></urlset>'
					},
					'https://exemplu.ro/shop/': { status: 200, body: page() },
					'https://exemplu.ro/p/': { status: 200, body: page() }
				},
				calls
			)
		});
		expect(r.ok).toBe(true);
		expect(r.pages.map((p) => [p.url, p.status, p.problem])).toEqual([
			['https://exemplu.ro/', 200, null],
			['https://exemplu.ro/shop/', 200, null],
			['https://exemplu.ro/p/', 200, null]
		]);
	});

	test('fără sitemap de produse → doar homepage; homepage cu eroare critică → nu e ok', async () => {
		const r = await checkSiteOnline('https://exemplu.ro', {
			fetchFn: fakeFetch({
				'https://exemplu.ro/': { status: 500, body: page('There has been a critical error on this website.') }
			})
		});
		expect(r.ok).toBe(false);
		expect(r.pages).toHaveLength(1);
		expect(r.pages[0].problem).toContain('eroare critică');
	});

	test('pagină care nu răspunde → problemă cu motivul, fără excepție', async () => {
		const r = await checkSiteOnline('https://exemplu.ro', {
			fetchFn: fakeFetch({ 'https://exemplu.ro/': 'throw' })
		});
		expect(r.ok).toBe(false);
		expect(r.pages[0]).toMatchObject({ status: null, problem: 'nu răspunde: The operation timed out.' });
	});
});
