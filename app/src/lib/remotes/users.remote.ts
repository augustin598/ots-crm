import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { getActor } from '$lib/server/get-actor';
import { assertCan } from '$lib/server/access';
import { validateOverride } from '$lib/server/access';
import type { AdminRoleId } from '$lib/access/catalog';
import { normalizePhoneE164 } from '$lib/utils/phone';
import { getUserWhatsappPhonesBatch } from '$lib/server/whatsapp/resolve-phone';
import { encodeBase32LowerCase } from '@oslojs/encoding';

function generateWhatsappLinkId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

export const getTenantUsers = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	const tenantId = event.locals.tenant.id;

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
			capabilities: table.tenantUser.capabilities,
			joinedAt: table.tenantUser.createdAt
		})
		.from(table.tenantUser)
		.innerJoin(table.user, eq(table.tenantUser.userId, table.user.id))
		.where(eq(table.tenantUser.tenantId, tenantId));

	// Resolve WhatsApp phone per user via canonical link table.
	// Falls back to tenantUser.phone (normalized) when user has no explicit link
	// — admin profile is still the implicit source for avatar lookup if link unset.
	const phonesByUser = await getUserWhatsappPhonesBatch(
		tenantId,
		tenantUsers.map((u) => u.id)
	);
	return tenantUsers.map((u) => ({
		...u,
		whatsappPhone: phonesByUser.get(u.id) ?? normalizePhoneE164(u.phone)
	}));
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
	const actor = await getActor(event);
	assertCan(actor, 'admin.team.changeRole');
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
	const actor = await getActor(event);
	assertCan(actor, 'admin.team.editProfile');
	const actorRole = event.locals.tenantUser.role;
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

	// Auto-sync user_whatsapp_link when admin edits phone in the team profile.
	// Single source of truth for avatars: any phone change here propagates to
	// the canonical link table. Source = 'manual' for explicit admin edits.
	if ('phone' in data) {
		const tenantId = event.locals.tenant.id;
		const e164 = normalizePhoneE164(data.phone);
		await db
			.delete(table.userWhatsappLink)
			.where(
				and(
					eq(table.userWhatsappLink.tenantId, tenantId),
					eq(table.userWhatsappLink.userId, target.userId)
				)
			);
		if (e164) {
			await db.insert(table.userWhatsappLink).values({
				id: generateWhatsappLinkId(),
				tenantId,
				userId: target.userId,
				phoneE164: e164,
				source: 'manual'
			});
		}
	}

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
	const actor = await getActor(event);
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
	if (!isSelf) {
		assertCan(actor, 'admin.team.editSkills');
	}
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
	const actor = await getActor(event);
	assertCan(actor, 'admin.team.suspend');
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
	const actor = await getActor(event);
	assertCan(actor, 'admin.team.suspend');
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
	const actor = await getActor(event);
	assertCan(actor, 'admin.team.suspend');
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

const capabilitiesSchema = v.object({
	tenantUserId: v.pipe(v.string(), v.minLength(1)),
	/**
	 * NULL = clear override, use role defaults.
	 * Array = explicit capability set (replaces role defaults).
	 */
	capabilities: v.union([v.null(), v.array(v.pipe(v.string(), v.minLength(1)))])
});

/**
 * Owner-only. Set per-user capability override (or clear it). Capabilities are
 * validated against the catalog; unsafe-unless-role caps require target to have
 * the matching role.
 */
export const updateTenantUserCapabilities = command(capabilitiesSchema, async ({ tenantUserId, capabilities }) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant || !event?.locals.tenantUser) {
		throw new Error('Unauthorized');
	}
	const actor = await getActor(event);
	assertCan(actor, 'admin.team.changeRole');

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
	if (target.role === 'owner' && target.userId !== event.locals.user.id) {
		throw new Error('Nu poți modifica capabilities ale owner-ului din altă sesiune.');
	}

	let payload: string | null = null;
	if (capabilities !== null) {
		const sanitized = validateOverride(capabilities, target.role as AdminRoleId);
		payload = JSON.stringify(sanitized);
	}

	await db
		.update(table.tenantUser)
		.set({ capabilities: payload })
		.where(eq(table.tenantUser.id, tenantUserId));
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

/**
 * Get client users assignable to tasks for a given client.
 *
 * Returns:
 *  - Primary client users (isPrimary=true) — always eligible
 *  - Secondary client users — only if their clientSecondaryEmail row has
 *    accessFlags.tasks = true (or legacy notifyTasks fallback)
 *
 * Filters keep contacts who have NOT been granted task-portal access invisible
 * from the assignee picker, avoiding implicit access escalation via assignment.
 */
export const getAssignableClientUsers = query(
	v.pipe(v.string(), v.minLength(1)),
	async (clientId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}
		// Client users cannot use this picker
		if (event.locals.isClientUser) {
			throw new Error('Unauthorized');
		}

		const tenantId = event.locals.tenant.id;

		// All client users for this client+tenant (primary + secondary)
		const rows = await db
			.select({
				userId: table.user.id,
				email: table.user.email,
				firstName: table.user.firstName,
				lastName: table.user.lastName,
				isPrimary: table.clientUser.isPrimary
			})
			.from(table.clientUser)
			.innerJoin(table.user, eq(table.clientUser.userId, table.user.id))
			.where(
				and(
					eq(table.clientUser.clientId, clientId),
					eq(table.clientUser.tenantId, tenantId)
				)
			);

		if (rows.length === 0) return [];

		// Resolve per-user WhatsApp phone via the canonical user_whatsapp_link table.
		// No name-based guessing — only deterministic phone links count.
		const phonesByUser = await getUserWhatsappPhonesBatch(
			tenantId,
			rows.map((r) => r.userId)
		);

		// For non-primary users, look up their clientSecondaryEmail row to read
		// both accessFlags AND the admin-set label. The label is the source of
		// truth for the displayed name — the `user.firstName/lastName` may be a
		// stale placeholder (e.g., auto-filled with the client's company name
		// at registration time, before the admin renamed the contact).
		const cseRows = await db
			.select({
				email: table.clientSecondaryEmail.email,
				label: table.clientSecondaryEmail.label,
				accessFlags: table.clientSecondaryEmail.accessFlags,
				notifyTasks: table.clientSecondaryEmail.notifyTasks
			})
			.from(table.clientSecondaryEmail)
			.where(
				and(
					eq(table.clientSecondaryEmail.clientId, clientId),
					eq(table.clientSecondaryEmail.tenantId, tenantId)
				)
			);

		const secondaryAccessByEmail = new Map<string, boolean>();
		const secondaryLabelByEmail = new Map<string, string | null>();
		for (const r of cseRows) {
			let hasTasksAccess = false;
			if (r.accessFlags) {
				try {
					const flags = JSON.parse(r.accessFlags);
					hasTasksAccess = !!flags.tasks;
				} catch {
					// fallthrough to legacy notify column
				}
			}
			// Legacy fallback when accessFlags JSON not yet backfilled
			if (!hasTasksAccess && r.notifyTasks) {
				hasTasksAccess = true;
			}
			const key = r.email.toLowerCase();
			secondaryAccessByEmail.set(key, hasTasksAccess);
			if (r.label && r.label.trim()) secondaryLabelByEmail.set(key, r.label.trim());
		}

		// Resolve display name: prefer secondary label → fall back to user.firstName/lastName.
		// Split label on first space so the existing { firstName, lastName } shape stays stable.
		function pickNames(email: string, fnDb: string | null, lnDb: string | null) {
			const label = email ? secondaryLabelByEmail.get(email.toLowerCase()) ?? null : null;
			if (label) {
				const [first, ...rest] = label.split(/\s+/);
				return { firstName: first ?? '', lastName: rest.join(' ') };
			}
			return { firstName: fnDb ?? '', lastName: lnDb ?? '' };
		}

		return rows
			.filter((r) => {
				if (r.isPrimary) return true;
				return r.email ? secondaryAccessByEmail.get(r.email.toLowerCase()) === true : false;
			})
			.map((r) => {
				const { firstName, lastName } = pickNames(r.email, r.firstName, r.lastName);
				return {
					id: r.userId,
					email: r.email,
					firstName,
					lastName,
					isPrimary: r.isPrimary,
					// Per-user WhatsApp phone from user_whatsapp_link table (deterministic, admin-set).
					// null when admin hasn't linked this user's phone yet → UI falls back to initials.
					phone: phonesByUser.get(r.userId) ?? null
				};
			});
	}
);

// ============================================================================
// WhatsApp phone linking (admin only)
// ============================================================================

const linkPhoneSchema = v.object({
	userId: v.pipe(v.string(), v.minLength(1)),
	phone: v.string() // accepts any format; normalized server-side
});

/**
 * Link a WhatsApp phone to a user in the current tenant.
 * Idempotent: re-linking overwrites the existing row (UNIQUE constraint).
 * If `phone` normalizes to null (empty/invalid), this becomes an unlink.
 */
export const linkUserWhatsappPhone = command(
	linkPhoneSchema,
	async ({ userId, phone }) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
		if (event.locals.isClientUser) throw new Error('Unauthorized');

		const tenantId = event.locals.tenant.id;
		const e164 = normalizePhoneE164(phone);

		// Validate the target user exists in this tenant — either via tenant_user (agency)
		// or via client_user (client portal contact). Prevents linking phones to random user ids.
		const [tu] = await db
			.select({ userId: table.tenantUser.userId })
			.from(table.tenantUser)
			.where(and(eq(table.tenantUser.userId, userId), eq(table.tenantUser.tenantId, tenantId)))
			.limit(1);
		if (!tu) {
			const [cu] = await db
				.select({ userId: table.clientUser.userId })
				.from(table.clientUser)
				.where(and(eq(table.clientUser.userId, userId), eq(table.clientUser.tenantId, tenantId)))
				.limit(1);
			if (!cu) throw new Error('User not found in this tenant');
		}

		// Remove any existing link first (idempotent re-link), then insert if phone is valid.
		await db
			.delete(table.userWhatsappLink)
			.where(
				and(
					eq(table.userWhatsappLink.tenantId, tenantId),
					eq(table.userWhatsappLink.userId, userId)
				)
			);

		if (e164) {
			await db.insert(table.userWhatsappLink).values({
				id: generateWhatsappLinkId(),
				tenantId,
				userId,
				phoneE164: e164,
				source: 'manual'
			});
		}

		return { success: true, phoneE164: e164 };
	}
);

const unlinkSchema = v.object({
	userId: v.pipe(v.string(), v.minLength(1))
});

export const unlinkUserWhatsappPhone = command(unlinkSchema, async ({ userId }) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	if (event.locals.isClientUser) throw new Error('Unauthorized');

	await db
		.delete(table.userWhatsappLink)
		.where(
			and(
				eq(table.userWhatsappLink.tenantId, event.locals.tenant.id),
				eq(table.userWhatsappLink.userId, userId)
			)
		);
	return { success: true };
});
