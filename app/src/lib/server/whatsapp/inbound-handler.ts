import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { isPnUser, type WAMessage } from 'baileys';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { logError, logInfo, logWarning } from '$lib/server/logger';
import { jidToE164, phoneE164Variants } from './phone';
import { detectMedia, downloadAndStoreMedia } from './media-handler';
import { isGroupJid, isIgnorableChatJid, resolveGroupSender } from './group-jid';
import { isWatchedGroup, participantPhoneLookup } from './group-store';

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

function extractText(msg: WAMessage): string | null {
	const m = msg.message;
	if (!m) return null;
	if (m.conversation) return m.conversation;
	if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
	if (m.imageMessage?.caption) return m.imageMessage.caption;
	if (m.videoMessage?.caption) return m.videoMessage.caption;
	if (m.documentMessage?.caption) return m.documentMessage.caption;
	if (m.ephemeralMessage?.message) return extractText({ ...msg, message: m.ephemeralMessage.message });
	if (m.viewOnceMessage?.message) return extractText({ ...msg, message: m.viewOnceMessage.message });
	if (m.viewOnceMessageV2?.message) return extractText({ ...msg, message: m.viewOnceMessageV2.message });
	if (m.documentWithCaptionMessage?.message) return extractText({ ...msg, message: m.documentWithCaptionMessage.message });
	return null;
}

function unwrapMessage(msg: WAMessage): WAMessage {
	const m = msg.message;
	if (!m) return msg;
	if (m.ephemeralMessage?.message) return unwrapMessage({ ...msg, message: m.ephemeralMessage.message });
	if (m.viewOnceMessage?.message) return unwrapMessage({ ...msg, message: m.viewOnceMessage.message });
	if (m.viewOnceMessageV2?.message) return unwrapMessage({ ...msg, message: m.viewOnceMessageV2.message });
	return msg;
}

function detectMessageType(msg: WAMessage): string | null {
	const m = unwrapMessage(msg).message;
	if (!m) return null;
	if (m.conversation || m.extendedTextMessage) return 'text';
	if (m.imageMessage) return 'image';
	if (m.videoMessage) return 'video';
	if (m.audioMessage) return 'audio';
	if (m.documentMessage || m.documentWithCaptionMessage) return 'document';
	if (m.stickerMessage) return 'sticker';
	if (m.locationMessage) return 'location';
	if (m.contactMessage || m.contactsArrayMessage) return 'contact';
	if (m.pollCreationMessage || m.pollCreationMessageV2 || m.pollCreationMessageV3) return 'poll';
	if (m.reactionMessage) return 'reaction';
	// Protocol/system messages — skip
	if (
		m.protocolMessage ||
		m.senderKeyDistributionMessage ||
		m.messageContextInfo ||
		m.deviceSentMessage ||
		m.fastRatchetKeySenderKeyDistributionMessage
	) {
		return null;
	}
	return null;
}

async function findClientByPhone(tenantId: string, phoneE164: string): Promise<string | null> {
	const variants = phoneE164Variants(phoneE164);
	const [row] = await db
		.select({ id: table.client.id })
		.from(table.client)
		.where(and(eq(table.client.tenantId, tenantId), inArray(table.client.phone, variants)))
		.limit(1);
	return row?.id ?? null;
}

function resolvePhoneJid(msg: WAMessage): string | null {
	const key = msg.key;
	if (!key?.remoteJid) return null;

	// Grupurile au propria cale, în handleInbound. Aici rămân doar difuzările,
	// canalele și „status@broadcast", care n-au firul unei conversații.
	if (isGroupJid(key.remoteJid) || isIgnorableChatJid(key.remoteJid)) return null;

	// If already a phone number JID (@s.whatsapp.net), use it
	if (isPnUser(key.remoteJid)) return key.remoteJid;

	// Conversație adresată pe LID („84027092512961@lid"). Baileys pune numărul
	// alături, pe `remoteJidAlt` la unu-la-unu și pe `participantAlt` la grup
	// (`Utils/decode-wa-message.js`). Numele vechi, `senderPn` și `participantPn`,
	// nu există pe cheia mesajului în Baileys 7: sunt câmpuri ale evenimentului
	// „group.join-request", deci ramura asta nu rezolva niciodată nimic și
	// conversațiile pe LID se pierdeau tăcut.
	const altCandidates: (string | null | undefined)[] = [key.remoteJidAlt, key.participantAlt];
	for (const candidate of altCandidates) {
		if (candidate && isPnUser(candidate)) return candidate;
	}

	// LID fără număr alăturat — nu avem cum să legăm conversația de cineva
	return null;
}

export async function handleInbound(
	tenantId: string,
	sessionId: string,
	messages: WAMessage[],
	isHistory = false
): Promise<void> {
	const pushNamesByPhone = new Map<string, string>();
	// Traducerea LID → telefon se ia o dată pe grup, nu pe mesaj.
	const senderLookups = new Map<string, (rawId: string) => string | null>();

	for (const msg of messages) {
		try {
			if (!msg.key?.id) continue;

			const chatJid = msg.key.remoteJid ?? null;
			if (!chatJid || isIgnorableChatJid(chatJid)) continue; // difuzări, canale, status

			const isGroup = isGroupJid(chatJid);
			// Grupurile nebifate se aruncă aici: nu ajung în bază și nu descarcă media.
			if (isGroup && !(await isWatchedGroup(tenantId, chatJid))) continue;

			let remoteJid: string;
			let remotePhoneE164: string;
			let sender: ReturnType<typeof resolveGroupSender> = {
				jid: null,
				phoneE164: null,
				pushName: null
			};

			if (isGroup) {
				// `remote_phone_e164` ține adresa conversației, iar la grup aceea e JID-ul.
				remoteJid = chatJid;
				remotePhoneE164 = chatJid;
				let lookup = senderLookups.get(chatJid);
				if (!lookup) {
					lookup = await participantPhoneLookup(tenantId, chatJid);
					senderLookups.set(chatJid, lookup);
				}
				sender = resolveGroupSender(msg, lookup);
			} else {
				const phoneJid = resolvePhoneJid(msg);
				if (!phoneJid) continue; // LID fără număr — skip
				remoteJid = phoneJid;
				remotePhoneE164 = jidToE164(remoteJid);
			}

			const messageType = detectMessageType(msg);
			if (!messageType) continue; // protocol/system/unknown — skip

			const wamId = msg.key.id;

			if (!isGroup && !msg.key.fromMe && msg.pushName && msg.pushName.trim()) {
				pushNamesByPhone.set(remotePhoneE164, msg.pushName.trim());
			}

			const mediaInfo = detectMedia(msg);
			let mediaPath: string | null = null;
			let mediaSize: number | null = null;
			let mediaMime: string | null = null;
			let mediaFileName: string | null = null;
			let existingRowId: string | null = null;
			if (mediaInfo) {
				mediaMime = mediaInfo.mimeType;
				mediaFileName = mediaInfo.fileName;
				const existing = await db
					.select({ id: table.whatsappMessage.id, mediaPath: table.whatsappMessage.mediaPath })
					.from(table.whatsappMessage)
					.where(
						and(
							eq(table.whatsappMessage.tenantId, tenantId),
							eq(table.whatsappMessage.wamId, wamId)
						)
					)
					.limit(1);
				if (existing[0]) {
					existingRowId = existing[0].id;
					if (existing[0].mediaPath) {
						mediaPath = existing[0].mediaPath;
					}
				}
				if (!mediaPath) {
					const stored = await downloadAndStoreMedia(tenantId, msg, mediaInfo);
					if (stored) {
						mediaPath = stored.path;
						mediaSize = stored.sizeBytes;
					}
				}

				// Retroactively UPDATE row if we just got mediaPath but row already existed (old history)
				if (existingRowId && mediaPath) {
					await db
						.update(table.whatsappMessage)
						.set({
							mediaPath,
							mediaMimeType: mediaMime,
							mediaFileName,
							mediaSizeBytes: mediaSize,
							updatedAt: new Date()
						})
						.where(eq(table.whatsappMessage.id, existingRowId));
				}
			}
			const body = extractText(msg);
			const fromMe = !!msg.key.fromMe;
			const direction = fromMe ? 'outbound' : 'inbound';
			// La grup nu legăm mesajul de client: fișa clientului arată conversația
			// unu-la-unu, iar un grup poate ține oameni de la mai mulți clienți.
			// Legătura grup → client stă pe `whatsapp_group.client_id`.
			const clientId = isGroup ? null : await findClientByPhone(tenantId, remotePhoneE164);
			const timestamp = msg.messageTimestamp
				? new Date(Number(msg.messageTimestamp) * 1000)
				: new Date();

			const inserted = await db
				.insert(table.whatsappMessage)
				.values({
					id: generateId(),
					tenantId,
					sessionId,
					clientId,
					direction,
					remoteJid,
					remotePhoneE164,
					chatType: isGroup ? 'group' : 'direct',
					senderJid: sender.jid,
					senderPhoneE164: sender.phoneE164,
					senderPushName: sender.pushName,
					wamId,
					messageType,
					body: body ?? null,
					mediaPath,
					mediaMimeType: mediaMime,
					mediaFileName,
					mediaSizeBytes: mediaSize,
					status: fromMe ? 'sent' : 'read',
					sentAt: fromMe ? timestamp : null,
					receivedAt: fromMe ? null : timestamp,
					createdAt: timestamp,
					updatedAt: new Date()
				})
				.onConflictDoNothing();

			// Comanda „/task …" se execută o singură dată per mesaj: dacă rândul
			// exista deja (Baileys livrează același `wamId` și cu type `append`,
			// și la reconectare), insertul nu afectează nimic și sărim.
			const isNewRow = (inserted as { rowsAffected?: number })?.rowsAffected !== 0;
			if (isGroup && !isHistory && !fromMe && isNewRow) {
				try {
					const { handleTaskCommand } = await import('./task-command');
					await handleTaskCommand({
						tenantId,
						groupJid: chatJid,
						senderPhoneE164: sender.phoneE164,
						wamId,
						body
					});
				} catch (err) {
					// O comandă picată nu trebuie să oprească procesarea mesajului.
					logError('whatsapp', 'handleTaskCommand failed', {
						tenantId,
						metadata: { err: err instanceof Error ? err.message : String(err), wamId }
					});
				}
			}

			if (!isHistory) {
				logInfo('whatsapp', `Message stored (${direction})`, {
					tenantId,
					metadata: {
						sessionId,
						remotePhoneE164,
						chatType: isGroup ? 'group' : 'direct',
						messageType,
						clientId: clientId ?? null
					}
				});
			}
		} catch (err) {
			logError('whatsapp', 'Failed to handle message', {
				tenantId,
				metadata: { err: err instanceof Error ? err.message : String(err) }
			});
		}
	}

	if (pushNamesByPhone.size > 0) {
		await persistPushNamesFromMessages(tenantId, pushNamesByPhone).catch((err) => {
			logError('whatsapp', 'Failed to persist pushNames', {
				tenantId,
				metadata: { err: err instanceof Error ? err.message : String(err) }
			});
		});
	}
}

async function persistPushNamesFromMessages(tenantId: string, map: Map<string, string>): Promise<void> {
	for (const [phoneE164, name] of map) {
		const [existing] = await db
			.select({ id: table.whatsappContact.id, pushName: table.whatsappContact.pushName })
			.from(table.whatsappContact)
			.where(
				and(
					eq(table.whatsappContact.tenantId, tenantId),
					eq(table.whatsappContact.phoneE164, phoneE164)
				)
			)
			.limit(1);

		if (existing) {
			if (existing.pushName !== name) {
				await db
					.update(table.whatsappContact)
					.set({ pushName: name, updatedAt: new Date() })
					.where(eq(table.whatsappContact.id, existing.id));
			}
		} else {
			await db
				.insert(table.whatsappContact)
				.values({
					id: generateId(),
					tenantId,
					phoneE164,
					pushName: name,
					createdAt: new Date(),
					updatedAt: new Date()
				})
				.onConflictDoNothing();
		}
	}
}

const STATUS_RANK: Record<'sent' | 'delivered' | 'read', number> = {
	sent: 2,
	delivered: 3,
	read: 4
};

/** Aceeași scară, calculată în SQLite, ca să nu mai citim rândul înainte de update. */
const STATUS_RANK_SQL = sql<number>`CASE ${table.whatsappMessage.status} WHEN 'read' THEN 4 WHEN 'delivered' THEN 3 WHEN 'sent' THEN 2 WHEN 'pending' THEN 1 ELSE 0 END`;

/**
 * Confirmarea WhatsApp → starea noastră.
 *
 * Scara e cea din `proto.WebMessageInfo.Status`: 0 eroare, 1 în așteptare,
 * 2 ajuns la server, 3 livrat, 4 citit, 5 redat. Vechea variantă era decalată cu
 * unu (trata 2 ca „livrat" și 3 ca „citit"), deci un mesaj doar livrat apărea
 * citit, iar `readAt` primea ora livrării.
 */
function mapAckStatus(ack: number | null | undefined): 'sent' | 'delivered' | 'read' | null {
	if (ack == null) return null;
	if (ack >= 4) return 'read';
	if (ack === 3) return 'delivered';
	if (ack === 2) return 'sent';
	return null;
}

export async function handleMessageUpdate(
	tenantId: string,
	updates: Array<{ key: { id?: string | null; remoteJid?: string | null }; update: { status?: number | null } }>
): Promise<void> {
	for (const upd of updates) {
		const wamId = upd.key?.id;
		if (!wamId) continue;
		const status = mapAckStatus(upd.update?.status);
		if (!status) continue;

		const patch: Partial<typeof table.whatsappMessage.$inferInsert> = {
			status,
			updatedAt: new Date()
		};
		if (status === 'delivered') patch.deliveredAt = new Date();
		if (status === 'read') patch.readAt = new Date();

		try {
			await db
				.update(table.whatsappMessage)
				.set(patch)
				.where(
					and(
						eq(table.whatsappMessage.tenantId, tenantId),
						eq(table.whatsappMessage.wamId, wamId),
						// Într-un grup confirmările vin separat de la fiecare participant, în
						// orice ordine. Fără condiția asta, un „livrat" întârziat ar coborî un
						// mesaj deja citit și am scrie în bază la fiecare confirmare.
						lt(STATUS_RANK_SQL, STATUS_RANK[status])
					)
				);
		} catch (err) {
			logWarning('whatsapp', 'Failed to update ack status', {
				tenantId,
				metadata: { wamId, err: err instanceof Error ? err.message : String(err) }
			});
		}
	}
}
