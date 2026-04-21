# Baileys — Ghid de utilizare pentru OTS CRM

Biblioteca oficială: [baileys](https://www.npmjs.com/package/baileys) · docs: <https://baileys.wiki/docs/intro>

Rulat prin WhatsApp Web multi-device — apare ca un dispozitiv conectat pe telefonul utilizatorului. Neoficial din punct de vedere Meta, deci **risc de ban al numărului**.

---

## 1. Setup socket (`makeWASocket`)

```ts
import makeWASocket, { Browsers, fetchLatestBaileysVersion, DisconnectReason, proto } from 'baileys';
import pino from 'pino';

const { version } = await fetchLatestBaileysVersion(); // [2, 3000, xxxx]

const sock = makeWASocket({
  version,
  auth: authState,                  // AuthenticationState (creds + keys)
  logger: pino({ level: 'silent' }),
  browser: Browsers.macOS('Desktop'),   // OBLIGATORIU pentru full history sync
  printQRInTerminal: false,
  syncFullHistory: true,                // cere history la pairing (doar prima dată)
  markOnlineOnConnect: false,           // lasă telefonul ca dispozitiv primar
  getMessage: async (key) => { /* returneaza proto.Message pt decrypt retry */ }
});
```

### Opțiuni critice observate la production
| Opțiune | Recomandare | De ce |
|---|---|---|
| `browser` | `Browsers.macOS('Desktop')` sau `['Name','Desktop','1.0']` | Chrome/Safari nu primesc history; Desktop da |
| `syncFullHistory` | `true` pentru prima conectare | Doar la fresh pair, nu la reconnect |
| `markOnlineOnConnect` | `false` | Evităm să „furăm" notificările de pe telefon |
| `getMessage` | obligatoriu în producție | Baileys cere mesaj original la retries/polls |
| `shouldSyncHistoryMessage` | fn → `true/false` | Control fin care mesaje istoric păstrezi |
| `cachedGroupMetadata` | cache LRU | Evităm rate-limit pe grupuri (nu e cazul Faza 1) |

---

## 2. Authentication state

Persistă între reconectări. **Nu folosi `useMultiFileAuthState` în producție multi-tenant** — scrie prea frecvent pe disk. Scriem propriul store (debounced flush) care persistă în MinIO criptat cu AES-256-GCM per tenant.

Shape obligatoriu:
```ts
interface AuthenticationState {
  creds: AuthenticationCreds;   // device identity, registration, signed prekeys
  keys: SignalKeyStore;         // pre-keys, session states, app-state keys
}
```

`SignalKeyStore` are `get(type, ids)` și `set(data)`. Tipuri: `session`, `pre-key`, `sender-key`, `app-state-sync-key`, `app-state-sync-version`, `app-state-mutations`, `sender-key-memory`.

Pattern nostru (`src/lib/server/whatsapp/auth-store.ts`):
1. In-memory `store = { creds, keys: Record<type, Record<id, value>> }`
2. `writeData` → buffer în memory + `setTimeout(flushToMinIO, 1500)`
3. La crash între flush-uri → re-scan QR (acceptabil)

---

## 3. Evenimente (event emitter pe `sock.ev`)

### Conexiune
```ts
sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
  // connection: 'connecting' | 'open' | 'close'
  // qr: string | undefined — generăm QR code și afișăm în UI
  // lastDisconnect.error.output.statusCode → DisconnectReason.*
});

sock.ev.on('creds.update', () => saveCreds());
```

### `DisconnectReason` common codes
| Cod | Enum | Semnificație | Acțiune |
|---|---|---|---|
| 401 | `loggedOut` | User a apăsat logout pe telefon sau cont banat | Șterge creds, cere re-scan |
| 408 | `timedOut` | Conexiune pierdută | Reconnect |
| 428 | `connectionClosed` | Server închis conexiunea | Reconnect |
| 440 | `connectionReplaced` | Alt client cu aceleași creds s-a conectat | STOP (nu reconnect, altfel loop) |
| 500 | `badSession` | Creds corupte | Șterge creds + re-scan |
| 515 | `restartRequired` | Baileys cere restart | Reconnect |

**Notă ban vs logout**: Meta nu trimite cod explicit de ban. Ambele apar ca `loggedOut` (401). Diferență: ban = numărul nu mai poate relink, logout voluntar = poate. Nu putem distinge automat.

### Mesaje
```ts
sock.ev.on('messages.upsert', ({ messages, type }) => {
  // type: 'notify' (live) | 'append' (reconnect buffer) | 'prepend' | 'replace'
  for (const msg of messages) {
    // msg.key.id, msg.key.remoteJid, msg.key.fromMe
    // msg.message.conversation | extendedTextMessage.text | imageMessage | ...
    // msg.pushName — numele public al expeditorului (profile name)
    // msg.messageTimestamp — unix seconds
  }
});

sock.ev.on('messages.update', (updates) => {
  // { key, update: { status?: 1|2|3|4|5 } } — ack status
});

sock.ev.on('messaging-history.set', ({ messages, contacts, chats, isLatest, progress }) => {
  // Bulk history din telefon după pairing initial (cu Desktop browser)
  // progress: 0-100, emis de mai multe ori
});
```

### Status ack codes
| Status | Semnificație |
|---|---|
| 1 | ERROR (fail) |
| 2 | PENDING (trimis pe socket, neconfirmat) |
| 3 | SERVER_ACK (recepționat de server Meta) |
| 4 | DELIVERY_ACK (livrat la destinatar) |
| 5 | READ (destinatar a citit) |

Mapăm: 4 → 'delivered', 5 → 'read', 3 → 'sent', 1 → 'failed'.

### Contacte și chat-uri
```ts
sock.ev.on('contacts.upsert', (contacts: Contact[]) => {
  // c.id, c.notify (profile name), c.name (address book), c.verifiedName (business)
});
sock.ev.on('contacts.update', (updates: Partial<Contact>[]) => { });
sock.ev.on('chats.upsert', (chats: Chat[]) => {
  // c.id, c.name (eticheta ta din agenda telefonului)
});
sock.ev.on('chats.update', (updates: Partial<Chat>[]) => { });
```

**Sursele de nume disponibile** (prioritizare recomandată):
1. `displayName` — editat manual de user în CRM (override total)
2. `chat.name` — eticheta din agenda telefonului user-ului
3. `contact.name` / `contact.notify` — din app-state-sync
4. `msg.pushName` — profile name al expeditorului (se schimbă când contact își editează profil)
5. E.164 — fallback

---

## 4. JID (WhatsApp ID) tipuri

| Sufix | Tip | Exemplu | Acțiune Faza 1 |
|---|---|---|---|
| `@s.whatsapp.net` | Număr telefon public | `40722123456@s.whatsapp.net` | ✅ Accept |
| `@lid` | Linked Identifier (privacy-masked) | `123456@lid` | ❌ Skip (fără telefon real) |
| `@g.us` | Grup | `123-456@g.us` | ❌ Skip Faza 1 |
| `@broadcast` | Listă broadcast | `...@broadcast` | ❌ Skip |
| `@newsletter` | Canal newsletter | `123@newsletter` | ❌ Skip |
| `status@broadcast` | Status (story) | — | ❌ Skip |

Helper `isPnUser(jid)` din Baileys → `true` doar pentru `@s.whatsapp.net`.

---

## 5. Trimitere mesaje (`sock.sendMessage`)

### Text
```ts
const sent = await sock.sendMessage(jid, { text: 'Salut' });
// sent.key.id → WhatsApp message ID ("wamid" extins)
```

### Reply/quote
```ts
await sock.sendMessage(jid, { text: 'Răspuns' }, { quoted: originalMsg });
```

### Imagine
```ts
await sock.sendMessage(jid, {
  image: buffer,             // Buffer | { url: 'file:///...' } | { stream }
  caption: 'Optional caption',
  mimetype: 'image/jpeg'
});
```

### Document (PDF etc.)
```ts
await sock.sendMessage(jid, {
  document: buffer,
  fileName: 'Factura.pdf',
  mimetype: 'application/pdf',
  caption: 'Factura lunii martie'
});
```

### Audio / voice
```ts
await sock.sendMessage(jid, {
  audio: buffer,
  mimetype: 'audio/mp4',
  ptt: true                  // true = voice note, false = attached audio
});
```

### Video
```ts
await sock.sendMessage(jid, {
  video: buffer,
  caption: '...',
  gifPlayback: false
});
```

### Reacție
```ts
await sock.sendMessage(jid, {
  react: { text: '👍', key: msg.key }
});
```

### Presence (typing indicator)
```ts
await sock.sendPresenceUpdate('composing', jid);   // arată „scrie..."
// ... delay ...
await sock.sendMessage(jid, { text });
await sock.sendPresenceUpdate('paused', jid);
```

**Pattern anti-ban** (obligatoriu pentru reverse-engineered):
- Delay random 3-7s între mesaje text, 8-15s pentru media
- Presence `composing` înainte de send → arată natural
- Limit daily (ex. 100 text + 50 media / zi per număr)

---

## 6. Descărcare media (inbound)

```ts
import { downloadMediaMessage } from 'baileys';

const buffer = await downloadMediaMessage(
  msg,
  'buffer',              // sau 'stream'
  {},                    // opțiuni
  {
    logger: silentLogger,
    reuploadRequest: sock.updateMediaMessage   // pentru media expirat
  }
);
// buffer → upload în MinIO → presigned URL → afișare în UI
```

**Flow recomandat**:
1. Primești `messages.upsert` cu imageMessage/documentMessage/etc.
2. Detectează tipul → `downloadMediaMessage(msg, 'buffer')`
3. Upload buffer în MinIO: `uploads/<tenantId>/whatsapp/media/<messageId>.<ext>`
4. Salvează path în `whatsapp_message.media_path` + `media_mime_type`
5. UI: generează presigned URL la afișare (cu `getDownloadUrl(path, 3600)`)

**Memory**: buffer în RAM OK până ~20MB. Pentru fișiere mari folosește stream:
```ts
const stream = await downloadMediaMessage(msg, 'stream');
await minioClient.putObject(bucket, key, stream, size);
```

---

## 7. History sync (full address book + chats + messages)

Se declanșează **doar o dată** la fresh pairing cu `browser=Desktop` + `syncFullHistory: true`.

```ts
sock.ev.on('messaging-history.set', ({ messages, contacts, chats, isLatest, progress }) => {
  console.log(`batch: messages=${messages.length} contacts=${contacts.length} chats=${chats.length} progress=${progress}%`);
  // Persistă în DB
  // isLatest=true la ultimul batch
});
```

**Timp sync**: 30s - 15 minute depinzând de volumul de chat-uri. În timpul sync-ului:
- NU face restart server
- NU șterge creds
- NU salvezi fișiere (HMR = restart efectiv în dev mode)

**Re-sync programatic**: WhatsApp nu permite retrimiterea history la request client. Singura opțiune: re-pair (șterge creds + re-scan QR) care forțează fresh sync.

Pentru contacte live ulterior: fiecare mesaj nou conține `pushName` → persistă; fiecare `chats.upsert` nou conține `name` → persistă.

---

## 8. Logout curat

```ts
// Graceful (WhatsApp marchează device logged out):
await sock.logout();

// Doar închide socket (device rămâne linked):
sock.end(undefined);
```

**Obligatoriu pe SIGTERM**: `await sock.end(undefined)` — altfel WhatsApp vede device-ul "zombi" → la repornire apar mesaje ghost sau conflict 440.

---

## 9. Arhitectură OTS CRM

```
┌─────────────── UI (SvelteKit 5) ───────────────┐
│  /[tenant]/whatsapp — inbox split view          │
│  Polling 1s (status + QR) + 3s (mesaje)        │
└────────────┬────────────────────────────────────┘
             │ remote functions ($lib/remotes/whatsapp.remote.ts)
┌────────────▼────────────────────────────────────┐
│  SessionManager (globalThis singleton)           │
│  Map<tenantId, ActiveSession>                    │
│  startSession / stopSession / sendText           │
│  Bootstrap pe init + Shutdown pe SIGTERM         │
└────┬───────┬──────────┬────────────┬─────────────┘
     │       │          │            │
┌────▼──┐ ┌──▼──┐  ┌────▼────┐ ┌────▼─────┐
│MinIO  │ │Redis│  │Turso DB │ │Logs      │
│creds  │ │locks│  │sessions │ │debug_log │
│media  │ │QR   │  │messages │ │          │
│encryp.│ │cache│  │contacts │ │          │
└───────┘ └─────┘  └─────────┘ └──────────┘
```

---

## 10. Fișiere în proiect

| Fișier | Rol |
|---|---|
| `src/lib/server/whatsapp/session-manager.ts` | Singleton + event handlers |
| `src/lib/server/whatsapp/auth-store.ts` | AuthenticationState MinIO backend |
| `src/lib/server/whatsapp/minio-helpers.ts` | Bucket ops (put/get/remove) |
| `src/lib/server/whatsapp/inbound-handler.ts` | Parse mesaje + persist |
| `src/lib/server/whatsapp/contacts-store.ts` | Upsert pushName / chat names |
| `src/lib/server/whatsapp/qr-broker.ts` | Cache QR + SSE broker (unused acum, rezervat) |
| `src/lib/server/whatsapp/rate-limiter.ts` | Humanized delay 3-7s |
| `src/lib/server/whatsapp/phone.ts` | E.164 helpers + JID conversion |
| `src/lib/remotes/whatsapp.remote.ts` | Public API pentru UI |
| `src/routes/[tenant]/whatsapp/+page.svelte` | Inbox split view UI |
| `src/lib/components/marketing/icon-whatsapp.svelte` | Logo verde WhatsApp |

Schema DB: `whatsapp_session`, `whatsapp_message`, `whatsapp_contact` (migrații `0134-0142`).

---

## 11. Probleme frecvente & workarounds

| Problemă | Cauză | Fix |
|---|---|---|
| `Stream Errored (conflict) 440` | 2 sockets pe același device | Singleton pe `globalThis` (symbol) + guard init |
| QR nu apare în UI | SSE buffered de dev server | Am trecut pe polling 1s în remote |
| Mesaje cu telefon ciudat (ex. `+84027...`) | LID în loc de PN | Filtrează cu `isPnUser(jid)` |
| Contact apare ca `[unknown]` | Mesaj protocol (senderKeyDistribution, etc.) | `detectMessageType` returnează null → skip |
| Nume truncat (ex. `Luc` în loc de `Lucian`) | Push name e exact cum a setat contactul | User re-etichetează manual |
| History sync nu vine după reconnect | Creds persistate → Baileys consideră sync deja făcut | Re-pair (delete creds + re-scan) |
| App-state-sync întârzie | Control server-side Meta | Acceptă eventual consistency |

---

## 12. Scalare & producție

- **1 pod = 1 SessionManager** cu ~100MB RAM per sesiune activă. 50 tenants = 5GB. 
- **Multi-pod**: necesită Redis lock per-tenant (doar un pod deține socket) — TODO Faza 3.
- **HMR în dev**: risc de duplicate sockets — mitigat cu `globalThis`.
- **SIGTERM**: obligatoriu `shutdownAllSessions()` pentru clean logout.
- **Monitoring**: watch `process.memoryUsage()` — alert la >80% heap.
- **Media files MinIO**: vor crește rapid. Implementează retention policy (ex. media > 6 luni → arhivare sau delete).

---

## 13. Legalitate & risc

Baileys folosește reverse-engineered WhatsApp protocol → **violează ToS Meta**:
- Meta poate ban-a numărul oricând (fără preaviz)
- Ban = număr invalid pe WhatsApp permanent
- Meta schimbă protocolul periodic → Baileys se rupe (se repară în zile/săptămâni)

**Utilizare acceptabilă**: discuții 1-on-1, volum mic (<100 msg/zi), nume real în profil, comportament uman (delay, typing).

**Utilizare cu risc înalt de ban**: spam, bulk campaigns, media spam, număr nou cu mesagerie agresivă din prima zi, profile fake/business neverificat.

Pentru producție seriosă sau reglementată, folosește **WhatsApp Business Cloud API** (oficial, plătit, 0 risc de ban).

---

## 14. Resurse

- Docs oficial: <https://baileys.wiki/docs/intro>
- GitHub: <https://github.com/WhiskeySockets/Baileys>
- Discord suport: link în readme GitHub
- Raportează bug-uri: <https://github.com/WhiskeySockets/Baileys/issues>
