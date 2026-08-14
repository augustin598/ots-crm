# Email confirmare plată + restaurare servicii după plata cu cardul — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** După o plată cu cardul a unei facturi emise (portal sau link public), clientul primește emailul de confirmare „Plată primită", adminul primește notificarea de plată, iar serviciile restricționate (acces portal, hosting suspendat) se restaurează — cu flux complet testat, emailurile de test ajungând pe office@onetopsolution.ro.

**Architecture:** REFOLOSIM tot ce există: `notifyPaymentSucceeded` (dedupe pe viață per factură + toggle-uri tenant + destinatari client & secundari „invoices") și `notifyAdminPaymentReceived` (alertă admin, dedupe) sunt azi legate DOAR de fluxul de comenzi hosting — le legăm și de `handleStripeInvoicePayment` (webhook `crmPurpose='invoice_payment'`). Restaurarea e deja automată: restricția portal e derivată din facturi `overdue` (se stinge când factura devine `paid`), iar hook-ul DA `onInvoicePaid` face unsuspend + avans due-date; adăugăm doar `invalidateAll()` în portal după plată ca overlay-ul să dispară fără reload.

**Context verificat:** toggle-urile `invoice_emails_enabled`/`paid_confirmation_email_enabled` = 1 pe ots; admin owner = office@onetopsolution.ro; template admin acceptă orice nume de pași; `PUBLIC_APP_URL` setat.

### Task 1: Template `invoice-paid` — mențiune restaurare + demo script
- Modify: `app/src/lib/server/email-templates/invoice-paid.ts` — paragraf: accesul/serviciile limitate de această factură se reactivează automat (HTML + text).
- Create: `app/scripts/demo-invoice-paid-email.ts` (render pur → HTML → deschis în browser, ca celelalte demo-uri).

### Task 2 (TDD): `handleStripeInvoicePayment` trimite notificările
- Modify: `app/src/lib/server/stripe/__tests__/invoice-payment.test.ts` ÎNTÂI — mock `$lib/server/stripe/notifications` cu spioni; teste: tranziție sent→paid ⇒ ambele apelate cu (tenantId, invoiceId); redelivery idempotent ⇒ neapelate; sumă nepotrivită ⇒ neapelate; notificarea aruncă ⇒ handlerul NU aruncă (webhook-ul nu se retry-storm-ează).
- Modify: `app/src/lib/server/stripe/invoice-payment.ts` — după hooks (în `if (updated && previousStatus !== 'paid')`), try/catch separat: `notifyPaymentSucceeded(tenantId, invoiceId)` + `notifyAdminPaymentReceived(tenantId, invoiceId, { 'factura-marcata-platita': 'success', 'hook-uri-hosting': hooksOk })`.

### Task 3: Overlay-ul de restricție dispare imediat după plată
- Modify: `app/src/routes/client/[tenant]/(app)/invoices/+page.svelte` — la outcome `paid`: `invalidateAll()` (accessRestriction din layout se recalculează; factura nu mai e overdue). Se păstrează `invoicesQuery.refresh()` la close.

### Task 4: `bun run test` 0 fail + svelte-check 0 erori + autofixer pe pagină.

### Task 5: E2E complet (emailuri REALE pe office@)
- Client sintetic „TEST-E2E …" cu `email='office@onetopsolution.ro'` + factură `TEST-E2E-…` `status='overdue'`, dueDate în urmă cu 10 zile.
- Login magic link → `/client/ots/tasks` arată „Acces Restricționat" (screenshot) → Invoices → Plătește → 4242 → webhook (`stripe listen`) → factura `paid` → overlay dispărut fără reload → `email_log` conține `invoice-paid` + `admin-payment-received` către office@ → userul confirmă inbox-ul.
- Cleanup: șterge factura, clientul, tokenul, rândurile `payment_email_event`.

### Task 6: Review + commit pe `portal-invoice-card-payment`.
