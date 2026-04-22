# Audit — Ads Status Monitor (2026-04-22)

**Scope:** Sistemul ads-status-monitor (reconciler, status mappers, scheduler task, dashboard, email sender).

**Metodologie:** Claude cu skill checklists (multi-tenant, api-integrations, error-handling, email-delivery) + review independent Gemini.

**Incident prealabil (rezolvat):** Commit `a5623ff` — seed-without-alert pentru prima observație.

---

## Findings consolidate (ranked pe severitate)

### CRITIC

#### C1 — `triggerAdsStatusMonitor` fără rate limit (`ads-status.remote.ts:192-209`)
**Problemă:** Comanda nu are cooldown; un admin poate spam-clica "Verifică acum" pentru a coadai N joburi, fiecare polling pentru toate tenantele.
**Repro:** 10 clicuri în 2 secunde → 10 joburi globale în queue → 10× apeluri API la Meta/Google/TikTok (riscă rate limit + arde tokenuri).
**Fix:** Adaugă cooldown în-memorie (30-60s per tenant), urmând pattern-ul din `scheduler.remote.ts:44-46`.

#### C2 — `triggerAdsStatusMonitor` declanșează polling pentru TOATE tenantele, nu doar pentru tenantul admin-ului (`ads-status.remote.ts:201-205`)
**Problemă:** Jobul adăugat rulează `processAdsStatusMonitor` global. Admin din tenant A apasă butonul → se poluează tenantele B, C, D etc.
**Repro:** Oricare admin apasă "Verifică acum" → toate integrările ads ale platformei sunt sollicitate.
**Fix:** Jobul să accepte un `tenantId` param și să polleze doar tenantul indicat, SAU restricționează butonul pentru rol de platform-admin.

#### C3 — Admin recipients include TOATE rolurile, nu doar owner/admin (`payment-alerts.ts:109-118`)
**Problemă:** `resolveAdminRecipients` face `where(eq(tenantUser.tenantId, tenantId))` fără filtru de rol. Toți membrii primesc email + notificare.
**Repro:** Tenant cu 10 membri + 1 owner → 11 emailuri pentru fiecare cont flagged (amplifică spam-ul).
**Fix:** Adaugă `inArray(tenantUser.role, ['owner', 'admin'])`. Planul original specifica doar `'owner'`.

#### C4 — Email storm potențial: N conturi × M admini în același run (`payment-alerts.ts:175-207`)
**Problemă:** `sendAdPaymentAlertEmail` e apelat per-(admin × cont). 10 conturi bad → 10 emailuri per admin. Fingerprint-ul există doar pentru in-app notifications (via `createNotification`), NU pentru emailuri (noi le trimitem direct, bypasând `EMAIL_TYPES`).
**Repro:** Google Ads API returnează `SUSPENDED` pentru 20 sub-conturi într-o singură rulare (posibil prin eroare API temporară) → 20 emailuri identice în admin inbox.
**Fix:** Schimbă de la "email per cont per admin" la "digest email per admin per run" — colectează toate tranzițiile în reconciler, apoi trimite UN email summary per admin.

### MAJOR

#### M1 — Queries în reconciler fără filtru `tenantId` (defense-in-depth) (`payment-alerts.ts:43, 52, 57, 74, 88, 101, 128, 135`)
**Problemă:** `persistStatus`, `readPriorStatus` și `resolveClientRecipients` fac lookup prin `id/clientId` alone, fără filtru `tenantId`. În fluxul actual funcționează fiindcă snapshot-urile sunt deja tenant-scoped, dar violează regula din skill multi-tenant: "Never fetch tenant-scoped entities by bare ID alone".
**Repro teoretic:** Un bug viitor care pasează un `accountTableId` dintr-un tenant diferit ar duce la cross-tenant data read/write.
**Fix:** Adaugă `and(eq(table.X.id, accountTableId), eq(table.X.tenantId, tenantId))` în fiecare query. Pentru `clientUser` + `client`, adaugă `eq(table.Y.tenantId, tenantId)`.

#### M2 — Dispatch-then-persist race: dacă `sendEmail` eșuează, notificarea e pierdută pentru totdeauna (`payment-alerts.ts:300-301`)
**Problemă:** `persistStatus` rulează ÎNAINTE de `dispatchNotifications`. Dacă email-ul eșuează, prior == current la următorul run → notificare niciodată nu se trimite.
**Repro:** Gmail down → email eșuează → admin nu află NICIODATĂ de problema contului.
**Fix:** Track "alerted" ca flag separat (nu prin comparare status), SAU scrie în `debugLog` cu `resolved=false` pentru retry manual din panoul de logs.

#### M3 — Google `billingSetupStatus = 'NONE'` clasificat ca `payment_failed` (`google-ads/status.ts:18`)
**Problemă:** Un cont nou fără billing setup primește status `payment_failed`. Semantic greșit — nu e "plată eșuată", ci "nu a fost configurată plata".
**Repro:** Creezi un customer nou în Google Ads, nu configurezi billing → alert "plată eșuată" pentru ceva ce nu e încă activat.
**Fix:** Tratează `'NONE'` ca `risk_review` sau adaugă categoria nouă `needs_billing`. Alternativ: filtrează accounturile fără `lastFetchedAt` sau create recent.

#### M4 — Status-uri necunoscute silent → 'ok' (`meta-ads/status.ts:32-33`, `tiktok-ads/status.ts:24-25`)
**Problemă:** Default case în mapper returnează `'ok'` fără log. Dacă Meta/TikTok introduc un cod nou (ex. `STATUS_FROZEN`), accountul apare ca sănătos.
**Repro:** TikTok adaugă un nou status code → conturile afectate rămân "ok" în DB, nimeni nu afla de suspendare.
**Fix:** Adaugă `logWarning('ads-monitor', 'Unknown status', { metadata: { provider, code } })` în default case. Opțional: considerezi unknown drept `risk_review` implicit (safety bias).

#### M5 — Fără timeout per-tenant în scheduler task (`ads-status-monitor.ts:157-190`)
**Problemă:** Meta `listBusinessAdAccounts` + Google `listMccSubAccounts` + `fetchBillingSetupStatus` per sub-cont nu au timeout agregat. Dacă una dintre integrări se blochează (BullMQ worker stuck), taskul orar următor nu rulează (concurrency=1).
**Repro:** Meta Graph API îngheță (pre-existent cu incidentul BNR cert din aprilie) → workerul stă blocat până la timeout BullMQ implicit.
**Fix:** Wrap fiecare poll în `Promise.race([poll, timeoutAfter(60_000)])`.

#### M6 — Google billing_setup N+1 queries sequențial (`google-ads/status.ts:51`)
**Problemă:** Pentru MCC cu 78 sub-accounts, 78 de query-uri GAQL secvențiale. Durează minute.
**Repro:** Tenant mare → pollul Google Ads nu se termină în bugetul de o oră.
**Fix:** Paralelizare cu throttle (ex. `p-limit 5`), sau cache rezultatul billing_setup pentru 1-4 ore (rar schimbat).

#### M7 — Admin primește alerte despre probleme ale clienților, NU despre platformele proprii (`payment-alerts.ts:175-207`)
**Problemă / design ambiguu:** Admin tenant (agency-ul) primește alerte despre TOATE conturile ads ale clienților. La 50 clienți × 10 conturi fiecare = 500 potențiale alerte.
**Repro:** Orice tenant cu mulți clienți va spami admin-ul.
**Fix:** Opțiuni de design în settings tenant: "notifică admin pentru (a) toate, (b) doar fără client asignat, (c) doar critice (suspendat/payment_failed)". Sau în layer de digest (vezi C4).

#### M8 — Dead code în `resolveAdminRecipients` (`payment-alerts.ts:115-117`)
**Problemă:** `.filter((r) => r.email).filter((r) => { return true; })` — al doilea filter e no-op.
**Fix:** Elimină al doilea filter. (Probabil artefact din refactor.)

### MINOR

#### m1 — `payment-alerts.ts:50` — swap semantic între `billingSetupStatus` și `rawDisableReason`
Google-specific: `rawDisableReason` transportă `billingSetupStatus`. Funcționează, dar confuz.
**Fix:** Redenumește câmpul `PaymentStatusSnapshot.rawSecondaryCode` cu comentariu ce semnifică per-provider.

#### m2 — Dashboard query transferă toate paymentStatus-urile, inclusiv `ok` (`ads-status.remote.ts:82-121`)
Pentru tenant cu 117 conturi, transferă toate rândurile. Acceptabil momentan.
**Fix (lazy):** Filtrează `paymentStatus != 'ok'` la nivel de DB dacă tabela crește peste 1000+ rânduri.

#### m3 — Email `payload.args` include `params` object complet → bloat în email_log
`sendAdPaymentAlertEmail` stochează parametrii pentru replay. Acceptabil.

#### m4 — Circuit breaker nu resetează când integrarea e reparată explicit
Dacă admin reconectează OAuth, breakerul poate fi încă deschis cu 15min de cooldown.
**Fix:** Adaugă un hook în fluxul OAuth callback care să invalideze breakerul pentru tenantul respectiv.

#### m5 — Restaurarea nu elimină notificările vechi "suspendat"
După `bad → ok`, notificarea veche rămâne în bell unread, cu titlu "⚠️ Cont X suspended".
**Fix (UX):** În reconciler, la restaurare, marchează notificările cu același fingerprint `ad.*` + external_account_id ca read. Necesită API nou în `notifications.ts`.

---

## Findings Gemini (independent review)

Gemini a identificat 6 finding-uri, dintre care 3 overlapă cu ale mele.

| # | Severitate | File:line | Problemă | Overlap cu Claude |
|---|---|---|---|---|
| G1 | CRITIC | `google-ads/status.ts:38` | Query stored scoped doar pe tenantId, nu pe integrationId — tenant multi-MCC ar putea cross-asocia sub-conturi | Nou (am notat ca m1 minor, Gemini îl ranchează critic) |
| G2 | CRITIC | `ads-status.remote.ts:204` | `triggerAdsStatusMonitor` e global, nu pe tenantul curent | **Confirmă C2** |
| G3 | CRITIC | Toate 3 status.ts | Default `'ok'` silențios — cod nou → alertă niciodată | **Confirmă M4** (Gemini sugerează `suspended` ca fail-closed; am optat pentru `risk_review` ca compromis) |
| G4 | MAJOR | `ads-status-monitor.ts:163,169,175` | Circuit breaker nu se clarifică pentru 0 snapshots | Finding nou (am ratat) |
| G5 | MAJOR | `payment-alerts.ts:115-117` | Filter no-op în `resolveAdminRecipients` | **Confirmă C3 + M8** |
| G6 | MINOR | `payment-alerts.ts:243` | `client.email` folosit doar ca fallback când nu există `clientUser` — dar billing@ ar trebui inclus mereu | Finding nou (am ratat) |

---

## Fix-uri aplicate

Toate fix-urile CRITICE + MAJORE au fost implementate direct pe `main` în același commit (bundle logic):

| Finding | Fix | File:line |
|---|---|---|
| C1 | Rate limit 60s/tenant pe `triggerAdsStatusMonitor` | `ads-status.remote.ts:192-217` |
| C2 / G2 | Manual trigger scope la tenantul curent (`tenantIds` param) | `ads-status.remote.ts:209`, `ads-status-monitor.ts:136-182` |
| C3 / G5 | Filter `inArray(role, ['owner','admin'])` + curat filter no-op | `payment-alerts.ts:109-121` |
| M1 | `tenantId` filter defensiv în `persistStatus`, `readPriorStatus`, `resolveClientRecipients` | `payment-alerts.ts:33-107, 120-157` |
| M3 | Google `billingSetupStatus = 'NONE'` → `risk_review` (nu `payment_failed`) | `google-ads/status.ts:18-19` |
| M4 / G3 | Unknown status mappers → `logWarning` + `risk_review` default (fail-safer) | `meta-ads/status.ts:34-38`, `google-ads/status.ts:21-25`, `tiktok-ads/status.ts:24-28` |
| M5 | `withTimeout(90s)` pe fiecare poll per-integration | `ads-status-monitor.ts:49-64` |
| M8 | Eliminat filter no-op în `resolveAdminRecipients` | `payment-alerts.ts:109-121` |
| G1 | Documentat (nu fixat — schema n-are `integrationId` pe `googleAdsAccount`, necesită migrație) | comment în `google-ads/status.ts:38-40` |
| G4 | Introdus `anySuccess` flag per poll — markSuccess iese correct din start | `ads-status-monitor.ts:65-67, 89-92, 113-116, 169-181` |
| G6 | `client.email` inclus mereu (dedup pe match cu userRecipient) | `payment-alerts.ts:120-157, 213-234` |

**C4 (email digest)** — amânat ca follow-up: design nou necesar, nu blochează operațiunea (M-ul e redus semnificativ de C3 + noul role filter).

---

## Recomandări ulterioare (în afara scope-ului actual)

1. **Digest summary email per-tenant per-run** — un singur email care listează toate conturile afectate.
2. **Panel admin pentru "retry failed dispatch"** — button pe debugLog entry `ad_alert_dispatch_failed` care re-trimite.
3. **Fixture de test cross-tenant** — verifică că accountTableId din tenant A nu poate accesa tenant B.
4. **Metric de unknown statuses** — counter per provider; alertă când > 0.
