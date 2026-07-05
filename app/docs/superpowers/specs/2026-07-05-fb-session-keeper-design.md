# FB Session Keeper — headless pe server pentru facturile Meta Ads

**Data:** 2026-07-05 · **Status:** aprobat (opțiuni alese de utilizator: keep-alive complet pe server, la 3 zile, doar Meta acum)

## Problema

Descărcarea lunară a facturilor Meta (cron `meta-ads-invoice-sync`, deja programat pe **1 ale lunii la 07:00** Europe/Bucharest) rulează complet server-side cu `fetch` + cookie-uri FB criptate din DB (`metaAdsIntegration.fbSessionCookies`). Singura verigă manuală: când sesiunea Facebook expiră, cookie-urile trebuie reîmprospătate prin „Scan cu Browser", care deschide Chrome **vizibil pe laptopul utilizatorului** (dev, `headless: false`). În producție scanul e inutilizabil: browserul ar rula headless, dar `createSession` nu injectează cookie-urile din DB, deci pornește delogat și nimeni nu se poate loga interactiv.

Serverul are deja Chromium în imagine (`Dockerfile`, `CHROME_PATH=/usr/bin/chromium`, puppeteer-core 24.38).

## Soluția

Un „session keeper" headless pe server care refolosește cookie-urile existente din Settings Meta și le ține vii:

### 1. Injecție de cookie-uri în browser (`invoice-scraper.ts` + modul nou)
- Helper `normalizeCookiesForPuppeteer(cookies: FbCookie[])`: mapează formatul stocat (Cookie-Editor sau puppeteer) la `CookieParam` — `sameSite` (`no_restriction→None`, `lax→Lax`, `strict→Strict`, `unspecified→omis`), `expires` (fallback pe `expirationDate`, omis dacă lipsește/-1), filtrează cookie-uri fără nume/valoare și non-`.facebook.com`.
- `createSession` (fluxul interactiv existent) injectează cookie-urile din DB înainte de navigare → chiar și scanul de pe laptop sare peste login când sesiunea e validă.

### 2. `refreshFbSessionHeadless(tenantId, integrationId, opts?)` — modul nou `src/lib/server/scraper/headless-session-refresh.ts`
- `opts.skipIfFresherThanMs`: dacă `fbSessionRefreshedAt` e mai recent, întoarce `skipped_fresh` (UI-ul folosește force).
- Guard anti-concurență per integrare (map pe `globalThis` symbol) → `busy`.
- Lansează un browser **întotdeauna headless** (`headless: true` — new headless, redare fidelă), proaspăt per rulare, închis în `finally`; aceleași args de stealth ca fluxul interactiv; **User-Agent unificat** `FB_USER_AGENT` (exportat din `meta-ads/constants.ts`, aceeași valoare ca în `invoice-downloader.ts` — browserul și fetch-ul trebuie să arate identic).
- Injectează cookie-urile → `goto` billing hub → verifică `isLoggedIn` (pattern-ul existent din `LOGIN_INDICATORS.meta`).
- **Logat**: `extractBrowserCookies(page,'meta')` → `saveCookiesFromBrowser` (salvează cookie-urile rotite de FB, setează `fbSessionStatus='active'` + `fbSessionRefreshedAt=now`) → `refreshed`.
- **Redirect login/checkpoint**: `fbSessionStatus='expired'` → `expired`.
- **Timeout/erori de rețea**: NU atinge statusul (fără false-expire) → `error`.
- Fără cookie-uri în DB → `no_cookies`.

### 3. Cron nou de keep-alive `fb-session-keepalive`
- Task `scheduler/tasks/fb-session-keepalive.ts`: iterează integrarile Meta active cu cookie-uri, rulează refresh-ul (skip dacă < 24h), **notifică adminii doar la tranziția active→expired** (același pattern de notificare ca task-ul lunar).
- Programare: `0 5 */3 * *` Europe/Bucharest (zilele 1,4,7,… la 05:00). Pe data de 1 rulează cu 2h înaintea sync-ului de facturi.
- Înregistrare: `taskHandlers.fb_session_keepalive`, `schedulerQueue.add`, adăugat în `expectedJobIds`.

### 4. Sync-ul lunar primește „pasul 0"
- În `processMetaAdsInvoiceSync`, înaintea descărcărilor: refresh headless per integrare (best-effort, `skipIfFresherThanMs: 24h`, try/catch — la eșec continuă cu cookie-urile stocate, ca azi).
- Corectat comentariul învechit („2nd of each month at 9AM" → „1st of each month at 7:00 AM").

### 5. Schema: `fb_session_refreshed_at`
- Migrație hand-authored, **un singur statement**: `ALTER TABLE meta_ads_integration ADD COLUMN fb_session_refreshed_at integer;` — aplicată cu `db:migrate` + verificată cu PRAGMA **înainte** de a adăuga coloana în `schema.ts` (hazardul select-all).
- Setată în `saveFbSessionCookies` (punct unic de scriere).

### 6. UI pe `/ots/invoices/meta-ads`
- Command nou `refreshFbSessionOnServer` în `meta-ads-invoices.remote.ts` cu **`requireStaff`** (regula F8), apelează refresh-ul cu `force`.
- Buton „Refresh sesiune server" lângă „Scan cu Browser" + afișare ultimul refresh (`fbSessionRefreshedAt`) și status sesiune. „Scan cu Browser" rămâne doar ca bootstrap (primul login / după checkpoint).

## Ce NU se schimbă
- Fluxul de descărcare PDF (`invoice-downloader.ts`) — doar primește cookie-uri mereu proaspete.
- Bootstrap-ul manual (paste cookies în Settings / Scan cu Browser pe laptop) — necesar o singură dată sau după checkpoint.
- Google Ads / TikTok — infra e generică (platform-aware), dar activăm doar Meta acum.

## Riscuri asumate
- FB poate da checkpoint sesiunilor de pe IP de datacenter. Atenuare: UA identic cu fetch-ul, cookie-uri complete (`datr`/`sb` = continuitate fingerprint), frecvență blândă (3 zile), IP stabil de cluster. La checkpoint: notificare + bootstrap manual o dată.
- Old-headless (`shell`) e folosit de fluxul interactiv în prod; refresh-ul folosește new headless (`true`) pentru redare fidelă a SPA-ului business.facebook.com.

## Testare
- Unit: `normalizeCookiesForPuppeteer` (mapări sameSite, expires/expirationDate, filtrare junk).
- Unit: logica keep-alive de tranziție/notificare (refresh mock-uit) — notifică doar active→expired, o singură dată.
- Manual pe prod: butonul „Refresh sesiune server" + log-urile task-ului; prima validare reală la următoarea rotație de cookie-uri.
