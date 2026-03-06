# Audit Contracte — Sprint 2 (2026-03-06)

## Sumar

15 buguri și inconsistențe fixate în modulul de contracte, incluzând securitate, integritate date, UX și calitatea codului.

---

## Fix 1: sortOrder în endpoint-urile PDF

**Severitate**: Critic
**Fișiere**: `src/routes/[tenant]/contracts/[contractId]/pdf/+server.ts`, `src/routes/sign/[tenant]/[token]/pdf/+server.ts`

**Problemă**: Line items-urile din PDF-ul contractului erau sortate după `id` (ordine de inserare), nu după `sortOrder` (ordinea definită de utilizator).

**Fix**: Înlocuit `.orderBy(asc(table.contractLineItem.id))` → `.orderBy(asc(table.contractLineItem.sortOrder))` în ambele endpoint-uri PDF.

---

## Fix 2: Status upload contract

**Severitate**: Critic
**Fișier**: `src/routes/[tenant]/contracts/upload/+server.ts`

**Problemă**: Contractele uploadate primeau automat `status: 'signed'`, chiar dacă nu erau semnate.

**Fix**: Schimbat `status: 'signed'` → `status: 'draft'`.

---

## Fix 3: Auto-tranziție status la semnare

**Severitate**: Critic
**Fișiere**: `src/lib/remotes/contracts.remote.ts`, `src/routes/sign/[tenant]/[token]/+page.server.ts`

**Problemă**: Statusul contractului nu se actualiza automat la `signed` când ambele părți (prestator + beneficiar) semnau. Semnarea beneficiarului seta necondiționat statusul la `signed` chiar dacă prestatorul nu semnase.

**Fix**:
- `signContractAsPrestator`: verifică `contract.beneficiarSignedAt` și face tranziția la `signed` dacă ambele părți au semnat
- Semnare beneficiar: `const newStatus = contract.prestatorSignedAt ? 'signed' : contract.status` — tranziție la `signed` DOAR când prestatorul a semnat deja

---

## Fix 4: Cascade delete pe contractSignToken

**Severitate**: Mediu
**Fișier**: `src/lib/server/db/schema.ts`

**Problemă**: Ștergerea unui contract nu șterge automat token-urile de semnare asociate (FK fără `onDelete`).

**Fix**: Adăugat `{ onDelete: 'cascade' }` pe `contractSignToken.contractId` referința FK.

---

## Fix 5: Utilități partajate (contract-utils.ts)

**Severitate**: Mediu (cod duplicat)
**Fișier NOU**: `src/lib/utils/contract-utils.ts`

**Problemă**: 4 pagini aveau funcții identice duplicate: `getStatusLabel`, `getStatusVariant`, `getStatusClass`, `formatDate`, `formatPrice`, etc.

**Fix**: Creat `contract-utils.ts` cu:
- `getContractStatusLabel(status)` — label românesc pentru status
- `getContractStatusVariant(status)` — variant Badge (cu `BadgeVariant` type)
- `getContractStatusClass(status)` — clase CSS pentru status
- `formatContractDate(date)` — formatare dată ISO → `dd.mm.yyyy`
- `formatContractPrice(cents)` — formatare preț din cenți
- `getBillingFrequencyLabel(freq)` — label frecvență facturare
- `isContractEditable(status)` — verifică dacă contractul poate fi editat
- `toCents(value)` — conversie preț cu protecție floating-point

Importat în toate cele 4 pagini, funcțiile locale șterse.

---

## Fix 6: Validare range pe câmpuri numerice

**Severitate**: Mediu
**Fișier**: `src/lib/remotes/contracts.remote.ts`

**Problemă**: `penaltyRate`, `discountPercent`, `contractDurationMonths`, `paymentTermsDays` acceptau orice valoare numerică (inclusiv negative sau absurd de mari).

**Fix**: Adăugat validare Valibot pe ambele scheme (create + update):
- `paymentTermsDays`: 0–365 (integer)
- `penaltyRate`: 0–10000 (bps)
- `contractDurationMonths`: 1–600 (integer)
- `discountPercent`: 0–100

---

## Fix 7: alert() → toast în pagina client

**Severitate**: Mediu (UX)
**Fișier**: `src/routes/client/[tenant]/(app)/contracts/+page.svelte`

**Problemă**: Erorile de descărcare foloseau `alert()` nativ (blocare UI, look inconsistent).

**Fix**: Înlocuit cu `toast.error()` din `svelte-sonner`.

---

## Fix 8: Floating-point la calculul prețului

**Severitate**: Mediu
**Fișiere**: `src/routes/[tenant]/contracts/new/+page.svelte`, `src/routes/[tenant]/contracts/[contractId]/edit/+page.svelte`

**Problemă**: `item.price * 100` putea produce valori floating-point inexacte (ex: `19.99 * 100 = 1998.9999999999998`).

**Fix**: `Math.round((item.price + Number.EPSILON) * 100)` — protecție standard IEEE 754.

---

## Fix 9: Logging condiționat la extragerea contractelor

**Severitate**: Scăzut
**Fișier**: `src/lib/remotes/contracts.remote.ts`

**Problemă**: `console.log` pentru debug extraction rula mereu în producție.

**Fix**: Adăugat `const DEBUG_EXTRACTION = () => env.DEBUG_CONTRACT_EXTRACTION === 'true'` și wrapat toate cele 3 blocuri de logging cu `if (DEBUG_EXTRACTION())`.

---

## Fix 10: Reset template la deselectare

**Severitate**: Scăzut
**Fișier**: `src/routes/[tenant]/contracts/new/+page.svelte`

**Problemă**: Deselectarea unui template din dropdown nu reseta clauzele la valorile implicite.

**Fix**: Adăugat `else` branch pe `$effect` care resetează toate câmpurile de clauze la defaults.

---

## Fix 11: Eroare extragere cu toast

**Severitate**: Scăzut
**Fișier**: `src/routes/[tenant]/contracts/+page.svelte`

**Problemă**: Erorile la extragerea datelor din contracte uploadate erau silențioase.

**Fix**: Adăugat `toast.warning('Nu am putut extrage automat datele din PDF...')` în catch block.

---

## Fix 12: confirm() → Dialog component

**Severitate**: Mediu (UX)
**Fișiere**: `src/routes/[tenant]/contracts/+page.svelte`, `src/routes/[tenant]/contracts/[contractId]/+page.svelte`

**Problemă**: Confirmarea ștergerii folosea `confirm()` nativ (blocare UI, nu se poate stiliza).

**Fix**: Implementat Dialog component cu state management (`showDeleteDialog`, `deleteTargetId`, `deleting`) și butoane stilizate.

---

## Fix 13: Edit guards (UI + server-side)

**Severitate**: Mediu (securitate)
**Fișiere**: `src/lib/remotes/contracts.remote.ts`, `src/routes/[tenant]/contracts/[contractId]/+page.svelte`

**Problemă**: Contractele semnate/active/expirate/anulate puteau fi editate (butonul vizibil + server accepta request-ul).

**Fix**:
- **Server**: `updateContract` aruncă eroare dacă `status !== 'draft' && status !== 'sent'`
- **UI**: Butonul "Editează" ascuns pe pagina de detalii când contractul nu e editabil (verificare cu `isContractEditable()`)

---

## Fix 14: Eliminare `as any` type coercions

**Severitate**: Scăzut (calitate cod)
**Fișier**: `src/lib/remotes/contracts.remote.ts`

**Problemă**: `getContracts` folosea `as any` pe condițiile WHERE pentru a ocoli tipizarea Drizzle.

**Fix**: Înlocuit cu pattern `whereConditions: SQL[]` + `and(...whereConditions)` — type-safe fără `as any`.

---

## Fix 15: Unique constraint pe contractNumber per tenant

**Severitate**: Mediu (integritate date)
**Fișiere**: `src/lib/server/db/schema.ts`, `drizzle/0067_contract_audit_fixes.sql`

**Problemă**: Nimic nu previne duplicate de `contractNumber` pentru același tenant.

**Fix**: Adăugat unique index `idx_contract_number_tenant` pe `(contract_number, tenant_id)` în schema + migration.

---

## Fișiere modificate

| Fișier | Tip |
|--------|-----|
| `src/lib/utils/contract-utils.ts` | NOU |
| `drizzle/0067_contract_audit_fixes.sql` | NOU |
| `src/lib/remotes/contracts.remote.ts` | Modificat |
| `src/lib/server/db/schema.ts` | Modificat |
| `src/routes/[tenant]/contracts/+page.svelte` | Modificat |
| `src/routes/[tenant]/contracts/[contractId]/+page.svelte` | Modificat |
| `src/routes/[tenant]/contracts/new/+page.svelte` | Modificat |
| `src/routes/[tenant]/contracts/[contractId]/edit/+page.svelte` | Modificat |
| `src/routes/[tenant]/contracts/[contractId]/pdf/+server.ts` | Modificat |
| `src/routes/[tenant]/contracts/upload/+server.ts` | Modificat |
| `src/routes/sign/[tenant]/[token]/+page.server.ts` | Modificat |
| `src/routes/sign/[tenant]/[token]/pdf/+server.ts` | Modificat |
| `src/routes/client/[tenant]/(app)/contracts/+page.svelte` | Modificat |

## TODO Sprint 3

- Paginare server-side pe `getContracts`
- Audit trail table (istoric modificări)
- Optimistic locking (versioning pe update)
- contractId FK pe invoice/recurringInvoice
- Lifecycle scheduler (auto-expire, auto-activate)
