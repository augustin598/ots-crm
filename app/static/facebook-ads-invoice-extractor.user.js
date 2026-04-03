// ==UserScript==
// @name         Facebook Ads Invoice Extractor - OTS CRM v1.0
// @namespace    https://onetopsolution.ro
// @version      1.0
// @description  Extrage link-urile de download facturi Facebook Ads din Billing Hub
// @author       OTS CRM
// @match        https://business.facebook.com/billing_hub/*
// @match        https://business.facebook.com/latest/billing_hub/*
// @match        https://business.facebook.com/ads/manage/billing*
// @grant        GM_setClipboard
// ==/UserScript==

(function() {
    'use strict';

    var invoiceData = null;
    var state = 'idle'; // idle -> extracting -> ready

    function parseDate(text) {
        if (!text) return undefined;
        // English: "9 Apr 2025", "6 Jan 2025", "29 Oct 2024"
        var enMonths = {
            'jan':'01','january':'01','feb':'02','february':'02',
            'mar':'03','march':'03','apr':'04','april':'04',
            'may':'05','jun':'06','june':'06','jul':'07','july':'07',
            'aug':'08','august':'08','sep':'09','september':'09',
            'oct':'10','october':'10','nov':'11','november':'11',
            'dec':'12','december':'12'
        };
        var m = text.match(/(\d{1,2})\s+(\w{3,9})\s+(\d{4})/);
        if (m) {
            var mm = enMonths[m[2].toLowerCase()];
            if (mm) return m[3] + '-' + mm + '-' + m[1].padStart(2, '0');
        }
        // Romanian: "6 ian. 2025", "10 decembrie 2025"
        var roMonths = {
            'ian':'01','ianuarie':'01','feb':'02','februarie':'02',
            'mar':'03','martie':'03','apr':'04','aprilie':'04',
            'mai':'05','iun':'06','iunie':'06','iul':'07','iulie':'07',
            'aug':'08','august':'08','sep':'09','septembrie':'09',
            'oct':'10','octombrie':'10','noi':'11','noiembrie':'11',
            'dec':'12','decembrie':'12'
        };
        var m2 = text.match(/(\d{1,2})\s+([a-zăâîșț]+)\.?\s+(\d{4})/i);
        if (m2) {
            var key = m2[2].toLowerCase();
            var mm2 = roMonths[key] || roMonths[key.substring(0, 3)];
            if (mm2) return m2[3] + '-' + mm2 + '-' + m2[1].padStart(2, '0');
        }
        return undefined;
    }

    function extractInvoices() {
        var links = [];
        var seen = {};

        // Strategy 1: Find rows in the payment activity table (preferred)
        var allRows = document.querySelectorAll('[role="row"], tr');
        for (var i = 0; i < allRows.length; i++) {
            var row = allRows[i];
            var text = row.innerText || '';
            if (!text.includes('FBADS-') && !/\d{10,}-\d{10,}/.test(text)) continue;

            var invoiceMatch = text.match(/(FBADS-[\w-]+)/);
            var dateMatch = text.match(/(\d{1,2}\s+\w{3,9}\s+\d{4})/);
            var amountMatch = text.match(/(RON[\s]?[\d.,]+|USD[\s]?[\d.,]+|EUR[\s]?[\d.,]+)/);

            // Extract transaction ID from link or text
            var txid;
            var downloadUrl;
            var txLink = row.querySelector('a[href*="billing_transaction"]');
            if (txLink) {
                downloadUrl = txLink.href;
                var txidFromUrl = downloadUrl.match(/txid=([^&]+)/);
                txid = txidFromUrl ? txidFromUrl[1] : undefined;
            }
            if (!txid) {
                var allLinks = row.querySelectorAll('a[href]');
                for (var j = 0; j < allLinks.length; j++) {
                    var linkText = allLinks[j].innerText.trim();
                    if (/^\d+-\d+$/.test(linkText)) {
                        txid = linkText;
                        break;
                    }
                }
            }
            if (!downloadUrl) {
                var actionLinks = row.querySelectorAll('a[href*="pdf"], a[download], a[aria-label*="Download"], a[aria-label*="Descarcă"]');
                if (actionLinks.length > 0) downloadUrl = actionLinks[0].href;
            }

            if ((invoiceMatch || txid) && !seen[txid || invoiceMatch[1]]) {
                seen[txid || invoiceMatch[1]] = true;
                links.push({
                    url: downloadUrl || '',
                    txid: txid,
                    invoiceId: invoiceMatch ? invoiceMatch[1] : undefined,
                    date: dateMatch ? parseDate(dateMatch[1]) : undefined,
                    amount: amountMatch ? amountMatch[1] : undefined
                });
            }
        }

        // Strategy 2: Fallback — find billing_transaction links directly
        if (links.length === 0) {
            document.querySelectorAll('a[href*="billing_transaction"]').forEach(function(a) {
                var url = a.href;
                if (!url || !url.includes('pdf=true')) return;
                if (seen[url]) return;
                seen[url] = true;

                var row = a.closest('[role="row"]') || a.closest('tr');
                var text = row ? row.innerText : '';

                var txidMatch = url.match(/txid=([^&]+)/);
                var txid = txidMatch ? txidMatch[1] : undefined;

                var invoiceMatch = text.match(/(FBADS-[\w-]+)/);
                var dateMatch = text.match(/(\d{1,2}\s+\w{3,9}\s+\d{4})/);
                var amountMatch = text.match(/(RON[\d.,]+|USD[\d.,]+|EUR[\d.,]+)/);

                links.push({
                    url: url,
                    txid: txid,
                    invoiceId: invoiceMatch ? invoiceMatch[1] : undefined,
                    date: dateMatch ? parseDate(dateMatch[1]) : undefined,
                    amount: amountMatch ? amountMatch[1] : undefined
                });
            });
        }

        return links;
    }

    function copyToClipboard(text) {
        try {
            GM_setClipboard(text, 'text');
            return true;
        } catch(e) {}
        try {
            navigator.clipboard.writeText(text);
            return true;
        } catch(e) {}
        try {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position:fixed;left:-9999px';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            return true;
        } catch(e) {}
        return false;
    }

    function setReady(count) {
        state = 'ready';
        var btn = document.getElementById('ots-fb-btn');
        if (btn) {
            btn.textContent = '📋 Copiază ' + count + ' facturi';
            btn.style.background = '#00a854';
        }
    }

    function setIdle() {
        state = 'idle';
        invoiceData = null;
        var btn = document.getElementById('ots-fb-btn');
        if (btn) {
            btn.style.background = '#1877F2';
            btn.textContent = '▶ Extrage Facturi Facebook';
        }
    }

    function setError(msg) {
        state = 'idle';
        invoiceData = null;
        var btn = document.getElementById('ots-fb-btn');
        if (btn) {
            btn.textContent = '❌ ' + msg;
            btn.style.background = '#c00';
            setTimeout(setIdle, 4000);
        }
    }

    function createButton() {
        if (document.getElementById('ots-fb-btn')) return;

        var btn = document.createElement('button');
        btn.id = 'ots-fb-btn';
        btn.textContent = '▶ Extrage Facturi Facebook';
        btn.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:999999;background:#1877F2;color:#fff;border:none;padding:12px 20px;border-radius:12px;font-size:14px;font-weight:600;cursor:pointer;font-family:system-ui,sans-serif;box-shadow:0 4px 20px rgba(24,119,242,0.4);display:flex;align-items:center;gap:8px;transition:all 0.2s;';

        btn.onmouseenter = function() { btn.style.transform = 'scale(1.05)'; };
        btn.onmouseleave = function() { btn.style.transform = 'scale(1)'; };

        btn.onclick = function() {
            if (state === 'idle') {
                state = 'extracting';
                btn.textContent = '⏳ Se extrag...';
                btn.style.background = '#f59e0b';

                // Small delay to let UI update
                setTimeout(function() {
                    var links = extractInvoices();
                    if (links.length > 0) {
                        invoiceData = links;
                        setReady(links.length);
                    } else {
                        setError('Nu am găsit facturi. Scroll jos pentru a încărca mai multe.');
                    }
                }, 500);

            } else if (state === 'ready' && invoiceData && invoiceData.length > 0) {
                var json = JSON.stringify(invoiceData, null, 2);
                var ok = copyToClipboard(json);
                if (ok) {
                    btn.textContent = '✅ ' + invoiceData.length + ' facturi copiate! Mergi în CRM.';
                    btn.style.background = '#00a854';

                    // Also log to console for backup
                    console.log('=== Facebook Ads Invoices ===');
                    console.log(json);
                    console.log('Copiat ' + invoiceData.length + ' facturi în clipboard!');

                    setTimeout(setIdle, 5000);
                } else {
                    setError('Eroare la copiere.');
                }
            }
        };

        document.body.appendChild(btn);
    }

    // Wait for page to load, then show button
    setTimeout(createButton, 3000);

    // Re-check if button got removed (SPA navigation)
    setInterval(function() {
        if (!document.getElementById('ots-fb-btn') && (window.location.href.includes('billing') || window.location.href.includes('billing_hub'))) {
            createButton();
        }
    }, 5000);
})();
