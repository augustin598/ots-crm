# Prompt: grupuri WhatsApp în inbox + notificări de task în grup

Copiază conținutul de mai jos într-o conversație nouă. E scris ca să fie de
ajuns singur: cine deschide sesiunea nu trebuie să fi văzut discuția de azi.

---

## Ce vreau

Două lucruri, în ordinea asta:

**Etapa 1.** Grupurile WhatsApp să apară în inboxul din `/ots/whatsapp`, lângă
conversațiile unu-la-unu. Acum nu apar deloc.

**Etapa 2.** Din task să pot trimite notificări într-un grup WhatsApp: când un
task se termină, sau când cineva e menționat cu `@` într-un comentariu.

Etapa 1 e o condiție pentru etapa 2: fără grupuri stocate n-am unde trimite.

## Contextul de care ai nevoie

### De ce nu apar grupurile azi

Nu e un defect, e o excludere deliberată la intrare. În
`app/src/lib/server/whatsapp/inbound-handler.ts`, funcția `resolvePhoneJid()`
întoarce `null` pentru orice JID de grup, iar bucla din `handleInbound` sare
peste mesaj:

```ts
if (
  key.remoteJid.endsWith('@g.us') ||
  key.remoteJid.endsWith('@broadcast') ||
  key.remoteJid.endsWith('@newsletter') ||
  key.remoteJid === 'status@broadcast'
) {
  return null;
}
// ...
const phoneJid = resolvePhoneJid(msg);
if (!phoneJid) continue; // LID / group / broadcast — skip
```

Verificat pe baza de producție: 1005 mesaje stocate, **0** de grup, **0**
contacte de grup. Nu s-a pierdut nimic pe drum, pur și simplu nu s-a scris
niciodată.

### Presupunerea din model care trebuie schimbată

Tot modulul e construit pe „o conversație = un număr de telefon".
`whatsapp_message.remote_phone_e164` (NOT NULL) e cheia după care conversațiile
se leagă de clienți. Un grup n-are un singur număr, iar fiecare mesaj vine de la
alt participant. Astea sunt lipsurile concrete:

- nu există un câmp care să distingă conversația de grup de cea unu-la-unu;
- nu stocăm expeditorul per mesaj, deci într-un grup n-ai ști cine a scris;
- potrivirea automată „telefon → client" nu se aplică: un grup poate conține
  oameni de la mai mulți clienți, sau de la niciunul.

`remote_phone_e164` fiind NOT NULL, ori pui JID-ul grupului acolo (urât, câmpul
își pierde sensul), ori adaugi coloane noi. Alege și motivează.

### Volumul, care schimbă designul

Contul conectat e în **12 grupuri**, printre care unul cu **1267 de membri**
(„Business Tips by Ștefan Mandachi"). Dacă le tragi pe toate, inboxul devine
inutilizabil. Aproape sigur ai nevoie de o listă de grupuri urmărite explicit,
nu de „toate grupurile". Propune mecanismul.

### Ce există deja și trebuie refolosit, nu rescris

**Citirea grupurilor de la Baileys** — `app/src/lib/server/whatsapp/groups.ts`,
scris ieri. `listGroups(tenantId)` și `getGroup(tenantId, jid)` întorc
`{ id, subject, size, members }`, unde fiecare membru are `phone` în E.164.
Participanții vin de la WhatsApp ca LID-uri opace (`84027092512961@lid`) cu
`phoneNumber` alături; modulul scoate deja E.164 din ele. Are și
`nameMatchScore()` cu teste. Importurile spre `session-manager` sunt lazy
intenționat, ca modulul să fie testabil fără bază de date.

**Trimiterea** — `sendText(tenantId, toE164Phone, text)` din
`app/src/lib/server/whatsapp/session-manager.ts` acceptă azi doar un număr, pe
care îl trece prin `e164ToJid()`. Pentru grupuri îi trebuie o cale care
acceptă direct un JID `@g.us`. Baileys trimite la fel în ambele cazuri, deci e
o modificare mică, dar atenție să nu strici apelurile existente.

**Fan-outul de notificări de task, pe care se pliază etapa 2** — există deja și
e bine făcut. `app/src/lib/server/task-recipients.ts` →
`resolveTaskRecipients({ tenantId, tenantSlug, taskId, event, actorUserId, mentionedUserIds })`
întoarce destinatarii clasificați (agenție / client, cu motivul: assignee,
watcher, mention). În `app/src/lib/remotes/task-comments.remote.ts` se vede
tiparul: emailul merge la toți destinatarii, iar mențiunile pornesc în plus
canalele in-app și Telegram.

**Telegram e șablonul de copiat pentru WhatsApp.**
`app/src/lib/server/telegram/task-notifications.ts` are `notifyTaskMention()`,
iar legătura om ↔ cont stă în tabelul `user_telegram_link`. Pentru WhatsApp
există deja echivalentul: `user_whatsapp_link` (UNIQUE pe tenant + user, cu
`phone_e164`, `source`, `whatsapp_verified`, `consented_at`).

Deci notificarea către o **persoană** pe WhatsApp e aproape gata: ai numărul din
`user_whatsapp_link` și `sendText`. Notificarea către un **grup** e partea nouă.

### Capcane care te vor costa timp dacă nu le știi

- `bun run test`, niciodată `bun test`. Al doilea rulează totul într-un proces,
  iar `mock.module()` e global: primul fișier strică modulele pentru restul.
- Timestamp-urile se stochează ca **șiruri ISO**, prin `customType` din
  `schema.ts`. O migrare care declară `integer` pentru o coloană de timp e
  greșită, chiar dacă SQLite o acceptă. Declară `timestamp`.
- Verifică `drizzle/meta/_journal.json` față de fișierele `.sql`: migrări
  orfane există deja în repo (`0338`–`0340`), iar o migrare nouă care depinde
  de ele pică pe o bază curată. Tiparul de rezolvare e la `0454`–`0456`.
- În Svelte, un prop numit `state` sparge runa `$state` (`$state(...)` devine
  abonare la store-ul `state`). Alege alt nume.
- Dialogurile bits-ui se folosesc cu `bind:open`. Cu `open` unidirecțional
  componenta își ține propria stare și se închide singură la montare.
- WhatsApp e sensibil la trafic care arată a scanare. `onWhatsApp` și cererile
  de metadate de grup se cheamă rar și doar la nevoie, altfel riști banarea
  sesiunii.
- Sesiunea WhatsApp trăiește în memoria procesului
  (`getActiveSession(tenantId)`), deci pe o instanță care n-a scanat QR-ul nu
  există. Orice cod care depinde de ea trebuie să suporte „nu e conectată".
- Pagina `/ots/whatsapp` avertizează deja că metoda încalcă termenii Meta.
  Notificările automate în grup cresc riscul; ține volumul mic.

### Diagnostic la îndemână

`GET /ots/api/_debug-whatsapp-groups` (doar admin, doar citire) listează
grupurile cu membri, telefoane, dacă avem avatar și la ce utilizator CRM e legat
fiecare număr. Acceptă `?q=text` și `?groupId=<jid>`. Folosește-l ca să vezi
datele reale înainte să proiectezi ceva.

## Cum vreau să lucrezi

Începe cu **etapa 1** și tratează etapa 2 doar ca o constrângere de design
(„modelul ales trebuie să permită trimiterea în grup mai târziu"), nu o
implementa acum.

Înainte de cod vreau un plan scurt cu deciziile luate și motivele lor, mai ales:

1. Modelul de date: cum reprezinți conversația de grup și expeditorul per mesaj.
2. Ce grupuri intră în inbox și cine le alege.
3. Cum se leagă (sau nu) un grup de un client.
4. Ce se întâmplă cu istoricul: grupurile deja existente în WhatsApp au mesaje
   pe care nu le-am stocat niciodată. Le aduci la prima sincronizare sau pornești
   de la zero?
5. Cum arată în interfață: aceeași listă cu conversațiile unu-la-unu, sau
   separate.

Respectă designul CRM-ului (tokenii din `app/src/routes/layout.css`, Plus Jakarta
Sans, componentele shadcn existente) și scrie textele în română, trecute prin
skill-ul `humanizer`.

La final: `bunx --bun svelte-check --threshold error` fără erori, `bun run test`
verde, autofixerul Svelte curat pe fiecare componentă atinsă, și verificare
reală în browser, nu doar teste.
