import { default as makeWASocket, Browsers, DisconnectReason, fetchLatestBaileysVersion, isPnUser, type WASocket, type WAMessageKey, type Contact, proto } from 'baileys';
import { toDataURL as qrDataURL } from 'qrcode';
import pino from 'pino';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { logError, logInfo, logWarning } from '$lib/server/logger';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { makeTenantAuthStore, type TenantAuthStore } from './auth-store';
import { removePrefix } from './minio-helpers';
import { publish as publishQr } from './qr-broker';
import { handleInbound, handleMessageUpdate } from './inbound-handler';
import { upsertPushNames, upsertChatNames } from './contacts-store';
import { enqueueFetch, dropTenant } from './avatar-fetcher';
import { humanizedDelay } from './rate-limiter';
import { e164ToJid, jidToE164 } from './phone';

const SILENT_LOGGER = pino({ level: 'silent' });

type ActiveSession = {
	sessionId: string;
	tenantId: string;
	sock: WASocket;
	auth: TenantAuthStore;
};

const SESSIONS_SYMBOL = Symbol.for('ots_crm_whatsapp_sessions');
const STARTING_SYMBOL = Symbol.for('ots_crm_whatsapp_starting');
const GT = globalThis as unknown as Record<symbol, unknown>;

const sessions: Map<string, ActiveSession> =
	(GT[SESSIONS_SYMBOL] as Map<string, ActiveSession>) ??
	(GT[SESSIONS_SYMBOL] = new Map<string, ActiveSession>());

const starting: Map<string, Promise<ActiveSession>> =
	(GT[STARTING_SYMBOL] as Map<string, Promise<ActiveSession>>) ??
	(GT[STARTING_SYMBOL] = new Map<string, Promise<ActiveSession>>());

function generateSessionId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

function storagePath(tenantId: string): string {
	return `${tenantId}/whatsapp/`;
}

async function upsertSessionRow(tenantId: string): Promise<string> {
	const [existing] = await db
		.select({ id: table.whatsappSession.id })
		.from(table.whatsappSession)
		.where(eq(table.whatsappSession.tenantId, tenantId))
		.limit(1);
	if (existing) return existing.id;
	const id = generateSessionId();
	await db.insert(table.whatsappSession).values({
		id,
		tenantId,
		status: 'qr_pending',
		storagePath: storagePath(tenantId),
		createdAt: new Date(),
		updatedAt: new Date()
	});
	return id;
}

async function setSessionStatus(
	tenantId: string,
	patch: Partial<typeof table.whatsappSession.$inferInsert>
): Promise<void> {
	await db
		.update(table.whatsappSession)
		.set({ ...patch, updatedAt: new Date() })
		.where(eq(table.whatsappSession.tenantId, tenantId));
}

async function createSocket(tenantId: string, sessionId: string): Promise<ActiveSession> {
	console.log(`[WHATSAPP] createSocket start tenant=${tenantId} session=${sessionId}`);
	const auth = await makeTenantAuthStore(tenantId);
	console.log(`[WHATSAPP] auth store loaded for tenant=${tenantId}`);

	let version: [number, number, number];
	try {
		const res = await Promise.race([
			fetchLatestBaileysVersion(),
			new Promise<never>((_, reject) => setTimeout(() => reject(new Error('fetchLatestBaileysVersion timeout')), 8000))
		]);
		version = res.version as [number, number, number];
		console.log(`[WHATSAPP] using Baileys version ${version.join('.')}`);
	} catch (err) {
		version = [2, 3000, 1035194821];
		console.warn(`[WHATSAPP] fetchLatestBaileysVersion failed, using fallback ${version.join('.')} — ${err instanceof Error ? err.message : err}`);
	}

	const sock = makeWASocket({
		version,
		auth: auth.state,
		logger: SILENT_LOGGER,
		browser: Browsers.macOS('Desktop'), // required for full history sync
		printQRInTerminal: false,
		syncFullHistory: true,
		markOnlineOnConnect: false,
		getMessage: async (key: WAMessageKey) => {
			if (!key.id) return undefined;
			try {
				const { db } = await import('$lib/server/db');
				const tableMod = await import('$lib/server/db/schema');
				const { and, eq } = await import('drizzle-orm');
				const [row] = await db
					.select({ body: tableMod.whatsappMessage.body })
					.from(tableMod.whatsappMessage)
					.where(
						and(
							eq(tableMod.whatsappMessage.tenantId, tenantId),
							eq(tableMod.whatsappMessage.wamId, key.id)
						)
					)
					.limit(1);
				if (!row?.body) return undefined;
				return proto.Message.fromObject({ conversation: row.body });
			} catch {
				return undefined;
			}
		}
	});
	console.log(`[WHATSAPP] socket created for tenant=${tenantId}, waiting for QR...`);

	const active: ActiveSession = { sessionId, tenantId, sock, auth };
	sessions.set(tenantId, active);

	sock.ev.on('creds.update', () => {
		auth.saveCreds().catch((err) => {
			logWarning('whatsapp', 'saveCreds failed', {
				tenantId,
				metadata: { err: err instanceof Error ? err.message : String(err) }
			});
		});
	});

	sock.ev.on('connection.update', async (update) => {
		try {
			const { connection, lastDisconnect, qr } = update;

			if (qr) {
				console.log(`[WHATSAPP] QR received for tenant=${tenantId}, generating data URL...`);
				const dataUrl = await qrDataURL(qr, { margin: 2, width: 320 });
				publishQr(tenantId, 'qr', { dataUrl });
				await setSessionStatus(tenantId, { status: 'qr_pending' });
				console.log(`[WHATSAPP] QR published to SSE subscribers`);
			}

			if (connection === 'connecting') {
				await setSessionStatus(tenantId, { status: 'connecting' });
			}

			if (connection === 'open') {
				const userJid = sock.user?.id ?? '';
				const phoneE164 = userJid ? jidToE164(userJid.split(':')[0]) : null;
				const displayName = sock.user?.name ?? null;

				await setSessionStatus(tenantId, {
					status: 'connected',
					phoneE164,
					displayName,
					lastConnectedAt: new Date(),
					lastError: null
				});
				publishQr(tenantId, 'connected', { phoneE164, displayName });
				logInfo('whatsapp', 'Session connected', {
					tenantId,
					metadata: { sessionId, phoneE164, displayName }
				});
			}

			if (connection === 'close') {
				const code = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
				const message = lastDisconnect?.error instanceof Error ? lastDisconnect.error.message : String(lastDisconnect?.error ?? 'unknown');

				logWarning('whatsapp', `Connection closed (${code ?? 'no code'}): ${message}`, {
					tenantId,
					metadata: { sessionId, code }
				});

				sessions.delete(tenantId);
				dropTenant(tenantId);

				if (code === DisconnectReason.loggedOut) {
					await auth.clear().catch(() => {});
					await removePrefix(storagePath(tenantId)).catch(() => {});
					await setSessionStatus(tenantId, {
						status: 'needs_reauth',
						lastDisconnectedAt: new Date(),
						lastError: `loggedOut: ${message}`
					});
					publishQr(tenantId, 'disconnected', { reason: 'logged_out' });
					return;
				}

				await setSessionStatus(tenantId, {
					status: 'disconnected',
					lastDisconnectedAt: new Date(),
					lastError: message
				});

				// Auto reconnect for transient drops
				if (code !== DisconnectReason.connectionReplaced) {
					setTimeout(() => {
						startSession(tenantId).catch((err) => {
							logError('whatsapp', 'Auto-reconnect failed', {
								tenantId,
								metadata: { err: err instanceof Error ? err.message : String(err) }
							});
						});
					}, 3000);
				}
			}
		} catch (err) {
			logError('whatsapp', 'connection.update handler error', {
				tenantId,
				metadata: { err: err instanceof Error ? err.message : String(err) }
			});
		}
	});

	sock.ev.on('messages.upsert', ({ messages, type }) => {
		if (type !== 'notify' && type !== 'append') return;
		handleInbound(tenantId, sessionId, messages).catch((err) => {
			logError('whatsapp', 'handleInbound failed', {
				tenantId,
				metadata: { err: err instanceof Error ? err.message : String(err) }
			});
		});
	});

	sock.ev.on('messaging-history.set', ({ messages, contacts, chats, isLatest, progress }) => {
		console.log(
			`[WHATSAPP] history batch tenant=${tenantId} messages=${messages.length} contacts=${contacts.length} chats=${chats.length} progress=${progress ?? '?'} isLatest=${isLatest}`
		);
		handleInbound(tenantId, sessionId, messages, true).catch((err) => {
			logError('whatsapp', 'handleInbound (history) failed', {
				tenantId,
				metadata: { err: err instanceof Error ? err.message : String(err) }
			});
		});
		if (contacts.length > 0) {
			upsertPushNames(tenantId, contacts).catch((err) => {
				logError('whatsapp', 'upsertPushNames (history) failed', {
					tenantId,
					metadata: { err: err instanceof Error ? err.message : String(err) }
				});
			});
		}
		if (chats.length > 0) {
			upsertChatNames(tenantId, chats).catch((err) => {
				logError('whatsapp', 'upsertChatNames (history) failed', {
					tenantId,
					metadata: { err: err instanceof Error ? err.message : String(err) }
				});
			});
		}
	});

	sock.ev.on('chats.upsert', (chats) => {
		if (chats.length === 0) return;
		upsertChatNames(tenantId, chats).catch((err) => {
			logError('whatsapp', 'upsertChatNames (upsert) failed', {
				tenantId,
				metadata: { err: err instanceof Error ? err.message : String(err) }
			});
		});
	});

	sock.ev.on('chats.update', (updates) => {
		if (updates.length === 0) return;
		upsertChatNames(tenantId, updates).catch((err) => {
			logError('whatsapp', 'upsertChatNames (update) failed', {
				tenantId,
				metadata: { err: err instanceof Error ? err.message : String(err) }
			});
		});
	});

	sock.ev.on('contacts.upsert', (contacts) => {
		if (contacts.length === 0) return;
		upsertPushNames(tenantId, contacts).catch((err) => {
			logError('whatsapp', 'upsertPushNames (live) failed', {
				tenantId,
				metadata: { err: err instanceof Error ? err.message : String(err) }
			});
		});
	});

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
				// Fire-and-forget: enqueue a "markHidden" by re-using the fetch pipeline.
				// The worker will see profilePictureUrl returning undefined and mark as hidden.
				enqueueFetch(tenantId, phoneE164);
			}
		}
	});

	sock.ev.on('messages.update', (updates) => {
		handleMessageUpdate(tenantId, updates as never).catch((err) => {
			logError('whatsapp', 'handleMessageUpdate failed', {
				tenantId,
				metadata: { err: err instanceof Error ? err.message : String(err) }
			});
		});
	});

	return active;
}

export async function startSession(tenantId: string): Promise<ActiveSession> {
	console.log(`[WHATSAPP] startSession called for tenant=${tenantId}`);
	const existing = sessions.get(tenantId);
	if (existing) {
		console.log(`[WHATSAPP] reusing existing active session for tenant=${tenantId}`);
		return existing;
	}

	const pending = starting.get(tenantId);
	if (pending) {
		console.log(`[WHATSAPP] reusing pending start for tenant=${tenantId}`);
		return pending;
	}

	const promise = (async () => {
		try {
			const sessionId = await upsertSessionRow(tenantId);
			console.log(`[WHATSAPP] session row ready id=${sessionId}`);
			return await createSocket(tenantId, sessionId);
		} catch (err) {
			console.error(`[WHATSAPP] startSession failed for tenant=${tenantId}:`, err);
			throw err;
		} finally {
			starting.delete(tenantId);
		}
	})();
	starting.set(tenantId, promise);
	return promise;
}

export async function stopSession(tenantId: string, logout = false): Promise<void> {
	const active = sessions.get(tenantId);
	if (!active) return;
	try {
		if (logout) {
			await active.sock.logout();
		} else {
			await active.sock.end(undefined);
		}
	} catch (err) {
		logWarning('whatsapp', 'stopSession error', {
			tenantId,
			metadata: { err: err instanceof Error ? err.message : String(err) }
		});
	}
	sessions.delete(tenantId);
	if (logout) {
		await active.auth.clear().catch(() => {});
		await setSessionStatus(tenantId, {
			status: 'disconnected',
			lastDisconnectedAt: new Date(),
			phoneE164: null,
			displayName: null
		});
	}
}

export function getActiveSession(tenantId: string): ActiveSession | null {
	return sessions.get(tenantId) ?? null;
}

export async function sendText(tenantId: string, toE164Phone: string, text: string): Promise<string> {
	const active = sessions.get(tenantId);
	if (!active) throw new Error('WhatsApp session not connected');

	await humanizedDelay(tenantId);
	const jid = e164ToJid(toE164Phone);

	try {
		await active.sock.sendPresenceUpdate('composing', jid);
	} catch {
		// non-fatal
	}

	const sent = await active.sock.sendMessage(jid, { text });
	if (!sent?.key?.id) throw new Error('sendMessage returned no message id');

	try {
		await active.sock.sendPresenceUpdate('paused', jid);
	} catch {
		// non-fatal
	}

	return sent.key.id;
}

export interface SendMediaInput {
	buffer: Buffer;
	mimeType: string;
	fileName?: string;
	caption?: string;
	kind: 'image' | 'document' | 'video' | 'audio';
}

export async function sendMedia(
	tenantId: string,
	toE164Phone: string,
	input: SendMediaInput
): Promise<{ wamId: string; mediaPath: string | null; sizeBytes: number }> {
	const active = sessions.get(tenantId);
	if (!active) throw new Error('WhatsApp session not connected');

	await humanizedDelay(tenantId);
	const jid = e164ToJid(toE164Phone);

	try {
		await active.sock.sendPresenceUpdate('composing', jid);
	} catch {
		// non-fatal
	}

	let payload: Record<string, unknown>;
	if (input.kind === 'image') {
		payload = { image: input.buffer, caption: input.caption || undefined, mimetype: input.mimeType };
	} else if (input.kind === 'video') {
		payload = { video: input.buffer, caption: input.caption || undefined, mimetype: input.mimeType };
	} else if (input.kind === 'audio') {
		payload = { audio: input.buffer, mimetype: input.mimeType, ptt: false };
	} else {
		payload = {
			document: input.buffer,
			mimetype: input.mimeType,
			fileName: input.fileName || 'document',
			caption: input.caption || undefined
		};
	}

	const sent = await active.sock.sendMessage(jid, payload as never);
	if (!sent?.key?.id) throw new Error('sendMessage returned no message id');

	try {
		await active.sock.sendPresenceUpdate('paused', jid);
	} catch {
		// non-fatal
	}

	const { buildMediaKey } = await import('./media-handler');
	const { putStable } = await import('./minio-helpers');
	const kindToMediaKind = {
		image: 'image' as const,
		video: 'video' as const,
		audio: 'audio' as const,
		document: 'document' as const
	};
	const info = {
		kind: kindToMediaKind[input.kind],
		mimeType: input.mimeType,
		fileName: input.fileName ?? null
	};
	const path = buildMediaKey(tenantId, sent.key.id, info);
	try {
		await putStable(path, input.buffer, input.mimeType);
		return { wamId: sent.key.id, mediaPath: path, sizeBytes: input.buffer.length };
	} catch (err) {
		logError('whatsapp', 'Failed to mirror outbound media to MinIO', {
			tenantId,
			metadata: { err: err instanceof Error ? err.message : String(err) }
		});
		return { wamId: sent.key.id, mediaPath: null, sizeBytes: input.buffer.length };
	}
}

export async function shutdownAllSessions(): Promise<void> {
	const all = Array.from(sessions.entries());
	await Promise.all(
		all.map(async ([tenantId, active]) => {
			try {
				await active.auth.flush();
			} catch {
				// ignore
			}
			try {
				await active.sock.end(undefined);
			} catch {
				// ignore
			}
			sessions.delete(tenantId);
		})
	);
}

export async function restoreAllSessions(): Promise<void> {
	try {
		const rows = await db
			.select({ tenantId: table.whatsappSession.tenantId })
			.from(table.whatsappSession)
			.where(eq(table.whatsappSession.status, 'connected'));

		logInfo('whatsapp', `Restoring ${rows.length} WhatsApp session(s)`);
		for (const row of rows) {
			try {
				await startSession(row.tenantId);
			} catch (err) {
				logError('whatsapp', 'Failed to restore session', {
					tenantId: row.tenantId,
					metadata: { err: err instanceof Error ? err.message : String(err) }
				});
			}
		}
	} catch (err) {
		logError('whatsapp', 'restoreAllSessions failed', {
			metadata: { err: err instanceof Error ? err.message : String(err) }
		});
	}
}

export async function getSessionStatus(tenantId: string): Promise<{
	status: string;
	phoneE164: string | null;
	displayName: string | null;
	lastConnectedAt: Date | null;
	lastError: string | null;
} | null> {
	const [row] = await db
		.select({
			status: table.whatsappSession.status,
			phoneE164: table.whatsappSession.phoneE164,
			displayName: table.whatsappSession.displayName,
			lastConnectedAt: table.whatsappSession.lastConnectedAt,
			lastError: table.whatsappSession.lastError
		})
		.from(table.whatsappSession)
		.where(eq(table.whatsappSession.tenantId, tenantId))
		.limit(1);
	return row ?? null;
}

export async function loadSessionIdForTenant(tenantId: string): Promise<string | null> {
	const [row] = await db
		.select({ id: table.whatsappSession.id })
		.from(table.whatsappSession)
		.where(and(eq(table.whatsappSession.tenantId, tenantId), eq(table.whatsappSession.status, 'connected')))
		.limit(1);
	return row?.id ?? null;
}
