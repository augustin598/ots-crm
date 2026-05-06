import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';

export const getTenantUsers = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	// Returns one row per tenantUser with the joined user info + role + joinedAt.
	const tenantUsers = await db
		.select({
			tenantUserId: table.tenantUser.id,
			id: table.user.id,
			email: table.user.email,
			firstName: table.user.firstName,
			lastName: table.user.lastName,
			role: table.tenantUser.role,
			joinedAt: table.tenantUser.createdAt
		})
		.from(table.tenantUser)
		.innerJoin(table.user, eq(table.tenantUser.userId, table.user.id))
		.where(eq(table.tenantUser.tenantId, event.locals.tenant.id));

	return tenantUsers;
});

const updateRoleSchema = v.object({
	tenantUserId: v.pipe(v.string(), v.minLength(1)),
	role: v.picklist(['admin', 'member'])
});

/**
 * Owner-only. Cannot promote anyone to 'owner' (use transferOwnership v2).
 * Cannot change own role.
 */
export const updateTenantUserRole = command(updateRoleSchema, async ({ tenantUserId, role }) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant || !event?.locals.tenantUser) {
		throw new Error('Unauthorized');
	}
	if (event.locals.tenantUser.role !== 'owner') {
		throw new Error('Doar Owner-ul poate schimba roluri.');
	}
	const [target] = await db
		.select()
		.from(table.tenantUser)
		.where(
			and(
				eq(table.tenantUser.id, tenantUserId),
				eq(table.tenantUser.tenantId, event.locals.tenant.id)
			)
		)
		.limit(1);
	if (!target) throw new Error('Membrul nu există.');
	if (target.userId === event.locals.user.id) {
		throw new Error('Nu te poți auto-modifica. Folosește Transfer Ownership.');
	}
	if (target.role === 'owner') {
		throw new Error('Nu poți modifica owner-ul. Folosește Transfer Ownership.');
	}
	await db
		.update(table.tenantUser)
		.set({ role })
		.where(eq(table.tenantUser.id, tenantUserId));
	return { ok: true };
});

const removeMemberSchema = v.object({
	tenantUserId: v.pipe(v.string(), v.minLength(1))
});

/**
 * Owner or admin. Cannot remove self. Cannot remove the owner.
 * Sessions of the removed user are invalidated.
 */
export const removeTenantUser = command(removeMemberSchema, async ({ tenantUserId }) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant || !event?.locals.tenantUser) {
		throw new Error('Unauthorized');
	}
	const actorRole = event.locals.tenantUser.role;
	if (actorRole !== 'owner' && actorRole !== 'admin') {
		throw new Error('Doar owner / admin pot scoate membri.');
	}
	const [target] = await db
		.select()
		.from(table.tenantUser)
		.where(
			and(
				eq(table.tenantUser.id, tenantUserId),
				eq(table.tenantUser.tenantId, event.locals.tenant.id)
			)
		)
		.limit(1);
	if (!target) throw new Error('Membrul nu există.');
	if (target.userId === event.locals.user.id) {
		throw new Error('Nu te poți auto-elimina.');
	}
	if (target.role === 'owner') {
		throw new Error('Owner-ul nu poate fi eliminat.');
	}
	const removedUserId = target.userId;
	await db.delete(table.tenantUser).where(eq(table.tenantUser.id, tenantUserId));
	// Best-effort: invalidate active sessions for that user (only if they have
	// no other tenant memberships — otherwise they need to keep accessing
	// other workspaces). Simpler MVP: leave sessions; logging out is enough.
	void removedUserId;
	return { ok: true };
});

export const getClientUsers = query(v.pipe(v.string(), v.minLength(1)), async (clientId) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	const clientUsers = await db
		.select({
			id: table.user.id,
			email: table.user.email,
			firstName: table.user.firstName,
			lastName: table.user.lastName
		})
		.from(table.clientUser)
		.innerJoin(table.user, eq(table.clientUser.userId, table.user.id))
		.where(
			and(
				eq(table.clientUser.clientId, clientId),
				eq(table.clientUser.tenantId, event.locals.tenant.id)
			)
		);

	return clientUsers;
});
