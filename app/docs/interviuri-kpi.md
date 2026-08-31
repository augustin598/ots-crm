# Interviuri → KPI Performanță (cost pe interviu)

Pagina `/[tenant]/interviuri/kpi` răspunde la o singură întrebare: **cât ne costă un interviu**.
Costul = **buget ads** (Meta / TikTok / Google, citit din tabelele deja sincronizate) + **cheltuieli
fixe de marketing** (introduse manual în pagină).

Prototipul de referință: proiectul Claude Design „Create campaign ADS" → `Interviuri KPI.html`
(`interviuri-kpi.jsx`, `interviuri-kpi-data.jsx`, `interviuri-kpi-styles.css`).

## Fișiere

| Rol | Fișier |
|---|---|
| Formule (modul pur, folosit de server ȘI de UI) | `src/lib/logic/interviuri-kpi.ts` |
| Agregare spend pe lună/platformă + conversie BNR | `src/lib/server/interviuri/kpi-data.ts` |
| Cheltuieli fixe (seed/reset/listare, cenți ↔ lei) | `src/lib/server/interviuri/fixed-costs.ts` |
| Remote functions | `src/lib/remotes/interviuri-kpi.remote.ts` |
| UI | `src/lib/components/interviuri/kpi/*` (+ `interviuri-kpi.css`), ruta `src/routes/[tenant]/interviuri/kpi/+page.svelte` |
| Schema | `marketing_fixed_cost` (migrări `0495`, `0496`) |
| Teste | `src/lib/logic/__tests__/interviuri-kpi.test.ts`, `src/lib/server/interviuri/__tests__/kpi-spend.test.ts`, `src/lib/remotes/__tests__/interviuri-kpi-fixed-costs.test.ts` — `bun run test interviuri-kpi kpi-spend` |

## Surse de date

- **Interviuri**: `interview` (data, canal, status) — se folosesc anul curent și anul precedent (pentru delta).
- **Buget ads**: NU există tabel `ad_spend_monthly`. Se agregă la citire din `meta_ads_spending`,
  `tiktok_ads_spending`, `google_ads_spending` pentru **clienții asociați interviurilor**
  (`interview.client_id` distinct pe tenant). Dacă niciun interviu n-are client, pagina arată un banner
  și doar cheltuielile fixe.
- **Valută**: Google raportează în USD. Conversia se face la cursul BNR de la **sfârșitul lunii**
  (plafonat la azi pentru luna curentă), cu `loadBnrFxRates`. Pentru lunile fără istoric BNR în CRM
  (istoricul începe în 2026) se folosește **cel mai recent curs** și pagina afișează o notă
  „convertite la cel mai recent curs disponibil"; dacă nu există niciun curs, suma e exclusă și
  semnalată.
- **Conturi**: eticheta de sub numele platformei vine din `meta_ads_account` / `tiktok_ads_account` /
  `google_ads_account` (conturile active ale acelorași clienți); „ultima sincronizare" = `max(synced_at)`
  din rândurile de spend.
- **Cheltuieli fixe**: `marketing_fixed_cost` — `qty × unit_amount_cents` (÷12 dacă `frequency='yearly'`),
  `active`, `valid_from`/`valid_to` (`YYYY-MM`, inclusiv). La prima citire se inserează cele 3 rânduri
  implicite din prototip (4 × 8.000, 940, 2.500 lei/lună); „Resetează" le reface.

## Mapare canal ↔ platformă

```
tiktok → „TikTok"
google → „Google / SEO"
meta   → „Facebook", „Instagram"
organic (fără ads): Recomandare, AI (ChatGPT), YouTube, Site / Anunț, Nespecificat, orice canal nou
```

## Formule (`computeKpi`)

```
luni_în_scop        = lunile selectate cu spend > 0 SAU interviuri
ads_total           = Σ spend(platformă, lună) pe lunile în scop
fix_lunar(l)        = Σ qty × unit (÷12 anual) pentru rândurile active valabile în luna l
fix_total           = Σ fix_lunar(l) pe lunile în scop
buget_total         = ads_total + fix_total
cost/interviu       = buget_total / interviuri          (null → „—")
cost/admisă         = buget_total / admise
cost/interviu plătit= ads_total / interviuri din canale plătite (fără fixe)

pe canal:
  ads_canal = spend_platformă × interviuri_canal / interviuri_platformă
  fix_canal = „toate"   → fix_total × interviuri_canal / interviuri
              „plătite" → fix_total × interviuri_canal / interviuri_plătite (0 la organice)
delta = vs luna precedentă din scop (dacă e selectată o lună) sau vs anul precedent
```

Rotunjirea se face doar la afișare (`fmtLei` fără zecimale, `fmtLeiFine` o zecimală sub 100 lei).

## Comportament UI

- Query-ul aduce **tot anul** (+ anul precedent); filtrarea pe lună e în client, instant.
- Anul NU se persistă (serverul alege cel mai recent an cu date; un an salvat ar dubla query-ul la
  încărcare); comutatorul „toate | plătite" e persistat în `localStorage` (`ots_iv_kpi_v1`).
- Panoul „Cheltuieli fixe" din pagină e un rezumat read-only; editarea se face în modalul
  „Setări cheltuieli" (`FixedCostsModal.svelte`, deviere cerută de utilizator față de prototip).
- Editorul e optimist: overlay local + salvare cu debounce 400 ms (`updateMarketingFixedCost`);
  bifa „activ" salvează imediat; overlay-ul se scoate doar când nu mai e nicio cerere în zbor pe rând
  (altfel o cerere veche ar șterge tastele de după ea); la eroare → toast + valoarea din server.
- Scrierea pe cheltuieli fixe: doar `owner`/`admin` (`canEdit` din query dezactivează controalele).
- „Sincronizează bugetele" rulează secvențial `syncMetaAdsInvoicesForTenant`,
  `syncTiktokAdsSpendingForTenant`, `syncGoogleAdsInvoicesForTenant` (fiecare în try/catch) și
  reîncarcă query-ul; poate dura ~2 minute (Google descarcă și facturi). Lock per tenant în Redis
  (`{tenantId}:interviuri-kpi:sync-lock`, TTL 10 min) — al doilea click primește „deja în curs".
- Tabelul pe canal afișează sub el bugetul **nealocat** (platformă cu spend dar fără interviuri din
  canalele ei; fixe în modul „plătite" fără interviuri plătite) ca suma coloanelor să fie explicabilă.
- Export CSV se generează în browser din rândurile lunare afișate (o coloană per platformă).

## Neimplementate încă (follow-up)

- UI pentru `valid_from` / `valid_to` (există în schemă, logică, comenzi și teste).
- Filtru pe studio (conturile de ads sunt per client, nu per studio).
- Snapshot lunar `marketing_fixed_costs_monthly` pentru istoric fidel la schimbarea salariilor.
