// Teste pentru parserul SERP PUR (string HTML → obiect). Fără rețea, fără DB.
// Fixture-ele sunt sintetice, structural fidele DOM-ului Google (sept 2026) —
// capturile reale de la Google au fost blocate de interstițiul „unusual traffic".
import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
	parseSerpHtml,
	matchDomain,
	detectBlocked,
	pickTargetPosition,
	competitorPositions
} from '../serp-parser';

const read = (name: string) =>
	readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

const desktopHtml = read('serp-desktop.html');
const mobileHtml = read('serp-mobile.html');
const aiHtml = read('serp-ai-overview.html');
const captchaHtml = read('serp-captcha.html');

const TARGET = 'example.ro';

describe('matchDomain', () => {
	test('egalitate exactă (după strip www + lowercase)', () => {
		expect(matchDomain('https://example.ro/pagina', 'example.ro')).toBe(true);
		expect(matchDomain('https://www.example.ro/', 'example.ro')).toBe(true);
		expect(matchDomain('https://EXAMPLE.RO/', 'Example.Ro')).toBe(true);
	});

	test('subdomeniu ∈ domeniu (blog.example.ro ∈ example.ro)', () => {
		expect(matchDomain('https://blog.example.ro/articol', 'example.ro')).toBe(true);
		expect(matchDomain('https://a.b.example.ro/', 'example.ro')).toBe(true);
	});

	test('TLD diferit → false', () => {
		expect(matchDomain('https://example.com/', 'example.ro')).toBe(false);
		expect(matchDomain('https://example.ro/', 'example.com')).toBe(false);
	});

	test('nu se lasă păcălit de sufix fals (notexample.ro ∉ example.ro)', () => {
		expect(matchDomain('https://notexample.ro/', 'example.ro')).toBe(false);
		expect(matchDomain('https://example.ro.evil.com/', 'example.ro')).toBe(false);
	});

	test('protocol-relative și http/https', () => {
		expect(matchDomain('//blog.example.ro/x', 'example.ro')).toBe(true);
		expect(matchDomain('http://example.ro', 'example.ro')).toBe(true);
	});

	test('URL malformat → false, fără să arunce', () => {
		expect(matchDomain('nu-e-un-url', 'example.ro')).toBe(false);
		expect(matchDomain('', 'example.ro')).toBe(false);
		expect(matchDomain('https://', 'example.ro')).toBe(false);
		expect(matchDomain('ht!tp://x', 'example.ro')).toBe(false);
		// domeniu gol
		expect(matchDomain('https://example.ro/', '')).toBe(false);
	});
});

describe('parseSerpHtml — desktop', () => {
	const r = parseSerpHtml(desktopHtml, {
		targetDomain: TARGET,
		competitors: ['competitor-a.ro', 'competitor-b.ro']
	});

	test('găsește ≥10 rezultate organice (11 după dedup), în ordine', () => {
		expect(r.organic.length).toBe(11);
		expect(r.organic.map((o) => o.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
	});

	test('primul organic e Wikipedia (nu o reclamă de sus)', () => {
		expect(r.organic[0].domain).toBe('ro.wikipedia.org');
		expect(r.organic[0].title).toContain('Wikipedia');
		// reclamele nu au ajuns în organice
		expect(r.organic.some((o) => o.domain.includes('reclama-seo'))).toBe(false);
		expect(r.organic.some((o) => o.domain.includes('googleadservices'))).toBe(false);
	});

	test('titlu + snippet extrase corect', () => {
		expect(r.organic[0].title).toBe('Optimizare pentru motoarele de căutare - Wikipedia');
		expect(r.organic[0].snippet).toContain('creștere a vizibilității');
		expect(r.organic[0].snippet).not.toContain('Wikipedia -'); // fără titlu în snippet
	});

	test('domeniul țintă la poziția 7', () => {
		expect(pickTargetPosition(r.organic, TARGET)).toBe(7);
		expect(r.organic[6].domain).toBe('example.ro');
	});

	test('competitorii la pozițiile din top 10 (2 și 5)', () => {
		expect(competitorPositions(r.organic, ['competitor-a.ro', 'competitor-b.ro'])).toEqual({
			'competitor-a.ro': 2,
			'competitor-b.ro': 5
		});
	});

	test('dezvelește redirectul /url?q= (moz la poziția 3)', () => {
		expect(r.organic[2].url).toBe('https://moz.com/beginners-guide-to-seo');
		expect(r.organic[2].domain).toBe('moz.com');
	});

	test('rezolvă URL protocol-relative (//blog.hubspot.com la poziția 10)', () => {
		expect(r.organic[9].url).toBe('https://blog.hubspot.com/marketing/seo');
		expect(r.organic[9].domain).toBe('blog.hubspot.com');
	});

	test('dedup după URL — backlinko apare o singură dată', () => {
		const urls = r.organic.map((o) => o.url);
		expect(new Set(urls).size).toBe(urls.length);
		expect(urls.filter((u) => u === 'https://backlinko.com/hub/seo').length).toBe(1);
	});

	test('detectează features: ads, paa, local, images; fără ai', () => {
		expect(r.features).toEqual(expect.arrayContaining(['ads', 'paa', 'local', 'images']));
		expect(r.features).not.toContain('ai');
		expect(r.features).not.toContain('snippet');
	});

	test('aiOverview absent pe desktop (fără bloc AIO)', () => {
		expect(r.aiOverview).toBe('absent');
	});

	test('nu e blocat', () => {
		expect(detectBlocked(desktopHtml)).toBe(false);
		expect(r.raw?.blocked).toBe(false);
	});
});

describe('parseSerpHtml — mobil', () => {
	const r = parseSerpHtml(mobileHtml, { targetDomain: TARGET });

	test('parsează markup-ul mobil: 10 organice în ordine', () => {
		expect(r.organic.length).toBe(10);
		expect(r.organic.map((o) => o.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
	});

	test('reclama mobilă de sus e exclusă', () => {
		expect(r.organic.some((o) => o.domain.includes('reclama-mobil'))).toBe(false);
		expect(r.organic[0].domain).toBe('ro.wikipedia.org');
	});

	test('snippet extras din [data-sncf] (selector mobil)', () => {
		expect(r.organic[0].snippet).toContain('vizibilității unui site');
	});

	test('domeniul țintă la poziția 4', () => {
		expect(pickTargetPosition(r.organic, TARGET)).toBe(4);
	});

	test('features: ads + paa; fără ai', () => {
		expect(r.features).toEqual(expect.arrayContaining(['ads', 'paa']));
		expect(r.features).not.toContain('ai');
	});

	test('aiOverview absent, nu e blocat', () => {
		expect(r.aiOverview).toBe('absent');
		expect(detectBlocked(mobileHtml)).toBe(false);
	});
});

describe('parseSerpHtml — AI Overview', () => {
	test('feature „ai" detectat + organice parsate alături de AIO', () => {
		const r = parseSerpHtml(aiHtml, { targetDomain: TARGET });
		expect(r.features).toContain('ai');
		expect(r.organic.length).toBeGreaterThanOrEqual(3);
		// linkurile-sursă din AIO nu devin rezultate organice
		expect(r.organic[0].domain).toBe('moz.com');
	});

	test("aiOverview 'cited' când ținta e sursă în bloc", () => {
		const r = parseSerpHtml(aiHtml, { targetDomain: TARGET });
		expect(r.aiOverview).toBe('cited');
	});

	test("aiOverview 'present' când blocul există dar ținta nu e sursă", () => {
		const r = parseSerpHtml(aiHtml, { targetDomain: 'alt-domeniu-inexistent.ro' });
		expect(r.aiOverview).toBe('present');
	});

	test("aiOverview 'absent' pe o pagină fără bloc AIO", () => {
		const r = parseSerpHtml(desktopHtml, { targetDomain: TARGET });
		expect(r.aiOverview).toBe('absent');
	});
});

describe('detectBlocked', () => {
	test('true doar pe fixture-ul captcha', () => {
		expect(detectBlocked(captchaHtml)).toBe(true);
		expect(detectBlocked(desktopHtml)).toBe(false);
		expect(detectBlocked(mobileHtml)).toBe(false);
		expect(detectBlocked(aiHtml)).toBe(false);
	});

	test('markeri individuali', () => {
		expect(detectBlocked('... unusual traffic from your computer ...')).toBe(true);
		expect(detectBlocked('<form id="captcha-form">')).toBe(true);
		expect(detectBlocked('<div class="g-recaptcha"></div>')).toBe(true);
		// „/sorry/index" NU mai e marker: MĂSURAT pe google.ro (2 sep. 2026), stringul apare
		// în JS-ul inline al paginilor VALIDE de căutare, iar paginile de CAPTCHA (servite
		// cu status 200) NU îl conțin. Redirectul real se prinde pe URL-ul final, în scraper.
		expect(detectBlocked('redirect to /sorry/index')).toBe(false);
		expect(detectBlocked('pagină normală fără markeri')).toBe(false);
	});

	test('NU marchează fals un SERP legitim care conține „recaptcha"/„unusual traffic"/„/sorry/" în text', () => {
		// keyword „recaptcha" → titluri/snippeturi menționează cuvântul, dar nu e o pagină de blocare
		expect(detectBlocked('<h3>Ce este reCAPTCHA?</h3><span>ghid despre recaptcha</span>')).toBe(false);
		expect(detectBlocked('<span>cum detectezi unusual traffic pe site</span>')).toBe(false);
		expect(detectBlocked('<a href="https://example.ro/nu-sorry/pagina">link</a>')).toBe(false);
	});
});

describe('parseSerpHtml — cazuri limită', () => {
	test('pagina captcha: fără organice, marcată blocked, NU aruncă', () => {
		const r = parseSerpHtml(captchaHtml, { targetDomain: TARGET });
		expect(r.organic).toEqual([]);
		expect(r.raw?.blocked).toBe(true);
		expect(r.aiOverview).toBe('absent');
	});

	test('HTML gol/fără rezultate: organic []=[], nu aruncă (aruncatul e treaba providerului)', () => {
		const r = parseSerpHtml('<html><body><div id="search"></div></body></html>', {
			targetDomain: TARGET
		});
		expect(r.organic).toEqual([]);
		expect(r.features).toEqual([]);
		expect(r.aiOverview).toBe('absent');
		expect(r.raw?.blocked).toBe(false);
	});

	test('detectează featured snippet → feature „snippet"', () => {
		const html = `<div id="rso"><div class="featured-snippet" data-hveid="FS">
			<div class="hgKElc"><span>Răspuns evidențiat direct în SERP.</span></div>
			<div class="g"><div class="yuRUbf"><a href="https://sursa.ro/x"><h3>Sursa featured</h3></a></div>
			<div class="VwiC3b"><span>fragment</span></div></div>
		</div></div>`;
		const r = parseSerpHtml(html, { targetDomain: TARGET });
		expect(r.features).toContain('snippet');
		expect(r.organic.length).toBe(1);
	});

	test('competitor în afara top 10 sau absent → null', () => {
		const r = parseSerpHtml(desktopHtml, { targetDomain: TARGET });
		// backlinko e la poziția 11 (peste top 10) → null; domeniu absent → null
		expect(
			competitorPositions(r.organic, ['backlinko.com', 'inexistent-total.ro'])
		).toEqual({ 'backlinko.com': null, 'inexistent-total.ro': null });
	});

	test('pickTargetPosition null când ținta lipsește', () => {
		const r = parseSerpHtml(desktopHtml, { targetDomain: TARGET });
		expect(pickTargetPosition(r.organic, 'domeniu-care-nu-exista.ro')).toBeNull();
	});
});
