import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import {
	startSession,
	stopSession,
	sendText,
	sendMedia,
	getSessionStatus,
	loadSessionIdForTenant
} from '$lib/server/whatsapp/session-manager';
import { getCachedQr } from '$lib/server/whatsapp/qr-broker';
import { setDisplayName } from '$lib/server/whatsapp/contacts-store';
import { toE164, tryToE164, phoneE164Variants, InvalidPhoneError } from '$lib/server/whatsapp/phone';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { logError } from '$lib/server/logger';

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

function assertTenantMember() {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	return { userId: event.locals.user.id, tenantId: event.locals.tenant.id };
}

function assertTenantAdmin() {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	const role = event.locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') throw new Error('Insufficient permissions');
	return { userId: event.locals.user.id, tenantId: event.locals.tenant.id };
}

export const getWhatsappConnectionStatus = query(async () => {
	const { tenantId } = assertTenantMember();
	const status = await getSessionStatus(tenantId);
	return { status };
});

export const getWhatsappQr = query(async () => {
	const { tenantId } = assertTenantMember();
	const cached = getCachedQr(tenantId);
	if (!cached) return { qr: null as string | null };
	try {
		const parsed = JSON.parse(cached) as { dataUrl?: string };
		return { qr: parsed.dataUrl ?? null };
	} catch {
		return { qr: null };
	}
});

export const startWhatsappConnection = command(async () => {
	const { tenantId } = assertTenantAdmin();
	void startSession(tenantId).catch((err) => {
		logError('whatsapp', 'startSession failed', {
			tenantId,
			metadata: { err: err instanceof Error ? err.message : String(err) }
		});
	});
	await getWhatsappConnectionStatus().refresh();
	return { ok: true };
});

export const disconnectWhatsapp = command(async () => {
	const { tenantId } = assertTenantAdmin();
	await stopSession(tenantId, true);
	await getWhatsappConnectionStatus().refresh();
	return { ok: true };
});

export const sendWhatsappMedia = command(
	v.object({
		clientId: v.optional(v.string()),
		to: v.optional(v.string()),
		base64: v.pipe(v.string(), v.minLength(10)),
		mimeType: v.pipe(v.string(), v.minLength(3)),
		fileName: v.optional(v.string()),
		caption: v.optional(v.string()),
		kind: v.picklist(['image', 'video', 'audio', 'document'])
	}),
	async (data) => {
		const { tenantId } = assertTenantMember();
		const sessionId = await loadSessionIdForTenant(tenantId);
		if (!sessionId) throw new Error('WhatsApp nu este conectat');

		let toPhone: string;
		try {
			if (data.clientId) {
				const [client] = await db
					.select({ phone: table.client.phone })
					.from(table.client)
					.where(and(eq(table.client.id, data.clientId), eq(table.client.tenantId, tenantId)))
					.limit(1);
				if (!client) throw new Error('Client not found');
				if (!client.phone) throw new Error('Clientul nu are număr de telefon');
				toPhone = toE164(client.phone);
			} else if (data.to) {
				toPhone = toE164(data.to);
			} else {
				throw new Error('clientId or to is required');
			}
		} catch (err) {
			if (err instanceof InvalidPhoneError) throw new Error(err.message);
			throw err;
		}

		const buffer = Buffer.from(data.base64, 'base64');
		if (buffer.length === 0) throw new Error('Empty media buffer');
		if (buffer.length > 20 * 1024 * 1024) throw new Error('Fișierul depășește 20MB');

		// WhatsApp only supports jpg/png/webp/gif as image. For SVG/BMP/TIFF/etc. send as document.
		const IMAGE_WHITELIST = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
		const VIDEO_WHITELIST = new Set(['video/mp4', 'video/quicktime', 'video/3gpp']);
		let effectiveKind = data.kind;
		if (data.kind === 'image' && !IMAGE_WHITELIST.has(data.mimeType.toLowerCase())) {
			effectiveKind = 'document';
		} else if (data.kind === 'video' && !VIDEO_WHITELIST.has(data.mimeType.toLowerCase())) {
			effectiveKind = 'document';
		}

		const messageId = generateId();
		const now = new Date();

		try {
			const result = await sendMedia(tenantId, toPhone, {
				buffer,
				mimeType: data.mimeType,
				fileName: data.fileName ?? `file.${data.mimeType.split('/').pop() ?? 'bin'}`,
				caption: data.caption,
				kind: effectiveKind
			});

			const [existing] = await db
				.select({ id: table.whatsappMessage.id })
				.from(table.whatsappMessage)
				.where(
					and(
						eq(table.whatsappMessage.tenantId, tenantId),
						eq(table.whatsappMessage.wamId, result.wamId)
					)
				)
				.limit(1);

			if (existing) {
				await db
					.update(table.whatsappMessage)
					.set({
						messageType: effectiveKind,
						body: data.caption ?? null,
						mediaPath: result.mediaPath,
						mediaMimeType: data.mimeType,
						mediaFileName: data.fileName ?? null,
						mediaSizeBytes: result.sizeBytes,
						status: 'sent',
						sentAt: now,
						updatedAt: now
					})
					.where(eq(table.whatsappMessage.id, existing.id));
			} else {
				await db.insert(table.whatsappMessage).values({
					id: messageId,
					tenantId,
					sessionId,
					clientId: data.clientId ?? null,
					direction: 'outbound',
					remoteJid: `${toPhone.replace(/^\+/, '')}@s.whatsapp.net`,
					remotePhoneE164: toPhone,
					wamId: result.wamId,
					messageType: effectiveKind,
					body: data.caption ?? null,
					mediaPath: result.mediaPath,
					mediaMimeType: data.mimeType,
					mediaFileName: data.fileName ?? null,
					mediaSizeBytes: result.sizeBytes,
					status: 'sent',
					sentAt: now,
					createdAt: now,
					updatedAt: now
				}).onConflictDoNothing();
			}

			return { ok: true, messageId, wamId: result.wamId, kind: effectiveKind };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			logError('whatsapp', `sendMedia failed: ${message}`, {
				tenantId,
				metadata: { kind: data.kind, size: buffer.length }
			});
			throw new Error(message);
		}
	}
);

export const sendWhatsappMessage = command(
	v.object({
		clientId: v.optional(v.string()),
		to: v.optional(v.string()),
		text: v.pipe(v.string(), v.minLength(1), v.maxLength(4096))
	}),
	async (data) => {
		const { tenantId } = assertTenantMember();

		const sessionId = await loadSessionIdForTenant(tenantId);
		if (!sessionId) throw new Error('WhatsApp nu este conectat. Conectează-l din Settings → WhatsApp.');

		let toPhone: string;
		try {
			if (data.clientId) {
				const [client] = await db
					.select({ phone: table.client.phone })
					.from(table.client)
					.where(and(eq(table.client.id, data.clientId), eq(table.client.tenantId, tenantId)))
					.limit(1);
				if (!client) throw new Error('Client not found');
				if (!client.phone) throw new Error('Clientul nu are număr de telefon');
				toPhone = toE164(client.phone);
			} else if (data.to) {
				toPhone = toE164(data.to);
			} else {
				throw new Error('clientId or to is required');
			}
		} catch (err) {
			if (err instanceof InvalidPhoneError) throw new Error(err.message);
			throw err;
		}

		const messageId = generateId();
		const now = new Date();

		try {
			const wamId = await sendText(tenantId, toPhone, data.text);
			await db.insert(table.whatsappMessage).values({
				id: messageId,
				tenantId,
				sessionId,
				clientId: data.clientId ?? null,
				direction: 'outbound',
				remoteJid: `${toPhone.replace(/^\+/, '')}@s.whatsapp.net`,
				remotePhoneE164: toPhone,
				wamId,
				messageType: 'text',
				body: data.text,
				status: 'sent',
				sentAt: now,
				createdAt: now,
				updatedAt: now
			});
			return { ok: true, messageId, wamId };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			logError('whatsapp', `Send failed: ${message}`, {
				tenantId,
				metadata: { clientId: data.clientId, toPhone }
			});
			throw new Error(message);
		}
	}
);

export const listWhatsappConversations = query(async () => {
	const { tenantId } = assertTenantMember();

	const messages = await db
		.select({
			remotePhoneE164: table.whatsappMessage.remotePhoneE164,
			direction: table.whatsappMessage.direction,
			body: table.whatsappMessage.body,
			messageType: table.whatsappMessage.messageType,
			readAt: table.whatsappMessage.readAt,
			createdAt: table.whatsappMessage.createdAt
		})
		.from(table.whatsappMessage)
		.where(eq(table.whatsappMessage.tenantId, tenantId))
		.orderBy(desc(table.whatsappMessage.createdAt))
		.limit(2000);

	type Conversation = {
		remotePhoneE164: string;
		lastBody: string | null;
		lastDirection: string;
		lastMessageType: string;
		lastAt: Date;
		clientId: string | null;
		clientName: string | null;
		displayName: string | null;
		pushName: string | null;
		unread: number;
	};
	const map = new Map<string, Conversation>();
	for (const m of messages) {
		const existing = map.get(m.remotePhoneE164);
		const isUnread = m.direction === 'inbound' && !m.readAt;
		if (!existing) {
			map.set(m.remotePhoneE164, {
				remotePhoneE164: m.remotePhoneE164,
				lastBody: m.body,
				lastDirection: m.direction,
				lastMessageType: m.messageType,
				lastAt: m.createdAt,
				clientId: null,
				clientName: null,
				displayName: null,
				pushName: null,
				unread: isUnread ? 1 : 0
			});
		} else if (isUnread) {
			existing.unread += 1;
		}
	}

	const conversations = Array.from(map.values());
	if (conversations.length > 0) {
		const clients = await db
			.select({ id: table.client.id, name: table.client.name, phone: table.client.phone })
			.from(table.client)
			.where(eq(table.client.tenantId, tenantId));
		// Index clients by both normalized E.164 (handles +40/0/spaces/dashes variations)
		// and raw-stored phone (fallback for exotic formats toE164 can't parse).
		const phoneToClient = new Map<string, (typeof clients)[number]>();
		for (const c of clients) {
			if (!c.phone) continue;
			const normalized = tryToE164(c.phone);
			if (normalized) phoneToClient.set(normalized, c);
			phoneToClient.set(c.phone, c);
		}

		const contacts = await db
			.select({
				phoneE164: table.whatsappContact.phoneE164,
				displayName: table.whatsappContact.displayName,
				pushName: table.whatsappContact.pushName
			})
			.from(table.whatsappContact)
			.where(eq(table.whatsappContact.tenantId, tenantId));
		const phoneToContact = new Map(contacts.map((c) => [c.phoneE164, c]));

		for (const c of conversations) {
			const client = phoneToClient.get(c.remotePhoneE164);
			if (client) {
				c.clientId = client.id;
				c.clientName = client.name;
			}
			const contact = phoneToContact.get(c.remotePhoneE164);
			if (contact) {
				c.displayName = contact.displayName;
				c.pushName = contact.pushName;
			}
		}
	}

	conversations.sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());
	return { conversations };
});

export const renameWhatsappContact = command(
	v.object({
		phoneE164: v.pipe(v.string(), v.minLength(3)),
		displayName: v.pipe(v.string(), v.maxLength(100))
	}),
	async (data) => {
		const { tenantId } = assertTenantMember();
		const trimmed = data.displayName.trim();
		await setDisplayName(tenantId, data.phoneE164, trimmed || null);
		await listWhatsappConversations().refresh();
		return { ok: true };
	}
);

export const getWhatsappThread = query(v.pipe(v.string(), v.minLength(3)), async (remotePhoneE164) => {
	const { tenantId } = assertTenantMember();

	const rows = await db
		.select({
			id: table.whatsappMessage.id,
			direction: table.whatsappMessage.direction,
			messageType: table.whatsappMessage.messageType,
			body: table.whatsappMessage.body,
			mediaPath: table.whatsappMessage.mediaPath,
			mediaMimeType: table.whatsappMessage.mediaMimeType,
			mediaFileName: table.whatsappMessage.mediaFileName,
			mediaSizeBytes: table.whatsappMessage.mediaSizeBytes,
			status: table.whatsappMessage.status,
			errorMessage: table.whatsappMessage.errorMessage,
			sentAt: table.whatsappMessage.sentAt,
			deliveredAt: table.whatsappMessage.deliveredAt,
			readAt: table.whatsappMessage.readAt,
			receivedAt: table.whatsappMessage.receivedAt,
			createdAt: table.whatsappMessage.createdAt
		})
		.from(table.whatsappMessage)
		.where(
			and(
				eq(table.whatsappMessage.tenantId, tenantId),
				eq(table.whatsappMessage.remotePhoneE164, remotePhoneE164)
			)
		)
		.orderBy(desc(table.whatsappMessage.createdAt))
		.limit(500);

	const variants = phoneE164Variants(remotePhoneE164);
	let [match] = await db
		.select({ id: table.client.id, name: table.client.name })
		.from(table.client)
		.where(and(eq(table.client.tenantId, tenantId), inArray(table.client.phone, variants)))
		.limit(1);
	if (!match) {
		// Fallback: scan tenant clients and normalize each stored phone via toE164.
		// Handles phones stored with spaces/dashes/parens that verbatim variants miss.
		// We don't pre-filter by tail-includes because spaces break digit-sequence matching
		// (e.g. "+40 753 755 327".includes("753755327") is false).
		const candidates = await db
			.select({ id: table.client.id, name: table.client.name, phone: table.client.phone })
			.from(table.client)
			.where(eq(table.client.tenantId, tenantId));
		for (const c of candidates) {
			if (!c.phone) continue;
			if (tryToE164(c.phone) === remotePhoneE164) {
				match = { id: c.id, name: c.name };
				break;
			}
		}
	}

	const [contact] = await db
		.select({
			displayName: table.whatsappContact.displayName,
			pushName: table.whatsappContact.pushName
		})
		.from(table.whatsappContact)
		.where(
			and(
				eq(table.whatsappContact.tenantId, tenantId),
				eq(table.whatsappContact.phoneE164, remotePhoneE164)
			)
		)
		.limit(1);

	return { messages: rows.reverse(), client: match ?? null, contact: contact ?? null };
});

export const markWhatsappConversationRead = command(v.pipe(v.string(), v.minLength(3)), async (remotePhoneE164) => {
	const { tenantId } = assertTenantMember();
	await db
		.update(table.whatsappMessage)
		.set({ readAt: new Date() })
		.where(
			and(
				eq(table.whatsappMessage.tenantId, tenantId),
				eq(table.whatsappMessage.remotePhoneE164, remotePhoneE164),
				eq(table.whatsappMessage.direction, 'inbound')
			)
		);
	await listWhatsappConversations().refresh();
	return { ok: true };
});

export const getWhatsappHistoryForClient = query(v.string(), async (clientId) => {
	const { tenantId } = assertTenantMember();

	const rows = await db
		.select({
			id: table.whatsappMessage.id,
			direction: table.whatsappMessage.direction,
			remotePhoneE164: table.whatsappMessage.remotePhoneE164,
			messageType: table.whatsappMessage.messageType,
			body: table.whatsappMessage.body,
			status: table.whatsappMessage.status,
			errorMessage: table.whatsappMessage.errorMessage,
			sentAt: table.whatsappMessage.sentAt,
			deliveredAt: table.whatsappMessage.deliveredAt,
			readAt: table.whatsappMessage.readAt,
			receivedAt: table.whatsappMessage.receivedAt,
			createdAt: table.whatsappMessage.createdAt
		})
		.from(table.whatsappMessage)
		.where(and(eq(table.whatsappMessage.clientId, clientId), eq(table.whatsappMessage.tenantId, tenantId)))
		.orderBy(desc(table.whatsappMessage.createdAt))
		.limit(200);

	return { messages: rows };
});
