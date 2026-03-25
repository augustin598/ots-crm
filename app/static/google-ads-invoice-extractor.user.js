// ==UserScript==
// @name         Google Ads Invoice Extractor - OTS CRM
// @namespace    https://onetopsolution.ro
// @version      2.2
// @description  Extrage link-urile de download facturi Google Ads
// @author       OTS CRM
// @match        https://ads.google.com/*
// @match        https://payments.google.com/*
// @grant        GM_setClipboard
// @grant        unsafeWindow
// ==/UserScript==

(function() {
    'use strict';

    var loc = window.location.href;
    var isInIframe = (window.self !== window.top);

    if (isInIframe && loc.includes('payments.google.com')) {
        runInIframe();
        return;
    }

    if (loc.includes('ads.google.com') && loc.includes('billing')) {
        runOnAdsPage();
        return;
    }

    if (!isInIframe && loc.includes('payments.google.com')) {
        runOnAdsPage();
        return;
    }

    function parseDate(text) {
        if (!text) return undefined;
        // Month names in Romanian (short and long)
        var months = {
            'ian':'01','ianuarie':'01',
            'feb':'02','februarie':'02',
            'mar':'03','martie':'03',
            'apr':'04','aprilie':'04',
            'mai':'05',
            'iun':'06','iunie':'06',
            'iul':'07','iulie':'07',
            'aug':'08','august':'08',
            'sep':'09','septembrie':'09',
            'oct':'10','octombrie':'10',
            'noi':'11','noiembrie':'11','noiembre':'11',
            'dec':'12','decembrie':'12'
        };

        // Try: "30 noiembrie 2025" or "10 decembrie 2025" or "31 oct. 2025"
        var m = text.match(/(\d{1,2})\s+([a-zăâîșț]+)\.?\s+(\d{4})/i);
        if (m) {
            var monthKey = m[2].toLowerCase().replace('.', '');
            var mm = months[monthKey];
            if (!mm) {
                // Try first 3 chars
                mm = months[monthKey.substring(0, 3)];
            }
            if (mm) {
                return m[3] + '-' + mm + '-' + m[1].padStart(2, '0');
            }
        }

        // Try English: "November 30, 2025" or "Dec 10, 2025"
        var enMonths = {
            'jan':'01','january':'01','feb':'02','february':'02',
            'mar':'03','march':'03','apr':'04','april':'04',
            'may':'05','jun':'06','june':'06','jul':'07','july':'07',
            'aug':'08','august':'08','sep':'09','september':'09',
            'oct':'10','october':'10','nov':'11','november':'11',
            'dec':'12','december':'12'
        };
        var m2 = text.match(/([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/i);
        if (m2) {
            var enKey = m2[1].toLowerCase();
            var enMm = enMonths[enKey] || enMonths[enKey.substring(0, 3)];
            if (enMm) {
                return m2[3] + '-' + enMm + '-' + m2[2].padStart(2, '0');
            }
        }

        return undefined;
    }

    // === IFRAME CODE ===
    function runInIframe() {
        function extract() {
            var links = [];
            document.querySelectorAll('[data-url]').forEach(function(el) {
                var url = el.getAttribute('data-url');
                if (url && url.includes('/payments/apis-secure/doc')) {
                    var row = el.closest('tr') || el.closest('[role="row"]');
                    var text = row ? row.innerText : '';
                    var idMatch = text.match(/(\d{8,12})/);
                    links.push({
                        url: url.replace(/&amp;/g, '&'),
                        invoiceId: idMatch ? idMatch[1] : undefined,
                        date: parseDate(text)
                    });
                }
            });
            var seen = {};
            return links.filter(function(l) {
                if (seen[l.url]) return false;
                seen[l.url] = true;
                return true;
            });
        }

        window.addEventListener('message', function(e) {
            if (e.data && e.data.type === 'OTS_EXTRACT_REQUEST') {
                var links = extract();
                window.parent.postMessage({ type: 'OTS_EXTRACT_RESULT', links: links }, '*');
            }
        });

        function checkAndNotify() {
            var count = document.querySelectorAll('[data-url*="apis-secure"]').length;
            if (count > 0) {
                window.parent.postMessage({ type: 'OTS_INVOICES_READY', count: count }, '*');
            }
        }
        setInterval(checkAndNotify, 2000);
        setTimeout(checkAndNotify, 3000);
    }

    // === PARENT PAGE CODE ===
    function runOnAdsPage() {
        var invoiceData = null;

        window.addEventListener('message', function(e) {
            if (e.data && e.data.type === 'OTS_INVOICES_READY') {
                updateLabel(e.data.count);
            }
            if (e.data && e.data.type === 'OTS_EXTRACT_RESULT') {
                invoiceData = e.data.links;
                if (invoiceData.length > 0) {
                    var json = JSON.stringify(invoiceData, null, 2);
                    GM_setClipboard(json, 'text');
                    showStatus(invoiceData.length + ' facturi copiate in clipboard! Mergi in CRM > Import Facturi.', '#00a854');
                } else {
                    showStatus('Nu s-au gasit facturi in iframe.', '#c00');
                }
            }
        });

        function updateLabel(count) {
            var btn = document.getElementById('ots-btn');
            if (btn) {
                btn.textContent = 'OTS CRM - Copiaza ' + count + ' facturi';
                btn.style.display = 'flex';
            } else {
                createButton(count);
            }
        }

        function showStatus(msg, color) {
            var btn = document.getElementById('ots-btn');
            if (btn) {
                btn.textContent = msg;
                btn.style.background = color;
                setTimeout(function() {
                    btn.style.background = '#009AFF';
                    requestExtractFromIframes();
                }, 4000);
            }
        }

        function requestExtractFromIframes() {
            var iframes = document.querySelectorAll('iframe');
            iframes.forEach(function(f) {
                try { f.contentWindow.postMessage({ type: 'OTS_EXTRACT_REQUEST' }, '*'); } catch(e) {}
            });
        }

        function createButton(count) {
            if (document.getElementById('ots-btn')) return;

            var btn = document.createElement('button');
            btn.id = 'ots-btn';
            btn.textContent = 'OTS CRM - Copiaza ' + (count || '?') + ' facturi';
            btn.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:999999;background:#009AFF;color:#fff;border:none;padding:12px 20px;border-radius:12px;font-size:14px;font-weight:600;cursor:pointer;font-family:system-ui,sans-serif;box-shadow:0 4px 20px rgba(0,154,255,0.4);display:flex;align-items:center;gap:8px;';

            btn.onclick = function() {
                btn.textContent = 'Se extrag...';
                requestExtractFromIframes();
                setTimeout(function() {
                    if (!invoiceData || invoiceData.length === 0) {
                        var directLinks = [];
                        document.querySelectorAll('[data-url*="apis-secure"]').forEach(function(el) {
                            directLinks.push({ url: el.getAttribute('data-url').replace(/&amp;/g, '&') });
                        });
                        if (directLinks.length > 0) {
                            var json = JSON.stringify(directLinks, null, 2);
                            GM_setClipboard(json, 'text');
                            showStatus(directLinks.length + ' facturi copiate!', '#00a854');
                        } else {
                            showStatus('Asteapta, se incarca...', '#f59e0b');
                        }
                    }
                }, 2000);
            };

            document.body.appendChild(btn);
        }

        setTimeout(function() { createButton(0); }, 3000);
    }
})();
