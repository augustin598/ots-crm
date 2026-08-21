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
import { eq, and, inArray, ne } from 'drizzle-orm';
import { logWarning } from '$lib/server/logger';

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

export type WhatsappSenderIdentity = {
	userId: string;
	name: string;
	/** Din ce parte vine omul: echipa agenției sau utilizator al unui client. */
	isStaff: boolean;
	clientIds: string[];
};

/**
 * Drumul invers: de la telefonul unui expeditor la utilizatorul CRM.
 *
 * Indexul pe telefon e NEunic prin design (un număr poate fi legat de mai
 * mulți oameni, de exemplu în familie), așa că la ambiguitate întoarcem null:
 * a alege arbitrar ar însemna să scriem în CRM pe seama altcuiva.
 *
 * `source = 'self_service'` (număr pus singur din portal, fără dovadă de
 * posesie) e exclus, la fel ca la propunerea de client pentru un grup.
 */
export async function resolveUserByWhatsappPhone(
	tenantId: string,
	phoneE164: string
): Promise<WhatsappSenderIdentity | null> {
	if (!tenantId || !phoneE164) return null;

	const rows = await db
		.select({
			userId: table.userWhatsappLink.userId,
			firstName: table.user.firstName,
			lastName: table.user.lastName,
			email: table.user.email
		})
		.from(table.userWhatsappLink)
		.innerJoin(table.user, eq(table.user.id, table.userWhatsappLink.userId))
		.where(
			and(
				eq(table.userWhatsappLink.tenantId, tenantId),
				eq(table.userWhatsappLink.phoneE164, phoneE164),
				ne(table.userWhatsappLink.source, 'self_service')
			)
		);

	if (rows.length !== 1) {
		if (rows.length > 1) {
			logWarning('whatsapp', 'telefon legat de mai mulți utilizatori; comanda se refuză', {
				tenantId,
				metadata: { phoneE164, userIds: rows.map((r) => r.userId) }
			});
		}
		return null;
	}

	const row = rows[0];

	const [staff] = await db
		.select({ userId: table.tenantUser.userId })
		.from(table.tenantUser)
		.where(
			and(eq(table.tenantUser.tenantId, tenantId), eq(table.tenantUser.userId, row.userId))
		)
		.limit(1);

	const clientRows = await db
		.select({ clientId: table.clientUser.clientId })
		.from(table.clientUser)
		.where(and(eq(table.clientUser.tenantId, tenantId), eq(table.clientUser.userId, row.userId)));

	if (!staff && clientRows.length === 0) return null;

	return {
		userId: row.userId,
		name: `${row.firstName ?? ''} ${row.lastName ?? ''}`.trim() || row.email,
		isStaff: Boolean(staff),
		clientIds: clientRows.map((c) => c.clientId)
	};
}
