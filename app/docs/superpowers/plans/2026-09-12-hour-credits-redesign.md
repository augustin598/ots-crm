# Plan: redesign „Bugete ore" + Settings → Tarife orare (high-fidelity)

Sursa de design: `design_handoff_hour_credits/` (README + prototipuri HTML/JSX).
Prototipurile sunt REFERINȚĂ, nu cod de portat. Recreăm în SvelteKit, cu remote
functions și convențiile din repo.

## Ce există deja (se refolosește, NU se rescrie)

| Există | Unde |
|---|---|
| Tarif × multiplicator, rotunjire la euro | `src/lib/logic/hours-pricing.ts` (`effectiveRateEur`) |
| Catalog tarife/regimuri/reguli, `formatMinutes`, slug-uri | `src/lib/logic/hourly-catalog.ts` |
| Ledger append-only + idempotență pe `(tenant, kind, source_type, source_id)` | `client_hour_ledger`, `src/lib/server/hour-credits.ts` |
| Creditare din factură plătită (BNR la data plății) | `creditPaidInvoice` |
| Creditare comandă de ore plătită | `creditPaidHoursOrder` |
| Facturi necreditate (interogare, nu tabel) | `listUncreditedInvoices` |
| Rezervat din taskuri deschise | `computeReservedMinutes` (`src/lib/server/task-credit.ts`) |
| Setări per tenant (specializări, regimuri, reguli) | `hourly_rate`, `hourly_rate_mode`, `hour_credit_settings` |
| `feed_from_invoices` per client | `client.hour_credit_from_invoices` |
| Comanda publică de ore | `service_hours_order`, `public-hours.remote.ts` |
| Ajustare manuală cu motiv obligatoriu | `adjustHourCredit` |

Numele din README (`hour_credit_ledger`, `hourly_rate_specializations`) diferă de
cele din repo. **Nu redenumim** — mapăm.

## Decizii luate cu userul (2026-09-12)

1. **Expirare: DA**, FIFO pe loturi. Fără retroactiv — doar alimentările noi
   primesc `expires_at`. Creditul existent rămâne fără termen.
2. **Modalul „Adaugă ore"**: fluxul e *adminul adaugă credit manual → se
   generează factura Keez → factura ajunge pe email la client cu link de plată*.
   NU Stripe checkout.
3. **Portalul clientului** intră în redesign (aceeași față).
4. **Dark mode**: light rămâne pixel-perfect ca în handoff; derivăm o variantă
   dark din aceiași tokeni (CRM-ul are toggle activ în sidebar).

## Faza A — backend

### A1. Migrări (fără `IF NOT EXISTS`, un statement per fișier)
- `client_hour_ledger.expires_at` (nullable) — lotul de credit expiră la data asta.
- `hour_credit_settings.credit_expiry_days` (integer, default 0 = fără expirare).
- `hour_credit_settings.feed_from_invoices_default` (boolean, default 0).

Înainte de generare: `grep` pe numele coloanelor în `drizzle/` și verificarea
`max(created_at)` din `__drizzle_migrations` pe remote (jurnalul `when` sub remote).

### A2. Logică pură de expirare — `src/lib/logic/hour-credit-expiry.ts`
FIFO pe loturi: alimentările cu `expires_at` formează loturi; consumul le
consumă în ordinea expirării celei mai apropiate. La data X, ce rămâne
neconsumat dintr-un lot expirat → un rând `expire` cu minus.
Funcții pure, testate izolat: `computeExpiringBatches`, `computeExpiredMinutes`.

### A3. Job zilnic
Scrie rânduri `kind: 'expire'` prin `applyLedgerEntry` (idempotent pe
`(tenant, 'expire', 'ledger', batchId)`). Rezervare anti-dublare ca la PageSpeed.

### A4. Payload-uri extinse
- overview: `cui`, `consumedLast30Minutes`, `lastMovementAt`, `expiring {minutes, on}`,
  `referenceRateSlug` per client (pentru meta rândului).
- comenzi de ore: listă din `service_hours_order` + status + factură.
- raport lunar: agregate pe specializare și pe săptămâni.
- fișa: taskurile care rezervă (din `task-credit`).

Toate agregate, fără N+1.

### A5. „Adaugă ore" cu facturare
`createHourCreditOrder`: validare (specializare activă, regim activ, plafon),
preț prin `effectiveRateEur` (fără duplicarea formulei) → `applyLedgerEntry`
(kind `manual`, motiv) → factură Keez → email cu linkul public de plată.
**Gardă anti-dublă-creditare**: factura emisă aici se exclude de la creditarea
automată la `invoice.paid` (creditul a intrat deja la emitere).

## Faza B — fundația de design

### B1. `src/lib/styles/hour-credits.css`
Tokenii din README ca variabile CSS (`--hc-bg`, `--hc-card`, `--hc-border`,
`--hc-accent`…), light ca valori de bază, dark redefinit sub `.dark .hc-scope`
(în `.css` simplu se scrie `.dark .x`, NU `:global(.dark)`).
Clasele `hc-` și `hr-` din handoff, 1:1.

### B2. Componente comune — `src/lib/components/hour-credits/`
`HcGauge` (4 segmente, hașuri), `HcLegend`, `HcChip`, `HcAvatar` (inițiale +
culoare deterministă din id), `HcKpi`, `HcSwitch`, `HcEmpty`.
Formatări în `hour-credits.ts` (logic): `formatHoursShort` („3,5 h"), semnul
minus tipografic `−` ca în design.

## Faza C — ecrane

- C1. `/[tenant]/hour-credits` — hero, KPI×4, taburi (Clienți / Comenzi ore /
  Facturi necreditate / Raport lunar), toolbar, rândul de client, Export CSV.
  „Widgets" NU e tab (README §5).
- C2. Drawer detaliu comandă (antet `#0b1220` — singurul fundal închis).
- C3. Modal „Adaugă ore" (checkout conform deciziei 2).
- C4. Fișa clientului — hero cu gauge `lg`, banner sub prag, 3 carduri
  (alimentare / ajustare / expirare), ledger + consum pe taskuri.
- C5. `/[tenant]/settings/hourly-rates` — specializări, regimuri, grila live,
  reguli, bara sticky de salvare.
- C6. Widgets: card Dashboard + card în fișa clientului.
- C7. Portalul clientului, aceeași față.

## Faza D — verificare

- Teste întâi pe logica pură (expirare FIFO, agregate, formatări) — `bun run test`.
- `svelte-autofixer` pe fiecare `.svelte` modificat.
- `/build-check` (baseline 16 err / 56 warn — fără regres).
- `design-auditor` + `web-design-guidelines` pe ecranele noi.
- testermcp pe golden path (listă → fișă → drawer → modal → settings).

## Riscuri

- **Dubla creditare** la fluxul A5 — tratată prin excludere explicită la `invoice.paid`;
  test dedicat.
- **Expirarea** era `în afara scopului` în specul din 2026-09-10 §12; se
  actualizează specul cu decizia de azi.
- Paleta fixă a designului vs. temele CRM — rezolvat prin tokeni + variantă dark.
