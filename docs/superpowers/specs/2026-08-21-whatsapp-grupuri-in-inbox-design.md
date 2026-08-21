# Grupuri WhatsApp în inboxul /ots/whatsapp (etapa 1)

Data: 2026-08-21. Prompt sursă: `2026-08-21-whatsapp-grupuri-si-notificari-task-PROMPT.md`.

Etapa 2 (notificări de task într-un grup) nu se implementează aici. Rămâne doar
constrângerea: modelul ales trebuie să permită trimiterea în grup mai târziu.

## Punctul de plecare

Grupurile nu apar fiindcă sunt excluse la intrare, în două locuri:

- `inbound-handler.ts:79` — `resolvePhoneJid()` întoarce `null` pentru `@g.us`,
  `@broadcast`, `@newsletter` și `status@broadcast`, iar bucla sare peste mesaj.
- `contacts-store.ts:68` — `upsertChatNames()` sare peste orice chat care nu e
  `isPnUser`, deci nici subiectele grupurilor nu s-au stocat vreodată.

Contul e în 12 grupuri, unul cu 1267 de membri. Volumul e constrângerea centrală.

Fapte din cod care contează la decizii:

- `whatsapp_message.remote_jid` e NOT NULL și e deja adresa conversației. La 1:1
  conține JID-ul telefonului.
- `whatsapp_message.remote_phone_e164` e NOT NULL și e, de fapt, cheia de
  conversație în tot codul de citire.
- Indexul unic `whatsapp_message_wam_unique_idx (tenant_id, wam_id)` (migrarea
  0144) face reingerarea aceluiași mesaj inofensivă.
- `jidToE164('1203…@g.us')` întoarce `+1203…`, adică un telefon fals și plauzibil.
  Nicio cale care primește un JID de grup nu are voie s-o cheme.
- `remote_phone_e164` e citit în trei fișiere: `inbound-handler.ts`,
  `whatsapp.remote.ts` și pagina `[tenant]/whatsapp/+page.svelte`.
- Ultima migrare e 0468. Jurnalul se potrivește cu fișierele; orfanele 0338–0340
  sunt cele reparate de 0454–0456.

## Decizii

### 1. Modelul de date

În `whatsapp_message` adaug patru coloane:

| coloană | tip | rol |
|---|---|---|
| `chat_type` | text NOT NULL DEFAULT 'direct' | „direct" sau „group" |
| `sender_jid` | text | JID-ul brut al expeditorului (poate fi LID) |
| `sender_phone_e164` | text | telefonul expeditorului, când se poate rezolva |
| `sender_push_name` | text | numele afișat de WhatsApp |

`remote_phone_e164` rămâne NOT NULL și primește JID-ul grupului. Motivul: SQLite
nu poate scoate un NOT NULL fără reconstruirea tabelei (CREATE, INSERT, DROP,
RENAME plus patru indexuri), iar runnerul de migrări execută câte un singur
statement pe fișier, fără o tranzacție care să acopere toți pașii. O cădere între
DROP și RENAME ar lăsa baza fără tabel. Coloana e oricum cheia de conversație în
tot codul de citire, deci schimbarea rămâne aditivă, iar `chat_type` face
distincția explicită, ca nimic să nu ghicească după sufixul „@g.us".

`client_id` rămâne null pe mesajele de grup, ca istoricul din fișa clientului să
nu se umple cu un grup de 1267 de oameni.

Tabel nou `whatsapp_group`:

```
id, tenant_id → tenant, group_jid, subject, participant_count,
watched (bool, default 0), client_id → client (nullable),
participants_json (fotografia membrilor de la listGroups),
avatar_path, avatar_mime_type, avatar_fetched_at,
last_synced_at, created_at, updated_at
UNIQUE (tenant_id, group_jid)
```

`participants_json` traduce LID în telefon fără trafic suplimentar spre WhatsApp:
`listGroups()` întoarce deja participanții tuturor grupurilor la un singur apel.

### 2. Ce grupuri intră în inbox

Listă explicită, aleasă de admin, goală la început. Butonul „Grupuri" din capul
listei deschide un dialog care cheamă `listGroups()` o singură dată la deschidere.
Doar grupurile bifate se scriu; restul se aruncă la intrare exact ca azi, deci nu
cresc baza și nu descarcă media.

Filtrul de la intrare citește un cache în memorie per tenant, cu TTL de 60 de
secunde, ca să nu lovim baza la fiecare mesaj. Cache-ul se invalidează la bifare.

### 3. Legătura cu clientul

Manuală, pe `whatsapp_group.client_id`. Dialogul propune clientul ale cărui numere
apar cel mai des printre membri (prin `client.phone` și `user_whatsapp_link`), dar
decizia o ia omul. Automat n-are cum: un grup poate ține oameni de la mai mulți
clienți sau de la niciunul.

### 4. Istoricul

Pornim de la zero. Nu forțăm resincronizare: `syncFullHistory` înseamnă risc de
428 și de ban, plus ar reingera tot.

Ce vine de la sine rămâne. `messaging-history.set` trece deja prin
`handleInbound(..., isHistory = true)`, deci la următoarea reconectare WhatsApp
trimite fereastra lui de mesaje recente și, pentru grupurile bifate, o scriem cu
`onConflictDoNothing`. Interfața spune asta explicit, ca să nu pară defect.

### 5. Interfața

O singură listă, cronologic, lângă conversațiile unu-la-unu. Grupul se recunoaște
după subiect ca titlu, „N membri" dedesubt și expeditorul în previzualizarea
ultimului mesaj („Ana: …"). Peste listă un filtru segmentat Toate / Directe /
Grupuri. În fir, numele expeditorului deasupra fiecărui balon primit.

Caseta de răspuns rămâne activă și în grup. Avatarul grupului se aduce o singură
dată, la bifare, și se servește prin ruta de avatar existentă.

## Problemă descoperită la proiectare

`listWhatsappConversations` citește ultimele 2000 de mesaje ale tenantului și
derivă conversațiile din ele. Cu un grup vorbăreț bifat, cele 2000 de rânduri pot
fi aproape toate din grupul acela, iar conversațiile 1:1 mai vechi dispar din
listă. Înlocuiesc scanarea cu o interogare pe ultimul mesaj per conversație
(`ROW_NUMBER() OVER (PARTITION BY remote_phone_e164 ORDER BY created_at DESC)`)
plus o numărătoare separată pentru necitite. Rezolvă înfometarea și scade și
traficul cu baza.

## Ce nu fac

- Notificări automate de task (etapa 2).
- Resincronizare forțată a istoricului.
- Tabel separat pentru membrii grupului; fotografia JSON ajunge.
- Legare automată grup → client.
- Scriere în `whatsapp_contact` pentru expeditorii din grup, ca să nu umplem
  directorul de contacte cu sute de necunoscuți.

## Ce s-a schimbat la implementare

Trei lucruri au apărut abia când codul a atins date reale.

**Mențiunile.** WhatsApp scrie mențiunea în text ca număr brut („@84027092512961")
și ține numele separat. Fără traducere, firul arată cifre în loc de oameni.
LID-ul vine din fotografia membrilor, numele din `whatsapp_contact`, iar textul
stocat rămâne neatins; traducerea se face la citire (`splitMentions`) și se
desenează ca pastilă.

**Grupul abia bifat.** Lista de conversații se deducea din mesaje, deci un grup
proaspăt bifat nu apărea nicăieri până scria cineva, ca și cum bifarea n-ar fi
făcut nimic. Acum grupurile urmărite fără mesaje apar la coada listei, cu
„Niciun mesaj încă".

**Socketul cu cod vechi.** Ascultătorii Baileys rămân legați de versiunea
modulelor de la deschiderea conexiunii, deci în dezvoltare o schimbare în calea
de primire nu are efect până la o redeschidere. `POST
/[tenant]/api/_debug-whatsapp-reload` închide și redeschide conexiunea fără să
ceară iar QR-ul. În producție problema nu apare: procesul pornește cu codul nou.

## Defecte găsite la revizuire și reparate

Din calea atinsă: harta confirmărilor era decalată cu unu față de scara Baileys
(livrarea se scria ca citire), iar `resolvePhoneJid` citea `senderPn` și
`participantPn`, câmpuri care nu există pe cheia mesajului în Baileys 7 — numărul
stă pe `remoteJidAlt` la unu-la-unu și pe `participantAlt` la grup, deci
conversațiile adresate pe LID se pierdeau tăcut.

Din interfață: ciorna din caseta de răspuns trecea la alt destinatar la
schimbarea conversației; filtrul rămânea blocat pe „Grupuri" după ce bara
dispărea; paleta numelor de expeditor nu trecea pragul de contrast pe fundal
deschis; un grup debifat își pierdea numele; documentele se descărcau fără nume
și fără extensie; `ContactAvatar` rămânea pe inițiale după prima poză lipsă.

## Migrările, reparate până la capăt

O bază construită doar din migrări nu se putea face, și nu din cauza acestei teme.
Cauzele, în ordinea în care au apărut:

- `0081` folosea `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, pe care SQLite nu-l
  acceptă. Coloana e creată oricum de `0072` la instalările noi, deci fișierul a
  devenit un no-op documentat.
- `0110`, generat de drizzle-kit, readăuga șase coloane puse deja de `0099`,
  `0103`, `0106`, `0107` și `0108`.
- Șapte fișiere, `0292`–`0298`, aveau zeci de instrucțiuni fără marcajul
  `--> statement-breakpoint`. libSQL execută doar prima instrucțiune dintr-un
  apel, deci restul erau ignorate tăcut: printre ele, `CREATE TABLE
  processed_stripe_event`.
- Douăzeci și una de coloane și șapte indexuri existau doar în producție, puse de
  mână. Coloanele au intrat în `CREATE TABLE`-ul care creează tabelul, ca o bază
  nouă să le aibă din start și producția să nu fie atinsă.
- `contract_sign_token` era declarat în `schema.ts` fără nicio migrare.

În sens invers, cincisprezece indexuri definite de migrări lipseau din producție,
printre care unicitatea numărului de contract și indexurile de pe `task`. Au fost
adăugate cu `CREATE INDEX IF NOT EXISTS`, deci aceleași fișiere merg în ambele
sensuri.

`scripts/fix-migrations.ts` ridică acum `when`-ul intrărilor noi din jurnal peste
maximul existent. Fără asta, o migrare generată de `drizzle-kit` primea un `when`
de la ceasul real, cu trei ordine de mărime sub scara jurnalului, și nu s-ar mai
fi aplicat niciodată, fără niciun mesaj.

Rezultat: o bază curată are exact aceleași 152 de tabele, aceleași coloane și
aceleași indexuri ca producția.

## Verificare

`bunx --bun svelte-check` fără erori și fără avertismente, `bun run test` verde
(1651), autofixerul Svelte curat pe componentele atinse, și verificare pe date
reale în `/ots/whatsapp`: bifare, poză de grup, propunere de client, trimitere în
grup, primire prin Baileys cu LID tradus în telefon, mențiune ca pastilă,
descărcare de document. Migrările verificate prin construirea unei baze goale și
comparație tabel cu tabel, coloană cu coloană și index cu index față de producție.
