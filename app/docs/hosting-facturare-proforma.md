# Facturare hosting: proformă până la încasare

Regulă de business (fixă): **fiecare reînnoire de hosting se emite ca proformă**
(Keez `Draft`). Ea devine factură fiscală (Keez `Valid`, cu depunere la ANAF)
**doar când încasarea este înregistrată în CRM**. Nu există excepție și nu există
setare care să o schimbe.

## Incidentul din 3–4 septembrie 2026

- Schedulerul a generat OTSH 12 (service-gsm-suceava.ro). Hook-ul Keez
  `onInvoiceCreated` valida automat orice factură din șablon recurent
  (`isRecurring === true`), deci OTSH 12 a devenit fiscală și a fost depusă la
  e-Factura în aceeași secundă, pentru un serviciu neplătit.
- Codul cu validarea automată exista din 31 martie 2026. Toate cele 13 facturi
  OTSH emise de scheduler au fost fiscalizate la creare. Nu s-a observat pentru că
  OTSH 1–11 au fost plătite ulterior.
- OTSH 13 (același client, aceeași perioadă, 04.09) a apărut în Keez fără urmă în
  logurile CRM și a fost importată de sincronizarea Keez → CRM la 06:33. Ambele
  au trebuit stornate.

## Cum funcționează acum

| Moment | Ce se întâmplă | Unde |
| --- | --- | --- |
| Scheduler generează reînnoirea | factură CRM `draft` + Keez `Draft` (proformă); PDF „FACTURA PROFORMA"; email „Factura proformă OTSH N" | `invoice-utils.ts`, `keez/hooks.ts:onInvoiceCreated`, `email.ts` |
| Decizia de validare la creare | `shouldAutoValidateOnCreate`: hosting → niciodată; manual → niciodată; recurent non-hosting → da (comportamentul vechi pentru abonamentele OTS) | `keez/auto-validate-policy.ts` |
| Plată card (Stripe), OP/cash din contul de hosting, „Marchează achitată" | se emite `invoice.paid` → `onInvoicePaid` → `shouldValidateOnPaid` → `POST /invoices/valid` în Keez; statusul CRM rămâne `paid` | `keez/hooks.ts:onInvoicePaid`, `keez/auto-push.ts:validateInvoiceInKeezForTenant` |
| Validarea eșuează la Keez | plata rămâne înregistrată; log `keez_validate_on_paid_failed` + notificare `keez.sync_error` (prioritate high) către owner/admin: validează manual din Keez | `keez/hooks.ts` |
| Validare manuală din UI | statusul CRM nu mai e retrogradat la `sent` peste `paid` | `keez.remote.ts:validateInvoiceInKeez` |
| Comandă nouă plătită cu cardul (pachete hosting, ore extra work) | factura e inserată direct `paid`, deci după push-ul în Keez se validează pe loc | `stripe/post-payment/emit-keez-invoice.ts`, `emit-keez-hours-invoice.ts` |
| Proformă neplătită după scadență | nu primește „restantă"/remindere de restanță (acelea cer `Valid`); suspendarea vine din `hosting-expiry-guard` la scadență + 10 zile; reminderele de reînnoire (14/7/1 zile) rămân | `scheduler/tasks/hosting-expiry-guard.ts` |
| Sync nocturn Keez → CRM | `Draft` nu mai retrogradează o proformă trimisă la `draft` (statusul `draft` nu era plătibil prin OP/cash, nici prin linkul public) | `keez/invoice-status.ts` |

Loguri de urmărit în Admin → Logs (sursa `keez`):
`keez_auto_validate_decision`, `keez_validate_on_paid_decision`,
`keez_invoice_validated`, `keez_validate_on_paid_failed`.

## Limită cunoscută: ordinea cronologică din seria OTSH

Keez cere ca documentele fiscale dintr-o serie să fie în ordine cronologică.
Numărul OTSH se alocă la crearea proformei, iar validarea se face la plată, deci
o proformă mai veche plătită după validarea uneia mai noi poate fi respinsă cu
`ERROR_DOCUMENT_DATE_GRATER_THEN_LAST_INVOICE_DATE`. În acest caz CRM-ul
notifică staff-ul; rezolvarea corectă pe termen lung este o serie separată
pentru proforme, cu numărul fiscal alocat abia la validare.

## Ce NU face automat CRM-ul

- Nu trimite la e-Factura. Depunerea e făcută de Keez la validare (setare în
  contul Keez).
- Nu stornează. Storno se face din Keez sau din `/invoices` (⋮ → Storno).
- Nu suspendă contul pentru o proformă neplătită prin `invoice-overdue-reminders`
  (acela lucrează doar pe `keezStatus='Valid'`); suspendarea la neplată vine din
  `hosting-expiry-guard` (scadență + 10 zile).

## Reemiterea după storno

1. Storno în Keez pentru facturile fiscale greșite. Sincronizarea Keez → CRM le
   marchează `cancelled`.
2. Șablonul recurent al contului a avansat deja `next_run_date` cu un ciclu.
   Pune-l înapoi pe azi (SQL pe `recurring_invoice.next_run_date`) sau declanșează
   `POST /ots/api/_debug-trigger-template?templateId=<id>`; schedulerul rulează
   zilnic la 09:00 (Europe/Bucharest).
3. Noua factură este proformă. Când clientul plătește, devine fiscală automat.
