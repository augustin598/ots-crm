import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { getBotUsername } from '$lib/server/telegram/sender';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.user || !locals.tenant) throw redirect(302, '/login');

	const [link] = await db
		.select()
		.from(table.userTelegramLink)
		.where(
			and(
				eq(table.userTelegramLink.tenantId, locals.tenant.id),
				eq(table.userTelegramLink.userId, locals.user.id)
			)
		)
		.limit(1);

	return {
		tenantSlug: params.tenant,
		botUsername: getBotUsername(),
		link: link
			? {
					linked: !!link.linkedAt,
					telegramUsername: link.telegramUsername,
					linkedAt: link.linkedAt,
					hasPendingCode: !link.linkedAt && link.expiresAt.getTime() > Date.now(),
					pendingExpiresAt: !link.linkedAt ? link.expiresAt : null
				}
			: { linked: false, telegramUsername: null, linkedAt: null, hasPendingCode: false, pendingExpiresAt: null }
	};
};
