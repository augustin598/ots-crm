# Audit & Debug: SEO Link Checking — 2026-03-04

## Context
Verificarea SEO linkurilor arăta fals "Problemă" pentru multe site-uri accesibile (elle.ro, viva.ro, libertatea.ro, unica.ro, a1.ro). Nu exista niciun console.log pentru debugging.

## Fișiere modificate
- `app/src/lib/remotes/seo-links.remote.ts`
- `app/src/routes/[tenant]/seo-links/+page.svelte`

## Buguri fixate

### BUG 1 (CRITIC): HEAD requests blocate de multe site-uri
- **Locație**: `performLinkCheck()` — seo-links.remote.ts
- **Problemă**: Folosea `fetch(url, { method: 'HEAD' })`. Multe site-uri de presă (elle.ro, viva.ro, libertatea.ro) returnează 403/405/500 la HEAD dar funcționează cu GET.
- **Fix**: Dacă HEAD returnează non-2xx/non-3xx/non-404, retry automat cu GET. Body-ul e anulat cu `getRes.body?.cancel()` pt performanță.

### BUG 2: Detecția redirect era cod mort
- **Locație**: `performLinkCheck()` — liniile 1133-1135
- **Problemă**: `redirect: 'follow'` urma automat redirect-urile, deci `httpCode === 301/302` nu se executa niciodată.
- **Fix**: HEAD folosește `redirect: 'manual'` acum — codurile 3xx sunt detectate corect. GET fallback păstrează `redirect: 'follow'`.

### BUG 3: Lipsă console.log pentru debugging
- **Locație**: Toate funcțiile de verificare
- **Fix**: Adăugat `[SEO-CHECK]` prefixed logs la:
  - `performLinkCheck`: rezultat HEAD, trigger GET fallback, rezultat GET, erori
  - `checkSeoLink`: start verificare, rezultat dofollow, keyword extras, erori
  - `checkSeoLinksBatch`: start (count), progres per-link, finalizare (OK/probleme)
  - `verifyDofollowFromPage`: rezultat, erori catch

### BUG 4: Erori înghițite silențios
- **Locație**: `checkSeoLink` catch block (linia 1248), `verifyDofollowFromPage` catch block (linia 1104)
- **Problemă**: `catch {}` gol — zero logging la erori de extragere HTML.
- **Fix**: Capturat eroarea cu `catch (e)` + `console.warn` cu detalii.

### BUG 5: alert() în loc de toast
- **Locație**: +page.svelte — liniile 856, 1007, 1018
- **Problemă**: `alert()` nativ pentru erori în loc de toast notification.
- **Fix**: Înlocuit 3x `alert()` cu `toast.error()` (toast deja importat din svelte-sonner).

### BUG 6: Matching domeniu imprecis în extractDofollowFromHtml
- **Locație**: linia 1077 — seo-links.remote.ts
- **Problemă**: `hrefNorm.includes(targetUrlNorm)` putea face match pe string-uri parțiale (ex: `glemis.ro` inside `anglemis.ro`).
- **Fix**: Parsing cu `new URL()` pentru hostname — comparare exactă sau subdomeniu + verificare prefix path.

### BUG 7: Filtru lună greșit în batch check
- **Locație**: `checkSeoLinksBatch` — linia 1308
- **Problemă**: Filtra pe `articlePublishedAt` (deseori null) în loc de câmpul `month`.
- **Fix**: Logică OR — folosește `articlePublishedAt` dacă există, altfel câmpul `month` (mirror `getSeoLinks`).

### BUG 8: Site-uri protejate cu Cloudflare JS Challenge arătau "Problemă"
- **Locație**: `performLinkCheck()` — seo-links.remote.ts
- **Problemă**: Site-uri cu Cloudflare Managed Challenge (libertateapentrufemei.ro, avantaje.ro) returnează 403 + header `cf-mitigated: challenge` atât la HEAD cât și la GET. Site-ul e accesibil în browser dar blochează bots.
- **Fix**: Detectare header `cf-mitigated: challenge` la ambele nivele (HEAD și GET fallback). Dacă e detectat, tratăm ca 'ok' (site-ul există) cu `errorMessage: 'Cloudflare JS Challenge'`. Logare: `[SEO-CHECK] Cloudflare JS Challenge detected`.
- **Limitare**: Nu putem verifica dofollow/nofollow server-side pentru site-uri cu CF challenge (necesită browser headless).

### BUG 9: Linkuri SEO create fără websiteId și targetUrl

- **Locație**: `createSeoLink`, `createSeoLinksBulk`, `checkSeoLink` — seo-links.remote.ts + inline row — +page.svelte
- **Problemă**: Inline row creation nu trimitea `websiteId` deloc. `targetUrl` auto-fill depindea de `client.website` (poate fi gol). `checkSeoLink` extragea `targetUrl` dar nu asigna `websiteId`.
- **Fix 1 — createSeoLink/createSeoLinksBulk**: Auto-assign `websiteId` pe baza domeniului din `targetUrl` — caută `clientWebsite` cu domeniu matching via `extractDomainFromUrl`.
- **Fix 2 — checkSeoLink**: După extragerea `targetUrl`, caută `clientWebsite` matching și setează `websiteId` automat.
- **Fix 3 — inline row UI**: Trimite `websiteId` explicit (match pe domeniu din `filterWebsites`). Auto-fill `rowTargetUrl` fallback din `filterWebsites[0].url` dacă `client.website` e gol.

---

## Sprint 2: Cloudflare Bypass + extractedLinks — 2026-03-04

### Funcționalități noi

#### Cloudflare Bypass (Puppeteer + Stealth)
- **Fișiere create**: `app/src/lib/server/scraper/cloudflare-bypass.ts`, `app/src/lib/server/scraper/find-chrome.ts`
- **Dependințe**: `puppeteer-core`, `puppeteer-extra`, `puppeteer-extra-plugin-stealth`
- Singleton browser cu lazy init (pornește doar la primul Cloudflare detectat)
- Auto-close după 5 min idle, max 3 pagini concurente
- Detectie Cloudflare: headere (`cf-mitigated`, `server: cloudflare` + 403/503) + HTML (`Just a moment...`, `window._cf_chl_opt`)
- Graceful shutdown pe SIGTERM/SIGINT în `hooks.server.ts`

#### extractedLinks — Multiple keywords/URLs per articol
- **Coloană nouă**: `extracted_links TEXT` pe tabela `seo_link` (JSON: `[{url, keyword}]`)
- La verificare (check single + batch), se extrag TOATE linkurile către domeniul clientului, nu doar cel "best"
- Tabelul afișează keywords și URL-uri țintă numerotate (1., 2., ...) când sunt mai multe
- Dialogul de creare/editare permite selectarea unui link din cele extrase

### 7 puncte de fetch migrate la Cloudflare Bypass

| # | Funcția | Ce se schimbă |
|---|---------|---------------|
| 1 | `extractSeoLinkData()` | GET articol pentru extragere keyword/anchorText |
| 2 | `extractTargetUrlForSeoLink()` | GET articol pentru URL țintă |
| 3 | `extractTargetUrlBatch()` | GET articol în loop pentru URL-uri țintă |
| 4 | `verifyDofollowFromPage()` | GET articol pentru verificare dofollow |
| 5 | `performLinkCheck()` | Adăugat `cloudflareSuspected` la return type |
| 6 | `checkSeoLink()` | GET articol + extragere completă (keyword, targetUrl, dofollow, publishedAt, extractedLinks) |
| 7 | Auto-detect websiteId (import) | GET articol la import Excel |

### Buguri pre-audit corectate

#### Fix: Linkuri fără targetUrl nu primeau date extrase
- **Problemă**: Condiția `(link.targetUrl || !link.articlePublishedAt || needsKeyword)` era `false` când `targetUrl` era null dar celelalte câmpuri existau
- **Fix**: Adăugat `needsTargetUrl = !link.targetUrl` + inclus în condiție

#### Fix: targetUrl se extragea doar când keyword lipsea
- **Problemă**: Blocul de extragere HTML rula doar `if (needsKeyword)`, dar targetUrl putea lipsi independent
- **Fix**: Schimbat la `if (needsKeyword || needsTargetUrl)`

#### Fix: Dofollow "Neverificat" pentru linkuri cu targetUrl nou extras
- **Problemă**: Verificarea dofollow rula doar pentru `link.targetUrl` existent, nu pentru `extractedTargetUrl` proaspăt extras
- **Fix**: Adăugat verificare dofollow după extragerea targetUrl

#### Fix: checkSeoLinksBatch nu făcea extragere completă
- **Problemă**: Batch check-ul verifica doar dofollow (dacă targetUrl exista) — nu extragea keyword, targetUrl, articlePublishedAt, websiteId sau extractedLinks
- **Fix**: Actualizat batch check cu aceeași logică completă ca single check

### Buguri din audit final

#### BUG 10 (CRITICAL) — extractedLinks nu se restaura la Edit Dialog
- **Locație**: `openEditDialog()` — +page.svelte
- **Problemă**: Când deschideai dialogul de editare pe un link cu `extractedLinks` salvat în DB, câmpul rămânea `[]` — linkurile extrase anterior nu se încărcau
- **Impact**: La re-salvare, linkurile extrase se pierdeau
- **Fix**: Adăugat `extractedLinks = parseExtractedLinks(link);` în `openEditDialog()`

#### BUG 11 (CRITICAL) — extractedLinks nu se trimitea la Update
- **Locație**: `handleSubmit()` branch `isEditing` — +page.svelte
- **Problemă**: Apelul `updateSeoLink()` din modul editare nu includea `extractedLinks`. Dacă utilizatorul re-extragea datele din articol, linkurile noi se pierdeau la salvare
- **Impact**: Editarea unui link ștergea silent `extractedLinks` din DB
- **Fix**: Adăugat `extractedLinks: extractedLinks.length > 1 ? JSON.stringify(extractedLinks) : undefined` în apelul `updateSeoLink()`

#### BUG 12 (HIGH) — extractTargetUrlBatch: filtrul de lună excludea linkuri cu NULL articlePublishedAt
- **Locație**: `extractTargetUrlBatch()` — seo-links.remote.ts
- **Problemă**: Filtrul `like(articlePublishedAt, month + '%')` excludea linkurile cu `articlePublishedAt = NULL` (linkuri noi, neverificate). Foloseau câmpul `month` ca fallback dar filtrul nu ținea cont
- **Fix**: Înlocuit cu pattern-ul OR consistent din `getSeoLinks`:
  ```ts
  or(
    and(isNotNull(articlePublishedAt), like(articlePublishedAt, monthPrefix)),
    and(isNull(articlePublishedAt), eq(month, filters.month))
  )
  ```

#### BUG 13 (HIGH) — Browser crash bloca activePages permanent
- **Locație**: `ensureBrowser()` + `fetchWithPuppeteer()` — cloudflare-bypass.ts
- **Problemă**: Dacă browser-ul Puppeteer crasha, `ensureBrowser()` detecta browser-ul deconectat dar NU reseta contorul `activePages`. Counter-ul rămânea blocat → deadlock. `page.close()` putea hangă indefinit dacă browser-ul era mort
- **Impact**: După un crash al Chrome, toate verificările SEO se blocau până la restart server
- **Fix**:
  1. Adăugat `state.activePages = 0;` în blocul de cleanup la browser disconnect
  2. Adăugat timeout 5s pe `page.close()`: `Promise.race([page.close(), new Promise(r => setTimeout(r, 5000))])`

#### BUG 14 (MEDIUM) — articlePublishedAt lipsea din bulk create schema + insert
- **Locație**: `createSeoLinksBulkSchema` + `createSeoLinksBulk` — seo-links.remote.ts
- **Problemă**: Schema valibot pentru crearea bulk nu includea `articlePublishedAt`, iar insert-ul nu salva valoarea
- **Fix**: Adăugat `articlePublishedAt: v.optional(v.string())` în schema + `articlePublishedAt: data.articlePublishedAt || null` în insert values

#### BUG 15 (LOW) — parseExtractedLinks nu valida structura elementelor JSON
- **Locație**: `parseExtractedLinks()` — +page.svelte
- **Problemă**: După `JSON.parse`, funcția verifica doar `Array.isArray()` dar nu verifica că fiecare element are `url` și `keyword`
- **Fix**: Adăugat `.filter(el => el && typeof el.url === 'string' && typeof el.keyword === 'string')`

---

## Fișiere modificate (total Sprint 1 + Sprint 2)

| Fișier | Tip modificare |
|--------|---------------|
| `app/src/lib/server/scraper/cloudflare-bypass.ts` | NOU — Singleton browser Puppeteer + Stealth |
| `app/src/lib/server/scraper/find-chrome.ts` | NOU — Chrome path finder |
| `app/src/lib/remotes/seo-links.remote.ts` | MODIFICAT — 7 fetch points + extractedLinks + bugfix-uri |
| `app/src/routes/[tenant]/seo-links/+page.svelte` | MODIFICAT — UI multi-keyword + extractedLinks + bugfix-uri |
| `app/src/lib/server/db/schema.ts` | MODIFICAT — coloană `extracted_links` |
| `app/src/hooks.server.ts` | MODIFICAT — graceful shutdown browser |
| `app/package.json` | MODIFICAT — dependințe puppeteer |

## Migrare DB
- Coloană: `ALTER TABLE seo_link ADD COLUMN extracted_links TEXT`
- Aplicată manual pe local + remote (nu necesită re-migrare)

## Cum se testează
1. Rulează verificare pe un link care era "Problemă" (elle.ro, libertatea.ro) — ar trebui să fie "OK" acum
2. Verifică în consola serverului logurile `[SEO-CHECK]`
3. Rulează batch check filtrat pe lună — linkuri cu `articlePublishedAt` null trebuie incluse
4. Testează un articol cu 2+ linkuri (ex: bzi.ro/glemis) — tabelul arată keywords/URLs numerotate
5. Editează un link cu extractedLinks → deschide dialogul → verifică că linkurile apar → salvează → verifică persistența
6. Site cu Cloudflare (avantaje.ro, libertateapentrufemei.ro) — Puppeteer bypass funcționează, dofollow verificat
7. extractTargetUrlBatch cu filtru lună — include linkuri cu articlePublishedAt NULL
