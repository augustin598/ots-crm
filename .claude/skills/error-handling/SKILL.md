# OTS CRM - Error Handling, Logging, Validation & Admin Logs

## CONTEXT PROIECT

- **Proiect**: OTS CRM (One Top Solution CRM)
- **Stack**: SvelteKit + Bun + TypeScript + Drizzle ORM + PostgreSQL
- **Repo**: `augustin598/ots-crm`
- **Domeniu producție**: `clients.onetopsolution.ro`
- **Utilizatori**: admin (Augustin) + clienți (acces limitat)
- **Limba UI clienți**: Română
- **Limba cod/logs interne**: Engleză

## IMPORTANT: REGULI DE LUCRU

1. **Analizează ÎNTÂI** structura existentă a proiectului: schema Drizzle, rutele existente, layout-urile, componente UI, fișierul `logger.ts` existent (dacă există), hooks existente (`hooks.client.ts`, `hooks.server.ts`), și orice toast system deja implementat.
2. **Nu suprascrie** codul existent fără motiv. Extinde-l, nu-l înlocui.
3. **Nu scrie cod până nu ai analizat**. Folosește Plan mode. Raportează ce ai găsit, propune structura, apoi implementează.
4. **TypeScript strict**, fără `any`. Toate tipurile explicite.
5. **Nu folosi em dash** (cele lungi) în niciun fișier sau comentariu.
6. **Mesajele toast** pentru utilizatori sunt în **Română**.
7. **Log-urile din DB** sunt în **Engleză** (consistență tehnică).
8. **Nu introduce dependențe noi** fără a verifica dacă există deja o alternativă în proiect.
9. **Respectă structura de foldere existentă** (ex: dacă rutele sunt în `[lang]/admin/`, nu crea rute fără `[lang]`).

---

## FAZA 0: ANALIZĂ (OBLIGATORIE ÎNAINTE DE COD)

Înainte de orice implementare, analizează și raportează:

```
1. Citește schema Drizzle existentă (schema.ts sau src/lib/server/db/schema.ts)
   - Ce tabele există deja?
   - Există deja o tabelă de logs?
   - Care e pattern-ul de enum-uri (pgEnum)?
   - Ce versiune de Drizzle e în package.json? (afectează sintaxa indexurilor)

2. Citește hooks existente:
   - src/hooks.client.ts
   - src/hooks.server.ts
   - Ce error handling există deja?
   - Există deja handleError hook?

3. Citește logger existent:
   - src/lib/logger.ts (există deja, referințe la logger.ts:60 și logger.ts:147)
   - Ce funcționalitate are? Console wrapper? Benign error filtering?
   - Ce exportă? Ce pattern folosește?

4. Citește toast system existent:
   - Există componente de toast/notification?
   - Ce librărie UI folosește proiectul? (shadcn-svelte, bits-ui, sonner?)
   - Dacă există deja toast, NU crea altul. Extinde-l.

5. Structura rutelor admin:
   - Există /admin/ routes? (referință la /admin/requests)
   - Care e layout-ul admin? Există +layout.svelte în admin?
   - Cum e protejat accesul admin? (middleware, hook, layout load?)

6. Pattern-uri API:
   - Cum sunt structurate API routes existente? (src/routes/api/...)
   - Există un wrapper sau middleware comun?
   - Cum se face autentificarea pe API routes?
   - Cum se extrage IP-ul și user agent-ul din RequestEvent?

7. Pagina /meta-ads:
   - Unde e exact? Care e structura completă a folderului?
   - Ce filtre are deja implementate?
   - Cum face fetch la date? (direct fetch, remote functions, server load?)
   - Ce console.log/error/warn există deja? (grep la ele)

8. Stores existente:
   - Ce stores Svelte există? ($state runes sau writable stores clasice?)
   - Există auth/user store? Cum se accesează user-ul curent?

9. Package.json:
   - Versiunile exacte ale: drizzle-orm, drizzle-kit, svelte, sveltekit
   - Există deja instalate: sonner, svelte-sonner, sau altă librărie toast?

RAPORTEAZĂ tot ce găsești ÎNAINTE de a scrie cod.
```

---

## FAZA 1: SCHEMA DB (app_logs)

### Tabelă `app_logs` in Drizzle

Adaugă în schema existentă (NU crea fișier nou de schema dacă nu e pattern-ul proiectului).

**ATENȚIE**: Verifică versiunea Drizzle din proiect. Sintaxa indexurilor diferă între versiuni.

```typescript
import { pgTable, serial, timestamp, text, varchar, jsonb, uuid, integer, boolean, index, pgEnum } from 'drizzle-orm/pg-core';

// Enum-uri
export const logLevelEnum = pgEnum('log_level', ['error', 'warn', 'info', 'debug']);
export const logSourceEnum = pgEnum('log_source', ['client', 'server', 'api', 'cron']);

// Tabela
export const appLogs = pgTable('app_logs', {
  id: serial('id').primaryKey(),
  timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow().notNull(),
  level: logLevelEnum('level').notNull(),
  source: logSourceEnum('source').notNull(),
  page: varchar('page', { length: 255 }).notNull(),
  action: varchar('action', { length: 255 }).notNull(),
  message: text('message').notNull(),
  details: jsonb('details').$type<Record<string, unknown>>(),
  errorCode: varchar('error_code', { length: 100 }),
  // IMPORTANT: adaptează referința la tabela users existentă din proiect
  // Verifică cum se numește coloana PK din tabela users (id, userId, etc.)
  // și ce tip are (serial, uuid, text)
  // Exemplu cu integer:
  userId: integer('user_id').references(() => users.id),
  // Exemplu cu text/uuid:
  // userId: text('user_id').references(() => users.id),
  userAgent: text('user_agent'),
  ipAddress: varchar('ip_address', { length: 45 }),
  requestId: uuid('request_id'),
  duration: integer('duration'), // milisecunde, pentru performance tracking
  resolved: boolean('resolved').default(false).notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolutionNote: text('resolution_note'),
}, (table) => {
  // Indexuri pentru queries frecvente
  // ATENȚIE: sintaxa diferă per versiune Drizzle
  // Drizzle 0.30+: folosește callback syntax ca mai jos
  // Drizzle mai vechi: poate necesita export separat
  return {
    timestampIdx: index('app_logs_timestamp_idx').on(table.timestamp),
    levelIdx: index('app_logs_level_idx').on(table.level),
    pageIdx: index('app_logs_page_idx').on(table.page),
    errorCodeIdx: index('app_logs_error_code_idx').on(table.errorCode),
    resolvedIdx: index('app_logs_resolved_idx').on(table.resolved),
    // Index compus pentru filtrare frecventă
    levelTimestampIdx: index('app_logs_level_timestamp_idx').on(table.level, table.timestamp),
  };
});
```

### Migrare

```bash
bunx drizzle-kit generate
bunx drizzle-kit migrate
```

Verifică migrarea generată înainte de a o aplica pe producție.

---

## FAZA 2: ERROR CODES REGISTRY

### Fișier: `src/lib/error-codes.ts`

Sistem centralizat de coduri de eroare. Fiecare cod are:
- `code`: string unic (ex: `META_API_RATE_LIMIT`)
- `severity`: 'error' | 'warn' | 'info'
- `userMessage`: mesaj în Română pentru toast (ce vede clientul)
- `internalMessage`: mesaj tehnic în Engleză (ce se salvează în DB)
- `suggestedFix`: sugestie de rezolvare (opțional, pentru admin/logs)
- `retryable`: boolean, dacă eroarea merită retry automat

```typescript
// Tipul unei definiții de eroare
interface ErrorDefinition {
  code: string;
  severity: 'error' | 'warn' | 'info';
  userMessage: string;        // Română, pentru toast
  internalMessage: string;    // Engleză, pentru DB
  suggestedFix?: string;      // Engleză, pentru admin/logs
  retryable: boolean;         // dacă merită retry automat
}

// Categorii de error codes:
// VALIDATION_*   - erori de validare input
// META_API_*     - erori Meta/Facebook API
// GOOGLE_API_*   - erori Google Ads API
// TIKTOK_API_*   - erori TikTok API
// NETWORK_*      - erori de rețea
// AUTH_*         - erori de autentificare/autorizare
// DB_*           - erori de bază de date
// EXPORT_*       - erori la export/descărcare rapoarte
// SYSTEM_*       - erori de sistem generale

const ERROR_CODES = {

  // ===================== VALIDATION =====================

  VALIDATION_DATE_RANGE_INVALID: {
    code: 'VALIDATION_DATE_RANGE_INVALID',
    severity: 'warn',
    userMessage: 'Data de început nu poate fi după data de sfârșit.',
    internalMessage: 'Date range validation failed: start > end',
    suggestedFix: 'User needs to correct date range selection',
    retryable: false,
  },
  VALIDATION_DATE_RANGE_TOO_LONG: {
    code: 'VALIDATION_DATE_RANGE_TOO_LONG',
    severity: 'warn',
    userMessage: 'Intervalul maxim permis este de 90 de zile.',
    internalMessage: 'Date range exceeds 90 days limit',
    retryable: false,
  },
  VALIDATION_DATE_FUTURE: {
    code: 'VALIDATION_DATE_FUTURE',
    severity: 'warn',
    userMessage: 'Nu poți selecta o dată din viitor.',
    internalMessage: 'Future date selected',
    retryable: false,
  },
  VALIDATION_DATE_INVALID: {
    code: 'VALIDATION_DATE_INVALID',
    severity: 'warn',
    userMessage: 'Data introdusă nu este validă.',
    internalMessage: 'Invalid date value provided',
    retryable: false,
  },
  VALIDATION_NO_ACCOUNT_SELECTED: {
    code: 'VALIDATION_NO_ACCOUNT_SELECTED',
    severity: 'warn',
    userMessage: 'Selectează cel puțin un cont.',
    internalMessage: 'No ad account selected for operation',
    retryable: false,
  },
  VALIDATION_TOO_MANY_ACCOUNTS: {
    code: 'VALIDATION_TOO_MANY_ACCOUNTS',
    severity: 'warn',
    userMessage: 'Poți selecta maxim 50 de conturi odată.',
    internalMessage: 'Too many accounts selected (max 50)',
    retryable: false,
  },
  VALIDATION_NO_DATA_TO_EXPORT: {
    code: 'VALIDATION_NO_DATA_TO_EXPORT',
    severity: 'warn',
    userMessage: 'Nu există date de exportat. Aplică filtrele și încearcă din nou.',
    internalMessage: 'Export attempted with empty dataset',
    retryable: false,
  },
  VALIDATION_INVALID_EXPORT_FORMAT: {
    code: 'VALIDATION_INVALID_EXPORT_FORMAT',
    severity: 'warn',
    userMessage: 'Formatul de export selectat nu este valid.',
    internalMessage: 'Invalid export format specified',
    retryable: false,
  },
  VALIDATION_FILTER_EMPTY: {
    code: 'VALIDATION_FILTER_EMPTY',
    severity: 'warn',
    userMessage: 'Selectează cel puțin o opțiune din filtru.',
    internalMessage: 'Filter applied with no options selected',
    retryable: false,
  },
  VALIDATION_SEARCH_TOO_SHORT: {
    code: 'VALIDATION_SEARCH_TOO_SHORT',
    severity: 'info',
    userMessage: 'Introdu cel puțin 2 caractere pentru căutare.',
    internalMessage: 'Search query too short (min 2 chars)',
    retryable: false,
  },
  VALIDATION_SEARCH_TOO_LONG: {
    code: 'VALIDATION_SEARCH_TOO_LONG',
    severity: 'warn',
    userMessage: 'Textul de căutare este prea lung (max 200 caractere).',
    internalMessage: 'Search query exceeds 200 char limit',
    retryable: false,
  },
  VALIDATION_REQUIRED_FIELD: {
    code: 'VALIDATION_REQUIRED_FIELD',
    severity: 'warn',
    userMessage: 'Acest câmp este obligatoriu.',
    internalMessage: 'Required field is empty',
    retryable: false,
  },
  VALIDATION_INVALID_EMAIL: {
    code: 'VALIDATION_INVALID_EMAIL',
    severity: 'warn',
    userMessage: 'Adresa de email nu este validă.',
    internalMessage: 'Invalid email format',
    retryable: false,
  },

  // ===================== META API =====================

  META_API_RATE_LIMIT: {
    code: 'META_API_RATE_LIMIT',
    severity: 'error',
    userMessage: 'Limita de request-uri Meta a fost atinsă. Încearcă din nou în câteva minute.',
    internalMessage: 'Meta API returned 429 - rate limit exceeded',
    suggestedFix: 'Wait for rate limit reset or reduce request frequency',
    retryable: true,
  },
  META_API_TOKEN_EXPIRED: {
    code: 'META_API_TOKEN_EXPIRED',
    severity: 'error',
    userMessage: 'Sesiunea Meta a expirat. Contactează administratorul.',
    internalMessage: 'Meta API token expired or invalid (401/190)',
    suggestedFix: 'Regenerate Meta API access token in Business Manager',
    retryable: false,
  },
  META_API_PERMISSION_DENIED: {
    code: 'META_API_PERMISSION_DENIED',
    severity: 'error',
    userMessage: 'Nu ai permisiuni pentru acest cont Meta.',
    internalMessage: 'Meta API permission denied (403/10)',
    suggestedFix: 'Check ad account permissions in Business Manager',
    retryable: false,
  },
  META_API_ACCOUNT_DISABLED: {
    code: 'META_API_ACCOUNT_DISABLED',
    severity: 'error',
    userMessage: 'Contul Meta Ads este dezactivat sau restricționat.',
    internalMessage: 'Meta ad account is disabled or restricted',
    suggestedFix: 'Check account status in Business Manager, may need appeal',
    retryable: false,
  },
  META_API_FETCH_FAILED: {
    code: 'META_API_FETCH_FAILED',
    severity: 'error',
    userMessage: 'Nu s-au putut încărca datele din Meta. Încearcă din nou.',
    internalMessage: 'Meta API fetch failed',
    retryable: true,
  },
  META_API_INVALID_RESPONSE: {
    code: 'META_API_INVALID_RESPONSE',
    severity: 'error',
    userMessage: 'Răspuns neașteptat de la Meta. Încearcă din nou.',
    internalMessage: 'Meta API returned unexpected response structure',
    suggestedFix: 'Check if Meta API version is up to date',
    retryable: true,
  },

  // ===================== GOOGLE API =====================

  GOOGLE_API_RATE_LIMIT: {
    code: 'GOOGLE_API_RATE_LIMIT',
    severity: 'error',
    userMessage: 'Limita de request-uri Google a fost atinsă. Încearcă din nou în câteva minute.',
    internalMessage: 'Google Ads API rate limit exceeded',
    suggestedFix: 'Wait for rate limit reset',
    retryable: true,
  },
  GOOGLE_API_TOKEN_EXPIRED: {
    code: 'GOOGLE_API_TOKEN_EXPIRED',
    severity: 'error',
    userMessage: 'Sesiunea Google a expirat. Contactează administratorul.',
    internalMessage: 'Google Ads API OAuth token expired',
    suggestedFix: 'Refresh OAuth token or re-authenticate',
    retryable: false,
  },
  GOOGLE_API_PERMISSION_DENIED: {
    code: 'GOOGLE_API_PERMISSION_DENIED',
    severity: 'error',
    userMessage: 'Nu ai permisiuni pentru acest cont Google Ads.',
    internalMessage: 'Google Ads API permission denied',
    suggestedFix: 'Check MCC account access permissions',
    retryable: false,
  },
  GOOGLE_API_FETCH_FAILED: {
    code: 'GOOGLE_API_FETCH_FAILED',
    severity: 'error',
    userMessage: 'Nu s-au putut încărca datele din Google Ads. Încearcă din nou.',
    internalMessage: 'Google Ads API fetch failed',
    retryable: true,
  },
  GOOGLE_API_ACCOUNT_DISABLED: {
    code: 'GOOGLE_API_ACCOUNT_DISABLED',
    severity: 'error',
    userMessage: 'Contul Google Ads este dezactivat sau suspendat.',
    internalMessage: 'Google Ads customer account is disabled or not active',
    suggestedFix: 'Check account status in Google Ads MCC',
    retryable: false,
  },
  GOOGLE_API_INVALID_RESPONSE: {
    code: 'GOOGLE_API_INVALID_RESPONSE',
    severity: 'error',
    userMessage: 'Răspuns neașteptat de la Google Ads. Încearcă din nou.',
    internalMessage: 'Google Ads API returned unexpected response structure',
    suggestedFix: 'Check if Google Ads API version is up to date',
    retryable: true,
  },

  // ===================== TIKTOK API =====================

  TIKTOK_API_RATE_LIMIT: {
    code: 'TIKTOK_API_RATE_LIMIT',
    severity: 'error',
    userMessage: 'Limita de request-uri TikTok a fost atinsă. Încearcă din nou în câteva minute.',
    internalMessage: 'TikTok API rate limit exceeded',
    retryable: true,
  },
  TIKTOK_API_TOKEN_EXPIRED: {
    code: 'TIKTOK_API_TOKEN_EXPIRED',
    severity: 'error',
    userMessage: 'Sesiunea TikTok a expirat. Contactează administratorul.',
    internalMessage: 'TikTok API access token expired',
    suggestedFix: 'Refresh TikTok API token via OAuth flow',
    retryable: false,
  },
  TIKTOK_API_FETCH_FAILED: {
    code: 'TIKTOK_API_FETCH_FAILED',
    severity: 'error',
    userMessage: 'Nu s-au putut încărca datele din TikTok. Încearcă din nou.',
    internalMessage: 'TikTok API fetch failed',
    retryable: true,
  },
  TIKTOK_API_PERMISSION_DENIED: {
    code: 'TIKTOK_API_PERMISSION_DENIED',
    severity: 'error',
    userMessage: 'Nu ai permisiuni pentru acest cont TikTok Ads.',
    internalMessage: 'TikTok API permission denied or insufficient scope',
    suggestedFix: 'Check app permissions and advertiser authorization in TikTok',
    retryable: false,
  },
  TIKTOK_API_ACCOUNT_DISABLED: {
    code: 'TIKTOK_API_ACCOUNT_DISABLED',
    severity: 'error',
    userMessage: 'Contul TikTok Ads este dezactivat sau nu a fost găsit.',
    internalMessage: 'TikTok advertiser account abnormal or not found',
    suggestedFix: 'Check advertiser account status in TikTok Ads Manager',
    retryable: false,
  },
  TIKTOK_API_INVALID_RESPONSE: {
    code: 'TIKTOK_API_INVALID_RESPONSE',
    severity: 'error',
    userMessage: 'Răspuns neașteptat de la TikTok. Încearcă din nou.',
    internalMessage: 'TikTok API returned unexpected response structure',
    retryable: true,
  },

  // ===================== NETWORK =====================

  NETWORK_TIMEOUT: {
    code: 'NETWORK_TIMEOUT',
    severity: 'error',
    userMessage: 'Conexiunea a expirat. Verifică internetul și încearcă din nou.',
    internalMessage: 'Network request timed out after 30s',
    suggestedFix: 'Check server health and network connectivity',
    retryable: true,
  },
  NETWORK_OFFLINE: {
    code: 'NETWORK_OFFLINE',
    severity: 'error',
    userMessage: 'Nu ești conectat la internet.',
    internalMessage: 'Client is offline (navigator.onLine = false)',
    retryable: false,
  },
  NETWORK_SERVER_ERROR: {
    code: 'NETWORK_SERVER_ERROR',
    severity: 'error',
    userMessage: 'A apărut o eroare pe server. Încearcă din nou.',
    internalMessage: 'Server returned 5xx error',
    retryable: true,
  },
  NETWORK_FETCH_FAILED: {
    code: 'NETWORK_FETCH_FAILED',
    severity: 'error',
    userMessage: 'Nu s-a putut realiza conexiunea. Verifică internetul.',
    internalMessage: 'Fetch failed (TypeError: Failed to fetch)',
    retryable: true,
  },

  // ===================== AUTH =====================

  AUTH_SESSION_EXPIRED: {
    code: 'AUTH_SESSION_EXPIRED',
    severity: 'warn',
    userMessage: 'Sesiunea ta a expirat. Te rugăm să te autentifici din nou.',
    internalMessage: 'User session expired',
    retryable: false,
  },
  AUTH_UNAUTHORIZED: {
    code: 'AUTH_UNAUTHORIZED',
    severity: 'error',
    userMessage: 'Nu ai permisiuni pentru această acțiune.',
    internalMessage: 'Unauthorized access attempt',
    retryable: false,
  },

  // ===================== EXPORT =====================

  EXPORT_GENERATION_FAILED: {
    code: 'EXPORT_GENERATION_FAILED',
    severity: 'error',
    userMessage: 'Nu s-a putut genera raportul. Încearcă din nou.',
    internalMessage: 'Report generation failed',
    retryable: true,
  },
  EXPORT_TIMEOUT: {
    code: 'EXPORT_TIMEOUT',
    severity: 'warn',
    userMessage: 'Generarea raportului durează mai mult decât de obicei. Te rugăm să aștepți.',
    internalMessage: 'Report generation exceeded 30s timeout',
    retryable: true,
  },
  EXPORT_FILE_TOO_LARGE: {
    code: 'EXPORT_FILE_TOO_LARGE',
    severity: 'warn',
    userMessage: 'Raportul este prea mare. Încearcă cu un interval mai mic.',
    internalMessage: 'Export file size exceeds limit',
    retryable: false,
  },

  // ===================== DATABASE =====================

  DB_QUERY_FAILED: {
    code: 'DB_QUERY_FAILED',
    severity: 'error',
    userMessage: 'Eroare de server. Încearcă din nou.',
    internalMessage: 'Database query failed',
    suggestedFix: 'Check database connection and query syntax',
    retryable: true,
  },
  DB_CONNECTION_FAILED: {
    code: 'DB_CONNECTION_FAILED',
    severity: 'error',
    userMessage: 'Eroare de server. Încearcă din nou mai târziu.',
    internalMessage: 'Database connection failed',
    suggestedFix: 'Check PostgreSQL service status and connection string',
    retryable: true,
  },

  // ===================== SYSTEM =====================

  SYSTEM_UNEXPECTED: {
    code: 'SYSTEM_UNEXPECTED',
    severity: 'error',
    userMessage: 'A apărut o eroare neașteptată. Încearcă din nou sau contactează administratorul.',
    internalMessage: 'Unexpected system error',
    retryable: false,
  },

} as const;

// Tip derivat automat din obiect
type ErrorCode = keyof typeof ERROR_CODES;

// =================== FUNCȚII HELPER ===================

// Returnează definiția completă a erorii
function getErrorByCode(code: string): ErrorDefinition | undefined

// Returnează doar userMessage (pentru toast)
function getUserMessage(code: string): string
// Fallback: 'A apărut o eroare. Încearcă din nou.'

// Returnează dacă eroarea merită retry automat
function isRetryable(code: string): boolean
```

---

## FAZA 3: LOGGER CORE MODULE

### Fișier: `src/lib/logger.ts` (EXTINDE cel existent)

**IMPORTANT**: Există deja un `logger.ts` în proiect (referințe la logger.ts:60 și logger.ts:147 cu benign error filtering). Analizează-l mai întâi și păstrează funcționalitățile existente. Extinde-l cu noile capabilități.

### Arhitectura logger (isomorphic: client + server)

```typescript
// Logger-ul trebuie să funcționeze ATÂT pe client CÂT și pe server.
// Detectează mediul cu:
const IS_BROWSER = typeof window !== 'undefined';
const IS_SERVER = !IS_BROWSER;

// Pe SERVER: importă Drizzle direct, inserează în DB fără HTTP
// Pe CLIENT: trimite POST la /api/logs
```

### Interfețe:

```typescript
interface LogEntry {
  level: 'error' | 'warn' | 'info' | 'debug';
  source: 'client' | 'server' | 'api' | 'cron';
  page: string;
  action: string;
  message: string;
  errorCode?: string;
  details?: Record<string, unknown>;
  userId?: string | number;
  requestId?: string;
  duration?: number;
  showToast?: boolean;
  toastMessage?: string;
}

// API-ul logger-ului (ce se folosește în cod)
interface Logger {
  error(entry: Partial<LogEntry> & { message: string }): void;
  warn(entry: Partial<LogEntry> & { message: string }): void;
  info(entry: Partial<LogEntry> & { message: string }): void;
  debug(entry: Partial<LogEntry> & { message: string }): void;

  // Shorthand-uri cu defaults pre-configurate
  apiError(action: string, error: unknown, errorCode?: string): void;
  validationError(action: string, errorCode: string): void;
  networkError(action: string, error: unknown): void;
  performanceLog(action: string, durationMs: number): void;
}
```

### Comportament intern al fiecărui apel:

**1. Console output** (mereu activ, dev + prod):
```
logger.error()  -> console.error()  cu prefix [OTS ERROR]
logger.warn()   -> console.warn()   cu prefix [OTS WARN]
logger.info()   -> console.info()   cu prefix [OTS INFO]
logger.debug()  -> console.debug()  cu prefix [OTS DEBUG]
                   (debug doar dacă DEV mode sau env OTS_DEBUG=true)

Format: [OTS ERROR][2026-03-28T10:15:30][META_API_RATE_LIMIT][/meta-ads] Meta API returned 429
```

**2. Persist în DB** (async, non-blocking):
```
Pe CLIENT: adaugă log-ul într-un buffer intern, trimite batch la /api/logs
Pe SERVER: insert direct în DB cu Drizzle (import dinamic, fără HTTP)

REGULI CRITICE:
- Dacă persist-ul eșuează, NU aruncă eroare (evită bucle infinite)
- Face doar console.error('Failed to persist log', e)
- Nu persista log-uri de nivel 'debug' în producție (doar dev)
- Exclude fetch-urile către /api/logs din interceptare (previne bucle)
```

**3. Toast notification** (doar pe client, doar dacă IS_BROWSER):
```
Default ON pentru: error, warn
Default OFF pentru: info, debug (activabil cu showToast: true)

Mesajul toast-ului (în ordine de prioritate):
  1. toastMessage (dacă e specificat explicit)
  2. getUserMessage(errorCode) din error-codes.ts
  3. Fallback: 'A apărut o eroare. Încearcă din nou.'

IMPORTANT: Logger-ul importă toast store-ul LAZY (dynamic import)
pentru a evita dependințe circulare:
  const { toast } = await import('$lib/stores/toast');
SAU pasează toast ca dependency injection la inițializare.
```

**4. Context automat** (completat fără intervenție):
```
page:      pe client -> window.location.pathname
           pe server -> se transmite din RequestEvent
userId:    pe client -> din auth store (dacă e disponibil)
           pe server -> din event.locals.user
userAgent: pe client -> navigator.userAgent
           pe server -> event.request.headers.get('user-agent')
timestamp: se adaugă automat (new Date().toISOString())
requestId: se generează automat cu crypto.randomUUID()
source:    default 'client' pe browser, 'server' pe server
```

### Shorthand-uri (comportament detaliat):

```typescript
// apiError: logare eroare de API cu extragere automată a detaliilor
logger.apiError('load_campaigns', error, 'META_API_FETCH_FAILED')
// -> Extrage automat: error.message, error.status, error.stack
// -> source: 'api'
// -> showToast: true
// -> details: { originalError: serializedError, status, responseBody }

// validationError: logare eroare de validare
logger.validationError('filter_apply', 'VALIDATION_DATE_RANGE_INVALID')
// -> source: 'client'
// -> level: se ia din errorCode.severity (de obicei 'warn')
// -> showToast: true, mesaj din errorCode.userMessage

// networkError: logare eroare de rețea
logger.networkError('load_campaigns', error)
// -> Detectează automat tipul: timeout, offline, fetch failed
// -> Alege errorCode potrivit: NETWORK_TIMEOUT, NETWORK_OFFLINE, NETWORK_FETCH_FAILED
// -> showToast: true

// performanceLog: logare durată operație
logger.performanceLog('load_campaigns', 4523)
// -> level: 'info' dacă < 3000ms, 'warn' dacă >= 3000ms
// -> showToast: false
// -> Salvează duration în ms
```

### CLIENT: Batch sending & Anti-flood

```typescript
// Nu trimite fiecare log individual. Acumulează și trimite batch.

const LOG_BUFFER_MAX_SIZE = 10;     // trimite la 10 log-uri acumulate
const LOG_BUFFER_FLUSH_INTERVAL = 5000; // sau la fiecare 5 secunde
const LOG_FLOOD_WINDOW = 5000;      // fereastră de 5 secunde
const LOG_FLOOD_MAX_SAME = 5;       // max 5 log-uri identice în fereastră

// Anti-flood: dacă aceeași combinație (errorCode + page + action)
// apare de mai mult de LOG_FLOOD_MAX_SAME ori în LOG_FLOOD_WINDOW,
// nu mai trimite individual ci trimite un singur log cu:
//   details.floodCount = N (câte au fost supresate)
//   message += " (repeated N times)"

// Flush la: page unload (navigator.sendBeacon), buffer full, interval
// sendBeacon ca fallback la unload pentru a nu pierde log-urile
```

### CLIENT: Captare automată erori necaptate

```typescript
// Se inițializează o singură dată în hooks.client.ts SAU în layout-ul root

// 1. Erori JS necaptate
window.addEventListener('error', (event) => {
  // IGNORĂ erorile din extensii browser (chrome-extension://, moz-extension://)
  if (event.filename?.includes('extension://')) return;

  logger.error({
    source: 'client',
    action: 'unhandled_error',
    message: event.message,
    details: {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      stack: event.error?.stack,
    },
    errorCode: 'SYSTEM_UNEXPECTED',
    showToast: true,
  });
});

// 2. Promise rejections necaptate
window.addEventListener('unhandledrejection', (event) => {
  logger.error({
    source: 'client',
    action: 'unhandled_rejection',
    message: event.reason?.message || String(event.reason),
    details: {
      stack: event.reason?.stack,
      reason: String(event.reason),
    },
    errorCode: 'SYSTEM_UNEXPECTED',
    showToast: false, // multe sunt benign, nu speria user-ul
  });
});
```

### SERVER: Captare automată erori (SvelteKit hooks)

```typescript
// hooks.server.ts - handleError hook
// EXTINDE hook-ul existent, nu-l înlocui

import type { HandleServerError } from '@sveltejs/kit';

export const handleError: HandleServerError = async ({ error, event, status, message }) => {
  // Logare directă în DB (Drizzle, nu HTTP)
  // Extrage: event.url.pathname, event.locals.user, event.request.headers
  // Sanitizează error-ul înainte de persistare (strip tokens, passwords)

  const requestId = crypto.randomUUID();

  // Log în DB
  await persistLogDirect({
    level: 'error',
    source: 'server',
    page: event.url.pathname,
    action: 'server_error',
    message: error instanceof Error ? error.message : String(error),
    details: {
      stack: error instanceof Error ? error.stack : undefined,
      status,
      originalMessage: message,
    },
    errorCode: 'SYSTEM_UNEXPECTED',
    requestId,
    userId: event.locals.user?.id,
    userAgent: event.request.headers.get('user-agent') || undefined,
    ipAddress: event.getClientAddress(),
  });

  // Returnează error safe pentru client
  return {
    message: 'A apărut o eroare internă.',
    requestId,
  };
};
```

### Sensitive Data Sanitization

```typescript
// ÎNAINTE de a persista un log (atât client cât și server),
// sanitizează câmpul details:

const SENSITIVE_PATTERNS = [
  /token/i, /password/i, /secret/i, /cookie/i,
  /authorization/i, /api_key/i, /apikey/i,
  /access_token/i, /refresh_token/i, /session/i,
];

function sanitizeDetails(details: Record<string, unknown>): Record<string, unknown> {
  // Parcurge recursiv obiectul
  // Dacă o cheie match-uiește SENSITIVE_PATTERNS, înlocuiește valoarea cu '[REDACTED]'
  // Limitează adâncimea recursiei la 5 nivele
  // Limitează dimensiunea totală la 50KB (JSON.stringify)
}
```

---

## FAZA 4: TOAST NOTIFICATION SYSTEM

**VERIFICĂ ÎNTÂI**: Dacă proiectul folosește deja shadcn-svelte cu sonner, svelte-sonner, sau altă librărie toast, folosește-o pe aceea. NU reinventa. Doar asigură-te că logger-ul se conectează la ea.

### Dacă NU există toast system, creează:

**Structură:**
1. **Store**: `src/lib/stores/toast.ts` (sau `toast.svelte.ts` dacă proiectul folosește runes stores)
2. **Componenta**: `src/lib/components/ui/toast/ToastContainer.svelte`
3. **Montare**: în layout-ul root (`+layout.svelte`) ca ultimul element

**Specificații:**
```
Poziție: top-right (fixed)
Tipuri:
  success: verde (#22c55e), icon check circle
  error:   roșu (#ef4444), icon x circle
  warning: amber (#f59e0b), icon warning triangle
  info:    albastru (#3b82f6), icon info circle

Auto-dismiss:
  success: 4s
  info:    5s
  warning: 6s
  error:   8s

Dismiss manual: buton X pe fiecare toast
Stack maxim: 5 vizibile, restul în coadă (FIFO)
Animații: slide-in din dreapta, fade-out la dismiss
Progress bar: subtil pe fiecare toast (arată timpul rămas)
Z-index: 9999
Responsive: pe mobile, full-width bottom instead of top-right
```

**API toast store:**
```typescript
toast.success(message: string, options?: { duration?: number; title?: string })
toast.error(message: string, options?: { duration?: number; title?: string })
toast.warn(message: string, options?: { duration?: number; title?: string })
toast.info(message: string, options?: { duration?: number; title?: string })
toast.dismiss(id: string)
toast.clear()
```

---

## FAZA 5: API ENDPOINTS PENTRU LOGS

### `POST /api/logs` - Salvare log (sau batch de log-uri)

```
Ruta: src/routes/api/logs/+server.ts

Input (body JSON): LogEntry | LogEntry[]  (acceptă și single și array)
Output: { success: true, count: number }

Auth: orice user autentificat (și clienții trimit erori client-side)

Validare server-side:
  - level: trebuie să fie din enum ['error', 'warn', 'info', 'debug']
  - source: trebuie să fie din enum ['client', 'server', 'api', 'cron']
  - message: obligatoriu, non-empty, max 5000 chars
  - page: obligatoriu, max 255 chars
  - action: obligatoriu, max 255 chars
  - details: opțional, max 50KB (măsoară JSON.stringify().length)
  - errorCode: dacă e prezent, max 100 chars
  - Batch: max 50 log-uri per request

Rate limit: max 100 log-uri/minut per user (previne spam)
  - Implementare simplă: counter per userId în memorie, reset la 60s
  - Dacă depășește limita: returnează 429, nu logează (evită recursie)

Sanitizare: aplică sanitizeDetails() pe fiecare entry înainte de insert

IP Address: extrage din event.getClientAddress()
User Agent: extrage din event.request.headers.get('user-agent')
```

### `GET /api/logs` - Listare logs (ADMIN ONLY)

```
Ruta: src/routes/api/logs/+server.ts (GET handler)

Query params:
  - pageNum: number (ATENȚIE: nu "page" ca să nu confunde cu câmpul "page" din schema)
  - limit: number (default 50, max 200)
  - level: string (comma-separated: 'error,warn')
  - source: string (comma-separated: 'client,server')
  - route: string (filtrare pe câmpul "page", ex: '/meta-ads')
  - errorCode: string (filtrare exactă pe error_code)
  - search: string (căutare ILIKE în message. NU în details ca să nu fie lent)
  - resolved: 'true' | 'false' | 'all' (default 'all')
  - dateFrom: ISO date string
  - dateTo: ISO date string
  - sortBy: 'timestamp' | 'level' | 'page' (default 'timestamp')
  - sortOrder: 'asc' | 'desc' (default 'desc')

Output: {
  logs: AppLog[],
  total: number,
  pageNum: number,
  totalPages: number,
  stats: {
    last24h: { error: number, warn: number, info: number, debug: number },
    last7d: { error: number, warn: number, info: number, debug: number },
    topErrors: Array<{ message: string, errorCode: string, count: number, lastSeen: string }>,
    topPages: Array<{ page: string, errorCount: number }>,
  }
}

PERFORMANȚĂ: stats-urile se calculează separat cu queries dedicate.
Dacă e lent, fă stats-urile un endpoint separat GET /api/logs/stats.
```

### `PATCH /api/logs/[id]` - Resolve log (ADMIN ONLY)

```
Ruta: src/routes/api/logs/[id]/+server.ts

Input: { resolved: boolean, resolutionNote?: string }
Output: { success: true }

Dacă resolved=true, setează resolvedAt = new Date()
Dacă resolved=false, setează resolvedAt = null, resolutionNote = null
```

### `POST /api/logs/bulk-resolve` - Bulk resolve (ADMIN ONLY)

```
Ruta: src/routes/api/logs/bulk-resolve/+server.ts

Input: { ids: number[], resolved: boolean, resolutionNote?: string }
Output: { success: true, updated: number }
Max 100 ID-uri per request.
```

### `DELETE /api/logs/cleanup` - Cleanup vechi (ADMIN ONLY)

```
Ruta: src/routes/api/logs/cleanup/+server.ts

Input: { 
  debugDays?: number,   // default 7
  infoDays?: number,    // default 30
  warnDays?: number,    // default 90
  errorDays?: number    // default 365
}
Output: { deleted: { debug: number, info: number, warn: number, error: number, total: number } }
```

### Wrapper `withErrorHandling` pentru API routes

```typescript
// Fișier: src/lib/server/api-utils.ts

import type { RequestEvent } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';

type ApiHandler = (event: RequestEvent) => Promise<Response>;

export function withErrorHandling(handler: ApiHandler): ApiHandler {
  return async (event: RequestEvent): Promise<Response> => {
    const requestId = crypto.randomUUID();
    const start = performance.now();

    // Adaugă requestId în response headers pentru tracing
    const addHeaders = (response: Response): Response => {
      response.headers.set('X-Request-ID', requestId);
      return response;
    };

    try {
      const response = await handler(event);
      const duration = Math.round(performance.now() - start);

      // Log performance pentru request-uri lente (>3s)
      if (duration > 3000) {
        await persistLogDirect({
          level: 'warn',
          source: 'server',
          page: event.url.pathname,
          action: 'slow_request',
          message: `Request took ${duration}ms: ${event.request.method} ${event.url.pathname}`,
          details: {
            method: event.request.method,
            duration,
            searchParams: Object.fromEntries(event.url.searchParams),
          },
          requestId,
          userId: event.locals.user?.id,
        });
      }

      return addHeaders(response);
    } catch (error) {
      const duration = Math.round(performance.now() - start);

      await persistLogDirect({
        level: 'error',
        source: 'server',
        page: event.url.pathname,
        action: 'api_error',
        message: error instanceof Error ? error.message : String(error),
        details: {
          stack: error instanceof Error ? error.stack : undefined,
          method: event.request.method,
          duration,
        },
        errorCode: 'SYSTEM_UNEXPECTED',
        requestId,
        userId: event.locals.user?.id,
        userAgent: event.request.headers.get('user-agent') || undefined,
        ipAddress: event.getClientAddress(),
      });

      return addHeaders(json({
        error: 'Internal server error',
        requestId,
      }, { status: 500 }));
    }
  };
}

// Funcție internă: persistă log direct în DB (fără HTTP)
// Se folosește pe SERVER, importă Drizzle direct
// Wrapped în try/catch propriu (nu aruncă niciodată)
async function persistLogDirect(entry: Partial<LogEntry>): Promise<void> {
  try {
    const { db } = await import('$lib/server/db');
    const { appLogs } = await import('$lib/server/db/schema');
    await db.insert(appLogs).values({
      // ... mapped fields
    });
  } catch (e) {
    console.error('[OTS] Failed to persist log to DB:', e);
  }
}

// UTILIZARE în API routes:
// export const GET = withErrorHandling(async (event) => {
//   const data = await fetchSomething();
//   return json(data);
// });
```

---

## FAZA 6: VALIDATION SYSTEM

### Fișier: `src/lib/validators.ts`

```typescript
// Rezultatul oricărei validări
interface ValidationResult {
  valid: boolean;
  errorCode?: string;   // cod din error-codes.ts
  message?: string;     // mesaj descriptiv (EN, pentru logging)
}

// ============ DATE RANGE ============

function validateDateRange(
  start: Date | string | null | undefined,
  end: Date | string | null | undefined,
  options?: { maxDays?: number }  // default maxDays = 90
): ValidationResult
// Reguli:
// - Ambele obligatorii (dacă e null/undefined -> VALIDATION_DATE_INVALID)
// - Ambele trebuie să fie date valide parsabile
// - start nu poate fi după end -> VALIDATION_DATE_RANGE_INVALID
// - Diferența nu poate depăși maxDays -> VALIDATION_DATE_RANGE_TOO_LONG
// - end nu poate fi mai mare decât azi + 1 zi (toleranță timezone) -> VALIDATION_DATE_FUTURE

// ============ ACCOUNT SELECTION ============

function validateAccountSelection(
  selectedIds: string[],
  options?: { min?: number; max?: number }  // default min=1, max=50
): ValidationResult
// Reguli:
// - Array-ul nu poate fi gol -> VALIDATION_NO_ACCOUNT_SELECTED
// - Toate elementele trebuie să fie stringuri non-empty (trim)
// - Maxim max elemente -> VALIDATION_TOO_MANY_ACCOUNTS
// - Deduplică ID-urile

// ============ FILTER OPTIONS ============

function validateFilterOptions(
  selected: string[],
  available: string[]
): ValidationResult
// Reguli:
// - Cel puțin 1 opțiune selectată -> VALIDATION_FILTER_EMPTY
// - Toate opțiunile selectate trebuie să existe în available (case-insensitive)
// - Sanitizare: trim fiecare element

// ============ SEARCH INPUT ============

function validateSearchInput(query: string): ValidationResult
// Reguli:
// - Dacă e string gol sau doar whitespace -> valid: true (search-ul e opțional)
// - Dacă are conținut: minim 2 caractere -> VALIDATION_SEARCH_TOO_SHORT
// - Max 200 caractere -> VALIDATION_SEARCH_TOO_LONG
// - Strip HTML tags (previne XSS)
// - Trim whitespace

// ============ EXPORT ============

function validateExportRequest(
  data: unknown[],
  format: string
): ValidationResult
// Reguli:
// - data nu poate fi array gol -> VALIDATION_NO_DATA_TO_EXPORT
// - format trebuie să fie unul din: 'csv', 'pdf', 'xlsx' -> VALIDATION_INVALID_EXPORT_FORMAT

// ============ GENERIC ============

function validateRequired(value: unknown, fieldName: string): ValidationResult
// - null, undefined, empty string -> VALIDATION_REQUIRED_FIELD

function validateEmail(email: string): ValidationResult
// - Regex simplu (nu trebuie RFC 5322 complet) -> VALIDATION_INVALID_EMAIL

function validateNumericRange(
  value: number,
  min: number,
  max: number,
  fieldName: string
): ValidationResult
// - value < min sau value > max -> invalid
```

### Pattern de utilizare (exemplu):

```typescript
async function applyFilters() {
  // 1. Chain de validări, oprește la prima eroare
  const dateCheck = validateDateRange(startDate, endDate);
  if (!dateCheck.valid) {
    logger.validationError('filter_apply', dateCheck.errorCode!);
    return;
  }

  const accountCheck = validateAccountSelection(selectedAccounts);
  if (!accountCheck.valid) {
    logger.validationError('filter_apply', accountCheck.errorCode!);
    return;
  }

  // 2. Toate validările ok, fetch cu platformFetch
  // Error handling + performance log se fac automat
  loading = true;
  try {
    const data = await platformFetch<Campaign[]>({
      platform: 'meta',  // sau 'google', 'tiktok'
      url: '/api/meta-ads/campaigns',
      action: 'filter_apply',
      body: { accounts: selectedAccounts, dateRange: { start: startDate, end: endDate } },
    });

    if (data) {
      campaigns = data;
      logger.info({
        action: 'filter_apply',
        message: `Loaded ${data.length} campaigns`,
        showToast: false,
      });
    }
  } finally {
    loading = false;
  }
}
```

### Retry Logic

```typescript
// Fișier: src/lib/utils/retry.ts

interface RetryOptions {
  maxAttempts: number;           // default 3
  initialDelayMs: number;        // default 1000
  backoffMultiplier: number;     // default 2 (exponential: 1s, 2s, 4s)
  maxDelayMs: number;            // default 10000 (cap la 10s)
  retryableStatuses: number[];   // default [408, 429, 500, 502, 503, 504]
  timeoutMs: number;             // default 30000 (30s)
  onRetry?: (attempt: number, error: unknown) => void;
}

async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  retryOptions?: Partial<RetryOptions>
): Promise<Response>

// Comportament:
// - Wrappează fetch cu AbortController pentru timeout
// - La eroare, verifică dacă status-ul e retryable
// - Dacă da, așteaptă delay * backoff^attempt, apoi retry
// - La fiecare retry, apelează onRetry callback (pentru logging)
// - Dacă toate încercările eșuează, aruncă ultima eroare
// - NU face retry pe: 400, 401, 403, 404 (erori client-side)
// - Rate limit (429): citește Retry-After header dacă există
```

### Platform-Specific API Error Mappers

#### Fișier: `src/lib/api-error-mappers.ts`

Fiecare platformă (Meta, Google, TikTok) are propriile HTTP status codes, error codes
interne și formate de răspuns. NU face if/else inline pe fiecare pagină.
Creează un mapper centralizat per platformă.

```typescript
type AdPlatform = 'meta' | 'google' | 'tiktok';

interface ApiErrorMapping {
  errorCode: string;     // codul din error-codes.ts
  details: Record<string, unknown>;  // context extras din response
}

// =================== FUNCȚIA PRINCIPALĂ ===================
// Se apelează din orice pagină ads cu: handleApiError('meta', response, errorData, action)
// Returnează void, logarea + toast se fac intern

async function handleApiError(
  platform: AdPlatform,
  response: Response,
  errorBody: unknown,
  action: string
): Promise<void> {
  const mapping = mapPlatformError(platform, response.status, errorBody);
  logger.apiError(action, errorBody, mapping.errorCode);
  // toast se declanșează automat din logger.apiError
}

// =================== MAPPER PER PLATFORMĂ ===================

function mapPlatformError(
  platform: AdPlatform,
  httpStatus: number,
  errorBody: unknown
): ApiErrorMapping {
  switch (platform) {
    case 'meta': return mapMetaError(httpStatus, errorBody);
    case 'google': return mapGoogleError(httpStatus, errorBody);
    case 'tiktok': return mapTikTokError(httpStatus, errorBody);
  }
}
```

#### META ADS Error Mapping

```typescript
// Meta Graph API returnează erori în format:
// { error: { message, type, code, error_subcode, fbtrace_id } }

function mapMetaError(httpStatus: number, body: unknown): ApiErrorMapping {
  const metaError = (body as any)?.error;
  const code = metaError?.code;
  const subcode = metaError?.error_subcode;

  // Mapping pe baza combinației (httpStatus, code, subcode)
  const mapping: Record<string, string> = {

    // Rate limiting
    '429':               'META_API_RATE_LIMIT',     // HTTP 429
    '200-4':             'META_API_RATE_LIMIT',     // code 4 = API Too Many Calls
    '200-32':            'META_API_RATE_LIMIT',     // code 32 = Page-level throttling
    '200-17':            'META_API_RATE_LIMIT',     // code 17 = User-level throttling

    // Authentication / Token
    '401':               'META_API_TOKEN_EXPIRED',  // HTTP 401
    '200-190':           'META_API_TOKEN_EXPIRED',  // code 190 = Access token expired
    '200-190-463':       'META_API_TOKEN_EXPIRED',  // subcode 463 = Token expired
    '200-190-467':       'META_API_TOKEN_EXPIRED',  // subcode 467 = Invalid token

    // Permissions
    '403':               'META_API_PERMISSION_DENIED', // HTTP 403
    '200-10':            'META_API_PERMISSION_DENIED', // code 10 = Permission denied
    '200-200':           'META_API_PERMISSION_DENIED', // code 200 = Requires permission
    '200-294':           'META_API_PERMISSION_DENIED', // code 294 = App not approved for live mode

    // Account issues
    '200-100-1487390':   'META_API_ACCOUNT_DISABLED',  // Ad account disabled
    '200-2635':          'META_API_ACCOUNT_DISABLED',  // Account is deactivated

    // Invalid response / unknown error
    '200-1':             'META_API_INVALID_RESPONSE',  // code 1 = Unknown error
    '200-2':             'META_API_INVALID_RESPONSE',  // code 2 = Service temporarily unavailable

    // Server errors
    '500':               'NETWORK_SERVER_ERROR',
    '502':               'NETWORK_SERVER_ERROR',
    '503':               'NETWORK_SERVER_ERROR',
  };

  // Construiește cheia de lookup în ordine de specificitate
  const keys = [
    `${httpStatus}-${code}-${subcode}`,  // cel mai specific
    `${httpStatus}-${code}`,              // mediu
    `${httpStatus}`,                      // doar HTTP status
  ];

  let errorCode = 'META_API_FETCH_FAILED'; // fallback
  for (const key of keys) {
    if (mapping[key]) {
      errorCode = mapping[key];
      break;
    }
  }

  return {
    errorCode,
    details: {
      httpStatus,
      metaErrorCode: code,
      metaSubcode: subcode,
      metaMessage: metaError?.message,
      metaType: metaError?.type,
      fbtrace_id: metaError?.fbtrace_id,
    },
  };
}
```

#### GOOGLE ADS Error Mapping

```typescript
// Google Ads API returnează erori în format:
// gRPC style: { error: { code, message, status, details[] } }
// Fiecare detail poate conține: errorCode.fieldPathElements, trigger, location
//
// Google Ads API folosește gRPC status codes (nu HTTP standard):
// PERMISSION_DENIED, RESOURCE_EXHAUSTED, UNAUTHENTICATED, INTERNAL, etc.
//
// Common error types din Google Ads: 
// AuthenticationError, AuthorizationError, QuotaError, RequestError, etc.

function mapGoogleError(httpStatus: number, body: unknown): ApiErrorMapping {
  const gError = (body as any)?.error;
  const grpcStatus = gError?.status;           // ex: 'RESOURCE_EXHAUSTED'
  const errorDetails = gError?.details || [];

  // Extrage Google Ads error type din details
  // Structura: details[].errors[].errorCode.{errorType} = 'ERROR_NAME'
  const adsErrors = errorDetails
    .flatMap((d: any) => d?.errors || [])
    .map((e: any) => {
      const errorCode = e?.errorCode || {};
      const type = Object.keys(errorCode)[0]; // ex: 'authenticationError'
      return { type, value: errorCode[type], message: e?.message };
    });

  const firstAdsError = adsErrors[0];

  // Mapping pe gRPC status
  const statusMapping: Record<string, string> = {
    'RESOURCE_EXHAUSTED':  'GOOGLE_API_RATE_LIMIT',
    'UNAUTHENTICATED':     'GOOGLE_API_TOKEN_EXPIRED',
    'PERMISSION_DENIED':   'GOOGLE_API_PERMISSION_DENIED',
    'INTERNAL':            'NETWORK_SERVER_ERROR',
    'UNAVAILABLE':         'NETWORK_SERVER_ERROR',
    'DEADLINE_EXCEEDED':   'NETWORK_TIMEOUT',
  };

  // Mapping pe Google Ads error types (mai specific)
  const adsErrorMapping: Record<string, string> = {
    // Authentication
    'OAUTH_TOKEN_EXPIRED':            'GOOGLE_API_TOKEN_EXPIRED',
    'OAUTH_TOKEN_REVOKED':            'GOOGLE_API_TOKEN_EXPIRED',
    'OAUTH_TOKEN_INVALID':            'GOOGLE_API_TOKEN_EXPIRED',
    'NOT_ADS_USER':                   'GOOGLE_API_PERMISSION_DENIED',
    'CUSTOMER_NOT_FOUND':             'GOOGLE_API_PERMISSION_DENIED',

    // Authorization
    'USER_PERMISSION_DENIED':         'GOOGLE_API_PERMISSION_DENIED',
    'DEVELOPER_TOKEN_NOT_APPROVED':   'GOOGLE_API_PERMISSION_DENIED',
    'DEVELOPER_TOKEN_PROHIBITED':     'GOOGLE_API_PERMISSION_DENIED',

    // Quota
    'RESOURCE_EXHAUSTED':             'GOOGLE_API_RATE_LIMIT',
    'RESOURCE_TEMPORARILY_EXHAUSTED': 'GOOGLE_API_RATE_LIMIT',

    // Account
    'CUSTOMER_NOT_ENABLED':           'GOOGLE_API_ACCOUNT_DISABLED',
    'CUSTOMER_NOT_ACTIVE':            'GOOGLE_API_ACCOUNT_DISABLED',
  };

  // Prioritate: ads error type > gRPC status > HTTP status > fallback
  let errorCode = 'GOOGLE_API_FETCH_FAILED';

  if (firstAdsError?.value && adsErrorMapping[firstAdsError.value]) {
    errorCode = adsErrorMapping[firstAdsError.value];
  } else if (grpcStatus && statusMapping[grpcStatus]) {
    errorCode = statusMapping[grpcStatus];
  } else if (httpStatus === 429) {
    errorCode = 'GOOGLE_API_RATE_LIMIT';
  } else if (httpStatus === 401) {
    errorCode = 'GOOGLE_API_TOKEN_EXPIRED';
  } else if (httpStatus === 403) {
    errorCode = 'GOOGLE_API_PERMISSION_DENIED';
  } else if (httpStatus >= 500) {
    errorCode = 'NETWORK_SERVER_ERROR';
  }

  return {
    errorCode,
    details: {
      httpStatus,
      grpcStatus,
      grpcMessage: gError?.message,
      adsErrors: adsErrors.map((e: any) => ({
        type: e.type,
        value: e.value,
        message: e.message,
      })),
    },
  };
}
```

#### TIKTOK ADS Error Mapping

```typescript
// TikTok Marketing API returnează erori în format:
// { code: number, message: string, request_id: string, data: {} }
//
// TikTok error codes sunt numerice:
// 0 = success
// 40001 = auth error
// 40100 = access token invalid
// 40002 = parameter error
// 50000+ = system errors
//
// Rate limit: 429 HTTP sau code 40002 cu message despre throttling

function mapTikTokError(httpStatus: number, body: unknown): ApiErrorMapping {
  const ttResponse = body as any;
  const ttCode = ttResponse?.code;
  const ttMessage = (ttResponse?.message || '').toLowerCase();
  const requestId = ttResponse?.request_id;

  // Mapping pe TikTok error codes
  const codeMapping: Record<number, string> = {
    // Auth errors
    40001: 'TIKTOK_API_TOKEN_EXPIRED',     // Authentication failed
    40100: 'TIKTOK_API_TOKEN_EXPIRED',     // Access token is invalid
    40101: 'TIKTOK_API_TOKEN_EXPIRED',     // Access token expired
    40102: 'TIKTOK_API_TOKEN_EXPIRED',     // Refresh token expired
    40103: 'TIKTOK_API_TOKEN_EXPIRED',     // Access token revoked

    // Permission errors
    40003: 'TIKTOK_API_PERMISSION_DENIED', // No permission
    40004: 'TIKTOK_API_PERMISSION_DENIED', // Insufficient scope
    40105: 'TIKTOK_API_PERMISSION_DENIED', // Unauthorized advertiser

    // Rate limiting
    40002: 'TIKTOK_API_RATE_LIMIT',        // Can be rate limit (check message)
    40200: 'TIKTOK_API_RATE_LIMIT',        // Request frequency too high

    // Account issues
    40301: 'TIKTOK_API_ACCOUNT_DISABLED',  // Advertiser account abnormal
    40302: 'TIKTOK_API_ACCOUNT_DISABLED',  // Advertiser not found

    // System errors
    50000: 'NETWORK_SERVER_ERROR',         // System error
    50001: 'NETWORK_SERVER_ERROR',         // Service error
    50002: 'NETWORK_SERVER_ERROR',         // Service temporarily unavailable
  };

  // TikTok code 40002 e ambiguu: poate fi rate limit SAU parameter error
  // Verifică message-ul pentru a distinge
  let errorCode = 'TIKTOK_API_FETCH_FAILED'; // fallback

  if (codeMapping[ttCode]) {
    errorCode = codeMapping[ttCode];

    // Disambiguare 40002
    if (ttCode === 40002) {
      if (ttMessage.includes('throttl') || ttMessage.includes('rate') || ttMessage.includes('frequency')) {
        errorCode = 'TIKTOK_API_RATE_LIMIT';
      } else {
        errorCode = 'TIKTOK_API_FETCH_FAILED'; // parameter error, nu rate limit
      }
    }
  } else if (httpStatus === 429) {
    errorCode = 'TIKTOK_API_RATE_LIMIT';
  } else if (httpStatus === 401) {
    errorCode = 'TIKTOK_API_TOKEN_EXPIRED';
  } else if (httpStatus === 403) {
    errorCode = 'TIKTOK_API_PERMISSION_DENIED';
  } else if (httpStatus >= 500) {
    errorCode = 'NETWORK_SERVER_ERROR';
  }

  return {
    errorCode,
    details: {
      httpStatus,
      tiktokCode: ttCode,
      tiktokMessage: ttResponse?.message,
      tiktokRequestId: requestId,
    },
  };
}
```

#### Funcție helper unificată pentru toate paginile:

```typescript
// src/lib/utils/api-helpers.ts

import { handleApiError } from '$lib/api-error-mappers';
import { fetchWithRetry } from '$lib/utils/retry';
import { logger } from '$lib/logger';
import type { AdPlatform } from '$lib/api-error-mappers';

// Wrapper complet: fetch + retry + error mapping + performance log
// Se folosește pe ORICE pagină ads, schimbi doar platform-ul

interface PlatformFetchOptions {
  platform: AdPlatform;
  url: string;
  action: string;
  body?: Record<string, unknown>;
  method?: string;
  timeoutMs?: number;
  maxAttempts?: number;
}

async function platformFetch<T>(options: PlatformFetchOptions): Promise<T | null> {
  const {
    platform,
    url,
    action,
    body,
    method = 'POST',
    timeoutMs = 30000,
    maxAttempts = 3,
  } = options;

  const start = performance.now();

  try {
    const response = await fetchWithRetry(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }, {
      maxAttempts,
      timeoutMs,
      onRetry: (attempt) => {
        logger.warn({
          action,
          message: `[${platform}] Retry attempt ${attempt} for ${action}`,
          showToast: false,
        });
      },
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      await handleApiError(platform, response, errorBody, action);
      return null;
    }

    const data = await response.json() as T;
    const duration = Math.round(performance.now() - start);
    logger.performanceLog(action, duration);

    return data;

  } catch (error) {
    logger.networkError(action, error);
    return null;
  }
}

// =================== UTILIZARE PE FIECARE PAGINĂ ===================

// META ADS:
const campaigns = await platformFetch<Campaign[]>({
  platform: 'meta',
  url: '/api/meta-ads/campaigns',
  action: 'load_meta_campaigns',
  body: { accounts: selectedAccounts, dateRange },
});

// GOOGLE ADS:
const campaigns = await platformFetch<Campaign[]>({
  platform: 'google',
  url: '/api/google-ads/campaigns',
  action: 'load_google_campaigns',
  body: { accounts: selectedAccounts, dateRange },
});

// TIKTOK ADS:
const campaigns = await platformFetch<Campaign[]>({
  platform: 'tiktok',
  url: '/api/tiktok-ads/campaigns',
  action: 'load_tiktok_campaigns',
  body: { accounts: selectedAccounts, dateRange },
});
```

---

## FAZA 7: PAGINA /admin/logs

### Rută: VERIFICĂ pattern-ul de routing existent

```
Dacă rutele admin sunt: src/routes/[lang]/admin/... -> creează în [lang]/admin/logs/
Dacă rutele admin sunt: src/routes/admin/...        -> creează în admin/logs/
Verifică dacă există +layout.svelte în admin/ care protejează accesul.
```

### Layout vizual:

```
┌──────────────────────────────────────────────────────────────┐
│  STATS BAR                                                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐ ┌─────────────┐ │
│  │ Erori 24h│ │ Erori 7d │ │ Top Eroare   │ │ Top Pagină  │ │
│  │    12    │ │    87    │ │ META_API_... │ │ /meta-ads   │ │
│  └──────────┘ └──────────┘ └──────────────┘ └─────────────┘ │
├──────────────────────────────────────────────────────────────┤
│  FILTRE + ACȚIUNI                                            │
│  [Level ▾] [Source ▾] [Page ▾] [Date range] [Search...]      │
│  [Status ▾] [Aplică] [Resetează] [Export CSV] [Live mode ○]  │
├──────────────────────────────────────────────────────────────┤
│  TABEL LOGS                                                  │
│  ┌────┬────────────┬────────┬──────┬────────┬───────┬──────┐ │
│  │ ☐  │ Timestamp  │ Level  │Source│ Page   │Message│Solved│ │
│  ├────┼────────────┼────────┼──────┼────────┼───────┼──────┤ │
│  │ ☐  │ acum 5 min │ ERROR  │ api  │/meta-ad│Meta AP│  ✗   │ │
│  │ ☐  │ acum 8 min │ WARN   │client│/meta-ad│Date ra│  ✗   │ │
│  │ ☐  │ ieri 14:30 │ INFO   │server│/invoic │Invoic │  ✓   │ │
│  └────┴────────────┴────────┴──────┴────────┴───────┴──────┘ │
│  ◀ 1 2 3 ... 15 ▶                         50 per page ▾     │
├──────────────────────────────────────────────────────────────┤
│  BULK ACTIONS (vizibil doar când sunt selectate rânduri)      │
│  [✓ Mark resolved] [✗ Mark unresolved]                       │
└──────────────────────────────────────────────────────────────┘
```

### Modal detalii log (click pe rând din tabel):

```
┌──────────────────────────────────────────────────┐
│  Log Details #1234                          [X]  │
├──────────────────────────────────────────────────┤
│                                                  │
│  Level:      ERROR  (badge roșu)                 │
│  Source:     api                                  │
│  Page:       /meta-ads                            │
│  Action:     campaign_fetch                       │
│  Error Code: META_API_RATE_LIMIT                  │
│  Timestamp:  28 Mar 2026, 10:15:30 EET            │
│  Request ID: a1b2c3d4-e5f6-...                   │
│  Duration:   4523ms                               │
│  User:       admin (id: 1)                        │
│  User Agent: Chrome 131 / macOS 15                │
│  IP:         188.25.xxx.xxx                       │
│                                                  │
│  Message:                                         │
│  ┌────────────────────────────────────────────┐   │
│  │ Meta API returned 429 - rate limit exceeded│   │
│  └────────────────────────────────────────────┘   │
│                                                  │
│  Details (JSON pretty-printed):                   │
│  ┌────────────────────────────────────────────┐   │
│  │ {                                          │   │
│  │   "status": 429,                           │   │
│  │   "accountId": "act_123456",               │   │
│  │   "endpoint": "/v21/insights"              │   │
│  │ }                                          │   │
│  └────────────────────────────────────────────┘   │
│                                                  │
│  Stack Trace (dacă există în details):            │
│  ┌────────────────────────────────────────────┐   │
│  │ Error: Meta API rate limit                 │   │
│  │   at fetchCampaigns (client.ts:45)         │   │
│  │   at applyFilters (+page.svelte:123)       │   │
│  └────────────────────────────────────────────┘   │
│                                                  │
│  Suggested Fix (din error-codes.ts):              │
│  Wait for rate limit reset or reduce              │
│  request frequency                                │
│                                                  │
│  ─── Resolution ───                               │
│  Status: ○ Unresolved  ● Resolved                 │
│  Note:  [                                    ]    │
│         [Salvează]                                │
│                                                  │
└──────────────────────────────────────────────────┘
```

### Funcționalități pagina:

```
1. Auto-refresh (Live mode):
   - Toggle button "Live mode" care activează polling la 30s
   - Indicator vizual când e activ (pulsing dot verde)
   - OPREȘTE polling-ul când tab-ul e inactiv (document.visibilityState)
   - Sound notification opțional pentru erori noi (toggle separat)

2. Filtre persistente:
   - Toate filtrele se salvează în URL query params
   - La refresh sau share link, filtrele se restaurează
   - Buton "Resetează" care curăță toate filtrele

3. Keyboard shortcuts:
   - R = refresh manual
   - Escape = close modal
   - Ctrl+A = select all visible rows

4. Color coding:
   - ERROR = badge roșu
   - WARN = badge galben/amber
   - INFO = badge albastru
   - DEBUG = badge gri

5. Timestamps relative:
   - "acum 5 min", "acum 2 ore", "ieri 14:30", "25 Mar"
   - Tooltip cu datetime complet la hover

6. Error grouping toggle:
   - Buton care grupează log-urile cu acelasi (errorCode + page)
   - Afișează count + first occurrence + last occurrence
   - Click pe grup expandează toate log-urile individuale

7. Export CSV:
   - Exportă log-urile filtrate curent (nu toate)
   - Include toate câmpurile
   - Nume fișier: ots-logs-YYYY-MM-DD.csv

8. Cleanup manual:
   - Buton "Cleanup" cu dialog de confirmare
   - Arată câte log-uri vor fi șterse per nivel
   - Folosește DELETE /api/logs/cleanup
```

### Server load (pentru pagina admin/logs):

```typescript
// +page.server.ts
// Încarcă log-urile inițiale cu filtrele din URL
// Stats-urile se pot încărca și client-side (lazy) dacă sunt lente
```

---

## FAZA 8: INTEGRARE PE PAGINILE ADS (Meta, Google, TikTok)

### Ordinea: meta-ads primul (are cel mai mult cod), apoi google-ads, apoi tiktok-ads

### Checklist de integrare (SE APLICĂ PE FIECARE PAGINĂ ADS):

```
1. GREP CONSOLE CALLS
   - Caută toate console.log, console.error, console.warn, console.info
   - Înlocuiește fiecare cu logger.xxx() echivalent
   - Adaugă context: action, errorCode (dacă e relevant)

2. ADAUGĂ VALIDĂRI PE FILTRE
   Date range picker:
   - La change sau submit -> validateDateRange()
   - Dacă invalid, NU face fetch, arată toast warning

   Account selector:
   - La change -> validateAccountSelection()
   - Dacă invalid, disable butonul de apply/fetch

   Campaign status filter:
   - La change -> validateFilterOptions()

   Search box:
   - La submit/enter -> validateSearchInput()
   - Debounce input (300ms) dacă e live search

3. ADAUGĂ VALIDĂRI PE EXPORT/DOWNLOAD
   - Verifică că campaigns[] nu e gol -> validateExportRequest()
   - Loading state pe buton (disable + spinner)
   - Timeout handling (dacă > 30s, toast warning)
   - Success toast la finalizare

4. ADAUGĂ TRY/CATCH PE TOATE FETCH-URILE
   - Folosește platformFetch() din api-helpers.ts
   - Specifică platform: 'meta' | 'google' | 'tiktok'
   - Error mapping-ul se face AUTOMAT prin api-error-mappers.ts
   - NU mai pune if/else pe status codes inline, mapper-ul rezolvă
   - ALWAYS: loading state start în try, end în finally

5. ADAUGĂ PERFORMANCE LOGGING
   - platformFetch() logează automat durata
   - Warning automat dacă > 3s (configurat în logger.performanceLog)

6. TOAST-URI CLARE
   - Filter apply success -> NIMIC (nu deranja user-ul la succes normal)
   - Filter apply error -> toast error cu mesaj specific platformei
   - Export success -> toast.success('Raportul a fost descărcat cu succes.')
   - Export error -> toast error
   - Validation fail -> toast warning cu mesaj specific RO
```

### Error codes per platformă (referință rapidă):

```
META ADS (din api-error-mappers.ts):
  HTTP 429 / code 4,17,32    -> META_API_RATE_LIMIT
  HTTP 401 / code 190        -> META_API_TOKEN_EXPIRED
  HTTP 403 / code 10,200,294 -> META_API_PERMISSION_DENIED
  code 2635 / subcode 1487390-> META_API_ACCOUNT_DISABLED
  code 1,2                   -> META_API_INVALID_RESPONSE
  orice alt fail             -> META_API_FETCH_FAILED

GOOGLE ADS (din api-error-mappers.ts):
  gRPC RESOURCE_EXHAUSTED    -> GOOGLE_API_RATE_LIMIT
  gRPC UNAUTHENTICATED       -> GOOGLE_API_TOKEN_EXPIRED
  gRPC PERMISSION_DENIED     -> GOOGLE_API_PERMISSION_DENIED
  CUSTOMER_NOT_ENABLED       -> GOOGLE_API_ACCOUNT_DISABLED
  gRPC INTERNAL/UNAVAILABLE  -> NETWORK_SERVER_ERROR
  orice alt fail             -> GOOGLE_API_FETCH_FAILED

TIKTOK ADS (din api-error-mappers.ts):
  code 40200 / 40002+throttl -> TIKTOK_API_RATE_LIMIT
  code 40001,40100-40103     -> TIKTOK_API_TOKEN_EXPIRED
  code 40003,40004,40105     -> TIKTOK_API_PERMISSION_DENIED
  code 40301,40302           -> TIKTOK_API_ACCOUNT_DISABLED
  code 50000-50002           -> NETWORK_SERVER_ERROR
  orice alt fail             -> TIKTOK_API_FETCH_FAILED

COMUN (se aplică pe ORICE platformă):
  TypeError: Failed to fetch  -> NETWORK_FETCH_FAILED
  AbortError (timeout)        -> NETWORK_TIMEOUT
  navigator.onLine = false    -> NETWORK_OFFLINE
```

### Pattern de cod: META ADS (exemplu complet)

```svelte
<script lang="ts">
  import { logger } from '$lib/logger';
  import { validateDateRange, validateAccountSelection, validateExportRequest } from '$lib/validators';
  import { platformFetch } from '$lib/utils/api-helpers';

  let loading = $state(false);
  let exporting = $state(false);
  let campaigns = $state<Campaign[]>([]);

  async function loadCampaigns() {
    // 1. Validare (identică pe toate paginile ads)
    const dateCheck = validateDateRange(startDate, endDate);
    if (!dateCheck.valid) {
      logger.validationError('load_campaigns', dateCheck.errorCode!);
      return;
    }

    const accountCheck = validateAccountSelection(selectedAccounts);
    if (!accountCheck.valid) {
      logger.validationError('load_campaigns', accountCheck.errorCode!);
      return;
    }

    // 2. Fetch cu platformFetch (o singură linie schimbă platforma)
    loading = true;
    try {
      const data = await platformFetch<Campaign[]>({
        platform: 'meta',                       // <- SCHIMBĂ AICI per platformă
        url: '/api/meta-ads/campaigns',          // <- SCHIMBĂ AICI per platformă
        action: 'load_meta_campaigns',           // <- prefix cu platforma
        body: {
          accounts: selectedAccounts,
          dateRange: { start: startDate, end: endDate },
          status: selectedStatuses,
        },
      });

      if (data) {
        campaigns = data;
      }
      // Eroarea se logează automat în platformFetch dacă data e null

    } finally {
      loading = false;
    }
  }

  async function exportReport(format: 'csv' | 'xlsx' | 'pdf') {
    const exportCheck = validateExportRequest(campaigns, format);
    if (!exportCheck.valid) {
      logger.validationError('export_report', exportCheck.errorCode!);
      return;
    }

    exporting = true;
    try {
      const blob = await platformFetch<Blob>({
        platform: 'meta',
        url: '/api/meta-ads/export',
        action: 'export_meta_report',
        body: { campaigns, format },
        timeoutMs: 60000,
      });

      if (blob) {
        // Descarcă fișierul
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `meta-ads-report.${format}`;
        a.click();
        URL.revokeObjectURL(url);

        const { toast } = await import('$lib/stores/toast');
        toast.success('Raportul a fost descărcat cu succes.');
      }
    } finally {
      exporting = false;
    }
  }
</script>
```

### Pattern de cod: GOOGLE ADS (diferențe față de Meta)

```svelte
<script lang="ts">
  // Importurile sunt IDENTICE cu Meta
  import { logger } from '$lib/logger';
  import { validateDateRange, validateAccountSelection } from '$lib/validators';
  import { platformFetch } from '$lib/utils/api-helpers';

  async function loadCampaigns() {
    // Validarea e IDENTICĂ

    loading = true;
    try {
      const data = await platformFetch<Campaign[]>({
        platform: 'google',                      // <- diferență
        url: '/api/google-ads/campaigns',         // <- diferență
        action: 'load_google_campaigns',          // <- diferență
        body: {
          accounts: selectedAccounts,
          dateRange: { start: startDate, end: endDate },
          // Google Ads poate avea filtre specifice:
          campaignType: selectedCampaignTypes,     // SEARCH, DISPLAY, VIDEO etc.
          status: selectedStatuses,
        },
      });

      if (data) campaigns = data;
    } finally {
      loading = false;
    }
  }
</script>
```

### Pattern de cod: TIKTOK ADS (diferențe față de Meta)

```svelte
<script lang="ts">
  import { logger } from '$lib/logger';
  import { validateDateRange, validateAccountSelection } from '$lib/validators';
  import { platformFetch } from '$lib/utils/api-helpers';

  async function loadCampaigns() {
    // Validarea e IDENTICĂ

    loading = true;
    try {
      const data = await platformFetch<Campaign[]>({
        platform: 'tiktok',                       // <- diferență
        url: '/api/tiktok-ads/campaigns',          // <- diferență
        action: 'load_tiktok_campaigns',           // <- diferență
        body: {
          advertiserIds: selectedAccounts,          // TikTok folosește advertiser_id
          dateRange: { start: startDate, end: endDate },
          status: selectedStatuses,
        },
      });

      if (data) campaigns = data;
    } finally {
      loading = false;
    }
  }
</script>
```

---

## FAZA 9: PATTERN PENTRU RESTUL PAGINILOR

Odată ce paginile ads sunt implementate, aplică pattern-ul pe restul:

| Pagină | Acțiuni de logat | Validări specifice | Notă |
|--------|------------------|--------------------|------|
| `/invoices` | Generate invoice, download PDF | Period select, account select, format | Poate folosi platformFetch cu platform-specific mappers |
| `/clients` | CRUD client, assign accounts | Email valid, required fields | Logger + validatori generici |
| `/settings` | Update config, API keys | Token format, required fields | Logger + validatori generici |
| `/dashboard` | Load widgets, aggregate data | Date range | Poate agrega erori din mai multe platforme |

Pentru fiecare pagină:
1. Grep la `console.log`, `console.error`, `console.warn` -> înlocuiește cu `logger.xxx()`
2. Adaugă validări pe toate inputurile/filtrele cu funcțiile din validators.ts
3. Pentru API calls ads: folosește `platformFetch()` cu platforma corectă
4. Pentru alte API calls: folosește `fetchWithRetry()` direct + `logger.apiError()`
5. Adaugă loading states corecte (start/end în try/finally)
6. Error codes per platformă se rezolvă automat prin api-error-mappers.ts

---

## EXTRA: AUTO-CLEANUP CRON

### Fișier: `src/lib/server/crons/log-cleanup.ts`

```
Retenție per nivel:
  debug: 7 zile
  info:  30 zile
  warn:  90 zile
  error: 365 zile

Rulare: zilnic la 03:00 AM (sau la server startup dacă nu există cron native)

Logare rezultat (ca log info):
  "Log cleanup completed: deleted 45 debug, 12 info, 3 warn, 0 error entries"

Implementare: SELECT count + DELETE WHERE timestamp < threshold per level
Folosește batch delete (LIMIT 1000 per query) pentru a nu bloca DB-ul
```

---

## EXTRA: HEALTH CHECK

### Endpoint: `GET /api/health`

```json
{
  "status": "healthy",
  "timestamp": "2026-03-28T10:15:30Z",
  "uptime": "3d 14h 22m",
  "services": {
    "database": { "status": "up", "latencyMs": 12 },
    "metaApi": { "status": "up", "tokenValid": true },
    "googleApi": { "status": "up", "tokenValid": true },
    "tiktokApi": { "status": "up", "tokenValid": true }
  },
  "logs": {
    "errorsLast24h": 3,
    "unresolvedErrors": 7
  }
}
```

Verificări:
- Database: `SELECT 1` cu timeout 5s
- API tokens: verifică dacă sunt prezente și nu expirate (nu face API call real)
- Log stats: count rapid din app_logs

---

## EXTRA: REQUEST ID TRACKING

```
1. CLIENT: generează UUID înainte de orice fetch
   -> pune-l în header X-Request-ID
   -> logger-ul îl atașează automat la toate log-urile din acea operațiune

2. SERVER: citește X-Request-ID din request headers
   -> dacă lipsește, generează unul nou
   -> îl propagă în toate log-urile din handler
   -> îl returnează în response header X-Request-ID

3. ADMIN/LOGS: câmp de căutare dedicat "Request ID"
   -> afișează toate log-urile (client + server) cu același requestId
   -> permite urmărirea completă a unui flow (client -> server -> API -> response)
```

---

## ORDINEA FINALĂ DE IMPLEMENTARE

```
FAZA 0: Analiză proiect (NU SCRIE COD)          -> raportează structura găsită
FAZA 1: Schema DB app_logs + migrare            -> verifică că migrarea e corectă
FAZA 2: Error codes registry                     -> src/lib/error-codes.ts (toate platformele)
FAZA 3: Logger core module                       -> src/lib/logger.ts (extinde existentul)
FAZA 4: Toast system                             -> folosește/extinde cel existent
FAZA 5: API endpoints /api/logs                  -> CRUD + withErrorHandling wrapper
FAZA 6: Validation + Retry + Error Mappers       -> validators.ts + retry.ts + api-error-mappers.ts + api-helpers.ts
FAZA 7: Pagina /admin/logs                       -> UI complet cu filtre, tabel, modal
FAZA 8: Integrare ads (meta -> google -> tiktok) -> platformFetch pe toate paginile ads
FAZA 9: Pattern restul paginilor                 -> invoices, clients, settings, dashboard
EXTRA:  Cleanup cron, health check, request ID   -> după ce core-ul e stabil
```

## REGULI DE IMPLEMENTARE

1. Fă FAZA 0 (analiză) OBLIGATORIU înainte de orice cod
2. Implementează fază cu fază, nu sari etape
3. După fiecare fază, confirmă că funcționează înainte de a trece mai departe
4. Folosește librăriile/componentele UI EXISTENTE din proiect
5. Respectă pattern-urile de cod existente
6. Nu folosi `any` în TypeScript
7. Mesaje toast în Română, logs interne în Engleză
8. Nu folosi em dash (cele lungi)
9. Testează pe /meta-ads primul, apoi aplică pe /google-ads și /tiktok-ads
10. La orice dubiu despre structura existentă, CITEȘTE codul, nu presupune
11. Fișierele noi adăugate de acest skill: error-codes.ts, validators.ts, retry.ts, api-error-mappers.ts, api-helpers.ts, api-utils.ts (server)