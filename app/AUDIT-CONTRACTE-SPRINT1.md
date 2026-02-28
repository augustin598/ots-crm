# Audit Contracte — Sprint 1: Fixes Critice

**Data:** 2026-02-28
**Fisiere modificate:** 3
**Bug-uri rezolvate:** 10

---

## Rezumat Modificari

| Bug | Severitate | Descriere | Fix |
|-----|-----------|-----------|-----|
| BUG-003 | CRITIC | Cross-tenant client association | Validare `clientId` vs `tenantId` in `createContract` + upload |
| BUG-001 | HIGH | Lipsa validare tranzitii status | `CONTRACT_STATUSES` picklist + `VALID_STATUS_TRANSITIONS` map + `validateStatusTransition()` |
| BUG-002 | HIGH | Race condition numar contract | Helper `generateContractNumber()` mutat in tranzactie, refactorizat in 3 locuri |
| BUG-005 | MEDIUM | sendForSigning fara guard | Permite doar din `draft` sau `sent` |
| BUG-006 | MEDIUM | signAsPrestator fara guard | Permite doar din `draft` sau `sent` |
| BUG-007 | MEDIUM | Semnare beneficiar ne-tranzactionala | Token + contract update in `db.transaction()` |
| BUG-004 | MEDIUM | Delete ne-tranzactional | 3 DELETE-uri in `db.transaction()` |
| BUG-008 | MEDIUM | Lipsa limita upload | Max 10MB + validare magic bytes `%PDF` |
| BL-005 | MEDIUM | Token-uri multiple active | Revocare automata token-uri vechi la trimitere noua |
| SEC-005 | LOW | Semnatura prestator fara limita | Max 700KB (ca la beneficiar) |

---

## Fisiere Modificate

### 1. `app/src/lib/remotes/contracts.remote.ts`

**Adaugari noi (top-level):**
- Constanta `CONTRACT_STATUSES` — array readonly cu toate statusurile valide: `draft`, `sent`, `signed`, `active`, `expired`, `cancelled`
- Tipul `ContractStatus` derivat din array
- Harta `VALID_STATUS_TRANSITIONS` — defineste tranzitiile permise pentru fiecare status:
  - `draft` → `sent`, `cancelled`
  - `sent` → `signed`, `draft`, `cancelled`
  - `signed` → `active`, `cancelled`
  - `active` → `expired`, `cancelled`
  - `expired` → nimic
  - `cancelled` → nimic
- Functia `validateStatusTransition(currentStatus, newStatus)` — arunca eroare daca tranzitia nu e permisa
- Functia `generateContractNumber(txOrDb, tenantId, prefix)` — genereaza numarul de contract atomic in interiorul tranzactiei

**Modificari pe functii existente:**

| Functie | Ce s-a schimbat |
|---------|----------------|
| `createContract` | Validare `clientId` apartine tenant-ului; schema valibot `status` → `v.picklist(CONTRACT_STATUSES)`; generare numar contract mutata in `db.transaction()` cu helper reutilizabil; captura `tenantId`/`userId` inainte de tranzactie |
| `updateContract` | Schema valibot `status` → `v.picklist(CONTRACT_STATUSES)`; apel `validateStatusTransition()` daca statusul se schimba |
| `deleteContract` | Cele 3 DELETE-uri (sign tokens, line items, contract) invelite in `db.transaction()` |
| `duplicateContract` | Generare numar contract mutata in `db.transaction()` cu helper reutilizabil; captura `tenantId`/`userId` |
| `sendContractForSigning` | Guard: permite doar din `draft` sau `sent`; revoca automat token-urile existente nefolosite inainte de a crea unul nou |
| `signContractAsPrestator` | Guard: permite doar din `draft` sau `sent`; limita 700KB pe `signatureImage` |

### 2. `app/src/routes/[tenant]/contracts/upload/+server.ts`

| Schimbare | Detalii |
|-----------|---------|
| Import `and` | Adaugat la importul din drizzle-orm |
| Validare dimensiune fisier | `file.size > 10MB` → eroare 400 |
| Validare magic bytes PDF | Citeste primii 5 bytes, verifica `%PDF` |
| Validare `clientId` | Query `client` table, verifica `tenantId` match |
| Tranzactie atomica | Generare numar contract + insert invelite in `db.transaction()` |
| Captura variabile | `tenantId` si `userId` capturate inainte de tranzactie |

### 3. `app/src/routes/sign/[tenant]/[token]/+page.server.ts`

| Schimbare | Detalii |
|-----------|---------|
| Tranzactie atomica | Marcarea token-ului ca `used` + update contract invelite in `db.transaction()` — daca contract update esueaza, token-ul ramane valid (rollback) |

---

## Tranzitii de Status — State Machine

```
                    ┌──────────┐
                    │  draft   │
                    └────┬─────┘
                         │ sendContractForSigning()
                         ▼
                    ┌──────────┐
              ┌─────│   sent   │
              │     └────┬─────┘
              │          │ beneficiar semneaza (token)
              │          ▼
              │     ┌──────────┐
              │     │  signed  │
              │     └────┬─────┘
              │          │ (manual sau viitor: automat)
              │          ▼
              │     ┌──────────┐
              │     │  active  │
              │     └────┬─────┘
              │          │ (manual sau viitor: scheduler)
              │          ▼
              │     ┌──────────┐
              │     │ expired  │
              │     └──────────┘
              │
              │  (de oriunde, mai putin expired/cancelled)
              ▼
         ┌───────────┐
         │ cancelled  │
         └───────────┘
```

---

## Ce Ramane de Facut (Sprint 2 + 3)

### Sprint 2: Business Logic
- **BL-001:** Adauga `contractId` FK pe `invoice` si `recurringInvoice` — leaga contractele de facturi
- **BL-002:** Scheduler `contract_lifecycle` — tranzitii automate `signed→active`, `active→expired`, notificari expirare
- **BL-003:** Contract hooks/events — `contract.created`, `contract.signed`, `contract.status.changed`, `contract.expired`
- **CON-002:** Optimistic locking — coloana `version` pe contract, verificare la update

### Sprint 3: Polish
- **BUG-009:** Paginare `getContracts` (limit + offset)
- **BL-004:** Status upload inconsistent — uploaded contracts setate pe `signed` fara semnatura
- **BUG-012:** Eliminare `signingUrl` din DB (reconstruieste la runtime)
- **PDF-002:** Logging erori parse `clausesJson`
- **Audit Trail:** Tabela `contract_audit_log` (userId, timestamp, action, oldValues, newValues)

