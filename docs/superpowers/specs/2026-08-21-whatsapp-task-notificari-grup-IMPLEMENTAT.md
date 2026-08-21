# Task ↔ grup WhatsApp: notificări de status și mențiuni (etapa 2)

Stare la 2026-08-21, 20:30: pe `main` (merge `80de33e1` + fix `fdf2ff70`),
în producție (build `#9574848f`), verificat live: schimbare de status pe task-ul
de test → mesaj în grupul intern în ~1 s, cu linkul spre portalul clientului.

Continuă harta din `2026-08-21-whatsapp-grupuri-in-inbox-IMPLEMENTAT.md`.

## Ce face

Un task poate fi legat de un grup WhatsApp bifat în inbox. După legare:

- orice schimbare de status (todo, in-progress, review, done, blocked,
  cancelled) trimite în grup un mesaj scurt cu cine a făcut schimbarea și linkul;
- o mențiune `@Nume` într-un comentariu trimite în grup cine a fost menționat
  și un fragment din comentariu; dacă persoana are număr în
  `user_whatsapp_link`, `@Nume` e mențiune reală WhatsApp (albastră, cu notificare).

`pending-approval` nu se anunță în grup (pas intern de aprobare).

## Deciziile

| întrebare | decizie | de ce |
|---|---|---|
| model | coloana `task.whatsapp_group_id` (FK la `whatsapp_group.id`) | un task are un singur client; al doilea grup ar dubla mesajele. FK la rând, nu la JID, ca să avem subiect, membri, avatar și `watched` dintr-un join |
| eveniment | hook nou `task.status-changed` emis dintr-un singur helper (`emitTaskStatusChanged` în `tasks.remote.ts`) | sunt 7 căi care scriu `status`, nu 2: updateTask, updateTaskStatus, updateTaskPosition, bulkUpdateTaskStatus, reopenTask, approveTask, rejectTask |
| dublura la `done` | WhatsApp ascultă doar `task.status-changed`; `task.completed` rămâne pentru Telegram | nimeni nu ascultă ambele |
| livrare | tabel `whatsapp_outbox` golit de o buclă pornită în `session-manager` la `connection === 'open'` | worker-ul BullMQ rulează pe orice instanță; bucla asta rulează garantat unde e socketul |
| cine leagă | owner/admin; membrii văd read-only; portalul nu vede nimic | e o decizie de divulgare către oameni din afara firmei |

## Modelul de date

- `task.whatsapp_group_id` (migrarea 0484), nullable, FK `whatsapp_group(id)`.
- `whatsapp_outbox` (0485, indexuri 0486–0487): `group_jid`, `kind`
  (`task.status` | `task.mention` | `task.linked`), `dedupe_key`, `task_id`, `body`,
  `mentions_json` (JID-uri), `status` (`queued` → `sending` → `sent` |
  `failed` | `expired`), `attempts`, `next_attempt_at`, `sent_at`, `wam_id`,
  `last_error`.

## Fișiere

### Pur, testabil fără DB

- `src/lib/server/whatsapp/outbox-policy.ts`: coalescere (`planEnqueue`),
  backoff (`planFailure`), constante. Rândul `queued` cu aceeași cheie se
  înlocuiește; după un mesaj trimis în ultimele 120 s, următorul se amână până
  la capătul ferestrei. Backoff 30 s × 2ⁿ, plafon 10 min, maximum 10 încercări,
  expirare la 6 ore. Plafon 60 de mesaje/oră per tenant.
- `src/lib/server/whatsapp/task-messages.ts`: textele. `*bold*` doar pe titlu
  și status; asteriscurile și liniuța lungă din titluri se curăță.

### Cu DB

- `src/lib/server/whatsapp/outbox.ts`: `enqueueGroupMessage`, `drainOutbox`,
  `startOutboxLoop`/`stopOutboxLoop` (la 30 s, per tenant, pe `globalThis`),
  `kickOutbox` (golire imediată dacă instanța curentă are socketul). Rândurile
  trimise se copiază și în `whatsapp_message` ca să apară în inbox.
- `src/lib/server/whatsapp/task-notifications.ts`:
  `notifyTaskStatusChangedInGroup(event)`, `notifyTaskMentionInGroup(payload)`.
  Refuză grupul debifat (aceeași gardă ca `assertWritableGroup`).
- `src/lib/server/whatsapp/session-manager.ts`: `sendTextToJid(tenantId, jid,
  text, { mentions })`; bucla de outbox pornește la `open`, se oprește la
  `close` și în `stopSession`.
- `src/lib/server/plugins/types.ts`: `TaskStatusChangedEvent`.
- `src/lib/server/hooks/notification-hooks.ts`: handler-ul.
- `src/lib/remotes/tasks.remote.ts`: `emitTaskStatusChanged` + 7 apeluri.
- `src/lib/remotes/task-comments.remote.ts`: WhatsApp în aceeași buclă cu
  Telegram și in-app.
- `src/lib/remotes/task-whatsapp.remote.ts`: `getTaskWhatsappLink(taskId)`
  (legătura, propunerea, opțiunile pentru admin), `setTaskWhatsappGroup`.
- `src/lib/remotes/whatsapp-outbox.remote.ts` + tab-ul „WhatsApp" din
  `/[tenant]/admin/logs`: coada cu statistici pe stare, căutare, mesajul
  desfășurat, repunere în coadă (picat/expirat), ștergere. Doar owner/admin.

### Interfață

- `src/lib/components/task-detail/task-whatsapp-group-card.svelte`: cardul.
  Montat în bara laterală a panoului (`task-detail-body.svelte`, sub „Echipă",
  doar `!isClient`) și în „Related Information" pe pagina completă.
- Propunerea: clientul task-ului are exact un grup bifat → preselectat, cu
  „Propus după clientul task-ului". Omul apasă „Leagă".
- Activitate: `whatsapp_group_linked` / `whatsapp_group_unlinked` în timeline.

## Textele

La legarea task-ului de grup (grupul află de task de atunci; un task nou n-are
grup la creare, legarea e decizia omului):

```
📌 *Raport lunar Beautyone*
Task nou în grup, adăugat de Augustin Constantin. Status: În lucru.
Responsabil: Ana Pop · Termen: 28 aug. 2026
https://clients.onetopsolution.ro/client/ots/tasks/abc123
```

```
🔧 *Raport lunar Beautyone*
Andrei Pop a trecut task-ul în *În lucru* (din De făcut).
https://clients.onetopsolution.ro/client/ots/tasks/abc123
```

```
💬 *Raport lunar Beautyone*
Mențiune de la Andrei Pop pentru @Ana Pop:
„Ana, poți verifica bugetul de septembrie până mâine?"
https://clients.onetopsolution.ro/client/ots/tasks/abc123
```

## Capcane întâlnite

- **Hook-urile nu se reînregistrează la HMR.** `registerNotificationHooks` are
  gardă pe `globalThis`, iar `getHooksManager` e singleton de modul. După o
  schimbare în `notification-hooks.ts` în dev, handler-ul nou nu rulează până
  la restartul serverului (prima încercare a schimbat statusul fără rând în
  outbox din cauza asta). În producție procesul e nou, nu contează.
- **Jurnalul drizzle vs. remote.** Pe remote ultima migrare avea `created_at`
  …457, iar jurnalul local maximul …442. Intrările noi puse la …443–446 au fost
  sărite în tăcere de `db:migrate`. Verifică `SELECT max(created_at) FROM
  __drizzle_migrations` pe remote și pune `when`-ul peste el.
- **`scripts/fix-migrations.ts` adaugă `IF NOT EXISTS`** în fișierele
  neurmărite, contrar regulii casei. Scoate-le după ce rulează, sau nu-l rula.
- Testul live de mențiune n-a fost posibil: tenantul are un singur utilizator,
  iar auto-mențiunea e sărită by design.
- Primul „fix link" (`e5e3fa2e`) a schimbat doar documentul: un `cd app` picat
  a oprit scriptul de editare, iar diff-ul n-a fost verificat. Fix-ul real e
  `fdf2ff70`. Verifică `git show --stat` înainte de a declara un fix gata.

## Cum se verifică

```bash
cd app
bun run test whatsapp            # outbox-policy, task-messages, task-notifications + etapa 1
bunx --bun svelte-check --threshold error
```

Live: leagă un task de grupul intern din pagina lui, schimbă statusul, rândul
apare în `whatsapp_outbox` ca `sent` în câteva secunde (dacă instanța curentă
are socketul; altfel la următoarea golire de pe instanța conectată).

## Ce NU există încă

- Preferință per tenant/utilizator „vreau sau nu notificări WhatsApp".
- Notificări pentru alte evenimente (atribuire, scadență) în grup.
