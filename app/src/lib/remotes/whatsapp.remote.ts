import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { and, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import {
	startSession,
	stopSession,
	sendText,
	sendTextToJid,
	sendMedia,
	sendMediaToJid,
	getSessionStatus,
	loadSessionIdForTenant
} from '$lib/server/whatsapp/session-manager';
import { getCachedQr } from '$lib/server/whatsapp/qr-broker';
import { setDisplayName } from '$lib/server/whatsapp/contacts-store';
import { enqueueFetch } from '$lib/server/whatsapp/avatar-fetcher';
import { toE164, tryToE164, phoneE164Variants, InvalidPhoneError } from '$lib/server/whatsapp/phone';
import {
	buildMentionLookup,
	isGroupJid,
	resolveMentions,
	splitMentions,
	type BodyPart,
	type GroupClientSuggestion
} from '$lib/server/whatsapp/group-jid';
import {
	fetchGroupAvatar,
	fetchLiveGroups,
	getStoredGroup,
	invalidateWatchedGroups,
	isWatchedGroup,
	listStoredGroupRows,
	setGroupClient,
	setGroupWatched,
	suggestClientsForGroups
} from '$lib/server/whatsapp/group-store';
import { WhatsappNotConnectedError } from '$lib/server/whatsapp/groups';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { logError } from '$lib/server/logger';

const AVATAR_STALE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — retry hidden/failed weekly

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

function assertTenantMember() {
	const event = getRequestEvent();
	// tenantUser required so client-portal users can't reach staff WhatsApp ops (F8).
	if (!event?.locals.user || !event?.locals.tenant || !event?.locals.tenantUser)
		throw new Error('Unauthorized');
	return { userId: event.locals.user.id, tenantId: event.locals.tenant.id };
}

function assertTenantAdmin() {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	const role = event.locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') throw new Error('Insufficient permissions');
	return { userId: event.locals.user.id, tenantId: event.locals.tenant.id };
}

/**
 * Un grup e destinatar valid doar dacă e bifat pentru inbox.
 *
 * Fără verificarea asta, oricine ar putea trimite un mesaj în oricare dintre
 * grupurile contului doar prin JID, inclusiv în cel cu peste o mie de membri.
 */
async function assertWritableGroup(tenantId: string, groupJid: string): Promise<void> {
	if (!(await isWatchedGroup(tenantId, groupJid))) {
		throw new Error('Grupul nu e în lista celor urmărite. Bifează-l întâi din „Grupuri".');
	}
}

type SendTarget = {
	chatType: 'direct' | 'group';
	/** Ce se scrie în `remote_phone_e164`: telefonul la o persoană, JID-ul la grup. */
	chatKey: string;
	remoteJid: string;
	/** Gol la grup, fiindcă un grup n-are un singur număr. */
	toPhone: string | null;
};

/** Unde pleacă mesajul: la un client, la un număr scris de mână sau într-un grup. */
async function resolveSendTarget(
	tenantId: string,
	data: { clientId?: string; to?: string }
): Promise<SendTarget> {
	if (data.to && isGroupJid(data.to)) {
		await assertWritableGroup(tenantId, data.to);
		return { chatType: 'group', chatKey: data.to, remoteJid: data.to, toPhone: null };
	}

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

	return {
		chatType: 'direct',
		chatKey: toPhone,
		remoteJid: `${toPhone.replace(/^\+/, '')}@s.whatsapp.net`,
		toPhone
	};
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

		const target = await resolveSendTarget(tenantId, data);

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
			const payload = {
				buffer,
				mimeType: data.mimeType,
				fileName: data.fileName ?? `file.${data.mimeType.split('/').pop() ?? 'bin'}`,
				caption: data.caption,
				kind: effectiveKind
			};
			const result = target.toPhone
				? await sendMedia(tenantId, target.toPhone, payload)
				: await sendMediaToJid(tenantId, target.remoteJid, payload);

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
					clientId: target.chatType === 'group' ? null : (data.clientId ?? null),
					direction: 'outbound',
					remoteJid: target.remoteJid,
					remotePhoneE164: target.chatKey,
					chatType: target.chatType,
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

		const target = await resolveSendTarget(tenantId, data);

		const messageId = generateId();
		const now = new Date();

		try {
			const wamId = target.toPhone
				? await sendText(tenantId, target.toPhone, data.text)
				: await sendTextToJid(tenantId, target.remoteJid, data.text);
			// Baileys ne întoarce mesajul propriu prin `messages.upsert` aproape
			// instantaneu, deci rândul poate exista deja. Fără asta, indexul unic pe
			// (tenant, wam_id) ar arunca o eroare peste un mesaj trimis cu succes.
			await db.insert(table.whatsappMessage).values({
				id: messageId,
				tenantId,
				sessionId,
				clientId: target.chatType === 'group' ? null : (data.clientId ?? null),
				direction: 'outbound',
				remoteJid: target.remoteJid,
				remotePhoneE164: target.chatKey,
				chatType: target.chatType,
				wamId,
				messageType: 'text',
				body: data.text,
				status: 'sent',
				sentAt: now,
				createdAt: now,
				updatedAt: now
			}).onConflictDoNothing();
			return { ok: true, messageId, wamId };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			logError('whatsapp', `Send failed: ${message}`, {
				tenantId,
				metadata: { clientId: data.clientId, chatKey: target.chatKey }
			});
			throw new Error(message);
		}
	}
);

/**
 * Conversațiile din inbox, cele unu-la-unu și grupurile urmărite laolaltă.
 *
 * Ultimul mesaj se ia cu o funcție de fereastră, câte un rând pe conversație, nu
 * prin citirea ultimelor câteva mii de mesaje ale tenantului. Cu vechea metodă,
 * un grup vorbăreț umplea singur fereastra și scotea din listă conversațiile 1:1
 * mai vechi. Necititele se numără separat, tot pe grupuri, într-o singură cerere.
 */
export const listWhatsappConversations = query(async () => {
	const { tenantId } = assertTenantMember();

	const ranked = db.$with('ranked').as(
		db
			.select({
				chatKey: table.whatsappMessage.remotePhoneE164,
				chatType: table.whatsappMessage.chatType,
				direction: table.whatsappMessage.direction,
				body: table.whatsappMessage.body,
				messageType: table.whatsappMessage.messageType,
				senderPushName: table.whatsappMessage.senderPushName,
				senderPhoneE164: table.whatsappMessage.senderPhoneE164,
				createdAt: table.whatsappMessage.createdAt,
				rn: sql<number>`row_number() over (partition by ${table.whatsappMessage.remotePhoneE164} order by ${table.whatsappMessage.createdAt} desc, ${table.whatsappMessage.id} desc)`.as(
					'rn'
				)
			})
			.from(table.whatsappMessage)
			.where(eq(table.whatsappMessage.tenantId, tenantId))
	);

	const lastMessages = await db
		.with(ranked)
		.select({
			chatKey: ranked.chatKey,
			chatType: ranked.chatType,
			direction: ranked.direction,
			body: ranked.body,
			messageType: ranked.messageType,
			senderPushName: ranked.senderPushName,
			senderPhoneE164: ranked.senderPhoneE164,
			createdAt: ranked.createdAt
		})
		.from(ranked)
		.where(eq(ranked.rn, 1))
		.orderBy(desc(ranked.createdAt));

	const unreadRows = await db
		.select({
			chatKey: table.whatsappMessage.remotePhoneE164,
			unread: count()
		})
		.from(table.whatsappMessage)
		.where(
			and(
				eq(table.whatsappMessage.tenantId, tenantId),
				eq(table.whatsappMessage.direction, 'inbound'),
				isNull(table.whatsappMessage.readAt)
			)
		)
		.groupBy(table.whatsappMessage.remotePhoneE164);
	const unreadByChat = new Map(unreadRows.map((r) => [r.chatKey, r.unread]));

	type Conversation = {
		chatKey: string;
		chatType: string;
		lastBody: string | null;
		lastDirection: string;
		lastMessageType: string;
		lastSenderName: string | null;
		/** Gol la un grup abia bifat, în care încă n-a scris nimeni. */
		lastAt: Date | null;
		clientId: string | null;
		clientName: string | null;
		displayName: string | null;
		pushName: string | null;
		subject: string | null;
		participantCount: number | null;
		unread: number;
	};

	const conversations: Conversation[] = lastMessages.map((m) => ({
		chatKey: m.chatKey,
		chatType: m.chatType,
		lastBody: m.body,
		lastDirection: m.direction,
		lastMessageType: m.messageType,
		lastSenderName: m.senderPushName ?? m.senderPhoneE164 ?? null,
		lastAt: m.createdAt,
		clientId: null,
		clientName: null,
		displayName: null,
		pushName: null,
		subject: null,
		participantCount: null,
		unread: unreadByChat.get(m.chatKey) ?? 0
	}));

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
	const clientById = new Map(clients.map((c) => [c.id, c]));

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
	const phoneToContact = new Map(contacts.map((c) => [c.phoneE164, c]));

	// Toate grupurile stocate, nu doar cele bifate: o conversație rămasă în listă
	// după debifare trebuie să-și păstreze numele, nu să devină „Grup".
	const groupRows = await listStoredGroupRows(tenantId);
	const groupByJid = new Map(groupRows.map((g) => [g.groupJid, g]));

	// Un grup abia bifat n-are încă niciun mesaj. Fără rândul ăsta ar părea că
	// bifarea n-a făcut nimic, până scrie cineva.
	const withMessages = new Set(conversations.map((c) => c.chatKey));
	for (const g of groupRows) {
		if (!g.watched) continue; // debifat: rămâne doar dacă are deja mesaje
		if (withMessages.has(g.groupJid)) continue;
		conversations.push({
			chatKey: g.groupJid,
			chatType: 'group',
			lastBody: null,
			lastDirection: 'inbound',
			lastMessageType: 'text',
			lastSenderName: null,
			lastAt: null,
			clientId: null,
			clientName: null,
			displayName: null,
			pushName: null,
			subject: null,
			participantCount: null,
			unread: 0
		});
	}

	if (conversations.length === 0) return { conversations };

	const now = Date.now();
	for (const c of conversations) {
		if (c.chatType === 'group') {
			const group = groupByJid.get(c.chatKey);
			// Grup debifat între timp: îi păstrăm firul, dar fără subiect n-avem ce arăta.
			c.subject = group?.subject || 'Grup';
			c.participantCount = group?.participantCount ?? null;
			const client = group?.clientId ? clientById.get(group.clientId) : null;
			if (client) {
				c.clientId = client.id;
				c.clientName = client.name;
			}
			// Aceeași traducere de mențiuni ca în fir, altfel previzualizarea arată cifre.
			if (group?.participantsJson?.length) {
				const lookup = buildMentionLookup(
					group.participantsJson,
					(phone) => phoneToContact.get(phone)?.displayName ?? phoneToContact.get(phone)?.pushName ?? null
				);
				c.lastBody = resolveMentions(c.lastBody, lookup);
			}
			continue;
		}

		const client = phoneToClient.get(c.chatKey);
		if (client) {
			c.clientId = client.id;
			c.clientName = client.name;
		}
		const contact = phoneToContact.get(c.chatKey);
		if (contact) {
			c.displayName = contact.displayName;
			c.pushName = contact.pushName;
		}

		// Avatarul se cere doar pentru persoane: pe grupuri îl aducem o dată, la bifare.
		if (contact?.avatarPath) continue;
		const hidden = contact?.avatarHidden ?? false;
		const fetchedAt = contact?.avatarFetchedAt?.getTime() ?? 0;
		if (hidden && now - fetchedAt < AVATAR_STALE_MS) continue;
		enqueueFetch(tenantId, c.chatKey);
	}

	// Grupurile fără niciun mesaj cad la coadă, nu în capul listei.
	conversations.sort((a, b) => (b.lastAt?.getTime() ?? 0) - (a.lastAt?.getTime() ?? 0));

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

/**
 * Firul unei conversații. `chatKey` e telefonul la o persoană și JID-ul la un
 * grup, adică exact ce ține coloana `remote_phone_e164`.
 */
export const getWhatsappThread = query(v.pipe(v.string(), v.minLength(3)), async (chatKey) => {
	const { tenantId } = assertTenantMember();

	const rows = await db
		.select({
			id: table.whatsappMessage.id,
			direction: table.whatsappMessage.direction,
			messageType: table.whatsappMessage.messageType,
			body: table.whatsappMessage.body,
			senderPushName: table.whatsappMessage.senderPushName,
			senderPhoneE164: table.whatsappMessage.senderPhoneE164,
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
				eq(table.whatsappMessage.remotePhoneE164, chatKey)
			)
		)
		.orderBy(desc(table.whatsappMessage.createdAt))
		.limit(500);

	if (isGroupJid(chatKey)) {
		const group = await getStoredGroup(tenantId, chatKey);

		// „@84027092512961" devine „@Iulia Mitu": LID-ul vine din fotografia
		// membrilor, numele din contacte. Textul stocat rămâne neatins.
		const participants = group?.participantsJson ?? [];
		const phones = participants.map((p) => p.phone).filter((p): p is string => !!p);
		const nameByPhone = new Map<string, string>();
		if (phones.length > 0) {
			const contacts = await db
				.select({
					phoneE164: table.whatsappContact.phoneE164,
					displayName: table.whatsappContact.displayName,
					pushName: table.whatsappContact.pushName
				})
				.from(table.whatsappContact)
				.where(
					and(
						eq(table.whatsappContact.tenantId, tenantId),
						inArray(table.whatsappContact.phoneE164, phones)
					)
				);
			for (const c of contacts) {
				const name = c.displayName ?? c.pushName;
				if (name) nameByPhone.set(c.phoneE164, name);
			}
		}
		// Numele văzute chiar în firul ăsta acoperă membrii fără rând de contact.
		for (const r of rows) {
			if (r.senderPhoneE164 && r.senderPushName && !nameByPhone.has(r.senderPhoneE164)) {
				nameByPhone.set(r.senderPhoneE164, r.senderPushName);
			}
		}
		const lookup = buildMentionLookup(participants, (phone) => nameByPhone.get(phone) ?? null);
		const messages = rows
			.reverse()
			.map((r) => ({ ...r, bodyParts: splitMentions(r.body, lookup) }));

		let groupClient: { id: string; name: string } | null = null;
		if (group?.clientId) {
			const [row] = await db
				.select({ id: table.client.id, name: table.client.name })
				.from(table.client)
				.where(and(eq(table.client.id, group.clientId), eq(table.client.tenantId, tenantId)))
				.limit(1);
			groupClient = row ?? null;
		}
		return {
			messages,
			client: groupClient,
			contact: null,
			group: group
				? {
						subject: group.subject,
						participantCount: group.participantCount,
						watched: group.watched
					}
				: null
		};
	}

	const variants = phoneE164Variants(chatKey);
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
			if (tryToE164(c.phone) === chatKey) {
				match = { id: c.id, name: c.name };
				break;
			}
		}
	}

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
				eq(table.whatsappContact.phoneE164, chatKey)
			)
		)
		.limit(1);

	return {
		messages: rows.reverse().map((r) => ({ ...r, bodyParts: null as BodyPart[] | null })),
		client: match ?? null,
		contact: contact ?? null,
		group: null
	};
});

export const markWhatsappConversationRead = command(v.pipe(v.string(), v.minLength(3)), async (chatKey) => {
	const { tenantId } = assertTenantMember();
	await db
		.update(table.whatsappMessage)
		.set({ readAt: new Date() })
		.where(
			and(
				eq(table.whatsappMessage.tenantId, tenantId),
				eq(table.whatsappMessage.remotePhoneE164, chatKey),
				eq(table.whatsappMessage.direction, 'inbound'),
				isNull(table.whatsappMessage.readAt)
			)
		);
	await listWhatsappConversations().refresh();
	return { ok: true };
});

/**
 * Grupurile contului, cu starea lor din CRM și cu clientul propus.
 *
 * Metadatele se cer de la WhatsApp printr-un cache scurt, deci redeschiderea
 * dialogului nu generează trafic nou. Fără sesiune activă pe instanța asta,
 * întoarcem doar ce e deja stocat, ca dialogul să rămână folosibil.
 */
export const listWhatsappGroups = query(async () => {
	const { tenantId } = assertTenantMember();
	// Citirea listei e la nivel de echipă: nu scoate numere de telefon, doar nume
	// și câți membri are fiecare grup. Bifarea rămâne la admin, fiindcă schimbă ce
	// se stochează.
	const role = getRequestEvent()?.locals.tenantUser?.role;
	const canEdit = role === 'owner' || role === 'admin';

	const storedRows = await db
		.select({
			groupJid: table.whatsappGroup.groupJid,
			subject: table.whatsappGroup.subject,
			participantCount: table.whatsappGroup.participantCount,
			watched: table.whatsappGroup.watched,
			clientId: table.whatsappGroup.clientId
		})
		.from(table.whatsappGroup)
		.where(eq(table.whatsappGroup.tenantId, tenantId));
	const storedByJid = new Map(storedRows.map((g) => [g.groupJid, g]));

	let live: Awaited<ReturnType<typeof fetchLiveGroups>> = [];
	let liveError: string | null = null;
	try {
		live = await fetchLiveGroups(tenantId);
	} catch (err) {
		liveError =
			err instanceof WhatsappNotConnectedError
				? 'WhatsApp nu e conectat pe această instanță. Vezi doar grupurile salvate deja.'
				: err instanceof Error
					? err.message
					: String(err);
	}

	const suggestions =
		live.length > 0
			? await suggestClientsForGroups(tenantId, live)
			: new Map<string, GroupClientSuggestion>();

	const clientOptions = await db
		.select({ id: table.client.id, name: table.client.name })
		.from(table.client)
		.where(eq(table.client.tenantId, tenantId))
		.orderBy(table.client.name);
	const clientNames = new Map(clientOptions.map((c) => [c.id, c.name]));

	const groups = live.map((g) => {
		const stored = storedByJid.get(g.id);
		return {
			jid: g.id,
			subject: g.subject || 'Grup fără nume',
			size: g.size,
			membersWithPhone: g.members.filter((m) => m.phone).length,
			watched: stored?.watched ?? false,
			clientId: stored?.clientId ?? null,
			clientName: stored?.clientId ? (clientNames.get(stored.clientId) ?? null) : null,
			suggestion: suggestions.get(g.id) ?? null,
			live: true
		};
	});

	// Grupurile salvate pe care WhatsApp nu le mai raportează: contul a fost scos
	// sau sesiunea e pe altă instanță. Rămân în listă ca să poată fi debifate.
	const liveJids = new Set(live.map((g) => g.id));
	for (const stored of storedRows) {
		if (liveJids.has(stored.groupJid)) continue;
		groups.push({
			jid: stored.groupJid,
			subject: stored.subject || 'Grup fără nume',
			size: stored.participantCount,
			membersWithPhone: 0,
			watched: stored.watched,
			clientId: stored.clientId,
			clientName: stored.clientId ? (clientNames.get(stored.clientId) ?? null) : null,
			suggestion: null,
			live: false
		});
	}

	groups.sort((a, b) => {
		if (a.watched !== b.watched) return a.watched ? -1 : 1;
		return a.subject.localeCompare(b.subject, 'ro');
	});

	return { groups, clients: clientOptions, canEdit, error: liveError };
});

export const setWhatsappGroupWatched = command(
	v.object({
		groupJid: v.pipe(v.string(), v.minLength(5)),
		watched: v.boolean()
	}),
	async (data) => {
		const { tenantId } = assertTenantAdmin();

		const live = await fetchLiveGroups(tenantId).catch(() => []);
		const summary = live.find((g) => g.id === data.groupJid);

		if (summary) {
			await setGroupWatched(tenantId, summary, data.watched);
		} else {
			// Fără metadate proaspete putem doar să schimbăm un rând existent. Bifarea
			// unui grup nou are nevoie de participanți, deci cere o sesiune activă.
			const stored = await getStoredGroup(tenantId, data.groupJid);
			if (!stored) {
				throw new Error(
					'WhatsApp nu e conectat pe această instanță, deci nu pot citi datele grupului.'
				);
			}
			await db
				.update(table.whatsappGroup)
				.set({ watched: data.watched, updatedAt: new Date() })
				.where(eq(table.whatsappGroup.id, stored.id));
			invalidateWatchedGroups(tenantId);
		}

		if (data.watched && summary) {
			// O singură cerere de poză per grup, la bifare. Eșecul nu contează.
			await fetchGroupAvatar(tenantId, data.groupJid).catch(() => {});
		}

		await listWhatsappGroups().refresh();
		await listWhatsappConversations().refresh();
		return { ok: true };
	}
);

export const setWhatsappGroupClient = command(
	v.object({
		groupJid: v.pipe(v.string(), v.minLength(5)),
		clientId: v.nullable(v.string())
	}),
	async (data) => {
		const { tenantId } = assertTenantAdmin();

		if (data.clientId) {
			const [client] = await db
				.select({ id: table.client.id })
				.from(table.client)
				.where(and(eq(table.client.id, data.clientId), eq(table.client.tenantId, tenantId)))
				.limit(1);
			if (!client) throw new Error('Clientul nu există în acest tenant');
		}

		await setGroupClient(tenantId, data.groupJid, data.clientId);
		await listWhatsappGroups().refresh();
		await listWhatsappConversations().refresh();
		return { ok: true };
	}
);

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
