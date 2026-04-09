// ==UserScript==
// @name         TikTok Ads – Select multiple videos by URL (Enhanced)
// @namespace    ots.tools
// @version      2.0
// @description  Caută și selectează mai multe videoclipuri în biblioteca TikTok Ads pe baza URL-urilor furnizate - versiune îmbunătățită
// @author       OTS Enhanced
// @match        https://ads.tiktok.com/*
// @match        https://business.tiktok.com/*
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function () {
  "use strict";

  // Configurări îmbunătățite
  const CONFIG = {
    TIMEOUT_MS: 45000, // Timeout mărit pentru căutare
    SCROLL_DELAY: 300, // Delay redus pentru scroll mai rapid
    SELECTION_DELAY: 800, // Delay între selecții
    SCROLL_STEP: 500, // Pas de scroll mai mare
    MAX_RETRIES: 3, // Numărul maxim de reîncercări
    HIGHLIGHT_COLOR: '#1db954',
    ERROR_COLOR: '#ff4757'
  };

  // Logger îmbunătățit
  const Logger = {
    log: (message, data = null) => {
      console.log(`[TikTok Ads Enhanced] ${message}`, data || '');
    },
    warn: (message, data = null) => {
      console.warn(`[TikTok Ads Enhanced] ⚠️ ${message}`, data || '');
    },
    error: (message, data = null) => {
      console.error(`[TikTok Ads Enhanced] ❌ ${message}`, data || '');
    },
    success: (message, data = null) => {
      console.log(`[TikTok Ads Enhanced] ✅ ${message}`, data || '');
    }
  };

  // Extragere îmbunătățită de ID-uri din URL-uri
  function extractVideoIdFromUrl(url) {
    if (!url || typeof url !== 'string') return null;

    // Patterns pentru diferite formate de URL-uri TikTok
    const patterns = [
      /\/video\/(\d+)/,
      /tiktok\.com\/.*?\/video\/(\d+)/,
      /vm\.tiktok\.com\/(\w+)/,
      /vt\.tiktok\.com\/(\w+)/,
      /t\.tiktok\.com\/(\w+)/,
      /www\.tiktok\.com\/@[\w.-]+\/video\/(\d+)/,
      /m\.tiktok\.com\/.*?\/video\/(\d+)/
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    return null;
  }

  // Selecție îmbunătățită a cardurilor
  function selectCardById(id) {
    // Selectori multipli pentru diferite layout-uri
    const selectors = [
      `[data-testid="creative_material_libraryItemContainer_${id}"]`,
      `[data-testid$="_${id}"]`,
      `[data-video-id="${id}"]`,
      `[data-id="${id}"]`,
      `*[id*="${id}"]`,
      `.video-card[data-id="${id}"]`
    ];

    let card = null;
    for (const selector of selectors) {
      card = document.querySelector(selector);
      if (card) break;
    }

    if (!card) {
      // Căutare în text content ca ultimă opțiune
      const allCards = document.querySelectorAll('[data-testid*="libraryItem"], .video-card, [class*="video"], [class*="creative"]');
      for (const el of allCards) {
        if (el.textContent.includes(id) || el.innerHTML.includes(id)) {
          card = el;
          break;
        }
      }
    }

    if (!card) return false;

    // Highlight vizual îmbunătățit
    card.style.outline = `3px solid ${CONFIG.HIGHLIGHT_COLOR}`;
    card.style.outlineOffset = '2px';
    card.style.boxShadow = `0 0 15px ${CONFIG.HIGHLIGHT_COLOR}40`;
    card.style.transition = 'all 0.3s ease';

    // Selecție checkbox îmbunătățită
    const checkboxSelectors = [
      'label[role="checkbox"]',
      'input[type="checkbox"]',
      '.checkbox',
      '[class*="check"]',
      '[aria-checked]'
    ];

    let checkbox = null;
    for (const selector of checkboxSelectors) {
      checkbox = card.querySelector(selector);
      if (checkbox) break;
    }

    if (checkbox) {
      const isChecked = checkbox.getAttribute('aria-checked') === 'true' ||
                       checkbox.checked === true ||
                       checkbox.classList.contains('checked');

      if (!isChecked) {
        checkbox.click();
        Logger.success(`Card selectat pentru ID: ${id}`);
      } else {
        Logger.log(`Card deja selectat pentru ID: ${id}`);
      }
    } else {
      // Încearcă să găsească butonul de selecție prin click pe card
      card.click();
      Logger.log(`Click pe card pentru ID: ${id}`);
    }

    // Scroll îmbunătățit cu animație
    card.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
      inline: 'center'
    });

    return true;
  }

  // Detectare îmbunătățită a containerelor scrollabile
  function getScrollableContainers() {
    const selectors = [
      '[class*="slip-content_list"]',
      '[class*="slip-content_container"]',
      '[class*="modal"]',
      '[class*="drawer"]',
      '[class*="slip-content"]',
      '[class*="library"]',
      '[class*="content-list"]',
      '.scrollable',
      '[data-testid*="list"]'
    ];

    const candidates = [];
    for (const selector of selectors) {
      candidates.push(...document.querySelectorAll(selector));
    }

    const uniques = Array.from(new Set(candidates));
    return uniques.filter(el => {
      const style = getComputedStyle(el);
      const hasScroll = /(auto|scroll)/.test(style.overflow + style.overflowY + style.overflowX);
      const canScroll = el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth;
      return hasScroll && canScroll;
    });
  }

  // Funcție de scroll inteligent
  async function smartScroll(containers, direction = 'down') {
    const targets = containers.length ? containers : [document.scrollingElement || document.body];

    for (const el of targets) {
      const scrollAmount = direction === 'down' ? CONFIG.SCROLL_STEP : -CONFIG.SCROLL_STEP;
      const currentScroll = el.scrollTop;

      el.scrollBy({
        top: scrollAmount,
        behavior: 'smooth'
      });

      // Verifică dacă scroll-ul a fost efectiv
      await new Promise(r => setTimeout(r, 100));
      if (Math.abs(el.scrollTop - currentScroll) < 10) {
        // Încearcă scroll mai mare dacă nu s-a mișcat
        el.scrollBy({
          top: scrollAmount * 2,
          behavior: 'instant'
        });
      }
    }
  }

  // Căutare îmbunătățită cu retry logic
  async function autoScrollAndFind(id, timeoutMs = CONFIG.TIMEOUT_MS) {
    Logger.log(`Încep căutarea pentru ID: ${id}`);

    let attempts = 0;
    const maxAttempts = CONFIG.MAX_RETRIES;

    while (attempts < maxAttempts) {
      attempts++;
      Logger.log(`Tentativa ${attempts}/${maxAttempts} pentru ID: ${id}`);

      // Observer pentru modificări DOM
      let found = false;
      const observer = new MutationObserver(() => {
        if (!found && selectCardById(id)) {
          found = true;
        }
      });

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-testid', 'data-id', 'class']
      });

      // Verifică dacă există deja
      if (selectCardById(id)) {
        observer.disconnect();
        return true;
      }

      const scrollables = getScrollableContainers();
      const deadline = Date.now() + timeoutMs;
      let scrollDirection = 'down';
      let scrollCount = 0;
      const maxScrolls = Math.floor(timeoutMs / CONFIG.SCROLL_DELAY);

      while (Date.now() < deadline && scrollCount < maxScrolls && !found) {
        if (selectCardById(id)) {
          observer.disconnect();
          return true;
        }

        await smartScroll(scrollables, scrollDirection);
        scrollCount++;

        // Schimbă direcția la jumătate
        if (scrollCount === Math.floor(maxScrolls / 2)) {
          scrollDirection = 'up';
          Logger.log(`Schimb direcția de scroll pentru ID: ${id}`);
        }

        await new Promise(r => setTimeout(r, CONFIG.SCROLL_DELAY));
      }

      observer.disconnect();

      if (found) {
        return true;
      }

      if (attempts < maxAttempts) {
        Logger.warn(`Tentativa ${attempts} eșuată pentru ID: ${id}. Reîncerc...`);
        await new Promise(r => setTimeout(r, 1000)); // Pauză între reîncercări
      }
    }

    return false;
  }

  // UI îmbunătățit pentru input
  function createInputDialog() {
    return new Promise((resolve) => {
      // Salvează și restaurează input-ul anterior
      const savedInput = GM_getValue('lastInput', '');

      const modal = document.createElement('div');
      modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.8);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 10000;
        font-family: Arial, sans-serif;
      `;

      const dialog = document.createElement('div');
      dialog.style.cssText = `
        background: white;
        padding: 30px;
        border-radius: 10px;
        width: 80%;
        max-width: 600px;
        max-height: 80%;
        overflow: hidden;
        display: flex;
        flex-direction: column;
      `;

      dialog.innerHTML = `
        <h2 style="margin-top: 0; color: #333;">TikTok Video Selector</h2>
        <p style="color: #666; margin-bottom: 15px;">
          Lipește URL-urile videoclipurilor TikTok (câte unul pe linie):
        </p>
        <textarea
          id="urlInput"
          placeholder="https://www.tiktok.com/@user/video/123456789
https://vm.tiktok.com/ZMxxx/"
          style="width: 100%; height: 200px; padding: 10px; border: 2px solid #ddd; border-radius: 5px; resize: vertical; font-family: monospace;"
        >${savedInput}</textarea>
        <div style="margin-top: 20px; display: flex; gap: 10px; justify-content: flex-end;">
          <button id="cancelBtn" style="padding: 10px 20px; border: 1px solid #ddd; background: white; border-radius: 5px; cursor: pointer;">
            Anulează
          </button>
          <button id="startBtn" style="padding: 10px 20px; border: none; background: #1db954; color: white; border-radius: 5px; cursor: pointer;">
            Începe căutarea
          </button>
        </div>
      `;

      const textarea = dialog.querySelector('#urlInput');
      const cancelBtn = dialog.querySelector('#cancelBtn');
      const startBtn = dialog.querySelector('#startBtn');

      cancelBtn.onclick = () => {
        document.body.removeChild(modal);
        resolve(null);
      };

      startBtn.onclick = () => {
        const input = textarea.value.trim();
        if (input) {
          GM_setValue('lastInput', input); // Salvează input-ul
        }
        document.body.removeChild(modal);
        resolve(input);
      };

      modal.appendChild(dialog);
      document.body.appendChild(modal);
      textarea.focus();
    });
  }

  // Progress tracker
  function createProgressTracker(total) {
    const tracker = document.createElement('div');
    tracker.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: white;
      padding: 15px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: 9999;
      min-width: 250px;
      font-family: Arial, sans-serif;
    `;

    tracker.innerHTML = `
      <div style="font-weight: bold; margin-bottom: 10px;">TikTok Video Finder</div>
      <div id="progress-text">Pregătire...</div>
      <div style="width: 100%; height: 6px; background: #eee; border-radius: 3px; margin-top: 8px;">
        <div id="progress-bar" style="width: 0%; height: 100%; background: #1db954; border-radius: 3px; transition: width 0.3s;"></div>
      </div>
      <div id="progress-details" style="font-size: 12px; color: #666; margin-top: 5px;"></div>
    `;

    document.body.appendChild(tracker);
    return tracker;
  }

  // Funcția principală îmbunătățită
  async function runFinder() {
    try {
      const urlsInput = await createInputDialog();
      if (!urlsInput) return;

      const urls = urlsInput.split(/[\n\r]+/).map(u => u.trim()).filter(Boolean);
      const videoData = urls.map(url => ({
        url,
        id: extractVideoIdFromUrl(url),
        status: 'pending'
      }));

      const validVideos = videoData.filter(v => v.id);

      if (!validVideos.length) {
        alert("❌ Nu am găsit niciun ID valid în linkurile furnizate.\n\nVerifică că URL-urile sunt în format valid TikTok.");
        return;
      }

      Logger.log(`Procesez ${validVideos.length} videoclipuri din ${urls.length} URL-uri`);

      const progressTracker = createProgressTracker(validVideos.length);
      const progressText = progressTracker.querySelector('#progress-text');
      const progressBar = progressTracker.querySelector('#progress-bar');
      const progressDetails = progressTracker.querySelector('#progress-details');

      let completed = 0;
      let successful = 0;

      for (let i = 0; i < validVideos.length; i++) {
        const video = validVideos[i];

        progressText.textContent = `Căutare video ${i + 1}/${validVideos.length}`;
        progressDetails.textContent = `ID: ${video.id}`;
        progressBar.style.width = `${(i / validVideos.length) * 100}%`;

        Logger.log(`Procesez video ${i + 1}/${validVideos.length}: ${video.id}`);

        try {
          const found = await autoScrollAndFind(video.id, CONFIG.TIMEOUT_MS);

          if (found) {
            video.status = 'found';
            successful++;
            Logger.success(`✅ Găsit și selectat: ${video.id}`);
          } else {
            video.status = 'not_found';
            Logger.warn(`❌ Nu am găsit: ${video.id}`);
          }
        } catch (error) {
          video.status = 'error';
          Logger.error(`Eroare la procesarea ${video.id}:`, error);
        }

        completed++;
        progressBar.style.width = `${(completed / validVideos.length) * 100}%`;

        // Pauză între căutări
        if (i < validVideos.length - 1) {
          await new Promise(r => setTimeout(r, CONFIG.SELECTION_DELAY));
        }
      }

      // Raport final
      progressText.textContent = 'Finalizat!';
      progressDetails.textContent = `${successful}/${validVideos.length} videoclipuri găsite`;

      const notFound = validVideos.filter(v => v.status === 'not_found');
      const errors = validVideos.filter(v => v.status === 'error');

      let message = `✅ Proces finalizat!\n\n`;
      message += `📊 Statistici:\n`;
      message += `• Total procesate: ${validVideos.length}\n`;
      message += `• Găsite și selectate: ${successful}\n`;
      message += `• Nu au fost găsite: ${notFound.length}\n`;
      message += `• Erori: ${errors.length}\n`;

      if (notFound.length > 0) {
        message += `\n❌ Nu au fost găsite:\n`;
        notFound.forEach(v => message += `• ${v.id}\n`);
      }

      alert(message);

      // Elimină progress tracker după 5 secunde
      setTimeout(() => {
        if (progressTracker.parentNode) {
          progressTracker.parentNode.removeChild(progressTracker);
        }
      }, 5000);

    } catch (error) {
      Logger.error('Eroare în runFinder:', error);
      alert(`❌ A apărut o eroare: ${error.message}`);
    }
  }

  // Înregistrare menu command
  if (typeof GM_registerMenuCommand === "function") {
    GM_registerMenuCommand("🎯 Find TikTok videos by URLs (Enhanced)", runFinder);
  }

  // Adaugă și un shortcut de tastatură
  document.addEventListener('keydown', function(e) {
    if (e.ctrlKey && e.shiftKey && e.key === 'T') {
      e.preventDefault();
      runFinder();
    }
  });

  Logger.log('Script încărcat cu succes! Folosește Ctrl+Shift+T sau meniul userscript.');

})();