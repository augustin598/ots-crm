# Audit: Task Email Notifications — Sprint 1

**Data**: 2026-03-02

## Rezumat

Implementare sistem complet de notificări email pentru taskuri, atât către **clienți** (client.email) cât și **intern** (watchers/assignee). Setări granulare per-tenant cu master toggle + sub-toggles.

---

## Modificări

### 1. Schema DB (`schema.ts`)
- **6 câmpuri noi** pe tabela `task_settings`:
  - `clientEmailsEnabled` (bool, default: false) — master toggle client emails
  - `clientEmailOnTaskCreated` (bool, default: true) — notificare la creare task
  - `clientEmailOnStatusChange` (bool, default: true) — notificare la schimbare status
  - `clientEmailOnComment` (bool, default: true) — notificare la comentariu
  - `clientEmailOnTaskModified` (bool, default: true) — notificare la modificare task
  - `internalEmailOnComment` (bool, default: true) — watchers primesc email la comentariu

### 2. Migration
- `drizzle/0056_conscious_valeria_richards.sql` — ALTER TABLE cu cele 6 coloane noi

### 3. Email Logger (`email-logger.ts`)
- Adăugat `'task-client-notification'` în tipul `EmailType`

### 4. Email Function (`email.ts`)
- **Funcție nouă**: `sendTaskClientNotificationEmail(taskId, clientEmail, clientName, notificationType, extra?)`
- Tipuri notificare: `created`, `status-change`, `comment`, `modified`
- Subject dinamic: "Task nou:", "Task actualizat:", "Comentariu nou pe task:", "Task modificat:"
- Template HTML + text cu detalii task (titlu, descriere, prioritate, status, termen)
- Header color diferit: verde pentru done, roșu pentru cancelled
- Logging complet via email logger

### 5. Task Settings Remote (`task-settings.remote.ts`)
- `getTaskSettings()` — returnează toate 7 câmpuri (cu defaults)
- `updateTaskSettings()` — acceptă și validează toate 7 câmpuri cu Valibot

### 6. Integrare Tasks Remote (`tasks.remote.ts`)
- **Helper**: `sendClientNotificationIfEnabled(taskId, tenantId, type, extra?)` — verifică master + sub-toggle, fetch client email
- **createTask()** → trimite `'created'` notification la client
- **updateTask()** → trimite `'status-change'` sau `'modified'` (cu lista câmpurilor schimbate)
- **approveTask()** → trimite `'status-change'` cu noul status
- **rejectTask()** → trimite `'status-change'` cu status `'cancelled'`
- **updateTaskPosition()** → trimite `'status-change'` la drag-drop kanban

### 7. Integrare Comments Remote (`task-comments.remote.ts`)
- **createTaskComment()** acum trimite:
  - **Client**: `sendTaskClientNotificationEmail()` cu preview comentariu (dacă `clientEmailOnComment` activ)
  - **Interni**: `sendTaskUpdateEmail()` la watchers cu `changeType: 'comment'` (dacă `internalEmailOnComment` activ)

### 8. Settings UI (`settings/tasks/+page.svelte`)
- **Card 1**: "Notificări Email Către Client" — master toggle + 4 sub-toggles condiționale
- **Card 2**: "Notificări Interne" — task reminders + watchers la comentarii
- UI în română, cu descrieri clare per toggle
- Sub-toggles vizibile doar când master ON (border-left blue accent)

---

## Fișiere Modificate

| Fișier | Tip |
|--------|-----|
| `src/lib/server/db/schema.ts` | 6 câmpuri noi pe taskSettings |
| `src/lib/server/email-logger.ts` | EmailType nou |
| `src/lib/server/email.ts` | Funcție sendTaskClientNotificationEmail() |
| `src/lib/remotes/task-settings.remote.ts` | Get/update extended |
| `src/lib/remotes/tasks.remote.ts` | Helper + integrare 5 puncte |
| `src/lib/remotes/task-comments.remote.ts` | Email client + watchers la comentariu |
| `src/routes/[tenant]/settings/tasks/+page.svelte` | UI complet refăcut |
| `drizzle/0056_conscious_valeria_richards.sql` | Migration |

---

## Comportament

- **Master OFF** (default): niciun email nu se trimite către client
- **Master ON**: fiecare sub-toggle controlează individual tipul de notificare
- **Error-safe**: toate trimiterile email sunt wrapped în try/catch, nu blochează operația principală
- **Audit**: emailurile sunt loggate în `email_log` cu tipul `task-client-notification`
- **Skip condiții**: nu se trimite dacă taskul nu are clientId sau clientul nu are email
