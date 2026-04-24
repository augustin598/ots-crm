import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { isPnUser, type WAMessage } from 'baileys';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { logError, logInfo, logWarning } from '$lib/server/logger';
import { jidToE164, phoneE164Variants } from './phone';
import { detectMedia, downloadAndStoreMedia } from './media-handler';

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

	// Skip non-1:1 chats (groups, broadcasts, status, newsletter)
	if (
		key.remoteJid.endsWith('@g.us') ||
		key.remoteJid.endsWith('@broadcast') ||
		key.remoteJid.endsWith('@newsletter') ||
		key.remoteJid === 'status@broadcast'
	) {
		return null;
	}

	// If already a phone number JID (@s.whatsapp.net), use it
	if (isPnUser(key.remoteJid)) return key.remoteJid;

	// If it's a LID (@lid), try to resolve through senderPn alt JID
	// Baileys exposes alt JIDs on message keys when available
	type KeyWithAlt = typeof key & {
		senderPn?: string | null;
		participantPn?: string | null;
		senderLid?: string | null;
	};
	const keyWithAlt = key as KeyWithAlt;
	const altCandidates: (string | null | undefined)[] = [
		keyWithAlt.senderPn,
		keyWithAlt.participantPn
	];
	for (const candidate of altCandidates) {
		if (candidate && isPnUser(candidate)) return candidate;
	}

	// Unknown/LID without PN available — skip
	return null;
}

export async function handleInbound(
	tenantId: string,
	sessionId: string,
	messages: WAMessage[],
	isHistory = false
): Promise<void> {
	const pushNamesByPhone = new Map<string, string>();

	for (const msg of messages) {
		try {
			if (!msg.key?.id) continue;

			const phoneJid = resolvePhoneJid(msg);
			if (!phoneJid) continue; // LID / group / broadcast — skip

			const messageType = detectMessageType(msg);
			if (!messageType) continue; // protocol/system/unknown — skip

			const wamId = msg.key.id;
			const remoteJid = phoneJid;
			const remotePhoneE164 = jidToE164(remoteJid);

			if (!msg.key.fromMe && msg.pushName && msg.pushName.trim()) {
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
			const clientId = await findClientByPhone(tenantId, remotePhoneE164);
			const timestamp = msg.messageTimestamp
				? new Date(Number(msg.messageTimestamp) * 1000)
				: new Date();

			await db
				.insert(table.whatsappMessage)
				.values({
					id: generateId(),
					tenantId,
					sessionId,
					clientId,
					direction,
					remoteJid,
					remotePhoneE164,
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

			if (!isHistory) {
				logInfo('whatsapp', `Message stored (${direction})`, {
					tenantId,
					metadata: { sessionId, remotePhoneE164, messageType, clientId: clientId ?? null }
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

function mapAckStatus(ack: number | null | undefined): 'sent' | 'delivered' | 'read' | null {
	if (ack == null) return null;
	if (ack >= 4) return 'read';
	if (ack >= 3) return 'read';
	if (ack >= 2) return 'delivered';
	if (ack >= 1) return 'sent';
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
						eq(table.whatsappMessage.wamId, wamId)
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
