# Grupuri WhatsApp în inbox: ce e implementat (etapa 1)

Stare la 2026-08-21, seara: pe `main` (merge `bfb0e3c4`), în producție (build
`#7f5c77fd`), verificat pe date reale. Documentul ăsta e harta pentru cine
continuă cu etapa 2; spune ce există și unde, nu de ce (pentru „de ce" vezi
`2026-08-21-whatsapp-grupuri-in-inbox-design.md`).

## Modelul de date

`whatsapp_message` (migrări 0469–0472, 0475):

| coloană | valoare |
|---|---|
| `remote_phone_e164` | cheia conversației: telefonul la 1:1, JID-ul `…@g.us` la grup. NOT NULL, neschimbat. |
| `chat_type` | `'direct'` sau `'group'`, NOT NULL DEFAULT `'direct'` |
| `sender_jid` | JID-ul brut al expeditorului, poate fi LID („…@lid"). Doar la grup. |
| `sender_phone_e164` | telefonul expeditorului când s-a putut rezolva |
| `sender_push_name` | numele afișat de WhatsApp; null la mesajele proprii |
| `client_id` | **mereu null la grup**. Legătura grup → client stă pe `whatsapp_group.client_id`. |

`whatsapp_group` (migrări 0473–0474), UNIQUE `(tenant_id, group_jid)`:
`subject`, `participant_count`, `watched` (doar cele bifate se stochează),
`client_id` (legătură manuală), `participants_json` (`{rawId, phone, pushName}[]`,
fotografia membrilor de la bifare; traduce LID → telefon fără trafic spre
WhatsApp), `avatar_path`/`avatar_mime_type`/`avatar_fetched_at`, `last_synced_at`.

Nu te baza pe `jidToE164()` fără să verifici `chatType`: pe un JID de grup
întoarce un telefon fals și plauzibil, `+1203…`.

## Fișiere, pe straturi

### Pur, testabil fără DB: `src/lib/server/whatsapp/group-jid.ts`

- `isGroupJid(jid)`, `isPhoneJid(jid)`, `isIgnorableChatJid(jid)` (broadcast, newsletter)
- `resolveGroupSender(msg, phoneForRawId)` → `{ jid, phoneE164, pushName }`.
  Citește `key.participantAlt` apoi `key.participant`; la LID cade pe lookup-ul
  din fotografia membrilor.
- `resolveMentions(body, lookup)` și `splitMentions(body, lookup)` →
  „@84027092512961" devine „@Iulia Mitu" la citire; textul stocat rămâne neatins.
- `buildMentionLookup(participants, nameForPhone)` indexează și LID-ul, și telefonul.
- `suggestGroupClient(memberPhones, clientByPhone)` → clientul cu cele mai multe
  numere în grup; la egalitate `null`.

Teste: `group-jid.test.ts` (20), cu cazuri reale din grupul „Ads Retail Beautyone".

### Cu DB și sesiune: `src/lib/server/whatsapp/group-store.ts`

- `isWatchedGroup(tenantId, jid)`: cache în memorie per tenant, TTL 60 s,
  pe `globalThis` (supraviețuiește HMR). Se golește la `invalidateWatchedGroups`.
- `participantPhoneLookup(tenantId, jid)` → funcție sincronă rawId → telefon.
- `listStoredGroupRows(tenantId)`: toate grupurile cunoscute (nu doar bifate),
  ca un grup debifat să-și păstreze numele în lista de conversații.
- `getStoredGroup(tenantId, jid)`
- `fetchLiveGroups(tenantId)`: `groupFetchAllParticipating` cu cache 60 s.
  Aruncă `WhatsappNotConnectedError` fără sesiune pe instanța curentă.
- `setGroupWatched(tenantId, summary, watched)`, `setGroupClient(tenantId, jid, clientId)`
- `suggestClientsForGroups(tenantId, groups)`: din `client.phone` și
  `user_whatsapp_link`, **fără** `source = 'self_service'` (numere nedovedite).
- `fetchGroupAvatar(tenantId, jid)`: un singur `profilePictureUrl` per grup, la bifare.

### Primire: `src/lib/server/whatsapp/inbound-handler.ts`

`handleInbound` clasifică pe `key.remoteJid`: grup nebifat → aruncat la intrare
(nu ajunge în DB, nu descarcă media); grup bifat → `remote_phone_e164 = JID`,
expeditor prin `resolveGroupSender`; 1:1 → ca înainte, dar `resolvePhoneJid`
citește acum `key.remoteJidAlt` (Baileys 7), nu `senderPn`, care nu există.

`handleMessageUpdate` are gardă monotonă (`sent < delivered < read`) și
`mapAckStatus` aliniat la `proto.WebMessageInfo.Status` (2 server, 3 livrat, 4 citit).

### Trimitere: `src/lib/server/whatsapp/session-manager.ts`

```ts
sendText(tenantId, toE164Phone, text)        // neschimbat, deleagă mai jos
sendTextToJid(tenantId, jid, text)           // NOU: acceptă direct „…@g.us"
sendMedia(tenantId, toE164Phone, input)      // neschimbat
sendMediaToJid(tenantId, jid, input)         // NOU
```

Ambele noi trec prin `humanizedDelay` (3–7 s per tenant) ca și cele vechi.
**Asta e calea pe care se pliază etapa 2.** Verificată în producție: un mesaj
trimis din CRM în grup a ajuns pe telefon.

### Remote: `src/lib/remotes/whatsapp.remote.ts`

- `listWhatsappConversations()`: ultimul mesaj per conversație prin
  `ROW_NUMBER() OVER (PARTITION BY remote_phone_e164 …)`, necitite separat.
  Întoarce `chatKey`, `chatType`, `subject`, `participantCount`, `lastSenderName`,
  `lastAt` (null la grup abia bifat, care apare cu „Niciun mesaj încă").
- `getWhatsappThread(chatKey)`: la grup întoarce și `group: { subject, participantCount, watched }`
  și `messages[].bodyParts` (pastilele de mențiune).
- `sendWhatsappMessage` / `sendWhatsappMedia`: `to` acceptă JID de grup;
  `resolveSendTarget` refuză un grup nebifat (`assertWritableGroup`).
- `listWhatsappGroups()` (membru vede, `canEdit` doar admin),
  `setWhatsappGroupWatched({ groupJid, watched })`,
  `setWhatsappGroupClient({ groupJid, clientId })` (admin).

### Interfață

- `src/routes/[tenant]/whatsapp/+page.svelte`: o listă, filtru Toate / Directe /
  Grupuri, expeditor colorat (nuanțe 700) deasupra balonului, mențiuni ca pastilă,
  caseta de răspuns activă și în grup. `selectedChat` e cheia conversației.
- `src/lib/components/whatsapp/whatsapp-groups-dialog.svelte`: lista de la
  WhatsApp, comutator per grup, client cu propunere.
- `src/lib/components/ui/contact-avatar.svelte`: ține minte *care* adresă a
  eșuat, nu doar că a eșuat.
- `src/routes/[tenant]/api/whatsapp/avatar/[phoneE164]/+server.ts`: servește și
  poza grupului, pe JID.
- `src/routes/api/whatsapp/media/[messageId]/[[filename]]/+server.ts`: numele
  fișierului în adresă + `attachment` pentru tipuri neafișabile + SVG mereu descărcat.

### Diagnostic

- `GET /[tenant]/api/_debug-whatsapp-groups?q=&groupId=`: grupurile cu membri,
  telefoane, avatar, utilizator CRM legat.
- `GET|POST /[tenant]/api/_debug-whatsapp-reload`: GET arată starea, POST
  închide și redeschide socketul **fără QR**. Necesar în dev după orice
  schimbare în calea de primire (ascultătorii Baileys rămân pe codul vechi).

## Ce e deja gata pentru etapa 2

- Trimiterea în grup: `sendTextToJid`. Gata și verificată.
- Legătura grup ↔ client: `whatsapp_group.client_id`, pusă manual din dialog.
- Legătura om ↔ număr WhatsApp: `user_whatsapp_link` (`phone_e164`, `source`,
  `whatsapp_verified`); citire prin `getUserWhatsappPhone(tenantId, userId)`
  și `getUserWhatsappPhonesBatch` din `src/lib/server/whatsapp/resolve-phone.ts`.
- Șablonul de copiat: `src/lib/server/telegram/task-notifications.ts`
  (`notifyTaskCompleted`, `notifyTaskMention`) + `src/lib/server/telegram/sender.ts`.
- Destinatarii unui eveniment de task: `resolveTaskRecipients({ tenantId,
  tenantSlug, taskId, event: 'assigned' | 'comment' | 'status-change',
  actorUserId, mentionedUserIds })` din `src/lib/server/task-recipients.ts`.

## Ce NU există încă (și pare că există)

- **Nu există legătură task ↔ grup WhatsApp.** Nicio coloană, niciun tabel.
- **`updateTaskStatus` (kanban, `tasks.remote.ts:1894`) nu emite niciun hook.**
  Trimite emailuri prin `resolveTaskRecipients`, atât. Hook-ul `task.completed`
  se emite doar din `updateTask` (`tasks.remote.ts:~1547`), la trecerea pe `done`.
  Pentru `in-progress`, `review`, `blocked` nu există niciun eveniment nicăieri.
- **Nu există `notifyTask*` pentru WhatsApp.** Telegram are; WhatsApp nu.
- **Nu există preferință „vreau notificări pe WhatsApp".** `tenant-user-preferences.ts`
  și `clientUserPreferences` au doar chei de email/in-app.
- Sesiunea Baileys trăiește într-un singur proces. Un job din scheduler pe
  altă instanță **nu are socket**; `getActiveSession` întoarce `null`.

## Cum se verifică că încă merge

```bash
cd app
bun run test whatsapp             # group-jid, groups, phone-prompt, avatar-fetcher
bunx --bun svelte-check --threshold error
```
În browser, pe `/ots/whatsapp`: bifează un grup mic din „Grupuri", scrie din
telefon în el, vezi mesajul cu expeditor în 3 secunde. Dacă nu intră, în dev
rulează `POST /ots/api/_debug-whatsapp-reload` (socket pe cod vechi).
