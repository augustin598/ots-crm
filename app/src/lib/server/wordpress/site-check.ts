/**
 * "Is the site still up?" after updates, a cache purge or a restore. The
 * connector answering proves PHP loads for REST requests, not that visitors
 * see a page: a theme fatal, a white page or a `.maintenance` file left by an
 * interrupted upgrade only show on the front end. So the CRM server opens the
 * homepage and the first pages of the product sitemap (usually the shop and a
 * product) like a visitor would. Requests go through the site's cache, which
 * was just emptied, so the check also warms it.
 */
import type { SiteCheckOutcome, SiteCheckPage } from '$lib/logic/wordpress-site-check';

const PAGE_TIMEOUT_MS = 20_000;
const UA =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 OTS-CRM-SiteCheck';

/** Product sitemaps: Rank Math / Yoast, then WordPress core. */
const PRODUCT_SITEMAPS = ['/product-sitemap.xml', '/wp-sitemap-posts-product-1.xml'];

/** What is wrong with a page as a visitor gets it, or null when it looks fine. */
export function classifyPage(status: number, body: string): string | null {
	if (/Briefly unavailable for scheduled maintenance|temporar indisponibil pentru mentenan/i.test(body)) {
		return 'blocat în mentenanță (fișierul .maintenance a rămas după update)';
	}
	if (/Error establishing a database connection|Eroare la stabilirea conexiunii cu baza de date/i.test(body)) {
		return 'nu se conectează la baza de date';
	}
	if (/There has been a critical error on (this|your) website|A apărut o eroare critică/i.test(body)) {
		return 'eroare critică PHP (pagina WordPress „critical error")';
	}
	if (/<b>(Fatal|Parse) error<\/b>:/i.test(body)) {
		return 'eroare fatală PHP afișată în pagină';
	}
	if (status >= 400) return `HTTP ${status}`;
	if (body.replace(/<[^>]*>/g, '').trim().length < 50 && body.length < 1000) {
		return 'pagină albă (aproape fără conținut)';
	}
	return null;
}

function sameSite(url: string, siteUrl: string): boolean {
	try {
		const strip = (h: string) => h.replace(/^www\./, '');
		return strip(new URL(url).hostname) === strip(new URL(siteUrl).hostname);
	} catch {
		return false;
	}
}

/** First `limit` distinct `<loc>` URLs of this site in a sitemap. */
export function productUrlsFromSitemap(xml: string, siteUrl: string, limit: number): string[] {
	const out: string[] = [];
	for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
		const url = m[1].replace(/&amp;/g, '&');
		if (!sameSite(url, siteUrl) || out.includes(url)) continue;
		out.push(url);
		if (out.length >= limit) break;
	}
	return out;
}

/** "fetch failed (ENOTFOUND)"-style reason: Bun / undici hide the useful code in `cause`. */
function reason(err: unknown): string {
	if (!(err instanceof Error)) return String(err);
	const cause = err.cause as { code?: string; message?: string } | undefined;
	const detail = cause?.code ?? cause?.message;
	return detail && !err.message.includes(detail) ? `${err.message} (${detail})` : err.message;
}

async function openPage(
	fetchFn: typeof fetch,
	label: string,
	url: string
): Promise<SiteCheckPage> {
	const started = Date.now();
	try {
		const res = await fetchFn(url, {
			headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
			redirect: 'follow',
			signal: AbortSignal.timeout(PAGE_TIMEOUT_MS)
		});
		const body = await res.text();
		return { label, url, status: res.status, ms: Date.now() - started, problem: classifyPage(res.status, body) };
	} catch (err) {
		return {
			label,
			url,
			status: null,
			ms: Date.now() - started,
			problem: `nu răspunde: ${reason(err)}`
		};
	}
}

async function findProductPages(fetchFn: typeof fetch, base: string): Promise<string[]> {
	for (const path of PRODUCT_SITEMAPS) {
		try {
			const res = await fetchFn(`${base}${path}`, {
				headers: { 'User-Agent': UA },
				redirect: 'follow',
				signal: AbortSignal.timeout(PAGE_TIMEOUT_MS)
			});
			if (!res.ok) continue;
			const urls = productUrlsFromSitemap(await res.text(), base, 2);
			if (urls.length > 0) return urls;
		} catch {
			// No sitemap is not a site problem; the homepage still gets checked.
		}
	}
	return [];
}

/** Never throws. `ok` is false as soon as one page has a problem. */
export async function checkSiteOnline(
	siteUrl: string,
	opts: { fetchFn?: typeof fetch } = {}
): Promise<SiteCheckOutcome> {
	const fetchFn = opts.fetchFn ?? fetch;
	const base = siteUrl.replace(/\/+$/, '');
	const pages: SiteCheckPage[] = [await openPage(fetchFn, 'Homepage', `${base}/`)];
	for (const url of await findProductPages(fetchFn, base)) {
		const label = /\/(shop|magazin)\/?$/i.test(new URL(url).pathname) ? 'Magazin' : 'Produs';
		pages.push(await openPage(fetchFn, label, url));
	}
	return { ok: pages.every((p) => p.problem === null), pages };
}
