# Prompt: task-uri legate de un grup WhatsApp + notificări de status în grup

Copiază conținutul de mai jos într-o conversație nouă. E scris ca să fie de
ajuns singur: cine deschide sesiunea nu trebuie să fi văzut discuția de azi.

---

## Ce vreau

Un task din CRM să poată fi legat de un grup WhatsApp, iar când i se schimbă
statusul, grupul să primească un mesaj scurt. Același lucru când cineva e
menționat cu `@` într-un comentariu: mențiunea să ajungă în grupul task-ului.

Concret, din pagina unui task:

1. aleg un grup WhatsApp (dintre cele **bifate** în inbox, nu dintre toate);
2. de acum, la fiecare schimbare de status (`todo` → `in-progress` → `review`
   → `done`, plus `blocked` și `cancelled`) pleacă un mesaj în grup;
3. la un comentariu cu `@nume`, pleacă în grup un mesaj cu cine a fost
   menționat și un fragment din comentariu.

Etapa 1 (grupurile în inbox) e livrată, în producție, și tot ce-ți trebuie din
ea e documentat în `docs/superpowers/specs/2026-08-21-whatsapp-grupuri-in-inbox-IMPLEMENTAT.md`.
**Citește-l integral înainte de orice.** Are secțiunea „Ce NU există încă (și
pare că există)", care îți scutește cel puțin o oră.

## Ce ai deja, ca să nu rescrii

- **Trimiterea în grup**: `sendTextToJid(tenantId, groupJid, text)` din
  `app/src/lib/server/whatsapp/session-manager.ts`. Verificată în producție.
  Trece prin `humanizedDelay` (3–7 s per tenant), nu o ocoli.
- **Grupurile bifate**: tabelul `whatsapp_group` cu `watched = 1`, și
  `listStoredGroupRows(tenantId)` din `group-store.ts`. Un grup nebifat nu e
  destinatar valid; `assertWritableGroup` din `whatsapp.remote.ts` arată cum se
  refuză.
- **Legătura grup ↔ client**: `whatsapp_group.client_id`. Un task are
  `task.client_id`. Folosește-o pentru propunerea implicită: când task-ul are
  client și clientul are exact un grup bifat, propune-l. Decizia rămâne la om.
- **Șablonul de copiat**: `app/src/lib/server/telegram/task-notifications.ts`,
  funcțiile `notifyTaskCompleted` și `notifyTaskMention`, și cum sunt legate în
  `app/src/lib/server/hooks/notification-hooks.ts`. Fă echivalentul pentru
  WhatsApp într-un modul nou, `app/src/lib/server/whatsapp/task-notifications.ts`.
  Nu amesteca în modulul Telegram.
- **Mențiunile**: `task-comments.remote.ts` extrage deja `mentionedUserIds`
  din HTML-ul TipTap (`extractMentionIds`) și pornește Telegram + in-app pentru
  fiecare. Adaugă WhatsApp acolo, în aceeași buclă, nu într-un loc nou.
- **Om ↔ număr**: `getUserWhatsappPhonesBatch(tenantId, userIds)` din
  `resolve-phone.ts`, dacă vrei să scrii în mesaj „@Ana Pop" ca mențiune reală
  de WhatsApp (vezi mai jos).

## Capcane care te vor costa timp dacă nu le știi

**Statusul se schimbă pe două căi, și doar una emite hook.**
`updateTask` (`tasks.remote.ts`, ~linia 1547) emite `task.completed` la
trecerea pe `done`. `updateTaskStatus` (`tasks.remote.ts:1894`, cea folosită de
kanban și de editarea inline) **nu emite niciun hook**: trimite emailuri prin
`resolveTaskRecipients` și atât. Pentru `in-progress`, `review`, `blocked`,
`cancelled` nu există niciun eveniment nicăieri. Ai de ales: un hook nou
`task.status-changed` cu `{ oldStatus, newStatus }` emis din ambele locuri, sau
apelul direct din ambele. Hook-ul e mai curat și îl va folosi și Telegram.
Oricum alegi, **nu emite de două ori la `done`** (o dată `task.completed`, o
dată `task.status-changed`); decide cine notifică și documentează.

**Sesiunea WhatsApp trăiește într-un singur proces.** `getActiveSession`
întoarce `null` pe orice instanță care n-a scanat QR-ul. O schimbare de status
vine dintr-o cerere HTTP, care poate ateriza pe alt pod. Deci notificarea nu
poate fi un apel direct la `sendTextToJid` din handler, cu speranța că merge.
Opțiuni: (a) coadă BullMQ (există deja pentru scheduler; vezi
`app/src/lib/server/scheduler/`) cu un worker care rulează doar pe instanța cu
socket, sau (b) tabel `whatsapp_outbox` golit de un job la 30 s pe instanța
conectată. Azi producția are un singur pod, deci apelul direct *pare* să
meargă. Nu te baza pe asta; proiectează pentru două.

**Volumul și banarea.** Pagina `/ots/whatsapp` avertizează deja că metoda
încalcă termenii Meta. Un task mutat de cinci ori în cinci minute nu trebuie
să trimită cinci mesaje. Pune o coalescere: dacă în ultimele N secunde s-a
trimis deja un mesaj de status pentru același task în același grup, înlocuiește
sau sari. Și o limită pe tenant pe oră, cu log când se atinge.

**Mențiunea reală în WhatsApp** (`@Ana Pop` care devine albastră și notifică
persoana) cere `sendMessage(jid, { text, mentions: [jidUser] })` în Baileys,
cu JID-ul persoanei. Telefonul îl ai din `user_whatsapp_link`; JID-ul e
`e164ToJid(phone)`. `sendTextToJid` de azi **nu** acceptă `mentions`; extinde-l
cu un parametru opțional, fără să strici apelurile existente. Dacă persoana
menționată n-are număr în `user_whatsapp_link`, scrie numele simplu, fără
mențiune reală.

**Timestamp-urile** se stochează ca șiruri ISO prin `customType` din
`schema.ts`. O migrare care declară `integer` pentru o coloană de timp e
greșită. Declară `timestamp`.

**Migrările, strict.** `drizzle-kit generate` e stricat în repo (coliziune de
snapshot la 0230), deci se scriu de mână, dar cu disciplina lui `generate`:
un statement pe fișier, **fără `IF NOT EXISTS`**, nume fără „ensure"/„fix",
niciodată atingerea unui fișier deja comis. Înainte de orice index sau tabel
nou, `grep` numele în `drizzle/*.sql`. Ultima migrare e `0483`; continui de la
`0484`. După ce scrii migrările, verifică pe o bază goală:

```bash
cd app && rm -f /tmp/clean.db
SQLITE_PATH=/tmp/clean.db SQLITE_URI= SQLITE_AUTH_TOKEN= bunx --bun drizzle-kit migrate
```

Apoi `bun run db:migrate` pe remote și `PRAGMA table_info` ca să confirmi.
Jurnalul `drizzle/meta/_journal.json` e pe o scară de timp cu ~1000× peste
`Date.now()`; `scripts/fix-migrations.ts` ridică `when`-ul intrărilor noi
peste maxim, rulează-l.

**`bun run test`, niciodată `bun test`.** Al doilea rulează totul într-un
proces, iar `mock.module()` e global.

**În dev, după orice schimbare în calea de primire WhatsApp**, socketul
Baileys rămâne pe codul vechi până la `POST /ots/api/_debug-whatsapp-reload`.
Pentru trimitere nu e nevoie: aceea trece prin cerere HTTP, unde modulul e
reîncărcat.

**Svelte**: un prop numit `state` sparge runa `$state`. Dialogurile bits-ui se
folosesc cu `bind:open`.

**Textele în română**, trecute prin skill-ul `humanizer`. Fără liniuță lungă.
Numeralele cu „de" de la 20 în sus: există `numarSi(n, 'membru', 'membri')`
în `app/src/lib/utils/ro-numerale.ts`.

## Cum vreau să lucrezi

Înainte de cod, un plan scurt cu deciziile și motivele lor, mai ales pe:

1. **Modelul**: coloană `task.whatsapp_group_jid` sau tabel de legătură
   `task_whatsapp_group` (un task, mai multe grupuri)? Argumentează. Eu înclin
   spre coloană, fiindcă un task are un singur client; convinge-mă dacă nu.
2. **Evenimentul**: hook nou `task.status-changed` sau apel direct? Și cum
   eviți dublura cu `task.completed` la `done`.
3. **Livrarea**: cum ajunge mesajul pe instanța care are socketul. Coadă,
   outbox, sau altceva. Ce se întâmplă când sesiunea e picată: se pierde, se
   reîncearcă, cât timp.
4. **Textul mesajelor**: un exemplu pentru fiecare tip (status, mențiune), cu
   numele task-ului, cine a făcut schimbarea, linkul. Scurt, fără Markdown
   (WhatsApp nu-l randează ca Telegram; `*bold*` și `_italic_` merg).
5. **Cine poate lega și cine e notificat**: legarea doar la admin sau și la
   membru? Clientul din portal vede că task-ul e legat de un grup?
6. **Interfața**: unde în pagina task-ului stă selectorul de grup, cum se vede
   că task-ul e legat, cum se dezleagă.

Respectă designul CRM-ului (tokenii din `app/src/routes/layout.css`, Plus
Jakarta Sans, componentele shadcn existente). Pagina task-ului e
`app/src/routes/[tenant]/tasks/[taskId]/` și componentele din
`app/src/lib/components/task-detail/`.

La final: `bunx --bun svelte-check --threshold error` fără erori, `bun run
test` verde, autofixerul Svelte curat pe fiecare componentă atinsă, o bază
goală construită din migrări, și verificare reală: leagă un task de grupul
intern („Mădălina & Claudia & Mihai & Sergiu & Augustin & Andrei", 8 membri,
deja bifat, legat de clientul Lucky Group), mută-l pe `in-progress`, vezi
mesajul pe telefon. Nu folosi grupul „Ads Retail Beautyone" pentru teste: are
clienți reali în el.

Commit pe bucăți logice, nu unul singur. Nu face deploy fără să întrebi.
