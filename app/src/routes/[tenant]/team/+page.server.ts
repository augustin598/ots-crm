import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { ensureAdminTeamAccess } from '$lib/server/team-access';

export const load: PageServerLoad = async (event) => {
	await ensureAdminTeamAccess(event);
	const tenantId = event.locals.tenant!.id;

	const [members, invitations, taskCounts, sessionRows] = await Promise.all([
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
			.groupBy(table.session.userId)
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

	return {
		members,
		invitations,
		stats,
		sessions,
		currentUserId: event.locals.user!.id,
		currentRole: event.locals.tenantUser!.role
	};
};
