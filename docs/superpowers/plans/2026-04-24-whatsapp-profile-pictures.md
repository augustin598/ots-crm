# WhatsApp Profile Pictures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fetch WhatsApp profile pictures via Baileys and display them in the WA UI; propagate automatically to matching CRM clients so their avatar appears across the CRM.

**Architecture:** In-memory per-tenant FIFO queue with a global 1-req/s ceiling fetches via `sock.profilePictureUrl('preview')`, validates magic bytes, mirrors to MinIO at a stable tenant-scoped path, updates `whatsapp_contact`, and propagates to `client.avatarPath` when phone matches (reusing the normalized-phone logic from the recent bugfix). A `contacts.update` event triggers the same pipeline. Images are served through a SvelteKit proxy endpoint (not presigned redirect) so browser caching is stable.

**Tech Stack:** SvelteKit 5 + Bun + TypeScript + Drizzle ORM + Turso (libSQL) + MinIO + Baileys v7.0.0-rc.9.

**Spec:** `docs/superpowers/specs/2026-04-24-whatsapp-profile-pictures-design.md`

---

## File structure

**Create:**
- `app/drizzle/0182_whatsapp_contact_avatar_path.sql` through `0187_client_avatar_source.sql` (6 migration files)
- `app/src/lib/server/whatsapp/avatar-fetcher.ts` — queue, worker, magic-byte validation
- `app/src/lib/server/whatsapp/avatar-fetcher.test.ts` — unit tests
- `app/src/lib/components/ui/contact-avatar.svelte` — avatar component with initials fallback
- `app/src/routes/[tenant]/api/whatsapp/avatar/[phoneE164]/+server.ts` — WA avatar stream
- `app/src/routes/[tenant]/api/clients/[clientId]/avatar/+server.ts` — client avatar stream

**Modify:**
- `app/src/lib/server/db/schema.ts` — add columns to `whatsappContact` and `client`
- `app/src/lib/server/whatsapp/session-manager.ts` — register `contacts.update` handler, wire queue cleanup
- `app/src/lib/remotes/whatsapp.remote.ts` — surface `avatarPath` in conversation list + thread, enqueue lazy fetches
- `app/src/routes/[tenant]/whatsapp/+page.svelte` — render avatars

---

## Task 1: DB schema + migrations

**Files:**
- Modify: `app/src/lib/server/db/schema.ts` around the `whatsappContact` and `client` declarations
- Create: `app/drizzle/0182_*.sql` through `0187_*.sql`
- Update: `app/drizzle/meta/_journal.json`

- [ ] **Step 1: Extend `whatsappContact` with 4 avatar columns**

In `app/src/lib/server/db/schema.ts`, locate the `whatsappContact` table (around line 3535) and add, **before the `createdAt` line**:

```ts
	avatarPath: text('avatar_path'),
	avatarMimeType: text('avatar_mime_type'),
	avatarFetchedAt: timestamp('avatar_fetched_at', { withTimezone: true, mode: 'date' }),
	avatarHidden: boolean('avatar_hidden').notNull().default(false),
```

- [ ] **Step 2: Extend `client` with 2 avatar columns**

Locate the `client` table (around line 104). Add **before the `createdAt` line**:

```ts
	avatarPath: text('avatar_path'),
	avatarSource: text('avatar_source').notNull().default('whatsapp'),
```

- [ ] **Step 3: Generate migrations and ensure one statement per file**

```bash
cd app
bun db:gen
```

Expected: drizzle generates one or more `0XXX_*.sql` files containing multiple `ALTER TABLE` statements. The `fix-migrations.ts` script splits them into one statement per file. Verify that the journal at `app/drizzle/meta/_journal.json` contains exactly 6 new entries matching the 6 new SQL files.

If any file still contains more than one statement, split it manually into separate files numbered sequentially, and update `_journal.json` to match. Reference memory rule: "Turso single statement — One SQL statement per migration file".

- [ ] **Step 4: Apply migrations to the remote DB**

```bash
cd app
bun db:migrate
```

Expected: no errors.

- [ ] **Step 5: Verify columns exist on Turso**

Run a quick check using the admin migration status endpoint or Turso CLI:

```bash
turso db shell <db-name> "PRAGMA table_info(whatsapp_contact);" | grep avatar
turso db shell <db-name> "PRAGMA table_info(client);" | grep avatar
```

Expected output contains `avatar_path`, `avatar_mime_type`, `avatar_fetched_at`, `avatar_hidden` for `whatsapp_contact`, and `avatar_path`, `avatar_source` for `client`. Per memory rule: "Migration flow — verify on Turso after db:migrate".

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/server/db/schema.ts app/drizzle
git commit -m "feat(schema): avatar columns on whatsapp_contact and client"
```

---

## Task 2: Magic-byte validation helper

**Files:**
- Create: `app/src/lib/server/whatsapp/image-validation.ts`
- Create: `app/src/lib/server/whatsapp/image-validation.test.ts`

- [ ] **Step 1: Write failing test**

Create `app/src/lib/server/whatsapp/image-validation.test.ts`:

```ts
import { describe, it, expect } from 'bun:test';
import { detectImageMime } from './image-validation';

describe('detectImageMime', () => {
	it('detects JPEG', () => {
		const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
		expect(detectImageMime(buf)).toBe('image/jpeg');
	});

	it('detects PNG', () => {
		const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		expect(detectImageMime(buf)).toBe('image/png');
	});

	it('detects WebP', () => {
		const buf = Buffer.concat([
			Buffer.from('RIFF'),
			Buffer.from([0x00, 0x00, 0x00, 0x00]),
			Buffer.from('WEBP')
		]);
		expect(detectImageMime(buf)).toBe('image/webp');
	});

	it('returns null for unknown/text content', () => {
		const html = Buffer.from('<html><body>error</body></html>');
		expect(detectImageMime(html)).toBe(null);
	});

	it('returns null for buffer shorter than 12 bytes', () => {
		expect(detectImageMime(Buffer.from([0xff, 0xd8]))).toBe(null);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd app
bun test src/lib/server/whatsapp/image-validation.test.ts
```

Expected: FAIL with "Cannot find module './image-validation'".

- [ ] **Step 3: Implement the helper**

Create `app/src/lib/server/whatsapp/image-validation.ts`:

```ts
export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

export function detectImageMime(buf: Buffer): ImageMime | null {
	if (buf.length < 12) return null;
	// JPEG: FF D8 FF
	if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
	// PNG: 89 50 4E 47 0D 0A 1A 0A
	if (
		buf[0] === 0x89 &&
		buf[1] === 0x50 &&
		buf[2] === 0x4e &&
		buf[3] === 0x47 &&
		buf[4] === 0x0d &&
		buf[5] === 0x0a &&
		buf[6] === 0x1a &&
		buf[7] === 0x0a
	) {
		return 'image/png';
	}
	// WebP: "RIFF" ... "WEBP"
	if (
		buf.toString('ascii', 0, 4) === 'RIFF' &&
		buf.toString('ascii', 8, 12) === 'WEBP'
	) {
		return 'image/webp';
	}
	return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd app
bun test src/lib/server/whatsapp/image-validation.test.ts
```

Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/server/whatsapp/image-validation.ts app/src/lib/server/whatsapp/image-validation.test.ts
git commit -m "feat(whatsapp): image magic-byte detection helper"
```

---

## Task 3: Avatar fetcher — queue primitives (dedup + pacing)

**Files:**
- Create: `app/src/lib/server/whatsapp/avatar-fetcher.ts` (skeleton)
- Create: `app/src/lib/server/whatsapp/avatar-fetcher.test.ts`

- [ ] **Step 1: Write failing test for dedup**

Create `app/src/lib/server/whatsapp/avatar-fetcher.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'bun:test';
import {
	_resetAvatarFetcherForTests,
	_inspectQueueForTests,
	enqueueFetch
} from './avatar-fetcher';

describe('avatar-fetcher queue', () => {
	beforeEach(() => _resetAvatarFetcherForTests());

	it('dedups same phone within a tenant', () => {
		enqueueFetch('tenant-a', '+40111', { skipWorker: true });
		enqueueFetch('tenant-a', '+40111', { skipWorker: true });
		enqueueFetch('tenant-a', '+40222', { skipWorker: true });
		const q = _inspectQueueForTests('tenant-a');
		expect(q.pending).toEqual(['+40111', '+40222']);
	});

	it('does not dedup across tenants', () => {
		enqueueFetch('tenant-a', '+40111', { skipWorker: true });
		enqueueFetch('tenant-b', '+40111', { skipWorker: true });
		expect(_inspectQueueForTests('tenant-a').pending).toEqual(['+40111']);
		expect(_inspectQueueForTests('tenant-b').pending).toEqual(['+40111']);
	});

	it('dedups against in-flight set', () => {
		enqueueFetch('tenant-a', '+40111', { skipWorker: true });
		const q = _inspectQueueForTests('tenant-a');
		// simulate worker pulling the job: move from pending to inFlight
		q.pending.shift();
		q.inFlight.add('+40111');

		enqueueFetch('tenant-a', '+40111', { skipWorker: true });
		expect(q.pending).toEqual([]);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd app
bun test src/lib/server/whatsapp/avatar-fetcher.test.ts
```

Expected: FAIL with "Cannot find module './avatar-fetcher'".

- [ ] **Step 3: Implement the queue primitives**

Create `app/src/lib/server/whatsapp/avatar-fetcher.ts`:

```ts
type TenantQueue = {
	pending: string[]; // phoneE164 in FIFO order
	inFlight: Set<string>;
	workerRunning: boolean;
};

const SYMBOL = Symbol.for('ots_crm_whatsapp_avatar_queues');
const GT = globalThis as unknown as Record<symbol, unknown>;
const queues: Map<string, TenantQueue> =
	(GT[SYMBOL] as Map<string, TenantQueue>) ??
	(GT[SYMBOL] = new Map<string, TenantQueue>());

function getQueue(tenantId: string): TenantQueue {
	let q = queues.get(tenantId);
	if (!q) {
		q = { pending: [], inFlight: new Set(), workerRunning: false };
		queues.set(tenantId, q);
	}
	return q;
}

export interface EnqueueOptions {
	/** For tests — skip spinning up the worker loop. */
	skipWorker?: boolean;
}

export function enqueueFetch(
	tenantId: string,
	phoneE164: string,
	opts: EnqueueOptions = {}
): void {
	const q = getQueue(tenantId);
	if (q.inFlight.has(phoneE164)) return;
	if (q.pending.includes(phoneE164)) return;
	q.pending.push(phoneE164);
	if (!opts.skipWorker) void ensureWorkerRunning(tenantId);
}

export function dropTenant(tenantId: string): void {
	const q = queues.get(tenantId);
	if (!q) return;
	q.pending.length = 0;
	q.inFlight.clear();
	// worker loop sees empty queue next tick and exits
}

async function ensureWorkerRunning(_tenantId: string): Promise<void> {
	// Implemented in Task 4 — this stub keeps the type signature stable.
}

// Test helpers (not exported from index)
export function _resetAvatarFetcherForTests(): void {
	queues.clear();
}

export function _inspectQueueForTests(tenantId: string): TenantQueue {
	return getQueue(tenantId);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd app
bun test src/lib/server/whatsapp/avatar-fetcher.test.ts
```

Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/server/whatsapp/avatar-fetcher.ts app/src/lib/server/whatsapp/avatar-fetcher.test.ts
git commit -m "feat(whatsapp): avatar fetcher queue with dedup"
```

---

## Task 4: Global rate limiter (token bucket)

**Files:**
- Modify: `app/src/lib/server/whatsapp/avatar-fetcher.ts` — add token bucket

- [ ] **Step 1: Add global rate-limit test**

Append to `app/src/lib/server/whatsapp/avatar-fetcher.test.ts`:

```ts
import { _acquireGlobalTokenForTests, _setGlobalRateForTests } from './avatar-fetcher';

describe('global rate limiter', () => {
	beforeEach(() => _resetAvatarFetcherForTests());

	it('releases a token immediately when bucket is full', async () => {
		_setGlobalRateForTests({ intervalMs: 1000, initialTokens: 1 });
		const start = Date.now();
		await _acquireGlobalTokenForTests();
		expect(Date.now() - start).toBeLessThan(50);
	});

	it('delays a second acquire until the refill', async () => {
		_setGlobalRateForTests({ intervalMs: 100, initialTokens: 1 });
		await _acquireGlobalTokenForTests();
		const start = Date.now();
		await _acquireGlobalTokenForTests();
		expect(Date.now() - start).toBeGreaterThanOrEqual(80); // allow small timer jitter
	});
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd app
bun test src/lib/server/whatsapp/avatar-fetcher.test.ts
```

Expected: FAIL — helpers not exported.

- [ ] **Step 3: Implement token bucket**

Add to `app/src/lib/server/whatsapp/avatar-fetcher.ts`, just below `getQueue`:

```ts
type RateState = { tokens: number; intervalMs: number; lastRefillAt: number };

const GLOBAL_RATE: RateState = {
	tokens: 1,
	intervalMs: 1000, // 1 req/s across all tenants
	lastRefillAt: Date.now()
};

async function acquireGlobalToken(): Promise<void> {
	// Refill up to 1 token
	const now = Date.now();
	const elapsed = now - GLOBAL_RATE.lastRefillAt;
	if (elapsed >= GLOBAL_RATE.intervalMs) {
		GLOBAL_RATE.tokens = 1;
		GLOBAL_RATE.lastRefillAt = now;
	}
	if (GLOBAL_RATE.tokens > 0) {
		GLOBAL_RATE.tokens -= 1;
		return;
	}
	const wait = GLOBAL_RATE.intervalMs - elapsed;
	await new Promise((resolve) => setTimeout(resolve, wait));
	GLOBAL_RATE.tokens = 0;
	GLOBAL_RATE.lastRefillAt = Date.now();
}

// Test helpers
export async function _acquireGlobalTokenForTests(): Promise<void> {
	await acquireGlobalToken();
}

export function _setGlobalRateForTests(opts: { intervalMs: number; initialTokens: number }): void {
	GLOBAL_RATE.tokens = opts.initialTokens;
	GLOBAL_RATE.intervalMs = opts.intervalMs;
	GLOBAL_RATE.lastRefillAt = Date.now();
}
```

- [ ] **Step 4: Also reset the rate state in `_resetAvatarFetcherForTests`**

Replace the existing `_resetAvatarFetcherForTests` with:

```ts
export function _resetAvatarFetcherForTests(): void {
	queues.clear();
	GLOBAL_RATE.tokens = 1;
	GLOBAL_RATE.intervalMs = 1000;
	GLOBAL_RATE.lastRefillAt = Date.now();
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd app
bun test src/lib/server/whatsapp/avatar-fetcher.test.ts
```

Expected: 5 passing.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/server/whatsapp/avatar-fetcher.ts app/src/lib/server/whatsapp/avatar-fetcher.test.ts
git commit -m "feat(whatsapp): global token bucket for avatar fetches"
```

---

## Task 5: Worker loop + fetch pipeline

**Files:**
- Modify: `app/src/lib/server/whatsapp/avatar-fetcher.ts` — implement `ensureWorkerRunning` and `fetchAndStoreAvatar`

- [ ] **Step 1: Implement worker and pipeline**

Replace the `ensureWorkerRunning` stub in `app/src/lib/server/whatsapp/avatar-fetcher.ts` with a full implementation. Add imports at the top:

```ts
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { getActiveSession } from './session-manager';
import { e164ToJid, phoneE164Variants, tryToE164 } from './phone';
import { putStable, removeIfExists } from './minio-helpers';
import { detectImageMime, type ImageMime } from './image-validation';
import { logError, logWarning, logInfo } from '$lib/server/logger';
```

Add these constants and functions after the rate-limit section:

```ts
const TENANT_PACING_MS = 3000;
const FETCH_TIMEOUT_MS = 10_000;
const PROFILE_URL_TIMEOUT_MS = 8_000;

function avatarKey(tenantId: string, phoneE164: string): string {
	return `${tenantId}/whatsapp/avatars/${phoneE164}.jpg`;
}

async function ensureWorkerRunning(tenantId: string): Promise<void> {
	const q = getQueue(tenantId);
	if (q.workerRunning) return;
	q.workerRunning = true;
	try {
		while (q.pending.length > 0) {
			const phone = q.pending.shift();
			if (!phone) break;
			q.inFlight.add(phone);
			try {
				await acquireGlobalToken();
				await fetchAndStoreAvatar(tenantId, phone);
			} catch (err) {
				logError('whatsapp', 'avatar fetch failed', {
					tenantId,
					metadata: { phone, err: err instanceof Error ? err.message : String(err) }
				});
			} finally {
				q.inFlight.delete(phone);
			}
			if (q.pending.length > 0) {
				await new Promise((r) => setTimeout(r, TENANT_PACING_MS));
			}
		}
	} finally {
		q.workerRunning = false;
	}
}

async function fetchAndStoreAvatar(tenantId: string, phoneE164: string): Promise<void> {
	const session = getActiveSession(tenantId);
	if (!session) return; // no socket, drop

	const jid = e164ToJid(phoneE164);
	let url: string | undefined;
	try {
		url = await session.sock.profilePictureUrl(jid, 'preview', PROFILE_URL_TIMEOUT_MS);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		const isRateLimit = /429|rate|too many/i.test(message);
		if (isRateLimit) {
			// Single retry with 30s delay — re-enqueue and return without marking hidden
			setTimeout(() => {
				enqueueFetch(tenantId, phoneE164);
			}, 30_000);
			return;
		}
		// 404, privacy block, or other — treat as hidden
		await markHidden(tenantId, phoneE164);
		return;
	}

	if (!url) {
		await markHidden(tenantId, phoneE164);
		return;
	}

	let buf: Buffer;
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
		if (!res.ok) {
			await markHidden(tenantId, phoneE164);
			return;
		}
		buf = Buffer.from(await res.arrayBuffer());
	} catch (err) {
		logWarning('whatsapp', 'avatar download failed', {
			tenantId,
			metadata: { phone: phoneE164, err: err instanceof Error ? err.message : String(err) }
		});
		await touchFetchedAt(tenantId, phoneE164);
		return;
	}

	const mime: ImageMime | null = detectImageMime(buf);
	if (!mime) {
		logWarning('whatsapp', 'avatar payload failed magic-byte check', {
			tenantId,
			metadata: { phone: phoneE164, bytes: buf.length }
		});
		await touchFetchedAt(tenantId, phoneE164);
		return;
	}

	const key = avatarKey(tenantId, phoneE164);
	await putStable(key, buf, mime);
	await upsertContactAvatar(tenantId, phoneE164, key, mime);
	await propagateToClient(tenantId, phoneE164, key);
}

async function markHidden(tenantId: string, phoneE164: string): Promise<void> {
	const now = new Date();
	const [existing] = await db
		.select({ id: table.whatsappContact.id, avatarPath: table.whatsappContact.avatarPath })
		.from(table.whatsappContact)
		.where(
			and(
				eq(table.whatsappContact.tenantId, tenantId),
				eq(table.whatsappContact.phoneE164, phoneE164)
			)
		)
		.limit(1);

	if (existing?.avatarPath) {
		await removeIfExists(existing.avatarPath);
	}

	if (existing) {
		await db
			.update(table.whatsappContact)
			.set({ avatarPath: null, avatarMimeType: null, avatarHidden: true, avatarFetchedAt: now, updatedAt: now })
			.where(eq(table.whatsappContact.id, existing.id));
	} else {
		// Insert minimal contact row if missing
		await db.insert(table.whatsappContact).values({
			id: crypto.randomUUID().replace(/-/g, ''),
			tenantId,
			phoneE164,
			avatarHidden: true,
			avatarFetchedAt: now,
			createdAt: now,
			updatedAt: now
		}).onConflictDoNothing();
	}

	// Clear client.avatarPath if it points at this (now removed) path and source is whatsapp
	await clearClientAvatarIfWhatsappSourced(tenantId, phoneE164);
}

async function touchFetchedAt(tenantId: string, phoneE164: string): Promise<void> {
	const now = new Date();
	await db
		.update(table.whatsappContact)
		.set({ avatarFetchedAt: now, updatedAt: now })
		.where(
			and(
				eq(table.whatsappContact.tenantId, tenantId),
				eq(table.whatsappContact.phoneE164, phoneE164)
			)
		);
}

async function upsertContactAvatar(
	tenantId: string,
	phoneE164: string,
	key: string,
	mime: ImageMime
): Promise<void> {
	const now = new Date();
	const [existing] = await db
		.select({ id: table.whatsappContact.id })
		.from(table.whatsappContact)
		.where(
			and(
				eq(table.whatsappContact.tenantId, tenantId),
				eq(table.whatsappContact.phoneE164, phoneE164)
			)
		)
		.limit(1);

	if (existing) {
		await db
			.update(table.whatsappContact)
			.set({ avatarPath: key, avatarMimeType: mime, avatarHidden: false, avatarFetchedAt: now, updatedAt: now })
			.where(eq(table.whatsappContact.id, existing.id));
	} else {
		await db.insert(table.whatsappContact).values({
			id: crypto.randomUUID().replace(/-/g, ''),
			tenantId,
			phoneE164,
			avatarPath: key,
			avatarMimeType: mime,
			avatarHidden: false,
			avatarFetchedAt: now,
			createdAt: now,
			updatedAt: now
		}).onConflictDoNothing();
	}
	logInfo('whatsapp', 'avatar stored', { tenantId, metadata: { phone: phoneE164, key } });
}

async function propagateToClient(
	tenantId: string,
	phoneE164: string,
	key: string
): Promise<void> {
	const variants = phoneE164Variants(phoneE164);
	const [fast] = await db
		.select({ id: table.client.id, avatarSource: table.client.avatarSource })
		.from(table.client)
		.where(and(eq(table.client.tenantId, tenantId), inArray(table.client.phone, variants)))
		.limit(1);

	let match = fast;
	if (!match) {
		const candidates = await db
			.select({ id: table.client.id, phone: table.client.phone, avatarSource: table.client.avatarSource })
			.from(table.client)
			.where(eq(table.client.tenantId, tenantId));
		for (const c of candidates) {
			if (!c.phone) continue;
			if (tryToE164(c.phone) === phoneE164) {
				match = { id: c.id, avatarSource: c.avatarSource };
				break;
			}
		}
	}

	if (!match) return;
	if (match.avatarSource !== 'whatsapp') return; // manual override respected

	await db
		.update(table.client)
		.set({ avatarPath: key, updatedAt: new Date() })
		.where(eq(table.client.id, match.id));
}

async function clearClientAvatarIfWhatsappSourced(
	tenantId: string,
	phoneE164: string
): Promise<void> {
	const variants = phoneE164Variants(phoneE164);
	const [fast] = await db
		.select({ id: table.client.id, avatarSource: table.client.avatarSource })
		.from(table.client)
		.where(and(eq(table.client.tenantId, tenantId), inArray(table.client.phone, variants)))
		.limit(1);

	let match = fast;
	if (!match) {
		const candidates = await db
			.select({ id: table.client.id, phone: table.client.phone, avatarSource: table.client.avatarSource })
			.from(table.client)
			.where(eq(table.client.tenantId, tenantId));
		for (const c of candidates) {
			if (!c.phone) continue;
			if (tryToE164(c.phone) === phoneE164) {
				match = { id: c.id, avatarSource: c.avatarSource };
				break;
			}
		}
	}
	if (!match || match.avatarSource !== 'whatsapp') return;
	await db
		.update(table.client)
		.set({ avatarPath: null, updatedAt: new Date() })
		.where(eq(table.client.id, match.id));
}
```

- [ ] **Step 2: Verify type-check passes**

```bash
cd app
npx svelte-check --threshold warning src/lib/server/whatsapp/avatar-fetcher.ts
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/server/whatsapp/avatar-fetcher.ts
git commit -m "feat(whatsapp): worker loop + fetch/store/propagate pipeline"
```

---

## Task 6: Hook `contacts.update` event in session-manager

**Files:**
- Modify: `app/src/lib/server/whatsapp/session-manager.ts`

- [ ] **Step 1: Import the fetcher**

In `app/src/lib/server/whatsapp/session-manager.ts`, near the top imports, add:

```ts
import { enqueueFetch, dropTenant } from './avatar-fetcher';
```

- [ ] **Step 2: Extend the `contacts.update` handler**

Locate the existing `sock.ev.on('contacts.update', ...)` handler (around line 290). Replace it with:

```ts
	sock.ev.on('contacts.update', (updates) => {
		if (updates.length === 0) return;
		// Live push-name updates (existing behavior)
		upsertPushNames(tenantId, updates).catch((err) => {
			logError('whatsapp', 'upsertPushNames (update) failed', {
				tenantId,
				metadata: { err: err instanceof Error ? err.message : String(err) }
			});
		});
		// Avatar events
		for (const u of updates) {
			const id = u.id;
			if (!id) continue;
			if (!id.endsWith('@s.whatsapp.net')) continue; // skip groups
			const phoneE164 = `+${id.split('@')[0].split(':')[0]}`;
			if ((u as { imgUrl?: unknown }).imgUrl === 'changed') {
				enqueueFetch(tenantId, phoneE164);
			} else if ((u as { imgUrl?: unknown }).imgUrl === null) {
				// Fire-and-forget: enqueue a "markHidden" by re-using the fetch pipeline
				// The worker will see url=undefined and treat it as hidden.
				enqueueFetch(tenantId, phoneE164);
			}
		}
	});
```

- [ ] **Step 3: Drop the fetcher queue on disconnect**

Locate the `connection === 'close'` branch in the same file (around line 173). Inside that branch, after `sessions.delete(tenantId);`, add:

```ts
			dropTenant(tenantId);
```

- [ ] **Step 4: Verify type-check**

```bash
cd app
npx svelte-check --threshold warning src/lib/server/whatsapp/session-manager.ts
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/server/whatsapp/session-manager.ts
git commit -m "feat(whatsapp): contacts.update avatar hook + queue cleanup on disconnect"
```

---

## Task 7: Surface avatar info in remote queries + lazy enqueue

**Files:**
- Modify: `app/src/lib/remotes/whatsapp.remote.ts`

- [ ] **Step 1: Add import for the fetcher and a staleness constant**

At the top of `app/src/lib/remotes/whatsapp.remote.ts`, add:

```ts
import { enqueueFetch } from '$lib/server/whatsapp/avatar-fetcher';
```

And at the module level (above the `assertTenantMember` function), add:

```ts
const AVATAR_STALE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — retry hidden/failed weekly
```

- [ ] **Step 2: Extend `listWhatsappConversations`**

Locate where the `contacts` query is built (around line 323). Extend the select to include `avatarPath`, `avatarFetchedAt`, `avatarHidden`:

```ts
		const contacts = await db
			.select({
				phoneE164: table.whatsappContact.phoneE164,
				displayName: table.whatsappContact.displayName,
				pushName: table.whatsappContact.pushName,
				avatarPath: table.whatsappContact.avatarPath,
				avatarFetchedAt: table.whatsappContact.avatarFetchedAt,
				avatarHidden: table.whatsappContact.avatarHidden
			})
			.from(table.whatsappContact)
			.where(eq(table.whatsappContact.tenantId, tenantId));
```

- [ ] **Step 3: Include `avatarPath` on each conversation entry**

Within the conversations build-up loop (around line 290), change the `displayName: null` placeholder block. At the point where you merge contact data into `c`, after `c.pushName = contact.pushName;` add:

```ts
				c.avatarPath = contact.avatarPath ?? null;
```

And in the initial construction of `c` (the `else {` branch where a new conversation object is created), add `avatarPath: null` as a field. Search for the object literal that creates the conversation entry and extend it:

```ts
				map.set(phone, {
					remotePhoneE164: phone,
					lastBody: m.body,
					lastDirection: m.direction,
					lastMessageType: m.messageType,
					lastAt: m.createdAt,
					clientId: null,
					clientName: null,
					displayName: null,
					pushName: null,
					avatarPath: null,
					unread: isUnread ? 1 : 0
				});
```

- [ ] **Step 4: Lazy-enqueue fetches for stale/missing avatars**

After the conversations merge loop completes (after the `for (const c of conversations) { ... }` block), add:

```ts
		const now = Date.now();
		for (const c of conversations) {
			if (c.avatarPath) continue;
			const contact = phoneToContact.get(c.remotePhoneE164);
			const hidden = contact?.avatarHidden ?? false;
			const fetchedAt = contact?.avatarFetchedAt?.getTime() ?? 0;
			if (hidden && now - fetchedAt < AVATAR_STALE_MS) continue;
			enqueueFetch(tenantId, c.remotePhoneE164);
		}
```

- [ ] **Step 5: Extend `getWhatsappThread` to include contact avatar**

Locate the `.select(...)` for `whatsappContact` inside `getWhatsappThread` (around line 402). Extend it:

```ts
	const [contact] = await db
		.select({
			displayName: table.whatsappContact.displayName,
			pushName: table.whatsappContact.pushName,
			avatarPath: table.whatsappContact.avatarPath
		})
		.from(table.whatsappContact)
		.where(
			and(
				eq(table.whatsappContact.tenantId, tenantId),
				eq(table.whatsappContact.phoneE164, remotePhoneE164)
			)
		)
		.limit(1);
```

No other changes — the returned `contact` object already flows out to the UI.

- [ ] **Step 6: Verify type-check**

```bash
cd app
npx svelte-check --threshold warning src/lib/remotes/whatsapp.remote.ts
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/remotes/whatsapp.remote.ts
git commit -m "feat(whatsapp): surface avatarPath on list/thread + lazy-enqueue stale"
```

---

## Task 8: Serving endpoint — WhatsApp contact avatar

**Files:**
- Create: `app/src/routes/[tenant]/api/whatsapp/avatar/[phoneE164]/+server.ts`

- [ ] **Step 1: Implement the endpoint**

Create `app/src/routes/[tenant]/api/whatsapp/avatar/[phoneE164]/+server.ts`:

```ts
import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { getIfExists } from '$lib/server/whatsapp/minio-helpers';

export const GET: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user || !locals.tenant) throw error(401, 'Unauthorized');
	const tenantId = locals.tenant.id;
	const phoneE164 = params.phoneE164;
	if (!phoneE164) throw error(400, 'phoneE164 required');

	const [row] = await db
		.select({
			avatarPath: table.whatsappContact.avatarPath,
			avatarMimeType: table.whatsappContact.avatarMimeType,
			avatarFetchedAt: table.whatsappContact.avatarFetchedAt
		})
		.from(table.whatsappContact)
		.where(
			and(
				eq(table.whatsappContact.tenantId, tenantId),
				eq(table.whatsappContact.phoneE164, phoneE164)
			)
		)
		.limit(1);

	if (!row?.avatarPath) throw error(404, 'No avatar');

	const etag = `"${row.avatarFetchedAt?.getTime() ?? 0}"`;
	if (request.headers.get('if-none-match') === etag) {
		return new Response(null, { status: 304 });
	}

	const buf = await getIfExists(row.avatarPath);
	if (!buf) throw error(404, 'Avatar missing from storage');

	return new Response(new Uint8Array(buf), {
		status: 200,
		headers: {
			'Content-Type': row.avatarMimeType || 'image/jpeg',
			'Cache-Control': 'private, max-age=3600',
			ETag: etag
		}
	});
};
```

- [ ] **Step 2: Verify type-check**

```bash
cd app
npx svelte-check --threshold warning 'src/routes/[tenant]/api/whatsapp/avatar/[phoneE164]/+server.ts'
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add 'app/src/routes/[tenant]/api/whatsapp/avatar/[phoneE164]/+server.ts'
git commit -m "feat(whatsapp): avatar proxy endpoint with ETag"
```

---

## Task 9: Serving endpoint — CRM client avatar

**Files:**
- Create: `app/src/routes/[tenant]/api/clients/[clientId]/avatar/+server.ts`

- [ ] **Step 1: Implement the endpoint**

Create `app/src/routes/[tenant]/api/clients/[clientId]/avatar/+server.ts`:

```ts
import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { getIfExists } from '$lib/server/whatsapp/minio-helpers';

export const GET: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user || !locals.tenant) throw error(401, 'Unauthorized');
	const tenantId = locals.tenant.id;
	const clientId = params.clientId;
	if (!clientId) throw error(400, 'clientId required');

	const [row] = await db
		.select({
			avatarPath: table.client.avatarPath,
			updatedAt: table.client.updatedAt
		})
		.from(table.client)
		.where(and(eq(table.client.tenantId, tenantId), eq(table.client.id, clientId)))
		.limit(1);

	if (!row?.avatarPath) throw error(404, 'No avatar');

	const etag = `"${row.updatedAt?.getTime() ?? 0}"`;
	if (request.headers.get('if-none-match') === etag) {
		return new Response(null, { status: 304 });
	}

	const buf = await getIfExists(row.avatarPath);
	if (!buf) throw error(404, 'Avatar missing from storage');

	const mimeFromExt = row.avatarPath.endsWith('.png')
		? 'image/png'
		: row.avatarPath.endsWith('.webp')
			? 'image/webp'
			: 'image/jpeg';

	return new Response(new Uint8Array(buf), {
		status: 200,
		headers: {
			'Content-Type': mimeFromExt,
			'Cache-Control': 'private, max-age=3600',
			ETag: etag
		}
	});
};
```

- [ ] **Step 2: Verify type-check**

```bash
cd app
npx svelte-check --threshold warning 'src/routes/[tenant]/api/clients/[clientId]/avatar/+server.ts'
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add 'app/src/routes/[tenant]/api/clients/[clientId]/avatar/+server.ts'
git commit -m "feat(client): avatar proxy endpoint"
```

---

## Task 10: `ContactAvatar.svelte` component (initials fallback)

**Files:**
- Create: `app/src/lib/components/ui/contact-avatar.svelte`

- [ ] **Step 1: Implement the component**

Create `app/src/lib/components/ui/contact-avatar.svelte`:

```svelte
<script lang="ts">
	interface Props {
		src?: string | null;
		name: string;
		phoneE164?: string | null;
		size?: 'sm' | 'md' | 'lg';
		class?: string;
	}

	let { src = null, name, phoneE164 = null, size = 'md', class: className = '' }: Props = $props();

	const SIZE_PX = { sm: 32, md: 40, lg: 48 } as const;
	const PALETTE = [
		'#2563eb', // blue-600
		'#059669', // emerald-600
		'#dc2626', // red-600
		'#d97706', // amber-600
		'#7c3aed', // violet-600
		'#db2777', // pink-600
		'#0891b2', // cyan-600
		'#65a30d' // lime-600
	];

	function hashString(s: string): number {
		let h = 0;
		for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
		return Math.abs(h);
	}

	function initials(n: string): string {
		const parts = n.trim().split(/\s+/).filter(Boolean);
		if (parts.length === 0) return '?';
		if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
		return (parts[0][0] + parts[1][0]).toUpperCase();
	}

	const px = $derived(SIZE_PX[size]);
	const seed = $derived(phoneE164 ?? name ?? '?');
	const bg = $derived(PALETTE[hashString(seed) % PALETTE.length]);
	const text = $derived(initials(name));

	let errored = $state(false);
</script>

{#if src && !errored}
	<img
		{src}
		alt={name}
		loading="lazy"
		width={px}
		height={px}
		class="rounded-full object-cover {className}"
		style="width: {px}px; height: {px}px;"
		onerror={() => (errored = true)}
	/>
{:else}
	<div
		aria-label={name}
		role="img"
		class="inline-flex items-center justify-center rounded-full font-medium text-white {className}"
		style="width: {px}px; height: {px}px; background-color: {bg}; font-size: {Math.round(px * 0.4)}px;"
	>
		{text}
	</div>
{/if}
```

- [ ] **Step 2: Run svelte-autofixer**

Per memory rule: "Always run svelte-autofixer on every new/modified component after implementation." Use the Svelte MCP server:

```
Use mcp__svelte__svelte-autofixer with:
  filename: "contact-avatar.svelte"
  desired_svelte_version: 5
  code: <content of the file>
```

Apply any real fixes it suggests. Heuristic suggestions about `$effect`/`bind:this` are acceptable as-is.

- [ ] **Step 3: Verify type-check**

```bash
cd app
npx svelte-check --threshold warning src/lib/components/ui/contact-avatar.svelte
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add app/src/lib/components/ui/contact-avatar.svelte
git commit -m "feat(ui): ContactAvatar component with initials fallback"
```

---

## Task 11: Wire ContactAvatar into WA UI

**Files:**
- Modify: `app/src/routes/[tenant]/whatsapp/+page.svelte`

- [ ] **Step 1: Import the component + page-level tenant slug (already present)**

Ensure the import section contains:

```ts
	import ContactAvatar from '$lib/components/ui/contact-avatar.svelte';
```

- [ ] **Step 2: Render avatar in the conversations list**

Locate the conversation list item (around line 473). Inside the `<button>` element, wrap the label section so the avatar sits beside it. Replace the inner `<div class="flex items-center justify-between gap-2">` block with:

```svelte
										<div class="flex items-center gap-3">
											<ContactAvatar
												src={`/${tenantSlug}/api/whatsapp/avatar/${encodeURIComponent(c.remotePhoneE164)}`}
												name={label}
												phoneE164={c.remotePhoneE164}
												size="md"
											/>
											<div class="min-w-0 flex-1">
												<div class="flex items-center gap-2">
													<span class="truncate font-medium">{label}</span>
													{#if c.unread > 0}
														<Badge class="h-5 min-w-5 px-1.5 text-xs bg-emerald-600">{c.unread}</Badge>
													{/if}
												</div>
												{#if hasName}
													<p class="truncate text-xs text-muted-foreground">{c.remotePhoneE164}</p>
												{/if}
												<p class="mt-1 truncate text-xs text-muted-foreground">
													{#if c.lastDirection === 'outbound'}<span class="text-muted-foreground">Tu: </span>{/if}
													{c.lastBody ?? `[${c.lastMessageType}]`}
												</p>
											</div>
											<span class="text-xs text-muted-foreground">{formatTime(c.lastAt)}</span>
										</div>
```

Note: for contacts without an avatar, `<img>` will 404 → `ContactAvatar`'s `onerror` swaps to initials. No extra conditional needed.

- [ ] **Step 3: Render avatar in thread header**

Locate the thread `CardHeader` (around line 540). Replace the inner `<div class="flex items-center justify-between">` with:

```svelte
						<div class="flex items-center gap-3">
							<ContactAvatar
								src={`/${tenantSlug}/api/whatsapp/avatar/${encodeURIComponent(selectedPhone)}`}
								name={threadLabel}
								phoneE164={selectedPhone}
								size="lg"
							/>
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									<CardTitle class="truncate text-base">{threadLabel}</CardTitle>
									<Button variant="ghost" size="sm" class="h-7 w-7 p-0" title="Redenumește" onclick={openRename}>
										<Pencil class="h-3.5 w-3.5" />
									</Button>
								</div>
								{#if thread?.client}
									<p class="truncate text-xs text-muted-foreground">
										{selectedPhone} ·
										<a href="/{tenantSlug}/clients/{thread.client.id}" class="underline hover:no-underline">
											Vezi fișa clientului
										</a>
									</p>
								{:else}
									<p class="truncate text-xs text-muted-foreground">{selectedPhone} · Nelegat la client</p>
								{/if}
							</div>
							<Button variant="ghost" size="sm" onclick={() => (selectedPhone = null)}>Închide</Button>
						</div>
```

- [ ] **Step 4: Run svelte-autofixer on the page**

Run the Svelte MCP autofixer on `+page.svelte` with `desired_svelte_version: 5` to catch any binding issues.

- [ ] **Step 5: Verify type-check**

```bash
cd app
npx svelte-check --threshold warning 'src/routes/[tenant]/whatsapp/+page.svelte'
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add 'app/src/routes/[tenant]/whatsapp/+page.svelte'
git commit -m "feat(whatsapp): render contact avatars in list + thread header"
```

---

## Task 12: End-to-end verification on dev server

- [ ] **Step 1: Merge branch → main (worktree → main workflow)**

Per memory rule: "Local preview needs main — Dev server runs from main." Merge the current branch into `main` so HMR in the main worktree picks up changes:

```bash
cd /Users/augustin598/Projects/CRM
git merge --no-ff claude/<current-branch>-9dbd2d -m "Merge: WhatsApp profile pictures feature"
```

- [ ] **Step 2: Open WhatsApp page in browser**

Navigate to `http://localhost:<port>/<tenant-slug>/whatsapp`. Confirm the conversations list loads and initial placeholders (initials) render before avatars appear.

- [ ] **Step 3: Observe a fetch cycle in dev logs**

Look for `[WHATSAPP] avatar stored tenant=... phone=... key=...` log lines as the queue drains. Pacing should be visibly ~3s between conversations.

- [ ] **Step 4: Verify a linked client picks up the avatar**

In a separate tab open a CRM client known to be linked to a WhatsApp conversation. Test the client avatar endpoint by hitting:

```
GET /<tenant-slug>/api/clients/<clientId>/avatar
```

Expected: `200` with `image/jpeg` (or png/webp) body, `Cache-Control: private, max-age=3600`, `ETag`. Hit again with `If-None-Match: "<etag>"` — expect `304`.

- [ ] **Step 5: Exercise the hidden/null path**

In WhatsApp mobile, toggle your own profile photo privacy to "My Contacts" while the socket is disconnected and your dev tenant's number is not a contact. Re-connect and observe `contacts.update` firing with `imgUrl: null`. Confirm the MinIO object is removed and the UI falls back to initials on refresh.

- [ ] **Step 6: No commit** — this is verification only.

---

## Self-review

**Spec coverage:**
- ✅ `whatsapp_contact` + `client` schema changes → Task 1
- ✅ `avatarSource` forward-compat → Task 1
- ✅ In-memory per-tenant queue, dedup pending+in-flight → Tasks 3
- ✅ Global 1 req/s ceiling → Task 4
- ✅ 3s per-tenant pacing → Task 5
- ✅ Baileys `profilePictureUrl` with 'preview' + 8s timeout → Task 5
- ✅ 429 → single retry with 30s delay → Task 5
- ✅ 404/undefined → `avatarHidden = true` + MinIO delete → Task 5 (markHidden)
- ✅ External fetch with AbortSignal.timeout(10s) → Task 5
- ✅ Magic-byte MIME validation → Tasks 2, 5
- ✅ Stable MinIO path per tenant+phone → Task 5
- ✅ Propagate to client via `phoneE164Variants` + `tryToE164` → Task 5
- ✅ Respect `avatarSource = 'manual'` → Task 5
- ✅ `contacts.update` hook: 'changed' enqueues; null clears + deletes → Task 6
- ✅ Clean up queue on disconnect → Task 6
- ✅ Lazy enqueue in `listWhatsappConversations` with 7-day staleness → Task 7
- ✅ SvelteKit proxy with ETag + `Cache-Control` → Tasks 8, 9
- ✅ `ContactAvatar` with initials fallback, color-hash palette → Task 10
- ✅ Integration in WA list + thread header → Task 11
- ✅ Dev server verification (HMR via main branch) → Task 12

**No gaps.**

**Placeholder scan:** No TBD/TODO. Every code step contains the actual code. Expected outputs specified for every command.

**Type consistency:**
- `enqueueFetch(tenantId: string, phoneE164: string, opts?: EnqueueOptions)` — consistent across Tasks 3, 5, 6, 7
- `ImageMime` type from Task 2 used in Task 5 worker
- `dropTenant(tenantId)` from Task 3 used in Task 6
- Column names match between schema (Task 1), worker (Task 5), remote (Task 7), endpoints (Tasks 8, 9): `avatarPath`, `avatarMimeType`, `avatarFetchedAt`, `avatarHidden`, `avatarSource`
