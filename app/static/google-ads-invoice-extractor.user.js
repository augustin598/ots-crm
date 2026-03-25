// ==UserScript==
// @name         Google Ads Invoice Extractor - OTS CRM
// @namespace    https://onetopsolution.ro
// @version      2.1
// @description  Extrage link-urile de download facturi Google Ads
// @author       OTS CRM
// @match        https://ads.google.com/*
// @match        https://payments.google.com/*
// @grant        GM_setClipboard
// @grant        unsafeWindow
// ==/UserScript==

(function() {
    'use strict';

    // Only run on billing/documents pages
    var loc = window.location.href;
    var isBillingPage = loc.includes('/billing/documents') || loc.includes('/documentcenter');
    var isInIframe = (window.self !== window.top);

    // If we're in the payments.google.com iframe - extract and send to parent
    if (isInIframe && loc.includes('payments.google.com')) {
        runInIframe();
        return;
    }

    // If we're on ads.google.com billing page - show button
    if (loc.includes('ads.google.com') && loc.includes('billing')) {
        runOnAdsPage();
        return;
    }

    // If we're directly on payments.google.com (not iframe)
    if (!isInIframe && loc.includes('payments.google.com')) {
        runOnAdsPage();
        return;
    }

    // === IFRAME CODE (runs inside payments.google.com iframe) ===
    function runInIframe() {
        var monthMap = {
            'ian':'01','feb':'02','mar':'03','apr':'04','mai':'05','iun':'06',
            'iul':'07','aug':'08','sep':'09','oct':'10','nov':'11','dec':'12',
            'ianuarie':'01','februarie':'02','martie':'03','aprilie':'04',
            'iunie':'06','iulie':'07','august':'08',
            'septembrie':'09','octombrie':'10','noiembrie':'11','decembrie':'12'
        };

        function parseDate(text) {
            var m = text.match(/(\d{1,2})\s+(ian(?:uarie)?|feb(?:ruarie)?|mar(?:tie)?|apr(?:ilie)?|mai|iun(?:ie)?|iul(?:ie)?|aug(?:ust)?|sep(?:tembrie)?|oct(?:ombrie)?|nov(?:embrie)?|dec(?:embrie)?)\.?\s+(\d{4})/i);
            if (!m) return undefined;
            var key = m[2].toLowerCase().replace('.','');
            var mm = monthMap[key] || monthMap[key.substring(0,3)] || '01';
            return m[3] + '-' + mm + '-' + m[1].padStart(2,'0');
        }

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

        // Listen for extraction requests from parent
        window.addEventListener('message', function(e) {
            if (e.data && e.data.type === 'OTS_EXTRACT_REQUEST') {
                var links = extract();
                window.parent.postMessage({ type: 'OTS_EXTRACT_RESULT', links: links }, '*');
            }
        });

        // Also auto-send when data-url elements appear
        function checkAndNotify() {
            var count = document.querySelectorAll('[data-url*="apis-secure"]').length;
            if (count > 0) {
                window.parent.postMessage({ type: 'OTS_INVOICES_READY', count: count }, '*');
            }
        }
        setInterval(checkAndNotify, 2000);
        setTimeout(checkAndNotify, 3000);
    }

    // === PARENT PAGE CODE (runs on ads.google.com) ===
    function runOnAdsPage() {
        var invoiceData = null;

        // Listen for messages from iframe
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
                    // Re-request count
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
                // Also try direct extraction (if not in iframe)
                setTimeout(function() {
                    if (!invoiceData || invoiceData.length === 0) {
                        // Try direct search in main doc too
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

        // Create button after a delay
        setTimeout(function() { createButton(0); }, 3000);
    }
})();
