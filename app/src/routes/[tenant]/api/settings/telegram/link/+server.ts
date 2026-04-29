import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { buildDeepLink, sendTelegramMessage } from '$lib/server/telegram/sender';
import { logInfo } from '$lib/server/logger';
import type { RequestHandler } from './$types';

const LINK_TTL_MS = 10 * 60 * 1000;

/**
 * GET — return current link status for the user (chatId? linked? expiresAt?).
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user || !locals.tenant) throw error(401, 'Unauthorized');

	const [row] = await db
		.select()
		.from(table.userTelegramLink)
		.where(
			and(
				eq(table.userTelegramLink.tenantId, locals.tenant.id),
				eq(table.userTelegramLink.userId, locals.user.id)
			)
		)
		.limit(1);

	return json({
		linked: !!row?.linkedAt,
		telegramUsername: row?.telegramUsername ?? null,
		linkedAt: row?.linkedAt ?? null,
		hasPendingCode: !!row && !row.linkedAt && row.expiresAt.getTime() > Date.now(),
		pendingExpiresAt: !row?.linkedAt ? row?.expiresAt ?? null : null
	});
};

/**
 * POST — generate a fresh link code + return deep-link URL.
 * If user already linked: returns linked=true (frontend can show "disconnect").
 */
export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.user || !locals.tenant) throw error(401, 'Unauthorized');

	const linkCode = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
	const expiresAt = new Date(Date.now() + LINK_TTL_MS);

	// Replace any existing pending row for this user (single row per user)
	await db
		.delete(table.userTelegramLink)
		.where(
			and(
				eq(table.userTelegramLink.tenantId, locals.tenant.id),
				eq(table.userTelegramLink.userId, locals.user.id)
			)
		);

	const id = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
	await db.insert(table.userTelegramLink).values({
		id,
		tenantId: locals.tenant.id,
		userId: locals.user.id,
		telegramChatId: null,
		telegramUsername: null,
		linkCode,
		linkedAt: null,
		expiresAt
	});

	logInfo('telegram', `Link code generated for user ${locals.user.id}`, {
		tenantId: locals.tenant.id,
		userId: locals.user.id
	});

	return json({
		deepLink: buildDeepLink(linkCode),
		expiresAt
	});
};

/**
 * DELETE — disconnect Telegram (clears chatId).
 */
export const DELETE: RequestHandler = async ({ locals }) => {
	if (!locals.user || !locals.tenant) throw error(401, 'Unauthorized');

	await db
		.delete(table.userTelegramLink)
		.where(
			and(
				eq(table.userTelegramLink.tenantId, locals.tenant.id),
				eq(table.userTelegramLink.userId, locals.user.id)
			)
		);

	return json({ ok: true });
};

/**
 * Test endpoint — sends a test message to the linked chat.
 */
export const PUT: RequestHandler = async ({ locals }) => {
	if (!locals.user || !locals.tenant) throw error(401, 'Unauthorized');

	const result = await sendTelegramMessage({
		tenantId: locals.tenant.id,
		userId: locals.user.id,
		text: '🧪 Test OTS CRM — dacă ai primit acest mesaj, integrarea Telegram funcționează corect.'
	});

	if (!result.ok) {
		return json({ ok: false, reason: result.reason, detail: result.reason === 'fetch_failed' || result.reason === 'api_error' ? result.detail : undefined }, { status: 400 });
	}
	return json({ ok: true });
};
