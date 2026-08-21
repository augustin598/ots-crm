# Socketul care nu se mai pierde, plus mențiunile care ajung (etapa 4)

Continuă `2026-08-21-whatsapp-task-notificari-grup-IMPLEMENTAT.md` (etapele 2 și
3) și `2026-08-21-whatsapp-grupuri-in-inbox-IMPLEMENTAT.md` (etapa 1).

Trei lucruri, în ordinea în care contează:

1. socketul WhatsApp se ține prin lease, cu bătaie de inimă și preluare
   automată, iar tăcerea are acum cine s-o strige;
2. o mențiune adăugată prin editarea unui comentariu ajunge la om;
3. în portalul clientului, „@" deschide lista de oameni.

## 1. Lease pe socket, bătaie de inimă, santinelă

### Ce era

La fiecare rollout porneau două pod-uri deodată, amândouă restaurau aceeași
sesiune Baileys și se dădeau afară reciproc: trei „Connection closed (440):
Stream Errored (conflict)" în cinci secunde. Câștiga unul singur, iar dacă
Kubernetes îl oprea tocmai pe acela nu mai avea nimeni socket. Mai rău,
`whatsapp_session.status` rămânea pe `connected`, deci nimic nu semnaliza.
Pe 21 august la 22:27 au fost patru minute de tăcere completă și un mesaj
`/task` pierdut fără urmă. Paliativul era `POST /ots/api/_debug-whatsapp-reload`,
apăsat de un om care bănuia ceva.

### Modelul

Migrarea 0490 adaugă pe `whatsapp_session`:

| coloană | rol |
|---|---|
| `owner_instance_id` | instanța care ține socketul acum |
| `heartbeat_at` | urma ei, rescrisă din minut în minut |
| `stale_alert_at` | când s-a dat ultima alarmă, ca să nu se repete la fiecare rulare |

Identitatea instanței e `HOSTNAME` plus un sufix aleator, ținut pe `globalThis`
(`instanceId()`). Sufixul contează: la un restart rapid, un proces nou cu
același nume de pod ar moșteni altfel lease-ul celui vechi și ar crede că are
socket.

### Pragurile

`src/lib/server/whatsapp/session-lease.ts`, toate exportate și testabile:

- bătaia de inimă: 60 s;
- expirarea lease-ului: 3 minute (trei bătăi ratate). Destul cât o pauză de GC
  sau o clipire a bazei să nu ducă la furtul socketului, destul de puțin cât
  preluarea după un pod ucis să se măsoare în minute;
- bucla de preluare: 60 s, pe fiecare instanță;
- alarma: după 5 minute de tăcere, repetată cel mult o dată la 30 de minute.

### Cum se ține socketul

`startSession(tenantId, { force })` cere întâi lease-ul printr-un `UPDATE`
condiționat (`owner IS NULL OR owner = eu OR heartbeat_at < prag`) și deschide
socketul doar dacă a afectat un rând. SQLite serializează scrierile, deci două
pod-uri nu pot reuși amândouă: al doilea vede urma proaspătă a primului și
primește `SessionHeldElsewhereError`, pe care apelantul o tratează ca „nu tu",
nu ca eroare.

Bătaia de inimă pornește odată cu socketul, nu la `connection === 'open'`:
împerecherea poate dura mai mult decât fereastra de expirare. Fiecare bătaie
verifică întâi că procesul chiar are socket (altfel eliberează lease-ul: o urmă
care înseamnă „am pornit cândva" ar fi aceeași minciună, în alt loc), apoi
scrie. Dacă scrierea descoperă că lease-ul a trecut la altcineva, instanța își
închide singură socketul, ca să nu ajungem la două socket-uri în conflict.

`force` e doar pentru apăsările de buton ale unui om: „Conectează" din pagină și
`POST /ots/api/_debug-whatsapp-reload`. Automatismele (restaurarea la pornire,
bucla de preluare, reconectarea automată) nu forțează niciodată.

### Cum se preia

`ensureSessionsClaimed()` rulează la pornirea fiecărei instanțe și apoi la
fiecare minut, pe fiecare instanță. Ia sesiunile cu status `connected`,
`connecting` sau `disconnected` care n-au stăpân viu.

Două detalii care nu se văd din cod la prima citire:

- **Statusul nu mai e criteriul de restaurare.** Oprirea planificată a pod-ului
  (SIGTERM) eliberează lease-ul și scrie `disconnected`, ca baza să nu mai
  mintă. Dacă restaurarea ar cere în continuare doar `status = 'connected'`, un
  pod oprit curat n-ar mai fi pornit niciodată de nimeni.
- **Se sar sesiunile fără telefon.** „Deconectează" face logout și golește
  `phone_e164`. Fără filtrul ăsta, bucla ar învia la nesfârșit o sesiune scoasă
  din priză intenționat și ar cere QR din senin.

### Semnalul

`whatsapp-session-watchdog`, job de scheduler la 5 minute. Când urma e mai
veche de 5 minute:

1. scoate minciuna din baza de date (`connected` devine `disconnected`), deci și
   pagina, și `loadSessionIdForTenant` spun același lucru;
2. scrie o eroare, vizibilă în Admin → Logs;
3. notifică administratorii în aplicație (`whatsapp.session_down`) și pe
   Telegram, cel mult o dată la jumătate de oră.

Preluarea nu se face în job: jobul rulează pe o singură instanță (BullMQ), iar
preluarea trebuie să poată porni de pe oricare.

### Fișiere

- `src/lib/server/whatsapp/session-lease.ts` (+ `session-lease.test.ts`, 17 teste)
- `src/lib/server/whatsapp/session-manager.ts`: `startSession(tenantId, {force})`,
  `SessionHeldElsewhereError`, `startHeartbeat`/`stopHeartbeat`,
  `ensureSessionsClaimed`, `startEnsureLoop`, `shutdownAllSessions` care
  eliberează lease-ul
- `src/lib/server/scheduler/tasks/whatsapp-session-watchdog.ts` (+ 5 teste)
- `src/lib/server/db/schema.ts`, `drizzle/0490_whatsapp_session_lease.sql`
- `src/routes/[tenant]/api/_debug-whatsapp-reload/+server.ts`: GET arată acum și
  `instanceId` și lease-ul

`getSessionStatus` întoarce `heartbeatAt` și `activeHere`, dar NU numele
instanței: pagina e vizibilă oricărui membru, iar numele pod-ului nu-i spune
nimic. Cine are nevoie de el are endpointul de diagnostic, care e admin-only.

## 2. Mențiunile adăugate prin editare

`updateTaskComment` nu notifica absolut nimic. Acum notifică, dar **doar
mențiunile noi**, prin diferență față de conținutul dinainte (ambele texte
sanitizate, deci comparabile). Altfel orice corectură de virgulă ar fi
re-anunțat toată lumea menționată vreodată în comentariul acela.

Emailul merge doar către cei nou menționați, nu către lista completă de la un
comentariu nou: o editare nu e un comentariu nou și n-are de ce să sune la
responsabili și urmăritori. Filtrul de tenant rămâne cel din
`resolveTaskRecipients`, iar comutatorul `internalEmailOnComment` se aplică la
fel ca la creare.

Canalele personale ale unei mențiuni au ieșit din `createTaskComment` în
`src/lib/server/task-comment-mentions.ts`, folosit acum de ambele căi:
notificarea în aplicație, Telegram, și un singur mesaj în grupul WhatsApp
pentru toți cei menționați. Tot acolo stau `extractMentionIds` și
`newMentionIds`. Editarea NU adaugă o intrare nouă „a comentat" în cronologie:
o editare nu e un comentariu.

Teste: `src/lib/server/__tests__/task-comment-mentions.test.ts` (12).

## 3. „@" în portalul clientului

`client-task-comments.svelte` monta `RichEditor` fără prop-ul `users`, iar
implicitul e o listă goală, deci clientul primea „No users found", în engleză,
într-o interfață în română.

Lista vine acum din `client-task-detail-body.svelte`: echipa agenției
(`getTenantUsers`, deja redactată pentru portal) plus echipa clientului care are
acces la taskuri (`getAssignableClientUsers`, nu `getClientUsers`). Contactele
fără acces n-au ce căuta acolo: linkul din notificare le-ar duce într-un 403.
Merge și în comentariu, și în răspuns.

Textul gol e acum „Niciun utilizator găsit", peste tot unde apare editorul.

## Cum se verifică

```bash
cd app
bun run test               # 1742 pass / 146 fișiere
bunx --bun svelte-check --threshold error
```

Live, după deploy:

1. `GET /ots/api/_debug-whatsapp-reload` arată `instanceId`, lease-ul
   (proprietar + urmă) și starea. Urma trebuie să fie mai nouă de un minut.
2. La un rollout, în loguri trebuie să apară cel mult o singură deschidere de
   socket, nu două, și niciun 440. Pod-ul care nu ia lease-ul scrie „lease ținut
   de altă instanță".
3. După oprirea pod-ului cu socketul, alt pod trebuie să-l preia în cel mult
   două minute („Sesiune preluată de instanța curentă" în loguri).
4. Mențiune prin editare: editezi un comentariu vechi, adaugi un `@Nume`, iar
   omul primește notificare în aplicație și, dacă are numărul în
   `user_whatsapp_link`, mesajul din grup. Cine era deja menționat nu primește
   nimic. Atenție la efectele reale de la testul live (vezi capcanele din etapa 2).
5. Portal: pe un task cu client, „@" în caseta de comentariu arată echipa
   agenției și colegii cu acces la taskuri.

## Ce a rămas nereparat

Din lista de la auditul mențiunilor (etapa 2), nerezolvate încă:

- pagina `/[tenant]/tasks/[taskId]` alimentează lista de mențiuni cu
  `getClientUsers` (toate contactele clientului), nu cu
  `getAssignableClientUsers`; portalul folosește de acum varianta corectă, dar
  partea de agenție nu;
- `getTenantUsers` nu filtrează `tenant_user.status`, deci membrii suspendați
  apar în sugestii și primesc notificări;
- un rând rămas în `sending` la o cădere de proces se retrimite după 5 minute
  fără să compare `wam_id`, deci un mesaj deja livrat se poate dubla;
- garda „grup debifat" se aplică doar la punerea în coadă; un rând deja în coadă
  pleacă și dacă grupul a fost debifat între timp.

Și, din etapa 2: nu există preferință „vreau sau nu notificări WhatsApp", nu
există alte comenzi în grup, iar respingerea unui task n-are mesaj propriu.

## Capcane, adăugate la lista veche

- **Jurnalul drizzle.** Migrarea 0490 are `when` mult peste maximul local
  (1787342400000000), tocmai ca să nu poată fi sărită în tăcere dacă remote-ul
  e mai sus. Confirmă după `db:migrate` cu `PRAGMA table_info(whatsapp_session)`
  că există `owner_instance_id`, `heartbeat_at` și `stale_alert_at`.
- **Coloanele de timp se compară ca text.** `timestamp` din schema noastră
  scrie `toISOString()`, iar comparațiile (`heartbeat_at < prag`) merg fiindcă
  ISO-8601 se sortează lexicografic. O coloană scrisă cu
  `default current_timestamp` (format „YYYY-MM-DD HH:MM:SS", fără T) NU se
  compară corect cu una scrisă din aplicație. `heartbeat_at` n-are default,
  deci toate valorile ei vin din aplicație.
- **Bucla de preluare pornește din `restoreAllSessions`**, deci din `init` din
  `hooks.server.ts`, sub garda de HMR. În dev, după o schimbare acolo, e nevoie
  de restart pentru ca bucla nouă să ruleze.
