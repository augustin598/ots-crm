# Creditul de ore la încasarea înregistrată în Keez

**Data:** 2026-09-28 · **Branch:** `fix/hour-credits-keez-sync-paid`

## Problema

Bifa „Facturile plătite alimentează creditul" promite că facturile eligibile intră
automat în ledger. Promisiunea ține doar pentru plățile înregistrate în CRM (card
Stripe, OP/cash marcat de staff), care emit hook-ul `invoice.paid`. Când contabilul
înregistrează încasarea în Keez, sincronizarea (`plugins/keez/sync.ts`, job zilnic
04:00 și butonul de sincronizare, ambele prin `syncKeezInvoicesForTenant`; plus
refresh-ul post-push din `syncInvoiceToKeez`, `keez.remote.ts`) scrie
`status='paid'` + `paid_date` direct în bază, fără niciun hook → ledger-ul rămâne gol.

Caz real: OTS 561 (Lucky Group, 5.608 RON net) — `paid` din 22 sep prin sync,
clientul bifat, ledger gol; a stat 6 zile în „Facturi necreditate".

## Decizie

1. Din sync NU se emite hook-ul complet `invoice.paid`: l-ar prinde și plugin-ul
   DirectAdmin (avansează scadența conturilor de hosting) și notificările staff — o
   schimbare de comportament pe hosting pe care nu o vrem strecurată aici.
2. Sync-ul emite un eveniment nou, îngust: `invoice.paid.synced` (`types.ts`), doar la
   tranziția `≠paid → paid`. Îl ascultă doar `hooks/hour-credit-hooks.ts`, care
   apelează `creditPaidInvoice` cu trigger `keez-sync` (nota rândului: „încasare
   înregistrată în Keez").
3. `sync.ts` NU importă `$lib/server/hour-credits` direct (prima variantă): modulul
   trage notificări → email → Stripe → `$app/environment`, iar trei teste unitare de
   sync (`failure-handler`, `sync.fingerprint`, `keez-invoice-sync-retry`) picau pe
   lanțul de importuri. Indirecția prin hooks manager păstrează sync-ul ușor.

## Pași (livrați)

1. `plugins/keez/paid-transition.ts` — `isPaidTransition(prev, next)` (pur) +
   `emitKeezPaidTransition({ tenantId, invoiceId, invoiceNumber, previousStatus,
   newStatus, emit })`: nu aruncă niciodată, loghează erorile din ascultători.
   Test: `paid-transition.test.ts` cu `emit` injectat (mock doar pe logger).
2. `types.ts` — `InvoicePaidSyncedEvent` în uniunea `HookEvent`.
3. `hooks/hour-credit-hooks.ts` — ascultător pe `invoice.paid.synced`; handler comun
   `creditWithoutThrowing` cu `logWarning` pe `failed` (ex. curs BNR indisponibil —
   singura recuperare e creditarea manuală). Test: `hour-credit-hooks.test.ts`.
4. `sync.ts` — emit imediat după tranzacția de update (înaintea scrierilor rândului
   de sync, care nu sunt protejate de retry) și după inserarea unei facturi noi
   deja `paid` (`previousStatus: null`).
5. `keez.remote.ts` (`syncInvoiceToKeez`) — emit după update, cu
   `invoice.status → updateData.status` (undefined când Keez nu dă status → nimic).
6. `hour-credits.ts` — `trigger: 'hook' | 'manual' | 'keez-sync'`, sufixul notei.
7. `auto-push.ts` (`pushInvoiceToKeez`) — fără emit, cu comentariu: apelanții împing
   facturi excluse oricum de eligibilitate (hosting, comenzi de ore, „Adaugă ore").
8. `docs/bugete-ore.md` — paragraf în „De unde vin orele".
9. Prod: OTS 561 creditată manual din „Facturi necreditate" (+1162 min), 28 sep.

## Verificare

- `bun run test` verde (suita completă)
- svelte-check: doar cele 3 erori preexistente (`portalScope` în mappere, `interviuri`)
- `bun run build` (prod) OK
- pe prod: ledger Lucky Group are rândul `invoice_credit` pentru OTS 561, sold 19 h 22 min
