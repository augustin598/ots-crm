import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, sql, and, notExists } from 'drizzle-orm';
import type { RequestHandler } from './$types';

/**
 * Debug endpoint: list and clean up orphan user accounts.
 *
 * An "orphan" is a user row in `user` that has zero memberships:
 *   - no row in `tenant_user`
 *   - no row in `client_user`
 *
 * Such accounts can't access any workspace and exist only because of
 * abandoned signup flows or stale data. Cleaning them lets the email be
 * re-registered fresh.
 *
 * Endpoints:
 *   GET                          → list orphan users (with details)
 *   DELETE ?email=<email>        → delete a specific orphan by email (safe — only if truly orphan)
 *   DELETE ?id=<userId>          → delete a specific orphan by id
 *
 * Admin-only, owner/admin role required on the tenant route.
 */

function gate(event: Parameters<RequestHandler>[0]) {
	if (!event.locals.user || !event.locals.tenant) {
		throw error(401, 'Unauthorized');
	}
	const role = event.locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') {
		throw error(403, 'Forbidden — owner/admin only');
	}
}

async function findOrphans() {
	const rows = await db
		.select({
			id: table.user.id,
			email: table.user.email,
			firstName: table.user.firstName,
			lastName: table.user.lastName,
			tenantUserCount: sql<number>`(SELECT COUNT(*) FROM ${table.tenantUser} WHERE ${table.tenantUser.userId} = ${table.user.id})`,
			clientUserCount: sql<number>`(SELECT COUNT(*) FROM ${table.clientUser} WHERE ${table.clientUser.userId} = ${table.user.id})`,
			pendingInvitations: sql<number>`(SELECT COUNT(*) FROM ${table.invitation} WHERE LOWER(${table.invitation.email}) = LOWER(${table.user.email}) AND ${table.invitation.status} = 'pending')`,
			activeSessions: sql<number>`(SELECT COUNT(*) FROM ${table.session} WHERE ${table.session.userId} = ${table.user.id} AND ${table.session.expiresAt} > CURRENT_TIMESTAMP)`
		})
		.from(table.user)
		.where(
			and(
				notExists(
					db
						.select()
						.from(table.tenantUser)
						.where(eq(table.tenantUser.userId, table.user.id))
				),
				notExists(
					db
						.select()
						.from(table.clientUser)
						.where(eq(table.clientUser.userId, table.user.id))
				)
			)
		);

	return rows.map((r) => ({
		...r,
		tenantUserCount: Number(r.tenantUserCount ?? 0),
		clientUserCount: Number(r.clientUserCount ?? 0),
		pendingInvitations: Number(r.pendingInvitations ?? 0),
		activeSessions: Number(r.activeSessions ?? 0)
	}));
}

export const GET: RequestHandler = async (event) => {
	gate(event);
	const orphans = await findOrphans();
	return json({
		count: orphans.length,
		orphans
	});
};

export const DELETE: RequestHandler = async (event) => {
	gate(event);
	const url = event.url;
	const email = url.searchParams.get('email');
	const id = url.searchParams.get('id');

	if (!email && !id) {
		throw error(400, 'Provide ?email= or ?id=');
	}

	const target = id
		? await db.select().from(table.user).where(eq(table.user.id, id)).limit(1)
		: await db.select().from(table.user).where(eq(table.user.email, email!.toLowerCase())).limit(1);

	if (target.length === 0) {
		throw error(404, 'User not found');
	}

	const userRow = target[0];

	// SAFETY: re-verify orphan status before delete
	const [tu] = await db
		.select({ count: sql<number>`COUNT(*)` })
		.from(table.tenantUser)
		.where(eq(table.tenantUser.userId, userRow.id));
	const [cu] = await db
		.select({ count: sql<number>`COUNT(*)` })
		.from(table.clientUser)
		.where(eq(table.clientUser.userId, userRow.id));

	const tuCount = Number(tu?.count ?? 0);
	const cuCount = Number(cu?.count ?? 0);

	if (tuCount > 0 || cuCount > 0) {
		throw error(409, `Refuz delete — userul are ${tuCount} tenant_user și ${cuCount} client_user (nu e orfan).`);
	}

	// Cascade: delete sessions and any pending invitations matched by email
	await db.delete(table.session).where(eq(table.session.userId, userRow.id));
	await db.delete(table.user).where(eq(table.user.id, userRow.id));

	return json({
		success: true,
		deleted: {
			id: userRow.id,
			email: userRow.email,
			firstName: userRow.firstName,
			lastName: userRow.lastName
		}
	});
};
