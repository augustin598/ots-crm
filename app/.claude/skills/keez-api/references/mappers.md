# Keez Data Mapping Guide

When mapping CRM data to Keez, follow these conventions established in the project.

## Date Formatting
Keez API requires dates as integers in `YYYYMMDD` format.
- Example: `2026-04-24` -> `20260424`

## County Mapping (Romania)
Romanian counties must be mapped to ISO codes (e.g., `RO-SV` for Suceava).
Refer to `src/lib/server/plugins/keez/mapper.ts` for the full mapping table.

## Measure Units
- `1`: Buc / Pcs
- `2`: Hours
- `3`: Days

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
