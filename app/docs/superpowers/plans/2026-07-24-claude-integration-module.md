# Modul „Claude" — Plan de Implementare

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un plugin nou „Claude" în care fiecare tenant își salvează propria cheie Claude/Anthropic (criptată per-tenant), cu Test conexiune și un helper server refolosibil `getClaudeClient(tenantId)`.

**Architecture:** Plugin în framework-ul existent (`plugins/claude/`), înregistrat + seed idempotent în `plugins/index.ts`, apare în `/settings/plugins` cu toggle și buton „Configurează Claude" → pagină dedicată `/settings/claude`. Credențialele stau într-un tabel dedicat criptat `claude_integration` (oglindă după `stripeIntegration`). Client raw-fetch (fără SDK) care alege header-ul după prefixul cheii (`sk-ant-api…` → `x-api-key`, `sk-ant-oat…` → `Authorization: Bearer`).

**Tech Stack:** SvelteKit 5 (remote functions `$app/server`), Drizzle + libSQL/Turso, valibot, `bun:test`, crypto AES-256-GCM (re-export din `smartbill/crypto`).

**Toate comenzile rulează din `/Users/augustin598/Projects/CRM/app`.**

Referință spec: `docs/superpowers/specs/2026-07-24-claude-integration-module-design.md`.

---

## Structura fișierelor

**Noi:**
- `src/lib/claude-models.ts` — catalog de modele (constante partajate client + server).
- `src/lib/server/plugins/claude/key-utils.ts` — `detectKeyType`, `keyHint`, `isValidClaudeKey` (pur, testat).
- `src/lib/server/plugins/claude/key-utils.test.ts`
- `src/lib/server/plugins/claude/client.ts` — `createClaudeClient` (raw-fetch, testat cu fetch injectat).
- `src/lib/server/plugins/claude/client.test.ts`
- `src/lib/server/plugins/claude/crypto.ts` — re-export din `../smartbill/crypto`.
- `src/lib/server/plugins/claude/index.ts` — `getClaudeClient(tenantId)`.
- `src/lib/server/plugins/claude/plugin.ts` — manifest `ClaudePlugin`.
- `src/lib/remotes/claude-integration.remote.ts` — remote functions (`requireStaff`).
- `src/routes/[tenant]/settings/claude/+page.svelte` — pagina de configurare.
- `drizzle/NNNN_claude_integration.sql` — generată via `db:gen`.

**Modificate:**
- `src/lib/server/db/schema.ts` — tabel `claudeIntegration`.
- `src/lib/server/plugins/index.ts` — `registry.register(claudePlugin)` + `ensureClaudePluginInDatabase()`.
- `src/routes/[tenant]/settings/plugins/+page.svelte` — bloc `{#if plugin.name === 'claude'}`.

---

## Task 1: Catalog de modele partajat

**Files:**
- Create: `src/lib/claude-models.ts`

Modelul e nevoie și în UI (client) și în server, deci trăiește într-un modul non-server (fără importuri `$lib/server/*`).

- [ ] **Step 1: Creează fișierul**

```ts
// src/lib/claude-models.ts
/**
 * Catalog de modele Claude oferite în dropdown-ul integrării.
 * Partajat între UI (client) și server — NU importa nimic din $lib/server aici.
 */
export const CLAUDE_MODELS = [
	{ id: 'claude-opus-4-8', label: 'Opus 4.8' },
	{ id: 'claude-sonnet-5', label: 'Sonnet 5' },
	{ id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
	{ id: 'claude-fable-5', label: 'Fable 5' }
] as const;

export type ClaudeModelId = (typeof CLAUDE_MODELS)[number]['id'];

export const CLAUDE_MODEL_IDS: string[] = CLAUDE_MODELS.map((m) => m.id);

export const DEFAULT_CLAUDE_MODEL: ClaudeModelId = 'claude-sonnet-5';

export function isKnownClaudeModel(id: string): boolean {
	return CLAUDE_MODEL_IDS.includes(id);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/claude-models.ts
git commit -m "feat(claude): catalog partajat de modele Claude"
```

---

## Task 2: Utilitare cheie (TDD)

**Files:**
- Create: `src/lib/server/plugins/claude/key-utils.ts`
- Test: `src/lib/server/plugins/claude/key-utils.test.ts`

- [ ] **Step 1: Scrie testul care pică**

```ts
// src/lib/server/plugins/claude/key-utils.test.ts
import { describe, expect, test } from 'bun:test';
import { detectKeyType, keyHint, isValidClaudeKey } from './key-utils';

describe('key-utils', () => {
	test('detectKeyType → oat pentru sk-ant-oat', () => {
		expect(detectKeyType('sk-ant-oat01-abcdefg')).toBe('oat');
	});

	test('detectKeyType → api pentru sk-ant-api (și orice non-oat)', () => {
		expect(detectKeyType('sk-ant-api03-abcdefg')).toBe('api');
		expect(detectKeyType('sk-ant-something-else')).toBe('api');
	});

	test('keyHint → ultimele 4 caractere', () => {
		expect(keyHint('sk-ant-api03-xyzTAIL')).toBe('TAIL');
	});

	test('isValidClaudeKey → true doar pentru prefix sk-ant- și lungime minimă', () => {
		expect(isValidClaudeKey('sk-ant-api03-0123456789012')).toBe(true);
		expect(isValidClaudeKey('  sk-ant-api03-0123456789012  ')).toBe(true); // tolerează whitespace
		expect(isValidClaudeKey('sk-proj-openai-123')).toBe(false);
		expect(isValidClaudeKey('sk-ant-')).toBe(false); // prea scurtă
		expect(isValidClaudeKey('')).toBe(false);
	});
});
```

- [ ] **Step 2: Rulează testul — trebuie să pice**

Run: `bun test src/lib/server/plugins/claude/key-utils.test.ts`
Expected: FAIL cu „Cannot find module './key-utils'".

- [ ] **Step 3: Implementează**

```ts
// src/lib/server/plugins/claude/key-utils.ts
export type ClaudeKeyType = 'api' | 'oat';

/** Anthropic OAuth tokens (Claude Code) încep cu `sk-ant-oat`; restul → API key. */
export function detectKeyType(key: string): ClaudeKeyType {
	return key.trim().startsWith('sk-ant-oat') ? 'oat' : 'api';
}

/** Ultimele 4 caractere, pentru afișare în UI (nesensibil). */
export function keyHint(key: string): string {
	return key.trim().slice(-4);
}

/** Validare de prefix + lungime minimă. Nu verifică validitatea la Anthropic. */
export function isValidClaudeKey(key: string): boolean {
	const k = key.trim();
	return /^sk-ant-/.test(k) && k.length >= 20;
}
```

- [ ] **Step 4: Rulează testul — trebuie să treacă**

Run: `bun test src/lib/server/plugins/claude/key-utils.test.ts`
Expected: PASS (4 teste).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/plugins/claude/key-utils.ts src/lib/server/plugins/claude/key-utils.test.ts
git commit -m "feat(claude): utilitare cheie (detectKeyType/keyHint/isValidClaudeKey) + teste"
```

---

## Task 3: Client raw-fetch (TDD)

**Files:**
- Create: `src/lib/server/plugins/claude/client.ts`
- Test: `src/lib/server/plugins/claude/client.test.ts`

`createClaudeClient` acceptă un `fetchImpl` opțional pentru testabilitate. Alege header după `keyType`. `testConnection` folosește `GET /v1/models` (fără consum de tokeni); pentru `oat`, dacă `/v1/models` respinge, fallback la un `POST /v1/messages` minimal.

- [ ] **Step 1: Scrie testul care pică**

```ts
// src/lib/server/plugins/claude/client.test.ts
import { describe, expect, test } from 'bun:test';
import { createClaudeClient } from './client';

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

describe('createClaudeClient — headers', () => {
	test('api key → x-api-key, fără authorization', () => {
		const c = createClaudeClient({ apiKey: 'sk-ant-api03-KEY', defaultModel: 'claude-sonnet-5' });
		const h = c.buildHeaders();
		expect(c.keyType).toBe('api');
		expect(h['x-api-key']).toBe('sk-ant-api03-KEY');
		expect(h['authorization']).toBeUndefined();
		expect(h['anthropic-version']).toBe('2023-06-01');
	});

	test('oat token → Authorization Bearer + anthropic-beta, fără x-api-key', () => {
		const c = createClaudeClient({ apiKey: 'sk-ant-oat01-TOK', defaultModel: 'claude-sonnet-5' });
		const h = c.buildHeaders();
		expect(c.keyType).toBe('oat');
		expect(h['authorization']).toBe('Bearer sk-ant-oat01-TOK');
		expect(h['anthropic-beta']).toContain('oauth');
		expect(h['x-api-key']).toBeUndefined();
	});
});

describe('createClaudeClient — testConnection', () => {
	test('200 la /v1/models → ok via models', async () => {
		const c = createClaudeClient({
			apiKey: 'sk-ant-api03-KEY',
			defaultModel: 'claude-sonnet-5',
			fetchImpl: async () => jsonResponse({ data: [{ id: 'claude-sonnet-5' }, { id: 'claude-opus-4-8' }] })
		});
		const r = await c.testConnection();
		expect(r.ok).toBe(true);
		expect(r.via).toBe('models');
		expect(r.models).toEqual(['claude-sonnet-5', 'claude-opus-4-8']);
	});

	test('api key 401 → aruncă cu status 401', async () => {
		const c = createClaudeClient({
			apiKey: 'sk-ant-api03-BAD',
			defaultModel: 'claude-sonnet-5',
			fetchImpl: async () => new Response('unauthorized', { status: 401 })
		});
		await expect(c.testConnection()).rejects.toThrow('401');
	});

	test('oat: /v1/models 403 apoi /v1/messages 200 → ok via messages', async () => {
		let call = 0;
		const c = createClaudeClient({
			apiKey: 'sk-ant-oat01-TOK',
			defaultModel: 'claude-sonnet-5',
			fetchImpl: async (url: string | URL) => {
				call++;
				const u = String(url);
				if (u.includes('/v1/models')) return new Response('forbidden', { status: 403 });
				if (u.includes('/v1/messages')) return jsonResponse({ id: 'msg_1' }, 200);
				return new Response('nope', { status: 404 });
			}
		});
		const r = await c.testConnection();
		expect(r.ok).toBe(true);
		expect(r.via).toBe('messages');
		expect(call).toBe(2);
	});
});
```

- [ ] **Step 2: Rulează testul — trebuie să pice**

Run: `bun test src/lib/server/plugins/claude/client.test.ts`
Expected: FAIL cu „Cannot find module './client'".

- [ ] **Step 3: Implementează**

```ts
// src/lib/server/plugins/claude/client.ts
import { detectKeyType, type ClaudeKeyType } from './key-utils';

const ANTHROPIC_BASE = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';
/** Beta flag folosit de Claude Code OAuth tokens; ajustează dacă Anthropic îl schimbă. */
const OAUTH_BETA = 'oauth-2025-04-20';
const DEFAULT_TIMEOUT_MS = 20_000;

export interface ClaudeClientOptions {
	apiKey: string;
	keyType?: ClaudeKeyType;
	defaultModel: string;
	/** Injectabil pentru teste; default = global fetch. */
	fetchImpl?: typeof fetch;
	timeoutMs?: number;
}

export interface ClaudeTestResult {
	ok: true;
	via: 'models' | 'messages';
	models: string[];
}

export interface ClaudeClient {
	readonly keyType: ClaudeKeyType;
	readonly defaultModel: string;
	buildHeaders(extra?: Record<string, string>): Record<string, string>;
	listModels(): Promise<string[]>;
	createMessage(body: Record<string, unknown>): Promise<Response>;
	testConnection(): Promise<ClaudeTestResult>;
}

export function createClaudeClient(opts: ClaudeClientOptions): ClaudeClient {
	const keyType: ClaudeKeyType = opts.keyType ?? detectKeyType(opts.apiKey);
	const doFetch = opts.fetchImpl ?? fetch;
	const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

	function buildHeaders(extra: Record<string, string> = {}): Record<string, string> {
		const h: Record<string, string> = { 'anthropic-version': ANTHROPIC_VERSION, ...extra };
		if (keyType === 'oat') {
			h['authorization'] = `Bearer ${opts.apiKey}`;
			h['anthropic-beta'] = OAUTH_BETA;
		} else {
			h['x-api-key'] = opts.apiKey;
		}
		return h;
	}

	async function req(path: string, init: RequestInit = {}): Promise<Response> {
		return doFetch(`${ANTHROPIC_BASE}${path}`, {
			...init,
			headers: { ...buildHeaders(), ...((init.headers as Record<string, string>) ?? {}) },
			signal: AbortSignal.timeout(timeoutMs)
		});
	}

	async function parseModelIds(res: Response): Promise<string[]> {
		const json = (await res.json().catch(() => ({ data: [] }))) as { data?: Array<{ id: string }> };
		return (json.data ?? []).map((m) => m.id);
	}

	async function listModels(): Promise<string[]> {
		const res = await req('/v1/models');
		if (!res.ok) {
			const body = await res.text().catch(() => '');
			throw new Error(`Anthropic /v1/models ${res.status}: ${body.slice(0, 200)}`);
		}
		return parseModelIds(res);
	}

	async function createMessage(body: Record<string, unknown>): Promise<Response> {
		return req('/v1/messages', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
	}

	async function testConnection(): Promise<ClaudeTestResult> {
		const res = await req('/v1/models');
		if (res.ok) {
			return { ok: true, via: 'models', models: await parseModelIds(res) };
		}
		// OAuth tokens pot să nu fie acceptate pe /v1/models — fallback la un mesaj minimal.
		if (keyType === 'oat' && [401, 403, 404].includes(res.status)) {
			const msgRes = await createMessage({
				model: opts.defaultModel,
				max_tokens: 1,
				messages: [{ role: 'user', content: 'ping' }]
			});
			if (msgRes.ok) return { ok: true, via: 'messages', models: [] };
			const body = await msgRes.text().catch(() => '');
			throw new Error(`Anthropic /v1/messages ${msgRes.status}: ${body.slice(0, 200)}`);
		}
		const body = await res.text().catch(() => '');
		throw new Error(`Anthropic /v1/models ${res.status}: ${body.slice(0, 200)}`);
	}

	return { keyType, defaultModel: opts.defaultModel, buildHeaders, listModels, createMessage, testConnection };
}
```

- [ ] **Step 4: Rulează testul — trebuie să treacă**

Run: `bun test src/lib/server/plugins/claude/client.test.ts`
Expected: PASS (5 teste).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/plugins/claude/client.ts src/lib/server/plugins/claude/client.test.ts
git commit -m "feat(claude): client raw-fetch (header după prefix, testConnection cu fallback oat) + teste"
```

---

## Task 4: Re-export crypto

**Files:**
- Create: `src/lib/server/plugins/claude/crypto.ts`

- [ ] **Step 1: Creează fișierul**

```ts
// src/lib/server/plugins/claude/crypto.ts
/**
 * Re-export din SmartBill (source-of-truth AES-256-GCM per-tenant), ca la Stripe.
 * Dacă SmartBill schimbă algoritmul, Claude rămâne aliniat automat.
 */
export { encrypt, decrypt, encryptVerified, DecryptionError } from '../smartbill/crypto';
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/server/plugins/claude/crypto.ts
git commit -m "feat(claude): re-export crypto din smartbill"
```

---

## Task 5: Tabel schema + migrare

**Files:**
- Modify: `src/lib/server/db/schema.ts` (adaugă lângă `stripeIntegration`)
- Create: `drizzle/NNNN_claude_integration.sql` (generată)

⚠️ dev DB = Turso PROD (memoria pentest). Migrarea e pur aditivă (tabel nou) — sigură.

- [ ] **Step 1: Adaugă tabelul în schema.ts** (imediat după blocul `stripeIntegration`)

```ts
/**
 * Per-tenant Claude (Anthropic) API credentials.
 *
 * Pattern aliniat cu `stripeIntegration`: cheia e criptată AES-256-GCM per-tenant
 * (`plugins/claude/crypto.ts`). Un rând per tenant. `keyType` distinge Anthropic
 * API key (`sk-ant-api…`, header x-api-key) de Claude Code OAuth token
 * (`sk-ant-oat…`, header Authorization: Bearer).
 */
export const claudeIntegration = sqliteTable(
	'claude_integration',
	{
		id: text('id').primaryKey(),
		tenantId: text('tenant_id')
			.notNull()
			.references(() => tenant.id)
			.unique(),
		apiKeyEncrypted: text('api_key_encrypted').notNull(),
		keyType: text('key_type').notNull(), // 'api' | 'oat'
		keyHint: text('key_hint').notNull(), // ultimele 4 caractere
		defaultModel: text('default_model').notNull().default('claude-sonnet-5'),
		isActive: boolean('is_active').notNull().default(true),
		lastTestedAt: timestamp('last_tested_at', { withTimezone: true, mode: 'date' }),
		lastError: text('last_error'),
		createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
			.notNull()
			.default(sql`current_timestamp`),
		updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
			.notNull()
			.default(sql`current_timestamp`)
	},
	(t) => [index('claude_integration_tenant_idx').on(t.tenantId)]
);
```

- [ ] **Step 2: Generează migrarea**

Run: `bun run db:gen`
Expected: un fișier nou `drizzle/NNNN_claude_integration.sql` + intrare nouă în `drizzle/meta/_journal.json`. `fix-migrations.ts` repară eventualul snapshot collision.

- [ ] **Step 3: Verifică migrarea generată**

Run: `ls -t drizzle/*.sql | head -1` apoi citește fișierul.
Expected: un SINGUR `CREATE TABLE ... claude_integration` + indexuri, aprox.:

```sql
CREATE TABLE `claude_integration` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`api_key_encrypted` text NOT NULL,
	`key_type` text NOT NULL,
	`key_hint` text NOT NULL,
	`default_model` text DEFAULT 'claude-sonnet-5' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`last_tested_at` timestamp,
	`last_error` text,
	`created_at` timestamp DEFAULT current_timestamp NOT NULL,
	`updated_at` timestamp DEFAULT current_timestamp NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenant`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE UNIQUE INDEX `claude_integration_tenant_id_unique` ON `claude_integration` (`tenant_id`);
CREATE INDEX `claude_integration_tenant_idx` ON `claude_integration` (`tenant_id`);
```

Dacă `db:gen` produce ALTE modificări (drift de la alte tabele) sau eșuează: NU continua — oprește și raportează (memoria drizzle-meta-drift). Nu edita snapshot-ul manual la ghici.

- [ ] **Step 4: Aplică migrarea**

Run: `bun run db:migrate`
Expected: migrarea `NNNN_claude_integration` aplicată, fără erori.

- [ ] **Step 5: Verifică pe Turso**

Run: `bun run db:studio` sau un `PRAGMA table_info(claude_integration)` prin scriptul uzual de verificare.
Expected: 11 coloane, `tenant_id` UNIQUE.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/db/schema.ts drizzle/
git commit -m "feat(claude): tabel claude_integration (per-tenant creds) + migrare"
```

---

## Task 6: Helper `getClaudeClient(tenantId)`

**Files:**
- Create: `src/lib/server/plugins/claude/index.ts`

Verifică plugin activ pentru tenant → citește rândul → decriptează (retry pe `DecryptionError`) → întoarce client. `null` dacă plugin dezactivat / creds lipsă / inactive.

- [ ] **Step 1: Implementează**

```ts
// src/lib/server/plugins/claude/index.ts
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { decrypt, DecryptionError } from './crypto';
import { createClaudeClient, type ClaudeClient } from './client';
import { getPluginRegistry } from '../registry';
import type { ClaudeKeyType } from './key-utils';

export type { ClaudeClient } from './client';

async function readRow(tenantId: string) {
	const [row] = await db
		.select()
		.from(table.claudeIntegration)
		.where(eq(table.claudeIntegration.tenantId, tenantId))
		.limit(1);
	return row ?? null;
}

/**
 * Întoarce un ClaudeClient pentru tenant, sau null dacă:
 *  - plugin-ul „claude" nu e activ pentru tenant, SAU
 *  - nu există rând de credențiale / e inactiv.
 * Decriptarea reîncearcă o dată cu citire proaspătă din DB (Turso transient reads).
 */
export async function getClaudeClient(tenantId: string): Promise<ClaudeClient | null> {
	const registry = getPluginRegistry();
	const active = await registry.isPluginActiveForTenant(tenantId, 'claude');
	if (!active) return null;

	let row = await readRow(tenantId);
	if (!row || !row.isActive) return null;

	let key: string;
	try {
		key = decrypt(tenantId, row.apiKeyEncrypted);
	} catch (e) {
		if (e instanceof DecryptionError) {
			row = await readRow(tenantId);
			if (!row || !row.isActive) return null;
			key = decrypt(tenantId, row.apiKeyEncrypted);
		} else {
			throw e;
		}
	}

	return createClaudeClient({
		apiKey: key,
		keyType: row.keyType as ClaudeKeyType,
		defaultModel: row.defaultModel
	});
}
```

- [ ] **Step 2: Verifică type-check** (tabelul e deja migrat din Task 5, deci `db.select().from(claudeIntegration)` e sigur)

Run: `NODE_OPTIONS=--max-old-space-size=8192 bun run check 2>&1 | grep -i claude`
Expected: nicio eroare legată de `claude`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/plugins/claude/index.ts
git commit -m "feat(claude): getClaudeClient(tenantId) cu gating pe plugin + retry decrypt"
```

---

## Task 7: Manifest plugin

**Files:**
- Create: `src/lib/server/plugins/claude/plugin.ts`

- [ ] **Step 1: Implementează** (oglindă după `stripe/plugin.ts`)

```ts
// src/lib/server/plugins/claude/plugin.ts
import type { Plugin, PluginConfig, HooksManager } from '../types';
import { logInfo } from '$lib/server/logger';

/**
 * Claude plugin manifest.
 *
 * Configurarea (cheia API) e per-tenant prin `claude_integration` table
 * (vezi `plugins/claude/index.ts` → getClaudeClient). Plugin-ul aici e doar
 * declaration pentru registry + lifecycle hooks.
 */
export class ClaudePlugin implements Plugin {
	id = 'claude';
	name = 'claude';
	version = '1.0.0';
	displayName = 'Claude';
	description =
		'Cheie Claude (Anthropic) per-tenant — API key (sk-ant-api…) sau Claude Code OAuth token (sk-ant-oat…), criptată. Folosită de funcțiile AI din CRM.';

	async initialize(_config: PluginConfig): Promise<void> {
		// No-op. Configurarea e per-tenant (vezi /[tenant]/settings/claude).
	}

	registerHooks(_hooks: HooksManager): void {
		// Fără hooks în acest pas (doar credențiale).
	}

	async onEnable(tenantId: string): Promise<void> {
		logInfo('plugin', 'Claude plugin enabled for tenant', { tenantId });
	}

	async onDisable(tenantId: string): Promise<void> {
		// Nu ștergem credențialele la disable — la re-enable rămân unde erau.
		logInfo('plugin', 'Claude plugin disabled for tenant', { tenantId });
	}
}

export const claudePlugin = new ClaudePlugin();
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/server/plugins/claude/plugin.ts
git commit -m "feat(claude): manifest plugin ClaudePlugin"
```

---

## Task 8: Înregistrare + seed în registry

**Files:**
- Modify: `src/lib/server/plugins/index.ts`

- [ ] **Step 1: Adaugă importul** (lângă celelalte importuri de plugin, după `import { stripePlugin } from './stripe/plugin';`)

```ts
import { claudePlugin } from './claude/plugin';
```

- [ ] **Step 2: Înregistrează în `initializePlugins()`** (după `registry.register(stripePlugin);`)

```ts
	// Register Claude plugin
	registry.register(claudePlugin);
```

- [ ] **Step 3: Apelează seed-ul** (după `await ensureStripePluginInDatabase();`)

```ts
	await ensureClaudePluginInDatabase();
```

- [ ] **Step 4: Adaugă funcția de seed** (lângă `ensureStripePluginInDatabase`, urmând exact același tipar)

```ts
/**
 * Ensure Claude plugin exists in database (credențiale per-tenant).
 */
async function ensureClaudePluginInDatabase(): Promise<void> {
	try {
		const [existing] = await db
			.select()
			.from(table.plugin)
			.where(eq(table.plugin.name, 'claude'))
			.limit(1);

		if (!existing) {
			const pluginId = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
			await db.insert(table.plugin).values({
				id: pluginId,
				name: 'claude',
				displayName: 'Claude',
				description:
					'Cheie Claude (Anthropic) per-tenant — API key sau Claude Code OAuth token, criptată. Folosită de funcțiile AI din CRM.',
				version: '1.0.0',
				isActive: true,
				config: {}
			});
			logInfo('plugin', 'Created Claude plugin in database');
		}
	} catch (error) {
		const { message, stack } = serializeError(error);
		logError('plugin', `Failed to ensure Claude plugin: ${message}`, { stackTrace: stack });
		// Don't throw - allow app to continue
	}
}
```

- [ ] **Step 5: Verifică type-check**

Run: `NODE_OPTIONS=--max-old-space-size=8192 bun run check 2>&1 | grep -iE "plugins/index|claude"`
Expected: nicio eroare nouă.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/plugins/index.ts
git commit -m "feat(claude): înregistrare + seed idempotent al plugin-ului Claude"
```

---

## Task 9: Remote functions

**Files:**
- Create: `src/lib/remotes/claude-integration.remote.ts`

Toate cu `requireStaff`. `saveClaudeIntegration` acceptă cheie goală la edit (păstrează cheia, actualizează doar modelul).

- [ ] **Step 1: Implementează**

```ts
// src/lib/remotes/claude-integration.remote.ts
import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { requireStaff } from '$lib/server/get-actor';
import { encryptVerified } from '$lib/server/plugins/claude/crypto';
import { detectKeyType, keyHint, isValidClaudeKey } from '$lib/server/plugins/claude/key-utils';
import { getClaudeClient } from '$lib/server/plugins/claude';
import { isKnownClaudeModel } from '$lib/claude-models';
import { logInfo, serializeError } from '$lib/server/logger';

function scope() {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	return { event, tenantId: event.locals.tenant.id };
}

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

/** Status integrare pentru tenantul curent. NU întoarce niciodată cheia. */
export const getClaudeIntegration = query(async () => {
	const { event, tenantId } = scope();
	await requireStaff(event);

	const [row] = await db
		.select({
			keyType: table.claudeIntegration.keyType,
			keyHint: table.claudeIntegration.keyHint,
			defaultModel: table.claudeIntegration.defaultModel,
			isActive: table.claudeIntegration.isActive,
			lastTestedAt: table.claudeIntegration.lastTestedAt,
			lastError: table.claudeIntegration.lastError
		})
		.from(table.claudeIntegration)
		.where(eq(table.claudeIntegration.tenantId, tenantId))
		.limit(1);

	if (!row) return null;
	return { connected: true, ...row };
});

const SaveSchema = v.object({
	// gol = păstrează cheia existentă (edit doar model); altfel trebuie sk-ant-…
	apiKey: v.optional(v.string(), ''),
	defaultModel: v.string()
});

export const saveClaudeIntegration = command(SaveSchema, async (data) => {
	const { event, tenantId } = scope();
	await requireStaff(event);

	const model = data.defaultModel;
	if (!isKnownClaudeModel(model)) throw new Error('Model Claude necunoscut.');

	const rawKey = (data.apiKey ?? '').trim();
	const [existing] = await db
		.select({ id: table.claudeIntegration.id })
		.from(table.claudeIntegration)
		.where(eq(table.claudeIntegration.tenantId, tenantId))
		.limit(1);

	// Edit fără cheie nouă → actualizează doar modelul.
	if (!rawKey) {
		if (!existing) throw new Error('Introdu o cheie Claude (sk-ant-…).');
		await db
			.update(table.claudeIntegration)
			.set({ defaultModel: model, updatedAt: new Date() })
			.where(eq(table.claudeIntegration.tenantId, tenantId));
		return { connected: true };
	}

	if (!isValidClaudeKey(rawKey)) {
		throw new Error('Cheia trebuie să înceapă cu sk-ant- și să fie validă.');
	}

	const keyType = detectKeyType(rawKey);
	const hint = keyHint(rawKey);
	const apiKeyEncrypted = encryptVerified(tenantId, rawKey);

	if (existing) {
		await db
			.update(table.claudeIntegration)
			.set({
				apiKeyEncrypted,
				keyType,
				keyHint: hint,
				defaultModel: model,
				isActive: true,
				lastError: null,
				updatedAt: new Date()
			})
			.where(eq(table.claudeIntegration.tenantId, tenantId));
	} else {
		await db.insert(table.claudeIntegration).values({
			id: generateId(),
			tenantId,
			apiKeyEncrypted,
			keyType,
			keyHint: hint,
			defaultModel: model,
			isActive: true
		});
	}

	logInfo('plugin', 'Claude integration saved', { tenantId });
	return { connected: true };
});

export const testClaudeConnection = command(async () => {
	const { event, tenantId } = scope();
	await requireStaff(event);

	const client = await getClaudeClient(tenantId);
	if (!client) {
		throw new Error('Nicio cheie Claude configurată sau plugin dezactivat.');
	}

	try {
		const result = await client.testConnection();
		await db
			.update(table.claudeIntegration)
			.set({ lastTestedAt: new Date(), lastError: null, updatedAt: new Date() })
			.where(eq(table.claudeIntegration.tenantId, tenantId));
		return { ok: true as const, via: result.via, models: result.models };
	} catch (e) {
		const { message } = serializeError(e);
		await db
			.update(table.claudeIntegration)
			.set({ lastError: message, lastTestedAt: new Date(), updatedAt: new Date() })
			.where(eq(table.claudeIntegration.tenantId, tenantId));
		throw new Error(message);
	}
});

export const deleteClaudeIntegration = command(async () => {
	const { event, tenantId } = scope();
	await requireStaff(event);

	await db
		.delete(table.claudeIntegration)
		.where(eq(table.claudeIntegration.tenantId, tenantId));
	logInfo('plugin', 'Claude integration deleted', { tenantId });
	return { connected: false };
});
```

- [ ] **Step 2: Verifică type-check**

Run: `NODE_OPTIONS=--max-old-space-size=8192 bun run check 2>&1 | grep -iE "claude-integration"`
Expected: nicio eroare.

- [ ] **Step 3: Commit**

```bash
git add src/lib/remotes/claude-integration.remote.ts
git commit -m "feat(claude): remote functions (status/save/test/delete, requireStaff)"
```

---

## Task 10: Pagina de configurare

**Files:**
- Create: `src/routes/[tenant]/settings/claude/+page.svelte`

Pattern `.current` + `.updates()` (memoria remote-functions-pattern). Fără padding exterior (layout dă `p-6`).

- [ ] **Step 1: Implementează**

```svelte
<!-- src/routes/[tenant]/settings/claude/+page.svelte -->
<script lang="ts">
	import {
		getClaudeIntegration,
		saveClaudeIntegration,
		testClaudeConnection,
		deleteClaudeIntegration
	} from '$lib/remotes/claude-integration.remote';
	import { CLAUDE_MODELS, DEFAULT_CLAUDE_MODEL } from '$lib/claude-models';
	import { toast } from 'svelte-sonner';
	import KeyIcon from '@lucide/svelte/icons/key';
	import CheckCircleIcon from '@lucide/svelte/icons/check-circle';
	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
	import RefreshIcon from '@lucide/svelte/icons/refresh-cw';
	import TrashIcon from '@lucide/svelte/icons/trash-2';

	const integrationQuery = getClaudeIntegration();
	const current = $derived(integrationQuery.current ?? null);

	let apiKey = $state('');
	let defaultModel = $state<string>(DEFAULT_CLAUDE_MODEL);
	let modelInitialized = $state(false);
	let saving = $state(false);
	let testing = $state(false);

	// Pre-umple dropdown-ul cu modelul salvat, o singură dată.
	$effect(() => {
		if (current && !modelInitialized) {
			defaultModel = current.defaultModel ?? DEFAULT_CLAUDE_MODEL;
			modelInitialized = true;
		}
	});

	async function save() {
		saving = true;
		try {
			await saveClaudeIntegration({ apiKey: apiKey.trim(), defaultModel }).updates(integrationQuery);
			toast.success('Cheia Claude a fost salvată.');
			apiKey = '';
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la salvare');
		} finally {
			saving = false;
		}
	}

	async function runTest() {
		testing = true;
		try {
			const r = await testClaudeConnection().updates(integrationQuery);
			toast.success(
				r.via === 'models'
					? `OK — cheie validă (${r.models.length} modele disponibile).`
					: 'OK — cheie validă.'
			);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Test eșuat');
		} finally {
			testing = false;
		}
	}

	async function remove() {
		if (!confirm('Sigur ștergi cheia Claude a acestui tenant?')) return;
		try {
			await deleteClaudeIntegration().updates(integrationQuery);
			toast.success('Cheia Claude a fost ștearsă.');
			apiKey = '';
			defaultModel = DEFAULT_CLAUDE_MODEL;
			modelInitialized = false;
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		}
	}
</script>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-bold">Claude</h1>
		<p class="text-slate-500">
			Conectează cheia ta Claude (Anthropic). Suportă atât API key (sk-ant-api…) cât și Claude
			Code OAuth token (sk-ant-oat…). Cheia e criptată și nu părăsește serverul.
		</p>
	</div>

	{#if current?.connected}
		<div class="rounded-xl border bg-white p-6 dark:bg-slate-800">
			<div class="flex items-center gap-2">
				<CheckCircleIcon class="h-5 w-5 text-green-600" />
				<span class="font-medium">Conectat</span>
				<span class="text-sm text-slate-500">
					cheie {current.keyType === 'oat' ? 'OAuth' : 'API'} …{current.keyHint}
				</span>
			</div>
			{#if current.lastError}
				<div
					class="mt-3 flex items-start gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-200"
				>
					<AlertCircleIcon class="mt-0.5 h-4 w-4 shrink-0" />
					<span>{current.lastError}</span>
				</div>
			{/if}
			{#if current.lastTestedAt}
				<p class="mt-2 text-xs text-slate-500">
					Ultimul test: {new Date(current.lastTestedAt).toLocaleString('ro-RO')}
				</p>
			{/if}
		</div>
	{/if}

	<div class="rounded-xl border bg-white p-6 dark:bg-slate-800">
		<div class="space-y-4">
			<div class="space-y-1.5">
				<label for="claude-key" class="text-sm font-medium">Cheie Claude</label>
				<input
					id="claude-key"
					type="password"
					bind:value={apiKey}
					placeholder={current?.connected ? 'Lasă gol ca să păstrezi cheia actuală' : 'sk-ant-…'}
					autocomplete="off"
					class="w-full rounded-md border px-3 py-2 text-sm dark:bg-slate-900"
				/>
			</div>
			<div class="space-y-1.5">
				<label for="claude-model" class="text-sm font-medium">Model implicit</label>
				<select
					id="claude-model"
					bind:value={defaultModel}
					class="w-full rounded-md border px-3 py-2 text-sm dark:bg-slate-900"
				>
					{#each CLAUDE_MODELS as m (m.id)}
						<option value={m.id}>{m.label}</option>
					{/each}
				</select>
			</div>
			<div class="flex flex-wrap gap-2">
				<button
					onclick={save}
					disabled={saving}
					class="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-slate-900"
				>
					<KeyIcon class="h-4 w-4" />
					{saving ? 'Se salvează…' : 'Salvează'}
				</button>
				{#if current?.connected}
					<button
						onclick={runTest}
						disabled={testing}
						class="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50"
					>
						<RefreshIcon class="h-4 w-4 {testing ? 'animate-spin' : ''}" />
						{testing ? 'Se testează…' : 'Test conexiune'}
					</button>
					<button
						onclick={remove}
						class="inline-flex items-center gap-2 rounded-md border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-900/40"
					>
						<TrashIcon class="h-4 w-4" />
						Șterge
					</button>
				{/if}
			</div>
		</div>
	</div>
</div>
```

- [ ] **Step 2: Rulează Svelte autofixer** (memoria svelte-mcp-check)

Folosește MCP-ul Svelte (`mcp__svelte__svelte-autofixer`) sau agentul `svelte:svelte-file-editor` pe `src/routes/[tenant]/settings/claude/+page.svelte`. Aplică toate fix-urile propuse, apoi rulează autofixer-ul din nou până e curat.

- [ ] **Step 3: Verifică type-check**

Run: `NODE_OPTIONS=--max-old-space-size=8192 bun run check 2>&1 | grep -iE "settings/claude"`
Expected: nicio eroare.

- [ ] **Step 4: Commit**

```bash
git add src/routes/\[tenant\]/settings/claude/+page.svelte
git commit -m "feat(claude): pagină de configurare (cheie + model + test + delete)"
```

---

## Task 11: Bloc în pagina plugins

**Files:**
- Modify: `src/routes/[tenant]/settings/plugins/+page.svelte`

- [ ] **Step 1: Adaugă blocul** imediat după blocul `{#if plugin.name === 'stripe'}...{/if}` și înainte de `</Card>` (aprox. linia 233)

```svelte
					{#if plugin.name === 'claude'}
						<CardContent>
							<Separator class="mb-4" />
							<div class="space-y-2">
								<p class="text-sm font-medium">Claude (Anthropic)</p>
								<p class="text-sm text-muted-foreground">
									Salvează cheia ta Claude (API key sau Claude Code OAuth token) per-tenant,
									criptată. Folosită de funcțiile AI din CRM.
								</p>
								{#if isEnabled}
									<Button variant="outline" size="sm" href="/{tenantSlug}/settings/claude">
										Configurează Claude
									</Button>
								{/if}
							</div>
						</CardContent>
					{/if}
```

- [ ] **Step 2: Rulează Svelte autofixer** pe `src/routes/[tenant]/settings/plugins/+page.svelte` (fișier modificat).

- [ ] **Step 3: Verifică type-check**

Run: `NODE_OPTIONS=--max-old-space-size=8192 bun run check 2>&1 | grep -iE "settings/plugins"`
Expected: nicio eroare.

- [ ] **Step 4: Commit**

```bash
git add src/routes/\[tenant\]/settings/plugins/+page.svelte
git commit -m "feat(claude): card Claude în pagina de plugins cu buton Configurează"
```

---

## Task 12: Verificare finală

- [ ] **Step 1: Toate testele unitare**

Run: `bun test src/lib/server/plugins/claude/`
Expected: PASS (key-utils 4 + client 5).

- [ ] **Step 2: Type-check complet fără regresii**

Run: `NODE_OPTIONS=--max-old-space-size=8192 bun run check`
Expected: fără erori NOI față de baseline (memoria: baseline 16 err/56 warn). Nicio eroare care menționează `claude`.

- [ ] **Step 3: Smoke test manual** (dev server rulează de pe `main` — memoria local-preview-needs-main; dacă lucrezi în worktree, merge întâi în main)

1. `/ots/settings/plugins` → apare cardul „Claude"; activează-l (toggle) → apare butonul „Configurează Claude".
2. Click „Configurează Claude" → `/ots/settings/claude`.
3. Introdu o cheie `sk-ant-api…` validă + alege un model → „Salvează" → toast succes; cardul „Conectat …xxxx" apare.
4. „Test conexiune" → toast „OK — cheie validă (N modele…)"; `lastTestedAt` se actualizează.
5. Introdu o cheie invalidă (`sk-ant-api-BAD`) → „Salvează" merge (validare prefix), „Test conexiune" → toast cu eroare 401; bannerul amber `lastError` apare.
6. „Șterge" → confirmă → cardul „Conectat" dispare.
7. Dezactivează plugin-ul din `/settings/plugins` → butonul „Configurează" dispare; `getClaudeClient` întoarce `null` (verifică că un test de conexiune, dacă e reintrodus, e blocat).

- [ ] **Step 4: Verifică izolarea per-tenant** — confirmă că `getClaudeIntegration` întoarce doar rândul tenantului curent (query scopat pe `tenantId`) și că răspunsul nu conține niciodată `apiKeyEncrypted`/cheia.

---

## Self-Review (verificat la scriere)

**Acoperire spec:** stocare criptată (T5/T9), ambele tipuri de cheie cu header după prefix (T2/T3), model implicit (T1/T9/T10), Test conexiune fără consum pe `api` + fallback `oat` (T3/T9), helper `getClaudeClient` cu gating pe plugin (T6), plugin în `/settings/plugins` + pagină dedicată (T7/T8/T10/T11), `requireStaff` + scop tenant (T9), migrare hand-safe (T5), fără card în index Settings (respectat). ✓

**Type consistency:** `ClaudeKeyType` ('api'|'oat') consistent în key-utils/client/index; `createClaudeClient`/`getClaudeClient`/`testConnection` cu aceleași semnături peste taskuri; `CLAUDE_MODELS`/`CLAUDE_MODEL_IDS`/`DEFAULT_CLAUDE_MODEL`/`isKnownClaudeModel` folosite consistent; numele remote-urilor identice între T9 și T10. ✓

**Fără placeholdere:** cod complet în fiecare pas. ✓
