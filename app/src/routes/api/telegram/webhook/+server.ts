import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { handleTelegramUpdate } from '$lib/server/telegram/webhook-handler';
import { logWarning, serializeError } from '$lib/server/logger';
import type { RequestHandler } from './$types';

/**
 * Public Telegram webhook endpoint.
 * Telegram pushes update events to this URL after setWebhook is configured.
 *
 * Security: optional secret_token via TELEGRAM_WEBHOOK_SECRET env.
 * If set, Telegram includes "X-Telegram-Bot-Api-Secret-Token" header — we reject mismatches.
 */
export const POST: RequestHandler = async ({ request }) => {
	const expectedSecret = env.TELEGRAM_WEBHOOK_SECRET?.trim();
	if (expectedSecret) {
		const provided = request.headers.get('x-telegram-bot-api-secret-token');
		if (provided !== expectedSecret) {
			logWarning('telegram', 'Webhook secret mismatch — rejecting');
			throw error(401, 'Unauthorized');
		}
	}

	let payload: unknown;
	try {
		payload = await request.json();
	} catch {
		throw error(400, 'Invalid JSON');
	}

	try {
		await handleTelegramUpdate(payload as Parameters<typeof handleTelegramUpdate>[0]);
	} catch (e) {
		// Always return 200 to Telegram so it doesn't retry-storm us.
		// Errors are logged inside handleTelegramUpdate.
		logWarning('telegram', `Webhook processing error: ${serializeError(e).message}`);
	}

	return json({ ok: true });
};
