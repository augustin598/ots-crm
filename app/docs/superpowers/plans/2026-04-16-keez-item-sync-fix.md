# Keez Item Sync Fix — OTS 540 Bug

**Data:** 2026-04-16
**Status:** DONE

## Problema

Factura recurentă "Digital Marketing" (keezItemExternalId=`2e086ed8...`, cod Keez `00000109`) genera facturi în care articolul apărea ca "#1 - Realizare Film Documentar" (externalId=`04c73804...`, cod Keez `00000002`).

### Cauza root

1. **Keez ignoră `itemName` când `itemExternalId` e prezent** — folosește numele din nomenclatorul propriu
2. **Keez returna alt `itemExternalId`** decât cel trimis (posibil match intern după preț/categorie)
3. **Hook-ul `onInvoiceCreated`** re-fetch-uia factura din Keez și **suprascria toate line items-urile CRM** cu datele Keez (delete + insert), înlocuind descrierea, nota și keezItemExternalId

### Flow-ul bugat (vechi)

```
CRM line item: description="Digital Marketing", keezItemExternalId="2e086ed8..."
  ↓ PUSH la Keez (itemExternalId="2e086ed8...", itemName="Digital Marketing")
  ↓ Keez ignoră itemName, folosește nomenclator → articol "Digital Marketing" creat corect
  ↓ Re-fetch din Keez → Keez returnează itemExternalId="04c73804..." (#1 - Realizare Film Documentar)
  ↓ Hook: DELETE all CRM line items + INSERT din Keez data
  ↓ CRM line item: description="#1 - Realizare Film Documentar", keezItemExternalId="04c73804..."
  ✗ WRONG
```

## Fix-uri aplicate

### 1. hooks.ts — Refactorizare completă secțiune post-push

**Înainte:** Delete + insert line items din Keez response
**Acum:**
- **Idempotency guard** — early return dacă `invoice.keezExternalId` există (previne duplicate Keez invoices)
- **Transaction wrapping** — invoice header + per-item financial amounts într-o singură tranzacție DB
- **Match by keezItemExternalId** — nu pe index; fallback pe index doar dacă counts sunt egale
- **Preserve CRM fields** — description, note, keezItemExternalId NU se suprascriu
- **Sync financial fields** — rate, amount, taxRate SE actualizează din Keez (rounding consistency)
- **Fallback** — dacă tranzacția eșuează, update header-only
- **Logging** — warning la name mismatch cu valori concrete

### 2. mapper.ts — Documentare comportament Keez

Comentariu la `mapInvoiceToKeez`: Keez ignoră `itemName` când `itemExternalId` e setat.

### 3. DB fix OTS 540

```sql
UPDATE invoice_line_item
SET description = 'Digital Marketing',
    note = 'NR 10 din 28.10.2025',
    keez_item_external_id = '2e086ed8c58aa9cda78a651e124ee134'
WHERE id = 'ging5y2vpsdhyoz2jvlrklaw';
```

## Comportament Keez API — documentat

| Aspect | Comportament |
|---|---|
| `itemExternalId` + `itemName` trimise | Keez ignoră `itemName`, folosește `name` din nomenclator |
| `itemExternalId` în response | Poate diferi de cel trimis (Keez face mapping intern) |
| `itemDescription` | Apare ca "Notă Articol" în Keez — funcționează corect |
| Articol inexistent | Keez creează articol nou cu propriul externalId |

## Articole Keez relevante

| Cod | externalId | Denumire |
|---|---|---|
| `00000002` | `04c73804ad33d48ee879889047d99d43` | #1 - Realizare Film Documentar |
| `00000109` | `2e086ed8c58aa9cda78a651e124ee134` | Digital Marketing |

## Fișiere modificate

- `app/src/lib/server/plugins/keez/hooks.ts` — fix principal
- `app/src/lib/server/plugins/keez/mapper.ts` — documentare

## Principii de design (PUSH vs PULL)

| Direcție | CRM e sursa de adevăr pentru | Keez e sursa de adevăr pentru |
|---|---|---|
| **PUSH** (CRM → Keez) | description, note, keezItemExternalId | rate, amount, taxRate, invoice totals |
| **PULL** (Keez → CRM) | — | totul (import extern) |

## Review-uri efectuate

- **Gemini audit** — confirmat comportament Keez API, identificat race condition pe index matching
- **Code reviewer #1** — idempotency guard, per-item financial sync, unused import
- **Code reviewer #2** — transaction wrapping, order-safe matching, onInvoiceUpdated gap
- **api-integrations skill** — checklist complet
