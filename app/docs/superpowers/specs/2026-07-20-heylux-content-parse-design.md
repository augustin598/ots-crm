# Heylux Content Pipeline — Faza 1: Parsare & Ingestie

**Data:** 2026-07-20
**Status:** Design aprobat, în așteptare review spec
**Autor:** Claude (brainstorming cu Augustin)

## Context

Avem 326 de advertoriale (URL-uri) în [`app/Heylux_pars.md`](../../../Heylux_pars.md), publicate 2011–2024 pe ~60 de domenii de presă și pe site-urile proprii ale studiourilor de videochat din Iași (Heylux, Lucky Studio, Preziosa, ForumVideochat, Fetele Norocoase, VivaDiva).

Obiectivul de ansamblu: reconstruim acest corpus de conținut ca articole **unice** pe site-urile WordPress proprii, programate ~3/săptămână.

## Descompunere în 3 faze

| Fază | Ce face | Livrare |
|---|---|---|
| **1. Parsare (ACEST spec)** | scrape 326 → extrage titlu/corp/dată/imagini/brand → DB + pagină de monitorizare | acum |
| 2. Rescriere | Claude local generează un articol unic per rând, review în CRM | ulterior |
| 3. Publicare | rutare brand→site WP, programare `status:future`, cadență 3/săpt | ulterior |

Fiecare fază primește spec + plan propriu. **Acest document acoperă doar Faza 1.**

## Scop Faza 1

**In scope:**
- Ingestia celor 326 URL-uri din `Heylux_pars.md` în DB (rânduri `pending`, dedup pe `sourceUrl`).
- Extracția robustă a conținutului (titlu, corp HTML curat, text, dată publicare, imagini) reutilizând motorul de scraping din seo-links.
- Detecția brandului per articol.
- Pagină `/ots/content/heylux` pentru monitorizare + retry.

**Out of scope (fazele 2-3, doar placeholdere inactive în schemă):**
- Rescrierea articolelor.
- Maparea brand→site WP și publicarea/programarea.
- Descărcarea/re-găzduirea imaginilor în WP media.

## Decizii (din brainstorming)

1. **Conținut → rescriere unică** (Claude), nu repost verbatim → evită duplicate content. (Faza 2.)
2. **Stocare → feature CRM (DB + pagină)**, nu fișiere în repo.
3. **Publicare → rutare pe brand** către site-uri WP diferite. (Faza 3.)
4. **Prima livrare → doar parsarea** tuturor celor 326.
5. **Abordare → A**: tabelă DB + seed + task batch de extracție (scheduler) + UI de monitorizare. Resumabil și observabil. Fallback Puppeteer live-DOM (C) doar când extracția statică dă text subțire.

## Arhitectură Faza 1

```
Heylux_pars.md ──importHeyluxSources──▶ content_article (326 × status=pending)
                                              │
                                    content-extract task (batch, concurență 3-4)
                                              │
        fetchWithCloudflareFallback(url) ─▶ html
                                              │
        article-extractor: titlu + Readability(corp) + dată + imagini
        brand-detector: slug/conținut → brand
                                              │
                                     UPDATE content_article (status=ok|failed|thin)
                                              │
                              /ots/content/heylux (tabel + filtre + retry)
```

### Componente

Fiecare unitate are un singur scop și interfață clară:

**1. `src/lib/server/content/article-extractor.ts`** — extracția de conținut dintr-un HTML.
- `extractArticle(html: string, sourceUrl: string): ExtractedArticle`
- `ExtractedArticle = { title, bodyHtml, bodyText, excerpt, wordCount, publishedAt, featuredImageUrl, images[] }`
- Pași: `og:title`/`<title>` → titlu; `@mozilla/readability` peste DOM `linkedom` → corp HTML curat + text; reutilizează helper-ele de dată → dată; `og:image` + `<img>` din corp → imagini; curățare boilerplate (share-buttons, „citește și", reclame).
- Depinde de: `@mozilla/readability`, `linkedom`, și helper-ele de dată. **Refactor concret:** `extractArticlePublishedDate` + `parseDateToIso`/`parseRomanianRelativeDate`/`parseRomanianAbsoluteDate` (azi funcții private în `seo-links.remote.ts`) se mută într-un modul partajat `src/lib/server/scraper/article-date.ts`, iar `seo-links.remote.ts` le re-importă de acolo (fără schimbare de comportament).
- Pur (fără DB, fără fetch) → testabil cu golden HTML fixtures.

**2. `src/lib/server/content/brand-detector.ts`** — deduce brandul.
- `detectBrand(sourceUrl: string, title: string, bodyText: string): Brand`
- `Brand = 'heylux' | 'luckystudio' | 'preziosa' | 'forumvideochat' | 'fetelenorocoase' | 'vivadiva' | 'unknown'`
- Prioritate: **slug > conținut**. Ordine de rezolvare: `preziosa > luckystudio (lucky-studio | fetele-norocoase) > forumvideochat > vivadiva > heylux (default când menționează heylux)`. Motiv: articolele „forumvideochat" și comparative menționează Heylux dar nu sunt Heylux; Heylux e fallback pentru ambiguu.
- Pur → testabil.

**3. `src/lib/server/content/fetch-article.ts`** — wrapper de fetch (reutilizează scraping-ul existent).
- `fetchArticleForExtraction(url): Promise<{ html, usedPuppeteer }>`
- Primar: `fetchWithCloudflareFallback(url)`. Dacă extracția statică dă < ~250 cuvinte → fallback C (Puppeteer live-DOM, opțional injectare Readability). Marchează `thin` dacă și fallback-ul e slab.

**4. `src/lib/remotes/content-articles.remote.ts`** — remote functions (staff-gated).
- `getContentArticles(filters)` — query (brand, status, paginare).
- `importHeyluxSources()` — command: citește `Heylux_pars.md`, inserează rânduri `pending` dedup pe `sourceUrl`, creează un `content_import_job`.
- `startContentExtraction(jobId?)` — command: enqueue task `content-extract`.
- `retryFailedExtractions()` — command: resetează `failed`/`thin` la `pending`, enqueue.
- `getContentImportJob(id)` — query: progres.
- Toate cu `requireStaff(event)` (regula F8 — vezi memoria proiect).

**5. `src/lib/server/scheduler/tasks/content-extract.ts`** — task batch.
- Nerecurent; pornit la cerere din UI (`schedulerQueue.add`), înregistrat cu `registerTask('content-extract', handler)`.
- Procesează rânduri `pending` în loturi (concurență 3-4, ca `checkSeoLinksBatch`), actualizează `content_import_job` (processed/error counts), resumabil după restart (mirror pe logica de „interrupted" a discovery-job).
- Per rând: fetch → extract → brand → UPDATE status.

**6. `src/routes/[tenant]/content/heylux/+page.svelte` + `+page.ts`** — UI.
- Tabel: brand, titlu, cuvinte, status, dată publicare, sursă (link).
- Filtre: brand, status.
- Butoane: „Importă surse" (dacă gol), „Pornește extracția", „Reîncearcă eșecuri".
- Badge progres din `content_import_job`.
- Read-only pe conținut în faza 1 (preview corp opțional în drawer).
- Intrare în `sidebar-nav.ts`.

### Schema DB (nouă)

`content_article` (`content_article`), tenant-scoped, oglindește convențiile din `seoLink`:

```
id            text PK
tenantId      text NOT NULL → tenant.id
brand         text NOT NULL default 'unknown'
sourceUrl     text NOT NULL          -- unique per tenant (dedup)
sourceDomain  text NOT NULL
title         text
slug          text
excerpt       text
bodyHtml      text                   -- corp curățat
bodyText      text
wordCount     integer default 0
featuredImageUrl text
images        text                   -- JSON string[]
publishedAt   timestamp
extractStatus text NOT NULL default 'pending'  -- pending|ok|failed|thin
extractError  text
usedPuppeteer integer default 0      -- boolean
extractedAt   timestamp
-- placeholdere inactive faza 2-3:
rewriteStatus text default 'none'    -- none|drafting|ready
targetWpSiteId text
wpPostId      integer
scheduledAt   timestamp
createdAt     timestamp default current_timestamp
updatedAt     timestamp default current_timestamp
```
Index: `(tenantId, sourceUrl)` unique; `(tenantId, extractStatus)`; `(tenantId, brand)`.

`content_import_job` (`content_import_job`), mirror pe `seoLinkDiscoveryJob`:
```
id, tenantId → tenant.id, userId,
status text default 'pending'  -- pending|running|completed|failed|interrupted|cancelled
totalArticles integer default 0
processedArticles integer default 0
okCount, failedCount, thinCount integer default 0
error text
startedAt, finishedAt, createdAt, updatedAt timestamp
```

Migrare via `db:gen` (fix-migrations.ts) — NU `drizzle-kit generate` (snapshot collision cunoscut). Un `CREATE TABLE` per fișier de migrare (regula Turso single-statement). Nu adăuga coloană în schema.ts înainte de aplicarea migrării (hazard select-all).

### Flux de date

1. Staff deschide `/ots/content/heylux` → gol → „Importă surse" → `importHeyluxSources()` → 326 rânduri `pending` + job.
2. „Pornește extracția" → `startContentExtraction()` → `schedulerQueue.add('content-extract')`.
3. Task procesează loturi → per rând: `fetchArticleForExtraction` → `extractArticle` → `detectBrand` → UPDATE. Actualizează job counts.
4. UI polling pe `getContentImportJob` (manual refresh + on-load; fără auto-poll implicit — vezi memoria).
5. Rânduri `failed`/`thin` → „Reîncearcă eșecuri" → reset `pending` → re-enqueue.

### Erori

- Fetch eșuat (403/timeout/CF hard): `extractStatus='failed'`, `extractError` = mesaj scurt; job `failedCount++`; nu blochează lotul.
- Corp subțire după fallback: `extractStatus='thin'` (nu `failed`) → apare separat în UI pt review manual.
- Restart worker în timpul task: rânduri rămân `pending`; job marcat `interrupted`; „Reîncearcă"/„Pornește" reia.
- Toate erorile → `logError('content', …)` (pattern error-handling existent).

### Testare

- **Unit (golden fixtures):** `article-extractor` pe HTML salvat din 6-8 domenii reprezentative (bzi.ro, ziaruldeiasi.ro, libertatea.ro cu CF, heylux.ro, preziosa.ro, o pagină JS-heavy). Verifică titlu/corp/dată/wordCount.
- **Unit:** `brand-detector` pe ~15 slug-uri (inclusiv cazuri ambigue: `forumvideochat`-mentions-heylux, comparative).
- **Integration (smoke):** `importHeyluxSources` inserează 326 fără duplicate; re-rulare idempotentă.
- **Manual (verify skill):** rulează extracția pe un lot mic, verifică în UI status ok/thin/failed real.

## Reutilizat vs. nou

**Reutilizat:** `fetchWithCloudflareFallback` (cloudflare-bypass.ts), `extractArticlePublishedDate` + helper-ele de dată RO (seo-links.remote.ts → mutate/importate dintr-un modul partajat), pattern multi-tenant, pattern scheduler+job-status (seoLinkDiscoveryJob), remote functions, `requireStaff`.

**Nou:** tabele `content_article`/`content_import_job`, `article-extractor.ts`, `brand-detector.ts`, `fetch-article.ts`, `content-articles.remote.ts`, task `content-extract`, pagină `/ots/content/heylux`.

**Dependințe noi:** `@mozilla/readability`, `linkedom`.

## Riscuri / de urmărit

- **Extracție pe ~60 domenii** — Readability e bun dar nu perfect; statusul `thin` + review manual absorb variația. Golden fixtures pe domeniile dominante (bzi.ro, ziaruldeiasi.ro, heylux.ro concentrează majoritatea).
- **Cloudflare/anti-bot** — deja gestionat de motorul existent; unele site-uri moarte (2011-2015) vor da `failed` definitiv — acceptabil.
- **Site-uri dispărute** — o parte din URL-urile vechi pot fi 404/domeniu expirat → `failed`, vizibile în UI.
- **Reconciliere „folder în repo" vs DB** — cererea inițială menționa un folder `Content/heylux`; decizia finală e DB. Dacă la faza 2 Claude local trebuie să editeze fișiere, adăugăm un export DB→fișiere atunci (nu acum).
