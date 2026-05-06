import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, inArray, not, sql } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { ensureAdminTeamAccess } from '$lib/server/team-access';

export const load: PageServerLoad = async (event) => {
	ensureAdminTeamAccess(event);
	const tenantId = event.locals.tenant!.id;

	const [members, invitations, taskCounts] = await Promise.all([
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
				and(
					eq(table.invitation.tenantId, tenantId),
					eq(table.invitation.status, 'pending')
				)
			),
		// Workload data: count active and done tasks per assigned user.
		db
			.select({
				userId: table.task.assignedToUserId,
				active: sql<number>`SUM(CASE WHEN ${table.task.status} NOT IN ('done', 'cancelled') THEN 1 ELSE 0 END)`,
				done: sql<number>`SUM(CASE WHEN ${table.task.status} = 'done' THEN 1 ELSE 0 END)`
			})
			.from(table.task)
			.where(eq(table.task.tenantId, tenantId))
			.groupBy(table.task.assignedToUserId)
	]);

	const stats: Record<string, { active: number; done: number }> = {};
	for (const row of taskCounts) {
		if (!row.userId) continue;
		stats[row.userId] = {
			active: Number(row.active ?? 0),
			done: Number(row.done ?? 0)
		};
	}

	return {
		members,
		invitations,
		stats,
		currentUserId: event.locals.user!.id,
		currentRole: event.locals.tenantUser!.role
	};
};
