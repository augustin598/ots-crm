// ==UserScript==
// @name         Insert Content IDs - Facebook Ads Manager
// @namespace    http://tampermonkey.net/
// @version      2.4
// @description  Inserează ID-urile produselor în câmpul Facebook Ads Manager (un ID pe chip)
// @author       You
// @match        https://adsmanager.facebook.com/*
// @match        https://business.facebook.com/*
// @include      https://adsmanager.facebook.com/*
// @include      https://business.facebook.com/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // Verifică dacă scriptul rulează
    console.log('🚀 Script Content IDs inserter v2.4 încărcat!');
    console.log('📍 URL:', window.location.href);
    console.log('📍 ReadyState:', document.readyState);
    console.log('📍 Hostname:', window.location.hostname);

    // Verifică dacă suntem pe domeniul corect
    if (!window.location.hostname.includes('facebook.com') && !window.location.hostname.includes('meta.com')) {
        console.warn('⚠️ Script rulează pe un domeniu neașteptat:', window.location.hostname);
    }

    // Funcție de inițializare
    function initScript() {
        console.log('✅ DOM gata, inițializare script...');

    // Variabile globale pentru counter și bară de progres
    let progressCounter = null;
    let progressBarFill = null;
    let currentProgress = { current: 0, total: 0, success: 0 };

    // Funcție pentru a găsi câmpul de input (robustă, nu depinde de ID)
    function findInputField() {
        // Metoda 1: Caută după placeholder (cel mai sigur)
        const allInputs = document.querySelectorAll('input[type="text"][role="combobox"]');
        for (const input of allInputs) {
            const placeholder = (input.getAttribute('placeholder') || '').toLowerCase();
            if (placeholder.includes('at least one') || placeholder.includes('these values')) {
                const rect = input.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0 && input.offsetParent !== null) {
                    return input;
                }
            }
        }

        // Metoda 2: Caută în container-ul cu chip-uri
        const chipContainers = document.querySelectorAll('[data-key]');
        if (chipContainers.length > 0) {
            // Găsește container-ul părinte
            const container = chipContainers[0].closest('.x6s0dn4.x78zum5');
            if (container) {
                const input = container.querySelector('input[type="text"][role="combobox"]');
                if (input) {
                    const rect = input.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                        return input;
                    }
                }
            }
        }

        // Metoda 3: Caută după aria-labelledby care conține "Tokeniser"
        const labels = document.querySelectorAll('label');
        for (const label of labels) {
            const labelText = label.textContent || '';
            if (labelText.toLowerCase().includes('tokeniser')) {
                const labelFor = label.getAttribute('for');
                if (labelFor) {
                    const input = document.getElementById(labelFor);
                    if (input && input.offsetParent !== null) {
                        return input;
                    }
                }
            }
        }

        // Metoda 4: Caută orice input combobox în modale (prioritar pentru modale deschise)
        const modals = document.querySelectorAll('[role="dialog"], .x1n2onr6, [data-pagelet]');
        for (const modal of modals) {
            // Verifică dacă modalul este vizibil
            const modalRect = modal.getBoundingClientRect();
            if (modalRect.width === 0 || modalRect.height === 0) {
                continue;
            }

            // Caută input-ul în modal
            const inputs = modal.querySelectorAll('input[type="text"][role="combobox"]');
            for (const input of inputs) {
                const placeholder = (input.getAttribute('placeholder') || '').toLowerCase();
                const rect = input.getBoundingClientRect();

                // Verifică dacă input-ul este vizibil și are placeholder relevant
                if (rect.width > 0 && rect.height > 0 && input.offsetParent !== null) {
                    if (placeholder.includes('at least') ||
                        placeholder.includes('these values') ||
                        placeholder.includes('tokeniser') ||
                        placeholder.includes('value')) {
                        return input;
                    }
                }
            }
        }

        // Metoda 5: Caută orice input combobox vizibil (fallback)
        const allVisibleInputs = document.querySelectorAll('input[type="text"][role="combobox"]');
        for (const input of allVisibleInputs) {
            const rect = input.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0 &&
                rect.top >= 0 && rect.left >= 0 &&
                input.offsetParent !== null &&
                window.getComputedStyle(input).visibility !== 'hidden' &&
                window.getComputedStyle(input).display !== 'none') {
                // Verifică dacă este în centrul ecranului (probabil modal)
                if (rect.top < window.innerHeight * 0.8 && rect.top > window.innerHeight * 0.1) {
                    return input;
                }
            }
        }

        return null;
    }

    // Funcție pentru a insera un singur ID și a apăsa Enter
    async function insertSingleId(input, id) {
        // Focus pe input
        input.focus();
        input.click();

        await new Promise(resolve => setTimeout(resolve, 100));

        // Metoda 1: Folosește paste real cu clipboard
        try {
            // Scrie ID-ul în clipboard
            await navigator.clipboard.writeText(id);
            await new Promise(resolve => setTimeout(resolve, 50));

            // Focus și selectează tot
            input.focus();
            input.click();
            input.select();
            input.setSelectionRange(0, input.value.length);

            await new Promise(resolve => setTimeout(resolve, 50));

            // Simulează Ctrl+V (paste)
            const ctrlVEvent = new KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                key: 'v',
                code: 'KeyV',
                keyCode: 86,
                which: 86,
                ctrlKey: true,
                metaKey: false
            });

            input.dispatchEvent(ctrlVEvent);

            // Paste event
            const pasteEvent = new ClipboardEvent('paste', {
                bubbles: true,
                cancelable: true,
                clipboardData: new DataTransfer()
            });
            pasteEvent.clipboardData.setData('text/plain', id);
            input.dispatchEvent(pasteEvent);

            // Setează valoarea
            input.value = id;

            // Declanșează evenimente
            input.dispatchEvent(new InputEvent('input', {
                bubbles: true,
                cancelable: true,
                inputType: 'insertText',
                data: id
            }));

        } catch (err) {
            // Fallback: execCommand
            try {
                input.select();
                document.execCommand('insertText', false, id);
            } catch (e) {
                // Fallback final: setare directă
                input.value = id;
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }

        // Așteaptă puțin pentru ca valoarea să fie procesată
        await new Promise(resolve => setTimeout(resolve, 200));

        // Verifică dacă valoarea a fost setată
        if (input.value !== id) {
            // Reîncearcă cu metode alternative
            input.focus();
            input.value = id;

            // Declanșează toate tipurile de evenimente
            const events = ['focus', 'input', 'change', 'keydown', 'keyup'];
            events.forEach(type => {
                input.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
            });

            await new Promise(resolve => setTimeout(resolve, 150));
        }

        // Simulează apăsarea Enter pentru a crea chip-ul
        // Folosim o simulare mai completă
        const enterDownEvent = new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            charCode: 0,
            keyIdentifier: 'Enter'
        });

        const enterPressEvent = new KeyboardEvent('keypress', {
            bubbles: true,
            cancelable: true,
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            charCode: 13
        });

        const enterUpEvent = new KeyboardEvent('keyup', {
            bubbles: true,
            cancelable: true,
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13
        });

        // Declanșează evenimentele în ordine corectă
        const downResult = input.dispatchEvent(enterDownEvent);
        await new Promise(resolve => setTimeout(resolve, 20));

        if (downResult) { // Dacă keydown nu a fost anulat
            const pressResult = input.dispatchEvent(enterPressEvent);
            await new Promise(resolve => setTimeout(resolve, 20));

            if (pressResult) {
                input.dispatchEvent(enterUpEvent);
            }
        }

        // Așteaptă ca chip-ul să fie creat
        await new Promise(resolve => setTimeout(resolve, 200));

        // Verifică dacă chip-ul a fost creat (input-ul ar trebui să fie gol)
        const currentValue = input.value;
        if (currentValue === id) {
            // Chip-ul nu a fost creat, încercăm să ștergem manual și să reîncercăm Enter
            console.warn(`⚠️ Chip-ul nu a fost creat pentru ${id}, reîncercare...`);
            input.value = '';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            await new Promise(resolve => setTimeout(resolve, 100));

            // Reîncearcă Enter
            input.dispatchEvent(enterDownEvent);
            await new Promise(resolve => setTimeout(resolve, 50));
            input.dispatchEvent(enterUpEvent);
        }
    }

    // Funcție pentru a actualiza counter-ul și bara de progres
    function updateProgressCounter(current, total, success) {
        currentProgress.current = current;
        currentProgress.total = total;
        currentProgress.success = success;

        const percentage = total > 0 ? Math.round((current / total) * 100) : 0;

        // Actualizează textul counter-ului
        if (progressCounter) {
            if (progressCounter.id === 'overlay-counter' || progressCounter.id === 'progress-counter') {
                progressCounter.textContent = `⏳ Se inserează... ${current}/${total} (${success} reușite) - ${percentage}%`;
            } else {
                progressCounter.textContent = `⏳ Se inserează... ${current}/${total} (${success} reușite)`;
            }
        }

        // Actualizează bara de progres
        if (progressBarFill) {
            progressBarFill.style.width = `${percentage}%`;
            progressBarFill.setAttribute('aria-valuenow', percentage);
        }

        // Actualizează și textul din bară dacă există
        const progressText = document.getElementById('progress-text');
        if (progressText) {
            progressText.textContent = `${current}/${total} (${success} reușite)`;
        }

        // Actualizează și overlay-ul dacă există
        const overlayProgressText = document.getElementById('overlay-progress-text');
        if (overlayProgressText) {
            overlayProgressText.textContent = `${current}/${total} (${success} reușite)`;
        }

        const overlayProgressFill = document.getElementById('overlay-progress-fill');
        if (overlayProgressFill) {
            overlayProgressFill.style.width = `${percentage}%`;
        }
    }

    // Funcție pentru a insera ID-urile unul câte unul cu Enter
    async function insertContentIds(ids, progressCallback = null) {
        let input = findInputField();
        let attempts = 0;

        // Așteaptă până apare câmpul
        while (!input && attempts < 15) {
            await new Promise(resolve => setTimeout(resolve, 300));
            input = findInputField();
            attempts++;
            if (attempts % 5 === 0) {
                console.log(`⏳ Aștept câmpul... (încercarea ${attempts})`);
            }
        }

        if (!input) {
            alert('❌ Câmpul nu a fost găsit!\n\nAsigură-te că:\n1. Ești pe pagina de creare Custom Audience\n2. Câmpul "At least one of these values" este vizibil\n3. Modalul este complet deschis');
            return false;
        }

        // Extrage ID-urile (unul pe linie sau separate prin virgulă/spațiu/semicolon)
        const idList = ids
            .split(/[\n\r,;]+/)
            .map(id => id.trim())
            .filter(id => id.length > 0);

        if (idList.length === 0) {
            alert('⚠️ Nu s-au găsit ID-uri valide!');
            return false;
        }

        // Verifică limita Facebook de 100 filtre per regulă
        if (idList.length > 100) {
            const originalLength = idList.length;
            const confirmContinue = confirm(
                `⚠️ ATENȚIE: Facebook permite maxim 100 filtre per regulă!\n\n` +
                `Ai ${originalLength} ID-uri.\n\n` +
                `Vrei să continui doar cu primele 100 ID-uri?\n\n` +
                `(Click OK pentru primele 100, Cancel pentru a anula)`
            );

            if (confirmContinue) {
                // Păstrează doar primele 100 ID-uri
                idList.length = 100;
                console.log(`⚠️ Limitat la primele 100 ID-uri din ${originalLength}`);
            } else {
                alert('❌ Operațiune anulată. Te rugăm să împarți ID-urile în mai multe fișiere de maxim 100 ID-uri fiecare.');
                return false;
            }
        }

        console.log(`📋 Inserare ${idList.length} ID-uri unul câte unul...`);

        // Focus pe input la început
        input.focus();
        input.click();
        await new Promise(resolve => setTimeout(resolve, 200));

        // Funcție helper pentru a verifica dacă un chip a fost creat
        function checkChipCreated(id) {
            const idString = String(id);
            // Caută în toate chip-urile pentru siguranță (metodă mai robustă)
            const allChips = document.querySelectorAll('[data-key]');
            for (const chip of allChips) {
                const ariaLabel = chip.getAttribute('aria-label') || '';
                const chipText = chip.textContent || '';
                // Verifică în aria-label sau în textul chip-ului
                if (ariaLabel.includes(idString) || chipText.includes(idString)) {
                    return true;
                }
            }
            return false;
        }

        // Inserează fiecare ID separat, cu Enter după fiecare
        let successCount = 0;
        let lastInputId = input.id;

        // Actualizează counter-ul la început
        if (progressCallback) {
            progressCallback(0, idList.length, 0);
        }
        updateProgressCounter(0, idList.length, 0);

        for (let i = 0; i < idList.length; i++) {
            const id = idList[i];

            // Actualizează counter-ul
            if (progressCallback) {
                progressCallback(i + 1, idList.length, successCount);
            }
            updateProgressCounter(i + 1, idList.length, successCount);

            // Re-găsește input-ul înainte de fiecare inserare (ID-ul se schimbă!)
            let currentInput = findInputField();
            if (!currentInput) {
                // Așteaptă puțin și reîncearcă
                await new Promise(resolve => setTimeout(resolve, 300));
                currentInput = findInputField();
            }

            if (!currentInput) {
                console.warn(`⚠️ Input-ul nu a fost găsit la ID ${i + 1}/${idList.length}: ${id}`);
                // Încearcă să găsească după ID-ul vechi
                if (lastInputId) {
                    currentInput = document.getElementById(lastInputId);
                }
                if (!currentInput) {
                    console.error(`❌ Nu pot continua fără input la ID ${i + 1}`);
                    break;
                }
            } else {
                lastInputId = currentInput.id;
                input = currentInput;
            }

            console.log(`📝 Inserare ID ${i + 1}/${idList.length}: ${id} (input ID: ${input.id})`);

            await insertSingleId(input, id);

            // Așteaptă mai mult pentru ca Facebook să proceseze chip-ul
            await new Promise(resolve => setTimeout(resolve, 300));

            // Verifică dacă chip-ul a fost creat
            if (checkChipCreated(id)) {
                successCount++;
                if (progressCallback) {
                    progressCallback(i + 1, idList.length, successCount);
                }
                updateProgressCounter(i + 1, idList.length, successCount);

                if (i % 10 === 0 || i < 5) {
                    console.log(`✅ Chip ${i + 1}/${idList.length} creat pentru ${id}`);
                }
            } else {
                if (i < 5) {
                    console.warn(`⚠️ Chip-ul nu a fost creat pentru ${id}`);
                }
            }

            // Pauză mai lungă după fiecare 10 ID-uri pentru a nu suprasolicita
            if ((i + 1) % 10 === 0) {
                console.log(`⏸️ Pauză după ${i + 1} ID-uri...`);
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        // Actualizează counter-ul final
        if (progressCallback) {
            progressCallback(idList.length, idList.length, successCount);
        }
        updateProgressCounter(idList.length, idList.length, successCount);

        console.log(`📊 Rezultat: ${successCount}/${idList.length} chip-uri create`);

        // Verifică final câte chip-uri există în total
        const allChips = document.querySelectorAll('[data-key]');
        const chipCount = allChips.length;

        console.log(`✅ ${idList.length} ID-uri procesate!`);
        console.log(`📊 Chip-uri găsite în DOM: ${chipCount}`);
        console.log(`📊 Chip-uri reușite: ${successCount}/${idList.length}`);

        // Actualizează counter-ul și bara de progres finală
        if (progressCounter) {
            progressCounter.textContent = `✅ Finalizat: ${chipCount} chip-uri create din ${idList.length} ID-uri`;
        }
        if (progressBarFill) {
            progressBarFill.style.width = '100%';
            progressBarFill.setAttribute('aria-valuenow', '100');
            progressBarFill.style.background = chipCount > 0
                ? 'linear-gradient(90deg, #42c765 0%, #66bb6a 100%)'
                : 'linear-gradient(90deg, #f44336 0%, #e57373 100%)';
        }
        const progressText = document.getElementById('progress-text');
        if (progressText) {
            progressText.textContent = `${chipCount}/${idList.length} chip-uri create`;
            progressText.style.color = chipCount > 0 ? '#2e7d32' : '#c62828';
            progressText.style.fontWeight = '700';
        }

        if (chipCount > 0) {
            alert(`✅ ${chipCount} chip-uri create cu succes din ${idList.length} ID-uri!\n\nVerifică în interfață dacă toate chip-urile sunt vizibile.`);
        } else {
            alert(`⚠️ ${idList.length} ID-uri procesate, dar nu s-au creat chip-uri.\n\nPoate că:\n1. Facebook necesită paste manual\n2. Câmpul nu acceptă inserare automată\n3. Este nevoie de interacțiune manuală\n\nÎncearcă să lipești manual un ID pentru a vedea dacă funcționează.`);
        }

        return chipCount > 0;
    }

    // Funcție pentru a citi din clipboard
    async function pasteFromClipboard() {
        try {
            const text = await navigator.clipboard.readText();
            if (text && text.trim()) {
                console.log('📋 Text citit din clipboard');
                return await insertContentIds(text);
            } else {
                alert('⚠️ Clipboard-ul este gol!\n\nCopiază mai întâi ID-urile din fișierul text.');
                return false;
            }
        } catch (err) {
            console.error('❌ Eroare clipboard:', err);
            // Fallback: textarea modal
            showTextareaModal();
            return false;
        }
    }

    // Modal cu textarea pentru paste manual
    function showTextareaModal() {
        // Verifică dacă modalul există deja
        if (document.getElementById('content-ids-modal')) {
            return;
        }

        const modal = document.createElement('div');
        modal.id = 'content-ids-modal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.7);
            z-index: 999999;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        `;

        const content = document.createElement('div');
        content.style.cssText = `
            background: white;
            padding: 24px;
            border-radius: 8px;
            max-width: 600px;
            width: 90%;
            max-height: 80vh;
            overflow: auto;
        `;

        const title = document.createElement('h2');
        title.textContent = '📋 Inserează Content IDs';
        title.style.cssText = 'margin: 0 0 16px 0; font-size: 20px;';

        const textarea = document.createElement('textarea');
        textarea.placeholder = 'Lipește ID-urile aici (unul pe linie sau separate prin virgulă)...';
        textarea.style.cssText = `
            width: 100%;
            min-height: 200px;
            padding: 12px;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 14px;
            font-family: monospace;
            resize: vertical;
            box-sizing: border-box;
        `;

        // Counter și bară de progres
        const progressContainer = document.createElement('div');
        progressContainer.id = 'progress-container';
        progressContainer.style.cssText = `
            margin-top: 12px;
            display: none;
        `;

        const counterDiv = document.createElement('div');
        counterDiv.id = 'progress-counter';
        counterDiv.style.cssText = `
            margin-bottom: 8px;
            font-size: 13px;
            color: #65676b;
            text-align: center;
            font-weight: 500;
        `;

        // Bară de progres
        const progressBarWrapper = document.createElement('div');
        progressBarWrapper.style.cssText = `
            width: 100%;
            height: 24px;
            background: #e4e6eb;
            border-radius: 12px;
            overflow: hidden;
            position: relative;
        `;

        progressBarFill = document.createElement('div');
        progressBarFill.id = 'progress-bar-fill';
        progressBarFill.style.cssText = `
            height: 100%;
            width: 0%;
            background: linear-gradient(90deg, #1877f2 0%, #42a5f5 100%);
            border-radius: 12px;
            transition: width 0.3s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 11px;
            font-weight: 600;
            position: relative;
        `;
        progressBarFill.setAttribute('role', 'progressbar');
        progressBarFill.setAttribute('aria-valuemin', '0');
        progressBarFill.setAttribute('aria-valuemax', '100');
        progressBarFill.setAttribute('aria-valuenow', '0');

        const progressText = document.createElement('span');
        progressText.id = 'progress-text';
        progressText.style.cssText = `
            position: absolute;
            width: 100%;
            text-align: center;
            color: #65676b;
            font-size: 11px;
            font-weight: 600;
            z-index: 1;
            line-height: 24px;
        `;

        progressBarWrapper.appendChild(progressBarFill);
        progressBarWrapper.appendChild(progressText);
        progressContainer.appendChild(counterDiv);
        progressContainer.appendChild(progressBarWrapper);

        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = 'display: flex; gap: 12px; margin-top: 16px;';

        const insertBtn = document.createElement('button');
        insertBtn.textContent = '✅ Inserează';
        insertBtn.style.cssText = `
            flex: 1;
            padding: 10px;
            background: #1877f2;
            color: white;
            border: none;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
        `;

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = '❌ Anulează';
        cancelBtn.style.cssText = `
            flex: 1;
            padding: 10px;
            background: #e4e6eb;
            color: #1c1e21;
            border: none;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
        `;

        insertBtn.addEventListener('click', async () => {
            const text = textarea.value.trim();
            if (text) {
                insertBtn.disabled = true;
                cancelBtn.disabled = true;
                progressCounter = counterDiv;
                progressContainer.style.display = 'block';
                insertBtn.textContent = '⏳ Se inserează...';

                // Păstrează referința la modal pentru a-l putea închide
                const modalRef = modal;

                const success = await insertContentIds(text, (current, total, success) => {
                    updateProgressCounter(current, total, success);
                });

                if (success) {
                    modalRef.remove();
                } else {
                    insertBtn.disabled = false;
                    cancelBtn.disabled = false;
                    insertBtn.textContent = '✅ Inserează';
                    progressContainer.style.display = 'none';
                }
            }
        });

        cancelBtn.addEventListener('click', () => {
            modal.remove();
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });

        content.appendChild(title);
        content.appendChild(textarea);
        content.appendChild(progressContainer);
        buttonContainer.appendChild(insertBtn);
        buttonContainer.appendChild(cancelBtn);
        content.appendChild(buttonContainer);
        modal.appendChild(content);
        document.body.appendChild(modal);

        // Focus pe textarea
        setTimeout(() => textarea.focus(), 100);
    }

    // Buton flotant
    function addInsertButton() {
        if (document.getElementById('content-ids-insert-btn')) {
            return;
        }

        const button = document.createElement('button');
        button.id = 'content-ids-insert-btn';
        button.innerHTML = '📋<br>Paste IDs';
        button.style.cssText = `
            position: fixed;
            top: 100px;
            right: 20px;
            z-index: 2147483647;
            padding: 12px 16px;
            background: #1877f2;
            color: white;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 600;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            line-height: 1.2;
            text-align: center;
            pointer-events: auto;
        `;

        button.addEventListener('click', async () => {
            // Creează un overlay cu counter și bară de progres
            let overlay = document.getElementById('content-ids-overlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'content-ids-overlay';
                overlay.style.cssText = `
                    position: fixed;
                    top: 140px;
                    right: 20px;
                    z-index: 999997;
                    background: white;
                    padding: 16px;
                    border-radius: 8px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                    min-width: 300px;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                `;

                const overlayTitle = document.createElement('div');
                overlayTitle.textContent = '📋 Progres inserare';
                overlayTitle.style.cssText = 'font-weight: 600; margin-bottom: 12px; font-size: 14px;';

                const overlayCounter = document.createElement('div');
                overlayCounter.id = 'overlay-counter';
                overlayCounter.style.cssText = 'font-size: 12px; color: #65676b; margin-bottom: 8px; text-align: center;';

                const overlayProgressBar = document.createElement('div');
                overlayProgressBar.style.cssText = `
                    width: 100%;
                    height: 20px;
                    background: #e4e6eb;
                    border-radius: 10px;
                    overflow: hidden;
                    position: relative;
                `;

                const overlayProgressFill = document.createElement('div');
                overlayProgressFill.id = 'overlay-progress-fill';
                overlayProgressFill.style.cssText = `
                    height: 100%;
                    width: 0%;
                    background: linear-gradient(90deg, #1877f2 0%, #42a5f5 100%);
                    border-radius: 10px;
                    transition: width 0.3s ease;
                `;

                const overlayProgressText = document.createElement('div');
                overlayProgressText.id = 'overlay-progress-text';
                overlayProgressText.style.cssText = `
                    position: absolute;
                    width: 100%;
                    text-align: center;
                    color: #65676b;
                    font-size: 10px;
                    font-weight: 600;
                    top: 50%;
                    transform: translateY(-50%);
                    z-index: 1;
                `;

                overlayProgressBar.appendChild(overlayProgressFill);
                overlayProgressBar.appendChild(overlayProgressText);
                overlay.appendChild(overlayTitle);
                overlay.appendChild(overlayCounter);
                overlay.appendChild(overlayProgressBar);
                document.body.appendChild(overlay);

                progressCounter = overlayCounter;
                progressBarFill = overlayProgressFill;
            }

            await pasteFromClipboard();

            // Șterge overlay-ul după finalizare
            setTimeout(() => {
                const overlayElement = document.getElementById('content-ids-overlay');
                if (overlayElement) {
                    overlayElement.remove();
                }
            }, 3000);
        });

        button.addEventListener('mouseenter', function() {
            this.style.background = '#166fe5';
            this.style.transform = 'scale(1.05)';
        });

        button.addEventListener('mouseleave', function() {
            this.style.background = '#1877f2';
            this.style.transform = 'scale(1)';
        });

        document.body.appendChild(button);
        console.log('✅ Buton adăugat');
    }

    // Shortcut keyboard
    document.addEventListener('keydown', function(e) {
        if (e.ctrlKey && e.shiftKey && e.key === 'I') {
            e.preventDefault();
            pasteFromClipboard();
        }
    });

    // Funcție pentru a verifica și adăuga butonul
    function checkAndAddButton() {
        if (findInputField() && !document.getElementById('content-ids-insert-btn')) {
            addInsertButton();
            console.log('✅ Buton adăugat după detectare câmp');
        }
    }

    // Observer pentru câmp cu debounce pentru performanță
    let observerTimeout = null;
    const observer = new MutationObserver(() => {
        // Debounce pentru a evita apeluri prea frecvente
        if (observerTimeout) {
            clearTimeout(observerTimeout);
        }
        observerTimeout = setTimeout(() => {
            checkAndAddButton();
        }, 300); // Redus de la 500ms la 300ms pentru răspuns mai rapid
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class'] // Observă și schimbările de stil/clasă
    });

    // Verificare inițială (mai multe încercări)
    setTimeout(() => checkAndAddButton(), 500);
    setTimeout(() => checkAndAddButton(), 1000);
    setTimeout(() => checkAndAddButton(), 2000);

    // Verificare periodică de siguranță (doar dacă butonul lipsește)
    const checkInterval = setInterval(() => {
        if (document.getElementById('content-ids-insert-btn')) {
            // Dacă butonul există, continuă să verifici periodic (modalul poate să-l ascundă)
            return;
        }
        checkAndAddButton();
    }, 2000); // Redus de la 3000ms la 2000ms

    // Listener pentru click pe butoanele care deschid modale
    document.addEventListener('click', (e) => {
        // Dacă se dă click pe un buton care ar putea deschide un modal
        const target = e.target;
        if (target && (target.textContent?.includes('Create') || target.textContent?.includes('Add'))) {
            setTimeout(() => {
                checkAndAddButton();
            }, 1000);
        }
    }, true);

    // Listener pentru schimbări în DOM care indică deschiderea unui modal
    const modalObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.addedNodes.length > 0) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === 1) { // Element node
                        // Verifică dacă este un modal sau conține un modal
                        if (node.getAttribute && (
                            node.getAttribute('role') === 'dialog' ||
                            node.classList?.contains('x1n2onr6') ||
                            node.querySelector?.('[role="dialog"]')
                        )) {
                            setTimeout(() => {
                                checkAndAddButton();
                            }, 500);
                        }
                    }
                }
            }
        }
    });

    modalObserver.observe(document.body, {
        childList: true,
        subtree: true
    });

    console.log('✅ Script gata! Folosește Ctrl+Shift+I sau butonul 📋');
    }

    // Pornește scriptul - mai multe încercări pentru SPA-uri
    function startScript() {
        if (document.body) {
            try {
                initScript();
            } catch (error) {
                console.error('❌ Eroare la inițializare:', error);
                // Reîncearcă după 1 secundă
                setTimeout(() => {
                    try {
                        initScript();
                    } catch (e) {
                        console.error('❌ Eroare la reîncercare:', e);
                    }
                }, 1000);
            }
        } else {
            console.log('⏳ Aștept DOM...');
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', startScript);
            } else {
                setTimeout(startScript, 100);
            }
        }
    }

    // Pornește imediat
    startScript();

    // Reîncearcă după 2 secunde pentru SPA-uri (Facebook)
    setTimeout(() => {
        if (!document.getElementById('content-ids-insert-btn')) {
            console.log('🔄 Reîncercare inițializare pentru SPA...');
            startScript();
        }
    }, 2000);
})();
