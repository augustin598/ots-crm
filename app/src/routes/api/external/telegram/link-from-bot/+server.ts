import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { withApiKey } from '$lib/server/api-keys/middleware';

/**
 * POST /api/external/telegram/link-from-bot
 * Called by the Piticu bot after a user sends /start <linkCode>.
 * Completes the Telegram ↔ CRM user pairing.
 *
 * Body: { linkCode: string, telegramChatId: string|number, telegramUsername?: string }
 * Auth: X-API-Key with scope telegram:link
 */
export const POST: RequestHandler = (event) =>
	withApiKey(event, 'telegram:link', async (event, _ctx) => {
		let body: Record<string, unknown>;
		try {
			body = (await event.request.json()) as Record<string, unknown>;
		} catch {
			return { status: 400, body: { ok: false, error: 'invalid_json' } };
		}

		const linkCode = typeof body.linkCode === 'string' ? body.linkCode.trim() : null;
		const telegramChatId =
			typeof body.telegramChatId === 'string' || typeof body.telegramChatId === 'number'
				? String(body.telegramChatId)
				: null;
		const telegramUsername =
			typeof body.telegramUsername === 'string' ? body.telegramUsername.trim() || null : null;

		if (!linkCode || !telegramChatId) {
			return {
				status: 400,
				body: { ok: false, error: 'missing_fields', message: 'linkCode and telegramChatId are required' }
			};
		}

		const now = new Date();

		const [row] = await db
			.select({
				id: table.userTelegramLink.id,
				tenantId: table.userTelegramLink.tenantId,
				userId: table.userTelegramLink.userId,
				linkedAt: table.userTelegramLink.linkedAt,
				expiresAt: table.userTelegramLink.expiresAt
			})
			.from(table.userTelegramLink)
			.where(eq(table.userTelegramLink.linkCode, linkCode))
			.limit(1);

		if (!row || row.expiresAt < now) {
			return { status: 404, body: { ok: false, error: 'unknown_or_expired_code' } };
		}

		if (row.linkedAt !== null) {
			return { status: 409, body: { ok: false, error: 'already_linked' } };
		}

		await db
			.update(table.userTelegramLink)
			.set({
				telegramChatId,
				telegramUsername,
				linkedAt: now
			})
			.where(
				and(
					eq(table.userTelegramLink.id, row.id),
					isNull(table.userTelegramLink.linkedAt)
				)
			);

		const [userRow] = await db
			.select({ id: table.user.id, firstName: table.user.firstName, lastName: table.user.lastName })
			.from(table.user)
			.where(eq(table.user.id, row.userId))
			.limit(1);

		const displayName = userRow ? `${userRow.firstName} ${userRow.lastName}`.trim() : null;

		return {
			status: 200,
			body: {
				ok: true,
				userId: row.userId,
				tenantId: row.tenantId,
				displayName
			}
		};
	});
