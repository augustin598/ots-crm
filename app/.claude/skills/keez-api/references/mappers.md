# Keez Data Mapping Guide

When mapping CRM data to Keez, follow these conventions established in the project.

## Date Formatting
Keez API requires dates as integers in `YYYYMMDD` format.
- Example: `2026-04-24` -> `20260424`

## County Mapping (Romania)
Romanian counties must be mapped to ISO codes (e.g., `RO-SV` for Suceava).
Refer to `src/lib/server/plugins/keez/mapper.ts` for the full mapping table.

## Measure Units
NU le scrie de mână — folosește `keezMeasureUnitId()` / `keezMeasureUnitName()` din
`src/lib/constants/keez-measure-units.ts`, singurul tabel din proiect (fixat de
`src/lib/constants/__tests__/keez-measure-units.test.ts` contra documentației
oficiale: https://app.keez.ro/help/api/data_measure_unit.html).

Valorile uzuale: `1` Buc, `2` Luna om, `3` An, `4` Zi, `5` Ora, `13` Luna.

Versiunea anterioară a acestui document spunea `2: Hours` și `3: Days` — greșit:
2 e „Luna om", 3 e „An". Din cauza asta articolele de extra work plecau în Keez
cu unitate de bucată sau de lună-om, în loc de oră.

## Totals Calculation
Keez requires both RON totals and original currency totals if different.
- `netAmount`: Total net in RON.
- `vatAmount`: Total VAT in RON.
- `grossAmount`: Total gross in RON.
- `netAmountCurrency`: Total net in invoice currency.
- `vatAmountCurrency`: Total VAT in invoice currency.
- `grossAmountCurrency`: Total gross in invoice currency.

## Partner Identification
- Use `identificationNumber` for the Fiscal Code (CUI/CIF).
- Include `taxAttribute` (e.g., "RO") separately.
- Set `isLegalPerson` to `true` for companies.

## Implementation Details
For the exact mapping logic between `Invoice` (DB) and `KeezInvoice` (API), refer to:
- `src/lib/server/plugins/keez/mapper.ts`
- `src/lib/server/plugins/keez/client.ts`
