# Audit TVA — facturi intracomunitare fără mențiunea de taxare inversă

**Data raportului:** 2026-07-17
**Tenant:** ots

## Rezumat

- Facturi intracomunitare (client UE, non-RO): **66**
- Cu mențiunea legală în `notes`: **1**
- **Fără mențiune: 65**
- Valoare totală a celor fără mențiune: **77.972,49** (sumă brută, monede mixte — vezi coloana)

**Cota 0% este corectă** (taxare inversă, client UE — TVA se aplică doar clienților RO). Ce lipsește este **mențiunea legală** pe factură:

> Taxare inversă conform art. 278 alin. (2) Cod Fiscal — operațiune intracomunitară.

**Cauză:** calea de facturare manuală (`createInvoice`) nu clasifica clientul (`classifyClientVat`) și nu adăuga nota — spre deosebire de calea hosting/recurent, care o face corect. Reparat în cod pentru facturile viitoare.

## Pe client

| Client | Facturi fără mențiune |
|---|---|
| PUBBLILA DI RADULESCU ELENA LAVINIA (IT03446240925) | 32 |
| CDVA GLOBAL TECHNOLOGY LTD (CY10440695U) | 14 |
| Wow Agency (CY10399119V) | 10 |
| CDVA GLOBAL ADVERTISING LTD (CY10410196N) | 6 |
| MEITNERIUM LIMITED (CY60124923R) | 2 |
| GTS MEDIA LTD (CY60059200T) | 1 |

## Lista completă (de verificat cu contabilul)

| # | Nr. factură | Client | CUI | Data | Total | Status | Keez |
|---|---|---|---|---|---|---|---|
| 1 | OTS 547 | Wow Agency | CY10399119V | 2026-05-26 | 2.000,00 EUR | paid | sincronizată (synced) |
| 2 | OTS 539 | MEITNERIUM LIMITED | CY60124923R | 2026-04-02 | 800,00 EUR | paid | sincronizată (synced) |
| 3 | OTS 530 | Wow Agency | CY10399119V | 2026-02-22 | 2.000,00 EUR | paid | sincronizată (synced) |
| 4 | OTS 520 | Wow Agency | CY10399119V | 2026-01-11 | 1.000,00 EUR | paid | sincronizată (synced) |
| 5 | OTS 516 | Wow Agency | CY10399119V | 2025-12-28 | 2.000,00 EUR | paid | sincronizată (synced) |
| 6 | OTS 508 | CDVA GLOBAL TECHNOLOGY LTD | CY10440695U | 2025-11-14 | 141,57 EUR | paid | sincronizată (synced) |
| 7 | OTS 506 | Wow Agency | CY10399119V | 2025-11-09 | 2.000,00 EUR | paid | sincronizată (synced) |
| 8 | OTS 500 | CDVA GLOBAL TECHNOLOGY LTD | CY10440695U | 2025-10-13 | 117,00 EUR | paid | sincronizată (synced) |
| 9 | OTS 482 | Wow Agency | CY10399119V | 2025-08-27 | 2.000,00 EUR | paid | sincronizată (synced) |
| 10 | OTS 476 | Wow Agency | CY10399119V | 2025-06-29 | 1.000,00 EUR | paid | sincronizată (synced) |
| 11 | OTS 469 | Wow Agency | CY10399119V | 2025-05-30 | 1.000,00 EUR | paid | sincronizată (synced) |
| 12 | OTS 464 | Wow Agency | CY10399119V | 2025-04-23 | 1.000,00 EUR | paid | sincronizată (synced) |
| 13 | OTS 462 | MEITNERIUM LIMITED | CY60124923R | 2025-04-09 | 2.000,00 EUR | paid | sincronizată (synced) |
| 14 | OTS 457 | Wow Agency | CY10399119V | 2025-03-12 | 3.000,00 EUR | paid | sincronizată (synced) |
| 15 | OTS 446 | CDVA GLOBAL TECHNOLOGY LTD | CY10440695U | 2025-01-14 | 393,75 RON | paid | sincronizată (synced) |
| 16 | OTS 445 | CDVA GLOBAL TECHNOLOGY LTD | CY10440695U | 2024-12-29 | 1.400,00 EUR | paid | sincronizată (synced) |
| 17 | OTS 440 | GTS MEDIA LTD | CY60059200T | 2024-12-16 | 700,00 EUR | paid | sincronizată (synced) |
| 18 | OTS 434 | CDVA GLOBAL TECHNOLOGY LTD | CY10440695U | 2024-11-13 | 4.400,00 EUR | overdue | sincronizată (synced) |
| 19 | OTS 421 | CDVA GLOBAL TECHNOLOGY LTD | CY10440695U | 2024-09-22 | 2.800,00 EUR | paid | sincronizată (synced) |
| 20 | OTS 389 | CDVA GLOBAL TECHNOLOGY LTD | CY10440695U | 2024-05-19 | 2.800,00 EUR | paid | sincronizată (synced) |
| 21 | OTS 375 | CDVA GLOBAL TECHNOLOGY LTD | CY10440695U | 2024-04-10 | 2.800,00 EUR | paid | sincronizată (synced) |
| 22 | OTS 361 | CDVA GLOBAL TECHNOLOGY LTD | CY10440695U | 2024-02-11 | 2.400,00 EUR | paid | sincronizată (synced) |
| 23 | OTS 351 | CDVA GLOBAL TECHNOLOGY LTD | CY10440695U | 2023-12-27 | 2.000,00 EUR | paid | sincronizată (synced) |
| 24 | OTS 333 | CDVA GLOBAL TECHNOLOGY LTD | CY10440695U | 2023-10-29 | 2.000,00 EUR | paid | sincronizată (synced) |
| 25 | OTS 312 | CDVA GLOBAL TECHNOLOGY LTD | CY10440695U | 2023-08-09 | 900,00 EUR | paid | sincronizată (synced) |
| 26 | OTS 273 | PUBBLILA DI RADULESCU ELENA LAVINIA | IT03446240925 | 2023-04-04 | 90,00 EUR | paid | sincronizată (synced) |
| 27 | OTS 272 | CDVA GLOBAL TECHNOLOGY LTD | CY10440695U | 2023-03-26 | 1.400,00 EUR | paid | sincronizată (synced) |
| 28 | OTS 271 | PUBBLILA DI RADULESCU ELENA LAVINIA | IT03446240925 | 2023-03-20 | 90,00 EUR | paid | sincronizată (synced) |
| 29 | OTS 260 | CDVA GLOBAL TECHNOLOGY LTD | CY10440695U | 2023-02-14 | 1.400,00 EUR | paid | sincronizată (synced) |
| 30 | OTS 262 | PUBBLILA DI RADULESCU ELENA LAVINIA | IT03446240925 | 2023-02-14 | 90,00 EUR | paid | sincronizată (synced) |
| 31 | OTS 249 | PUBBLILA DI RADULESCU ELENA LAVINIA | IT03446240925 | 2023-01-11 | 90,00 EUR | paid | sincronizată (synced) |
| 32 | OTS 253 | CDVA GLOBAL ADVERTISING LTD | CY10410196N | 2023-01-11 | 1.400,00 EUR | paid | sincronizată (synced) |
| 33 | OTS 246 | CDVA GLOBAL ADVERTISING LTD | CY10410196N | 2022-12-13 | 2.400,00 EUR | paid | sincronizată (synced) |
| 34 | OTS 243 | PUBBLILA DI RADULESCU ELENA LAVINIA | IT03446240925 | 2022-12-05 | 90,00 EUR | paid | sincronizată (synced) |
| 35 | OTS 238 | PUBBLILA DI RADULESCU ELENA LAVINIA | IT03446240925 | 2022-11-13 | 60,00 EUR | paid | sincronizată (synced) |
| 36 | OTS 239 | CDVA GLOBAL ADVERTISING LTD | CY10410196N | 2022-11-13 | 1.900,00 EUR | paid | sincronizată (synced) |
| 37 | OTS 233 | CDVA GLOBAL ADVERTISING LTD | CY10410196N | 2022-10-17 | 11.846,40 RON | paid | sincronizată (synced) |
| 38 | OTS 228 | PUBBLILA DI RADULESCU ELENA LAVINIA | IT03446240925 | 2022-10-02 | 296,94 RON | paid | sincronizată (synced) |
| 39 | OTS 226 | CDVA GLOBAL ADVERTISING LTD | CY10410196N | 2022-09-11 | 4.404,24 RON | paid | sincronizată (synced) |
| 40 | OTS 222 | PUBBLILA DI RADULESCU ELENA LAVINIA | IT03446240925 | 2022-09-03 | 290,06 RON | paid | sincronizată (synced) |
| 41 | OTS 217 | CDVA GLOBAL ADVERTISING LTD | CY10410196N | 2022-08-11 | 4.418,10 RON | paid | sincronizată (synced) |
| 42 | OTS 215 | PUBBLILA DI RADULESCU ELENA LAVINIA | IT03446240925 | 2022-08-08 | 295,26 RON | paid | sincronizată (synced) |
| 43 | OTS 209 | PUBBLILA DI RADULESCU ELENA LAVINIA | IT03446240925 | 2022-07-06 | 296,72 RON | paid | sincronizată (synced) |
| 44 | OTS 202 | PUBBLILA DI RADULESCU ELENA LAVINIA | IT03446240925 | 2022-06-13 | 296,59 RON | paid | sincronizată (synced) |
| 45 | OTS 197 | PUBBLILA DI RADULESCU ELENA LAVINIA | IT03446240925 | 2022-05-12 | 296,88 RON | paid | sincronizată (synced) |
| 46 | OTS 192 | PUBBLILA DI RADULESCU ELENA LAVINIA | IT03446240925 | 2022-04-10 | 296,51 RON | paid | sincronizată (synced) |
| 47 | OTS 184 | PUBBLILA DI RADULESCU ELENA LAVINIA | IT03446240925 | 2022-03-06 | 296,95 RON | paid | sincronizată (synced) |
| 48 | OTS 180 | PUBBLILA DI RADULESCU ELENA LAVINIA | IT03446240925 | 2022-02-06 | 296,77 RON | paid | sincronizată (synced) |
| 49 | OTS 175 | PUBBLILA DI RADULESCU ELENA LAVINIA | IT03446240925 | 2022-01-02 | 296,89 RON | paid | sincronizată (synced) |
| 50 | OTS 171 | PUBBLILA DI RADULESCU ELENA LAVINIA | IT03446240925 | 2021-12-06 | 296,90 RON | paid | sincronizată (synced) |
| 51 | OTS 166 | PUBBLILA DI RADULESCU ELENA LAVINIA | IT03446240925 | 2021-11-02 | 296,92 RON | paid | sincronizată (synced) |
| 52 | OTS 161 | PUBBLILA DI RADULESCU ELENA LAVINIA | IT03446240925 | 2021-10-05 | 247,43 RON | paid | sincronizată (synced) |
| 53 | OTS 157 | PUBBLILA DI RADULESCU ELENA LAVINIA | IT03446240925 | 2021-08-31 | 246,74 RON | paid | sincronizată (synced) |
| 54 | OTS 148 | PUBBLILA DI RADULESCU ELENA LAVINIA | IT03446240925 | 2021-06-30 | 246,34 RON | paid | sincronizată (synced) |
| 55 | OTS 140 | PUBBLILA DI RADULESCU ELENA LAVINIA | IT03446240925 | 2021-05-24 | 246,31 RON | paid | sincronizată (synced) |
| 56 | OTS 136 | PUBBLILA DI RADULESCU ELENA LAVINIA | IT03446240925 | 2021-04-18 | 246,22 RON | paid | sincronizată (synced) |
| 57 | OTS 132 | PUBBLILA DI RADULESCU ELENA LAVINIA | IT03446240925 | 2021-03-30 | 50,00 EUR | paid | sincronizată (synced) |
| 58 | OTS 127 | PUBBLILA DI RADULESCU ELENA LAVINIA | IT03446240925 | 2021-02-28 | 50,00 EUR | paid | sincronizată (synced) |
| 59 | OTS 122 | PUBBLILA DI RADULESCU ELENA LAVINIA | IT03446240925 | 2021-01-31 | 50,00 EUR | paid | sincronizată (synced) |
| 60 | OTS 115 | PUBBLILA DI RADULESCU ELENA LAVINIA | IT03446240925 | 2020-12-28 | 50,00 EUR | paid | sincronizată (synced) |
| 61 | OTS 107 | PUBBLILA DI RADULESCU ELENA LAVINIA | IT03446240925 | 2020-12-01 | 150,00 EUR | paid | sincronizată (synced) |
| 62 | OTS 96 | PUBBLILA DI RADULESCU ELENA LAVINIA | IT03446240925 | 2020-10-28 | 50,00 EUR | paid | sincronizată (synced) |
| 63 | OTS 91 | PUBBLILA DI RADULESCU ELENA LAVINIA | IT03446240925 | 2020-10-05 | 50,00 EUR | paid | sincronizată (synced) |
| 64 | OTS 73 | PUBBLILA DI RADULESCU ELENA LAVINIA | IT03446240925 | 2020-08-23 | 55,00 EUR | paid | sincronizată (synced) |
| 65 | OTS 66 | PUBBLILA DI RADULESCU ELENA LAVINIA | IT03446240925 | 2020-07-23 | 350,00 EUR | paid | sincronizată (synced) |

## De întrebat contabilul

1. Aceste operațiuni sunt declarate corect în **D390** (declarația recapitulativă)? Lipsa mențiunii de pe factură afectează declarația?
2. Este nevoie de **facturi corectate / storno + reemitere**, sau mențiunea lipsă se poate remedia printr-o notă explicativă?
3. Facturile marcate „sincronizată" există și în **Keez** — dacă se corectează, trebuie corectate și acolo (storno în Keez, nu doar în CRM).
4. Există un termen/prescripție care face ca facturile vechi (2024–2025) să nu mai necesite corecție?
