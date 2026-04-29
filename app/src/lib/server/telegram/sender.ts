// Telegram client — global bot, per-user chat linking via /start <code>.
// Single TELEGRAM_BOT_TOKEN env var; per-user chatId stored in user_telegram_link.

import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { logError, logWarning, logInfo, serializeError } from '$lib/server/logger';

const TELEGRAM_API = 'https://api.telegram.org';
const FETCH_TIMEOUT_MS = 10_000;

export interface SendArgs {
	tenantId: string;
	userId: string;
	text: string;
	parseMode?: 'MarkdownV2' | 'Markdown' | 'HTML';
}

export type SendResult =
	| { ok: true }
	| { ok: false; reason: 'no_token' | 'not_linked' | 'fetch_failed' | 'api_error'; detail?: string };

function getBotToken(): string | null {
	const token = env.TELEGRAM_BOT_TOKEN;
	if (!token || token.trim().length === 0) return null;
	return token.trim();
}

export async function sendTelegramMessage(args: SendArgs): Promise<SendResult> {
	const token = getBotToken();
	if (!token) {
		logWarning('telegram', 'TELEGRAM_BOT_TOKEN not configured — skipping send');
		return { ok: false, reason: 'no_token' };
	}

	const [link] = await db
		.select({ telegramChatId: table.userTelegramLink.telegramChatId })
		.from(table.userTelegramLink)
		.where(
			and(
				eq(table.userTelegramLink.tenantId, args.tenantId),
				eq(table.userTelegramLink.userId, args.userId)
			)
		)
		.limit(1);

	if (!link?.telegramChatId) {
		return { ok: false, reason: 'not_linked' };
	}

	const url = `${TELEGRAM_API}/bot${token}/sendMessage`;
	try {
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				chat_id: link.telegramChatId,
				text: args.text,
				parse_mode: args.parseMode ?? 'Markdown',
				disable_web_page_preview: true
			}),
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
		});
		const json = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
		if (!res.ok || !json?.ok) {
			logError('telegram', `sendMessage failed: ${json?.description ?? res.status}`);
			return { ok: false, reason: 'api_error', detail: json?.description ?? `HTTP ${res.status}` };
		}
		return { ok: true };
	} catch (e) {
		logError('telegram', `sendMessage fetch failed: ${serializeError(e).message}`);
		return { ok: false, reason: 'fetch_failed', detail: serializeError(e).message };
	}
}

export async function sendTelegramToChatId(chatId: string, text: string): Promise<SendResult> {
	const token = getBotToken();
	if (!token) return { ok: false, reason: 'no_token' };
	const url = `${TELEGRAM_API}/bot${token}/sendMessage`;
	try {
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				chat_id: chatId,
				text,
				parse_mode: 'Markdown',
				disable_web_page_preview: true
			}),
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
		});
		const json = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
		if (!res.ok || !json?.ok) {
			return { ok: false, reason: 'api_error', detail: json?.description ?? `HTTP ${res.status}` };
		}
		return { ok: true };
	} catch (e) {
		return { ok: false, reason: 'fetch_failed', detail: serializeError(e).message };
	}
}

export async function setTelegramWebhook(webhookUrl: string, secretToken?: string): Promise<SendResult> {
	const token = getBotToken();
	if (!token) return { ok: false, reason: 'no_token' };
	const url = `${TELEGRAM_API}/bot${token}/setWebhook`;
	try {
		const body: Record<string, unknown> = {
			url: webhookUrl,
			allowed_updates: ['message']
		};
		if (secretToken) body.secret_token = secretToken;
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
		});
		const json = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
		if (!res.ok || !json?.ok) {
			return { ok: false, reason: 'api_error', detail: json?.description ?? `HTTP ${res.status}` };
		}
		logInfo('telegram', `setWebhook ok: ${webhookUrl}`);
		return { ok: true };
	} catch (e) {
		return { ok: false, reason: 'fetch_failed', detail: serializeError(e).message };
	}
}

export function getBotUsername(): string {
	return env.TELEGRAM_BOT_USERNAME?.trim() || 'OTSCRMBot';
}

export function buildDeepLink(linkCode: string): string {
	return `https://t.me/${getBotUsername()}?start=${encodeURIComponent(linkCode)}`;
}
