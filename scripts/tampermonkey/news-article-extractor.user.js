// ==UserScript==
// @name         News Article & Backlink Verifier (PRO v1.6)
// @namespace    http://tampermonkey.net/
// @version      1.6
// @description  Extracție profesională de backlink-uri. Fix pentru titluri lipsă și stabilitate BZT.
// @match        https://www.bzi.ro/*
// @match        https://bzi.ro/*
// @match        https://bzv.ro/*
// @match        https://www.bzv.ro/*
// @match        https://bzc.ro/*
// @match        https://www.bzc.ro/*
// @match        https://bzt.ro/*
// @match        https://www.bzt.ro/*
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @connect      bzi.ro
// @connect      bzv.ro
// @connect      bzc.ro
// @connect      bzt.ro
// ==/UserScript==

(function () {
	'use strict';

	const BLACKLIST = ['politica', 'cookie', 'termeni', 'contact', 'despre', 'echipa', 'arhiva', 'publicitate', 'anunturi', 'search', 'confidentialitate', 'gdpr', 'abonamente', 'reclama'];
	
	const RO_MONTHS = {
		ianuarie: 0, ian: 0, februarie: 1, feb: 1, martie: 2, mar: 2, mart: 2, aprilie: 3, apr: 3,
		mai: 4, iunie: 5, iun: 5, iulie: 6, iul: 6, august: 7, aug: 7,
		septembrie: 8, sept: 8, sep: 8, octombrie: 9, oct: 9, noiembrie: 10, noi: 10, nov: 10, decembrie: 11, dec: 11
	};

	function normalize(str) {
		if (!str) return '';
		return str.toLowerCase()
			.replace(/^https?:\/\//, '')
			.replace(/^www\./, '')
			.replace(/[-\.]/g, '')
			.replace(/\/$/, '')
			.trim();
	}

	function formatDate(date) {
		if (!date || isNaN(date.getTime())) return '';
		return `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
	}

	function parseRoDate(text) {
		if (!text) return null;
		const now = new Date();
		const clean = text.toLowerCase().replace(/\s+/g, ' ').replace(/,/g, '').trim();
		const m = clean.match(/(\d{1,2})\s+([a-zăâîșț]+)[^a-z0-9]*\s*(\d{2,4})?(\s*(\d{1,2}):(\d{2}))?/i);
		if (m) {
			const day = parseInt(m[1], 10);
            const monRaw = m[2].replace(/[\.]+$/, '');
			const mon = RO_MONTHS[monRaw];
			if (mon !== undefined) {
				let year = m[3] ? parseInt(m[3], 10) : now.getFullYear();
                if (year < 100) year += 2000;
				return new Date(year, mon, day, m[5] ? +m[5] : 0, m[6] ? +m[6] : 0);
			}
		}
		return null;
	}

	function request(url) {
		return new Promise((resolve, reject) => {
			GM_xmlhttpRequest({
				method: "GET",
				url: url,
				timeout: 12000,
				onload: (res) => resolve({
                    doc: new DOMParser().parseFromString(res.responseText, 'text/html'),
                    html: res.responseText
                }),
				onerror: (err) => reject(err)
			});
		});
	}

	async function verifyBacklink(articleUrl, targetDomain) {
		const normTarget = normalize(targetDomain);
		try {
			const { doc, html } = await request(articleUrl);
            const foundLinks = [];
            
            // Extragem Titlul Real din pagină (cel mai sigur mod)
            const pageTitle = doc.querySelector('h1, .entry-title, .article__title')?.textContent?.trim() || "";

            // Căutăm absolut toate linkurile din pagină
            const allLinks = doc.querySelectorAll('a');
            allLinks.forEach(a => {
                const href = a.href;
                if (!href || href.includes(location.hostname) || href.startsWith('javascript:') || href.includes('facebook.com') || href.includes('twitter.com')) return;
                
                const normHref = normalize(href);
                const isMatch = !targetDomain || 
                                href.toLowerCase().includes(targetDomain.toLowerCase()) || 
                                (normTarget && normHref.includes(normTarget));

                if (isMatch) {
                    foundLinks.push({ href, anchor: a.textContent.trim() });
                }
            });
            
			return { foundLinks, pageTitle };
		} catch (err) { return { foundLinks: [], pageTitle: "" }; }
	}

	const PATTERNS = [
		{
			name: 'bzi.ro',
			match: (h) => h.includes('bzi.ro'),
			extract: (doc) => [...doc.querySelectorAll('.article, div.article')].map(el => ({
				title: el.querySelector('h3, .article__content a, .title')?.textContent?.trim() || "",
				url: el.querySelector('a')?.href,
				rawDate: el.querySelector('.article__eyebrow div:nth-child(2), .article__date, .date')?.textContent?.trim()
			})),
			next: (doc) => doc.querySelector('.wp-pagenavi a.nextpostslink, a.nextpostslink, link[rel="next"]')?.href
		},
		{
			name: 'bzt.ro',
			match: (h) => h.includes('bzt.ro'),
			extract: (doc) => {
                const results = [];
                const items = doc.querySelectorAll('.item, article, .post-item, .search-result, .result');
                
                items.forEach(el => {
                    const link = el.querySelector('h3 a, h2 a, a.header, .title a, a');
                    if (link && link.href && link.href.startsWith('http')) {
                        const url = link.href;
                        if (BLACKLIST.some(word => url.toLowerCase().includes(word))) return;
                        if (url.length < 25) return; 

                        results.push({
                            title: link.textContent.trim() || link.getAttribute('title') || "",
                            url: url,
                            rawDate: el.querySelector('.meta, time, .date, .extra')?.textContent?.trim() || ''
                        });
                    }
                });

                // Fallback agresiv pentru linkuri neidentificate
                if (results.length === 0) {
                    const main = doc.querySelector('.main, .eleven.wide.column, #archive-content') || doc.body;
                    main.querySelectorAll('a').forEach(a => {
                        if (a.href.length > 45 && !BLACKLIST.some(w => a.href.includes(w))) {
                            results.push({ title: a.textContent.trim(), url: a.href, rawDate: '' });
                        }
                    });
                }
                return results;
            },
			next: (doc) => doc.querySelector('.pagination a.next, a.next, link[rel="next"]')?.href
		}
	];

	let stopRequested = false;

	async function startExtraction() {
		stopRequested = false;
		const targetInput = document.getElementById('__extractor_target').value.trim();
        if (!targetInput) return alert('Introdu un domeniu țintă (ex: heylux)');

		const results = [];
		const seen = new Set();
		const pattern = PATTERNS.find(p => p.match(location.hostname));
		if (!pattern) return alert(`Site-ul nu este configurat.`);

		let currentDoc = document;
		let page = 1;
		let totalScanned = 0;

		const log = document.getElementById('__extractor_log');
		const stopBtn = document.getElementById('__extractor_btn_stop');
		stopBtn.style.display = 'block';

		while (currentDoc && page <= 30 && !stopRequested) {
			const items = pattern.extract(currentDoc).filter(i => i.url && i.url.startsWith('http'));
			
			for (let i = 0; i < items.length; i++) {
				if (stopRequested) break;
				const item = items[i];
				if (seen.has(item.url)) continue;
				seen.add(item.url);
				totalScanned++;

				log.textContent = `P${page} | Verificare ${i+1}/${items.length}...`;
				
				const { foundLinks, pageTitle } = await verifyBacklink(item.url, targetInput);
				if (targetInput && foundLinks.length === 0) continue;
				
				const parsedDate = parseRoDate(item.rawDate);
				results.push({
					...item,
                    title: pageTitle || item.title || "Fără Titlu",
					date: parsedDate ? formatDate(parsedDate) : item.rawDate,
					backlink: foundLinks.map(f => f.href).join(' | '),
					anchor: foundLinks.map(f => f.anchor).join(' | '),
					pattern: pattern.name
				});
                log.textContent = `P${page} | Găsite: ${results.length}`;
			}

			const nextUrl = pattern.next(currentDoc);
			if (!nextUrl || stopRequested) break;
			const next = await request(nextUrl);
            currentDoc = next.doc;
			page++;
		}

		finish(results, totalScanned);
	}

	function finish(results, total) {
		document.getElementById('__extractor_btn_stop').style.display = 'none';
		if (results.length > 0) {
			const tsv = 'NR\tData\tTitlu\tURL Articol\tBacklink\tText Ancoră\tSursa\n' + 
				results.map((i, idx) => [idx + 1, i.date, i.title, i.url, i.backlink, i.anchor, i.pattern].join('\t')).join('\n');
			GM_setClipboard(tsv);
			const blob = new Blob(["\ufeff" + tsv], { type: 'text/tab-separated-values' });
			const a = document.createElement('a');
			a.href = URL.createObjectURL(blob);
			a.download = `extract-${location.hostname}.tsv`;
			a.click();
			alert(`Extracție finalizată cu succes!\n${results.length} articole găsite.`);
		} else {
			alert('Nu am găsit backlink-uri. Verifică cuvântul cheie.');
		}
	}

	function createUI() {
		if (document.getElementById('__extractor_container')) return;
		const container = document.createElement('div');
		container.id = '__extractor_container';
		Object.assign(container.style, {
			position: 'fixed', bottom: '20px', right: '20px', zIndex: '999999',
			background: '#fff', border: '2px solid #2563eb', borderRadius: '12px',
			padding: '16px', boxShadow: '0 10px 30px rgba(0,0,0,0.3)', width: '280px',
			display: 'flex', flexDirection: 'column', gap: '10px', fontFamily: 'sans-serif'
		});
		container.innerHTML = `
			<div style="font-weight: bold; color: #1e3a8a;">Backlink Extractor v1.6</div>
			<input type="text" id="__extractor_target" placeholder="Domeniu (ex: heylux)" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 6px;">
			<button id="__extractor_btn_deep" style="width: 100%; padding: 12px; background: #059669; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">DEEP SCAN (Start)</button>
			<button id="__extractor_btn_stop" style="width: 100%; padding: 8px; background: #dc2626; color: #fff; border: none; border-radius: 6px; cursor: pointer; display: none; font-weight: bold;">STOP</button>
			<div id="__extractor_log" style="font-size: 11px; color: #666; text-align: center;">Pregătit</div>
		`;
		document.body.appendChild(container);
		document.getElementById('__extractor_btn_deep').onclick = startExtraction;
		document.getElementById('__extractor_btn_stop').onclick = () => { stopRequested = true; };
	}
	createUI();
})();
