import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { ensureAdminTeamAccess } from '$lib/server/team-access';

export const load: PageServerLoad = async (event) => {
	ensureAdminTeamAccess(event);
	const tenantId = event.locals.tenant!.id;

	const [members, invitations] = await Promise.all([
		db
			.select({
				tenantUserId: table.tenantUser.id,
				userId: table.user.id,
				email: table.user.email,
				firstName: table.user.firstName,
				lastName: table.user.lastName,
				role: table.tenantUser.role,
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
				createdAt: table.invitation.createdAt
			})
			.from(table.invitation)
			.where(
				and(
					eq(table.invitation.tenantId, tenantId),
					eq(table.invitation.status, 'pending')
				)
			)
	]);

	return {
		members,
		invitations,
		currentUserId: event.locals.user!.id,
		currentRole: event.locals.tenantUser!.role
	};
};
