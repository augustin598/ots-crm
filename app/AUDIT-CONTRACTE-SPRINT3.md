# AUDIT CONTRACTE — Sprint 3

**Data:** 2026-03-25
**Scope:** Audit complet și debug al paginii `/contracts` + funcționalități conexe

---

## Rezumat

14 probleme identificate și rezolvate:
- **2 critice** (bug calcul prețuri, leak date sensibile în logs)
- **4 ridicate** (securitate delete, race conditions semnare, re-semnare)
- **4 medii** (unauthorized silențios, reactivitate, UX portal client)
- **4 scăzute** (performanță, audit trail, cascade)

---

## Fix-uri aplicate

### 1. BUG CRITIC — `toCents()` rotunjire incorectă

**Fișier:** `src/lib/utils/contract-utils.ts:82-84`

**Problema:** Formula `Math.round((value * 100 + Number.EPSILON) * 100) / 100` rotunjea la 2 zecimale în loc de întreg. Exemplu: `toCents(1.005)` returna `100.5` în loc de `101`. Toate prețurile contractelor erau potențial incorecte.

**Înainte:**
```ts
export function toCents(value: number): number {
    return Math.round((value * 100 + Number.EPSILON) * 100) / 100;
}
```

**După:**
```ts
export function toCents(value: number): number {
    return Math.round(value * 100);
}
```

---

### 2. SECURITATE CRITICĂ — Debug logs cu date sensibile mereu active

**Fișier:** `src/lib/remotes/contracts.remote.ts:1061-1063`

**Problema:** Funcția `extractClientFromContract` emitea `console.log` cu JSON complet (CUI, IBAN, adrese, email-uri) **mereu**, nu doar când `DEBUG_CONTRACT_EXTRACTION=true`. Datele sensibile ale clienților erau expuse în server logs în producție.

**Înainte:**
```ts
step('RESULT: client updated', { updated: fieldsToUpdate, skipped });
console.log('\n========== extractClientFromContract DEBUG ==========');
console.log(JSON.stringify(debug, null, 2));
console.log('=====================================================\n');
```

**După:**
```ts
step('RESULT: client updated', { updated: fieldsToUpdate, skipped });
if (DEBUG_EXTRACTION()) {
    console.log('\n========== extractClientFromContract DEBUG ==========');
    console.log(JSON.stringify(debug, null, 2));
    console.log('=====================================================\n');
}
```

---

### 3. SECURITATE — Delete contract fără validare status

**Fișier:** `src/lib/remotes/contracts.remote.ts` (funcția `deleteContract`)

**Problema:** Un utilizator putea șterge contracte cu status `signed` sau `active` — contracte deja semnate legal sau în desfășurare. Nicio validare de status.

**Fix:** Adăugat verificare înainte de ștergere:
```ts
if (existing.status === 'signed' || existing.status === 'active') {
    throw new Error(`Nu se poate șterge un contract cu statusul "${existing.status}". Doar contractele în starea "draft", "sent", "expired" sau "cancelled" pot fi șterse.`);
}
```

---

### 4. BUG — `version` nu era incrementat la semnare/trimitere (race condition)

**Fișier:** `src/lib/remotes/contracts.remote.ts` (funcțiile `signContractAsPrestator`, `sendContractForSigning`)

**Problema:** Semnarea ca prestator și trimiterea pentru semnare făceau `UPDATE` pe contract fără a incrementa câmpul `version`. Optimistic locking-ul devenea ineficient — editări concurente puteau suprascrie date.

**Fix `signContractAsPrestator`:** Unificat cele 2 update-uri separate într-unul singur + incrementat version:
```ts
const newStatus = contract.beneficiarSignedAt ? 'signed' : undefined;

await db.update(table.contract).set({
    prestatorSignatureName: signatureName,
    prestatorSignatureImage: imageToSave,
    prestatorSignedAt: now,
    ...(newStatus ? { status: newStatus } : {}),
    version: contract.version + 1,
    updatedAt: now
}).where(eq(table.contract.id, contractId));
```

**Fix `sendContractForSigning`:**
```ts
.set({ status: 'sent', version: contract.version + 1, updatedAt: new Date() })
```

---

### 5. BUG — Beneficiar putea fi re-semnat (suprascrierea semnăturii)

**Fișier:** `src/routes/sign/[tenant]/[token]/+page.server.ts`

**Problema:** Dacă un nou token de semnare era generat pentru un contract deja semnat de beneficiar, semnătura existentă era suprascrisă fără verificare.

**Fix:** Adăugat check înainte de procesarea semnăturii:
```ts
if (contract.beneficiarSignedAt) {
    return fail(400, { error: 'Contractul a fost deja semnat de beneficiar' });
}
```

---

### 6. SECURITATE — `extractClientFromContract` returna succes la unauthorized

**Fișier:** `src/lib/remotes/contracts.remote.ts`

**Problema:** Când user-ul nu era autentificat, funcția returna un obiect gol valid (`{ clientUpdated: false, extracted: {} }`) în loc să arunce eroare. Un atacator neautentificat primea response 200 OK.

**Înainte:**
```ts
if (!event?.locals.user || !event?.locals.tenant) {
    return emptyResult('Unauthorized - no user or tenant');
}
```

**După:**
```ts
if (!event?.locals.user || !event?.locals.tenant) {
    throw new Error('Unauthorized');
}
```

---

### 7. BUG — `contractQuery` nu era reactiv la schimbarea ID-ului

**Fișier:** `src/routes/[tenant]/contracts/[contractId]/+page.svelte:70`

**Problema:** `const contractQuery = getContract(contractId)` se evalua o singură dată la mount. La navigare client-side între contracte diferite, query-ul nu se re-executa — se vedea contractul vechi.

**Înainte:**
```ts
const contractQuery = getContract(contractId);
```

**După:**
```ts
const contractQuery = $derived(getContract(contractId));
```

---

### 8. BUG — `contractNumber` manual ignorat la crearea contractului

**Fișiere:**
- `src/lib/remotes/contracts.remote.ts` (schema + logica `createContract`)
- `src/routes/[tenant]/contracts/new/+page.svelte`

**Problema:** Formularul avea un câmp pentru nr. contract manual, dar valoarea nu era trimisă în apelul `createContract`. Era mereu auto-generat.

**Fix:**
1. Adăugat `contractNumber: v.optional(v.string())` în schema valibot
2. Folosit `data.contractNumber?.trim() || await generateContractNumber(...)` în logica de creare
3. Adăugat `contractNumber: contractNumber || undefined` în apelul din `new/+page.svelte`

---

### 9. PERFORMANȚĂ — `getContracts` aducea toate coloanele pentru lista

**Fișier:** `src/lib/remotes/contracts.remote.ts`

**Problema:** `select()` fără specificare de coloane aducea **toate** câmpurile, inclusiv `clausesJson` (23 secțiuni de clauze legale), `prestatorSignatureImage`, `beneficiarSignatureImage` (base64 PNG-uri mari). Pentru lista de contracte, doar ~10 câmpuri sunt necesare.

**Fix:** Specificat explicit coloanele necesare:
```ts
const contracts = await db.select({
    id: table.contract.id,
    tenantId: table.contract.tenantId,
    clientId: table.contract.clientId,
    contractNumber: table.contract.contractNumber,
    contractDate: table.contract.contractDate,
    contractTitle: table.contract.contractTitle,
    status: table.contract.status,
    currency: table.contract.currency,
    contractDurationMonths: table.contract.contractDurationMonths,
    uploadedFilePath: table.contract.uploadedFilePath
}).from(table.contract)...
```

---

### 10. UX — Portalul client afișa statusuri în engleză

**Fișier:** `src/routes/client/[tenant]/(app)/contracts/+page.svelte`

**Problema:** Coloana Status din tabelul de contracte al portalului client afișa valorile raw (`draft`, `sent`, `signed`) în loc de traducerile în română (`Ciornă`, `Trimis`, `Semnat`).

**Fix:**
1. Importat `getContractStatusLabel` din `contract-utils`
2. Înlocuit `{contract.status}` cu `{getContractStatusLabel(contract.status)}`
3. Eliminat `capitalize` din clasele CSS (nu mai e necesar)

---

### 11. PERFORMANȚĂ — Load SSR redundant pe pagina de listă

**Fișier:** `src/routes/[tenant]/contracts/+page.server.ts`

**Problema:** Load function-ul SSR apela `getContracts({})` + query clienți, dar componenta `+page.svelte` nu folosea `data` — făcea propriile apeluri client-side via `getContracts(...)` și `getClients()`. Dublu fetch la fiecare încărcare de pagină.

**Fix:** Simplificat load function-ul la un return gol:
```ts
export const load: PageServerLoad = async () => {
    // Data is fetched client-side via remotes (getContracts, getClients)
    return {};
};
```

---

### 12. PERFORMANȚĂ — Lifecycle scheduler full table scan

**Fișier:** `src/lib/server/scheduler/tasks/contract-lifecycle.ts`

**Problema:**
1. Auto-expire aducea **toate** contractele active din toate tenant-urile, apoi filtra în JS
2. `select()` aducea toate coloanele (inclusiv signature images, clauses)

**Fix:**
1. Filtrare expirare mutată în SQL: `date(contract_date, '+' || duration_months || ' months') <= date('now')`
2. Select cu doar coloanele necesare: `id, tenantId, version, contractDate, contractDurationMonths`

---

### 13. CALITATE — Upload handler fără audit trail

**Fișier:** `src/routes/[tenant]/contracts/upload/+server.ts`

**Problema:** Contractele create prin upload PDF nu aveau înregistrare în audit trail. `createContract` command avea audit, dar upload-ul direct nu.

**Fix:** Adăugat `recordContractActivity` după inserarea contractului:
```ts
await recordContractActivity({
    contractId,
    userId,
    tenantId,
    action: 'created',
    field: 'uploadedFilePath',
    newValue: uploadResult.path
});
```

---

### 14. CALITATE — `contractActivity` orphan records la ștergere

**Fișier:** `src/lib/remotes/contracts.remote.ts` (funcția `deleteContract`)

**Problema:** Schema are `onDelete: 'cascade'` pe `contractActivity`, dar SQLite nu activează cascade implicit fără `PRAGMA foreign_keys = ON`. La ștergerea unui contract, activitățile rămâneau orphan.

**Fix:** Adăugat delete explicit în tranzacție:
```ts
await tx.delete(table.contractActivity)
    .where(eq(table.contractActivity.contractId, contractId));
```

---

## Fișiere modificate

| Fișier | Fix-uri |
|--------|---------|
| `src/lib/utils/contract-utils.ts` | #1 |
| `src/lib/remotes/contracts.remote.ts` | #2, #3, #4, #6, #8, #9, #14 |
| `src/routes/sign/[tenant]/[token]/+page.server.ts` | #5 |
| `src/routes/[tenant]/contracts/[contractId]/+page.svelte` | #7 |
| `src/routes/[tenant]/contracts/new/+page.svelte` | #8 |
| `src/routes/client/[tenant]/(app)/contracts/+page.svelte` | #10 |
| `src/routes/[tenant]/contracts/+page.server.ts` | #11 |
| `src/lib/server/scheduler/tasks/contract-lifecycle.ts` | #12 |
| `src/routes/[tenant]/contracts/upload/+server.ts` | #13 |

---

## Verificare

`svelte-check` — 0 erori noi introduse de aceste modificări. Erorile raportate (222) sunt pre-existente în alte module (tasks, login, sign page).
