import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import {
	listGroups,
	getGroup,
	WhatsappNotConnectedError,
	type GroupSummary
} from '$lib/server/whatsapp/groups';
import type { RequestHandler } from './$types';

/**
 * Grupuri WhatsApp → membri cu număr de telefon (diagnostic).
 *
 *   GET                      — toate grupurile în care e contul conectat, cu membrii lor
 *   GET ?q=lucky             — doar grupurile al căror subiect conține textul
 *   GET ?groupId=<jid>       — un singur grup, detaliat
 *
 * Pentru fiecare membru arată și ce știm deja: dacă avem contactul, dacă are
 * avatar stocat și la ce utilizator CRM e deja legat — ca să vezi dintr-o privire
 * pe cine mai ai de legat. Legarea efectivă se face din panoul de echipă al
 * clientului („Importă din grup WhatsApp"), nu de aici.
 *
 * Admin-only, tenant-scoped pe locals.tenant. Doar citire.
 */

function requireAdmin(event: Parameters<RequestHandler>[0]) {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	const role = event.locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') {
		throw error(403, 'Forbidden: Admin access required');
	}
}

export const GET: RequestHandler = async (event) => {
	requireAdmin(event);
	const tenantId = event.locals.tenant!.id;
	const q = event.url.searchParams.get('q')?.trim().toLowerCase() || null;
	const groupId = event.url.searchParams.get('groupId')?.trim() || null;

	let groups: GroupSummary[];
	try {
		groups = groupId ? [await getGroup(tenantId, groupId)] : await listGroups(tenantId);
	} catch (err) {
		if (err instanceof WhatsappNotConnectedError) {
			return json({ ok: false, error: err.message }, { status: 409 });
		}
		return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 502 });
	}

	if (q) groups = groups.filter((g) => g.subject.toLowerCase().includes(q));

	// Ce știm deja despre fiecare număr: contact + avatar + legătură CRM.
	const phones = [
		...new Set(groups.flatMap((g) => g.members.map((m) => m.phone)).filter((p): p is string => !!p))
	];
	const contactByPhone = new Map<string, { pushName: string | null; hasAvatar: boolean; hidden: boolean }>();
	const linkByPhone = new Map<string, Array<{ userId: string; name: string; email: string }>>();
	if (phones.length > 0) {
		const contacts = await db
			.select({
				phoneE164: table.whatsappContact.phoneE164,
				pushName: table.whatsappContact.pushName,
				avatarPath: table.whatsappContact.avatarPath,
				avatarHidden: table.whatsappContact.avatarHidden
			})
			.from(table.whatsappContact)
			.where(and(eq(table.whatsappContact.tenantId, tenantId), inArray(table.whatsappContact.phoneE164, phones)));
		for (const c of contacts) {
			contactByPhone.set(c.phoneE164, {
				pushName: c.pushName ?? null,
				hasAvatar: !!c.avatarPath,
				hidden: !!c.avatarHidden
			});
		}

		const links = await db
			.select({
				phoneE164: table.userWhatsappLink.phoneE164,
				userId: table.userWhatsappLink.userId,
				firstName: table.user.firstName,
				lastName: table.user.lastName,
				email: table.user.email
			})
			.from(table.userWhatsappLink)
			.innerJoin(table.user, eq(table.userWhatsappLink.userId, table.user.id))
			.where(and(eq(table.userWhatsappLink.tenantId, tenantId), inArray(table.userWhatsappLink.phoneE164, phones)));
		for (const l of links) {
			const list = linkByPhone.get(l.phoneE164) ?? [];
			list.push({ userId: l.userId, name: `${l.firstName} ${l.lastName}`.trim(), email: l.email });
			linkByPhone.set(l.phoneE164, list);
		}
	}

	const result = groups.map((g) => ({
		id: g.id,
		subject: g.subject,
		size: g.size,
		members: g.members.map((m) => {
			const known = m.phone ? contactByPhone.get(m.phone) : undefined;
			return {
				phone: m.phone,
				rawId: m.rawId,
				pushName: m.pushName ?? known?.pushName ?? null,
				admin: m.admin,
				hasAvatar: known?.hasAvatar ?? false,
				avatarHidden: known?.hidden ?? false,
				linkedTo: m.phone ? (linkByPhone.get(m.phone) ?? []) : []
			};
		})
	}));

	return json({ ok: true, groups: result.length, data: result });
};
