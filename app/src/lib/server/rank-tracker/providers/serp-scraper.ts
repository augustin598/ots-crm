// Provider SERP in-house: puppeteer-core + Chromium de sistem (CHROME_PATH în prod).
// Construiește URL-ul Google (num=100, hl/gl, uule pentru locație), emulează
// desktop/mobil, setează cookie-urile de consimțământ, aplică stealth manual,
// paceuiește cererile și clasifică erorile (blocat/timeout/parse). Toate
// dependențele externe (launch, sleep, env) sunt injectabile → testabil fără browser.
// Modelul de stealth/launch e preluat din scraper/cloudflare-bypass.ts.
import { findChromePath } from '$lib/server/scraper/find-chrome';
import { detectBlocked, matchDomain, parseSerpHtml } from './serp-parser';
import { SerpProviderError, type SerpQuery, type SerpResult, type SerpProvider } from './types';

const DEFAULT_PACE_MS = 8000;
const NAV_TIMEOUT_MS = 45_000;
const MAX_RETRIES = 2; // 1 încercare + 2 reîncercări = 3 total

// ── Tipuri minime de browser (compatibile puppeteer-core, dar injectabile) ──
export interface PageLike {
	setUserAgent(ua: string): Promise<void>;
	setViewport(v: {
		width: number;
		height: number;
		isMobile?: boolean;
		hasTouch?: boolean;
	}): Promise<void>;
	setExtraHTTPHeaders(h: Record<string, string>): Promise<void>;
	setCookie(...cookies: Array<Record<string, unknown>>): Promise<void>;
	evaluateOnNewDocument(fn: (...a: unknown[]) => unknown): Promise<void>;
	goto(url: string, opts: { waitUntil?: string; timeout?: number }): Promise<unknown>;
	/** Cookie-urile contextului — opțional, pentru persistarea sesiunii între rulări. */
	cookies?(...urls: string[]): Promise<Array<Record<string, unknown>>>;
	content(): Promise<string>;
	/** URL-ul final după redirecturi; opțional ca să nu rupem dublurile din teste. */
	url?(): string;
	close(): Promise<void>;
}
export interface BrowserLike {
	newPage(): Promise<PageLike>;
	close(): Promise<void>;
}
export type LaunchFn = (opts: { args: string[] }) => Promise<BrowserLike>;

export interface ScraperDeps {
	/** Lansează un browser; implicit puppeteer-core cu Chromium de sistem. */
	launch?: LaunchFn;
	/** Un browser deja deschis (partajat de runner); dacă e dat, NU se închide aici. */
	browser?: BrowserLike;
	sleep?: (ms: number) => Promise<void>;
	env?: Record<string, string | undefined>;
	/** Jitter 0..1 (implicit aleator) — injectabil pentru determinism în teste. */
	jitter?: () => number;
	/**
	 * Persistarea sesiunii Google între rulări (cookie-urile NID/AEC primite de la
	 * Google la warm-up). O sesiune „încălzită" care revine zilnic arată ca un
	 * utilizator recurent, nu ca un browser proaspăt — una dintre puținele pârghii
	 * gratuite reale contra blocării. Implementarea reală e în resolve.ts (Redis).
	 */
	loadSession?: () => Promise<Array<Record<string, unknown>> | null>;
	saveSession?: (cookies: Array<Record<string, unknown>>) => Promise<void>;
	/** Aruncă sesiunea salvată — apelat la blocare, ca să nu cărăm un profil ars. */
	clearSession?: () => Promise<void>;
}

// Contor round-robin pentru proxy-uri, la nivel de proces.
let proxyCounter = 0;
/** Doar pentru teste: resetează starea la nivel de modul. */
export function _resetScraperState(): void {
	proxyCounter = 0;
}

/**
 * Amprenta se alege O DATĂ per lansare de browser și rămâne consecventă pe toată
 * rularea (UA + viewport care se contrazic între cereri sunt ele însele un semnal).
 * Între rulări variază — un „utilizator" ușor diferit în fiecare zi.
 */
const DESKTOP_FINGERPRINTS = [
	{ ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36', width: 1366, height: 768 },
	{ ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36', width: 1536, height: 864 },
	{ ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36', width: 1440, height: 900 },
	{ ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', width: 1680, height: 1050 }
];
let sessionFp = DESKTOP_FINGERPRINTS[0];
function pickFingerprint(jitter: () => number): void {
	sessionFp = DESKTOP_FINGERPRINTS[Math.floor(jitter() * DESKTOP_FINGERPRINTS.length) % DESKTOP_FINGERPRINTS.length];
}
const UA_MOBILE =
	'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';

// Alfabetul base64url folosit de UULE pentru caracterul de lungime.
const UULE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Codificarea UULE v2 pe nume canonic de locație:
 * „w+CAIQICI" + caracterul de lungime (alfabet[len % 64]) + base64(locație).
 * Google acceptă numele canonic („Oraș,Județ,Țara") pentru geolocalizarea SERP.
 */
export function buildUule(location: string): string {
	// Caracterul de lungime folosește numărul de OCTEȚI UTF-8, nu lungimea în code-uniți
	// UTF-16 — contează la diacritice (ș, â, î ocupă 2 octeți).
	const byteLen = Buffer.byteLength(location, 'utf8');
	const lengthChar = UULE_ALPHABET[byteLen % 64];
	const b64 = Buffer.from(location, 'utf8').toString('base64');
	return `w+CAIQICI${lengthChar}${b64}`;
}

/** Câte rezultate întoarce Google pe o pagină de căutare (fără `num`). */
export const RESULTS_PER_PAGE = 10;

/**
 * URL-ul de căutare Google pentru o PAGINĂ de rezultate (hl/gl, pws=0, uule opțional).
 *
 * `num=100` a fost SCOS intenționat: MĂSURAT pe google.ro (2 sep. 2026), cu exact
 * același browser și aceeași amprentă, `&num=100` întoarce **HTTP 429 → /sorry/**
 * (blocare imediată), iar aceeași interogare fără `num` întoarce **200 cu rezultate**.
 * Adâncimea se obține prin paginare `&start=0,10,20…` (vezi `fetchSerpScraper`).
 */
export function buildSerpUrl(q: SerpQuery, start = 0): string {
	const params = new URLSearchParams({
		q: q.keyword,
		hl: q.hl,
		gl: q.gl,
		pws: '0'
	});
	if (start > 0) params.set('start', String(start));
	if (q.location) params.set('uule', buildUule(q.location));
	return `https://www.${q.googleDomain}/search?${params.toString()}`;
}

function pickProxy(proxies: string[]): string | null {
	if (proxies.length === 0) return null;
	const p = proxies[proxyCounter % proxies.length];
	proxyCounter++;
	return p;
}

function isTimeoutError(e: unknown): boolean {
	const name = (e as { name?: string })?.name ?? '';
	const msg = (e as { message?: string })?.message ?? '';
	return name === 'TimeoutError' || /timeout/i.test(msg);
}

async function defaultLaunch(opts: { args: string[] }): Promise<BrowserLike> {
	const puppeteer = (await import('puppeteer-core')).default;
	return (await puppeteer.launch({
		headless: true,
		executablePath: findChromePath(),
		args: opts.args
	})) as unknown as BrowserLike;
}

/**
 * Argumentele de lansare. `--disable-blink-features=AutomationControlled` e OBLIGATORIU:
 * MĂSURAT pe google.ro (2 sep. 2026) — fără el, aceeași interogare simplă primește
 * **HTTP 429 → /sorry/** din prima, cu el întoarce **200 cu rezultate**.
 */
const BASE_LAUNCH_ARGS = [
	'--no-sandbox',
	'--disable-setuid-sandbox',
	'--disable-dev-shm-usage',
	'--disable-gpu',
	'--disable-extensions',
	'--disable-background-networking',
	'--disable-sync',
	'--no-first-run',
	'--disable-blink-features=AutomationControlled'
];

function proxiesFromEnv(env: Record<string, string | undefined>): string[] {
	return (env.RANK_PROXY_URLS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

async function preparePage(page: PageLike, q: SerpQuery): Promise<void> {
	if (q.device === 'mobile') {
		await page.setUserAgent(UA_MOBILE);
		await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
	} else {
		await page.setUserAgent(sessionFp.ua);
		await page.setViewport({ width: sessionFp.width, height: sessionFp.height });
	}
	// `webdriver` trebuie să fie UNDEFINED, nu `false`: proprietatea prezentă cu valoarea
	// `false` e ea însăși un semnal de automatizare. Plus limbi și plugin-uri, altfel
	// amprenta rămâne una evident de headless.
	await page.evaluateOnNewDocument(() => {
		Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
		Object.defineProperty(navigator, 'languages', { get: () => ['ro-RO', 'ro', 'en-US'] });
		Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
		// Chrome real are window.chrome cu runtime/loadTimes; headless-ul nu — semnal clasic.
		const w = window as unknown as Record<string, unknown>;
		if (!w.chrome) w.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}) };
		// Chrome real răspunde la query({name:'notifications'}) cu starea permisiunii,
		// headless-ul răspunde altfel — al doilea semnal clasic.
		try {
			const perms = navigator.permissions;
			const orig = perms.query.bind(perms);
			perms.query = ((params: { name: string }) =>
				params.name === 'notifications'
					? Promise.resolve({ state: Notification.permission } as PermissionStatus)
					: orig(params as PermissionDescriptor)) as typeof perms.query;
		} catch {
			/* mediu fără Permissions API */
		}
	});
	await page.setExtraHTTPHeaders({
		'Accept-Language': `${q.hl}-${q.gl.toUpperCase()},${q.hl};q=0.9,en;q=0.8`,
		// Un om ajunge la /search de pe homepage, nu din senin.
		Referer: `https://www.${q.googleDomain}/`
	});
	// Cookie-uri de consimțământ ca să sărim peste peretele „Înainte de a continua".
	// SOCS = token de accept al consimțământului; CONSENT=YES+ = varianta legacy.
	const cookieDomain = `.${q.googleDomain}`;
	await page.setCookie(
		{ name: 'SOCS', value: 'CAISNQgQEitib3', domain: cookieDomain, path: '/' },
		{ name: 'CONSENT', value: 'YES+', domain: cookieDomain, path: '/' }
	);
}

/** O SINGURĂ pagină de rezultate (`start` = offsetul paginării). */
async function attemptOnce(
	browser: BrowserLike,
	q: SerpQuery,
	targetDomain: string,
	start = 0
): Promise<SerpResult> {
	const page = await browser.newPage();
	try {
		await preparePage(page, q);
		try {
			await page.goto(buildSerpUrl(q, start), {
				waitUntil: 'domcontentloaded',
				timeout: NAV_TIMEOUT_MS
			});
		} catch (e) {
			if (isTimeoutError(e)) throw new SerpProviderError('timeout la navigare', 'timeout', true);
			throw new SerpProviderError('eroare de rețea la navigare', 'network', true);
		}
		// Redirectul real către interstițiu se vede pe URL-ul final; în HTML NU (pagina
		// de CAPTCHA e servită chiar cu status 200 și fără „/sorry/" în corp).
		const finalUrl = page.url?.() ?? '';
		if (finalUrl.includes('/sorry/')) {
			throw new SerpProviderError('blocat de Google (redirect /sorry/)', 'blocked', false);
		}
		const html = await page.content();
		if (detectBlocked(html)) {
			throw new SerpProviderError('blocat de Google (CAPTCHA)', 'blocked', false);
		}
		const result = parseSerpHtml(html, { targetDomain, competitors: [], startOffset: start });
		// Anti-„lost fals": pagină nedetectată ca blocată, dar cu 0 organice = selector rupt.
		if (result.organic.length === 0) {
			throw new SerpProviderError('0 rezultate organice — selector posibil rupt', 'parse', false);
		}
		return result;
	} finally {
		await page.close().catch(() => {});
	}
}

/** Rulează o interogare SERP prin scraper, cu pacing, retry și clasificare de erori. */
export async function fetchSerpScraper(
	q: SerpQuery,
	targetDomain: string,
	deps: ScraperDeps = {}
): Promise<SerpResult> {
	const env = deps.env ?? (process.env as Record<string, string | undefined>);
	const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
	const jitter = deps.jitter ?? Math.random;
	const paceMs = Number(env.RANK_PACE_MS ?? DEFAULT_PACE_MS) || DEFAULT_PACE_MS;
	const proxies = (env.RANK_PROXY_URLS ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);

	// Pacing cu jitter PUTERNIC (pace..2×pace): intervalele cvasi-constante sunt ele
	// însele un tipar de robot; variația mare imită un om care citește între căutări.
	await sleep(paceMs + Math.floor(jitter() * paceMs));

	const ownBrowser = !deps.browser;
	let browser: BrowserLike;
	if (deps.browser) {
		browser = deps.browser;
	} else {
		// O SINGURĂ sursă de adevăr pentru argumente: lista era duplicată aici și nu primea
		// flagurile de stealth adăugate în `BASE_LAUNCH_ARGS`, așa că orice apel fără browser
		// partajat (ex. proba din `_debug-rank-health`) pornea un Chromium detectabil.
		const args = [...BASE_LAUNCH_ARGS];
		const proxy = pickProxy(proxies);
		if (proxy) args.push(`--proxy-server=${proxy}`);
		const launch = deps.launch ?? defaultLaunch;
		browser = await launch({ args });
	}

	/** O pagină, cu reîncercări pe erorile tranzitorii. */
	async function pageWithRetries(start: number): Promise<SerpResult> {
		let lastErr: unknown;
		for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
			try {
				return await attemptOnce(browser, q, targetDomain, start);
			} catch (e) {
				lastErr = e;
				const retryable = e instanceof SerpProviderError ? e.retryable : true;
				if (!retryable || attempt === MAX_RETRIES) throw e;
				const backoff = 500 * 2 ** attempt;
				await sleep(backoff + Math.floor(jitter() * 250));
			}
		}
		throw lastErr;
	}

	try {
		// Paginare `&start=`: mergem din 10 în 10 până găsim domeniul țintă sau atingem
		// adâncimea cerută. Ne oprim imediat ce ținta e găsită — fiecare pagină în plus e
		// o cerere în plus către Google, adică risc de blocare.
		const maxPages = Math.max(1, Math.ceil(q.depth / RESULTS_PER_PAGE));
		const merged: SerpResult = {
			organic: [],
			features: [],
			aiOverview: 'absent',
			raw: { blocked: false }
		};
		let lastPageWasShort = false;
		for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
			// `&start=` e offsetul CERUT lui Google (multiplu de 10), dar poziția atribuită
			// rezultatelor e rangul lor real în lista deja adunată. Nu presupunem că o pagină
			// întoarce exact 10 organice — MĂSURAT: între 7 și 17 (Google amestecă module
			// non-organice în aceleași containere). Cu `pageIndex * 10` ca offset, o pagină
			// de 17 producea poziții DUPLICATE, iar una de 9 lăsa o gaură.
			const start = pageIndex * RESULTS_PER_PAGE;
			let page: SerpResult;
			try {
				page = await pageWithRetries(start);
			} catch (e) {
				if (pageIndex === 0) throw e;
				// „parse" = 0 organice. Înseamnă „s-au terminat rezultatele" DOAR dacă pagina
				// precedentă era deja scurtă. O pagină plină urmată de una goală e suspectă
				// (soft-block sau layout schimbat) — atunci aruncăm, ca să nu raportăm „100+"
				// pentru un site pe care de fapt nu l-am căutat până la capăt.
				if (e instanceof SerpProviderError && e.kind === 'parse' && lastPageWasShort) break;
				throw e;
			}
			// Renumerotăm în funcție de câte rezultate avem deja, nu de offsetul cerut.
			for (const o of page.organic) {
				merged.organic.push({ ...o, position: merged.organic.length + 1 });
			}
			// Feature-urile și AI Overview descriu SERP-ul pe care îl vede utilizatorul: pagina 1.
			// (Nu le acumulăm de pe paginile următoare — altfel un cuvânt ar arăta chips-uri
			// de pe pagina 3, pe care nimeni nu o vede.)
			if (pageIndex === 0) {
				merged.aiOverview = page.aiOverview;
				merged.features = [...page.features];
			}
			if (merged.organic.some((o) => matchDomain(o.url, targetDomain))) break; // țintă găsită
			lastPageWasShort = page.organic.length < RESULTS_PER_PAGE;
			if (pageIndex < maxPages - 1) await sleep(paceMs + Math.floor(jitter() * paceMs));
		}
		// Adâncimea cerută e în REZULTATE, nu în pagini: o pagină generoasă nu trebuie să
		// raporteze poziții peste `depth`.
		merged.organic = merged.organic.slice(0, q.depth);
		return merged;
	} finally {
		if (ownBrowser) await browser.close().catch(() => {});
	}
}

/**
 * Providerul scraper ca `SerpProvider`, cu UN SINGUR browser partajat pe toată
 * durata folosirii (o rulare de proiect): lansat leneș la prima interogare, refolosit
 * la fiecare (keyword × device), închis prin `close()`. Evită overhead-ul și zombie-urile
 * unui browser-per-request. Dacă `deps.browser` e dat explicit, acela e folosit.
 */
export function createScraperProvider(deps: ScraperDeps = {}): SerpProvider {
	const env = deps.env ?? (process.env as Record<string, string | undefined>);
	const launch = deps.launch ?? defaultLaunch;
	const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
	const jitter = deps.jitter ?? Math.random;
	let shared: BrowserLike | null = null;
	let queriesInSession = 0;

	/**
	 * Warm-up: vizităm homepage-ul Google ÎNAINTE de prima căutare, cu cookie-urile
	 * sesiunii precedente (dacă există). Google emite/reînnoiește NID & co. pe context,
	 * iar căutările ulterioare vin dintr-o „sesiune de utilizator recurent", nu dintr-un
	 * browser văzut acum prima oară — exact diferența care ne tăia după ~15-20 de cereri.
	 */
	async function warmUp(browser: BrowserLike): Promise<void> {
		const page = await browser.newPage();
		try {
			await page.setUserAgent(sessionFp.ua);
			await page.setViewport({ width: sessionFp.width, height: sessionFp.height });
			const saved = await deps.loadSession?.().catch(() => null);
			if (saved?.length) {
				await page.setCookie(...saved);
			} else {
				await page.setCookie(
					{ name: 'SOCS', value: 'CAISNQgQEitib3', domain: '.google.ro', path: '/' },
					{ name: 'CONSENT', value: 'YES+', domain: '.google.ro', path: '/' }
				);
			}
			await page.goto('https://www.google.ro/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
			await sleep(1200 + Math.floor(jitter() * 1800));
			const cookies = await page.cookies?.('https://www.google.ro/');
			if (cookies?.length) await deps.saveSession?.(cookies).catch(() => {});
		} catch {
			// Warm-up-ul e best-effort: dacă pică, căutările merg pe calea veche.
		} finally {
			await page.close().catch(() => {});
		}
	}

	async function ensureBrowser(): Promise<BrowserLike> {
		if (shared) return shared;
		pickFingerprint(jitter);
		const args = [...BASE_LAUNCH_ARGS];
		const proxy = pickProxy(proxiesFromEnv(env));
		if (proxy) args.push(`--proxy-server=${proxy}`);
		shared = await launch({ args });
		await warmUp(shared);
		return shared;
	}

	return {
		name: 'scraper',
		fetchSerp: async (q, targetDomain) => {
			const browser = deps.browser ?? (await ensureBrowser());
			// „Pauză de cafea": la fiecare 8-12 interogări, 45-90 s de liniște. Un om nu
			// caută 26 de lucruri în cadență constantă — roboții da, și exact asta se vede.
			queriesInSession++;
			if (queriesInSession > 1 && queriesInSession % (8 + Math.floor(jitter() * 5)) === 0) {
				await sleep(45_000 + Math.floor(jitter() * 45_000));
			}
			try {
				// Trecem browserul partajat prin deps → fetchSerpScraper nu-l închide.
				return await fetchSerpScraper(q, targetDomain, { ...deps, browser });
			} catch (e) {
				// Blocare = profilul sesiunii e ars; nu-l mai cărăm în rularea de mâine.
				if (e instanceof SerpProviderError && e.kind === 'blocked') {
					await deps.clearSession?.().catch(() => {});
				}
				throw e;
			}
		},
		close: async () => {
			if (shared) {
				await shared.close().catch(() => {});
				shared = null;
				queriesInSession = 0;
			}
		}
	};
}
