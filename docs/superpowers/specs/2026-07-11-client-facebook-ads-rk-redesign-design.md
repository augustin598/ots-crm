# Portare design „rk" Facebook Ads în portalul de client

**Data:** 2026-07-11
**Autor:** Claude + Augustin
**Status:** Aprobat pentru planificare

## Context & problemă

Pagina de admin `/[tenant]/reports/facebook-ads` a fost refăcută pe 2026-06-18 (commit `856b114`,
*„redesign Facebook Ads report 1:1 with new rk design system"*) cu un sistem de design nou („rk"):
`rk-report.css` + un folder de componente dedicate.

Pagina echivalentă din portalul de client — `/client/[tenant]/(app)/reports/facebook-ads` — a rămas
pe designul vechi din aprilie (shadcn `Card`/`Table`/`Badge` + componentele din `$lib/components/reports/*`).
Rezultatul: cele două pagini arată complet diferit și au adâncime de raportare diferită.

**Obiectiv:** pagina de client să arate și să raporteze **1:1 ca adminul**, dar **read-only** (fără
controalele de scriere), folosind aceleași componente rk.

## Constrângeri (impuse de backend — nu sunt preferințe)

Guard-urile din `src/lib/remotes/reports.remote.ts` decid ce e posibil:

- **Query-urile de citire** (`getMetaCampaignInsights`, `getMetaActiveCampaigns`,
  `getMetaDemographicInsights`, `getMetaPlatformSplit`, `getMetaAdsetInsights`, `getMetaAdInsights`)
  apelează toate `verifyClientAccess(event, adAccountId)` → **sigure pentru client** (verifică că
  `client.id` deține contul). Deci demografice + platform split pot fi folosite în portal.
- **Comenzile de scriere** blochează explicit clienții:
  - `updateBudget` → `if (isClientUser) throw error(401, 'Doar adminii pot modifica bugetul')`
  - `toggleCampaignStatus` → `if (isClientUser) throw error(401, 'Doar adminii pot schimba statusul campaniilor')`

  ⇒ On/Off campanie, editare buget și bulk pauză **nu pot funcționa** pentru client. Portarea e
  read-only pe aceste acțiuni prin necesitate (aliniat și cu istoricul de securitate F8 — portal client).

## Decizii de design (confirmate cu userul)

1. **Nivel paritate:** paritate completă vizuală + adâncime de raportare, **read-only**.
2. **Arhitectură componente:** extrag componentele rk în `$lib` partajat, folosite din ambele pagini
   (o singură sursă, zero drift).
3. **Bannere plată/token:** **incluse** (necesită mică îmbogățire aditivă a `getMyAdAccounts`).

## Arhitectură — extragere componente partajate

### Mutare fișiere (`git mv`, păstrează istoricul)

Din `src/routes/[tenant]/reports/facebook-ads/` în `src/lib/components/reports/rk/`:

| Sursă (folder admin) | Destinație (`$lib/components/reports/rk/`) |
|---|---|
| `components/AdvancedKpi.svelte` | `AdvancedKpi.svelte` |
| `components/Audience.svelte` | `Audience.svelte` |
| `components/ColumnManager.svelte` | `ColumnManager.svelte` |
| `components/ComboChart.svelte` | `ComboChart.svelte` |
| `components/FilterBar.svelte` | `FilterBar.svelte` |
| `components/Funnel.svelte` | `Funnel.svelte` |
| `components/KpiRow.svelte` | `KpiRow.svelte` |
| `components/PlatformSplit.svelte` | `PlatformSplit.svelte` |
| `components/Popover.svelte` | `Popover.svelte` |
| `components/PresetSelect.svelte` | `PresetSelect.svelte` |
| `components/SpendChart.svelte` | `SpendChart.svelte` |
| `components/rk-helpers.ts` | `rk-helpers.ts` |
| `components/rk-icons.ts` | `rk-icons.ts` |
| `rk-report.css` | `rk-report.css` |

**De ce e sigur:**
- Importurile interne dintre componente sunt relative (`./rk-helpers`, `./rk-icons`, `./Popover.svelte`)
  și se mută împreună → rămân valide.
- Restul importurilor sunt `$lib/*` (deja partajate) → neafectate.
- `rk-report.css` nu are `url()` sau `@import` route-relative.
- **Singurul consumator existent** e `+page.svelte` din admin (verificat: nicio altă rută nu importă
  folderul, inclusiv pagina de monitoring).

### Actualizare importuri în pagina de admin

În `src/routes/[tenant]/reports/facebook-ads/+page.svelte`, blocul de importuri se schimbă doar de cale
(fără schimbare de comportament):

```
import './rk-report.css';                    → import '$lib/components/reports/rk/rk-report.css';
import KpiRow from './components/KpiRow.svelte';          → '$lib/components/reports/rk/KpiRow.svelte'
import SpendChart from './components/SpendChart.svelte';  → '$lib/components/reports/rk/SpendChart.svelte'
import ComboChart from './components/ComboChart.svelte';  → …
import AdvancedKpi from './components/AdvancedKpi.svelte';
import Audience from './components/Audience.svelte';
import Funnel from './components/Funnel.svelte';
import PlatformSplit from './components/PlatformSplit.svelte';
import FilterBar, { type RkFilters } from './components/FilterBar.svelte';
import ColumnManager from './components/ColumnManager.svelte';
import PresetSelect from './components/PresetSelect.svelte';
import { rkIcon } from './components/rk-icons';           → '$lib/components/reports/rk/rk-icons'
import { aggregateMetrics, getObjectiveConfig, getObjectiveKpis, getDefaultKpis } from './components/rk-helpers';  → '$lib/components/reports/rk/rk-helpers'
```

## Backend — o singură modificare (aditivă, în `getMyAdAccounts`)

Azi `getMyAdAccounts` (`reports.remote.ts:271`) selectează doar:
`{ id, metaAdAccountId, accountName, integrationId, clientId }` (+ `currency` din spending).

Pentru bannerele de plată/token la paritate cu adminul, îmbogățesc SELECT-ul cu exact cele 5 câmpuri
folosite de derivările `paymentWarning` / `tokenWarning` din pagina de admin:
`disableReason, accountStatus` (payment) și `tokenExpiresAt, integrationActive, isActive` (token) —
toate expuse deja de `getReportAdAccounts`.

- Scope-ul rămâne **strict** pe `tenant.id` + `client.id` (neatins).
- Modificare pur aditivă (coloane în plus în proiecție) → nu schimbă semantica existentă.
- Referință pentru forma câmpurilor: derivările `paymentWarning` / `tokenWarning` din
  `+page.svelte` (admin), liniile ~126-146.

## Pagina de client — structură reconstruită

Rescriu `src/routes/client/[tenant]/(app)/reports/facebook-ads/+page.svelte` oglindind template-ul din
admin, importând componentele rk din `$lib/components/reports/rk/`.

### Păstrat identic cu adminul
- Header rk: icon Facebook + titlu + subtitlu; selector cont (`rk-select`); `SavedViewSelector`;
  `DateRangePicker`; buton Refresh.
- KPI row dinamic pe obiectivul dominant (`getObjectiveKpis` / `getDefaultKpis`) via `KpiRow`.
- Grafice: `SpendChart` + `ComboChart` (`rk-charts-2`).
- `AdvancedKpi` (collapsible) — executive summary, budget burn, CPA momentum, funnel, saturation, day-of-week.
- `Audience` (demografice) via `getMetaDemographicInsights` la nivel de pagină (whole-account, ca adminul).
- `Funnel` + `PlatformSplit` via `getMetaPlatformSplit`.
- Banner anomalii (`detectAnomalies` / `getAnomalySummary`).
- Comparație perioadă anterioară (query prev-period → `prevMetrics`).
- Tabel rk: status segment (Toate/Active/Paused), tip tabs pe obiectiv, `FilterBar`, `ColumnManager`,
  `PresetSelect`, contor campanii, export CSV, sortare pe coloană, paginare, rând Total agregat,
  expand campanie→adset→ad, health badges, markere anomalii, `previewUrl` (Eye).
- Toast (`rk-toast`).

### Eliminat (admin-only / blocat de backend)
- Coloana **On/Off** (`rk-onoff` switch) + `handleToggleStatus` + `togglingCampaignId`.
- **Editare buget**: dialogul (`Dialog.*`), butonul creion din celula budget, `openBudgetEdit` /
  `handleBudgetSave`, importul `updateBudget`.
- **Bulk bar** (Pornește / Pauză) + `bulkToggle`.
- **Owner filter**: se pasează `owners={[]}` către `FilterBar` → chip-ul „Owner" e ascuns automat
  (`{#if owners.length > 0}`); nu e nevoie de modificare în `FilterBar`.
- Link **Monitoring** (feature admin-only).
- Buton **bookmark** (era no-op și în admin).
- Import `toggleCampaignStatus`.

### Adaptat pentru client
- Sursă conturi: `getMyAdAccounts` în loc de `getReportAdAccounts`.
- Selector cont: fără sufix „— {clientName}" și fără marcajul ⚠ pe conturi (un singur client).
- Mesaje token/conexiune: în loc de „Reconectează din Settings → Meta Ads" (clientul n-are acces),
  text orientat client: „contactează administratorul pentru reconectare".
- Empty/eroare conturi: „Nu există cont Meta Ads asociat… contactează administratorul."
- Owner: `filters.owner` rămâne mereu gol; `passesFilters` nu-l aplică (fără clientName în selector).

## Data flow & SSR

- Aceeași orchestrare ca adminul: un `$effect` recreează `insightsQuery` / `prevInsightsQuery` /
  `campaignsQuery` / `platformQuery` / `demographicsQuery` la schimbarea `selectedAccountId` /
  `since` / `until`.
- `prevPeriod` derivat (durata perioadei curente proiectată înapoi).
- Expand adset/ad prin polling `setInterval(…,100)` pe `query.loading` — **identic cu pattern-ul
  existent** din ambele pagini (păstrat pentru risc minim; nu-l refactorizez în acest task).
- `onDestroy` curăță intervalele active + timer-ul de toast.
- **SSR:** deja dezactivat prin `client/[tenant]/+layout.ts` (`export const ssr = false`), moștenit de
  ruta de client. **Nu adaug** `+page.ts` — doar mă asigur că nu stric asta.

## Stări de eroare / gol (rk)
- `accountsLoading` → grid skeleton rk (`rk-kpi-grid` cu `rk-skel`).
- `accounts.length === 0` → card rk cu mesaj adaptat client.
- `insightsError` → alert rk cu mesaj adaptat client („contactează administratorul").
- Fără date / fără campanii după filtre → empty state rk (`rk-empty`).

## Testare & verificare
- `svelte-check` fără regresie față de baseline (16 err / 56 warn; rulează cu
  `NODE_OPTIONS=--max-old-space-size=8192`) — skill `build-check`.
- `svelte-autofixer` (Svelte MCP) pe fiecare componentă mutată + pe noul `+page.svelte`.
- Verificare manuală în portalul de client `/ots` (dev DB = Turso PROD, client real):
  - paritate vizuală cu adminul;
  - datele se încarcă (KPI, grafice, tabel, audience, platform split);
  - **zero controale de scriere** vizibile (fără On/Off, fără creion buget, fără bulk);
  - bannerele plată/token apar corect când e cazul, cu text de client.

## Out of scope
- Refactorul pattern-ului `setInterval` de expand (păstrat as-is în ambele pagini).
- Portarea rk pentru `google-ads` / `tiktok-ads` din portalul de client (task separat, dacă se dorește).
- Orice slăbire a guard-urilor de scriere din backend.

## Fișiere atinse (rezumat)
- **Mutate:** 13 fișiere `components/*` + `rk-report.css` → `$lib/components/reports/rk/`.
- **Modificate:** `[tenant]/reports/facebook-ads/+page.svelte` (importuri); `reports.remote.ts`
  (`getMyAdAccounts` — SELECT îmbogățit).
- **Rescris:** `client/[tenant]/(app)/reports/facebook-ads/+page.svelte`.
