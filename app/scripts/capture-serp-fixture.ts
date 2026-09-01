#!/usr/bin/env bun
/**
 * Captează un fixture SERP real de la Google pentru testele parserului.
 *
 * Best-effort: lansează Chrome prin puppeteer-core, navighează la un URL de
 * căutare Google și scrie `page.content()` într-un fișier fixture. Google
 * afișează foarte des un zid de consimțământ (consent.google.com) sau un
 * CAPTCHA („unusual traffic") pentru cereri automate — în acel caz scriptul NU
 * trebuie folosit ca sursă de adevăr. Fixture-ele sintetice scrise de mână
 * rămân sursa de test; acest script e doar pentru refresh ocazional cu capturi
 * reale, când mediul permite.
 *
 * Utilizare:
 *   bun run scripts/capture-serp-fixture.ts "<google search url>" <cale fixture>
 *
 * Exemplu:
 *   bun run scripts/capture-serp-fixture.ts \
 *     "https://www.google.ro/search?q=agentie+seo+bucuresti&hl=ro&gl=ro&num=20" \
 *     src/lib/server/rank-tracker/providers/__tests__/fixtures/serp-desktop.html
 */
import { writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { findChromePath } from '../src/lib/server/scraper/find-chrome';

const [, , url, outPath] = process.argv;

if (!url || !outPath) {
	console.error('Utilizare: bun run scripts/capture-serp-fixture.ts "<url>" <cale fixture>');
	process.exit(1);
}

const DESKTOP_UA =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

async function main() {
	const executablePath = findChromePath();
	const browser = await puppeteer.launch({
		executablePath,
		headless: true,
		args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=ro-RO']
	});
	try {
		const page = await browser.newPage();
		await page.setUserAgent(DESKTOP_UA);
		await page.setExtraHTTPHeaders({ 'Accept-Language': 'ro-RO,ro;q=0.9' });
		await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
		const html = await page.content();

		const blocked =
			/unusual traffic|our systems have detected|recaptcha|\/sorry\//i.test(html);
		const consent = /consent\.google\.|Before you continue|Înainte de a continua/i.test(html);
		if (blocked) {
			console.error(
				'⚠️  Google a returnat un interstițial CAPTCHA/„unusual traffic". NU folosi această captură ca fixture de test — păstrează fixture-ul sintetic.'
			);
		}
		if (consent) {
			console.error(
				'⚠️  Zid de consimțământ Google (consent.google.com). NU folosi această captură — păstrează fixture-ul sintetic.'
			);
		}
		writeFileSync(outPath, html, 'utf8');
		console.log(`Scris ${html.length} octeți în ${outPath} (blocked=${blocked}, consent=${consent})`);
	} finally {
		await browser.close();
	}
}

main().catch((err) => {
	console.error('Captura a eșuat:', err?.message ?? err);
	process.exit(1);
});
