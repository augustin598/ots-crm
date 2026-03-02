# Audit Notificari Email Facturi — Sprint 1

**Data:** 2026-03-02

## Context

Sistemul de emailuri pentru facturi avea doar un singur toggle (`invoiceEmailsEnabled`) care controla toate emailurile.
Nu exista configurare granulara, remindere pentru facturi restante, sau auto-trimitere la facturi recurente.

## Starea anterioara

| Trigger | Email | Configurabil |
|---------|-------|-------------|
| User click "Trimite Factura" | `sendInvoiceEmail()` | Un singur toggle master |
| Invoice marcata ca platita | `sendInvoicePaidEmail()` via hook | Acelasi toggle master |
| Factura recurenta generata (2AM) | **NU se trimitea email** | N/A |
| Factura restanta (overdue) | **NU exista** | N/A |

## Modificari implementate

### 1. Schema — noi campuri `invoiceSettings`
- `sendInvoiceEmailEnabled` (boolean, default true) — toggle trimitere manuala
- `paidConfirmationEmailEnabled` (boolean, default true) — toggle confirmare plata
- `overdueReminderEnabled` (boolean, default false) — toggle remindere restante
- `overdueReminderDaysAfterDue` (integer, default 3) — zile dupa scadenta pt primul reminder
- `overdueReminderRepeatDays` (integer, default 7) — interval repetare (0 = fara)
- `overdueReminderMaxCount` (integer, default 3) — nr maxim remindere per factura
- `autoSendRecurringInvoices` (boolean, default false) — auto-email la facturi recurente

### 2. Schema — noi campuri `invoice`
- `overdueReminderCount` (integer, default 0)
- `lastOverdueReminderAt` (timestamp, nullable)

### 3. Verificare granulara email
- `sendInvoice` (invoices.remote.ts) — acum verifica `masterEnabled && sendInvoiceEnabled`
- Hook `invoice.paid` (email-notifications.ts) — acum verifica `masterEnabled && paidConfirmationEmailEnabled`
- Toggle master (`invoiceEmailsEnabled`) ramane kill switch global

### 4. Overdue Reminder System
- **Email nou**: `sendOverdueReminderEmail()` in email.ts — template amber/galben, text in romana
- **EmailType**: `'invoice-overdue-reminder'` adaugat in email-logger.ts
- **Scheduler task**: `invoice-overdue-reminders.ts` — ruleaza Luni-Vineri la 9:00 AM Europe/Bucharest
- **Logica**:
  - Query tenanti cu `overdueReminderEnabled = true`
  - Find facturi cu status 'sent', dueDate < now, overdueReminderCount < maxCount
  - Primul reminder dupa `daysAfterDue` zile, repetare la fiecare `repeatDays`
  - Update `overdueReminderCount` si `lastOverdueReminderAt` dupa trimitere

### 5. Auto-trimitere Facturi Recurente
- In `recurring-invoices.ts`: dupa `generateInvoiceFromRecurringTemplate()`, check `autoSendRecurringInvoices`
- Daca enabled: lookup client email → `sendInvoiceEmail()` → update `lastEmailSentAt/Status`
- Fail-safe: eroare la auto-send nu blocheaza generarea facturii

### 6. Settings UI — "Notificari Email Facturi" Card
- Card dedicat separat de "General Invoice Settings"
- Toggle master: "Emailuri Facturi (Master)" — ascunde sub-optiuni cand OFF
- Sub-optiuni (vizibile cand master ON):
  - Trimitere Factura (toggle)
  - Confirmare Plata (toggle)
  - Auto-trimitere Facturi Recurente (toggle)
  - Reminder Factura Restanta (toggle + sub-configurare):
    - Zile dupa scadenta pentru primul reminder (1-30)
    - Interval repetare in zile (0-30, 0 = fara repetare)
    - Numar maxim de remindere (1-10)

## Fisiere modificate
- `app/src/lib/server/db/schema.ts` — 9 campuri noi
- `app/src/lib/remotes/invoice-settings.remote.ts` — CRUD settings
- `app/src/lib/remotes/invoices.remote.ts` — check granular sendInvoice
- `app/src/lib/server/hooks/email-notifications.ts` — check granular paid
- `app/src/lib/server/email.ts` — `sendOverdueReminderEmail()`
- `app/src/lib/server/email-logger.ts` — nou EmailType
- `app/src/lib/server/scheduler/index.ts` — inregistrare task
- `app/src/lib/server/scheduler/tasks/recurring-invoices.ts` — auto-send
- `app/src/lib/server/scheduler/tasks/invoice-overdue-reminders.ts` — NOU
- `app/src/routes/[tenant]/settings/invoices/+page.svelte` — UI

## Migrare
- `app/drizzle/0055_funny_mantis.sql`

## Starea noua

| Trigger | Email | Configurabil |
|---------|-------|-------------|
| User click "Trimite Factura" | `sendInvoiceEmail()` | Master + `sendInvoiceEmailEnabled` |
| Invoice marcata ca platita | `sendInvoicePaidEmail()` | Master + `paidConfirmationEmailEnabled` |
| Factura recurenta generata (2AM) | `sendInvoiceEmail()` (auto) | Master + `autoSendRecurringInvoices` |
| Factura restanta (overdue, L-V 9AM) | `sendOverdueReminderEmail()` | Master + `overdueReminderEnabled` + config |
