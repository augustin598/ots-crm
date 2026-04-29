# Audit & Debug — Multi-Company Client Portal

**Data:** 2026-04-27
**Branch:** `feat/multi-company-client-portal`
**Auditor:** Claude (Opus 4.7)
**Scop:** Audit preventiv complet (securitate, funcțional, UX, performanță) înainte de merge în `main`.

---

## Sumar executiv

Funcționalitatea Multi-Company Client Portal permite unui contact (cu un singur email) să acceseze multiple companii dintr-un tenant via magic link, alegând la fiecare login compania activă pe pagina `/select-company`.

Codul are **fundație solidă**: token-uri SHA256-hashed, claim atomic anti-TOCTOU, snapshot al companiilor matched, re-validare la consume, cookie httpOnly/secure, anti-fixation pe sesiune. Migrațiile (0216, 0217) sunt în journal.

Totuși, auditul a identificat **1 vulnerabilitate Critical** (cross-tenant write pe upload marketing — preexistentă, dar relevantă în contextul portalului), **6 issue-uri High** (dintre care 4 introduse de feature-ul nou), și **7 issue-uri Medium** plus câteva Low.

**Recomandare:** fix Critical + High pe acest branch înainte de merge. Medium/Low documentate aici, fix într-un follow-up.

---

## Inventar findings

| ID | Severitate | Titlu | Categorie |
|----|------------|-------|-----------|
| F-001 | **CRITICAL** | Cross-tenant write în `handleMarketingUpload`/`handleArticleUpload` | Securitate |
| F-002 | **HIGH** | `clientSignup` blochează login când `client.email` e null, deși secondary match-uiește | Funcțional |
| F-003 | **HIGH** | `requestMagicLink` leak-uiește existența tenant-ului prin erori inconsistente | Securitate |
| F-004 | **HIGH** | PDF endpoints cer `isClientUserPrimary` — blochează contactele secondary legitime | Funcțional |
| F-005 | **HIGH** | Admin magic link generators fără role check + audit log incomplet | Securitate / Observabilitate |
| F-006 | **HIGH** | `handleError` log-uiește stack trace complet pe orice request `/client/*` sau POST | Securitate |
| F-007 | ~~HIGH~~ → INVALID | `clientCount` cumulative — design assumption intenționat | Funcțional |
| F-008 | MEDIUM | Hooks face 2 query-uri pe fiecare request `/client/*` fără caching | Performance |
| F-009 | MEDIUM | Index lipsă pentru `client_user.last_selected_at` — ORDER BY scanează tabela | Performance |
| F-010 | MEDIUM | Token consume nu generează admin log audit (cine s-a logat când) | Observabilitate |
| F-011 | MEDIUM | `select-company` action acceptă companii cu status `inactive`/`prospect` | Funcțional |
| F-012 | MEDIUM | `select-company` redirect la `/dashboard` dacă 0 companii (în loc de `/login`) | Funcțional |
| F-013 | MEDIUM | User display name preluat doar din PRIMUL client autorizat | UX |
| F-014 | MEDIUM | `select-company` afișează companii din login-uri anterioare cu alt email | UX / Securitate (design) |
| F-015 | LOW | console.error în loc de logger.error în remotes auth | Observabilitate |
| F-016 | LOW | Tenant slug lookup repetat în 5+ funcții (no helper) | Maintainability |
| F-017 | LOW | `matchedClientIds` ca text/JSON ad-hoc — fără validare schema | Maintainability |

---

## Detalii findings

### F-001 — CRITICAL — Cross-tenant write în upload-uri marketing

**Locații:**
- [app/src/lib/server/marketing-upload.ts:202-258](app/src/lib/server/marketing-upload.ts#L202-L258)
- [app/src/lib/server/marketing-upload.ts:366-418](app/src/lib/server/marketing-upload.ts#L366-L418)
- Routes: [app/src/routes/client/[tenant]/(app)/marketing/upload/+server.ts](app/src/routes/client/[tenant]/(app)/marketing/upload/+server.ts), [app/src/routes/client/[tenant]/(app)/marketing/upload-article/+server.ts](app/src/routes/client/[tenant]/(app)/marketing/upload-article/+server.ts)

**Descriere:**
`handleMarketingUpload` și `handleArticleUpload` verifică doar:
```ts
if (!userId || !tenantId) throw error(401);
// ...
if (isClientUser && event.locals.client) {
  if (clientId !== event.locals.client.id) throw error(403);
} else {
  // Admin path: check clientId is in tenant
  const [clientCheck] = ...where(client.id=clientId AND client.tenantId=tenantId);
  if (!clientCheck) throw error(400);
}
```

`event.locals.tenant` este populat de hooks pentru ORICE URL `/client/<slug>/...` dacă slug-ul există, indiferent dacă userul autentificat are vreo legătură cu acel tenant. Pentru un user autentificat care **nu** are clientUser pentru acest tenant, codul cade pe ramura "admin" — care **nu verifică** că userul are tenantUser în acest tenant. Consecință:

**PoC**: User A cu sesiune validă în tenant Y poate face POST către `/client/tenant-X/marketing/upload` (tenant la care nu are acces) furnizând orice `clientId` din tenant-X (de obicei trivial de obținut/ghicit). Upload-ul reușește.

**Impact:** Scriere cross-tenant pe storage MinIO + DB (`client_marketing_material`). Atacatorul poate uploada conținut arbitrar (PDF, video, imagini) în spațiul altui tenant.

**Notă:** Vulnerabilitatea este preexistentă feature-ului multi-company, dar feature-ul amplifică suprafața (mai multe rute care depind pe `event.locals.client` fără a re-valida `tenantUser`).

**Fix:**
1. În ramura `else` (non-client user), validează că userul are `tenantUser` în acest tenant cu rolul potrivit:
   ```ts
   if (!event.locals.tenantUser) {
     throw error(403, 'No access to this tenant');
   }
   ```
2. Alternativ, separă rutele admin vs. client: portfolio admin sub `[tenant]/api/marketing/upload`, portfolio client sub `client/[tenant]/marketing/upload` cu check strict `isClientUser`.

---

### F-002 — HIGH — `clientSignup` blochează secondary email când primary lipsește

**Locație:** [app/src/lib/remotes/client-auth.remote.ts:73-79](app/src/lib/remotes/client-auth.remote.ts#L73-L79)

```ts
if (!isPrimaryMatch) {
  if (!client.email) {
    return { success: true, message: '...' }; // BLOCHEAZĂ chiar dacă secondary match-uiește
  }
  // ... abia aici verifică secondary
}
```

**Repro:**
1. Admin creează un client fără email primary (scenariu posibil pentru clienți noi).
2. Admin adaugă un secondary email pentru client.
3. Contactul încearcă signup cu CUI-ul clientului + secondary email.
4. Sistem returnează "If a client account exists, a magic link has been sent" — dar **nu trimite niciun email**, contactul e blocat.

**Impact:** Funcționalitate de signup ruptă pentru clienții fără primary email. Inconsistent cu fluxul `requestMagicLink` care permite secondary fără primary.

**Fix:** Mută check-ul secondary ÎNAINTE de short-circuit pe `!client.email`:
```ts
if (!isPrimaryMatch) {
  const [secondary] = await db.select()...
  if (!secondary) {
    return { success: true, message: '...' };
  }
}
```

---

### F-003 — HIGH — `requestMagicLink` leak-uiește existența tenant-ului

**Locație:** [app/src/lib/remotes/client-auth.remote.ts:171-172, 247-256](app/src/lib/remotes/client-auth.remote.ts#L171)

```ts
if (!tenant) {
  throw new Error('Tenant not found');  // Vizibil pentru atacator
}
// ...
} catch (error) {
  console.error('Request magic link error:', error);
  const message = error instanceof Error ? error.message : 'Request failed';
  throw new Error(message);  // Forwarduiește mesajul intern
}
```

Comparativ, [`clientSignup`](app/src/lib/remotes/client-auth.remote.ts#L137-L141) returnează generic-success pentru orice eroare.

**Impact:** Atacator poate enumera tenant-urile prin endpoint-ul public `requestMagicLink`. Plus alte erori interne (DB down, etc.) se scurg către client.

**Fix:** Aliniază cu `clientSignup` — wrap totul în try/catch, returnează mesaj generic indiferent de cauză:
```ts
} catch (error) {
  logError('client-auth', 'requestMagicLink failed', { metadata: {...}, errorCode: 'AUTH_MAGIC_LINK_FAILED' });
  return { success: true, message: 'If a client account exists, a magic link has been sent to your email' };
}
```

---

### F-004 — HIGH — PDF endpoints blochează contactele secondary

**Locații:**
- [app/src/routes/client/[tenant]/(app)/invoices/[invoiceId]/pdf/+server.ts:13-15](app/src/routes/client/[tenant]/(app)/invoices/[invoiceId]/pdf/+server.ts#L13)
- [app/src/routes/client/[tenant]/(app)/contracts/[contractId]/pdf/+server.ts:13-15](app/src/routes/client/[tenant]/(app)/contracts/[contractId]/pdf/+server.ts#L13)

```ts
if (!event.locals.isClientUserPrimary) {
  throw error(403, 'Access denied');
}
```

**Repro:**
1. Admin adaugă `contact@firmă.ro` ca secondary pe client X cu `notifyInvoices=true`.
2. Contact-ul primește invoice email, primește magic link, se autentifică.
3. `event.locals.clientUser.isPrimary === false` (secondary).
4. Click pe `Download PDF` → 403.

**Impact:** Secondary email-urile primesc emailuri cu link la PDF, dar nu pot deschide PDF-ul. Funcționalitate ruptă pentru orice contact non-primary. Multi-company funcționează parțial — userul vede compania, dar toate PDF-urile sunt 403 dacă nu e primary.

**Fix:** Înlătură check-ul `isClientUserPrimary`. Authorization corectă este deja `clientId === event.locals.client.id` + `tenantId === event.locals.tenant.id`. Dacă există motiv business pentru a restricționa secondary, mută în UI (ascunde butonul) sau verifică `notifyInvoices`/`notifyContracts` flag-ul în loc de `isPrimary`.

**Notă post-implementare:** Fix-ul acoperă DOAR PDF endpoints (`invoices/[invoiceId]/pdf`, `contracts/[contractId]/pdf`). Inconsistența mai mare rămâne: `.remote.ts` files (invoices, contracts, meta/google/tiktok-ads invoices) returnează arrays goale către non-primary. Practic — secondary contact poate descărca un PDF prin URL direct (de ex. din emailul de notificare) dar nu vede listele în UI. Pentru parity completă cu ads PDFs (care deja permit secondary), follow-up necesar pe `.remote.ts` + `(app)/+layout.svelte:125,190,401` care ascunde nav-ul. Decizia design (full secondary access vs. notification-only) rămâne în follow-up.

---

### F-005 — HIGH — Admin magic link fără role check + audit incomplet

**Locații:** [app/src/lib/remotes/client-auth.remote.ts:264-486](app/src/lib/remotes/client-auth.remote.ts#L264)

Toate funcțiile `generateClientMagicLink`, `sendClientMagicLinkEmail`, `generateClientMultiCompanyMagicLink`, `sendClientMultiCompanyMagicLinkEmail` verifică doar:
```ts
if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
```

Probleme:
1. **Nu verifică rolul** — orice tenantUser (inclusiv `member`) poate genera magic link impersonând orice client.
2. **Nu verifică tenantUser** — un user autentificat fără tenantUser în acest tenant trece check-ul (vezi pattern F-001).
3. **`generateClientMagicLink` și `generateClientMultiCompanyMagicLink` nu fac `logInfo`** când doar generează URL-ul (fără email). Doar versiunile `sendXxxEmail` au audit log. Fără urmă pentru "admin a copiat link în clipboard".

**Repro impersonation (1)**: Un user `member` într-un tenant generează un magic link pentru clientul `X`, copiază URL-ul, accesează URL-ul în private browser → autentificat ca clientul X.

**Fix:**
1. Centralizează: helper `assertTenantAdmin(event)` care verifică `tenantUser?.role === 'owner' | 'admin'`.
2. Aplică pe toate cele 4 funcții + pe debug endpoint (deja are check-ul).
3. Adaugă `logInfo` pentru cele 2 generators care nu logau, cu `metadata: { adminUserId, clientId, action: 'generated_only' | 'sent_email' }`.

---

### F-006 — HIGH — `handleError` log-uiește stack complet pe console

**Locație:** [app/src/hooks.server.ts:200-214](app/src/hooks.server.ts#L200-L214)

```ts
if (event.url.pathname.includes('client') || event.request.method === 'POST') {
  console.error('[HANDLE_ERROR_DEBUG]', {
    requestId, url, method, status,
    errorMessage: error.message,
    errorStack: error.stack,
    rawError: JSON.stringify(error, Object.getOwnPropertyNames(error || {})),
    serializedMessage, serializedStack
  });
}
```

**Impact:** Stack-uri și mesaje raw sunt scrise pe stdout (capturate în logging-ul k8s/PM2). Pentru rute client + orice POST, aproape toate request-urile produc log volume excesiv în prod. Inclusiv erori de validare ale formularelor de signup vor logica detalii. Risc de leak token (dacă token apare într-un mesaj de eroare) și DoS pe disk dacă log-urile nu se rotesc.

**Fix:** Eliminat acest bloc, sau gated explicit:
```ts
if (env.PUBLIC_DEBUG_AUTH === 'true') { ... }
```

Logger-ul existent (linia 216-231) deja persistă structurat în DB cu PII redaction — nu are nevoie de duplicare console.

---

### F-007 — INVALID (re-evaluat) — `clientCount` calculat pe toate clientUser-urile

**Locație:** [app/src/lib/server/client-auth.ts:434-442](app/src/lib/server/client-auth.ts#L434-L442)

**Re-evaluare:** Am marcat inițial ca HIGH, dar la o citire mai atentă, comentariul la [linia 432](app/src/lib/server/client-auth.ts#L432) explicit declară: *"We re-query rather than use authorized.length so existing links (from previous logins on different emails) are counted too."*

Comportamentul e consistent cu `/select-company` care afișează **toate** companiile (vezi [+layout.server.ts:119-137](app/src/routes/client/[tenant]/+layout.server.ts#L119)). Routing pe `clientCount > 1 → /select-company` aliniază cu UI-ul.

**Concluzie:** Nu e bug. Design assumption documentat în comentariu și consistent cu F-014.

**Niciun fix.**

---

### F-008 — MEDIUM — Hooks face 2 query-uri DB pe fiecare request `/client/*`

**Locație:** [app/src/hooks.server.ts:90-119](app/src/hooks.server.ts#L90-L119)

Fiecare cerere către `/client/[tenant]/...` rulează:
1. `SELECT * FROM tenant WHERE slug = ? LIMIT 1`
2. `SELECT * FROM client_user JOIN client ... WHERE userId AND tenantId ORDER BY lastSelectedAt LIMIT 1`

Pentru o pagină cu 5 sub-fetch-uri (CSS, JS, images, plus poll-uri), această amplificare devine vizibilă. Plus că orderBy pe `lastSelectedAt` (fără index — vezi F-009) face full-scan pe `client_user`.

**Fix:** Cache scurt (15-30s) pe (sessionId → tenantId/clientUserId) într-un Map sau Redis. Invalidate la signout / company switch. Sau cel puțin index pe (`userId`, `tenantId`, `lastSelectedAt`) — vezi F-009.

---

### F-009 — MEDIUM — Index lipsă pentru `client_user.last_selected_at`

**Migrație:** [app/drizzle/0216_client_user_last_selected_at.sql](app/drizzle/0216_client_user_last_selected_at.sql)

```sql
ALTER TABLE `client_user` ADD COLUMN `last_selected_at` integer;
```

Niciun index nu acoperă (`user_id`, `tenant_id`, `last_selected_at`). Query-ul din hooks face full table scan filtrat apoi sortat.

**Fix:** Migrație nouă (0219) cu:
```sql
CREATE INDEX IF NOT EXISTS `client_user_user_tenant_selected_idx`
  ON `client_user` (`user_id`, `tenant_id`, `last_selected_at`);
```

---

### F-010 — MEDIUM — Lipsă admin log la consume token

**Locație:** [app/src/lib/server/client-auth.ts:54-199](app/src/lib/server/client-auth.ts)

Nu există `logInfo` la consume-ul cu succes al unui magic link (cine s-a autentificat, când, pentru ce client/companie). Există doar logging la generare/email (linii 343, 563 în `client-auth.remote.ts`).

**Impact:** Nu există urmă "x@y.ro s-a autentificat la 14:32, a accesat compania ABC SRL". Pentru audit/compliance e necesar.

**Fix:** După `findOrCreateClientUserSession`, adaugă:
```ts
logInfo('client-auth', 'Magic link consumed', {
  tenantId: tenant.id,
  metadata: {
    userId: result.userId,
    activeClientId: result.activeClientId,
    clientCount: result.clientCount,
    email: tokenRecord.email,
    tokenId: tokenRecord.id
  }
});
```

---

### F-011 — MEDIUM — `select-company` permite selectarea companiilor inactive

**Locație:** [app/src/routes/client/[tenant]/select-company/+page.server.ts:60-69](app/src/routes/client/[tenant]/select-company/+page.server.ts#L60)

Update-ul `lastSelectedAt` nu verifică `client.status`. Un user poate selecta o companie cu status `inactive` sau `prospect`. Layout-ul afterwards încarcă datele companiei și nu redirectă.

**Fix:** Adaugă filter pe status în action sau în UI:
```ts
.where(and(..., eq(table.client.status, 'active')))
```

Sau afișează companiile inactive cu badge dezactivat și nu permite click (UI-only, dar acceptabil).

---

### F-012 — MEDIUM — Redirect la `/dashboard` dacă 0 companii

**Locație:** [app/src/routes/client/[tenant]/select-company/+page.server.ts:38-40](app/src/routes/client/[tenant]/select-company/+page.server.ts#L38)

```ts
if (companies.length <= 1) {
  throw redirect(302, `/client/${tenantSlug}/dashboard`);
}
```

Dacă userul are 0 companies (toate clientUser șterse), ajunge pe /dashboard care va eșua sau buclă.

**Fix:**
```ts
if (companies.length === 0) {
  throw redirect(302, `/client/${tenantSlug}/login?error=no-access`);
}
if (companies.length === 1) {
  // ensure lastSelectedAt e setat
  throw redirect(302, `/client/${tenantSlug}/dashboard`);
}
```

---

### F-013 — MEDIUM — User display name din primul client autorizat

**Locație:** [app/src/lib/server/client-auth.ts:303-321](app/src/lib/server/client-auth.ts#L303)

`firstClient = authorized[0].client; firstIsPrimary = authorized[0].isPrimary;` — apoi `resolveContactName` se aplică doar pe firstClient. Dacă userul are 2 companii, doar contactul de la prima companie e preluat. Dacă firstClient nu are legalRepresentative dar al doilea da, displayName rămâne emailPrefix.

**Fix:** Iterare prin `authorized` și ia primul nume disponibil. Sau preferă întotdeauna secondary email label dacă e definit (e mai personalizat decât legalRepresentative).

---

### F-014 — MEDIUM — `select-company` listează companii din login-uri anterioare

**Locație:** [app/src/routes/client/[tenant]/select-company/+page.server.ts:13-35](app/src/routes/client/[tenant]/select-company/+page.server.ts#L13)

Query-ul listează **toate** rândurile `clientUser` pentru `(userId, tenantId)`. Dacă userul a fost anterior autentificat cu email1 → A,B și acum loghează cu email2 → C,D, pagina arată A,B,C,D.

**Tradeoff:** Dacă admin revocă email1 din clientul A, dar userul are deja `clientUser` row → continuă să vadă A.

**Decision needed:** Confirm dacă acesta e comportamentul dorit. Alternativă mai sigură: filtrează `select-company` doar pe companiile autorizate de tokenul folosit la login (necesită stocare a `matchedClientIds` în sesiune).

**Recomandare:** Acceptabil cu condiția să existe un mecanism admin pentru a "revoca acces" (ștergere `clientUser` row). Documentează în comportamentul așteptat.

---

### F-015 — LOW — `console.error` în loc de `logger.error`

**Locații:** [app/src/lib/remotes/client-auth.remote.ts:132, 138, 247, 253, 593](app/src/lib/remotes/client-auth.remote.ts#L132)

```ts
console.error('Failed to send magic link email:', emailError);
```

Conform skill `error-handling`, ar trebui `logError('client-auth', '...', { errorCode: 'EMAIL_*', metadata: {...} })`.

**Fix:** Înlocuiește toate `console.error` cu `logError`/`logWarn`.

---

### F-016 — LOW — Tenant slug lookup repetat

Pattern repetat în 5+ funcții (`verifyMagicLinkToken`, `findOrCreateClientSession`, `clientSignup`, `requestMagicLink`, `sendMagicLinkEmail`):
```ts
const [tenant] = await db.select().from(table.tenant).where(eq(table.tenant.slug, tenantSlug)).limit(1);
```

**Fix:** Helper `getTenantBySlug(slug)` în `$lib/server/tenant`.

---

### F-017 — LOW — `matchedClientIds` ca text/JSON

**Schema:** `magicLinkToken.matchedClientIds: text` — JSON serializat manual cu `try/catch` la parse.

**Fix:** Migrate către coloană proper (Drizzle suportă `jsonb` pe Postgres). Pe SQLite/libSQL rămâne `text`, dar adaugă validare cu `valibot` la parse.

---

## Plan de remediere

### Pe acest branch (Critical + High, în ordine de implementare)

1. **F-001** — Adaugă `tenantUser` check în ambele upload handlers (10 min).
2. **F-006** — Șterge bloc debug `console.error` din `handleError` (2 min).
3. **F-002** — Mută check secondary înainte de short-circuit `!client.email` (5 min).
4. **F-004** — Înlătură `isClientUserPrimary` check de pe PDF endpoints (5 min × 6 endpoints = 30 min).
5. **F-005** — Helper `assertTenantAdmin` + audit log la `generateXxx` functions (20 min).
6. **F-003** — Aliniază `requestMagicLink` cu `clientSignup` (try/catch + generic) (10 min).
7. ~~F-007~~ — invalidat la re-review.

### Follow-up branch (Medium + Low)

- F-008, F-009 — Index + caching scurt în hooks.
- F-010 — Audit log la consume.
- F-011, F-012 — UI/server filter pe status active.
- F-013 — Display name preferable.
- F-014 — Documentație design decision.
- F-015–F-017 — Cleanup.

---

## Out of scope

- Refactor major al flow-ului (ex. encoding tenant în session).
- Adăugare Playwright tests — efort separat.
- Deploy în prod — doar după go-ahead user, conform `feedback_deploy_workflow`.

---

## Verificare end-to-end după fixes

```bash
cd /Users/augustin598/Projects/CRM/app
/Users/augustin598/.bun/bin/bun run check    # baseline TS/Svelte

# Smoke test fixture multi-company (ots tenant)
curl -X POST 'http://localhost:5173/ots/api/_debug-multi-company-login?action=cleanup' -b cookie.txt
curl -X POST 'http://localhost:5173/ots/api/_debug-multi-company-login?action=setup'   -b cookie.txt
curl -X POST 'http://localhost:5173/ots/api/_debug-multi-company-login?action=request' -b cookie.txt
# capture plainToken from response, then:
curl -X POST "http://localhost:5173/ots/api/_debug-multi-company-login?action=verify&token=$TOK" -b cookie.txt
```

Pentru F-001 (cross-tenant write), test manual:
- Login ca admin în tenant Y.
- POST către `/client/<tenant-X>/marketing/upload` cu form-data având clientId din tenant X.
- Confirmă 403 după fix (vs. 200 înainte).
