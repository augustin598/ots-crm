# Prompt pentru sesiunea următoare: WhatsApp, etapa 4

Copiază tot ce e sub linie într-o sesiune nouă.

---

## Ce vreau

Trei lucruri, în ordinea asta:

**1. Socketul WhatsApp nu mai are voie să se piardă la deploy.** Azi, la
fiecare rollout, pornesc două pod-uri odată, ambele restaurează sesiunea
Baileys și se bat pe ea (trei „Connection closed (440): Stream Errored
(conflict)" în cinci secunde). Câștigă unul singur, iar dacă Kubernetes îl
oprește tocmai pe acela, nimeni nu mai are socket. Mai rău: `whatsapp_session`
rămâne pe `connected`, deci nimic nu semnalizează, iar WhatsApp tace până când
cineva apasă manual `POST /ots/api/_debug-whatsapp-reload`. S-a întâmplat pe
21 august la 22:27 și un mesaj `/task` s-a pierdut fără urmă.

Vreau: un heartbeat pe sesiune (pod-ul care ține socketul scrie periodic o
urmă; alt pod o preia dacă urma e veche de câteva minute), statusul marcat
`disconnected` la oprirea pod-ului, și un semnal vizibil când nicio instanță nu
are socket mai mult de câteva minute (log de eroare, notificare, ceva ce se
vede). Contează mai mult decât orice altă funcție: fără socket, tot ce am
construit tace în tăcere.

Nu ținti reconectarea în general: pe 22 august dimineața, conexiunea s-a
pierdut de două ori (408, „Connection was lost") și s-a refăcut singură în opt
secunde. Mecanismul de reconectare e sănătos; cazul de reparat e strict bătaia
dintre două pod-uri la deploy, unde câștigătorul e apoi oprit de Kubernetes.

**2. Mențiunile care nu ajung nicăieri.** Editarea unui comentariu
(`updateTaskComment`, `task-comments.remote.ts:452`) nu notifică absolut nimic:
nici email, nici in-app, nici Telegram, nici grupul WhatsApp. Dacă adaugi un
`@Nume` prin editare, mențiunea moare. La reparare, notifică doar mențiunile
**noi**, prin diferență față de conținutul vechi, altfel fiecare editare
re-anunță pe toată lumea.

**3. În portalul clientului, `@` deschide un dropdown gol.**
`client-task-comments.svelte` montează `RichEditor` fără prop-ul `users`, iar
implicitul e `[]`, deci apare „No users found" — în engleză, într-o interfață
în română. Clientul e singura parte care nu poate menționa pe nimeni, deși
backendul acceptă mențiunile lui.

## Context, ca să nu redescoperi

Etapele 1–3 sunt livrate și în producție. Citește integral, înainte de orice:

- `docs/superpowers/specs/2026-08-21-whatsapp-grupuri-in-inbox-IMPLEMENTAT.md`
  (etapa 1: grupurile în inbox)
- `docs/superpowers/specs/2026-08-21-whatsapp-task-notificari-grup-IMPLEMENTAT.md`
  (etapele 2 și 3: notificări de task în grup și comanda `/task`; are secțiunile
  „Capcane întâlnite", „Găsit la auditul mențiunilor, NEreparat" și „Defect de
  infrastructură")

Pe scurt, ce există:

- `task.whatsapp_group_id` leagă un task de un grup bifat; cardul din pagina
  task-ului îl setează (doar admin), cu propunere după clientul task-ului.
- Hook-ul `task.status-changed` se emite din toate cele șapte căi care scriu
  `status` (`emitTaskStatusChanged` în `tasks.remote.ts`). WhatsApp ascultă
  **doar** acolo; Telegram a rămas pe `task.completed`.
- Livrarea trece prin `whatsapp_outbox`, golit de o buclă pornită în
  `session-manager` la `connection === 'open'`, deci garantat pe instanța cu
  socketul. Coalescere 120 s, plafon 60 mesaje/oră/tenant, backoff, expirare la
  6 ore. Se vede în Admin → Logs și Debug → tab-ul WhatsApp.
- Mențiunea reală cere ancora `@<cifrele numărului>` în text, nu `@Nume`; cu
  numele, `mentionedJid` rămâne metadată moartă și nu notifică pe nimeni.
- `/task …` din grup creează task `pending-approval` pe clientul grupului, doar
  de la numere cunoscute, cu limite de rată și idempotență pe `wam_id`.

## Capcane care te costă timp

- **Hook-urile nu se reînregistrează la HMR.** După orice editare în
  `src/lib/server/hooks/*.ts`, handlerul nou nu rulează până la restartul
  serverului de dev. Simptomul e tăcere, nu eroare.
- **Socketul Baileys rulează codul de la deschidere.** După schimbări în calea
  de primire (`inbound-handler.ts`, `task-command.ts`), în dev trebuie
  `POST /ots/api/_debug-whatsapp-reload`. Pentru trimitere nu e nevoie.
- **Jurnalul drizzle poate fi sub remote.** `db:migrate` sare în tăcere
  migrările al căror `when` e sub `max(created_at)` din `__drizzle_migrations`
  de pe Turso. Verifică maximul remote înainte, apoi confirmă cu
  `PRAGMA table_info`. Ultima migrare e 0489.
- **`scripts/fix-migrations.ts` adaugă `IF NOT EXISTS`** în fișierele
  neurmărite, contrar regulii casei. Scoate-le după ce-l rulezi.
- **Verifică `git show --stat` înainte de a spune că un fix e gata.** Un `cd`
  picat mi-a oprit odată scriptul de editare, am comis doar documentul și am
  declarat fix-ul livrat; a ieșit la iveală abia pe telefon.
- `bun run test`, niciodată `bun test`.
- Testul live de mențiune are efecte reale: un comentariu pe un task cu client
  trimite emailuri către toate contactele clientului cu notificări de taskuri
  pornite (la Lucky Group sunt șase). Dacă vrei un test fără blast, comentează
  din portalul clientului: acolo blocul de email către client se sare.
- Comanda `/task` nu merge scrisă de pe telefonul care ține contul WhatsApp al
  firmei (`fromMe` e sărit intenționat). Folosește un telefon de membru.

## Mărunțișuri, dacă rămâne timp

- Mesajul de acceptare pleacă în coada din Admin cu eticheta „Status task",
  fiindcă `notifyTaskStatusChangedInGroup` folosește `kind: 'task.status'`
  indiferent de `reason`. Un fel propriu (`task.approved`) l-ar face filtrabil.
- Respingerea unui task n-are mesaj propriu: grupul primește anunțul generic
  „a trecut task-ul în Anulat", fără motiv.
- Task-ul „Test notificări WhatsApp (etapa 2)" e încă legat de grupul intern:
  orice mutare a lui trimite un mesaj. Dezleagă-l sau șterge-l când nu mai e
  nevoie de el.

## Cum vreau să lucrezi

Plan scurt înainte de cod, cu deciziile și motivele lor. Teste înainte de
implementare. Commit pe bucăți logice. Nu face deploy fără să întrebi. Textele
în română, fără liniuță lungă, trecute prin skill-ul humanizer.

Pentru verificare live folosește grupul intern („Mădălina & Claudia & Mihai &
Sergiu & Augustin & Andrei", legat de clientul Lucky Group) și task-ul de test
„Test notificări WhatsApp (etapa 2)" (`3q76c5mbf7d4p6wrwh7i32vt`), care e încă
legat de grup. Nu folosi grupul „Ads Retail Beautyone": are clienți reali.
