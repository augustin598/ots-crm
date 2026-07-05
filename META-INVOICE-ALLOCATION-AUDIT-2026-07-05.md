# Audit repartizare facturi & sume Meta Ads → clienți (2026-07-05)

> **STATUS 2026-07-05 (fix aplicat):** #1, #2, #3, #5, #6, #7, #8, #9 — REZOLVATE în cod (svelte-check 0/0, 57 teste pass, staff verificat în browser). #4 (Glemis) — necesită DECIZIA ta (nu ating datele de producție). #10/#11 (amountText lipsă / documente duplicate txid-NULL) — limitări cunoscute, nu misrepartizare; lăsate pentru un pas ulterior. Fixurile sunt necommise; intră în efect la deploy.

Metodă: 6 auditori pe dimensiuni, apoi **verificare manuală de mine** (cod + SQL read-only pe DB producție — faza automată de verificare adversarială a picat pe limita de sesiune, așa că am reverificat eu constatările load-bearing). 623 facturi (`meta_invoice_download`), 53 rânduri spending (`meta_ads_spending`), 49 conturi.

## Concluzie
**Datele ACTUALE sunt corect repartizate.** Niciun client nu are azi factura/suma altui client. Verificat independent: 0 client NULL, 0 orfani, 0 drift față de contul actual, 0 duplicate cont+perioadă cu client diferit, 0 txid duplicat. Portalul clienților filtrează corect pe client (userii legitimi văd doar ce e al lor); cele 2 endpoint-uri PDF verifică apartenența.

Există însă **1 defect de izolare (securitate)**, câteva **probleme reale de calitate a datelor** și **mecanisme latente** care ar putea produce repartizări greșite în viitor.

---

## 1. Scurgere de izolare F8 — HIGH (confirmat)
`getMetaAdsSpendingList` (:85), `getMetaInvoiceDownloads` (:826), `getMappedMetaAdsClients` (:173) filtrează pe client DOAR pe ramura `if (isClientUser && client)`. Ramura `else` folosește doar guard-ul `!user || !tenant` — pe care **documentația proiectului însăși** (`access.ts:216-221`) îl declară bypassabil prin header-ul `x-sveltekit-pathname: /client/<slug>/...`.

Mecanism confirmat în `hooks.server.ts:131-135`: un user autentificat FĂRĂ `clientUser` și FĂRĂ `tenantUser` pe ruta `/client/<slug>` primește `tenant` setat, `isClientUser=false`, `client=null` → cade pe ramura `else` → primește **toate** facturile/sumele/maparea tuturor clienților tenantului (nume client, cont, BM, sume, impresii, perioade, FBADS).

Surori corect protejate cu `requireStaff`: `getMetaAdsAccounts` (:136), `getClientsForMetaMapping` (:209), `getAccountsForInvoiceDownload` (:870). Cele 3 de mai sus au fost ratate la fix-ul F8.

**Fix** (păstrează portalul): pe ramura non-client → `await requireStaff(event)`. Read-only, low-risk.

## 2. `period_end` înghețat — MEDIUM (confirmat, 24 rânduri)
`sync.ts:199` — branch-ul de UPDATE actualizează spend/impresii/clicks dar NU `periodEnd`. În prod: 24 rânduri cu `period_start == period_end` (ex. iulie: rândurile sincronizate pe 1 iul. au `period_end='2026-07-01'` deși spend-ul s-a schimbat; cele sincronizate azi au `2026-07-05`). Pagina de staff grupează pe `periodStart` (nefectată), dar orice etichetă/raport pe `periodEnd` arată interval greșit.

## 3. `limit(500)` ascunde facturi — MEDIUM (confirmat, 123 ascunse)
`getMetaInvoiceDownloads:859` (și `getMetaAdsSpendingList:123`). 623 facturi > 500 → **123 cele mai vechi dispar din vederea staff** (`orderBy periodStart DESC`). Nu e repartizare greșită (rândurile există corect), ci pierdere de vizibilitate ~20%. Spending (53) nu e încă tăiat.

## 4. Cont dezasignat: colectare oprită silențios + atribuire veche rămasă — MEDIUM (confirmat)
> **DECIZIE 2026-07-05: se lasă așa cum e, intenționat.** Nu se atinge nimic. Contul rămâne dezasignat; cele 20 facturi + 4 rânduri spending rămân pe fostul client (istoric), iar contul nu mai colectează date noi — comportament dorit. Fixul de dedup NU afectează aceste rânduri (sync/downloader sar conturile fără client).

Contul `#3 - Glemis.ro Shoes` (`act_521855807347143`) e dezasignat (client_id NULL) dar activ. Rămân **20 facturi + 4 rânduri spending** pe fostul client `hc2cs5d6srudhgsmzy4hs3h6`, iar facturile/spending noi **nu se mai colectează deloc** (downloader/sync procesează doar conturi cu client). Din iunie, acest cont nu mai produce date.

## 5. Dedup include `clientId` + UPDATE nu reîmprospătează clientId — MEDIUM latent
`sync.ts:181` (cheie dedup cu clientId) + căile de UPDATE din `sync.ts` și `invoice-downloader.ts:446` nu ating niciodată clientId. La **reatribuirea unui cont la alt client în cursul ferestrei** (luna curentă + 2 precedente), sync-ul inserează rând nou pentru clientul nou și lasă rândul vechi → aceeași cheltuială numărată la 2 clienți. Azi 0 duplicate (verificat), dar workflow-ul de dezasignare e activ (Glemis) → risc real.

## 6. `currencyCode` hardcodat 'RON' — MEDIUM latent
`sync.ts:224`. Toate cele 53 rânduri sunt RON azi, dar 2 conturi BeautyOne asociate EUR (`BeautyOneShop.ro`, `BeautyOne Ad Account-Primary`) sunt mapate la un client → dacă acumulează spend, ar fi etichetat/sumat greșit ca RON.

## 7. Import bulk: fără validare `act=` din URL — MEDIUM (vector atribuire greșită)
`meta-ads-invoices.remote.ts:1582` — orice link lipit e atribuit `account.clientId` al contului selectat, fără a verifica că `act=` din URL corespunde contului. Un operator care lipește chitanțele altui cont/client → factură la clientul greșit. Staff-only, manual.

## 8. Import bulk: clasificare 'credit' greșită — LOW/MEDIUM
`:1591` — `invoiceType: link.invoiceNumber ? 'invoice' : 'credit'`, dar extractoarele trimit numărul sub cheia `invoiceId` (folosită corect la `:1569`). Facturi reale marcate 'credit' + număr FBADS pierdut → ascunse din listările default.

## 9. Fallback dată 1970-01-01 — LOW
`:1527/1531` — date românești („15 mai 2026") → `Invalid Date` → `periodStart='1970-01-01'` silențios. Factura nu se grupează cu luna corectă.

## 10. Context sume: `amountText` lipsă pe 563/623 (90%)
Calea ZIP nu salvează niciodată suma facturii. Sumele afișate în CRM vin din `meta_ads_spending` (Insights API), nu din facturile PDF. 21 perioade au și document lunar (txid NULL) și chitanțe per-tranzacție → documente duplicate (nu sume duplicate, fiindcă amountText e mai peste tot NULL).

---

## Verificat CURAT
- 0 client_id NULL/orfan (downloads + spending); 0 drift față de contul actual; 0 duplicate cont+perioadă cu client diferit; 0 txid duplicat; 0 pdf_path duplicat; 0 sume negative; 0 mismatch spend_cents/spend_amount; 0 valute amestecate per client; 0 period_start>period_end.
- Portalul clienților: userii client legitimi (primari) văd doar clientul lor; secundarii primesc []; PDF endpoints verifică apartenența → 403.

## Prioritate recomandată fix
1. **F8 (#1)** — securitate, fix trivial (requireStaff pe ramura else, 3 funcții).
2. **Glemis (#4)** — decide: reatribuie contul sau confirmă că e intenționat oprit.
3. **period_end (#2)** + **limit 500 (#3)** — calitate/vizibilitate date.
4. **Dedup clientId (#5)** + hardcode RON (#6) — hardening înainte de următoarea reatribuire.
5. Import bulk (#7/#8/#9) — validări.
