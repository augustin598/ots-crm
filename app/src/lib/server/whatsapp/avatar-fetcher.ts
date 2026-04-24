// $lib imports are lazy (dynamic) so this module is safely importable in unit tests
// without a SvelteKit build context.

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

// Test helpers (not exported from index)
export async function _acquireGlobalTokenForTests(): Promise<void> {
	await acquireGlobalToken();
}

export function _setGlobalRateForTests(opts: { intervalMs: number; initialTokens: number }): void {
	GLOBAL_RATE.tokens = opts.initialTokens;
	GLOBAL_RATE.intervalMs = opts.intervalMs;
	GLOBAL_RATE.lastRefillAt = Date.now();
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
				const { logError } = await import('$lib/server/logger');
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
	const { getActiveSession } = await import('./session-manager');
	const { e164ToJid } = await import('./phone');
	const { logWarning } = await import('$lib/server/logger');

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

	const { detectImageMime } = await import('./image-validation');
	const mime = detectImageMime(buf);
	if (!mime) {
		logWarning('whatsapp', 'avatar payload failed magic-byte check', {
			tenantId,
			metadata: { phone: phoneE164, bytes: buf.length }
		});
		await touchFetchedAt(tenantId, phoneE164);
		return;
	}

	const key = avatarKey(tenantId, phoneE164);
	const { putStable } = await import('./minio-helpers');
	await putStable(key, buf, mime);
	await upsertContactAvatar(tenantId, phoneE164, key, mime);
	await propagateToClient(tenantId, phoneE164, key);
}

async function markHidden(tenantId: string, phoneE164: string): Promise<void> {
	const { db } = await import('$lib/server/db');
	const table = await import('$lib/server/db/schema');
	const { and, eq } = await import('drizzle-orm');
	const { removeIfExists } = await import('./minio-helpers');

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
	const { db } = await import('$lib/server/db');
	const table = await import('$lib/server/db/schema');
	const { and, eq } = await import('drizzle-orm');

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
	mime: string
): Promise<void> {
	const { db } = await import('$lib/server/db');
	const table = await import('$lib/server/db/schema');
	const { and, eq } = await import('drizzle-orm');
	const { logInfo } = await import('$lib/server/logger');

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
	const { db } = await import('$lib/server/db');
	const table = await import('$lib/server/db/schema');
	const { and, eq, inArray } = await import('drizzle-orm');
	const { phoneE164Variants, tryToE164 } = await import('./phone');

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
	const { db } = await import('$lib/server/db');
	const table = await import('$lib/server/db/schema');
	const { and, eq, inArray } = await import('drizzle-orm');
	const { phoneE164Variants, tryToE164 } = await import('./phone');

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

// Test helpers (not exported from index)
export function _resetAvatarFetcherForTests(): void {
	queues.clear();
	GLOBAL_RATE.tokens = 1;
	GLOBAL_RATE.intervalMs = 1000;
	GLOBAL_RATE.lastRefillAt = Date.now();
}

export function _inspectQueueForTests(tenantId: string): TenantQueue {
	return getQueue(tenantId);
}
