// Parser SERP PUR: string HTML (de la orice provider care întoarce pagina Google)
// → obiect structurat. Fără rețea, fără DB, fără DOM de browser — folosește
// node-html-parser (deja în dependențe). Selectoarele sunt DEFENSIVE: mai multe
// strategii, tolerante la piese lipsă, nu aruncă niciodată pe o pagină normală.
// Aruncatul pe pagină goală/blocată e treaba stratului provider (Task 4/6).
import { parse, type HTMLElement } from 'node-html-parser';
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

/** Markerii unei pagini de blocare (CAPTCHA / „unusual traffic" / /sorry/). */
export function detectBlocked(html: string): boolean {
	const h = (html || '').toLowerCase();
	return (
		h.includes('unusual traffic') ||
		h.includes('captcha-form') ||
		h.includes('recaptcha') ||
		h.includes('/sorry/')
	);
}

// Containerele de reclame (nu sunt rezultate organice).
const AD_SELECTOR = '#tads, #tadsb, #tadsc, [data-text-ad], .uEierd, .commercial-unit-desktop-top';
// Containerele de rezultat organic: desktop `.g`/`.tF2Cxc`, mobil `.mnr-c`.
const ORGANIC_SELECTOR = '.g, .mnr-c';

/** Parsează pagina SERP într-un `SerpResult`. Nu aruncă pe pagini normale. */
export function parseSerpHtml(
	html: string,
	opts: { targetDomain: string; competitors?: string[] }
): SerpResult {
	if (detectBlocked(html)) {
		return { organic: [], features: [], aiOverview: 'absent', raw: { blocked: true } };
	}

	const root = parse(html);

	// Blocul AI Overview (Prezentare generată de AI).
	const aioBlock = root.querySelector('.aio-block, [data-subtree="aio"], [data-attrid="AIOverview"]');

	// Excludem orice rezultat organic aflat într-un container de reclamă.
	const excluded = new Set<HTMLElement>();
	for (const adRoot of root.querySelectorAll(AD_SELECTOR)) {
		for (const g of adRoot.querySelectorAll(ORGANIC_SELECTOR)) excluded.add(g);
	}

	const seenUrls = new Set<string>();
	const organic: SerpOrganicResult[] = [];
	for (const container of root.querySelectorAll(ORGANIC_SELECTOR)) {
		if (excluded.has(container) || container.getAttribute('data-text-ad') != null) continue;

		// Primul <a> care înglobează un <h3> = linkul rezultatului.
		let anchor: HTMLElement | null = null;
		for (const a of container.querySelectorAll('a')) {
			if (a.querySelector('h3')) {
				anchor = a;
				break;
			}
		}
		const href = anchor?.getAttribute('href');
		if (!anchor || !href) continue;

		const url = unwrapUrl(href);
		const domain = hostOf(url);
		if (!domain) continue;
		if (seenUrls.has(url)) continue;
		seenUrls.add(url);

		const title = (anchor.querySelector('h3')?.text || '').trim();
		const snippetEl = container.querySelector('.VwiC3b, [data-sncf], .hgKElc');
		const snippet = (snippetEl?.text || '').trim();

		organic.push({ position: organic.length + 1, url, domain, title, snippet });
	}

	// Detecția feature-urilor SERP prezente pe pagină.
	const features: string[] = [];
	if (root.querySelector('#tads, #tadsb, #tadsc, [data-text-ad]')) features.push('ads');
	if (root.querySelector('.featured-snippet, [data-attrid="FeaturedSnippet"]')) features.push('snippet');
	if (aioBlock) features.push('ai');
	if (root.querySelector('.related-question-pair, [data-initq]')) features.push('paa');
	if (root.querySelector('.local-pack, [data-rc_ludocids]')) features.push('local');
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
