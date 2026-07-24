# Audit & Debug — /ots/settings/claude (Modul Claude plugin)

**Data:** 2026-07-24 · **Branch:** `feat/heylux-content-rewrite` · **Scop:** pagina de configurare Claude + întreg lanțul ei server-side (remote functions, resolver, crypto, schema, migrări, capabilities, plugin registry).

## Verdict

Modulul e **solid și funcțional în producție**. Autorizarea, criptarea, migrările și starea live pe Turso au trecut auditul fără defecte critice. S-au găsit și reparat **5 defecte reale, toate în UI** (robustețe la erori + onestitatea afișării). Restul constatărilor sunt riscuri mici, documentate și acceptate.

## Ce s-a verificat (cu evidență)

| Dimensiune | Rezultat |
|---|---|
| Autorizare remote functions | ✅ 5/5 au `scope()` (user+tenant) + `getActor` + `assertCan` pe `admin.claude.view`/`admin.claude.manage`; capabilities definite în `src/lib/access/catalog.ts` (owner + admin, `unsafeUnlessRole: 'admin'` pe manage) |
| Criptare chei | ✅ AES-256-GCM per-tenant (PBKDF2), `encryptVerified` cu round-trip check; ciphertext-ul nu părăsește serverul (query întoarce doar hint = ultimele 4 caractere + booleeni) |
| Schema vs migrări | ✅ `claude_integration`: 0404–0406 + 0413 (second_key_encrypted) + 0414 (second_key_type) + 0415 (second_key_hint) + 0416 (routes) — **toate aplicate pe Turso** (PRAGMA table_info verificat live: 15/15 coloane) |
| Plugin registry | ✅ rând `plugin` claude activ + `tenant_plugin` activ pentru ots; seed automat `ensureClaudePluginInDatabase()` |
| Stare live tenant ots | ✅ 2 sloturi (primar oat …7AAA, secundar api …ywAA), override rutare `copywriting → api/sonnet-5`, `last_error` null, testat cu succes azi |
| Teste unit | ✅ 26/26 pass (key-utils, client, resolver index, usecases) |
| svelte-check | ✅ 0 erori / 0 warnings (heap 8GB) |
| svelte-autofixer | ✅ 0 issues pe pagina finală |
| Smoke test browser (Playwright, dev live) | ✅ login → pagina redă exact starea DB: 2 sloturi conectate, 8 rânduri rutare, ultimul test afișat, 8/8 selecturi cu aria-label, fără loading blocat |

## Defecte găsite și REPARATE (toate în `+page.svelte`)

1. **F1 — Spinner etern la eșec de query.** `integrationQuery.error` nu era folosit: un 403 (rol fără `admin.claude.view` care ajunge pe URL) sau o eroare de rețea lăsa pagina pe „Se încarcă…" pentru totdeauna, cu sloturile afișate fals „neconectat". → Banner de eroare cu mesaj + buton „Reîncearcă" (`integrationQuery.refresh()`); conținutul se randează doar fără eroare.
2. **F2 — Select de model desincronizat la eșec.** Dacă `setClaudeRoute` eșua, `<select value={route.model}>` rămânea vizual pe valoarea aleasă deși starea reală era neschimbată (Svelte nu re-aplică un `value` derived neschimbat peste selecția DOM a userului). → `{#key routeResetNonce}` pe select, nonce incrementat în `catch` → revert vizual garantat.
3. **F3 — UI mincinos la rută spre slot gol.** O rută (override sau default) care țintește un slot fără cheie era afișată ca activă pe acel slot, deși serverul (`selectLenient` din `getClaudeClientFor`) folosește în tăcere cealaltă cheie. → Indicator „slotul rutat e gol — folosește {cealaltă} (fallback)" pe rândul afectat.
4. **F4 — `lastTestedAt`/`lastError` moarte.** Returnate de query, niciodată afișate. → Rând „Ultimul test reușit: {dată}" / „Ultimul test ({dată}): {eroare}" sub sloturi (format ro-RO).
5. **F5 — A11y.** Selectul de model nu avea `aria-label` (grupul segmented avea). → `aria-label="Model pentru {use-case}"`.

**Reparate suplimentar, din review-uri:**

6. **F6 — Unhandled rejection pe butonul „Reîncearcă"** (găsit de review-ul intern). `integrationQuery.refresh()` întoarce o promisiune care se respinge la eșec, iar catch-ul protector al SvelteKit e atașat doar promisiunii inițiale → fiecare retry eșuat loga `Uncaught (in promise)`. → `.catch(() => {})` (eroarea e deja afișată de banner prin `queryError`) + buton dezactivat cu spinner cât timp `loading`.
7. **F7 — Fallback-ul `selectLenient` era silențios server-side** (semnalat de security review). Când ruta unui use-case țintește un slot gol, `getClaudeClientFor` folosește cealaltă cheie fără nicio urmă în loguri. → `logWarning('plugin', 'Claude route fallback…', { useCaseId, routedKeyType, usedKeyType })` în `index.ts`, cu **2 teste noi TDD (red-green)** în `index.test.ts` — total 28/28 pass.

## Constatări NEreparate (risc acceptat, documentat)

- **TOCTOU pe `saveClaudeKey`/`deleteClaudeKey`** — read-then-write fără tranzacție; două salvări concurente pot pierde una din chei. Realist un singur admin per tenant; tranzacțiile pe Turso au istoric de write-lock-uri aici. Se acceptă.
- **Fără rate-limit pe `testClaudeConnection`** — gated pe `admin.claude.manage`; risc mic de abuz.
- **`scope()` aruncă `Error('Unauthorized')` → 500, nu 401** — convenția dominantă a codebase-ului (428 apariții în remotes); de schimbat doar printr-o migrare globală, nu izolat aici.
- **`confirm()` nativ la ștergere** — pattern folosit în toate paginile settings; consecvent.
- **Flash scurt „neconectat" la primul load** — cosmetic; sloturile apar off până sosește răspunsul query-ului.
- **Model scos din catalog → opțiune fantomă în select** — `parseStoredRoutes` păstrează modelul stocat nevalidat pentru UI (serverul îl validează prin `isKnownClaudeModel` la consum). Edge forward-compat, YAGNI.
- **Colateral, nelegat de modul:** `/api/notifications/stream` răspunde 403 în dev după login (vizibil în consolă pe toate paginile). De investigat separat — e top-level `/api/*` (vezi regula rutelor tenant-scoped).

## Note operaționale

- Testul de conexiune OAuth are fallback: `/v1/models` → la 401/403/404 încearcă `/v1/messages` cu `max_tokens: 1` (beta header `oauth-2025-04-20`).
- `getClaudeClientFor(tenantId, useCaseId)` e API-ul de consum pentru Faza 2 (Heylux): rută use-case → `general` → default catalog; cheie strictă pe slot doar la `getClaudeClient(tenantId, keyType)`.
- Ștergerea ultimei chei șterge rândul întreg → rutele se pierd (documentat în cod, intenționat).

## Review-uri externe

**Review intern (subagent code-reviewer):** verdict „Ready, with one recommended pre-commit fix". A validat F3 pe toate cele 4 combinații rută/slot contra `selectLenient`, a confirmat `{#key}`-ul ca fix idiomatic și race-safe (batch cu `routing=null` într-un singur flush), și a verificat în sursa SvelteKit 2.47.3 că erorile client sosesc ca `HttpError` (nu `instanceof Error`) — deci ordinea din `errMsg` e corectă. Singura problemă Important (F6, unhandled rejection pe retry) — **aplicată**. Minore acceptate conștient: pierderea focusului la revert (doar pe error path), indentarea nemodificată a blocului împachetat (minimal-diff deliberat), afișarea `lastError` e per-rând nu per-slot (copy-ul nu pretinde altceva).

**Security review (agentul Gemini):** Gemini CLI nu a răspuns în timp util — agentul a livrat analiza proprie ca **fallback, etichetată explicit**. Concluzii: fără vulnerabilități critice; autorizarea, criptarea (AES-256-GCM + PBKDF2), și hardening-ul clientului HTTP (URL fix, timeout, truncare erori) confirmate solide. Constatări triate:
- „TOCTOU pe save/delete" → confirmă constatarea proprie; rămâne risc acceptat (vezi mai sus).
- „lastError afișat raw = risc XSS" → **fals pozitiv respins**: `{current.lastError}` e interpolare de text Svelte, escapată automat; nu există `{@html}`. (Recomandarea de a introduce `{@html}` cu sanitizare ar fi un regres.)
- „Fallback `selectLenient` nelogat" → valid, reparat ca F7.
- „Versionare algoritm crypto" / „min-length 20 la cheie" / „backoff pe decrypt-retry" → notate; crypto-ul e partajat (SmartBill source-of-truth, folosit și de Stripe/Claude) — schimbare cross-modul, în afara scopului acestui audit; validarea reală a cheii e testul de conexiune; retry-ul e unic și intenționat imediat (pattern documentat al proiectului).
