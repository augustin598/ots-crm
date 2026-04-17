# Audit Complet: Flow Trimitere Email -- Client/Admin Login & Task

## Context
Audit avansat al flow-ului de trimitere email pentru login client (magic link), login admin (magic link), password reset si notificari task. Scopul: identificarea problemelor de logica, securitate, error handling si reliability din codul actual.

**Surse audit:** Claude (explorare directa cod), Gemini (second opinion independent), skill-uri: email-delivery, error-handling, multi-tenant, ots-crm-dev.

**Toate cele 15 probleme inițiale confirmate de Gemini ca reale (0 false positives). Gemini a descoperit 8 probleme noi suplimentare.**

---

## RAPORT DE AUDIT -- 40 Probleme Identificate (32 originale + 8 noi de la Gemini)

---

### CRITICAL SECURITY (9 probleme)

#### S1. Token-uri plaintext stocate în `email_log.payload` (CRITIC)
- **Fișier:** `src/lib/server/email.ts:899-902` și `:990-994`
- **Problema:** `sendMagicLinkEmail` și `sendAdminMagicLinkEmail` stochează token-ul plaintext în câmpul `payload` al `email_log` ca `args: [email, token, tenantSlug, clientName]`. Acest payload persistă până la 30 zile (garbage collection).
- **Impact:** Oricine cu acces DB (SQL injection, backup leak, admin logs UI) poate extrage token-uri valide și se poate autentifica ca orice client/admin.
- **Fix:** Setează `payload: null` pentru `sendMagicLinkEmail`, `sendAdminMagicLinkEmail` și `sendPasswordResetEmail`. Token-urile sunt single-use, deci retry-ul oricum ar trimite un link mort.

#### S2. Token password reset stocat identic în payload (CRITIC)
- **Fișier:** `src/lib/server/email.ts` — `sendPasswordResetEmail`
- **Problema:** Aceeași problemă ca S1 dar pentru password reset tokens.
- **Impact:** Account takeover pentru admini.
- **Fix:** `payload: null` pentru `sendPasswordResetEmail`.

#### S3. Fără rate limiting pe requestMagicLink / requestPasswordReset
- **Fișier:** `src/lib/remotes/client-auth.remote.ts:124-223`, `src/lib/remotes/auth.remote.ts:230-290, 317-372`
- **Problema:** Niciun rate limit per IP sau per email. Un atacator poate:
  - Flood inbox-ul cu emailuri magic link
  - Epuiza cota SMTP
  - Umple tabelele `magicLinkToken` / `email_log`
- **Impact:** Email bombing, resource exhaustion, reputație SMTP degradată.
- **Fix:** Adaugă rate limiting: max 5 requests/email/oră, max 20 requests/IP/oră.

#### S4. Token-uri vechi nu sunt invalidate la request nou
- **Fișier:** `src/lib/remotes/client-auth.remote.ts:180-196`
- **Problema:** Când un client cere un magic link nou, token-urile vechi rămân valide 24h. Multiple token-uri concurente există simultan.
- **Impact:** Fereastră de atac mărită — token-uri interceptate rămân utilizabile.
- **Fix:** Înainte de insert nou, marchează `used: true` toate token-urile neutilizate pentru aceeași combinație `(email, tenantId)`.

#### S5. clientSignup permite setarea email-ului arbitrar ca primar
- **Fișier:** `src/lib/remotes/client-auth.remote.ts:77-82`
- **Problema:** Dacă un client nu are email configurat (`!client.email`), endpoint-ul permite oricui cu CUI valid să seteze orice email ca primar, apoi să primească magic link-uri.
- **Impact:** Account takeover pentru clienți fără email pre-configurat.
- **Fix:** Elimină auto-set behavior sau necesită confirmare admin. Minimum: verifică că emailul nu aparține deja altui client din tenant.

#### S6. clientSignup expune erori diferențiate (email enumeration)
- **Fișier:** `src/lib/remotes/client-auth.remote.ts:54-75`
- **Problema:** Returnează mesaje de eroare specifice: "Client not found with this CUI" vs "Email does not match". Un atacator poate enumera perechile CUI+email valide.
- **Impact:** Information disclosure, bază pentru atacuri targetate.
- **Fix:** Returnează mesaj generic de succes indiferent de rezultat (ca `requestMagicLink` care face corect).

#### S7. Parolă dummy statică pentru client users
- **Fișier:** `src/lib/server/client-auth.ts:252-257`
- **Problema:** Toți client users creați via magic link primesc `hash('dummy-password-for-client-users')`. Dacă login-ul admin acceptă emailuri de client, oricine se poate autentifica cu această parolă.
- **Impact:** Bypass autentificare pentru client users dacă login-ul admin nu diferențiază.
- **Fix:** Generează parolă random unică per user, sau setează un flag `passwordLoginDisabled: true` pe user record.

#### S8. TLS certificate verification dezactivat
- **Fișier:** `src/lib/server/email.ts:185, 265`
- **Problema:** `tls: { rejectUnauthorized: false }` pe ambele transporters (default și tenant). Permite MITM pe conexiuni SMTP.
- **Impact:** Interceptarea credențialelor SMTP și conținutului emailurilor (inclusiv token-uri magic link).
- **Fix:** `rejectUnauthorized: true` în producție, configurabil per tenant pentru self-signed certs.

#### S9. HTML injection în template-uri email (XSS/Phishing)
- **Fișier:** `src/lib/server/email.ts` — toate funcțiile send*
- **Problema:** Valori user-supplied (`tenantName`, `clientName`, `userName`, `inviterName`) interpolate direct în HTML fără escaping: `<h1>Welcome to ${tenantName}</h1>`
- **Impact:** Un admin poate seta un tenant name malițios care injectează HTML (link-uri de phishing, CSS data exfiltration).
- **Fix:** Creează `escapeHtml()` utility și aplică pe toate valorile interpolate.

---

### LOGIC BUGS (5 probleme)

#### L1. Race condition TOCTOU pe verificare magic link token
- **Fișier:** `src/lib/server/client-auth.ts:74-104`
- **Problema:** SELECT + UPDATE nu sunt atomice. Două request-uri simultane pot citi `used: false`, ambele marchează `used: true`, ambele creează sesiuni.
- **Impact:** Token magic link folosit de 2 ori.
- **Fix:** `UPDATE ... WHERE id = ? AND used = false RETURNING *` — atomic check-and-set.

#### L2. Email retry trimite token-uri expirate
- **Fișier:** `src/lib/server/scheduler/tasks/email-retry.ts:152-154`
- **Problema:** Retry window = 72h, token expiry = 24h. Un magic link email retried după 25h+ conține un token expirat.
- **Impact:** Utilizatorii primesc email cu link mort.
- **Fix:** Nu face retry pe magic link emails (payload: null rezolvă și asta).

#### L3. Email retry creează rânduri duplicate (retry storm)
- **Fișier:** `src/lib/server/scheduler/tasks/email-retry.ts:153-156`
- **Problema:** Retry-ul apelează `handler(...args)` → `sendWithPersistence` creează un rând NOU. Dacă trimite OK, vechiul se șterge. Dar dacă eșuează, acum sunt 2 rânduri `failed` — ambele eligibile pentru retry la ciclul următor.
- **Impact:** Multiplicare exponențială a tentativelor de retry.
- **Fix:** Pasează `logId` existent pentru update în loc de insert nou, sau adaugă câmp `retryOfId` foreign key.

#### L4. generateClientMagicLink nu normalizează email-ul
- **Fișier:** `src/lib/remotes/client-auth.remote.ts:254-258`
- **Problema:** Stochează `client.email` fără `.toLowerCase()`, spre deosebire de `requestMagicLink` care normalizează.
- **Impact:** Inconsistență date. Edge case failures dacă matching-ul devine case-sensitive.
- **Fix:** `email: client.email.toLowerCase()`.

#### L5. Debug logs cu PII lăsate în producție
- **Fișier:** `src/lib/remotes/client-auth.remote.ts:131-218`
- **Problema:** ~15 linii `console.log('[MAGIC_LINK_DEBUG]')` cu email, tenantId, clientId, timing info.
- **Impact:** PII în server logs, timing info ajută enumerarea.
- **Fix:** Șterge sau pune sub `if (dev)` guard.

---

### ERROR HANDLING GAPS (4 probleme)

#### E1. logEmailAttempt returnează ID chiar dacă DB insert eșuează
- **Fișier:** `src/lib/server/email-logger.ts:26-55`
- **Problema:** Dacă `db.insert` eșuează (linia 52-54), eroarea e caught cu `console.error`, dar funcția returnează `id` generat. Toate update-urile ulterioare (`logEmailProcessing`, `logEmailSuccess`, `logEmailFailure`) eșuează silențios pe un ID fantomă.
- **Impact:** Emailuri trimise fără audit trail. Emailuri eșuate invizibile — fără retry, fără notificare.
- **Fix:** Re-throw error sau returnează null. `sendWithPersistence` decide dacă continuă fără logging.

#### E2. Notificarea admin-ilor pe failure silently swallowed
- **Fișier:** `src/lib/server/email.ts:562-586`
- **Problema:** `.catch(() => {})` (linia 582) și `catch {}` (linia 584) înghit erorile complet.
- **Impact:** Dacă email eșuează ȘI notificarea eșuează, nimeni nu știe.
- **Fix:** Minimum `logWarning()` pe failure notificare.

#### E3. sendClientNotificationIfEnabled înghite toate erorile
- **Fișier:** `src/lib/remotes/tasks.remote.ts:71-73`
- **Problema:** Individual recipient failures caught cu `console.error` doar. Dacă toți recipients fail, funcția returnează void fără semnal de eroare.
- **Impact:** Client nu primește notificări task, admin nu are vizibilitate.
- **Fix:** Colectează erorile, log structurat, returnează summary.

#### E4. logEmailProcessing/logEmailRetry/logEmailSuccess/logEmailFailure — toate silently catch
- **Fișier:** `src/lib/server/email-logger.ts:58-122`
- **Problema:** Toate funcțiile de logging au `catch(err) { console.error(...) }`. Dacă DB-ul e down, nicio funcție din email flow nu primește semnal.
- **Impact:** Email-uri procesate fără tracking. Stare inconsistentă.
- **Fix:** Cel puțin `logEmailFailure` ar trebui să re-throw (altfel emailul apare ca "pending" pe vecie).

---

### PERFORMANCE (4 probleme)

#### P1. Cache transporter fără limită (memory leak)
- **Fișier:** `src/lib/server/email.ts:144`
- **Problema:** `tenantTransporters` Map crește fără limită. Fiecare tenant cu email trimis → transporter cached cu conexiune SMTP deschisă, niciodată evicted.
- **Impact:** Memory leak, exhaustion conexiuni SMTP, eventual OOM.
- **Fix:** LRU cache cu TTL (30 min idle), `.close()` pe eviction.

#### P2. Blocking retry delay în request handler
- **Fișier:** `src/lib/server/email.ts:418-419`
- **Problema:** `sendMailWithRetry` face `await setTimeout(delay)` în request path. 3 tentative = 4+ secunde blocking.
- **Impact:** Magic link request lent dacă SMTP e slow/down.
- **Fix:** Fire-and-forget după DB row creat. Outbox pattern-ul deja asigură delivery.

#### P3. Task reminders procesate secvențial
- **Fișier:** `src/lib/server/scheduler/tasks/task-reminders.ts`
- **Problema:** `await sendTaskReminderEmail(...)` în loop secvențial.
- **Impact:** Job timeout cu mulți tenants.
- **Fix:** `Promise.allSettled` cu concurrency limit (5-10).

#### P4. Notificări client trimise secvențial per recipient
- **Fișier:** `src/lib/remotes/tasks.remote.ts:60-74`
- **Problema:** `await` în for loop per recipient.
- **Impact:** Task CRUD lent proporțional cu nr. recipienți.
- **Fix:** `Promise.allSettled` parallel sau queue async.

---

### RELIABILITY (3 probleme)

#### R1. Crash recovery resetează rows din alte instanțe
- **Fișier:** `src/lib/server/scheduler/tasks/email-retry.ts:44-62`
- **Problema:** La startup, TOATE rows cu `status = 'retrying'` sunt resetate. În multi-instance deployment, o instanță care repornește resetează retry-urile altei instanțe.
- **Impact:** Double-sends.
- **Fix:** Adaugă `instanceId` / `lockedBy` column, resetează doar rows proprii.

#### R2. Nicio curățare de token-uri expirate
- **Fișier:** `src/lib/server/db/schema.ts:1290-1316`
- **Problema:** Token-urile magic link, admin magic link și password reset nu sunt niciodată șterse. Acumulare indefinită.
- **Impact:** Creștere tabel, degradare query.
- **Fix:** Scheduled task: șterge token-uri > 7 zile.

#### R3. Admin email-ul nu e normalizat la inserare token
- **Fișier:** `src/lib/remotes/auth.remote.ts:258`
- **Problema:** `email` stocat în `adminMagicLinkToken` fără `.toLowerCase()`.
- **Impact:** Dacă verificarea e case-sensitive, token-ul nu se validează.
- **Fix:** Normalizează: `email: email.toLowerCase()`.

---

### MULTI-TENANT ISOLATION (3 probleme)

#### T1. sendClientNotificationIfEnabled — query task fără tenant scoping
- **Fișier:** `src/lib/remotes/tasks.remote.ts:42-46`
- **Problema:** `where(eq(table.task.id, taskId))` fără `eq(table.task.tenantId, tenantId)`.
- **Impact:** Risc teoretic de cross-tenant data access (mitigat parțial de caller validation).
- **Fix:** Adaugă `and(eq(table.task.id, taskId), eq(table.task.tenantId, tenantId))`.

#### T2. Admin magic link fără tenant context
- **Fișier:** `src/lib/server/db/schema.ts:1306-1316`
- **Problema:** `adminMagicLinkToken` nu are `tenantId` — by design, dar un admin multi-tenant primește sesiune fără tenant context.
- **Impact:** Low risk, dar de verificat că tenant selection e corectă post-login.

#### T3. Email retry nu filtrează pe tenant la nivel de notificare
- **Fișier:** `src/lib/server/scheduler/tasks/email-retry.ts:73-92`
- **Problema:** Query global pe `email_log`. Funcțiile send sunt tenant-scoped, dar UI admin trebuie să filtreze corect.
- **Impact:** Risc de vizibilitate cross-tenant în admin email logs UI.

---

### EMAIL DELIVERABILITY (4 probleme)

#### D1. Fallback `noreply@example.com`
- **Fișier:** `src/lib/server/email.ts:916, 997` și alte locuri
- **Problema:** Multiple funcții au fallback `'noreply@example.com'` când nu e configurat SMTP_FROM.
- **Impact:** Emailuri respinse/spam 100%.
- **Fix:** Fail loud la startup dacă SMTP_FROM lipsește. Sau log warning la fiecare utilizare fallback.

#### D2. Subject hardcodat în engleză
- **Fișier:** `src/lib/server/email.ts:895, 987, 1068`
- **Problema:** "Login to ${tenantName} Client Portal", "Login to CRM Admin" — nu e localizat.
- **Impact:** UX inconsistent pentru utilizatori români.
- **Fix:** Localizare sau template configurabil per tenant.

#### D3. HTML charset nu e explicit setat în Content-Type header
- **Impact:** Minor. Diacritice românești pot fi afișate incorect.

#### D4. Plain text fallback cu indentare incorectă
- **Fișier:** `src/lib/server/email.ts:951-965`
- **Problema:** Template literals au whitespace extra din indentarea codului.
- **Impact:** Plain text emails au spații/tab-uri nedorite.
- **Fix:** `.trim()` sau `.replace(/^\t+/gm, '')`.

---

### PROBLEME NOI DESCOPERITE DE GEMINI (8 probleme)

#### G1. Race condition la crearea user-ului pe verificare concurenta magic link (CRITIC)
- **Fisier:** `src/lib/server/client-auth.ts:236-265`
- **Problema:** SELECT user + INSERT user nu sunt in tranzactie. Daca utilizatorul da click pe magic link pe telefon SI desktop simultan: ambele citesc user=null, ambele incearca INSERT, al doilea esueaza cu duplicate key.
- **Impact:** Utilizatorii legitimi primesc "Failed to create user" la login multi-device.
- **Fix:** `INSERT...ON CONFLICT(email) DO UPDATE SET updated_at=...` sau wrap in tranzactie.

#### G2. Token plaintext expus in htmlBody preview (HIGH)
- **Fisier:** `src/lib/server/email.ts:535-544`
- **Problema:** `htmlBody` stocat in `email_log` contine `<a href="...verify?token=PLAINTEXT_TOKEN">`. Vizibil oricui admin in email preview UI.
- **Impact:** Dubla expunere token-uri (payload + htmlBody). Orice admin poate extrage token-uri.
- **Fix:** Nu stoca htmlBody pentru emailuri cu token-uri sensibile, sau redacteaza URL-ul in htmlBody.

#### G3. CUI enumeration via brute-force (MEDIUM-HIGH)
- **Fisier:** `src/lib/remotes/client-auth.remote.ts:48-55`
- **Problema:** Combinat cu lipsa rate limiting (S3), un atacator poate brute-force CUI-uri valide pe baza mesajelor de eroare diferentiate.
- **Impact:** Enumerarea tuturor clientilor din tenant.
- **Fix:** Rate limiting per IP (nu doar per email) + mesaj generic.

#### G4. Email partajat intre clienti sparge logica login (MEDIUM)
- **Fisier:** `src/lib/remotes/client-auth.remote.ts:147-172`
- **Problema:** Daca doua client-uri au aceeasi adresa email (primar sau secundar), `requestMagicLink` gaseste prima potrivire. Utilizatorul se logheaza pe clientul gresit.
- **Impact:** Login pe contul gresit, confuzie date.
- **Fix:** UNIQUE constraint pe `(tenantId, email)` sau gestionare explicita a conflictelor.

#### G5. Lipsa tranzactionalitate pe clientSignup (email update + token create) (MEDIUM)
- **Fisier:** `src/lib/remotes/client-auth.remote.ts:78-102`
- **Problema:** Update email client + insert magic link token nu sunt in tranzactie. Crash intre ele = client cu email setat dar fara token.
- **Impact:** Utilizatorul blocat -- urmatorul signup zice "Email does not match".
- **Fix:** Wrap in tranzactie `db.transaction()`.

#### G6. Sesiuni vechi nu sunt invalidate la login cu magic link (MEDIUM)
- **Fisier:** `src/lib/server/client-auth.ts:100-104`
- **Problema:** La verificare token, se creeaza sesiune noua dar sesiunile vechi raman active.
- **Impact:** Daca un atacator a interceptat un token vechi (inca in fereastra 24h), poate crea sesiune paralela.
- **Fix:** Invalideaza toate sesiunile existente ale user-ului la login cu magic link.

#### G7. Gmail refresh tokens -- verificare encryptare (POTENTIAL CRITICAL)
- **Fisier:** `src/lib/server/gmail/` -- de verificat
- **Problema:** Gmail OAuth refresh tokens trebuie sa fie encrypted in DB. Daca sunt plaintext, acces DB = compromitere Gmail.
- **Impact:** Acces complet Gmail al tenantului.
- **Fix:** De verificat si confirmat ca refreshToken e encrypted cu crypto module.

#### G8. Admin poate supraincarca retry queue (MEDIUM)
- **Fisier:** `src/lib/server/scheduler/tasks/email-retry.ts`
- **Problema:** Admin poate genera mii de emailuri esuate. Chiar cu PER_TENANT_RETRY_LIMIT=10, acumularea e nelimitata.
- **Impact:** Retry scheduler devine bottleneck, afecteaza toti tenantii.
- **Fix:** Cap total pe emailuri failed per tenant (ex: max 100 pending retries).

---

### PROBLEME IDENTIFICATE DIN SKILL-URI

#### SK1. (email-delivery) Lipsa bounce/complaint suppression
- **Problema:** Nu exista tabela de suppression. Emailuri trimise repetat la adrese bounced/invalid.
- **Impact:** Reputatie SMTP degradata, blacklist.
- **Fix:** Adauga tabela `email_suppression` + check before send.

#### SK2. (email-delivery) Lipsa RFC 8058 Unsubscribe headers
- **Problema:** Emailuri de notificare (task updates, reminders) nu au header `List-Unsubscribe`.
- **Impact:** Cerinta Gmail/Yahoo din Feb 2024. Emailuri filtrate/blocked.
- **Fix:** Adauga headers pe emailuri non-tranzactionale.

#### SK3. (email-delivery) Retry regenereaza content in loc de replay versioned
- **Problema:** Retry-ul apeleaza din nou functia send care re-fetch-uieste date din DB. Datele pot fi diferite de la trimiterea originala.
- **Impact:** Email retried poate avea continut diferit de original.
- **Fix:** Stocheaza htmlBody complet la prima tentativa, refoloseste la retry.

#### SK4. (multi-tenant) Lipsa audit trail pe operatii sensibile email
- **Problema:** Schimbarile SMTP settings, trimiterea manuala de magic links nu au audit log.
- **Impact:** Nu se poate investiga cine a schimbat ce si cand.
- **Fix:** Log operatii sensibile in admin logs.

#### SK5. (error-handling) Console.error in loc de logger structurat
- **Problema:** email-logger.ts si email.ts folosesc `console.error` in loc de logger-ul structurat.
- **Impact:** Erorile nu ajung in admin logs UI, greu de monitorizat.
- **Fix:** Inlocuieste `console.error` cu `logError()` din logger.ts.

---

## SUMAR SEVERITATE ACTUALIZAT

| Categorie | Count | Cele mai critice |
|-----------|-------|------------------|
| CRITICAL SECURITY | 9 | S1 (tokens plaintext), S3 (no rate limit), S5 (arbitrary email) |
| LOGIC BUGS | 5 | L1 (race condition token), L3 (retry storm) |
| ERROR HANDLING | 4 | E1 (phantom log ID), E2 (silent notification fail) |
| PERFORMANCE | 4 | P1 (memory leak transporter cache) |
| RELIABILITY | 3 | R1 (crash recovery multi-instance) |
| MULTI-TENANT | 3 | T1 (missing tenant scoping) |
| DELIVERABILITY | 4 | D1 (noreply@example.com fallback) |
| GEMINI (noi) | 8 | G1 (user creation race), G2 (htmlBody token leak), G6 (session fixation) |
| SKILL-URI (noi) | 5 | SK1 (bounce suppression), SK2 (RFC 8058) |
| **TOTAL** | **45** | |

---

## PLAN DE IMPLEMENTARE FIX-URI (prioritizat, validat cu Gemini + skill-uri)

### Faza 1 -- Critical Security + Gemini Critical (prioritate maxima)
1. **S1+S2+G2:** Seteaza `payload: null` pentru `sendMagicLinkEmail`, `sendAdminMagicLinkEmail`, `sendPasswordResetEmail`. Redacteaza token din htmlBody.
2. **G1:** Fix race condition user creation: `INSERT...ON CONFLICT(email) DO UPDATE` in client-auth.ts
3. **S9:** Creeaza `escapeHtml()` utility, aplica pe toate template-urile email
4. **S5+G4:** Elimina auto-set email pe clientSignup + UNIQUE constraint (tenantId, email)
5. **S6+G3:** Returneaza mesaj generic in clientSignup (previne CUI + email enumeration)
6. **S7:** Genereaza parola random per client user (nu dummy static)
7. **S4+G6:** Invalideaza token-uri vechi la request nou + invalideaza sesiuni vechi la login
8. **S3:** Adauga rate limiting: max 5 req/email/ora, max 20 req/IP/ora
9. **S8:** Configurabil TLS per environment
10. **G7:** Verifica si confirma ca Gmail refresh tokens sunt encrypted

### Faza 2 -- Logic Bugs + Tranzactionalitate
11. **L1:** Atomic UPDATE...WHERE used=false RETURNING * pentru token verification
12. **L3:** Refactor retry sa update row existent, nu sa creeze nou
13. **G5:** Wrap clientSignup (email update + token create) in tranzactie
14. **L5:** Sterge debug logs cu PII
15. **L4+R3:** Normalizeaza email in generateClientMagicLink si admin token insert
16. **L2:** Rezolvat implicit de S1 (payload: null)

### Faza 3 -- Error Handling (aliniat cu skill error-handling)
17. **E1:** Re-throw error din logEmailAttempt sau returneaza null
18. **E2:** Adauga logWarning pe notification failure (nu .catch(() => {}))
19. **E3:** Colecteaza si logheaza erorile din sendClientNotificationIfEnabled
20. **E4:** logEmailFailure re-throws (critical path)
21. **SK5:** Inlocuieste console.error cu logError() structurat

### Faza 4 -- Performance & Reliability
22. **P1:** LRU cache cu TTL pentru tenant transporters (max 50 entries, 30 min TTL)
23. **P2:** Fire-and-forget email send (async after DB insert)
24. **R1:** instanceId/lockedBy pe crash recovery
25. **R2:** Scheduled cleanup token-uri expirate (7 zile)
26. **G8:** Cap total emailuri failed per tenant (max 100 pending retries)
27. **P3+P4:** Promise.allSettled cu concurrency limit pe task reminders si client notifications

### Faza 5 -- Multi-Tenant & Deliverability
28. **T1:** Adauga tenant scoping pe task query in sendClientNotificationIfEnabled
29. **D1:** Fail loud pe SMTP_FROM missing (startup validation)
30. **D2:** Localizeaza subject-uri email in romana
31. **D4:** Trim whitespace din plain text templates
32. **SK4:** Audit trail pe operatii sensibile email (SMTP settings change, magic link manual send)

### Faza 6 -- Email Deliverability Avansata (skill email-delivery)
33. **SK1:** Tabela `email_suppression` + check before send (bounce/complaint)
34. **SK2:** RFC 8058 List-Unsubscribe headers pe emailuri non-tranzactionale
35. **SK3:** Stocheaza htmlBody complet la prima tentativa, refoloseste la retry

---

## FISIERE CRITICE DE MODIFICAT

| Fisier | Fix-uri |
|--------|---------|
| `src/lib/server/email.ts` | S1, S2, S9, G2, P1, P2, D1, D2, D4, SK3, SK5 |
| `src/lib/remotes/client-auth.remote.ts` | S3, S4, S5, S6, G3, G4, G5, L4, L5 |
| `src/lib/server/client-auth.ts` | S7, G1, G6, L1 |
| `src/lib/server/email-logger.ts` | E1, E4, SK5 |
| `src/lib/server/scheduler/tasks/email-retry.ts` | L3, R1, G8 |
| `src/lib/remotes/auth.remote.ts` | S3, R3 |
| `src/lib/remotes/tasks.remote.ts` | E3, T1, P4 |
| `src/lib/server/gmail/` | G7 (verificare encryption) |
| `src/lib/server/db/schema.ts` | G4 (UNIQUE constraint), SK1 (email_suppression) |

---

## VERIFICARE (checklist complet)

### Build & Type Check
1. `bun run check` -- TypeScript compiles clean
2. `bun run build` -- Build complet fara erori

### Teste Functionale Manuale
3. Client requestMagicLink -> email primit, token functioneaza
4. Admin requestMagicLink -> email primit, token functioneaza
5. Password reset -> functioneaza end-to-end
6. Verifica `email_log` -- payload e null pentru magic link/password reset
7. Verifica `email_log.htmlBody` -- token redactat din URL
8. Token vechi invalidat la request nou (verifica in DB)
9. Sesiuni vechi invalidate la login cu magic link nou
10. Rate limit activ (6+ requests/minut -> blocat cu mesaj generic)
11. Verifica ca escaped HTML nu sparge template-urile vizual
12. clientSignup cu CUI invalid -> mesaj generic (nu "Client not found")
13. clientSignup cu email gresit -> mesaj generic (nu "Email does not match")
14. Login multi-device simultan -> ambele reusesc (G1 fix verificat)

### Teste Security
15. Verifica `email_log` nu contine token-uri plaintext (nici payload, nici htmlBody)
16. Client user nu se poate loga cu parola dummy pe admin login
17. TLS rejectUnauthorized=true in producție
18. HTML injection test: seteaza tenantName cu `<script>alert(1)</script>`, verifica ca e escaped

### Teste Retry & Reliability
19. Simuleaza SMTP failure, verifica nu se creeaza randuri duplicate in email_log
20. Verifica crash recovery nu resetaza rows-urile altei instante (daca multi-instance)
21. Token-uri expirate (>7 zile) sunt curatate de scheduled task

### Teste Multi-Tenant (skill multi-tenant)
22. Verifica sendClientNotificationIfEnabled filtreaza pe tenantId
23. Email retry nu proceseaza emailuri cross-tenant
24. Admin email logs UI filtreaza corect per tenant

### Teste Deliverability (skill email-delivery)
25. SMTP_FROM lipseste -> warning/eroare la startup, nu `noreply@example.com`
26. Subject-uri in romana (nu "Login to X Client Portal")
27. Plain text emails fara whitespace extra
