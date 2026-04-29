// Handles inbound Telegram webhook updates — currently only /start <linkCode> for pairing.

import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, gte, sql } from 'drizzle-orm';
import { logInfo, logWarning, logError, serializeError } from '$lib/server/logger';
import { sendTelegramToChatId } from './sender';

interface TelegramMessage {
	chat?: { id?: number | string };
	from?: { username?: string };
	text?: string;
}

interface TelegramUpdate {
	message?: TelegramMessage;
}

const START_REGEX = /^\/start\s+([A-Za-z0-9_-]{6,64})\s*$/;

export async function handleTelegramUpdate(update: TelegramUpdate): Promise<void> {
	const msg = update.message;
	if (!msg?.text || !msg.chat?.id) return;

	const match = msg.text.trim().match(START_REGEX);
	if (!match) {
		// Friendly fallback for plain "/start" or other messages
		if (msg.text.trim() === '/start') {
			await sendTelegramToChatId(
				String(msg.chat.id),
				'Conectează-te din OTS CRM: Settings → Notificări → Conectează Telegram. Vei primi un link de tip `/start <cod>` care leagă acest cont.'
			);
		}
		return;
	}

	const linkCode = match[1]!;
	const chatId = String(msg.chat.id);
	const username = msg.from?.username ?? null;

	try {
		const [link] = await db
			.select()
			.from(table.userTelegramLink)
			.where(eq(table.userTelegramLink.linkCode, linkCode))
			.limit(1);

		if (!link) {
			await sendTelegramToChatId(chatId, 'Cod invalid sau expirat. Generează unul nou din OTS CRM.');
			logWarning('telegram', `webhook: linkCode not found: ${linkCode.slice(0, 6)}…`);
			return;
		}

		if (link.expiresAt.getTime() < Date.now()) {
			await sendTelegramToChatId(chatId, 'Codul a expirat. Generează unul nou din OTS CRM.');
			return;
		}

		if (link.linkedAt) {
			await sendTelegramToChatId(chatId, 'Acest cod a fost deja folosit. Generează altul dacă dorești să te re-conectezi.');
			return;
		}

		await db
			.update(table.userTelegramLink)
			.set({
				telegramChatId: chatId,
				telegramUsername: username,
				linkedAt: new Date()
			})
			.where(eq(table.userTelegramLink.id, link.id));

		await sendTelegramToChatId(
			chatId,
			'✅ Conectat! Vei primi alerte de la OTS CRM atunci când deviațiile depășesc pragul.'
		);

		logInfo('telegram', `webhook: linked user=${link.userId} tenant=${link.tenantId} chatId=${chatId}`);
	} catch (e) {
		logError('telegram', `webhook handle failed: ${serializeError(e).message}`);
	}
}
