/**
 * Phone resolver — single source of truth for "which WhatsApp phone belongs
 * to this user record". Backed by the `user_whatsapp_link` table (admin-
 * controlled, seeded from tenantUser.phone + primary client.phone).
 *
 * Why this exists: many people share first names → name-based fuzzy match
 * attaches wrong avatars. Phone is the only unique key.
 *
 * The user_whatsapp_link table has UNIQUE(tenantId, userId), so each user
 * has at most one canonical phone per tenant.
 */

import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, inArray } from 'drizzle-orm';

/**
 * Get the canonical WhatsApp phone for a single user in a tenant.
 * Returns null if no link exists.
 */
export async function getUserWhatsappPhone(
	tenantId: string,
	userId: string
): Promise<string | null> {
	if (!tenantId || !userId) return null;
	const [row] = await db
		.select({ phoneE164: table.userWhatsappLink.phoneE164 })
		.from(table.userWhatsappLink)
		.where(
			and(
				eq(table.userWhatsappLink.tenantId, tenantId),
				eq(table.userWhatsappLink.userId, userId)
			)
		)
		.limit(1);
	return row?.phoneE164 ?? null;
}

/**
 * Batch variant: returns a Map userId → phoneE164 for users with a link.
 * Users without a link are absent from the map (lookup yields undefined).
 */
export async function getUserWhatsappPhonesBatch(
	tenantId: string,
	userIds: string[]
): Promise<Map<string, string>> {
	const result = new Map<string, string>();
	if (!tenantId || userIds.length === 0) return result;

	const rows = await db
		.select({
			userId: table.userWhatsappLink.userId,
			phoneE164: table.userWhatsappLink.phoneE164
		})
		.from(table.userWhatsappLink)
		.where(
			and(
				eq(table.userWhatsappLink.tenantId, tenantId),
				inArray(table.userWhatsappLink.userId, userIds)
			)
		);

	for (const r of rows) {
		result.set(r.userId, r.phoneE164);
	}
	return result;
}
