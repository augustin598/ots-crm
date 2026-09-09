// ==UserScript==
// @name         Google Ads Invoice Extractor - OTS CRM v3.0
// @namespace    https://onetopsolution.ro
// @version      3.0
// @description  Trimite facturile Google Ads (PDF) direct in OTS CRM, din browserul tau logat
// @author       OTS CRM
// @match        https://ads.google.com/*
// @match        https://payments.google.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_setClipboard
// @connect      clients.onetopsolution.ro
// @connect      localhost
// @connect      127.0.0.1
// ==/UserScript==

/*
 * Cum functioneaza (v3):
 *  1. Pe pagina Google Ads -> Facturare -> Documente, scriptul citeste tabelul din
 *     iframe-ul payments.google.com (id factura, data, suma, link PDF).
 *  2. Intreaba CRM-ul care facturi lipsesc (POST /{tenant}/api/google-ads/invoices/check).
 *  3. Descarca fiecare PDF lipsa IN BROWSERUL TAU (sesiunea ta Google) si il trimite
 *     in CRM ca base64 (POST /{tenant}/api/google-ads/invoices/ingest), una cate una.
 *  Serverul nu mai are nevoie de cookie-uri Google. Fallback: "JSON" copiaza link-urile
 *  ca in v2, pentru panoul "Import Facturi" din CRM.
 */

(function () {
	'use strict';

	var DEFAULT_CRM_BASE = 'https://clients.onetopsolution.ro';
	var DEFAULT_TENANT = 'ots';
	var DELAY_BETWEEN_INVOICES_MS = 400;
	var DOWNLOAD_TIMEOUT_MS = 60000;
	var EXTRACT_TIMEOUT_MS = 6000;

	var loc = window.location.href;
	var isInIframe = window.self !== window.top;

	// ── Config (GM storage) ──────────────────────────────────────────
	function getConfig() {
		var crmBase = DEFAULT_CRM_BASE;
		var tenant = DEFAULT_TENANT;
		try {
			crmBase = GM_getValue('ots_crm_base', DEFAULT_CRM_BASE) || DEFAULT_CRM_BASE;
			tenant = GM_getValue('ots_tenant', DEFAULT_TENANT) || DEFAULT_TENANT;
		} catch (e) { /* GM not available */ }
		return { crmBase: String(crmBase).replace(/\/+$/, ''), tenant: String(tenant).replace(/^\/+|\/+$/g, '') };
	}

	function setConfigInteractive() {
		var cfg = getConfig();
		var base = prompt('Adresa CRM (fara / la final):', cfg.crmBase);
		if (base === null) return;
		var tenant = prompt('Slug tenant CRM:', cfg.tenant);
		if (tenant === null) return;
		try {
			GM_setValue('ots_crm_base', base.trim().replace(/\/+$/, ''));
			GM_setValue('ots_tenant', tenant.trim().replace(/^\/+|\/+$/g, ''));
		} catch (e) {
			alert('Nu pot salva configurarea (GM_setValue indisponibil).');
		}
	}

	// ── Shared helpers ───────────────────────────────────────────────
	var RO_MONTHS = {
		ian: '01', ianuarie: '01', feb: '02', februarie: '02', mar: '03', martie: '03',
		apr: '04', aprilie: '04', mai: '05', iun: '06', iunie: '06', iul: '07', iulie: '07',
		aug: '08', august: '08', sep: '09', septembrie: '09', oct: '10', octombrie: '10',
		noi: '11', noiembrie: '11', noiembre: '11', dec: '12', decembrie: '12'
	};
	var EN_MONTHS = {
		jan: '01', january: '01', feb: '02', february: '02', mar: '03', march: '03',
		apr: '04', april: '04', may: '05', jun: '06', june: '06', jul: '07', july: '07',
		aug: '08', august: '08', sep: '09', september: '09', oct: '10', october: '10',
		nov: '11', november: '11', dec: '12', december: '12'
	};

	function parseDate(text) {
		if (!text) return undefined;
		var m = text.match(/(\d{1,2})\s+([a-zăâîșț]+)\.?\s+(\d{4})/i);
		if (m) {
			var key = m[2].toLowerCase();
			var mm = RO_MONTHS[key] || RO_MONTHS[key.substring(0, 3)] || EN_MONTHS[key] || EN_MONTHS[key.substring(0, 3)];
			if (mm) return m[3] + '-' + mm + '-' + m[1].padStart(2, '0');
		}
		var m2 = text.match(/([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/i);
		if (m2) {
			var enKey = m2[1].toLowerCase();
			var enMm = EN_MONTHS[enKey] || EN_MONTHS[enKey.substring(0, 3)];
			if (enMm) return m2[3] + '-' + enMm + '-' + m2[2].padStart(2, '0');
		}
		return undefined;
	}

	function bufferToBase64(buf) {
		var bytes = new Uint8Array(buf);
		var bin = '';
		var CHUNK = 0x8000;
		for (var i = 0; i < bytes.length; i += CHUNK) {
			bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
		}
		return btoa(bin);
	}

	function isPdf(buf) {
		var b = new Uint8Array(buf);
		return b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
	}

	function absoluteUrl(url) {
		var clean = url.replace(/&amp;/g, '&');
		if (clean.indexOf('/payments/') === 0) return 'https://payments.google.com' + clean;
		return clean;
	}

	/** Extract invoice rows from the current document (used inside the payments iframe). */
	function extractRowsFromDocument() {
		var links = [];
		var seen = {};
		document.querySelectorAll('[data-url]').forEach(function (el) {
			var url = el.getAttribute('data-url');
			if (!url || url.indexOf('/payments/apis-secure/doc') === -1) return;
			if (seen[url]) return;
			seen[url] = true;

			var row = el.closest('tr') || el.closest('[role="row"]') || (el.parentElement && el.parentElement.parentElement && el.parentElement.parentElement.parentElement);
			var invoiceId, date, amount;

			if (row) {
				var invoiceCell = row.querySelector('[aria-label*="documentului"], [aria-label*="Document number"], [aria-label*="Invoice number"]');
				if (invoiceCell) {
					var span = invoiceCell.querySelector('span');
					var cellText = (span ? span.textContent : invoiceCell.textContent) || '';
					var numMatch = cellText.match(/(\d{8,12})/);
					if (numMatch) invoiceId = numMatch[1];
				}
				var amountCell = row.querySelector('[aria-label*="documentelor"], [aria-label*="Amount"], [aria-label*="Sumă"]');
				if (amountCell) {
					var aSpan = amountCell.querySelector('span');
					amount = ((aSpan ? aSpan.textContent : amountCell.textContent) || '').replace(/ /g, ' ').trim();
				}
				var dateCell = row.querySelector('[aria-label*="emiterii"], [aria-label*="Issue date"], [aria-label*="Date"]');
				if (dateCell) {
					var dSpan = dateCell.querySelector('span');
					date = parseDate((dSpan ? dSpan.textContent : dateCell.textContent) || '');
				}
			}

			var rowText = row ? row.innerText || '' : '';
			if (!invoiceId) {
				var idMatch = rowText.match(/(\d{8,12})/) || url.match(/(\d{8,12})/);
				invoiceId = idMatch ? idMatch[1] : undefined;
			}
			if (!amount) {
				var amountMatch = rowText.match(/([\d.,]+\s*(?:RON|USD|EUR|GBP|CHF|lei))/i) || rowText.match(/(?:RON|USD|EUR|GBP|CHF)\s*([\d.,]+)/i);
				amount = amountMatch ? amountMatch[0].trim() : undefined;
			}
			if (!date) date = parseDate(rowText);

			links.push({ url: url.replace(/&amp;/g, '&'), invoiceId: invoiceId, date: date, amount: amount });
		});
		return links;
	}

	/** Download one invoice PDF with the page's own Google session. */
	function downloadPdf(url) {
		return fetch(absoluteUrl(url), { credentials: 'include', headers: { Accept: 'application/pdf,*/*' } })
			.then(function (res) {
				if (!res.ok) throw new Error('HTTP ' + res.status);
				return res.arrayBuffer();
			})
			.then(function (buf) {
				if (!isPdf(buf)) throw new Error('Raspunsul nu este PDF (sesiune expirata?)');
				return bufferToBase64(buf);
			});
	}

	// ── IFRAME (payments.google.com inside ads.google.com) ───────────
	function runInIframe() {
		window.addEventListener('message', function (e) {
			var data = e.data || {};
			if (data.type === 'OTS_EXTRACT_REQUEST') {
				window.parent.postMessage({ type: 'OTS_EXTRACT_RESULT', links: extractRowsFromDocument() }, '*');
			}
			if (data.type === 'OTS_DOWNLOAD_REQUEST' && data.url) {
				downloadPdf(data.url).then(function (pdfBase64) {
					window.parent.postMessage({ type: 'OTS_DOWNLOAD_RESULT', reqId: data.reqId, ok: true, pdfBase64: pdfBase64 }, '*');
				}).catch(function (err) {
					window.parent.postMessage({ type: 'OTS_DOWNLOAD_RESULT', reqId: data.reqId, ok: false, error: String(err && err.message || err) }, '*');
				});
			}
		});

		function checkAndNotify() {
			var count = document.querySelectorAll('[data-url*="apis-secure"]').length;
			if (count > 0) window.parent.postMessage({ type: 'OTS_INVOICES_READY', count: count }, '*');
		}
		setInterval(checkAndNotify, 2000);
		setTimeout(checkAndNotify, 3000);
	}

	// ── PARENT (ads.google.com billing page, or payments.google.com top-level) ──
	function runOnAdsPage() {
		var detectedCount = 0;
		var busy = false;
		var pendingExtract = null;
		var pendingDownloads = {};
		var lastLinks = null;

		window.addEventListener('message', function (e) {
			var data = e.data || {};
			if (data.type === 'OTS_INVOICES_READY') {
				detectedCount = data.count;
				ensurePanel();
				if (!busy) setMainLabel();
			}
			if (data.type === 'OTS_EXTRACT_RESULT' && pendingExtract) {
				var resolve = pendingExtract;
				pendingExtract = null;
				resolve(data.links || []);
			}
			if (data.type === 'OTS_DOWNLOAD_RESULT' && data.reqId && pendingDownloads[data.reqId]) {
				var cb = pendingDownloads[data.reqId];
				delete pendingDownloads[data.reqId];
				cb(data);
			}
		});

		function iframes() {
			return Array.prototype.slice.call(document.querySelectorAll('iframe'));
		}

		function requestExtract() {
			return new Promise(function (resolve) {
				var frames = iframes();
				if (frames.length === 0 || isInIframe === false && loc.indexOf('payments.google.com') !== -1) {
					return resolve(extractRowsFromDocument());
				}
				pendingExtract = resolve;
				frames.forEach(function (f) {
					try { f.contentWindow.postMessage({ type: 'OTS_EXTRACT_REQUEST' }, '*'); } catch (err) { /* cross-origin frame without our script */ }
				});
				setTimeout(function () {
					if (pendingExtract === resolve) {
						pendingExtract = null;
						resolve(extractRowsFromDocument());
					}
				}, EXTRACT_TIMEOUT_MS);
			});
		}

		function requestDownload(link) {
			var frames = iframes();
			if (frames.length === 0) return downloadPdf(link.url);
			return new Promise(function (resolve, reject) {
				var reqId = 'dl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
				var timer = setTimeout(function () {
					delete pendingDownloads[reqId];
					reject(new Error('timeout la descarcare'));
				}, DOWNLOAD_TIMEOUT_MS);
				pendingDownloads[reqId] = function (data) {
					clearTimeout(timer);
					if (data.ok) resolve(data.pdfBase64);
					else reject(new Error(data.error || 'download esuat'));
				};
				frames.forEach(function (f) {
					try { f.contentWindow.postMessage({ type: 'OTS_DOWNLOAD_REQUEST', reqId: reqId, url: link.url, invoiceId: link.invoiceId }, '*'); } catch (err) { /* ignore */ }
				});
			});
		}

		function crmRequest(path, body) {
			var cfg = getConfig();
			var url = cfg.crmBase + '/' + cfg.tenant + path;
			return new Promise(function (resolve, reject) {
				try {
					GM_xmlhttpRequest({
						method: 'POST',
						url: url,
						headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
						data: JSON.stringify(body),
						timeout: 120000,
						onload: function (res) {
							var json = null;
							try { json = JSON.parse(res.responseText); } catch (err) { /* not json */ }
							if (res.status === 401 || res.status === 403) {
								return reject(new Error('Nu esti logat in CRM (' + cfg.crmBase + '). Deschide CRM-ul intr-un tab, logheaza-te si reincearca.'));
							}
							resolve({ status: res.status, json: json, text: res.responseText });
						},
						onerror: function () { reject(new Error('CRM inaccesibil: ' + url)); },
						ontimeout: function () { reject(new Error('CRM timeout: ' + url)); }
					});
				} catch (err) {
					reject(new Error('GM_xmlhttpRequest indisponibil: ' + err));
				}
			});
		}

		function detectCustomerId() {
			var ocid = (loc.match(/[?&]ocid=(\d+)/) || [])[1] || '';
			try {
				var saved = ocid && GM_getValue('ots_cid_' + ocid, '');
				if (saved) return String(saved).replace(/\D/g, '');
			} catch (err) { /* ignore */ }

			var candidates = [];
			document.querySelectorAll('header, [role="banner"], .top-bar, [class*="account-info"], [class*="customer"]').forEach(function (el) {
				candidates.push(el.innerText || el.textContent || '');
			});
			candidates.push((document.body.innerText || '').slice(0, 4000));
			for (var i = 0; i < candidates.length; i++) {
				var m = candidates[i].match(/\b(\d{3}-\d{3}-\d{4})\b/);
				if (m) return m[1].replace(/-/g, '');
			}
			var typed = prompt('Nu am gasit ID-ul contului Google Ads pe pagina. Introdu-l (xxx-xxx-xxxx):', '');
			if (!typed) return null;
			var cid = typed.replace(/\D/g, '');
			if (cid.length !== 10) { alert('ID invalid.'); return null; }
			try { if (ocid) GM_setValue('ots_cid_' + ocid, cid); } catch (err) { /* ignore */ }
			return cid;
		}

		function detectAccountName() {
			var t = document.title || '';
			var m = t.match(/[-–]\s*(.+?)(?:\s*[-–]|$)/);
			return m ? m[1].trim() : '';
		}

		function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

		// ── UI ─────────────────────────────────────────────────────────
		var panel, mainBtn, jsonBtn, statusEl;

		function ensurePanel() {
			if (panel) return;
			panel = document.createElement('div');
			panel.id = 'ots-panel';
			panel.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:999999;background:#fff;border:1px solid #d0d7de;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.18);padding:12px 14px;font-family:system-ui,sans-serif;font-size:13px;min-width:280px;max-width:380px;color:#1f2328;';

			var title = document.createElement('div');
			title.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;font-weight:600;';
			title.innerHTML = '<span>OTS CRM · Facturi Google Ads</span>';
			var gear = document.createElement('button');
			gear.textContent = '⚙';
			gear.title = 'Configurare CRM (adresa + tenant)';
			gear.style.cssText = 'border:none;background:transparent;cursor:pointer;font-size:15px;';
			gear.onclick = setConfigInteractive;
			title.appendChild(gear);
			panel.appendChild(title);

			statusEl = document.createElement('div');
			statusEl.style.cssText = 'color:#57606a;min-height:18px;margin-bottom:10px;white-space:pre-line;';
			panel.appendChild(statusEl);

			var row = document.createElement('div');
			row.style.cssText = 'display:flex;gap:8px;align-items:center;';
			mainBtn = document.createElement('button');
			mainBtn.style.cssText = 'flex:1;background:#009AFF;color:#fff;border:none;padding:10px 14px;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;';
			mainBtn.onclick = sendToCrm;
			jsonBtn = document.createElement('button');
			jsonBtn.textContent = '📋 JSON';
			jsonBtn.title = 'Fallback: copiaza link-urile ca JSON pentru panoul Import Facturi din CRM';
			jsonBtn.style.cssText = 'background:#f6f8fa;color:#1f2328;border:1px solid #d0d7de;padding:10px 12px;border-radius:10px;font-size:13px;cursor:pointer;';
			jsonBtn.onclick = copyJson;
			row.appendChild(mainBtn);
			row.appendChild(jsonBtn);
			panel.appendChild(row);

			document.body.appendChild(panel);
			setMainLabel();
			setStatus('Deschide Facturare → Documente pentru contul clientului, apoi apasa butonul.');
		}

		function setMainLabel(text) {
			if (!mainBtn) return;
			mainBtn.textContent = text || ('▶ Trimite in CRM' + (detectedCount ? ' (' + detectedCount + ' facturi detectate)' : ''));
		}

		function setStatus(text, color) {
			if (!statusEl) return;
			statusEl.textContent = text;
			statusEl.style.color = color || '#57606a';
		}

		function setBusy(flag) {
			busy = flag;
			if (mainBtn) { mainBtn.disabled = flag; mainBtn.style.opacity = flag ? '0.7' : '1'; }
		}

		function copyJson() {
			requestExtract().then(function (links) {
				if (!links.length) return setStatus('Nu s-au gasit facturi. Asteapta sa se incarce tabelul.', '#c00');
				var json = JSON.stringify(links, null, 2);
				try { GM_setClipboard(json, 'text'); } catch (err) { try { navigator.clipboard.writeText(json); } catch (e2) { /* ignore */ } }
				setStatus(links.length + ' link-uri copiate (JSON). Lipeste in CRM → Import Facturi.', '#00a854');
			});
		}

		function sendToCrm() {
			if (busy) return;
			var cfg = getConfig();
			var cid = detectCustomerId();
			if (!cid) return setStatus('Fara ID de cont nu pot atribui facturile.', '#c00');
			var accountName = detectAccountName();

			setBusy(true);
			setMainLabel('⏳ Se citeste tabelul...');
			setStatus('Cont ' + cid + (accountName ? ' (' + accountName + ')' : ''));

			requestExtract().then(function (links) {
				links = links.filter(function (l) { return l.url; }).map(function (l) {
					if (!l.invoiceId) {
						var m = l.url.match(/(\d{8,12})/);
						if (m) l.invoiceId = m[1];
					}
					return l;
				}).filter(function (l) { return l.invoiceId; });
				lastLinks = links;
				if (!links.length) throw new Error('Nu s-au gasit facturi in tabel. Asteapta sa se incarce pagina si reincearca.');

				setMainLabel('⏳ Verific in CRM...');
				return crmRequest('/api/google-ads/invoices/check', { customerId: cid, invoiceIds: links.map(function (l) { return l.invoiceId; }) })
					.then(function (res) {
						if (!res.json || res.json.ok !== true) {
							var msg = (res.json && res.json.message) || ('CRM a raspuns ' + res.status);
							throw new Error(msg);
						}
						var missing = {};
						(res.json.missing || []).forEach(function (id) { missing[id] = true; });
						var todo = links.filter(function (l) { return missing[l.invoiceId]; });
						var acct = res.json.account || {};
						var who = acct.clientName ? acct.clientName + ' / ' + (acct.accountName || cid) : (acct.accountName || cid);
						if (!todo.length) {
							setStatus('Toate cele ' + links.length + ' facturi sunt deja in CRM (' + who + ').', '#00a854');
							return { imported: 0, skipped: links.length, errors: 0, who: who };
						}
						return processSequentially(todo, cid, accountName, who, links.length - todo.length);
					});
			}).then(function (summary) {
				if (summary) {
					var line = '✅ ' + summary.imported + ' importate';
					if (summary.skipped) line += ', ' + summary.skipped + ' existente';
					if (summary.errors) line += ', ' + summary.errors + ' erori';
					setStatus(line + '\n' + summary.who + '\nVezi CRM → Facturi → Google Ads.', summary.errors ? '#b35c00' : '#00a854');
				}
			}).catch(function (err) {
				setStatus('❌ ' + (err && err.message || err) + (lastLinks && lastLinks.length ? '\nFallback: „JSON" copiaza link-urile pentru Import Facturi.' : ''), '#c00');
			}).then(function () {
				setBusy(false);
				setMainLabel();
			});
		}

		function processSequentially(todo, cid, accountName, who, alreadyThere) {
			var imported = 0, skipped = alreadyThere, errors = 0;
			var i = 0;
			function next() {
				if (i >= todo.length) return Promise.resolve({ imported: imported, skipped: skipped, errors: errors, who: who });
				var link = todo[i++];
				setMainLabel('⏳ ' + i + '/' + todo.length + ' · ' + link.invoiceId);
				setStatus('Descarc factura ' + link.invoiceId + (link.date ? ' (' + link.date + ')' : '') + '...');
				return requestDownload(link).then(function (pdfBase64) {
					setStatus('Trimit factura ' + link.invoiceId + ' in CRM...');
					return crmRequest('/api/google-ads/invoices/ingest', {
						customerId: cid,
						invoiceId: link.invoiceId,
						date: link.date,
						amountText: link.amount,
						accountName: accountName,
						pdfBase64: pdfBase64
					});
				}).then(function (res) {
					if (res.json && res.json.ok) {
						if (res.json.status === 'skipped') skipped++; else imported++;
					} else {
						errors++;
						console.warn('[OTS] ingest failed', link.invoiceId, res.status, res.text && res.text.slice(0, 300));
					}
				}).catch(function (err) {
					errors++;
					console.warn('[OTS] invoice failed', link.invoiceId, err);
				}).then(function () { return sleep(DELAY_BETWEEN_INVOICES_MS); }).then(next);
			}
			return next();
		}

		setTimeout(ensurePanel, 3000);
	}

	// ── Entry ──────────────────────────────────────────────────────
	if (isInIframe && loc.indexOf('payments.google.com') !== -1) {
		runInIframe();
		return;
	}
	if (loc.indexOf('ads.google.com') !== -1 && loc.indexOf('billing') !== -1) {
		runOnAdsPage();
		return;
	}
	if (!isInIframe && loc.indexOf('payments.google.com') !== -1) {
		runOnAdsPage();
	}
})();
