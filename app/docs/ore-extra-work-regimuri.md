# Ore de extra work — regimuri tarifare (urgență / weekend / noapte)

Tabul „Tarife orare" de pe pagina publică `/servicii` vinde ore de extra work cu
cardul. Peste specializare (Development, Design UI/UX, PM, DevOps/API) există un
al doilea ax: **regimul de lucru**, cu multiplicator pe tariful de bază.

## Grila (EUR/h, fără TVA)

| Regim | Mult. | Development | Design UI/UX | PM | DevOps/API | Max ore/comandă |
|---|---|---|---|---|---|---|
| Standard (L–V 09–18, planificat) | ×1.00 | 65 | 70 | 55 | 80 | 100 |
| Urgență (start ≤48 h lucrătoare) | ×1.50 | 98 | 105 | 83 | 120 | 40 |
| Weekend & sărbători legale | ×1.70 | 111 | 119 | 94 | 136 | 24 |
| Noapte 20:00–08:00 | ×2.00 | 130 | 140 | 110 | 160 | 16 |

Tarifele efective se calculează din `tarif de bază × multiplicator`, rotunjite la
euro întreg. Rotunjirea urcă 65 și 55 cu ~50,8% la urgență (98, nu 97,5) — de
aceea UI-ul **nu** afișează badge „+50%", ci numele regimului și tariful efectiv.
Din 2026-09 tarifele de bază, multiplicatorii, plafoanele și textele SLA se
editează din **Settings → Tarife orare** (tabelele `hourly_rate` și
`hourly_rate_mode`, per tenant, citite prin `$lib/server/hourly-catalog.ts`).
`HOURLY_RATES` / `RATE_MODES` din `ots-catalog.ts` sunt doar seed-ul inserat la
prima citire a unui tenant.

Un test golden fixează cele 12 valori ale seed-ului (nu valorile curente din DB): orice schimbare de tarif de bază apare în
diff, nu direct pe factură.

**Anti-cumul:** se aplică un singur regim, cel mai mare. Weekend noaptea = ×2.00,
nu 1,7 × 2.

## Invariante

- Multiplicatorul și tariful vin din catalog **server-side**, niciodată din
  payload — aceeași politică ca tariful de bază.
- `service_hours_order.rate_eur` rămâne tariful **efectiv** (snapshot), deci
  `net/vat/gross`, emitentul Keez și panoul admin nu se schimbă structural.
  `base_rate_eur` + `mode_multiplier_pct` păstrează derivarea.
- `rate_label` include regimul („Development (Urgență 48h)") → linia de factură
  Keez și lista din admin se citesc corect fără modificări în emitter.
  Consecință asumată: până la 16 articole în nomenclatorul Keez, în loc de 4.
- `mode_sla_snapshot` îngheață textul angajamentului de la momentul plății —
  fără el, o dispută peste 6 luni nu se poate arbitra dacă am schimbat catalogul.
- La regim ≠ standard clientul alege **când** are nevoie de lucrare; fără momentul
  cerut, SLA-ul nu e nici dovedibil, nici contestabil.
- PF + regim ≠ standard: bifa de consimțământ conține mențiunea OUG 34/2014
  (începerea imediată = pierderea dreptului de retragere la 14 zile).
- Ordinea la deploy: migrări aplicate pe remote → coloane în `schema.ts` → deploy.
  Ambele citiri ale comenzii sunt `select().from(serviceHoursOrder)` (select-all):
  coloane în schema înainte de migrare = webhook picat la fiecare plată.

## Facturarea în Keez: unitatea de măsură

Orele se facturează **pe oră**, nu pe bucată — și linia, și *articolul* din
nomenclatorul Keez. Tabelul unităților trăiește într-un singur loc,
`src/lib/constants/keez-measure-units.ts` (`Ora` = 5, `Buc` = 1, `Zi` = 4,
`Luna om` = 2, `An` = 3), copiat din nomenclatorul oficial
https://app.keez.ro/help/api/data_measure_unit.html și fixat de
`src/lib/constants/__tests__/keez-measure-units.test.ts`. Keez nu expune un
endpoint care să-l listeze, deci lista e în cod — dar o singură dată, nu în
patru variante divergente ca înainte:

- `auto-push.ts` crea ORICE articol nou cu `measureUnitId: 1` (Buc), deși linia
  pleca pe „Ora" → în nomenclator apăreau bucăți acolo unde vindem ore;
- `hooks.ts` avea `Hours: 2` și `Days: 3`, adică „Luna om" și „An";
- `keez.remote.ts` avea același `measureUnitId: 1` hardcodat;
- skill-ul `keez-api` documenta tabelul greșit (`2: Hours, 3: Days`).

Articolul preia acum unitatea liniei (`keezMeasureUnitId(lineItem.unitOfMeasure)`),
iar denumirile CRM vin din `KEEZ_UNIT` (`Buc`/`Ora`/`Zi`/`Luna`), nu din string-uri
scrise de mână prin pagini („Pcs" și „Buc" coexistau pentru același lucru).

## Goluri asumate — de făcut mai târziu

1. **Nu există evidență a consumului de ore în CRM.** Nu putem dovedi tehnic că
   orele au fost lucrate noaptea sau în weekend; rămâne pe încredere și pe
   task-uri. Un modul de time tracking (pontaj pe task, cu regim) ar închide
   golul — nu-l construim acum.
2. **Downgrade-ul de regim după plată nu există.** Ar cere storno parțial în
   Keez (flux inexistent). Dacă nu putem onora regimul cumpărat, returnăm
   integral, nu retrogradăm la standard cu diferența înapoi.

## Flux comercial confirmat

Vânzare instant, pentru toate regimurile. La regim ≠ standard, OTS confirmă
disponibilitatea în maximum 4 h lucrătoare; dacă nu putem onora, returnăm
integral. Textul e explicit în modal, înainte de plată.
