// Teste pentru providerul scraper — browser FALS injectat, niciun Chromium real.
import { describe, test, expect, beforeEach } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
	buildSerpUrl,
	buildUule,
	fetchSerpScraper,
	createScraperProvider,
	_resetScraperState,
	type BrowserLike,
	type PageLike
} from '../serp-scraper';
import { SerpProviderError, type SerpQuery } from '../types';

const desktopHtml = readFileSync(new URL('./fixtures/serp-desktop.html', import.meta.url), 'utf8');
const captchaHtml = readFileSync(new URL('./fixtures/serp-captcha.html', import.meta.url), 'utf8');

const baseQuery = (over: Partial<SerpQuery> = {}): SerpQuery => ({
	keyword: 'agentie seo bucuresti',
	device: 'desktop',
	googleDomain: 'google.ro',
	hl: 'ro',
	gl: 'ro',
	location: '',
	depth: 100,
	...over
});

interface Recorder {
	launchArgs: string[] | null;
	gotoUrls: string[];
	ua: string | null;
	viewport: { width: number; height: number; isMobile?: boolean; hasTouch?: boolean } | null;
	cookies: Array<Record<string, unknown>>;
	pageClosed: number;
	browserClosed: boolean;
}

function fakeBrowser(
	html: string,
	opts: { gotoError?: () => never; recorder: Recorder }
): BrowserLike {
	const rec = opts.recorder;
	const page: PageLike = {
		async setUserAgent(ua) {
			rec.ua = ua;
		},
		async setViewport(v) {
			rec.viewport = v;
		},
		async setExtraHTTPHeaders() {},
		async setCookie(...cookies) {
			rec.cookies.push(...cookies);
		},
		async evaluateOnNewDocument() {},
		async goto(url) {
			rec.gotoUrls.push(url);
			if (opts.gotoError) opts.gotoError();
			return null;
		},
		async content() {
			return html;
		},
		async close() {
			rec.pageClosed++;
		}
	};
	return {
		async newPage() {
			return page;
		},
		async close() {
			rec.browserClosed = true;
		}
	};
}

function newRecorder(): Recorder {
	return {
		launchArgs: null,
		gotoUrls: [],
		ua: null,
		viewport: null,
		cookies: [],
		pageClosed: 0,
		browserClosed: false
	};
}

beforeEach(() => _resetScraperState());

describe('buildSerpUrl — parametrii Google', () => {
	test('desktop RO: hl, gl, pws, FĂRĂ num, fără uule când locația e goală', () => {
		const url = buildSerpUrl(baseQuery());
		expect(url.startsWith('https://www.google.ro/search?')).toBe(true);
		// `num=100` a fost scos: MĂSURAT pe google.ro (2 sep. 2026) — cu `&num=100` Google
		// întoarce 429 → /sorry/, fără el întoarce 200 cu rezultate. Adâncimea vine din
		// paginarea `&start=`.
		expect(url).not.toContain('num=');
		expect(url).toContain('hl=ro');
		expect(url).toContain('gl=ro');
		expect(url).toContain('pws=0');
		expect(url).not.toContain('uule=');
		expect(url).not.toContain('start=');
	});

	test('paginare: start=0 nu apare în URL, start=20 apare', () => {
		expect(buildSerpUrl(baseQuery(), 0)).not.toContain('start=');
		expect(buildSerpUrl(baseQuery(), 20)).toContain('start=20');
	});

	test('cu locație → conține uule', () => {
		const url = buildSerpUrl(baseQuery({ location: 'București,România' }));
		expect(url).toContain('uule=');
	});
});

describe('buildUule', () => {
	test('începe cu prefixul canonic și conține base64 al locației', () => {
		const loc = 'București,România';
		const uule = buildUule(loc);
		expect(uule.startsWith('w+CAIQICI')).toBe(true);
		expect(uule).toContain(Buffer.from(loc, 'utf8').toString('base64'));
	});
});

describe('fetchSerpScraper — emulare dispozitiv', () => {
	test('mobil → viewport 390×844 + UA Android', async () => {
		const rec = newRecorder();
		await fetchSerpScraper(baseQuery({ device: 'mobile' }), 'example.ro', {
			browser: fakeBrowser(desktopHtml, { recorder: rec }),
			sleep: async () => {},
			env: {},
			jitter: () => 0
		});
		expect(rec.viewport).toMatchObject({ width: 390, height: 844, isMobile: true, hasTouch: true });
		expect(rec.ua).toContain('Android');
		expect(rec.ua).toContain('Mobile');
	});

	test('desktop → viewport 1366×768 + UA desktop', async () => {
		const rec = newRecorder();
		await fetchSerpScraper(baseQuery(), 'example.ro', {
			browser: fakeBrowser(desktopHtml, { recorder: rec }),
			sleep: async () => {},
			env: {},
			jitter: () => 0
		});
		expect(rec.viewport).toMatchObject({ width: 1366, height: 768 });
		expect(rec.ua).not.toContain('Mobile');
		expect(rec.ua).toContain('Windows');
	});

	test('setează cookie-urile de consimțământ pe domeniul Google', async () => {
		const rec = newRecorder();
		await fetchSerpScraper(baseQuery(), 'example.ro', {
			browser: fakeBrowser(desktopHtml, { recorder: rec }),
			sleep: async () => {},
			env: {},
			jitter: () => 0
		});
		expect(rec.cookies.some((c) => c.name === 'SOCS' && c.domain === '.google.ro')).toBe(true);
		expect(rec.cookies.some((c) => c.name === 'CONSENT')).toBe(true);
	});
});

describe('fetchSerpScraper — parsare + erori', () => {
	test('HTML valid → SerpResult cu 11 organice (parserul e legat)', async () => {
		const rec = newRecorder();
		const r = await fetchSerpScraper(baseQuery(), 'example.ro', {
			browser: fakeBrowser(desktopHtml, { recorder: rec }),
			sleep: async () => {},
			env: {},
			jitter: () => 0
		});
		expect(r.organic.length).toBe(11);
		expect(rec.gotoUrls.length).toBe(1);
		expect(rec.pageClosed).toBe(1);
	});

	test('CAPTCHA → SerpProviderError blocked, neretryable, fără retry', async () => {
		const rec = newRecorder();
		let err: unknown;
		try {
			await fetchSerpScraper(baseQuery(), 'example.ro', {
				browser: fakeBrowser(captchaHtml, { recorder: rec }),
				sleep: async () => {},
				env: {},
				jitter: () => 0
			});
		} catch (e) {
			err = e;
		}
		expect(err).toBeInstanceOf(SerpProviderError);
		expect((err as SerpProviderError).kind).toBe('blocked');
		expect((err as SerpProviderError).retryable).toBe(false);
		expect(rec.gotoUrls.length).toBe(1); // fără retry
	});

	test('pagină fără organice (neblocată) → eroare parse, fără retry', async () => {
		const rec = newRecorder();
		let err: unknown;
		try {
			await fetchSerpScraper(baseQuery(), 'example.ro', {
				browser: fakeBrowser('<html><body><div id="search"></div></body></html>', { recorder: rec }),
				sleep: async () => {},
				env: {},
				jitter: () => 0
			});
		} catch (e) {
			err = e;
		}
		expect((err as SerpProviderError).kind).toBe('parse');
		expect(rec.gotoUrls.length).toBe(1);
	});

	test('timeout la navigare → retryable, reîncearcă de 3 ori apoi aruncă', async () => {
		const rec = newRecorder();
		const sleeps: number[] = [];
		const timeoutErr = () => {
			const e = new Error('Navigation timeout of 45000 ms exceeded');
			e.name = 'TimeoutError';
			throw e;
		};
		let err: unknown;
		try {
			await fetchSerpScraper(baseQuery(), 'example.ro', {
				browser: fakeBrowser(desktopHtml, { recorder: rec, gotoError: timeoutErr }),
				sleep: async (ms) => {
					sleeps.push(ms);
				},
				env: {},
				jitter: () => 0
			});
		} catch (e) {
			err = e;
		}
		expect((err as SerpProviderError).kind).toBe('timeout');
		expect(rec.gotoUrls.length).toBe(3); // 1 + 2 reîncercări
		expect(sleeps.length).toBeGreaterThanOrEqual(3); // pacing + 2 backoff-uri
		expect(rec.pageClosed).toBe(3);
	});
});

describe('fetchSerpScraper — pacing, proxy, cleanup', () => {
	test('pacing: sleep apelat cu ≥ RANK_PACE_MS', async () => {
		const rec = newRecorder();
		const sleeps: number[] = [];
		await fetchSerpScraper(baseQuery(), 'example.ro', {
			browser: fakeBrowser(desktopHtml, { recorder: rec }),
			sleep: async (ms) => {
				sleeps.push(ms);
			},
			env: { RANK_PACE_MS: '1000' },
			jitter: () => 0
		});
		expect(sleeps.some((ms) => ms >= 1000)).toBe(true);
	});

	test('proxy: primul launch primește --proxy-server cu primul proxy', async () => {
		const rec = newRecorder();
		await fetchSerpScraper(baseQuery(), 'example.ro', {
			launch: async ({ args }) => {
				rec.launchArgs = args;
				return fakeBrowser(desktopHtml, { recorder: rec });
			},
			sleep: async () => {},
			env: { RANK_PROXY_URLS: 'http://p1:8080,http://p2:8080' },
			jitter: () => 0
		});
		expect(rec.launchArgs).toContain('--proxy-server=http://p1:8080');
		expect(rec.browserClosed).toBe(true); // browser propriu → închis
	});

	test('browser propriu se închide chiar și la eroare', async () => {
		const rec = newRecorder();
		try {
			await fetchSerpScraper(baseQuery(), 'example.ro', {
				launch: async () => fakeBrowser(captchaHtml, { recorder: rec }),
				sleep: async () => {},
				env: {},
				jitter: () => 0
			});
		} catch {
			/* așteptat */
		}
		expect(rec.browserClosed).toBe(true);
		expect(rec.pageClosed).toBe(1);
	});

	test('browser injectat (partajat) NU se închide', async () => {
		const rec = newRecorder();
		await fetchSerpScraper(baseQuery(), 'example.ro', {
			browser: fakeBrowser(desktopHtml, { recorder: rec }),
			sleep: async () => {},
			env: {},
			jitter: () => 0
		});
		expect(rec.browserClosed).toBe(false);
	});
});

describe('createScraperProvider — sesiune persistată', () => {
	test('la blocare, sesiunea salvată se ARUNCĂ (profil ars)', async () => {
		const rec = newRecorder();
		let cleared = 0;
		const provider = createScraperProvider({
			launch: async () => fakeBrowser(captchaHtml, { recorder: rec }),
			sleep: async () => {},
			env: {},
			jitter: () => 0,
			loadSession: async () => null,
			saveSession: async () => {},
			clearSession: async () => {
				cleared++;
			}
		});
		await expect(provider.fetchSerp(baseQuery(), 'example.ro')).rejects.toThrow();
		expect(cleared).toBe(1);
		await provider.close?.();
	});

	test('warm-up-ul folosește cookie-urile sesiunii precedente, dacă există', async () => {
		const rec = newRecorder();
		const savedCookies = [{ name: 'NID', value: 'sesiune-veche', domain: '.google.ro', path: '/' }];
		const provider = createScraperProvider({
			launch: async () => fakeBrowser(desktopHtml, { recorder: rec }),
			sleep: async () => {},
			env: {},
			jitter: () => 0,
			loadSession: async () => savedCookies,
			saveSession: async () => {}
		});
		await provider.fetchSerp(baseQuery(), 'example.ro');
		expect(rec.cookies.some((c) => c.name === 'NID')).toBe(true);
		await provider.close?.();
	});
});

describe('createScraperProvider — browser partajat pe rulare', () => {
	test('lansează UN singur browser pentru mai multe interogări, închis prin close()', async () => {
		const rec = newRecorder();
		let launches = 0;
		const provider = createScraperProvider({
			launch: async ({ args }) => {
				launches++;
				rec.launchArgs = args;
				return fakeBrowser(desktopHtml, { recorder: rec });
			},
			sleep: async () => {},
			env: {},
			jitter: () => 0
		});

		await provider.fetchSerp(baseQuery({ keyword: 'a' }), 'example.ro');
		await provider.fetchSerp(baseQuery({ keyword: 'b', device: 'mobile' }), 'example.ro');
		await provider.fetchSerp(baseQuery({ keyword: 'c' }), 'example.ro');

		expect(launches).toBe(1); // un singur browser pentru 3 interogări
		// 3 pagini de căutare + 1 pagină de WARM-UP (homepage-ul Google la lansare, care
		// primește cookie-urile de sesiune) — toate închise după folosire.
		expect(rec.pageClosed).toBe(4);
		expect(rec.gotoUrls[0]).toBe('https://www.google.ro/'); // warm-up ÎNAINTEA primei căutări
		expect(rec.browserClosed).toBe(false); // nu se închide între interogări

		await provider.close?.();
		expect(rec.browserClosed).toBe(true); // închis explicit la final
	});
});

/* ─────────────────────────────────────────────────────────────────────────────
 * Paginare — regresii găsite la auditul din 2 sep. 2026. Google NU întoarce fix
 * 10 organice pe pagină (măsurat: între 7 și 17), iar codul presupunea că da.
 * ────────────────────────────────────────────────────────────────────────────*/

/** Construiește o pagină SERP cu `n` rezultate organice, opțional cu ținta la un index. */
function serpPage(n: number, opts: { target?: number; feature?: string } = {}): string {
	const rows = Array.from({ length: n }, (_, i) => {
		const isTarget = opts.target === i;
		const host = isTarget ? 'tinta.ro' : `site-${i}.ro`;
		return `<div class="g"><a href="https://${host}/p${i}"><h3>Rezultat ${i} de pe ${host}</h3></a><cite>https://${host}/p${i}</cite></div>`;
	}).join('');
	const feature = opts.feature === 'ads' ? '<div id="tads">reclame</div>' : '';
	return `<html><body>${feature}<div id="rso">${rows}</div></body></html>`;
}

/** Browser fals care servește alt HTML per pagină, după parametrul `start` din URL. */
function pagedBrowser(pages: (string | (() => never))[], rec: Recorder): BrowserLike {
	let current: string | (() => never) = pages[0];
	const page: PageLike = {
		async setUserAgent(ua) { rec.ua = ua; },
		async setViewport(v) { rec.viewport = v; },
		async setExtraHTTPHeaders() {},
		async setCookie(...c) { rec.cookies.push(...c); },
		async evaluateOnNewDocument() {},
		async goto(url) {
			rec.gotoUrls.push(url);
			const start = Number(new URL(url).searchParams.get('start') ?? '0');
			current = pages[start / 10] ?? serpPage(0);
			return null;
		},
		url() { return 'https://www.google.ro/search'; },
		async content() {
			if (typeof current === 'function') current();
			return current as string;
		},
		async close() { rec.pageClosed++; }
	};
	return { async newPage() { return page; }, async close() { rec.browserClosed = true; } };
}

const runPaged = (pages: (string | (() => never))[], over: Partial<SerpQuery> = {}) => {
	const rec = newRecorder();
	return {
		rec,
		promise: fetchSerpScraper(baseQuery({ depth: 30, ...over }), 'tinta.ro', {
			browser: pagedBrowser(pages, rec),
			sleep: async () => {},
			env: {},
			jitter: () => 0
		})
	};
};

describe('fetchSerpScraper — paginare', () => {
	test('o pagină scurtă NU oprește căutarea (ținta e pe pagina 3)', async () => {
		// 9 rezultate pe pagina 1: cu vechiul `length < 10` căutarea se oprea aici și
		// ținta era raportată drept „în afara top 100" → alertă falsă de „lost".
		const { rec, promise } = runPaged([serpPage(9), serpPage(10), serpPage(10, { target: 4 })]);
		const r = await promise;
		expect(rec.gotoUrls.length).toBe(3);
		const target = r.organic.find((o) => o.domain === 'tinta.ro');
		expect(target).toBeDefined();
		expect(target!.position).toBe(24); // 9 + 10 + al 5-lea de pe pagina 3
	});

	test('pozițiile rămân unice și contigue când paginile au dimensiuni diferite', async () => {
		// Cu offset fix `pageIndex * 10`, o pagină de 17 producea poziții duplicate.
		const r = await runPaged([serpPage(17), serpPage(9), serpPage(10)]).promise;
		const positions = r.organic.map((o) => o.position);
		expect(new Set(positions).size).toBe(positions.length);
		expect(positions).toEqual(Array.from({ length: positions.length }, (_, i) => i + 1));
	});

	test('se oprește imediat ce găsește ținta', async () => {
		const { rec, promise } = runPaged([serpPage(10), serpPage(10, { target: 2 }), serpPage(10)]);
		const r = await promise;
		expect(rec.gotoUrls.length).toBe(2);
		expect(r.organic.find((o) => o.domain === 'tinta.ro')!.position).toBe(13);
	});

	test('respectă `depth` în REZULTATE, nu în pagini', async () => {
		const r = await runPaged([serpPage(17), serpPage(17)], { depth: 20 }).promise;
		expect(r.organic.length).toBe(20);
		expect(r.organic.at(-1)!.position).toBe(20);
	});

	test('feature-urile vin DOAR de pe pagina 1', async () => {
		const r = await runPaged([serpPage(10), serpPage(10), serpPage(10, { feature: 'ads' })]).promise;
		expect(r.features).not.toContain('ads');
	});

	test('pagină plină urmată de una goală = eroare, NU „s-au terminat rezultatele"', async () => {
		// Altfel un soft-block pe pagina 2 s-ar raporta ca „ținta nu e în top 30" și ar
		// scrie un snapshot null → alertă falsă de „lost".
		const { promise } = runPaged([serpPage(10), serpPage(0)]);
		await expect(promise).rejects.toThrow();
	});

	test('pagină scurtă urmată de una goală = final normal de rezultate', async () => {
		const r = await runPaged([serpPage(7), serpPage(0)]).promise;
		expect(r.organic.length).toBe(7);
	});
});
