// ==UserScript==
// @name         LinksCheck - Dofollow / Nofollow
// @namespace    https://github.com/
// @version      1.0
// @description  Verifică linkurile din articol: dofollow vs nofollow
// @author       You
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// ==/UserScript==

(function() {
  'use strict';

  const CSS = `
    @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
    #linkscheck-overlay { position: fixed; inset: 0; z-index: 999999; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; padding: 2rem; font-family: 'Space Grotesk', system-ui, sans-serif; }
    #linkscheck-overlay * { box-sizing: border-box; }
    #linkscheck-panel { background: #18181c; border: 1px solid #2d2d35; border-radius: 16px; width: 90%; height: 92vh; max-height: 92vh; overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 24px 48px rgba(0,0,0,0.5); }
    #linkscheck-header { display: flex; align-items: center; justify-content: space-between; padding: 1.25rem 1.5rem; border-bottom: 1px solid #2d2d35; }
    #linkscheck-title { font-size: 1.5rem; font-weight: 700; color: #e8e8ec; }
    #linkscheck-close { width: 44px; height: 44px; border: none; background: #222228; color: #8888a0; border-radius: 10px; cursor: pointer; font-size: 1.5rem; display: flex; align-items: center; justify-content: center; transition: all 0.2s; }
    #linkscheck-close:hover { background: #2d2d35; color: #e8e8ec; }
    #linkscheck-body { padding: 1.5rem 1.75rem; overflow-y: auto; flex: 1; min-height: 0; }
    #linkscheck-stats { display: flex; gap: 1.25rem; margin-bottom: 1.25rem; flex-wrap: wrap; }
    .linkscheck-stat { flex: 1; min-width: 140px; background: #222228; border-radius: 12px; padding: 1.25rem 1.5rem; }
    .linkscheck-stat.total { border-left: 4px solid #8b5cf6; }
    .linkscheck-stat.dofollow { border-left: 4px solid #22c55e; }
    .linkscheck-stat.nofollow { border-left: 4px solid #f59e0b; }
    .linkscheck-stat-value { font-size: 2rem; font-weight: 700; color: #e8e8ec; }
    .linkscheck-stat-label { font-size: 0.85rem; color: #8888a0; text-transform: uppercase; letter-spacing: 0.08em; margin-top: 0.25rem; }
    #linkscheck-filters { display: flex; gap: 0.75rem; margin-bottom: 1.25rem; }
    .linkscheck-filter { padding: 0.65rem 1.25rem; border-radius: 999px; font-size: 0.95rem; font-weight: 500; background: #222228; border: 1px solid #2d2d35; color: #8888a0; cursor: pointer; transition: all 0.2s; }
    .linkscheck-filter:hover { color: #e8e8ec; border-color: #8888a0; }
    .linkscheck-filter.active { background: rgba(139,92,246,0.25); border-color: #8b5cf6; color: #8b5cf6; }
    .linkscheck-filter.dofollow.active { background: rgba(34,197,94,0.2); border-color: #22c55e; color: #22c55e; }
    .linkscheck-filter.nofollow.active { background: rgba(245,158,11,0.2); border-color: #f59e0b; color: #f59e0b; }
    #linkscheck-table { width: 100%; border-collapse: collapse; background: #222228; border-radius: 12px; overflow: hidden; border: 1px solid #2d2d35; font-size: 1rem; }
    #linkscheck-table thead { background: #18181c; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.08em; color: #8888a0; }
    #linkscheck-table th { text-align: left; padding: 1rem 1.25rem; font-weight: 600; }
    #linkscheck-table td { padding: 1rem 1.25rem; border-top: 1px solid #2d2d35; font-size: 1rem; color: #e8e8ec; }
    #linkscheck-table tr:hover td { background: rgba(255,255,255,0.03); }
    #linkscheck-table tr.hidden { display: none; }
    .linkscheck-badge { display: inline-block; padding: 0.35rem 0.75rem; border-radius: 999px; font-size: 0.8rem; font-weight: 600; text-transform: uppercase; }
    .linkscheck-badge.dofollow { background: rgba(34,197,94,0.2); color: #22c55e; }
    .linkscheck-badge.nofollow { background: rgba(245,158,11,0.2); color: #f59e0b; }
    .linkscheck-keyword { font-weight: 500; max-width: 400px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 1rem; }
    .linkscheck-url { font-family: 'JetBrains Mono', monospace; font-size: 0.9rem; color: #8888a0; max-width: 500px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .linkscheck-copy-wrap { display: flex; align-items: center; gap: 0.5rem; }
    .linkscheck-copy-btn { flex-shrink: 0; width: 32px; height: 32px; padding: 0; border: none; background: #2d2d35; border-radius: 6px; color: #8888a0; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; }
    .linkscheck-copy-btn:hover { background: #8b5cf6; color: #fff; }
    .linkscheck-copy-btn.copied { background: #22c55e; color: #fff; }
    .linkscheck-copy-btn svg { width: 16px; height: 16px; }
    .linkscheck-url a { color: #8b5cf6; text-decoration: none; }
    .linkscheck-url a:hover { text-decoration: underline; }
    .linkscheck-empty { text-align: center; padding: 3rem; color: #8888a0; font-size: 1.1rem; }
    #linkscheck-domain { display: flex; align-items: center; gap: 1rem; margin-bottom: 1.25rem; flex-wrap: wrap; }
    #linkscheck-domain label { font-size: 1rem; color: #8888a0; white-space: nowrap; }
    #linkscheck-domain-select { min-width: 200px; padding: 0.75rem 1rem; background: #222228; border: 1px solid #2d2d35; border-radius: 10px; color: #e8e8ec; font-size: 1rem; cursor: pointer; }
    #linkscheck-domain-select:focus { outline: none; border-color: #8b5cf6; }
    #linkscheck-domain-new { flex: 1; min-width: 120px; padding: 0.75rem 1rem; background: #222228; border: 1px solid #2d2d35; border-radius: 10px; color: #e8e8ec; font-size: 1rem; }
    #linkscheck-domain-new::placeholder { color: #8888a0; }
    .linkscheck-domain-add { padding: 0.75rem 1rem; background: #2d2d35; border: 1px solid #3d3d45; border-radius: 10px; color: #e8e8ec; font-size: 0.95rem; cursor: pointer; }
    .linkscheck-domain-add:hover { background: #3d3d45; }
    #linkscheck-paste { margin-bottom: 1.25rem; }
    #linkscheck-paste textarea { width: 100%; min-height: 80px; padding: 0.75rem 1rem; background: #222228; border: 1px solid #2d2d35; border-radius: 10px; color: #e8e8ec; font-size: 0.9rem; font-family: monospace; resize: vertical; }
    #linkscheck-paste textarea::placeholder { color: #8888a0; }
    #linkscheck-paste-btn { margin-top: 0.5rem; padding: 0.5rem 1rem; background: #2d2d35; border: 1px solid #3d3d45; border-radius: 8px; color: #e8e8ec; cursor: pointer; font-size: 0.9rem; }
    #linkscheck-paste-btn:hover { background: #3d3d45; }
    #linkscheck-fab { position: fixed; bottom: 1.5rem; right: 1.5rem; width: 52px; height: 52px; border-radius: 50%; border: none; background: linear-gradient(135deg, #8b5cf6, #7c3aed); color: white; font-size: 1.25rem; cursor: pointer; box-shadow: 0 4px 20px rgba(139,92,246,0.5); z-index: 999998; display: flex; align-items: center; justify-content: center; transition: transform 0.2s, box-shadow 0.2s; }
    #linkscheck-fab:hover { transform: scale(1.05); box-shadow: 0 6px 24px rgba(139,92,246,0.6); }
    #linkscheck-fab svg { width: 24px; height: 24px; }
  `;

  function parseLinksFromDoc(doc) {
    const container = doc.getElementById('article-content') || doc.querySelector('article') || doc.body;
    const links = container.querySelectorAll('a[href]');
    const results = [];
    links.forEach((a, i) => {
      const href = a.getAttribute('href')?.trim() || '';
      const anchorText = a.textContent?.trim() || '(fără text)';
      const rel = (a.getAttribute('rel') || '').toLowerCase();
      const isNofollow = rel.includes('nofollow');
      const type = isNofollow ? 'nofollow' : 'dofollow';
      if (!href || href === '#' || href.startsWith('javascript:')) return;
      results.push({ index: i + 1, keyword: anchorText, url: href, type });
    });
    return results;
  }

  function parseLinks() {
    return parseLinksFromDoc(document);
  }

  function parseLinksFromHtml(htmlString) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');
    return parseLinksFromDoc(doc);
  }

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  const STORAGE_KEY = 'linkscheck-saved-domains';

  function getSavedDomains() {
    try {
      const s = typeof GM_getValue !== 'undefined' ? GM_getValue(STORAGE_KEY, '[]') : (localStorage.getItem(STORAGE_KEY) || '[]');
      return JSON.parse(s);
    } catch (e) { return []; }
  }

  function saveDomain(domain) {
    const d = domain.trim().toLowerCase();
    if (!d) return;
    const list = getSavedDomains();
    if (list.includes(d)) return;
    list.push(d);
    try {
      if (typeof GM_setValue !== 'undefined') GM_setValue(STORAGE_KEY, JSON.stringify(list));
      else localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (e) {}
  }

  function openLinksCheck() {
    if (document.getElementById('linkscheck-overlay')) return;

    const results = parseLinks();
    const dofollow = results.filter(r => r.type === 'dofollow');
    const nofollow = results.filter(r => r.type === 'nofollow');

    if (!document.getElementById('linkscheck-styles')) {
      const style = document.createElement('style');
      style.id = 'linkscheck-styles';
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    const overlay = document.createElement('div');
    overlay.id = 'linkscheck-overlay';
    overlay.innerHTML = `
      <div id="linkscheck-panel">
        <div id="linkscheck-header">
          <span id="linkscheck-title">LinksCheck – Dofollow / Nofollow</span>
          <button id="linkscheck-close" type="button" aria-label="Închide">&times;</button>
        </div>
        <div id="linkscheck-body">
          <div id="linkscheck-stats">
            <div class="linkscheck-stat total"><div class="linkscheck-stat-value">${results.length}</div><div class="linkscheck-stat-label">Total</div></div>
            <div class="linkscheck-stat dofollow"><div class="linkscheck-stat-value">${dofollow.length}</div><div class="linkscheck-stat-label">Dofollow</div></div>
            <div class="linkscheck-stat nofollow"><div class="linkscheck-stat-value">${nofollow.length}</div><div class="linkscheck-stat-label">Nofollow</div></div>
          </div>
          <div id="linkscheck-paste">
            <textarea id="linkscheck-html-input" placeholder="Lipește HTML aici pentru analiză (ex: un fragment de pagină cu linkuri)"></textarea>
            <button type="button" id="linkscheck-paste-btn">Analizează HTML lipit</button>
          </div>
          <div id="linkscheck-domain">
            <label for="linkscheck-domain-select">Filtrează după domeniu:</label>
            <select id="linkscheck-domain-select">
              <option value="">— Toate —</option>
              ${(getSavedDomains() || []).map(d => `<option value="${esc(d)}">${esc(d)}</option>`).join('')}
            </select>
            <input type="text" id="linkscheck-domain-new" placeholder="Domeniu nou (ex: glemis.ro)" />
            <button type="button" class="linkscheck-domain-add">Adaugă</button>
          </div>
          <div id="linkscheck-filters">
            <button class="linkscheck-filter active" data-f="all">Toate</button>
            <button class="linkscheck-filter dofollow" data-f="dofollow">Dofollow</button>
            <button class="linkscheck-filter nofollow" data-f="nofollow">Nofollow</button>
          </div>
          <div id="linkscheck-results">${results.length ? `
          <table id="linkscheck-table">
            <thead><tr><th style="width:60px">#</th><th style="width:120px">Tip</th><th>Cuvânt cheie</th><th>URL</th><th style="width:90px">Copy</th></tr></thead>
            <tbody>
              ${results.map(r => `
                <tr data-type="${r.type}" data-url="${esc(r.url.toLowerCase())}" data-keyword="${esc(r.keyword)}" data-link="${esc(r.url)}">
                  <td>${r.index}</td>
                  <td><span class="linkscheck-badge ${r.type}">${r.type}</span></td>
                  <td><span class="linkscheck-keyword" title="${esc(r.keyword)}">${esc(r.keyword)}</span></td>
                  <td><span class="linkscheck-url"><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.url)}</a></span></td>
                  <td>
                    <div class="linkscheck-copy-wrap">
                      <button class="linkscheck-copy-btn" type="button" title="Copiază cuvânt cheie" data-copy="keyword"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg></button>
                      <button class="linkscheck-copy-btn" type="button" title="Copiază link" data-copy="link"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg></button>
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          ` : `
          <div class="linkscheck-empty">
            Nu s-au găsit linkuri. Lipește HTML mai sus sau verifică că pagina conține #article-content sau &lt;article&gt;.
          </div>
          `}</div>
        </div>
      </div>
    `;

    overlay.addEventListener('click', e => {
      if (e.target.id === 'linkscheck-overlay' || e.target.id === 'linkscheck-close') closeLinksCheck();
    });

    function applyFilters() {
      const typeFilter = overlay.querySelector('.linkscheck-filter.active')?.dataset.f || 'all';
      const domainVal = (overlay.querySelector('#linkscheck-domain-select')?.value || '').trim().toLowerCase();
      const rows = overlay.querySelectorAll('#linkscheck-table tbody tr');
      let visibleCount = 0;
      let dfCount = 0, nfCount = 0;
      rows.forEach(tr => {
        const typeMatch = typeFilter === 'all' || tr.dataset.type === typeFilter;
        const domainMatch = !domainVal || (tr.dataset.url || '').includes(domainVal);
        const show = typeMatch && domainMatch;
        tr.classList.toggle('hidden', !show);
        if (show) { visibleCount++; if (tr.dataset.type === 'dofollow') dfCount++; else nfCount++; }
      });
      const stats = overlay.querySelectorAll('.linkscheck-stat');
      if (stats.length >= 3) {
        stats[0].querySelector('.linkscheck-stat-value').textContent = visibleCount;
        stats[0].querySelector('.linkscheck-stat-label').textContent = domainVal ? 'Total (' + domainVal + ')' : 'Total';
        stats[1].querySelector('.linkscheck-stat-value').textContent = dfCount;
        stats[2].querySelector('.linkscheck-stat-value').textContent = nfCount;
      }
    }

    overlay.querySelectorAll('.linkscheck-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        overlay.querySelectorAll('.linkscheck-filter').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        applyFilters();
      });
    });

    overlay.querySelector('#linkscheck-domain-select')?.addEventListener('change', applyFilters);

    overlay.querySelector('.linkscheck-domain-add')?.addEventListener('click', () => {
      const input = overlay.querySelector('#linkscheck-domain-new');
      const val = input?.value?.trim() || '';
      if (!val) return;
      saveDomain(val);
      const sel = overlay.querySelector('#linkscheck-domain-select');
      const opt = document.createElement('option');
      opt.value = val.toLowerCase();
      opt.textContent = val.toLowerCase();
      sel.appendChild(opt);
      sel.value = val.toLowerCase();
      input.value = '';
      applyFilters();
    });

    overlay.querySelector('#linkscheck-domain-new')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') overlay.querySelector('.linkscheck-domain-add')?.click();
    });

    function buildTableRows(results) {
      return results.map(r => `
        <tr data-type="${r.type}" data-url="${esc(r.url.toLowerCase())}" data-keyword="${esc(r.keyword)}" data-link="${esc(r.url)}">
          <td>${r.index}</td>
          <td><span class="linkscheck-badge ${r.type}">${r.type}</span></td>
          <td><span class="linkscheck-keyword" title="${esc(r.keyword)}">${esc(r.keyword)}</span></td>
          <td><span class="linkscheck-url"><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.url)}</a></span></td>
          <td>
            <div class="linkscheck-copy-wrap">
              <button class="linkscheck-copy-btn" type="button" title="Copiază cuvânt cheie" data-copy="keyword"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg></button>
              <button class="linkscheck-copy-btn" type="button" title="Copiază link" data-copy="link"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg></button>
            </div>
          </td>
        </tr>
      `).join('');
    }

    function updateResults(newResults) {
      const df = newResults.filter(r => r.type === 'dofollow');
      const nf = newResults.filter(r => r.type === 'nofollow');
      overlay.querySelectorAll('.linkscheck-stat')[0].querySelector('.linkscheck-stat-value').textContent = newResults.length;
      overlay.querySelectorAll('.linkscheck-stat')[0].querySelector('.linkscheck-stat-label').textContent = 'Total';
      overlay.querySelectorAll('.linkscheck-stat')[1].querySelector('.linkscheck-stat-value').textContent = df.length;
      overlay.querySelectorAll('.linkscheck-stat')[2].querySelector('.linkscheck-stat-value').textContent = nf.length;
      overlay.querySelector('#linkscheck-domain-select').value = '';
      const resultsDiv = overlay.querySelector('#linkscheck-results');
      if (!resultsDiv) return;
      if (newResults.length) {
        const tableHtml = `<table id="linkscheck-table">
          <thead><tr><th style="width:60px">#</th><th style="width:120px">Tip</th><th>Cuvânt cheie</th><th>URL</th><th style="width:90px">Copy</th></tr></thead>
          <tbody>${buildTableRows(newResults)}</tbody>
        </table>`;
        resultsDiv.innerHTML = tableHtml;
      } else {
        resultsDiv.innerHTML = `<div class="linkscheck-empty">Nu s-au găsit linkuri. Lipește HTML mai sus sau verifică că pagina conține #article-content sau &lt;article&gt;.</div>`;
      }
      applyFilters();
      overlay.querySelectorAll('.linkscheck-copy-btn').forEach(btn => {
        btn.onclick = () => {
          const tr = btn.closest('tr');
          const copyType = btn.dataset.copy;
          const text = copyType === 'keyword' ? (tr.dataset.keyword || '') : (tr.dataset.link || '');
          navigator.clipboard.writeText(text).then(() => {
            btn.classList.add('copied');
            const origTitle = btn.title;
            btn.title = copyType === 'keyword' ? 'Copiat!' : 'Link copiat!';
            setTimeout(() => { btn.classList.remove('copied'); btn.title = origTitle; }, 800);
          });
        };
      });
    }

    overlay.querySelector('#linkscheck-paste-btn')?.addEventListener('click', () => {
      const html = overlay.querySelector('#linkscheck-html-input')?.value?.trim() || '';
      if (!html) return;
      const parsed = parseLinksFromHtml(html);
      updateResults(parsed);
    });

    overlay.querySelectorAll('.linkscheck-copy-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tr = btn.closest('tr');
        const copyType = btn.dataset.copy;
        const text = copyType === 'keyword' ? (tr.dataset.keyword || '') : (tr.dataset.link || '');
        navigator.clipboard.writeText(text).then(() => {
          btn.classList.add('copied');
          const origTitle = btn.title;
          btn.title = copyType === 'keyword' ? 'Copiat!' : 'Link copiat!';
          setTimeout(() => { btn.classList.remove('copied'); btn.title = origTitle; }, 800);
        });
      });
    });

    document.body.appendChild(overlay);
  }

  function closeLinksCheck() {
    const el = document.getElementById('linkscheck-overlay');
    if (el) el.remove();
  }

  function addFab() {
    if (document.getElementById('linkscheck-fab')) return;
    const style = document.createElement('style');
    style.id = 'linkscheck-styles';
    style.textContent = CSS;
    if (!document.getElementById('linkscheck-styles')) document.head.appendChild(style);
    const fab = document.createElement('button');
    fab.id = 'linkscheck-fab';
    fab.title = 'LinksCheck – Verifică linkuri dofollow/nofollow';
    fab.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>`;
    fab.addEventListener('click', openLinksCheck);
    document.body.appendChild(fab);
  }

  addFab();
})();
