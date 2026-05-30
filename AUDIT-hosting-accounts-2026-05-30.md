# Audit & Debug — `/ots/hosting/accounts`

**Data:** 2026-05-30
**Autor:** Claude (Opus 4.8) + a doua opinie Gemini
**Skill-uri folosite:** `directadmin-api`, `ots-crm-dev`, `multi-tenant` (mental), agent `gemini` (second opinion)
**Status:** AUDIT COMPLET + **IMPLEMENTAT & verificat (svelte-check, 0 erori/0 warn noi):
C1, C2, M1, M2, M3, L1, L2, J1, J3, J4** (10 fix-uri). M2 a fost **re-implementat fără migrare**
(detecție la read-time — vezi §13). L3 + Med2 = won't-fix justificat (§13). Rămas: Med1, Med3, S1–S3.

---

## 1. Scop & metodă

Audit de cod (junk + logică + funcționalitate + securitate) pentru pagina **Conturi hosting**
și lanțul care o alimentează. Fiecare finding e **verificat pe cod real** (citire integrală +
grep determinist), nu doar pe baza Gemini — primul raport Gemini conținea halucinații (vezi §6).

### Fișiere auditate (citite integral / grep-uite cât timp tool-urile au mers)
| Fișier | Linii | Rol |
|---|---|---|
| `src/routes/[tenant]/hosting/accounts/+page.svelte` | 536 | Pagina listă (grupare după client) |
| `src/routes/[tenant]/hosting/accounts/[accountId]/+page.svelte` | ~110+ | Pagina de detaliu (suspend/unsuspend/sync/**terminate**) |
| `src/lib/remotes/hosting-accounts.remote.ts` | **1608** | Toate query/command-urile (sursa principală) |
| `src/lib/server/plugins/directadmin/client.ts` | **1184** | Wrapper-ul DirectAdmin API |
| `src/lib/components/hosting/hosting-account-edit-dialog.svelte` | 175 | Dialog editare (apelat din pagină) |

**NU există `+page.server.ts`** pentru ruta `accounts` — pagina folosește exclusiv remote functions.
**NU există `+layout.server.ts`** în arborele `/hosting` (doar `/hosting/+page.server.ts` + pagini) →
nu există guard de autorizare la nivel de rută peste sub-paginile hosting. Relevant pentru C1.

### Componente atinse (nu auditate linie-cu-linie)
`client-group-card.svelte`, `column-manager.{svelte,ts}`, `columns.default`, `hosting-format`,
`hosting-account-edit-form.svelte` (update/suspend/unsuspend), `hosting-status-badge`.

---

## 2. Rezumat sever (TL;DR)

| # | Severitate | Titlu | Fix |
|---|---|---|---|
| **C1** | 🔴 CRITIC | `getHostingAccountsGrouped` (sursa paginii) **nu are `assertCan`** | +3 linii |
| **C2** | 🔴 CRITIC | `terminateHostingAccount` (buton **LIVE** în pagina de detaliu) apelează `deleteUserAccount` — ștergere ireversibilă DA, interzisă de politică | scoate apelul DA + text UI |
| **M1** | 🟠 MAJOR | Editarea `domain` în CRM nu redenumește user-ul DA → drift CRM↔DA | read-only / workflow |
| **M2** | 🟠 MAJOR | Eșec template recurent la creare = cont nefacturat tăcut | flag + badge (migrare) |
| **M3** | 🟠 MAJOR | `limit: 500` hard-cap → KPI/MRR subevaluate tăcut peste 500 conturi | agregare SQL / cap vizibil |
| Med1 | 🟡 MEDIU | `attributeHostingInvoice` fallback poate atribui factura greșit | UI „fallback" / blank |
| Med2 | 🟡 MEDIU | TLS `rejectUnauthorized:false` (atenuat de allow-list) | cert pinning |
| L1–L3 | 🔵 LOW | scoping defensiv server, lock bulk-sync, `resolveActorName` | nice-to-have |
| J1, J3, J4 | ⚪ JUNK | query mort, import mort, `@const` nefolosit | curățenie |
| S1–S3 | ⚪ UX | pattern refresh manual, a11y search, model filtrare mixt | refactor minor |

---

## 3. CRITIC

### C1 — Lipsă RBAC pe query-ul principal al paginii 🔴
**Fișier:** `hosting-accounts.remote.ts:1258-1261`

```ts
export const getHostingAccountsGrouped = query(FiltersSchema, async (filters) => {
	const event = getRequestEvent();
	const tenantId = event.locals.tenant?.id;
	if (!tenantId) throw new Error('Tenant context required');   // ← ATÂT
	// ... fără getActor, fără assertCan, fără check pe event.locals.user
```

**Dovadă (grep pe tot fișierul):** din **12** funcții exportate, **11** apelează
`assertCan(...)` (liniile 100-101, 159-160, 194-195, 278-279, 373-374, 437-438, 489-490, 624-625,
644-645, 836-837, 998-999). **Singura excepție: `getHostingAccountsGrouped`** (1258) — exact funcția
care alimentează pagina. Ironic, varianta veche `getHostingAccounts` (azi nefolosită — J1) *are*
check-ul corect; cea care a înlocuit-o l-a pierdut.

**Impact:** Remote `query` expune un endpoint HTTP apelabil independent de UI. Orice sesiune
autentificată cu context de tenant (user fără capability `admin.hosting.view`) poate citi **toate**
datele: nume/email/CUI/telefon/LTV ale fiecărui client + toate conturile + MRR/ARR. Nu e leak
cross-tenant, dar e **bypass de privilegii intra-tenant + expunere PII/financiar**. Gating-ul din
sidebar ascunde doar pagina, nu endpoint-ul. **Nu există guard de layout** care să compenseze.

**Fix (≈3 linii, copiate din `getHostingAccounts:99-101`):**
```ts
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	const actor = await getActor(event);
	assertCan(actor, 'admin.hosting.view');
	const tenantId = event.locals.tenant.id;
```

---

### C2 — `terminateHostingAccount` (buton LIVE) apelează `deleteUserAccount` 🔴
**Fișier:** `hosting-accounts.remote.ts:434-474` → `client.ts:869`
**UI apelant:** `routes/[tenant]/hosting/accounts/[accountId]/+page.svelte:78-90` (`doTerminate()`)

> ⚠️ **CORECȚIE față de prima versiune a auditului:** NU e cod mort. E un **buton activ** în pagina
> de detaliu cont, cu `confirm('Sigur vrei să TERMINI acest cont? Va fi șters din DirectAdmin!')`.

```ts
// remote:464
() => daClient.deleteUserAccount(account.daUsername)   // action: 'delete'
```

`client.ts:854-868` are pe metodă header-ul:
> ⚠ **DESTRUCTIVE — DO NOT CALL FROM PRODUCTION CODE PATHS.** … *not as a "cancel hosting" automation.*

Încalcă direct regula strictă din memorie `feedback_never_delete_da_accounts` („deleteUserAccount is
admin-only manual operation on the DA panel. Never call from production code"). Apelul șterge
ireversibil `/home/{user}`, mail, baze MySQL, domenii, cron-uri — declanșabil din UI cu un singur
`confirm()`.

**Fix (aliniat la politica proprie):**
- `remote`: scoate apelul `daClient.deleteUserAccount(...)`. Terminarea devine CRM-only
  (`status='terminated'`) + opțional `suspendUser` (reversibil) pe DA. Lasă ștergerea reală
  manuală în panoul DA.
- `[accountId]/+page.svelte`: schimbă textul în „Marchează cont ca TERMINAT (NU se șterge automat
  din DirectAdmin — șterge manual din panou dacă e cazul)".
- `client.deleteUserAccount` rămâne pe wrapper doar pentru staging/test, fără apelant de producție.

> Aceasta e o **schimbare de comportament admin** (butonul nu mai șterge din DA). E exact ce cere
> regula strictă a proiectului, dar merită confirmată explicit cu user-ul.

---

## 4. MAJOR

### M1 — Editarea `domain` modifică doar CRM, nu redenumește user-ul DA 🟠
**Fișier:** `hosting-accounts.remote.ts:809-810, 910` (+ comentariul de la `:802` care recunoaște problema)

`updateHostingAccount` acceptă `domain` editabil și îl scrie în DB, dar **nu** apelează niciun
rename în DirectAdmin. Domeniul afișat în CRM diverge de realitatea DA; filtrarea addon-domains și
matching-ul facturilor pe domeniu (Med1) se strică.

**Fix:** `domain` read-only în `hosting-account-edit-form.svelte`, SAU workflow explicit de
„migrare/redenumire" care chiar apelează DA. Minim: avertisment vizibil în UI.

### M2 — Eșec template recurent la creare = cont nefacturat tăcut 🟠
**Fișier:** `hosting-accounts.remote.ts:259-270` (`createHostingAccount`)

Dacă `upsertRecurringInvoiceForHostingAccount` aruncă, se loghează **doar un warning**. Contul e
viu în DA dar **nu va fi facturat automat** și nimic nu semnalează asta în UI.

**Fix:** coloană nouă `billingError` (migrare — skill `database-migrations`, single statement,
verificat pe Turso) setată în catch-urile din `createHostingAccount` + `updateHostingAccount`;
adăugată în SELECT-ul lui `getHostingAccountsGrouped` + tip `AccountInGroup`; badge pe pagină/card.

### M3 — `limit: 500` hard-cap → KPI/MRR subevaluate tăcut 🟠
**Fișier:** `hosting-accounts.remote.ts:1330` + `+page.svelte:64`

Toate agregările (MRR, ARR, „Conturi", „Active", „Expiră 30z", „Restante") se calculează
**client-side** din rândurile aduse. Peste 500 conturi/tenant, query-ul taie tăcut restul → KPI
greșit în jos, fără avertisment.

**Fix:** agregările (count + sum by status + mrr) într-un query SQL separat, neplafonat; lista de
rânduri rămâne plafonată pentru afișare; sau afișează „primele 500 din N" la atingerea plafonului.

---

## 5. MEDIU / LOW

- **Med1** `attributeHostingInvoice` (`:738-790`): fallback „closest amount → oldest account" poate
  marca restanță pe contul greșit (doar afișare; auto-suspend folosește FK). Marchează vizual `fallback`.
- **Med2** TLS `rejectUnauthorized:false` (`client.ts:393, 506`): atenuat de `network-safety.ts`
  allow-list + documentat; rămâne MITM-abil pe hostname-uri publice. Îmbunătățire: cert pinning.
- **L1** `daServer` selectat după `id` fără `tenantId` (`:290-293, 385-388, 449-452, 552-556`) —
  implicit same-tenant; adaugă `eq(daServer.tenantId, tenantId)` defensiv.
- **L2** `syncOneAccount` fără `withAccountLock`; bulk-sync p-limit(5) — rânduri distincte, risc mic;
  libSQL single-writer → folosește `withTursoBusyRetry` (helper existent).
- **L3** `resolveActorName` fără `tenantId` (`:29-42`): Gemini a numit-o „IDOR critic" — **fals**,
  `userId` e mereu user-ul curent din sesiune. Pur cosmetic.

---

## 6. JUNK / DEAD CODE

| Cod | Locație | Stare |
|---|---|---|
| **J1** `getHostingAccounts` (query flat, plural) | `remote:97-154` (~58 linii) | Fără apelant în app (pagina folosește `...Grouped`). ⚠️ **Verifică testul** `__tests__/hosting-accounts-grouped.remote.test.ts` înainte de ștergere (poate îl importă). |
| **J3** import `encrypt` | `remote:9` | Apare doar pe linia de import (grep: 1 ocurență) — mort. |
| **J4** `{@const unassignedCount}` | `+page.svelte:253` | Declarat, niciodată folosit în template. |
| ~~J2 terminateHostingAccount~~ | — | ❌ **RETRAS** — nu e mort, e LIVE (vezi C2). |

---

## 7. Svelte / UX (pagina)

- **S1** Pattern refresh manual (`groups = fetchGroups()` + `refresh()`) vs standardul
  `feedback_remote_functions_pattern` (`$derived(await query)` / `query(...).refresh()`).
- **S2** Input căutare doar cu `placeholder`, fără `<label>`/`aria-label`.
- **S3** Filtrare mixtă: status/server server-side, restul client-side pe max 500 rânduri (vezi M3).
- (Notă: pagina de detaliu `[accountId]` folosește `prompt()`/`confirm()` native — funcțional, dar
  inconsistent cu dialogurile din restul appului.)

---

## 8. Cross-check Gemini (onestitate)

| Finding Gemini | Verdict după verificare |
|---|---|
| `resolveActorName` „IDOR critic" | ⬇️ **EXAGERAT** → LOW (L3) |
| `terminateHostingAccount` → `deleteUserAccount` | ✅ **CONFIRMAT + agravat** (e LIVE) → C2 |
| `updateHostingAccount` domain fără rename DA | ✅ → M1 |
| `attributeHostingInvoice` fallback | ✅ → Med1 |
| bulk-sync fără lock | ✅ parțial → L2 |
| `syncOneAccount` server fără tenantId | ✅ → L1 |
| TLS `rejectUnauthorized:false` | ✅ real, atenuat → Med2 |
| eșec billing doar warning | ✅ → M2 |
| reactivitate manuală în pagină | ✅ → S1 |
| import `encrypt` nefolosit | ✅ → J3 |
| `listAllDomains` „O(N) API storm" | ⚠️ parțial — chiar O(N), dar **mărginit** (concurrency 8 + cache 60s); afectează *provisioning*, nu pagina. Nr. linie greșit (real `client.ts:599`). |
| `searchUsers` „înșelător" | minor; metoda există (`client.ts:516`). |
| **RBAC lipsă pe `getHostingAccountsGrouped` (C1)** | ❗ **RATAT DE GEMINI** — cel mai important finding. |

> Numerotarea de linii din Gemini era constant deplasată (~220 linii). Toate findings-urile reale
> au fost remapate pe cod verificat.

---

## 9. Plan de implementare (aprobat: „tot planul C+M+junk")

**Quick wins (low risc) — fără migrare:**
1. **C1** — `getActor` + `assertCan('admin.hosting.view')` în `getHostingAccountsGrouped`.
2. **C2** — scoate `deleteUserAccount` din `terminateHostingAccount` (CRM-only + suspend DA) +
   text UI în `[accountId]/+page.svelte`.
3. **J3** — șterge import `encrypt`.
4. **J4** — șterge `{@const unassignedCount}`.
5. **M1** — `domain` read-only în `hosting-account-edit-form.svelte`.
6. **J1** — șterge `getHostingAccounts` flat (după verificarea testului).

**Necesită migrare / UI mai mult:**
7. **M2** — coloană `billingError` (migrare) + set în catch-uri + badge.
8. **M3** — agregare KPI neplafonată în SQL.

**Backlog:** Med1, Med2, L1–L3, S1–S3.

**Verificări obligatorii după implementare (din memorie):**
`svelte-autofixer` pe fiecare componentă atinsă · `build-check` (svelte-check) · pentru M2:
verifică `_journal.json` vs SQL + `PRAGMA table_info` pe Turso.

---

## 10. Ce NU a fost auditat (transparență)

- `client-group-card.svelte`, `hosting-account-edit-form.svelte` (citit parțial),
  `column-manager.*` — referențiate, nu linie-cu-linie.
- Hook-urile plugin DA (`hooks.ts`, `plugin.ts`), `factory.ts`, `audit.ts`, `network-safety.ts`.
- Comportament runtime — audit static; nicio rulare pe Turso/DA real.

---

## 11. Notă de mediu (de ce nu s-a implementat încă)

La trecerea de la audit la implementare, tool-urile de shell și de citire fișiere au devenit
instabile în această sesiune (Bash returna constant `command not found: q`; Read returna conținut
placeholder/desincronizat — ex. un `echo` întorcea payload de Read). Editarea codului în acea stare
ar fi riscat coruperea fișierelor (Edit are nevoie de potrivire exactă pe conținut citit fiabil).
**Decizie:** auditul (bazat pe citiri fiabile anterioare + grep-uri verificate) e finalizat și salvat;
implementarea fix-urilor se reia într-o sesiune cu tooling stabil, în ordinea din §9.

---

## 12. Jurnal implementare (2026-05-30)

### ✅ Wave 1 — aplicat (fix-uri fără migrare)
| Fix | Fișier | Schimbare |
|---|---|---|
| **C1** | `hosting-accounts.remote.ts` | `getHostingAccountsGrouped` are acum `if (!user||!tenant) Unauthorized` + `getActor` + `assertCan('admin.hosting.view')` |
| **C2** | `hosting-accounts.remote.ts` | `terminateHostingAccount` apelează `suspendUser` (nu `deleteUserAccount`); audit `action:'suspend'`; setează `suspendedAt`; status rămâne `terminated` |
| **C2 (UI)** | `accounts/[accountId]/+page.svelte` | text `confirm()` actualizat: „va fi SUSPENDAT (reversibil), NU șters; ștergerea = manual din panou DA" |
| **M1** | `hosting-account-edit-form.svelte` | câmp `domain` → read-only (display) + callout amber „nu se editează de aici" |
| **J1** | `hosting-accounts.remote.ts` | șters query-ul flat `getHostingAccounts` (fără apelanți; înlocuit cu comentariu-marker) |
| **J3** | `hosting-accounts.remote.ts` | șters import `encrypt` nefolosit |
| **J4** | `accounts/+page.svelte` | șters `{@const unassignedCount}` nefolosit |

**Verificare (svelte-check, heap 8GB):** `svelte-check found 16 errors and 56 warnings in 20 files`.
**Niciuna dintre cele 16 erori nu e în fișierele atinse de Wave 1** — toate sunt pre-existente, în
fișiere fără legătură (`tasks.remote.ts` null-checks, `keez/mapper.ts` + `anaf-spv/mapper.ts` type
mismatch, `whmcs-import-da.remote.ts`, teste cu `vitest`/`fetch` mock). Deci Wave 1 introduce **0
erori noi**. (Notă: `svelte-check` crapă cu OOM la heap-ul default ~4GB — rulează cu
`NODE_OPTIONS="--max-old-space-size=8192" npx svelte-check`. Asta explica „output-ul corupt" văzut
inițial — era stack trace-ul OOM, nu instabilitate de mediu.)

### ✅ M3 (KPI fără cap) — IMPLEMENTAT + verificat
Complicația descoperită: un cap-raise naiv 500→N e **periculos** — `getHostingAccountsGrouped` face
`inArray(invoice.hostingAccountId, accountIds)` + `inArray(invoice.clientId, clientIds)`, iar
**libSQL/SQLite limitează la 999 parametri per query** (plafonul de 500 ascundea asta). Fix livrat în
`hosting-accounts.remote.ts`:
- helper `runInIdChunks(ids, run)` — rulează subinterogările de facturi în **loturi ≤900**;
- `fkInvoices` + `candidateRows` rulate chunked, apoi **re-sortate global** după `issueDate desc`
  (altfel „first wins" din `applyCandidate` ar fi picat contul greșit pentru „ultima factură");
- plafonul rândurilor ridicat 500 → **5000** + `logWarning` dacă se atinge (truncare ne-tăcută);
- `+page.svelte` nu mai pasează `limit: 500`.
**Verificare:** `svelte-check` (8GB) — 16 erori (toate pre-existente, baseline), **0 în fișierele
atinse**. (Notă onestă: în timpul lucrului la M2 am corupt temporar `schema.ts` — un Edit a șters
linia `createdAt` → 35 erori; depistat imediat la verificare și reparat; revenit exact la baseline 16.)

### 🟡 M2 (coloană `billingError`) — ⚠️ SUPERSEDAT de §13 (abordare fără migrare)
> Secțiunea de mai jos descrie planul INIȚIAL cu coloană în DB. A fost **abandonat** în favoarea
> detecției la read-time din **§13** (zero migrare, zero scriere pe Turso). Păstrat doar ca istoric
> al deciziei. M2 e **REZOLVAT** — vezi §13.
**Decizie de siguranță:** am **revertit complet** orice schimbare de M2 din `main`. Motivul tehnic
decisiv: `suspendHostingAccount`, `unsuspendHostingAccount`, `terminateHostingAccount`,
`syncOneAccount`, `getHostingAccount` folosesc `db.select().from(hostingAccount)` (**select-all**).
Dacă `schema.ts` declară `billingError` dar coloana **nu există în Turso**, Drizzle emite
`SELECT …, billing_error …` → **runtime „no such column"** care ar pica suspend/unsuspend/
terminate/sync. Deci schema NU poate diverge de DB nici măcar temporar.

**Blocaj de tooling (pre-existent):** `bunx drizzle-kit generate` crapă cu coliziune de snapshot la
`0230` — `drizzle/meta/` e non-standard (**71 snapshot-uri vs 392 intrări journal**). Proiectul are
deja un workaround: `db:gen` = `drizzle-kit generate && bun scripts/fix-migrations.ts`. `db:migrate`
= `drizzle-kit migrate`.

**Pași compleți pentru M2 (de făcut atomic, într-o sesiune cu acces verificabil la Turso):**
1. În `schema.ts`, după `reactivatedAt`, adaugă: `billingError: text('billing_error'),`
2. Migrare (un singur statement): `drizzle/0395_hosting_account_billing_error.sql` →
   `ALTER TABLE hosting_account ADD COLUMN billing_error TEXT;`
3. Adaugă intrarea în `drizzle/meta/_journal.json` (idx 395, tag `0395_hosting_account_billing_error`)
   — SAU folosește `bun run db:gen` dacă `fix-migrations.ts` rezolvă coliziunea de snapshot.
4. `bun run db:migrate` → apoi `PRAGMA table_info(hosting_account)` pe Turso, confirmă `billing_error`.
5. **Abia după** ce coloana e live: wiring cod — set `billingError` în catch-urile din
   `createHostingAccount` + `updateHostingAccount` (recurring upsert), clear pe succes; adaugă
   `billingError` în SELECT-ul + tipul `AccountInGroup` din `getHostingAccountsGrouped`; banner/badge
   „N conturi cu eroare de facturare" în `+page.svelte`.

> Ordine strictă: schema+migrare+apply (pași 1–4) și wiring-ul de SELECT (pas 5) trebuie în
> **același deploy** — altfel select-all-urile de mai sus pică.

### ⚠️ Tech-debt colateral descoperit: `drizzle/meta` în drift
`drizzle/meta/` are 71 snapshot-uri pentru 392 intrări de journal → `drizzle-kit generate` e rupt
(coliziune `0230`). Echipa compensează cu `scripts/fix-migrations.ts`. De reparat separat ca să
revină `generate` curat. **Nu** l-am atins în această sesiune.

- Backlog rămas: Med1, Med2, L1–L3, S1–S3.

---

## 13. Wave 2 — implementare finală (2026-05-30, sesiune continuată)

### ✅ M2 (billing-risk) — RE-IMPLEMENTAT FĂRĂ migrare (read-time)
Abandonat planul cu coloană `billingError` (necesita scriere pe Turso + risca select-all crash).
Înlocuit cu **detecție la read-time, zero schemă**:
- `recurring_invoice` are deja FK `hostingAccountId` → în `getHostingAccountsGrouped` construiesc
  `accountsWithActiveTemplate` (Set din `recurring_invoice` cu `isActive=true`, chunked + tenant-scoped);
- `isBillingAtRisk(r)` = `status==='active' && clientId && recurringAmount>0 && cycle!=='one_time'
  && !hasActiveTemplate`;
- expus pe tip: `AccountInGroup.billingRisk` + `ClientGroup.totals.billingRiskCount`;
- UI: banner amber pe pagină (`billingRiskTotal`) + badge pe card. `AlertTriangleIcon` importat.
**Avantaj vs coloană:** mereu corect (reflectă starea reală a abonamentului), fără migrare, fără drift.

### ✅ L1 — tenant-scoping defensiv pe daServer
Toate cele **5** lookup-uri `from(daServer).where(eq(id, account.daServerId))` au acum
`and(eq(id,...), eq(daServer.tenantId, tenantId))`. (getHostingAccount, suspend, unsuspend,
terminate, syncOneAccount.)

### ✅ L2 — busy-retry pe sync
`syncOneAccount`'s `db.update(hostingAccount)` e acum în `withTursoBusyRetry(...)` (bulk-sync rulează
p-limit(5) concurent pe single-writer libSQL). Import din `$lib/server/plugins/keez/db-retry`.

### ⚪ Won't-fix (justificat)
- **L3** (`resolveActorName` fără tenantId): tabelul `user` e **global, NU are coloană tenantId** —
  deci scoping-ul cerut de Gemini e imposibil/irelevant. `userId` = user-ul curent din sesiune. Închis.
- **Med2/Med3** (TLS `rejectUnauthorized:false`): infra/cert-pinning, atenuat de `network-safety.ts`
  allow-list. Necisp schimbare de infra (CA per-server), în afara scope-ului acestui audit de pagină.

### Verificare finală
`NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --threshold error` →
**16 erori / 56 warn (baseline pre-existent), 0 în cele 5 fișiere atinse**. Plus un **review
adversarial multi-agent** pe diff (5 dimensiuni × verificare adversarială) — rezultat în §14.

### Rămas în backlog (real, după Wave 2)
- **Med3** — cert pinning DA (infra).

---

## 14. Review adversarial multi-agent (workflow) + fix-uri rezultate

Rulat workflow de review pe diff-ul complet: **5 dimensiuni** (multi-tenant security, M3 chunking,
M2 billing-risk, Svelte 5 UI, regression/dead-code) × verificare adversarială per finding.
**Rezultat: 12 findings brute → 2 confirmate** (restul = false-positive / misread, respinse de verificatori).

Ambele confirmate au fost **rezolvate**:
1. **(nit)** Warning-ul de cap folosea `rows.length >= cap` → fals-pozitiv când există exact `cap`
   rânduri (cu `LIMIT N` nu distingi „exact N" de „>N"). **Fix:** fetch `LIMIT cap+1`, warn doar la
   `> cap`, apoi `rows.length = cap` (drop probe row înainte de agregare).
2. **(minor)** `billingRisk` false-negative: un template `recurring_invoice` cu `amount=0` (stale)
   „masca" riscul (contul părea facturabil deși template-ul e no-op la renewal). **Fix:** query-ul de
   template numără doar template-uri care chiar facturează — adăugat `gt(recurringInvoice.amount, 0)`.

**Verificare finală:** `svelte-check` (8GB heap) re-rulat după fix-uri →
**16 erori / 56 warnings (baseline pre-existent), 0 în fișierele atinse**. Confirmat prin grep pe
output: liniile noi (`gt(...)`, `LIMIT cap+1`, `rows.length = cap`) sunt prezente și fără erori.

---

## 15. Backlog UI rezolvat (Med1 + S1–S3) + svelte-autofixer

La cererea „fă tot" am închis și backlog-ul de UI:
- **Med1** — era **deja implementat** în `hosting-account-row.svelte:178-182`: tooltip-ul ultimei
  facturi afișează „Asociere aproximativă (sumă + dată)" la `matchedVia==='fallback'` și „Asociat după
  domeniu" la `'domain'`. Nimic de adăugat — marcat done.
- **S1** — convertit la pattern declarativ: `groupArgs = $derived({...})` + `groups =
  $derived(getHostingAccountsGrouped(groupArgs))`; pills/select doar setează state (filtrul re-rulează
  singur), `refresh()` cheamă `.refresh()` pe aceeași instanță pentru mutații. Conform
  `feedback_remote_functions_pattern`.
- **S2** — `aria-label="Caută client, domeniu sau username DA"` pe input-ul de căutare.
- **S3** — model de filtrare **păstrat hibrid intenționat** (status/server server-side; restul
  client-side pe ≤5000 rânduri). Forțarea 100% server-side ar însemna round-trip per tastă fără
  debounce → regresie UX. M3 a eliminat deja riscul real (truncarea tăcută). Documentat ca decizie.

**svelte-autofixer** (regula `feedback_svelte_mcp_check`) — rulat pe toate componentele modificate
(`+page.svelte`, `client-group-card`, `hosting-account-edit-form`, `[accountId]/+page`): **0 issues**.
Singurele suggestions sunt pre-existente (`savePersistedColumnConfig`/`buildDraft` în `$effect`) — cod
neatins de acest audit, comportament corect. **Notă onestă:** inițial am revertit S1 pe motivul greșit
(am crezut că autofixer-ul l-a respins — de fapt trecuse curat); am corectat și re-aplicat versiunea
`$derived`, confirmată warning-free.

### Verificare integritate diff (workflow review)
Am verificat că workflow-ul de review adversarial **NU a modificat niciun fișier** — a returnat doar
findings structurate, conform design-ului. `git status` confirmă că singurele modificări sunt cele
**5 fișiere intenționate** de mai sus + acest `.md`. (Notă de proces, transparență: la un moment dat
am crezut greșit, citind un output de diff gol, că 4 fișiere ar fi primit `@ts-nocheck` de la agenți;
am verificat cu `git diff --quiet` per fișier → toate CLEAN = HEAD, niciodată atinse. Alarmă falsă,
nimic de revertit. Totuși rămâne valabilă regula generală: rulează `git status` după orice workflow.)
