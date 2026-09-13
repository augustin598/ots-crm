# Prompt de audit — modulul „Bugete ore" (credit de ore)

Copiază tot ce e între linii într-o sesiune NOUĂ de Claude Code, din rădăcina repo-ului.

---

Auditează și debughează modulul „Bugete ore" (credit de ore per client) din acest
repo. A fost implementat pe branch-ul `feat/hour-credits-f1-hourly-rates`, în
commit-urile de la `f0b58d2a` încoace (`git log --oneline f0b58d2a~1..HEAD`).
Citește `app/docs/bugete-ore.md` și
`app/docs/superpowers/specs/2026-09-10-client-hour-credits-design.md` (inclusiv
§13, revizuirea din 12 septembrie) înainte de orice.

**Nu rescrie designul și nu reface ecranele.** Caută defecte de corectitudine,
consecvență și siguranță. Orice reparație trebuie să vină cu test care pică
înainte și trece după.

## Ce e critic să verifici (în ordinea riscului)

1. **Banii și unitatea de credit.** Soldul e în minute la tariful de referință.
   Verifică pe rând fiecare cale de alimentare și de consum că folosește
   ACELEAȘI funcții: `effectiveRateEur`, `eurCentsToReferenceMinutes`,
   `weightFactor`, `roundToStep`. Caută orice loc care recalculează pe cont
   propriu (un `Math.round`, o împărțire la 60, un procent scris în cod). Un bug
   de tipul ăsta a existat deja: fluxul „Adaugă ore" rotunjea la minut în loc de
   `step_minutes` (reparat în `54894992`) — caută fraţii lui.

2. **Dubla creditare.** O factură emisă din „Adaugă ore" poartă
   `external_source = 'hour-credit'` și e respinsă de `invoiceCreditEligibility`.
   Verifică că nu există altă cale prin care aceleași ore pot intra de două ori:
   hook-ul `invoice.paid`, `creditInvoiceNow` din UI, re-emiterea facturii,
   sincronizarea Keez, importul de facturi vechi. Verifică și stornările.

3. **Idempotența.** Indexurile unice parțiale
   (`client_hour_ledger_source_uidx`, `client_hour_ledger_expire_uidx`) sunt
   singura garanție reală. Verifică ce se întâmplă la livrare dublă de webhook,
   la două taburi deschise care apasă simultan, și la jobul de expirare rulat de
   două ori în paralel. `applyLedgerEntry` prinde conflictul pe lanțul `cause` —
   confirmă că încă îl prinde după orice schimbare de versiune drizzle/libSQL.

4. **Soldul cache vs. ledger.** `client.hour_credit_minutes` e doar proiecție.
   Rulează `findHourCreditDrift` pe date reale și explică orice diferență.
   Verifică dacă există cale de scriere care ocolește `applyLedgerEntry`.

5. **Expirarea (FIFO).** `app/src/lib/logic/hour-credit-expiry.ts` +
   `scheduler/tasks/hour-credit-expiry.ts`. Jobul NU a rulat niciodată pe date
   reale — doar teste unitare. Verifică: ce se întâmplă la un client cu sold
   negativ, cu loturi parțial consumate, cu `credit_expiry_days` schimbat între
   timp, și dacă ordinea FIFO chiar minimizează pierderea clientului.

6. **Multi-tenant.** Fiecare query nou trebuie scopat pe `tenant_id`. Verifică
   `listHoursOrders`, `getMonthlyReport`, `listClientCreditTasks`,
   `listUncreditedInvoices` și remote-urile din
   `app/src/lib/remotes/hour-credits.remote.ts` (toate trebuie să treacă prin
   `requireStaff` / `requireOwnerOrAdmin`).

7. **TVA.** Cota vine din `invoiceSettings.defaultTaxRate`, iar clienții
   intracomunitari/export primesc 0% cu mențiunea legală
   (`classifyClientVat`, `appendZeroVatNote`, `taxApplicationType: 'none'`).
   Verifică pe toate fluxurile de ore (admin + `/servicii`) că se comportă la
   fel, și că nu există procent hardcodat nicăieri.

## Zone despre care știu că sunt fragile

- **Portalul clientului** (`client/[tenant]/(app)/hour-credits`) nu a fost probat
  live niciodată — cere cont de client. Verifică ce date ajung acolo: nu trebuie
  să iasă tarife interne, marje, note de ajustare sau facturi ale altor clienți.
- **Salvarea din Settings → Tarife orare** nu e o tranzacție: trimite o comandă
  per rând modificat. Dacă una pică, restul rămân salvate. Evaluează dacă asta
  poate lăsa catalogul într-o stare incoerentă (ex. referință inactivă).
- **Push-ul Keez** poate eșua legitim (ex. client cu același CUI ca firma
  emitentă). Rezultatul e verificat acum, dar `validateInvoiceInKeezForTenant`
  nu e apelat nicăieri în fluxul de ore — verifică dacă ar trebui.
- **Factura din „Adaugă ore"** rămâne `status: 'sent'`. Nu s-a verificat
  cap-coadă ce se întâmplă la plata ei: fiscalizare, `onInvoicePaid`,
  auto-validate, și dacă nu cumva declanșează ceva ce nu ar trebui.
- **Contrast**: paleta light a handoff-ului folosește `#94a3b8` pentru textele
  „mut" (~2,5:1 pe alb, sub WCAG AA 4,5:1). Varianta dark e la ~5,5:1. De
  evaluat, nu de reparat tacit — culorile sunt cerute explicit de design.
- **Culoarea „rezervat"**: verde în cardul de task, ambru hașurat în gauge-ul din
  Bugete ore. Aceeași noțiune, două culori.

## Cum verifici

```bash
bun run test                      # 2478 pass la data scrierii; NU `bun test`
bun run test hour                 # doar modulul
NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --threshold warning
bun run build                     # lightningcss pică pe CSS ce dev nu vede
```

Pentru date reale: baza de dev E baza de producție. Citește oricât, dar **nu
scrie** fără să spui explicit ce și de ce. Endpoint-uri utile, admin-gated:
`/[tenant]/api/_debug-hour-credit-settle` (decontează un task prin logica reală)
și `/[tenant]/api/_debug-hour-credit-notify` (trimite notificările pe o adresă
dată explicit).

Date lăsate din probe pe tenantul `ots`, clientul ONE TOP SOLUTION S.R.L.
(`fd4il5ms2wcdhk3weghrbbpd`): un credit manual, factura `OTS 561` (respinsă de
Keez, același CUI), taskurile `e6gtql6kfuvg` (deschis, rezervă) și
`sh5gc4lyajrs` (decontat, cu depășire).

## Livrabil

O listă de constatări ordonate după severitate. Pentru fiecare: fișierul și
linia, cum se reproduce, ce se strică practic (în bani sau în date), și
reparația propusă. Separă clar „bug" de „preferință de design". Dacă nu găsești
nimic într-o secțiune, spune asta explicit — nu umple raportul.

---
