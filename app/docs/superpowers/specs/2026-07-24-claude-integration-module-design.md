# Modul „Claude" — plugin cu credențiale API per-tenant (design)

**Data:** 2026-07-24
**Branch context:** `feat/heylux-content-rewrite`
**Status:** aprobat (brainstorming) → urmează plan de implementare

## Scop

Un **plugin nou „Claude"** în framework-ul de plugin-uri existent, în care **fiecare tenant își salvează propria cheie Claude/Anthropic**, criptată per-tenant. Se activează/dezactivează din `/[tenant]/settings/plugins` (ca stripe/keez/smartbill), iar credențialele se configurează dintr-o pagină dedicată accesată prin butonul „Configurează Claude".

În acest prim pas modulul acoperă **doar credențialele**:

- înregistrare ca plugin (toggle enable/disable per-tenant în `/settings/plugins`);
- salvare cheie criptată + `defaultModel` per-tenant;
- buton „Test conexiune";
- pagină de configurare dedicată;
- un helper server refolosibil `getClaudeClient(tenantId)` pe care funcțiile AI viitoare îl vor apela.

**Nu** conectăm încă nicio funcție AI (rescrierea Heylux Faza 2, playground etc.) — scope separat, ulterior.

## Non-scop (YAGNI)

- Fără `@anthropic-ai/sdk` — **client raw-fetch** (abordarea A, confirmată).
- Fără conectare la pipeline-ul de rescriere content.
- Fără playground de prompt.
- Fără card separat în indexul Settings (plugin-urile apar în pagina `/settings/plugins`, nu în index).
- Fără intrare în sidebar-ul principal.
- Fără afișare de usage/spend.

## Context & pattern existent

### Framework de plugin-uri
- Registru global `plugin` (`name` unic, `displayName`, `description`, `version`, `isActive`, `config` jsonb) + `tenantPlugin` (enable/disable + config per-tenant), în `src/lib/server/db/schema.ts`.
- Fiecare plugin = o clasă în `src/lib/server/plugins/<name>/plugin.ts` care implementează `Plugin` (`id`, `name`, `version`, `displayName`, `description`, `initialize`, `registerHooks`, `onEnable`, `onDisable`).
- Înregistrare la boot în `src/lib/server/plugins/index.ts` (`initializePlugins()`, apelat din `src/hooks.server.ts`): `registry.register(<plugin>)` + un `ensure<Name>PluginInDatabase()` idempotent (insert după `name` dacă lipsește, id base32).
- Pagina `src/routes/[tenant]/settings/plugins/+page.svelte` listează plugin-urile cu switch enable/disable și, per plugin, un bloc `{#if plugin.name === '<name>'}` cu buton „Configurează …" → `/[tenant]/settings/<name>` (afișat doar când e enabled).

### Template de referință: **Stripe** (analogul cel mai apropiat)
- Credențiale sensibile într-un **tabel dedicat criptat** (`stripe_integration`), NU în `tenantPlugin.config` (jsonb plain).
- Clasa `plugins/stripe/plugin.ts` e doar manifest + lifecycle; `onDisable` **nu** șterge credențialele.
- Pagina de config: `src/routes/[tenant]/settings/stripe/+page.svelte`.

### Crypto & client
- **Crypto source-of-truth:** `src/lib/server/plugins/smartbill/crypto.ts` — `encrypt`/`decrypt`/`encryptVerified`/`DecryptionError`, AES-256-GCM, cheie derivată din `tenantId` + `ENCRYPTION_SECRET`. `plugins/stripe/crypto.ts` doar re-exportă; facem la fel.
- **Client raw-fetch:** stilul din `plugins/directadmin/client.ts` / `plugins/keez/client.ts`.
- **Remote functions:** pattern `query`/`command` cu `requireStaff` (memoria F8).

### Stare curentă Claude
Nu există integrare Claude API. Singurul fișier „anthropic" (`src/lib/server/gmail/parsers/anthropic.ts`) doar parsează facturile primite de la Anthropic. Nicio dependență `@anthropic-ai/*` în `package.json`.

## Decizii confirmate

1. **Scop:** doar plugin de credențiale (stocare + test + helper), fără funcții AI conectate.
2. **Tip cheie:** acceptă **ambele** — Anthropic API key (`sk-ant-api…`, header `x-api-key`) și Claude Code OAuth token (`sk-ant-oat…`, header `Authorization: Bearer`), detectate după prefix.
3. **Model implicit:** câmp `defaultModel` per-tenant (dropdown modele curente).
4. **Client:** abordarea **A** — raw-fetch, fără dependență nouă, în spatele unei interfețe `ClaudeClient`.
5. **Plasare:** plugin în `/[tenant]/settings/plugins`; config pe pagină dedicată `/[tenant]/settings/claude` (accesată prin butonul din pagina plugins).

## Arhitectură & componente

### Fișiere noi
- `src/lib/server/plugins/claude/plugin.ts` — `ClaudePlugin implements Plugin` (`id='claude'`, `name='claude'`, `displayName='Claude'`, `version='1.0.0'`, `initialize`/`registerHooks` no-op, `onEnable`/`onDisable` doar log — **nu** șterge credențialele). Export `claudePlugin`.
- `src/lib/server/plugins/claude/crypto.ts` — re-export din `../smartbill/crypto`.
- `src/lib/server/plugins/claude/client.ts` — `ClaudeClient` raw-fetch: alege header după `keyType`, `anthropic-version: 2023-06-01`, `AbortSignal.timeout`. Metode: `testConnection()`, `listModels()`; opțional `createMessage(params)` ca bază pentru consumatorii viitori.
- `src/lib/server/plugins/claude/index.ts` — `getClaudeClient(tenantId): Promise<ClaudeClient | null>` (vezi flux); `getClaudeModels()` (sursă unică pentru dropdown).
- `src/lib/remotes/claude-integration.remote.ts` — remote functions (toate `requireStaff`, scop pe `tenantId`).
- `src/routes/[tenant]/settings/claude/+page.svelte` — pagina de configurare (formular credențiale).
- Migrare SQL hand-authored în `drizzle/` — un singur `CREATE TABLE claude_integration`.

### Fișiere modificate
- `src/lib/server/db/schema.ts` — tabelul `claudeIntegration`.
- `src/lib/server/plugins/index.ts` — import + `registry.register(claudePlugin)` + `ensureClaudePluginInDatabase()` (idempotent, apelat în `initializePlugins()`).
- `src/routes/[tenant]/settings/plugins/+page.svelte` — bloc `{#if plugin.name === 'claude'}` cu buton „Configurează Claude" → `/[tenant]/settings/claude`.

## Schema tabel `claudeIntegration`

Oglindă după `stripeIntegration` (creds în tabel dedicat, nu în `tenantPlugin.config`):

| câmp | tip | note |
|---|---|---|
| `id` | `text` PK | |
| `tenantId` | `text` notNull, FK→`tenant.id`, **unique** | un rând / tenant |
| `apiKeyEncrypted` | `text` notNull | AES-256-GCM per-tenant |
| `keyType` | `text` notNull | `'api'` \| `'oat'`, derivat din prefix la salvare (nesensibil → evită decriptarea pt. alegerea header-ului) |
| `keyHint` | `text` notNull | ultimele 4 caractere, pentru afișare (`sk-ant-…abcd`) |
| `defaultModel` | `text` notNull | default `'claude-sonnet-5'` |
| `isActive` | `boolean` notNull default `true` | |
| `lastTestedAt` | `timestamp` nullable | |
| `lastError` | `text` nullable | |
| `createdAt` | `timestamp` notNull default `current_timestamp` | |
| `updatedAt` | `timestamp` notNull default `current_timestamp` | |

Index: `claude_integration_tenant_idx` pe `tenantId`.

### Modele pentru dropdown (`getClaudeModels()`)
- `claude-opus-4-8` — Opus 4.8
- `claude-sonnet-5` — Sonnet 5 *(default)*
- `claude-haiku-4-5-20251001` — Haiku 4.5
- `claude-fable-5` — Fable 5

## Remote functions (`claude-integration.remote.ts`)
Toate cu `requireStaff` + scop pe `tenantId` (memoriile F8 + multi-tenant).

- `getClaudeIntegrationStatus()` — query: `{ connected, keyType, keyHint, defaultModel, isActive, lastTestedAt, lastError }`. **Nu întoarce niciodată cheia.**
- `saveClaudeIntegration({ apiKey, defaultModel })` — command (single-flight):
  1. validează prefix `sk-ant-` (altfel „cheie invalidă");
  2. derivă `keyType` (`sk-ant-oat…` → `oat`, altfel `api`);
  3. `keyHint` = ultimele 4 caractere;
  4. `encryptVerified(tenantId, apiKey)`;
  5. upsert (un rând/tenant) — **nu suprascrie cu gol** (la edit fără cheie nouă, actualizează doar `defaultModel`).
- `testClaudeConnection()` — command: `getClaudeClient` → `GET /v1/models` cu header-ul corect (fără consum de tokeni); actualizează `lastTestedAt`/`lastError`; întoarce `{ ok, models?/error }`. Fallback `oat`: dacă `/v1/models` respinge, `POST /v1/messages` minimal `max_tokens:1`.
- `deleteClaudeIntegration()` — command: șterge rândul tenantului.

## Flux de date

**Activare plugin:** staff activează „Claude" din `/settings/plugins` → apare butonul „Configurează Claude".

**Salvare cheie:** staff introduce cheia (+ model) pe `/settings/claude` → validare prefix → derivă `keyType`/`keyHint` → `encryptVerified` → upsert → răspuns fără cheie.

**Consum (viitor):** `getClaudeClient(tenantId)`:
1. verifică plugin activ pt. tenant (`registry.isPluginActiveForTenant(tenantId, 'claude')`) → dacă nu, `null`;
2. citește `claudeIntegration`; dacă lipsă/`!isActive` → `null`;
3. decriptează (retry pe `DecryptionError`, fresh DB read);
4. întoarce `ClaudeClient` legat de cheie + header corect + `defaultModel`.

**Test:** `GET https://api.anthropic.com/v1/models` + `anthropic-version: 2023-06-01` + header după `keyType`; 200 → valid; 401 → „cheie invalidă"; scrie `lastTestedAt`/`lastError`.

## Securitate & tratarea erorilor
- `requireStaff` pe toate remote-urile; toate query-urile scopate pe `tenantId`.
- Cheia nu părăsește niciodată serverul (UI vede doar `keyHint`).
- `DecryptionError` → retry cu citire proaspătă; UI: „cheie coruptă, re-salveaz-o".
- `401` Anthropic → „cheie invalidă / expirată".
- `AbortSignal.timeout` pe orice fetch către Anthropic (memoria external-fetch-timeout).
- `encryptVerified` previne stocarea de ciphertext corupt.
- `onDisable` nu șterge credențialele (ca Stripe) — la re-enable rămân unde erau.

## Migrare
- Tabelul `claude_integration`: **hand-authored** (drizzle-kit generate stricat — memoria drizzle-meta-drift): `db:gen` sau SQL manual + `db:migrate`. Un singur statement per fișier. Verific `drizzle/meta/_journal.json`. După migrare, `PRAGMA table_info(claude_integration)` pe Turso.
- Rândul din registrul `plugin` NU necesită migrare SQL — e seed-uit la runtime prin `ensureClaudePluginInDatabase()` (idempotent), ca Stripe.
- **Atenție:** dev DB = Turso PROD (memoria pentest) — migrare aditivă, fără efecte pe rânduri existente.
- Regula schema select-all: coloana din `schema.ts` se adaugă **doar după** aplicarea migrării.

## UI

### Pagina plugins (`/settings/plugins`)
Bloc nou (consistent cu stripe/keez): titlu „Claude", descriere scurtă, iar când e enabled — buton „Configurează Claude" → `/[tenant]/settings/claude`.

### Pagina de config (`/settings/claude`)
- Card cu: status (conectat/neconectat + `keyHint` + `keyType`), input cheie (type password, placeholder `sk-ant-…`), dropdown `defaultModel`, butoane „Salvează" / „Test conexiune" / „Șterge".
- La conectat: `lastTestedAt` și, dacă există, `lastError` (banner amber).
- **Nu** adaugă padding exterior (layout-ul `[tenant]/+layout.svelte` dă deja `p-6`).
- Rulez `svelte-autofixer` (MCP) pe componentă după implementare (memoria svelte-mcp-check).

## Testare
- **Unit:** detecție prefix→`keyType`; alegere header per `keyType`; round-trip crypto (pattern test smartbill); `keyHint`.
- **Integration:** remote-uri — neautorizat (fără staff) respins; save→read→test happy path cu `fetch` mock-uit (200 și 401); `getClaudeClient` întoarce `null` când plugin dezactivat sau creds inactive.
- Conform skill-ului testing-strategy (golden + negative).

## Criterii de succes
1. „Claude" apare în `/settings/plugins` cu toggle enable/disable per-tenant; enabled → apare „Configurează Claude".
2. Un staff salvează o cheie `sk-ant-api…` sau `sk-ant-oat…`; e stocată criptat; UI arată „conectat" + `keyHint`.
3. „Test conexiune" → succes pe cheie validă, eroare clară pe cheie invalidă, fără consum de tokeni pe calea `api`.
4. `getClaudeClient(tenantId)` întoarce un client cu header corect + `defaultModel`, sau `null` dacă plugin dezactivat / creds lipsă / inactive.
5. Izolare per-tenant garantată; cheia nu ajunge niciodată la client.
6. `svelte-check` fără regresii; migrarea aplicată și verificată pe Turso.
