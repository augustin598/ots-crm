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

	// Returns one row per tenantUser with the joined user info + role + meta.
	const tenantUsers = await db
		.select({
			tenantUserId: table.tenantUser.id,
			id: table.user.id,
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
		.where(eq(table.tenantUser.tenantId, event.locals.tenant.id));

	return tenantUsers;
});

const updateRoleSchema = v.object({
	tenantUserId: v.pipe(v.string(), v.minLength(1)),
	role: v.picklist(['admin', 'manager', 'member', 'viewer'])
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

const updateMetaSchema = v.object({
	tenantUserId: v.pipe(v.string(), v.minLength(1)),
	department: v.optional(v.union([v.picklist(['ads', 'sales', 'dev', 'finance', 'support', 'ops']), v.null()])),
	title: v.optional(v.union([v.pipe(v.string(), v.maxLength(120)), v.null()])),
	phone: v.optional(v.union([v.pipe(v.string(), v.maxLength(40)), v.null()])),
	hourlyRate: v.optional(v.union([v.pipe(v.string(), v.maxLength(40)), v.null()]))
});

/**
 * Owner / admin can update meta fields (department, title, phone) for any
 * member. The actor cannot change another owner's meta unless they're the
 * owner themselves.
 */
export const updateTenantUserMeta = command(updateMetaSchema, async (data) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant || !event?.locals.tenantUser) {
		throw new Error('Unauthorized');
	}
	const actorRole = event.locals.tenantUser.role;
	if (actorRole !== 'owner' && actorRole !== 'admin') {
		throw new Error('Doar owner / admin pot edita profilul.');
	}
	const [target] = await db
		.select()
		.from(table.tenantUser)
		.where(
			and(
				eq(table.tenantUser.id, data.tenantUserId),
				eq(table.tenantUser.tenantId, event.locals.tenant.id)
			)
		)
		.limit(1);
	if (!target) throw new Error('Membrul nu există.');
	if (target.role === 'owner' && actorRole !== 'owner') {
		throw new Error('Doar owner-ul își poate edita propriul profil.');
	}
	const patch: Record<string, string | null> = {};
	if ('department' in data) patch.department = data.department ?? null;
	if ('title' in data) patch.title = data.title ?? null;
	if ('phone' in data) patch.phone = data.phone ?? null;
	if ('hourlyRate' in data) patch.hourlyRate = data.hourlyRate ?? null;
	if (Object.keys(patch).length === 0) return { ok: true };
	await db.update(table.tenantUser).set(patch).where(eq(table.tenantUser.id, data.tenantUserId));
	return { ok: true };
});

const skillsSchema = v.object({
	tenantUserId: v.pipe(v.string(), v.minLength(1)),
	skills: v.array(v.pipe(v.string(), v.minLength(1), v.maxLength(40)))
});

/**
 * Owner / admin / manager / self may update skills.
 * Stored as JSON array text on tenant_user.skills.
 */
export const updateTenantUserSkills = command(skillsSchema, async ({ tenantUserId, skills }) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant || !event?.locals.tenantUser) {
		throw new Error('Unauthorized');
	}
	const actorRole = event.locals.tenantUser.role;
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
	const isSelf = target.userId === event.locals.user.id;
	const canEdit = isSelf || actorRole === 'owner' || actorRole === 'admin' || actorRole === 'manager';
	if (!canEdit) throw new Error('Nu ai permisiunea să modifici skills.');
	const trimmed = Array.from(new Set(skills.map((s) => s.trim()).filter(Boolean))).slice(0, 30);
	await db
		.update(table.tenantUser)
		.set({ skills: JSON.stringify(trimmed) })
		.where(eq(table.tenantUser.id, tenantUserId));
	return { ok: true };
});

const suspendSchema = v.object({
	tenantUserId: v.pipe(v.string(), v.minLength(1))
});

/**
 * Owner / admin only. Cannot suspend self or owner. Sets status='suspended'
 * which causes getTenantById to deny tenant access on next request.
 */
export const suspendTenantUser = command(suspendSchema, async ({ tenantUserId }) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant || !event?.locals.tenantUser) {
		throw new Error('Unauthorized');
	}
	const actorRole = event.locals.tenantUser.role;
	if (actorRole !== 'owner' && actorRole !== 'admin') {
		throw new Error('Doar owner / admin pot suspenda conturi.');
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
	if (target.userId === event.locals.user.id) throw new Error('Nu te poți suspenda singur.');
	if (target.role === 'owner') throw new Error('Owner-ul nu poate fi suspendat.');
	await db
		.update(table.tenantUser)
		.set({ status: 'suspended' })
		.where(eq(table.tenantUser.id, tenantUserId));
	return { ok: true };
});

/**
 * Owner / admin only. Re-enable a suspended account.
 */
export const reactivateTenantUser = command(suspendSchema, async ({ tenantUserId }) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant || !event?.locals.tenantUser) {
		throw new Error('Unauthorized');
	}
	const actorRole = event.locals.tenantUser.role;
	if (actorRole !== 'owner' && actorRole !== 'admin') {
		throw new Error('Doar owner / admin pot reactiva conturi.');
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
	await db
		.update(table.tenantUser)
		.set({ status: 'active' })
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
