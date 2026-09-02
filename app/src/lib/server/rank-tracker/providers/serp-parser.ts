// Parser SERP PUR: string HTML (de la orice provider care întoarce pagina Google)
// → obiect structurat. Fără rețea, fără DB, fără DOM de browser — folosește
// node-html-parser (deja în dependențe). Selectoarele sunt DEFENSIVE: mai multe
// strategii, tolerante la piese lipsă, nu aruncă niciodată pe o pagină normală.
// Aruncatul pe pagină goală/blocată e treaba stratului provider (Task 4/6).
import { parse, type HTMLElement } from 'node-html-parser';
import { isPlausibleHost } from '$lib/logic/rank-tracker';
import type { SerpResult, SerpOrganicResult } from './types';

/** Hostul unui URL, lowercase și fără „www."; null dacă URL-ul e malformat. */
function hostOf(rawUrl: string): string | null {
	if (!rawUrl) return null;
	let u = rawUrl.trim();
	if (u.startsWith('//')) u = 'https:' + u;
	try {
		const host = new URL(u).hostname.toLowerCase();
		if (!host) return null;
		return host.startsWith('www.') ? host.slice(4) : host;
	} catch {
		return null;
	}
}

/**
 * Adevărat dacă `url` aparține domeniului `domain` (egalitate sau subdomeniu),
 * după strip „www." și lowercase pe ambele. TLD diferit sau sufix fals → false.
 */
export function matchDomain(url: string, domain: string): boolean {
	if (!domain) return false;
	const host = hostOf(url);
	if (!host) return false;
	let d = domain.trim().toLowerCase();
	if (d.startsWith('www.')) d = d.slice(4);
	if (!d) return false;
	return host === d || host.endsWith('.' + d);
}

/** Dezvelește redirectul Google „/url?q=…" și rezolvă URL-urile protocol-relative. */
function unwrapUrl(href: string): string {
	let h = (href || '').replace(/&amp;/g, '&').trim();
	if (h.startsWith('/url?') || h.startsWith('/url&')) {
		try {
			const params = new URLSearchParams(h.slice(h.indexOf('?') + 1));
			const q = params.get('q');
			if (q && /^https?:/i.test(q)) return q;
		} catch {
			/* ignoră, cade pe href-ul brut */
		}
	}
	if (h.startsWith('//')) h = 'https:' + h;
	return h;
}

/**
 * Markerii unei pagini de blocare Google, restrânși la semnale SPECIFICE paginii de
 * interstițiu — NU substringuri generice care pot apărea în rezultate organice legitime.
 *
 * MĂSURAT pe google.ro (2 sep. 2026), și de aceea `/sorry/index` NU mai e marker:
 * - pagină VALIDĂ cu rezultate: `captcha-form` false, `g-recaptcha` false,
 *   `/sorry/index` **true** (apare în JS-ul inline al paginii normale de căutare);
 * - pagină BLOCATĂ (CAPTCHA, servită chiar cu status 200): `captcha-form` true,
 *   `g-recaptcha` true, `/sorry/index` **false**.
 * Markerul vechi era exact pe dos: marca blocate paginile bune și lăsa să treacă
 * paginile de CAPTCHA. Redirectul real către /sorry/ se verifică pe URL-ul final,
 * în stratul de scraper (vezi `attemptOnce`), nu în HTML.
 */
export function detectBlocked(html: string): boolean {
	const h = (html || '').toLowerCase();
	return (
		h.includes('captcha-form') ||
		h.includes('g-recaptcha') ||
		h.includes('unusual traffic from your')
	);
}

// Containerele de reclame (nu sunt rezultate organice).
const AD_SELECTOR = '#tads, #tadsb, #tadsc, [data-text-ad], .uEierd, .commercial-unit-desktop-top';
/**
 * Containerele de rezultat organic, în ORDINEA preferinței — se folosește primul
 * selector care chiar produce rezultate, ca să nu numărăm de două ori (`.tF2Cxc` e
 * imbricat în `.MjjYud`).
 *
 * MĂSURAT pe google.ro (2 sep. 2026), pagină validă „studio de videochat":
 *   desktop: `.g` = 0, `.mnr-c` = 0, `.tF2Cxc` = 10, `.MjjYud` = 25
 *   mobil:   `.g` = 0, `.mnr-c` = 0, `.tF2Cxc` = 0,  `.MjjYud` = 26
 * Vechile `.g`/`.mnr-c` nu mai există în DOM-ul Google → parserul întorcea 0 organice
 * pe orice pagină, iar providerul arunca „selector posibil rupt". Le păstrăm la coadă
 * ca rezervă pentru layout-uri vechi și pentru fixture-urile de test.
 */
const ORGANIC_SELECTORS = ['.tF2Cxc', '.MjjYud', '.g', '.mnr-c'];

/**
 * URL-ul real al unui rezultat. Google nu mai pune destinația în `href`: ancora e
 * `/goto?url=CAES…` (protobuf opac, MĂSURAT 2 sep. 2026), iar `ping` la fel. Singurul
 * loc cu URL-ul lizibil e `<cite>` („https://arogantstudio.ro"). Ordinea:
 *   1. `href`-ul dezvelit, dacă nu e un link intern Google (layout vechi, `/url?q=`);
 *   2. textul din `<cite>` (layout curent desktop);
 *   3. null → rezultatul e ignorat, nu inventăm un URL.
 */
function resolveResultUrl(container: HTMLElement, href: string | undefined): string | null {
	const direct = unwrapUrl(href || '');
	const directHost = hostOf(direct);
	if (directHost && !/(^|\.)google\.[a-z.]+$/.test(directHost) && isPlausibleHost(directHost)) {
		return direct;
	}

	const citeText = (container.querySelector('cite')?.text || '').trim();
	if (citeText) {
		// „https://site.ro › categorie › pagina" → păstrăm doar originea
		const first = citeText.split(/[\s›]/)[0].trim();
		if (first) {
			const candidate = /^https?:\/\//i.test(first) ? first : `https://${first}`;
			const host = hostOf(candidate);
			if (host && isPlausibleHost(host)) return candidate;
		}
	}
	return null;
}

/** Primul selector organic care produce containere cu titlu (h3). */
function pickOrganicContainers(root: HTMLElement): HTMLElement[] {
	for (const selector of ORGANIC_SELECTORS) {
		const found = root.querySelectorAll(selector).filter((c) => c.querySelector('h3'));
		if (found.length) return found;
	}
	return [];
}

/**
 * Parsează pagina SERP într-un `SerpResult`. Nu aruncă pe pagini normale.
 * `startOffset` = numărul de rezultate de pe paginile anterioare (paginare `&start=`),
 * ca pozițiile să fie absolute, nu relative la pagină.
 */
export function parseSerpHtml(
	html: string,
	opts: { targetDomain: string; competitors?: string[]; startOffset?: number }
): SerpResult {
	if (detectBlocked(html)) {
		return { organic: [], features: [], aiOverview: 'absent', raw: { blocked: true } };
	}

	const root = parse(html);

	// Blocul AI Overview (Prezentare generată de AI).
	const aioBlock = root.querySelector('.aio-block, [data-subtree="aio"], [data-attrid="AIOverview"]');

	const containers = pickOrganicContainers(root);

	// Excludem orice rezultat organic aflat într-un container de reclamă.
	const excluded = new Set<HTMLElement>();
	for (const adRoot of root.querySelectorAll(AD_SELECTOR)) {
		for (const c of containers) if (adRoot.querySelectorAll('*').includes(c)) excluded.add(c);
	}

	const startOffset = opts.startOffset ?? 0;
	/**
	 * Dedup pe DOUĂ chei, fiindcă avem două feluri de duplicate:
	 *  - URL complet (cu cale) — același link randat de două ori;
	 *  - (domeniu + titlu) — Google randează același rezultat în containere imbricate,
	 *    iar din `<cite>` scoatem doar originea, deci URL-urile ies identice
	 *    (MĂSURAT: „Arogant Studio" apărea de 2 ori pe pagina 2).
	 * URL-urile fără cale NU intră în `seenUrls`: altfel două pagini diferite de pe
	 * același site (ambele reduse la origine) s-ar anula reciproc și pozițiile ar sări.
	 */
	const seenUrls = new Set<string>();
	const seenTitles = new Set<string>();
	const organic: SerpOrganicResult[] = [];
	for (const container of containers) {
		if (excluded.has(container) || container.getAttribute('data-text-ad') != null) continue;

		const h3 = container.querySelector('h3');
		if (!h3) continue;
		// Primul <a> care înglobează un <h3> = linkul rezultatului.
		let anchor: HTMLElement | null = null;
		for (const a of container.querySelectorAll('a')) {
			if (a.querySelector('h3')) {
				anchor = a;
				break;
			}
		}

		const url = resolveResultUrl(container, anchor?.getAttribute('href'));
		if (!url) continue;
		const domain = hostOf(url);
		if (!domain) continue;

		const title = (h3.text || '').trim();
		let hasPath = false;
		try {
			const parsed = new URL(url);
			hasPath = parsed.pathname !== '/' || !!parsed.search;
		} catch {
			hasPath = false;
		}
		const titleKey = `${domain}|${title}`;
		if (hasPath && seenUrls.has(url)) continue;
		if (seenTitles.has(titleKey)) continue;
		if (hasPath) seenUrls.add(url);
		seenTitles.add(titleKey);

		const snippetEl = container.querySelector('.VwiC3b, [data-sncf], .hgKElc');
		const snippet = (snippetEl?.text || '').trim();

		organic.push({ position: startOffset + organic.length + 1, url, domain, title, snippet });
	}

	// Detecția feature-urilor SERP prezente pe pagină.
	const features: string[] = [];
	if (root.querySelector('#tads, #tadsb, #tadsc, [data-text-ad]')) features.push('ads');
	if (root.querySelector('.featured-snippet, [data-attrid="FeaturedSnippet"]')) features.push('snippet');
	if (aioBlock) features.push('ai');
	// `[jsname="Cpkphb"]` = blocul „Alte întrebări" din layoutul curent (MĂSURAT: 6 pe mobil,
	// în timp ce `.related-question-pair`/`[data-initq]` dau 0).
	if (root.querySelector('.related-question-pair, [data-initq], [jsname="Cpkphb"]')) features.push('paa');
	// `.rllt__details` = fișele din local pack-ul curent (MĂSURAT: 6 desktop / 11 mobil,
	// în timp ce `.local-pack`/`[data-rc_ludocids]` dau 0).
	if (root.querySelector('.local-pack, [data-rc_ludocids], .rllt__details')) features.push('local');
	if (root.querySelector('.images-block, g-scrolling-carousel img')) features.push('images');
	if (root.querySelector('.video-block, [data-attrid="VideoCarousel"]')) features.push('video');
	if (root.querySelector('.shopping-block, .commercial-unit, .pla-unit')) features.push('shopping');

	// Starea AI Overview: absent / present / citat (ținta e sursă în bloc).
	let aiOverview: SerpResult['aiOverview'] = 'absent';
	if (aioBlock) {
		aiOverview = 'present';
		for (const a of aioBlock.querySelectorAll('a')) {
			if (matchDomain(unwrapUrl(a.getAttribute('href') || ''), opts.targetDomain)) {
				aiOverview = 'cited';
				break;
			}
		}
	}

	return { organic, features, aiOverview, raw: { blocked: false } };
}

/** Poziția primului rezultat organic al domeniului țintă; null dacă lipsește. */
export function pickTargetPosition(
	organic: SerpOrganicResult[],
	targetDomain: string
): number | null {
	for (const o of organic) {
		if (matchDomain(o.url, targetDomain)) return o.position;
	}
	return null;
}

/** Pozițiile competitorilor DOAR în top 10; null dacă lipsesc sau sunt mai jos. */
export function competitorPositions(
	organic: SerpOrganicResult[],
	competitors: string[]
): Record<string, number | null> {
	const out: Record<string, number | null> = {};
	for (const competitor of competitors) {
		let pos: number | null = null;
		for (const o of organic) {
			if (o.position > 10) break;
			if (matchDomain(o.url, competitor)) {
				pos = o.position;
				break;
			}
		}
		out[competitor] = pos;
	}
	return out;
}
