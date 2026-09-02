// Teste pentru providerul scraper — browser FALS injectat, niciun Chromium real.
import { describe, test, expect, beforeEach } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
	buildSerpUrl,
	buildUule,
	fetchSerpScraper,
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
	test('desktop RO: num=100, hl, gl, pws, fără uule când locația e goală', () => {
		const url = buildSerpUrl(baseQuery());
		expect(url.startsWith('https://www.google.ro/search?')).toBe(true);
		expect(url).toContain('num=100');
		expect(url).toContain('hl=ro');
		expect(url).toContain('gl=ro');
		expect(url).toContain('pws=0');
		expect(url).not.toContain('uule=');
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
