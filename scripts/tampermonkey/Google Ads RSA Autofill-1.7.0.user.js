// ==UserScript==
// @name         Google Ads RSA Autofill
// @namespace    https://onetopsolution.ro/
// @version      1.7.0
// @description  Titlu/Descriere: paste liste, Insert 1/ALL si Copy 1/ALL (clipboard).
// @match        https://ads.google.com/*
// @match        https://ads.google.com/aw/*
// @grant        GM_setClipboard
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_listValues
// @grant        GM_deleteValue
// @grant        GM_download
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const PANEL_ID = 'ots-ads-autofill';
  const LIMITS = { title: 30, longTitle: 90, desc: 90 };

  console.log('[OTS Autofill] Script loaded');

  // Clipboard via Tampermonkey (functioneaza in Ads)
  function copyToClipboard(text) {
    try {
      GM_setClipboard(text, 'text');
      return true;
    } catch (e) {
      return false;
    }
  }

  function normalizeLines(text) {
    return (text || '').split('\n').map(l => l.trim()).filter(Boolean);
  }

  function dedupe(lines) {
    const seen = new Set();
    const out = [];
    for (const l of lines) {
      const k = l.toLowerCase();
      if (!seen.has(k)) { seen.add(k); out.push(l); }
    }
    return out;
  }

  function applyLimit(s, limit, hard) {
    if (!s) return '';
    if (s.length <= limit) return s;
    return hard ? s.slice(0, limit) : s;
  }

  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function getLabelText(materialInputEl) {
    const span = materialInputEl.querySelector('span.label-text');
    return (span?.textContent || '').trim();
  }

  function getMaterialInputsByLabel(label) {
    return Array.from(document.querySelectorAll('material-input'))
      .filter(isVisible)
      .filter(mi => getLabelText(mi) === label);
  }

  function findTitleFields(useCache = true) {
    if (useCache) {
      return getCachedFields('titles', () => findTitleFields(false));
    }

    // Try direct input with class containing "input-area" (new structure)
    const directInputs = Array.from(document.querySelectorAll('input[class*="input-area"]'))
      .filter(input => {
        // Check aria-labelledby pointing to label with "Titlu" (but NOT "Titlu lung")
        const labelledById = input.getAttribute('aria-labelledby');
        if (labelledById) {
          // aria-labelledby can contain multiple IDs separated by space
          const ids = labelledById.split(/\s+/);
          for (const id of ids) {
            const labelEl = document.getElementById(id);
            const labelText = labelEl?.textContent.trim() || '';
            // Include doar "Titlu", exclude "Titlu lung"
            if (labelText === 'Titlu') return true;
          }
        }
        // Check aria-label directly (RSA: "Titlu", exclude "Titlu lung")
        const ariaLabel = input.getAttribute('aria-label') || '';
        if (ariaLabel === 'Titlu' && !ariaLabel.startsWith('Titlu lung')) return true;
        return false;
      })
      .filter(isVisible);

    if (directInputs.length > 0) return directInputs;

    // Fallback to old structure (material-input) - exclude "Titlu lung"
    return getMaterialInputsByLabel('Titlu')
      .filter(mi => {
        const labelText = getLabelText(mi);
        return labelText === 'Titlu' && labelText !== 'Titlu lung';
      })
      .map(mi => mi.querySelector('input.input-area'))
      .filter(Boolean)
      .filter(isVisible);
  }

  function findLongTitleFields(useCache = true) {
    if (useCache) {
      return getCachedFields('longTitles', () => findLongTitleFields(false));
    }

    // Try direct input with class containing "input-area" for "Titlu lung" (PMax)
    const directInputs = Array.from(document.querySelectorAll('input[class*="input-area"]'))
      .filter(input => {
        // Check aria-labelledby pointing to label with "Titlu lung"
        const labelledById = input.getAttribute('aria-labelledby');
        if (labelledById) {
          // aria-labelledby can contain multiple IDs separated by space
          const ids = labelledById.split(/\s+/);
          for (const id of ids) {
            const labelEl = document.getElementById(id);
            const labelText = labelEl?.textContent.trim() || '';
            if (labelText === 'Titlu lung') return true;
          }
        }
        // Check aria-label directly (PMax: "Titlu lung X din Y")
        const ariaLabel = input.getAttribute('aria-label') || '';
        if (ariaLabel.startsWith('Titlu lung')) return true;
        return false;
      })
      .filter(isVisible);

    if (directInputs.length > 0) return directInputs;

    // Fallback to old structure (material-input) - pentru structura cu material-input
    return getMaterialInputsByLabel('Titlu lung')
      .map(mi => mi.querySelector('input.input-area'))
      .filter(Boolean)
      .filter(isVisible);
  }

  function findDescFields(useCache = true) {
    if (useCache) {
      return getCachedFields('desc', () => findDescFields(false));
    }

    // Try direct textarea/input with class containing "input-area" (RSA uses textarea, PMax uses input)
    const directFields = Array.from(document.querySelectorAll('textarea[class*="input-area"], input[class*="input-area"]'))
      .filter(field => {
        // Check aria-label directly (RSA: "Descriere", PMax: "Descriere X din Y")
        const ariaLabel = field.getAttribute('aria-label') || '';
        if (ariaLabel === 'Descriere' || ariaLabel.startsWith('Descriere')) return true;

        // Check aria-labelledby pointing to label with "Descriere"
        const labelledById = field.getAttribute('aria-labelledby');
        if (labelledById) {
          // aria-labelledby can contain multiple IDs separated by space
          const ids = labelledById.split(/\s+/);
          for (const id of ids) {
            const labelEl = document.getElementById(id);
            const labelText = labelEl?.textContent.trim() || '';
            if (labelText === 'Descriere') return true;
          }
        }
        return false;
      })
      .filter(isVisible);

    if (directFields.length > 0) return directFields;

    // Fallback to old structure (material-input)
    return getMaterialInputsByLabel('Descriere')
      .map(mi => mi.querySelector('textarea.input-area'))
      .filter(Boolean)
      .filter(isVisible);
  }

  function getEmptyFields(fields) {
    return fields.filter(f => !(f.value || '').trim());
  }

  function getFieldValue(field) {
    // Pentru input și textarea, folosim .value
    // Dar pentru unele câmpuri Angular, poate fi necesar să verificăm și textContent
    let val = field.value || '';
    if (!val && field.textContent) {
      val = field.textContent.trim();
    }
    return val.trim();
  }

  function setValueWithEvents(el, value, retries = 3) {
    try {
      if (!el) {
        throw new Error('Element nu există');
      }
      el.focus();
      const proto = Object.getPrototypeOf(el);
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(el, value);
      else el.value = value;

      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      setTimeout(() => el.blur(), 60);
    } catch (e) {
      if (retries > 0) {
        console.log(`[OTS Autofill] Retry setValueWithEvents, ${retries} attempts left`);
        setTimeout(() => setValueWithEvents(el, value, retries - 1), 100);
      } else {
        console.error('[OTS Autofill] setValueWithEvents failed after retries:', e);
        throw e;
      }
    }
  }

  // Retry wrapper for field finding functions
  async function findFieldsWithRetry(finderFn, retries = 3, delay = 500) {
    for (let i = 0; i < retries; i++) {
      try {
        const fields = finderFn();
        if (fields && fields.length > 0) {
          return fields;
        }
        if (i < retries - 1) {
          await sleep(delay);
        }
      } catch (e) {
        console.error(`[OTS Autofill] findFieldsWithRetry attempt ${i + 1} failed:`, e);
        if (i < retries - 1) {
          await sleep(delay);
        }
      }
    }
    return [];
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // Storage functionality
  const saveDebounceTimers = {};
  const STORAGE_KEYS = {
    titles: 'ots-autofill-titles',
    longTitles: 'ots-autofill-long-titles',
    desc: 'ots-autofill-desc',
    position: 'ots-autofill-position',
    templates: 'ots-autofill-templates'
  };

  // Undo/Redo system
  const undoStack = [];
  const redoStack = [];
  const MAX_UNDO_HISTORY = 10;

  // Field cache system
  const fieldCache = {
    titles: null,
    longTitles: null,
    desc: null,
    timestamp: 0,
    CACHE_DURATION: 5000 // 5 seconds
  };

  let cacheInvalidationObserver = null;

  function invalidateFieldCache() {
    fieldCache.titles = null;
    fieldCache.longTitles = null;
    fieldCache.desc = null;
    fieldCache.timestamp = 0;
  }

  function setupCacheInvalidation() {
    if (cacheInvalidationObserver) return;

    cacheInvalidationObserver = new MutationObserver(() => {
      invalidateFieldCache();
    });

    cacheInvalidationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'aria-label', 'aria-labelledby']
    });
  }

  function getCachedFields(fieldType, finderFn) {
    const now = Date.now();
    const cacheKey = fieldType;
    const cached = fieldCache[cacheKey];

    if (cached && (now - fieldCache.timestamp) < fieldCache.CACHE_DURATION) {
      return cached;
    }

    const fields = finderFn();
    fieldCache[cacheKey] = fields;
    fieldCache.timestamp = now;
    return fields;
  }

  // Debounce for find & replace
  let findReplaceDebounceTimer = null;

  function saveState() {
    const titlesTextarea = getPanelElement('ots-titles');
    const longTitlesTextarea = getPanelElement('ots-long-titles');
    const descTextarea = getPanelElement('ots-desc');

    const state = {
      titles: titlesTextarea ? titlesTextarea.value : '',
      longTitles: longTitlesTextarea ? longTitlesTextarea.value : '',
      desc: descTextarea ? descTextarea.value : ''
    };

    undoStack.push(state);
    if (undoStack.length > MAX_UNDO_HISTORY) {
      undoStack.shift();
    }
    redoStack.length = 0; // Clear redo stack on new action

    updateUndoRedoButtons();
  }

  function restoreState(state) {
    if (!state) {
      console.error('[OTS Autofill] restoreState called with null/undefined state');
      return;
    }

    const titlesTextarea = getPanelElement('ots-titles');
    const longTitlesTextarea = getPanelElement('ots-long-titles');
    const descTextarea = getPanelElement('ots-desc');

    if (titlesTextarea && state.titles !== undefined) {
      titlesTextarea.value = state.titles;
      // Trigger input event to update counters and auto-save
      titlesTextarea.dispatchEvent(new Event('input', { bubbles: true }));
      updateCounter('ots-titles', 'ots-counter-titles', LIMITS.title);
    }

    if (longTitlesTextarea && state.longTitles !== undefined) {
      longTitlesTextarea.value = state.longTitles;
      longTitlesTextarea.dispatchEvent(new Event('input', { bubbles: true }));
      updateCounter('ots-long-titles', 'ots-counter-long-titles', LIMITS.longTitle);
    }

    if (descTextarea && state.desc !== undefined) {
      descTextarea.value = state.desc;
      descTextarea.dispatchEvent(new Event('input', { bubbles: true }));
      updateCounter('ots-desc', 'ots-counter-desc', LIMITS.desc);
    }
  }

  function undo() {
    if (undoStack.length === 0) {
      const status = getPanelStatus();
      if (status) status('Nu există acțiuni de anulat');
      return;
    }

    const currentState = {
      titles: getPanelElement('ots-titles')?.value || '',
      longTitles: getPanelElement('ots-long-titles')?.value || '',
      desc: getPanelElement('ots-desc')?.value || ''
    };

    redoStack.push(currentState);
    const previousState = undoStack.pop();

    if (previousState) {
      restoreState(previousState);
      updateUndoRedoButtons();
      const status = getPanelStatus();
      if (status) status('Undo realizat');
    }
  }

  function redo() {
    if (redoStack.length === 0) {
      const status = getPanelStatus();
      if (status) status('Nu există acțiuni de refăcut');
      return;
    }

    const currentState = {
      titles: getPanelElement('ots-titles')?.value || '',
      longTitles: getPanelElement('ots-long-titles')?.value || '',
      desc: getPanelElement('ots-desc')?.value || ''
    };

    undoStack.push(currentState);
    const nextState = redoStack.pop();

    if (nextState) {
      restoreState(nextState);
      updateUndoRedoButtons();
      const status = getPanelStatus();
      if (status) status('Redo realizat');
    }
  }

  function updateUndoRedoButtons() {
    const undoBtn = getPanelElement('ots-undo');
    const redoBtn = getPanelElement('ots-redo');

    if (undoBtn) {
      undoBtn.disabled = undoStack.length === 0;
    }
    if (redoBtn) {
      redoBtn.disabled = redoStack.length === 0;
    }
  }

  function setupUndoRedo() {
    const undoBtn = getPanelElement('ots-undo');
    const redoBtn = getPanelElement('ots-redo');

    if (undoBtn) {
      undoBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        undo();
      });
    } else {
      console.error('[OTS Autofill] Undo button not found');
    }

    if (redoBtn) {
      redoBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        redo();
      });
    } else {
      console.error('[OTS Autofill] Redo button not found');
    }

    // Save initial state
    setTimeout(() => {
      saveState();
      updateUndoRedoButtons();
    }, 200);
  }

  function saveToStorage(key, value) {
    try {
      GM_setValue(key, value);
    } catch (e) {
      console.log('[OTS Autofill] Save failed:', e);
    }
  }

  function getFromStorage(key, defaultValue) {
    try {
      return GM_getValue(key, defaultValue);
    } catch (e) {
      console.log('[OTS Autofill] Get failed:', e);
      return defaultValue;
    }
  }

  function debouncedSave(textareaId, storageKey) {
    const timer = saveDebounceTimers[textareaId];
    if (timer) clearTimeout(timer);

    saveDebounceTimers[textareaId] = setTimeout(() => {
      const textarea = document.getElementById(textareaId);
      if (textarea) {
        saveToStorage(storageKey, textarea.value);
      }
    }, 500);
  }

  // Drag & Drop functionality
  function setupDragDrop(panel) {
    const header = document.getElementById('ots-header');
    if (!header || !panel) return;

    let isDragging = false;
    let startX, startY, startLeft, startTop;

    header.style.cursor = 'move';
    header.style.userSelect = 'none';

    header.addEventListener('mousedown', (e) => {
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = panel.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;

      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;

      let newLeft = startLeft + deltaX;
      let newTop = startTop + deltaY;

      // Constrain to viewport
      const maxLeft = window.innerWidth - panel.offsetWidth;
      const maxTop = window.innerHeight - panel.offsetHeight;
      newLeft = Math.max(0, Math.min(newLeft, maxLeft));
      newTop = Math.max(0, Math.min(newTop, maxTop));

      panel.style.left = newLeft + 'px';
      panel.style.top = newTop + 'px';
      panel.style.right = 'auto';
      panel.style.transform = 'none';
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        // Save position
        const rect = panel.getBoundingClientRect();
        saveToStorage(STORAGE_KEYS.position, {
          left: rect.left,
          top: rect.top,
          right: null
        });
      }
    });
  }

  function restorePanelPosition(panel) {
    const saved = getFromStorage(STORAGE_KEYS.position, null);
    if (saved && saved.left !== undefined && saved.top !== undefined) {
      panel.style.left = saved.left + 'px';
      panel.style.top = saved.top + 'px';
      panel.style.right = 'auto';
      panel.style.transform = 'none';
    }
  }

  // Helper function to access panel elements
  function getPanelElement(id) {
    return document.getElementById(id);
  }

  // Main operation functions (accessible globally)
  function getPanelStatus() {
    const statusEl = getPanelElement('ots-status');
    return statusEl ? (msg) => { statusEl.textContent = msg; } : () => {};
  }

  function getPanelLines(id) {
    const textarea = getPanelElement(id);
    if (!textarea) return [];
    let lines = normalizeLines(textarea.value);
    const dedupeCheck = getPanelElement('ots-dedupe');
    if (dedupeCheck && dedupeCheck.checked) lines = dedupe(lines);
    return lines;
  }

  function setPanelLines(id, lines) {
    const textarea = getPanelElement(id);
    if (textarea) textarea.value = lines.join('\n');
  }

  async function insertOne(type) {
    const status = getPanelStatus();
    try {
      saveState(); // Save state before modification
      const hardCheck = getPanelElement('ots-hard');
      const delayCheck = getPanelElement('ots-delay');
      const hard = hardCheck ? hardCheck.checked : false;
      const delay = delayCheck ? delayCheck.checked : true;

      if (type === 'title') {
        let items = getPanelLines('ots-titles');
        if (items.length === 0) return status('Nimic de inserat');
        const fields = await findFieldsWithRetry(findTitleFields);
        const empty = getEmptyFields(fields);
        if (empty.length === 0) return status('Nu sunt câmpuri goale');
        setValueWithEvents(empty[0], applyLimit(items[0], LIMITS.title, hard));
        setPanelLines('ots-titles', items.slice(1));
        status('Inserted 1 Titlu');
      }

      if (type === 'longTitle') {
        let items = getPanelLines('ots-long-titles');
        if (items.length === 0) return status('Nimic de inserat');
        const fields = await findFieldsWithRetry(findLongTitleFields);
        const empty = getEmptyFields(fields);
        if (empty.length === 0) return status('Nu sunt câmpuri goale');
        setValueWithEvents(empty[0], applyLimit(items[0], LIMITS.longTitle, hard));
        setPanelLines('ots-long-titles', items.slice(1));
        status('Inserted 1 Titlu Lung');
      }

      if (type === 'desc') {
        let items = getPanelLines('ots-desc');
        if (items.length === 0) return status('Nimic de inserat');
        const fields = await findFieldsWithRetry(findDescFields);
        const empty = getEmptyFields(fields);
        if (empty.length === 0) return status('Nu sunt câmpuri goale');
        setValueWithEvents(empty[0], applyLimit(items[0], LIMITS.desc, hard));
        setPanelLines('ots-desc', items.slice(1));
        status('Inserted 1 Descriere');
      }
    } catch (e) {
      console.error('[OTS Autofill] insertOne error:', e);
      status('Eroare la inserare: ' + (e.message || 'Eroare necunoscută'));
    }
  }

  async function insertAll(type) {
    const status = getPanelStatus();
    try {
      saveState(); // Save state before modification
      const hardCheck = getPanelElement('ots-hard');
      const delayCheck = getPanelElement('ots-delay');
      const hard = hardCheck ? hardCheck.checked : false;
      const delay = delayCheck ? delayCheck.checked : true;

      if (type === 'title') {
        let items = getPanelLines('ots-titles');
        const fields = await findFieldsWithRetry(findTitleFields);
        const empty = getEmptyFields(fields);
        let inserted = 0;

        for (let i = 0; i < empty.length && i < items.length; i++) {
          try {
            setValueWithEvents(empty[i], applyLimit(items[i], LIMITS.title, hard));
            inserted++;
            if (delay) await sleep(200);
          } catch (e) {
            console.error(`[OTS Autofill] Error inserting title ${i}:`, e);
          }
        }

        setPanelLines('ots-titles', items.slice(inserted));
        status(`Inserted Titluri: ${inserted}`);
      }

      if (type === 'longTitle') {
        let items = getPanelLines('ots-long-titles');
        const fields = await findFieldsWithRetry(findLongTitleFields);
        const empty = getEmptyFields(fields);
        let inserted = 0;

        for (let i = 0; i < empty.length && i < items.length; i++) {
          try {
            setValueWithEvents(empty[i], applyLimit(items[i], LIMITS.longTitle, hard));
            inserted++;
            if (delay) await sleep(200);
          } catch (e) {
            console.error(`[OTS Autofill] Error inserting long title ${i}:`, e);
          }
        }

        setPanelLines('ots-long-titles', items.slice(inserted));
        status(`Inserted Titluri Lungi: ${inserted}`);
      }

      if (type === 'desc') {
        let items = getPanelLines('ots-desc');
        const fields = await findFieldsWithRetry(findDescFields);
        const empty = getEmptyFields(fields);
        let inserted = 0;

        for (let i = 0; i < empty.length && i < items.length; i++) {
          try {
            setValueWithEvents(empty[i], applyLimit(items[i], LIMITS.desc, hard));
            inserted++;
            if (delay) await sleep(250);
          } catch (e) {
            console.error(`[OTS Autofill] Error inserting desc ${i}:`, e);
          }
        }

        setPanelLines('ots-desc', items.slice(inserted));
        status(`Inserted Descrieri: ${inserted}`);
      }
    } catch (e) {
      console.error('[OTS Autofill] insertAll error:', e);
      status('Eroare la inserare: ' + (e.message || 'Eroare necunoscută'));
    }
  }

  function copyOneFrom(type) {
    const status = getPanelStatus();
    const hardCheck = getPanelElement('ots-hard');
    const hard = hardCheck ? hardCheck.checked : false;
    let fields, limit;

    if (type === 'title') {
      fields = findTitleFields();
      limit = LIMITS.title;
    } else if (type === 'longTitle') {
      fields = findLongTitleFields();
      limit = LIMITS.longTitle;
    } else {
      fields = findDescFields();
      limit = LIMITS.desc;
    }

    if (fields.length === 0) return status('Nu sunt câmpuri găsite');

    let value = '';
    for (const field of fields) {
      const val = getFieldValue(field);
      if (val) {
        value = val;
        break;
      }
    }

    if (!value) return status('Nu sunt valori de copiat');

    const first = applyLimit(value, limit, hard);
    const ok = copyToClipboard(first);
    status(ok ? 'Copied 1' : 'Copy blocat');
  }

  function replaceInAllFields() {
    const status = getPanelStatus();
    saveState(); // Save state before modification
    const findInput = getPanelElement('ots-find');
    const replaceInput = getPanelElement('ots-replace');
    const findText = findInput ? findInput.value || '' : '';
    const replaceText = replaceInput ? replaceInput.value || '' : '';

    if (!findText) return status('Introdu text de căutat');

    const allFields = [
      ...findTitleFields(),
      ...findLongTitleFields(),
      ...findDescFields()
    ];

    if (allFields.length === 0) return status('Nu sunt câmpuri găsite');

    let replaced = 0;
    for (const field of allFields) {
      const currentValue = getFieldValue(field);
      if (currentValue.includes(findText)) {
        const newValue = currentValue.replace(new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), replaceText);
        setValueWithEvents(field, newValue);
        replaced++;
      }
    }

    status(replaced > 0 ? `Replace ALL: ${replaced} câmpuri` : 'Nu s-a găsit textul');
  }

  function replaceInFields(type) {
    const status = getPanelStatus();
    saveState(); // Save state before modification
    const findInput = getPanelElement('ots-find');
    const replaceInput = getPanelElement('ots-replace');
    const findText = findInput ? findInput.value || '' : '';
    const replaceText = replaceInput ? replaceInput.value || '' : '';

    if (!findText) return status('Introdu text de căutat');

    let fields;
    if (type === 'title') {
      fields = findTitleFields();
    } else if (type === 'longTitle') {
      fields = findLongTitleFields();
    } else {
      fields = findDescFields();
    }

    if (fields.length === 0) return status('Nu sunt câmpuri găsite');

    let replaced = 0;
    for (const field of fields) {
      const currentValue = getFieldValue(field);
      if (currentValue.includes(findText)) {
        const newValue = currentValue.replace(new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), replaceText);
        setValueWithEvents(field, newValue);
        replaced++;
      }
    }

    status(replaced > 0 ? `Replace: ${replaced} câmpuri` : 'Nu s-a găsit textul');
  }

  function copyAllFrom(type) {
    const status = getPanelStatus();
    const hardCheck = getPanelElement('ots-hard');
    const hard = hardCheck ? hardCheck.checked : false;
    let fields, limit;

    if (type === 'title') {
      fields = findTitleFields();
      limit = LIMITS.title;
    } else if (type === 'longTitle') {
      fields = findLongTitleFields();
      limit = LIMITS.longTitle;
    } else {
      fields = findDescFields();
      limit = LIMITS.desc;
    }

    if (fields.length === 0) return status('Nu sunt câmpuri găsite');

    const values = fields
      .map(f => getFieldValue(f))
      .filter(Boolean)
      .map(v => applyLimit(v, limit, hard));

    if (values.length === 0) return status('Nu sunt valori de copiat');

    const ok = copyToClipboard(values.join('\n'));
    status(ok ? `Copied ${values.length} linii` : 'Copy blocat');
  }

  function deleteFields(type) {
    const status = getPanelStatus();
    saveState(); // Save state before modification
    let fields;

    if (type === 'title') {
      fields = findTitleFields();
    } else if (type === 'longTitle') {
      fields = findLongTitleFields();
    } else {
      fields = findDescFields();
    }

    if (fields.length === 0) return status('Nu sunt câmpuri găsite');

    let deleted = 0;
    for (const field of fields) {
      const currentValue = getFieldValue(field);
      if (currentValue) {
        setValueWithEvents(field, '');
        deleted++;
      }
    }

    status(deleted > 0 ? `Deleted: ${deleted} câmpuri` : 'Nu sunt câmpuri de șters');
  }

  async function insertAllTypes() {
    const status = getPanelStatus();
    saveState(); // Save state before modification
    const hardCheck = getPanelElement('ots-hard');
    const delayCheck = getPanelElement('ots-delay');
    const hard = hardCheck ? hardCheck.checked : false;
    const delay = delayCheck ? delayCheck.checked : true;
    let totalInserted = 0;

    // Insert titles
    let titleItems = getPanelLines('ots-titles');
    const titleEmpty = getEmptyFields(findTitleFields());
    let titleInserted = 0;
    for (let i = 0; i < titleEmpty.length && i < titleItems.length; i++) {
      setValueWithEvents(titleEmpty[i], applyLimit(titleItems[i], LIMITS.title, hard));
      titleInserted++;
      if (delay) await sleep(200);
    }
    setPanelLines('ots-titles', titleItems.slice(titleInserted));
    totalInserted += titleInserted;

    // Insert long titles
    let longTitleItems = getPanelLines('ots-long-titles');
    const longTitleEmpty = getEmptyFields(findLongTitleFields());
    let longTitleInserted = 0;
    for (let i = 0; i < longTitleEmpty.length && i < longTitleItems.length; i++) {
      setValueWithEvents(longTitleEmpty[i], applyLimit(longTitleItems[i], LIMITS.longTitle, hard));
      longTitleInserted++;
      if (delay) await sleep(200);
    }
    setPanelLines('ots-long-titles', longTitleItems.slice(longTitleInserted));
    totalInserted += longTitleInserted;

    // Insert descriptions
    let descItems = getPanelLines('ots-desc');
    const descEmpty = getEmptyFields(findDescFields());
    let descInserted = 0;
    for (let i = 0; i < descEmpty.length && i < descItems.length; i++) {
      setValueWithEvents(descEmpty[i], applyLimit(descItems[i], LIMITS.desc, hard));
      descInserted++;
      if (delay) await sleep(250);
    }
    setPanelLines('ots-desc', descItems.slice(descInserted));
    totalInserted += descInserted;

    status(`Inserted ALL Types: ${totalInserted} total (T:${titleInserted}, LT:${longTitleInserted}, D:${descInserted})`);
  }

  function copyAllTypes() {
    const status = getPanelStatus();
    const hardCheck = getPanelElement('ots-hard');
    const hard = hardCheck ? hardCheck.checked : false;
    const allData = {
      titles: [],
      longTitles: [],
      descriptions: []
    };

    // Copy titles
    const titleFields = findTitleFields();
    if (titleFields.length > 0) {
      allData.titles = titleFields
        .map(f => getFieldValue(f))
        .filter(Boolean)
        .map(v => applyLimit(v, LIMITS.title, hard));
    }

    // Copy long titles
    const longTitleFields = findLongTitleFields();
    if (longTitleFields.length > 0) {
      allData.longTitles = longTitleFields
        .map(f => getFieldValue(f))
        .filter(Boolean)
        .map(v => applyLimit(v, LIMITS.longTitle, hard));
    }

    // Copy descriptions
    const descFields = findDescFields();
    if (descFields.length > 0) {
      allData.descriptions = descFields
        .map(f => getFieldValue(f))
        .filter(Boolean)
        .map(v => applyLimit(v, LIMITS.desc, hard));
    }

    const totalCount = allData.titles.length + allData.longTitles.length + allData.descriptions.length;
    if (totalCount === 0) return status('Nu sunt valori de copiat');

    // Format structured output
    const output = [
      '=== TITLURI ===',
      ...allData.titles,
      '',
      '=== TITLURI LUNGI ===',
      ...allData.longTitles,
      '',
      '=== DESCRIERI ===',
      ...allData.descriptions
    ].join('\n');

    const ok = copyToClipboard(output);
    status(ok ? `Copied ALL Types: ${totalCount} linii` : 'Copy blocat');
  }

  function deleteAllTypes() {
    const status = getPanelStatus();
    saveState(); // Save state before modification
    let totalDeleted = 0;

    // Delete titles
    const titleFields = findTitleFields();
    let titleDeleted = 0;
    for (const field of titleFields) {
      const currentValue = getFieldValue(field);
      if (currentValue) {
        setValueWithEvents(field, '');
        titleDeleted++;
      }
    }
    totalDeleted += titleDeleted;

    // Delete long titles
    const longTitleFields = findLongTitleFields();
    let longTitleDeleted = 0;
    for (const field of longTitleFields) {
      const currentValue = getFieldValue(field);
      if (currentValue) {
        setValueWithEvents(field, '');
        longTitleDeleted++;
      }
    }
    totalDeleted += longTitleDeleted;

    // Delete descriptions
    const descFields = findDescFields();
    let descDeleted = 0;
    for (const field of descFields) {
      const currentValue = getFieldValue(field);
      if (currentValue) {
        setValueWithEvents(field, '');
        descDeleted++;
      }
    }
    totalDeleted += descDeleted;

    status(totalDeleted > 0 ? `Deleted ALL: ${totalDeleted} câmpuri (T:${titleDeleted}, LT:${longTitleDeleted}, D:${descDeleted})` : 'Nu sunt câmpuri de șters');
  }

  function createPanel() {
    if (document.getElementById(PANEL_ID)) return;

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.cssText = `
      position: fixed; top: 8px; right: 16px; width: 430px; z-index: 2147483647;
      background: #0b1220; color: #e5e7eb; border: 1px solid #374151; border-radius: 10px;
      box-shadow: 0 12px 30px rgba(0,0,0,.35);
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      padding: 12px;
    `;

    panel.innerHTML = `
      <div id="ots-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <div id="ots-title" style="font-weight:900;font-size:14px;">OTS Autofill</div>
        <div style="display:flex;gap:6px;">
          <button id="ots-minimize" style="background:#374151;color:#fff;border:0;border-radius:8px;padding:6px 10px;cursor:pointer;font-size:12px;" title="Minimizează">−</button>
          <button id="ots-close" style="background:#374151;color:#fff;border:0;border-radius:8px;padding:6px 10px;cursor:pointer;" title="Închide">X</button>
        </div>
      </div>

      <div id="ots-content" style="display:block;">
      <div style="display:flex;gap:10px;margin-bottom:10px;font-size:12px;flex-wrap:wrap;">
        <label style="display:flex;gap:6px;align-items:center;"><input type="checkbox" id="ots-dedupe" checked />Dedupe</label>
        <label style="display:flex;gap:6px;align-items:center;"><input type="checkbox" id="ots-hard" />Hard cut</label>
        <label style="display:flex;gap:6px;align-items:center;"><input type="checkbox" id="ots-delay" checked />Delay safe</label>
      </div>

      <div style="border:1px solid #374151;border-radius:8px;margin-bottom:8px;overflow:hidden;">
        <div id="ots-accordion-title" style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:#1f2937;cursor:pointer;user-select:none;">
          <div style="font-size:13px;font-weight:600;">Titluri (max ${LIMITS.title})</div>
          <div style="display:flex;align-items:center;gap:8px;">
            <div id="ots-counter-titles" style="font-size:11px;color:#9ca3af;">0/${LIMITS.title}</div>
            <span id="ots-accordion-title-icon" style="font-size:14px;">▼</span>
          </div>
        </div>
        <div id="ots-accordion-title-content" style="display:block;padding:10px;">
          <textarea id="ots-titles" rows="6" style="width:100%;resize:vertical;border-radius:8px;border:1px solid #374151;background:#111827;color:#e5e7eb;padding:8px;margin-bottom:10px;"></textarea>
          <div style="display:flex;gap:8px;margin-bottom:8px;">
            <button id="ots-insert-title" style="flex:1;background:#2563eb;color:#fff;border:0;border-radius:8px;padding:10px;cursor:pointer;font-weight:900;">Insert 1</button>
            <button id="ots-insert-title-all" style="flex:1;background:#1d4ed8;color:#fff;border:0;border-radius:8px;padding:10px;cursor:pointer;font-weight:900;">Insert ALL</button>
          </div>
          <div style="display:flex;gap:8px;margin-bottom:8px;">
            <button id="ots-copy-title" style="flex:1;background:#0ea5e9;color:#062033;border:0;border-radius:8px;padding:10px;cursor:pointer;font-weight:900;">Copy 1</button>
            <button id="ots-copy-title-all" style="flex:1;background:#38bdf8;color:#062033;border:0;border-radius:8px;padding:10px;cursor:pointer;font-weight:900;">Copy ALL</button>
          </div>
          <button id="ots-delete-title" style="width:100%;background:#ef4444;color:#fff;border:0;border-radius:8px;padding:10px;cursor:pointer;font-weight:900;">Delete Titluri</button>
        </div>
      </div>

      <div style="border:1px solid #374151;border-radius:8px;margin-bottom:8px;overflow:hidden;">
        <div id="ots-accordion-long-title" style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:#1f2937;cursor:pointer;user-select:none;">
          <div style="font-size:13px;font-weight:600;">Titluri lungi (max ${LIMITS.longTitle})</div>
          <div style="display:flex;align-items:center;gap:8px;">
            <div id="ots-counter-long-titles" style="font-size:11px;color:#9ca3af;">0/${LIMITS.longTitle}</div>
            <span id="ots-accordion-long-title-icon" style="font-size:14px;">▶</span>
          </div>
        </div>
        <div id="ots-accordion-long-title-content" style="display:none;padding:10px;">
          <textarea id="ots-long-titles" rows="6" style="width:100%;resize:vertical;border-radius:8px;border:1px solid #374151;background:#111827;color:#e5e7eb;padding:8px;margin-bottom:10px;"></textarea>
          <div style="display:flex;gap:8px;margin-bottom:8px;">
            <button id="ots-insert-long-title" style="flex:1;background:#8b5cf6;color:#fff;border:0;border-radius:8px;padding:10px;cursor:pointer;font-weight:900;">Insert 1</button>
            <button id="ots-insert-long-title-all" style="flex:1;background:#7c3aed;color:#fff;border:0;border-radius:8px;padding:10px;cursor:pointer;font-weight:900;">Insert ALL</button>
          </div>
          <div style="display:flex;gap:8px;margin-bottom:8px;">
            <button id="ots-copy-long-title" style="flex:1;background:#c084fc;color:#fff;border:0;border-radius:8px;padding:10px;cursor:pointer;font-weight:900;">Copy 1</button>
            <button id="ots-copy-long-title-all" style="flex:1;background:#a855f7;color:#fff;border:0;border-radius:8px;padding:10px;cursor:pointer;font-weight:900;">Copy ALL</button>
          </div>
          <button id="ots-delete-long-title" style="width:100%;background:#ef4444;color:#fff;border:0;border-radius:8px;padding:10px;cursor:pointer;font-weight:900;">Delete Titluri Lungi</button>
        </div>
      </div>

      <div style="border:1px solid #374151;border-radius:8px;margin-bottom:8px;overflow:hidden;">
        <div id="ots-accordion-desc" style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:#1f2937;cursor:pointer;user-select:none;">
          <div style="font-size:13px;font-weight:600;">Descrieri (max ${LIMITS.desc})</div>
          <div style="display:flex;align-items:center;gap:8px;">
            <div id="ots-counter-desc" style="font-size:11px;color:#9ca3af;">0/${LIMITS.desc}</div>
            <span id="ots-accordion-desc-icon" style="font-size:14px;">▶</span>
          </div>
        </div>
        <div id="ots-accordion-desc-content" style="display:none;padding:10px;">
          <textarea id="ots-desc" rows="6" style="width:100%;resize:vertical;border-radius:8px;border:1px solid #374151;background:#111827;color:#e5e7eb;padding:8px;margin-bottom:10px;"></textarea>
          <div style="display:flex;gap:8px;margin-bottom:8px;">
            <button id="ots-insert-desc" style="flex:1;background:#10b981;color:#0b1220;border:0;border-radius:8px;padding:10px;cursor:pointer;font-weight:900;">Insert 1</button>
            <button id="ots-insert-desc-all" style="flex:1;background:#059669;color:#0b1220;border:0;border-radius:8px;padding:10px;cursor:pointer;font-weight:900;">Insert ALL</button>
          </div>
          <div style="display:flex;gap:8px;margin-bottom:8px;">
            <button id="ots-copy-desc" style="flex:1;background:#a7f3d0;color:#052016;border:0;border-radius:8px;padding:10px;cursor:pointer;font-weight:900;">Copy 1</button>
            <button id="ots-copy-desc-all" style="flex:1;background:#6ee7b7;color:#052016;border:0;border-radius:8px;padding:10px;cursor:pointer;font-weight:900;">Copy ALL</button>
          </div>
          <button id="ots-delete-desc" style="width:100%;background:#ef4444;color:#fff;border:0;border-radius:8px;padding:10px;cursor:pointer;font-weight:900;">Delete Descrieri</button>
        </div>
      </div>

      <div style="border:1px solid #374151;border-radius:8px;margin-bottom:8px;overflow:hidden;">
        <div id="ots-accordion-templates" style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:#1f2937;cursor:pointer;user-select:none;">
          <div style="font-size:13px;font-weight:600;">Templates</div>
          <span id="ots-accordion-templates-icon" style="font-size:14px;">▶</span>
        </div>
        <div id="ots-accordion-templates-content" style="display:none;padding:10px;">
          <div style="display:flex;gap:8px;margin-bottom:8px;">
            <select id="ots-template-select" style="flex:2;border-radius:6px;border:1px solid #374151;background:#111827;color:#e5e7eb;padding:6px;font-size:12px;">
              <option value="">Selectează template...</option>
            </select>
            <button id="ots-load-template" style="flex:1;background:#6366f1;color:#fff;border:0;border-radius:8px;padding:8px;cursor:pointer;font-weight:700;font-size:11px;">Load</button>
            <button id="ots-save-template" style="flex:1;background:#8b5cf6;color:#fff;border:0;border-radius:8px;padding:8px;cursor:pointer;font-weight:700;font-size:11px;">Save</button>
            <button id="ots-delete-template" style="flex:1;background:#ef4444;color:#fff;border:0;border-radius:8px;padding:8px;cursor:pointer;font-weight:700;font-size:11px;">Delete</button>
          </div>
          <input type="text" id="ots-template-name" placeholder="Nume template..." style="width:100%;border-radius:6px;border:1px solid #374151;background:#111827;color:#e5e7eb;padding:6px;font-size:12px;" />
        </div>
      </div>

      <div style="border:1px solid #374151;border-radius:8px;margin-bottom:8px;overflow:hidden;">
        <div id="ots-accordion-export" style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:#1f2937;cursor:pointer;user-select:none;">
          <div style="font-size:13px;font-weight:600;">Export/Import</div>
          <span id="ots-accordion-export-icon" style="font-size:14px;">▶</span>
        </div>
        <div id="ots-accordion-export-content" style="display:none;padding:10px;">
          <div style="display:flex;gap:8px;margin-bottom:8px;">
            <button id="ots-export-json" style="flex:1;background:#059669;color:#fff;border:0;border-radius:8px;padding:8px;cursor:pointer;font-weight:700;font-size:11px;">Export JSON</button>
            <button id="ots-export-clipboard" style="flex:1;background:#0ea5e9;color:#fff;border:0;border-radius:8px;padding:8px;cursor:pointer;font-weight:700;font-size:11px;">Export Clipboard</button>
            <button id="ots-import-clipboard" style="flex:1;background:#f59e0b;color:#fff;border:0;border-radius:8px;padding:8px;cursor:pointer;font-weight:700;font-size:11px;">Import Clipboard</button>
          </div>
          <div style="position:relative;border:2px dashed #374151;border-radius:8px;padding:20px;text-align:center;cursor:pointer;background:#111827;" id="ots-drop-zone">
            <input type="file" id="ots-file-input" accept=".json" style="position:absolute;opacity:0;width:100%;height:100%;cursor:pointer;" />
            <div style="font-size:11px;color:#9ca3af;">Drag & Drop JSON file sau click pentru a selecta</div>
          </div>
        </div>
      </div>

      <div style="border:1px solid #374151;border-radius:8px;margin-bottom:8px;overflow:hidden;">
        <div id="ots-accordion-bulk" style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:#1f2937;cursor:pointer;user-select:none;">
          <div style="font-size:13px;font-weight:600;">Bulk Operations</div>
          <span id="ots-accordion-bulk-icon" style="font-size:14px;">▶</span>
        </div>
        <div id="ots-accordion-bulk-content" style="display:none;padding:10px;">
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button id="ots-insert-all-types" style="flex:1;background:#10b981;color:#fff;border:0;border-radius:8px;padding:8px;cursor:pointer;font-weight:700;font-size:11px;">Insert ALL Types</button>
            <button id="ots-copy-all-types" style="flex:1;background:#0ea5e9;color:#fff;border:0;border-radius:8px;padding:8px;cursor:pointer;font-weight:700;font-size:11px;">Copy ALL Types</button>
            <button id="ots-delete-all-types" style="flex:1;background:#ef4444;color:#fff;border:0;border-radius:8px;padding:8px;cursor:pointer;font-weight:700;font-size:11px;">Delete ALL</button>
          </div>
        </div>
      </div>

      <div style="border:1px solid #374151;border-radius:8px;margin-bottom:8px;overflow:hidden;">
        <div id="ots-accordion-find" style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:#1f2937;cursor:pointer;user-select:none;">
          <div style="font-size:13px;font-weight:600;">Find & Replace</div>
          <span id="ots-accordion-find-icon" style="font-size:14px;">▶</span>
        </div>
        <div id="ots-accordion-find-content" style="display:none;padding:10px;">
          <div style="display:flex;gap:8px;margin-bottom:8px;">
            <div style="flex:1;">
              <div style="font-size:11px;margin-bottom:4px;color:#9ca3af;">Find:</div>
              <input type="text" id="ots-find" placeholder="cuvânt de căutat" style="width:100%;border-radius:6px;border:1px solid #374151;background:#111827;color:#e5e7eb;padding:6px;font-size:12px;" />
            </div>
            <div style="flex:1;">
              <div style="font-size:11px;margin-bottom:4px;color:#9ca3af;">Replace:</div>
              <input type="text" id="ots-replace" placeholder="cuvânt de înlocuit" style="width:100%;border-radius:6px;border:1px solid #374151;background:#111827;color:#e5e7eb;padding:6px;font-size:12px;" />
            </div>
          </div>
          <div style="display:flex;gap:8px;margin-bottom:8px;">
            <button id="ots-replace-all" style="flex:1;background:#dc2626;color:#fff;border:0;border-radius:8px;padding:10px;cursor:pointer;font-weight:900;font-size:13px;">Replace ALL</button>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button id="ots-replace-title" style="flex:1;background:#f59e0b;color:#fff;border:0;border-radius:8px;padding:8px;cursor:pointer;font-weight:700;font-size:11px;">Replace Titluri</button>
            <button id="ots-replace-long-title" style="flex:1;background:#a855f7;color:#fff;border:0;border-radius:8px;padding:8px;cursor:pointer;font-weight:700;font-size:11px;">Replace Titluri Lungi</button>
            <button id="ots-replace-desc" style="flex:1;background:#f97316;color:#fff;border:0;border-radius:8px;padding:8px;cursor:pointer;font-weight:700;font-size:11px;">Replace Descrieri</button>
          </div>
        </div>
      </div>

      <div style="display:flex;gap:8px;margin-top:10px;">
        <button id="ots-undo" style="flex:1;background:#6b7280;color:#fff;border:0;border-radius:8px;padding:8px;cursor:pointer;font-weight:700;font-size:11px;" disabled>Undo</button>
        <button id="ots-redo" style="flex:1;background:#6b7280;color:#fff;border:0;border-radius:8px;padding:8px;cursor:pointer;font-weight:700;font-size:11px;" disabled>Redo</button>
      </div>
      <div id="ots-status" style="margin-top:10px;font-size:11px;color:#9ca3af;"></div>
      </div>
    `;

    (document.documentElement || document.body).appendChild(panel);

    const $ = (id) => document.getElementById(id);

    function status(msg) { $('ots-status').textContent = msg; }

    // Accordion toggle function
    function toggleAccordion(headerId, contentId) {
      const header = document.getElementById(headerId);
      const content = document.getElementById(contentId);
      const icon = document.getElementById(headerId + '-icon');

      if (!header || !content || !icon) return;

      const isOpen = content.style.display !== 'none';

      if (isOpen) {
        content.style.display = 'none';
        icon.textContent = '▶';
      } else {
        content.style.display = 'block';
        icon.textContent = '▼';
      }
    }

    // Setup accordion event listeners
    function setupAccordion() {
      const accordions = [
        { header: 'ots-accordion-title', content: 'ots-accordion-title-content' },
        { header: 'ots-accordion-long-title', content: 'ots-accordion-long-title-content' },
        { header: 'ots-accordion-desc', content: 'ots-accordion-desc-content' },
        { header: 'ots-accordion-templates', content: 'ots-accordion-templates-content' },
        { header: 'ots-accordion-export', content: 'ots-accordion-export-content' },
        { header: 'ots-accordion-bulk', content: 'ots-accordion-bulk-content' },
        { header: 'ots-accordion-find', content: 'ots-accordion-find-content' }
      ];

      accordions.forEach(acc => {
        const headerEl = $(acc.header);
        if (headerEl) {
          headerEl.addEventListener('click', () => {
            toggleAccordion(acc.header, acc.content);
          });
        }
      });
    }

    // Character counter functions
    function updateCounter(textareaId, counterId, limit) {
      const textarea = $(textareaId);
      const counter = $(counterId);
      if (!textarea || !counter) return;

      const lines = normalizeLines(textarea.value);
      const maxLength = lines.length > 0 ? Math.max(...lines.map(l => l.length)) : 0;
      const isOverLimit = maxLength > limit;

      counter.textContent = `${maxLength}/${limit}`;
      counter.style.color = isOverLimit ? '#ef4444' : '#9ca3af';
    }

    function setupCounters() {
      const titlesTextarea = $('ots-titles');
      const longTitlesTextarea = $('ots-long-titles');
      const descTextarea = $('ots-desc');

      if (titlesTextarea) {
        titlesTextarea.addEventListener('input', () => updateCounter('ots-titles', 'ots-counter-titles', LIMITS.title));
        updateCounter('ots-titles', 'ots-counter-titles', LIMITS.title);
      }

      if (longTitlesTextarea) {
        longTitlesTextarea.addEventListener('input', () => updateCounter('ots-long-titles', 'ots-counter-long-titles', LIMITS.longTitle));
        updateCounter('ots-long-titles', 'ots-counter-long-titles', LIMITS.longTitle);
      }

      if (descTextarea) {
        descTextarea.addEventListener('input', () => updateCounter('ots-desc', 'ots-counter-desc', LIMITS.desc));
        updateCounter('ots-desc', 'ots-counter-desc', LIMITS.desc);
      }
    }

    function setupAutoSave() {
      const titlesTextarea = $('ots-titles');
      const longTitlesTextarea = $('ots-long-titles');
      const descTextarea = $('ots-desc');

      if (titlesTextarea) {
        titlesTextarea.addEventListener('input', () => {
          debouncedSave('ots-titles', STORAGE_KEYS.titles);
          updateCounter('ots-titles', 'ots-counter-titles', LIMITS.title);
        });
      }

      if (longTitlesTextarea) {
        longTitlesTextarea.addEventListener('input', () => {
          debouncedSave('ots-long-titles', STORAGE_KEYS.longTitles);
          updateCounter('ots-long-titles', 'ots-counter-long-titles', LIMITS.longTitle);
        });
      }

      if (descTextarea) {
        descTextarea.addEventListener('input', () => {
          debouncedSave('ots-desc', STORAGE_KEYS.desc);
          updateCounter('ots-desc', 'ots-counter-desc', LIMITS.desc);
        });
      }
    }


    let isMinimized = false;
    const contentDiv = $('ots-content');
    const minimizeBtn = $('ots-minimize');
    const headerDiv = $('ots-header');
    const titleDiv = $('ots-title');

    $('ots-minimize').addEventListener('click', () => {
      isMinimized = !isMinimized;
      if (isMinimized) {
        contentDiv.style.display = 'none';
        minimizeBtn.textContent = '+';
        minimizeBtn.title = 'Maximizează';
        // Transformă în bară verticală subțire pe marginea dreaptă
        panel.style.right = '0';
        panel.style.top = '50%';
        panel.style.transform = 'translateY(-50%)';
        panel.style.width = '20px';
        panel.style.height = 'auto';
        panel.style.minHeight = '100px';
        panel.style.padding = '8px 4px';
        panel.style.borderRadius = '10px 0 0 10px';
        // Rotire header pentru text vertical
        headerDiv.style.flexDirection = 'column';
        headerDiv.style.gap = '8px';
        headerDiv.style.marginBottom = '0';
        titleDiv.style.writingMode = 'vertical-rl';
        titleDiv.style.textOrientation = 'mixed';
        titleDiv.style.transform = 'rotate(180deg)';
        titleDiv.style.fontSize = '12px';
        minimizeBtn.style.padding = '4px 6px';
        minimizeBtn.style.fontSize = '10px';
        $('ots-close').style.padding = '4px 6px';
        $('ots-close').style.fontSize = '10px';
      } else {
        contentDiv.style.display = 'block';
        minimizeBtn.textContent = '−';
        minimizeBtn.title = 'Minimizează';
        // Revine la poziția și dimensiunea normală
        panel.style.right = '16px';
        panel.style.top = '8px';
        panel.style.transform = 'none';
        panel.style.width = '430px';
        panel.style.height = 'auto';
        panel.style.minHeight = 'auto';
        panel.style.padding = '12px';
        panel.style.borderRadius = '10px';
        // Restaurează header normal
        headerDiv.style.flexDirection = 'row';
        headerDiv.style.gap = '6px';
        headerDiv.style.marginBottom = '10px';
        titleDiv.style.writingMode = 'horizontal-tb';
        titleDiv.style.textOrientation = 'mixed';
        titleDiv.style.transform = 'none';
        titleDiv.style.fontSize = '14px';
        minimizeBtn.style.padding = '6px 10px';
        minimizeBtn.style.fontSize = '12px';
        $('ots-close').style.padding = '6px 10px';
        $('ots-close').style.fontSize = 'inherit';
      }
    });

    $('ots-close').addEventListener('click', () => panel.remove());

    $('ots-insert-title').addEventListener('click', () => insertOne('title'));
    $('ots-insert-title-all').addEventListener('click', () => insertAll('title'));
    $('ots-insert-long-title').addEventListener('click', () => insertOne('longTitle'));
    $('ots-insert-long-title-all').addEventListener('click', () => insertAll('longTitle'));
    $('ots-insert-desc').addEventListener('click', () => insertOne('desc'));
    $('ots-insert-desc-all').addEventListener('click', () => insertAll('desc'));

    $('ots-copy-title-all').addEventListener('click', () => copyAllFrom('title'));
    $('ots-copy-long-title-all').addEventListener('click', () => copyAllFrom('longTitle'));
    $('ots-copy-desc-all').addEventListener('click', () => copyAllFrom('desc'));

    $('ots-copy-title').addEventListener('click', () => copyOneFrom('title'));
    $('ots-copy-long-title').addEventListener('click', () => copyOneFrom('longTitle'));
    $('ots-copy-desc').addEventListener('click', () => copyOneFrom('desc'));

    $('ots-replace-all').addEventListener('click', () => replaceInAllFields());
    $('ots-replace-title').addEventListener('click', () => replaceInFields('title'));
    $('ots-replace-long-title').addEventListener('click', () => replaceInFields('longTitle'));
    $('ots-replace-desc').addEventListener('click', () => replaceInFields('desc'));

    $('ots-delete-title').addEventListener('click', () => deleteFields('title'));
    $('ots-delete-long-title').addEventListener('click', () => deleteFields('longTitle'));
    $('ots-delete-desc').addEventListener('click', () => deleteFields('desc'));

    // Bulk operations
    $('ots-insert-all-types').addEventListener('click', () => insertAllTypes());
    $('ots-copy-all-types').addEventListener('click', () => copyAllTypes());
    $('ots-delete-all-types').addEventListener('click', () => deleteAllTypes());

    // Setup character counters
    setTimeout(() => {
      setupCounters();
      setupAutoSave();
      restoreSavedContent();
      setupTemplateSystem();
      setupExportImport();
      setupUndoRedo();
      setupCacheInvalidation();
    }, 100);

    // Setup drag & drop
    setupDragDrop(panel);

    // Restore panel position
    restorePanelPosition(panel);

    // Setup keyboard shortcuts
    setupKeyboardShortcuts();

    // Setup accordion
    setupAccordion();

    status('Panel OK');
  }

  // Keyboard shortcuts
  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Only trigger if panel exists and is not minimized
      const panel = document.getElementById(PANEL_ID);
      if (!panel || panel.querySelector('#ots-content').style.display === 'none') return;

      // Check if focus is on an input/textarea (avoid conflicts)
      const activeEl = document.activeElement;
      const isInputFocused = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');

      // Don't trigger if user is typing in inputs (except our panel inputs)
      if (isInputFocused && !activeEl.id.startsWith('ots-')) return;

      // Ctrl+Shift+I - Insert 1
      if (e.ctrlKey && e.shiftKey && e.key === 'I') {
        e.preventDefault();
        const activeType = getActiveSection();
        if (activeType) insertOne(activeType);
      }

      // Ctrl+Shift+A - Insert ALL
      if (e.ctrlKey && e.shiftKey && e.key === 'A') {
        e.preventDefault();
        const activeType = getActiveSection();
        if (activeType) insertAll(activeType);
      }

      // Ctrl+Shift+C - Copy 1
      if (e.ctrlKey && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        const activeType = getActiveSection();
        if (activeType) copyOneFrom(activeType);
      }

      // Ctrl+Shift+R - Replace ALL
      if (e.ctrlKey && e.shiftKey && e.key === 'R') {
        e.preventDefault();
        replaceInAllFields();
      }

      // Esc - Minimize/Maximize
      if (e.key === 'Escape') {
        const minimizeBtn = document.getElementById('ots-minimize');
        if (minimizeBtn) minimizeBtn.click();
      }
    });
  }

  function getActiveSection() {
    const activeEl = document.activeElement;
    if (!activeEl) return null;

    // Check which textarea is focused
    if (activeEl.id === 'ots-titles') return 'title';
    if (activeEl.id === 'ots-long-titles') return 'longTitle';
    if (activeEl.id === 'ots-desc') return 'desc';

    // Check if any textarea in panel has focus
    const panel = document.getElementById(PANEL_ID);
    if (panel && panel.contains(activeEl)) {
      // Default to first section if panel is focused but no specific textarea
      return 'title';
    }

    return null;
  }

  // Template system
  function getTemplates() {
    return getFromStorage(STORAGE_KEYS.templates, {});
  }

  function saveTemplate(name, data) {
    const templates = getTemplates();
    templates[name] = {
      titles: data.titles || '',
      longTitles: data.longTitles || '',
      desc: data.desc || '',
      createdAt: Date.now()
    };
    saveToStorage(STORAGE_KEYS.templates, templates);
  }

  function deleteTemplate(name) {
    const templates = getTemplates();
    delete templates[name];
    saveToStorage(STORAGE_KEYS.templates, templates);
  }

  function loadTemplate(name) {
    const templates = getTemplates();
    const template = templates[name];
    if (!template) return false;

    const titlesTextarea = getPanelElement('ots-titles');
    const longTitlesTextarea = getPanelElement('ots-long-titles');
    const descTextarea = getPanelElement('ots-desc');

    if (titlesTextarea && template.titles) {
      titlesTextarea.value = template.titles;
      updateCounter('ots-titles', 'ots-counter-titles', LIMITS.title);
    }

    if (longTitlesTextarea && template.longTitles) {
      longTitlesTextarea.value = template.longTitles;
      updateCounter('ots-long-titles', 'ots-counter-long-titles', LIMITS.longTitle);
    }

    if (descTextarea && template.desc) {
      descTextarea.value = template.desc;
      updateCounter('ots-desc', 'ots-counter-desc', LIMITS.desc);
    }

    return true;
  }

  function populateTemplateSelect() {
    const select = getPanelElement('ots-template-select');
    if (!select) return;

    const templates = getTemplates();
    const templateNames = Object.keys(templates).sort();

    // Clear existing options except first
    select.innerHTML = '<option value="">Selectează template...</option>';

    templateNames.forEach(name => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      select.appendChild(option);
    });
  }

  function setupTemplateSystem() {
    const select = getPanelElement('ots-template-select');
    const loadBtn = getPanelElement('ots-load-template');
    const saveBtn = getPanelElement('ots-save-template');
    const deleteBtn = getPanelElement('ots-delete-template');
    const nameInput = getPanelElement('ots-template-name');

    if (!select || !loadBtn || !saveBtn || !deleteBtn || !nameInput) return;

    // Populate template list
    populateTemplateSelect();

    // Load template
    loadBtn.addEventListener('click', () => {
      const templateName = select.value;
      if (!templateName) {
        getPanelStatus()('Selectează un template');
        return;
      }
      if (loadTemplate(templateName)) {
        getPanelStatus()(`Template "${templateName}" încărcat`);
      } else {
        getPanelStatus()('Template nu a fost găsit');
      }
    });

    // Save template
    saveBtn.addEventListener('click', () => {
      const templateName = nameInput.value.trim();
      if (!templateName) {
        getPanelStatus()('Introdu un nume pentru template');
        return;
      }

      const titlesTextarea = getPanelElement('ots-titles');
      const longTitlesTextarea = getPanelElement('ots-long-titles');
      const descTextarea = getPanelElement('ots-desc');

      saveTemplate(templateName, {
        titles: titlesTextarea ? titlesTextarea.value : '',
        longTitles: longTitlesTextarea ? longTitlesTextarea.value : '',
        desc: descTextarea ? descTextarea.value : ''
      });

      populateTemplateSelect();
      select.value = templateName;
      nameInput.value = '';
      getPanelStatus()(`Template "${templateName}" salvat`);
    });

    // Delete template
    deleteBtn.addEventListener('click', () => {
      const templateName = select.value;
      if (!templateName) {
        getPanelStatus()('Selectează un template de șters');
        return;
      }
      if (confirm(`Ștergi template "${templateName}"?`)) {
        deleteTemplate(templateName);
        populateTemplateSelect();
        getPanelStatus()(`Template "${templateName}" șters`);
      }
    });
  }

  // Export/Import functions
  function exportToJSON() {
    const titlesTextarea = getPanelElement('ots-titles');
    const longTitlesTextarea = getPanelElement('ots-long-titles');
    const descTextarea = getPanelElement('ots-desc');

    const data = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      titles: titlesTextarea ? titlesTextarea.value : '',
      longTitles: longTitlesTextarea ? longTitlesTextarea.value : '',
      desc: descTextarea ? descTextarea.value : ''
    };

    try {
      const jsonStr = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      GM_download({
        url: url,
        name: `ots-autofill-export-${Date.now()}.json`,
        saveAs: true
      });

      setTimeout(() => URL.revokeObjectURL(url), 100);
      getPanelStatus()('Export realizat');
    } catch (e) {
      console.error('[OTS Autofill] Export failed:', e);
      getPanelStatus()('Export eșuat: ' + e.message);
    }
  }

  function exportToClipboard() {
    const titlesTextarea = getPanelElement('ots-titles');
    const longTitlesTextarea = getPanelElement('ots-long-titles');
    const descTextarea = getPanelElement('ots-desc');

    const data = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      titles: titlesTextarea ? titlesTextarea.value : '',
      longTitles: longTitlesTextarea ? longTitlesTextarea.value : '',
      desc: descTextarea ? descTextarea.value : ''
    };

    try {
      const jsonStr = JSON.stringify(data, null, 2);
      if (copyToClipboard(jsonStr)) {
        getPanelStatus()('Copiat în clipboard');
      } else {
        getPanelStatus()('Copy blocat');
      }
    } catch (e) {
      console.error('[OTS Autofill] Export to clipboard failed:', e);
      getPanelStatus()('Export eșuat: ' + e.message);
    }
  }

  function importFromJSON(data) {
    try {
      const parsed = typeof data === 'string' ? JSON.parse(data) : data;

      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Format JSON invalid');
      }

      const titlesTextarea = getPanelElement('ots-titles');
      const longTitlesTextarea = getPanelElement('ots-long-titles');
      const descTextarea = getPanelElement('ots-desc');

      if (titlesTextarea && parsed.titles !== undefined) {
        titlesTextarea.value = parsed.titles || '';
        updateCounter('ots-titles', 'ots-counter-titles', LIMITS.title);
      }

      if (longTitlesTextarea && parsed.longTitles !== undefined) {
        longTitlesTextarea.value = parsed.longTitles || '';
        updateCounter('ots-long-titles', 'ots-counter-long-titles', LIMITS.longTitle);
      }

      if (descTextarea && parsed.desc !== undefined) {
        descTextarea.value = parsed.desc || '';
        updateCounter('ots-desc', 'ots-counter-desc', LIMITS.desc);
      }

      getPanelStatus()('Import realizat cu succes');
      return true;
    } catch (e) {
      console.error('[OTS Autofill] Import failed:', e);
      getPanelStatus()('Import eșuat: ' + e.message);
      return false;
    }
  }

  async function importFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        getPanelStatus()('Clipboard gol');
        return;
      }
      importFromJSON(text);
    } catch (e) {
      console.error('[OTS Autofill] Clipboard read failed:', e);
      getPanelStatus()('Citire clipboard eșuată: ' + e.message);
    }
  }

  function setupExportImport() {
    const exportJsonBtn = getPanelElement('ots-export-json');
    const exportClipboardBtn = getPanelElement('ots-export-clipboard');
    const importClipboardBtn = getPanelElement('ots-import-clipboard');
    const fileInput = getPanelElement('ots-file-input');
    const dropZone = getPanelElement('ots-drop-zone');

    if (exportJsonBtn) {
      exportJsonBtn.addEventListener('click', exportToJSON);
    }

    if (exportClipboardBtn) {
      exportClipboardBtn.addEventListener('click', exportToClipboard);
    }

    if (importClipboardBtn) {
      importClipboardBtn.addEventListener('click', importFromClipboard);
    }

    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
          try {
            importFromJSON(event.target.result);
          } catch (e) {
            getPanelStatus()('Eroare la citirea fișierului: ' + e.message);
          }
        };
        reader.onerror = () => {
          getPanelStatus()('Eroare la citirea fișierului');
        };
        reader.readAsText(file);
        e.target.value = ''; // Reset input
      });
    }

    if (dropZone) {
      dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = '#6366f1';
        dropZone.style.background = '#1e293b';
      });

      dropZone.addEventListener('dragleave', () => {
        dropZone.style.borderColor = '#374151';
        dropZone.style.background = '#111827';
      });

      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = '#374151';
        dropZone.style.background = '#111827';

        const file = e.dataTransfer.files[0];
        if (!file || !file.name.endsWith('.json')) {
          getPanelStatus()('Doar fișiere JSON sunt acceptate');
          return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
          importFromJSON(event.target.result);
        };
        reader.onerror = () => {
          getPanelStatus()('Eroare la citirea fișierului');
        };
        reader.readAsText(file);
      });
    }
  }

  function ensurePanel() {
    try { createPanel(); } catch (_) {}
  }

  const interval = setInterval(() => {
    ensurePanel();
    if (document.getElementById(PANEL_ID)) clearInterval(interval);
  }, 600);

  window.addEventListener('load', ensurePanel);
})();