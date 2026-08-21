import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { ensureAdminTeamAccess } from '$lib/server/team-access';
import { getUserWhatsappPhonesBatch } from '$lib/server/whatsapp/resolve-phone';
import { normalizePhoneE164 } from '$lib/utils/phone';

export const load: PageServerLoad = async (event) => {
	await ensureAdminTeamAccess(event);
	const tenantId = event.locals.tenant!.id;

	const [members, invitations, taskCounts, sessionRows, clientRows] = await Promise.all([
		db
			.select({
				tenantUserId: table.tenantUser.id,
				userId: table.user.id,
				email: table.user.email,
				firstName: table.user.firstName,
				lastName: table.user.lastName,
				role: table.tenantUser.role,
				department: table.tenantUser.department,
				title: table.tenantUser.title,
				phone: table.tenantUser.phone,
				skills: table.tenantUser.skills,
				hourlyRate: table.tenantUser.hourlyRate,
				status: table.tenantUser.status,
				capabilities: table.tenantUser.capabilities,
				joinedAt: table.tenantUser.createdAt
			})
			.from(table.tenantUser)
			.innerJoin(table.user, eq(table.tenantUser.userId, table.user.id))
			.where(eq(table.tenantUser.tenantId, tenantId)),
		db
			.select({
				id: table.invitation.id,
				email: table.invitation.email,
				role: table.invitation.role,
				status: table.invitation.status,
				expiresAt: table.invitation.expiresAt,
				createdAt: table.invitation.createdAt,
				department: table.invitation.department,
				title: table.invitation.title
			})
			.from(table.invitation)
			.where(
				and(eq(table.invitation.tenantId, tenantId), eq(table.invitation.status, 'pending'))
			),
		// Workload data: count active, done, and on-time done tasks per assigned user.
		db
			.select({
				userId: table.task.assignedToUserId,
				active: sql<number>`SUM(CASE WHEN ${table.task.status} NOT IN ('done', 'cancelled') THEN 1 ELSE 0 END)`,
				done: sql<number>`SUM(CASE WHEN ${table.task.status} = 'done' THEN 1 ELSE 0 END)`,
				doneOnTime: sql<number>`SUM(CASE WHEN ${table.task.status} = 'done' AND (${table.task.dueDate} IS NULL OR ${table.task.updatedAt} <= ${table.task.dueDate}) THEN 1 ELSE 0 END)`
			})
			.from(table.task)
			.where(eq(table.task.tenantId, tenantId))
			.groupBy(table.task.assignedToUserId),
		// Latest session expiry per user — used to derive online status & last active.
		db
			.select({
				userId: table.session.userId,
				latestExpiresAt: sql<Date>`MAX(${table.session.expiresAt})`
			})
			.from(table.session)
			.groupBy(table.session.userId),
		// Active clients with secondary-email count for the "Clienți" tab.
		db
			.select({
				id: table.client.id,
				name: table.client.name,
				businessName: table.client.businessName,
				email: table.client.email,
				phone: table.client.phone,
				avatarPath: table.client.avatarPath,
				secondaryCount: sql<number>`COUNT(${table.clientSecondaryEmail.id})`.as(
					'secondary_count'
				)
			})
			.from(table.client)
			.leftJoin(
				table.clientSecondaryEmail,
				eq(table.client.id, table.clientSecondaryEmail.clientId)
			)
			.where(and(eq(table.client.tenantId, tenantId), eq(table.client.status, 'active')))
			.groupBy(table.client.id)
	]);

	const stats: Record<string, { active: number; done: number; onTimePct: number | null }> = {};
	for (const row of taskCounts) {
		if (!row.userId) continue;
		const done = Number(row.done ?? 0);
		const doneOnTime = Number(row.doneOnTime ?? 0);
		stats[row.userId] = {
			active: Number(row.active ?? 0),
			done,
			onTimePct: done > 0 ? Math.round((doneOnTime / done) * 100) : null
		};
	}

	const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30d (proxy for last active)
	const now = Date.now();
	const sessions: Record<string, { online: boolean; lastActiveAt: Date | null }> = {};
	for (const row of sessionRows) {
		if (!row.userId || !row.latestExpiresAt) continue;
		const expiresMs = new Date(row.latestExpiresAt).getTime();
		sessions[row.userId] = {
			online: expiresMs > now,
			lastActiveAt: new Date(expiresMs - SESSION_TTL_MS)
		};
	}

	// Avatar WhatsApp: telefonul canonic vine din user_whatsapp_link, cu revenire la
	// tenantUser.phone normalizat (aceeași regulă ca în users.remote). Verificăm apoi
	// care dintre telefoane au efectiv un avatar stocat, ca UI-ul să ceară imaginea
	// doar când există — altfel fiecare membru fără poză ar genera un 404.
	const linkedPhones = await getUserWhatsappPhonesBatch(
		tenantId,
		members.map((m) => m.userId)
	);
	const memberPhone = new Map<string, string>();
	for (const m of members) {
		const phone = linkedPhones.get(m.userId) ?? normalizePhoneE164(m.phone);
		if (phone) memberPhone.set(m.userId, phone);
	}
	const clientPhone = new Map<string, string>();
	for (const c of clientRows) {
		const phone = normalizePhoneE164(c.phone);
		if (phone) clientPhone.set(c.id, phone);
	}

	const candidatePhones = [...new Set([...memberPhone.values(), ...clientPhone.values()])];
	const phonesWithAvatar = new Set<string>();
	if (candidatePhones.length > 0) {
		const avatarRows = await db
			.select({ phoneE164: table.whatsappContact.phoneE164 })
			.from(table.whatsappContact)
			.where(
				and(
					eq(table.whatsappContact.tenantId, tenantId),
					inArray(table.whatsappContact.phoneE164, candidatePhones),
					isNotNull(table.whatsappContact.avatarPath)
				)
			);
		for (const r of avatarRows) phonesWithAvatar.add(r.phoneE164);
	}

	const avatarPhoneFor = (phone: string | undefined): string | null =>
		phone && phonesWithAvatar.has(phone) ? phone : null;

	const membersWithAvatar = members.map((m) => ({
		...m,
		avatarPhone: avatarPhoneFor(memberPhone.get(m.userId))
	}));

	const clients = clientRows.map((c) => ({
		id: c.id,
		name: c.name,
		businessName: c.businessName,
		email: c.email,
		phone: c.phone,
		avatarPath: c.avatarPath,
		avatarPhone: avatarPhoneFor(clientPhone.get(c.id)),
		secondaryCount: Number(c.secondaryCount ?? 0)
	}));

	return {
		members: membersWithAvatar,
		invitations,
		stats,
		sessions,
		clients,
		currentUserId: event.locals.user!.id,
		currentRole: event.locals.tenantUser!.role
	};
};
