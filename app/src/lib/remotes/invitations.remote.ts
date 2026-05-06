import { command, query, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, or } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { randomBytes } from 'crypto';
import { sendInvitationEmail } from '$lib/server/email';
import { redirect } from '@sveltejs/kit';

function generateInvitationId() {
	const bytes = randomBytes(15);
	return encodeBase32LowerCase(bytes);
}

function generateInvitationToken() {
	return randomBytes(32).toString('hex');
}

const sendInvitationSchema = v.object({
	email: v.pipe(v.string(), v.email('Invalid email address')),
	role: v.optional(v.picklist(['admin', 'manager', 'member', 'viewer'], 'Invalid role')),
	department: v.optional(
		v.union([v.picklist(['ads', 'sales', 'dev', 'finance', 'support', 'ops']), v.null()])
	),
	title: v.optional(v.union([v.pipe(v.string(), v.maxLength(120)), v.null()]))
});

/**
 * Send an invitation to join the tenant
 */
export const sendInvitation = command(sendInvitationSchema, async (data) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	// Only owners and admins can invite
	if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
		throw new Error('Insufficient permissions');
	}

	const { email: rawEmail, role = 'member', department = null, title = null } = data;
	const email = rawEmail.trim().toLowerCase();

	// Prevent self-invitation — actor's own email cannot be invited
	if (event.locals.user.email && event.locals.user.email.toLowerCase() === email) {
		throw new Error('Nu îți poți trimite invitație ție însuți.');
	}

	// Check if user already exists and is in tenant
	const [existingUser] = await db
		.select()
		.from(table.user)
		.where(eq(table.user.email, email))
		.limit(1);

	if (existingUser) {
		// Check if user is already in tenant
		const [existingTenantUser] = await db
			.select()
			.from(table.tenantUser)
			.where(and(eq(table.tenantUser.tenantId, event.locals.tenant.id), eq(table.tenantUser.userId, existingUser.id)))
			.limit(1);

		if (existingTenantUser) {
			throw new Error('Acest email este deja membru în organizație.');
		}
	}

	// Check for pending invitation
	const [pendingInvitation] = await db
		.select()
		.from(table.invitation)
		.where(
			and(
				eq(table.invitation.tenantId, event.locals.tenant.id),
				eq(table.invitation.email, email),
				eq(table.invitation.status, 'pending')
			)
		)
		.limit(1);

	if (pendingInvitation) {
		throw new Error('Există deja o invitație în așteptare pentru acest email.');
	}

	// Generate token and create invitation
	const invitationId = generateInvitationId();
	const token = generateInvitationToken();
	const expiresAt = new Date();
	expiresAt.setDate(expiresAt.getDate() + 7); // 7 days from now

	await db.insert(table.invitation).values({
		id: invitationId,
		tenantId: event.locals.tenant.id,
		email,
		role,
		token,
		invitedByUserId: event.locals.user.id,
		status: 'pending',
		expiresAt,
		department,
		title
	});

	// Send email
	try {
		const inviterName = `${event.locals.user.firstName} ${event.locals.user.lastName}`.trim() || event.locals.user.email;
		await sendInvitationEmail(email, token, event.locals.tenant.name, inviterName, event.locals.tenant.id);
	} catch (error) {
		// If email fails, delete the invitation
		await db.delete(table.invitation).where(eq(table.invitation.id, invitationId));
		throw new Error('Failed to send invitation email');
	}

	return { success: true, invitationId };
});

/**
 * Get all invitations for the current tenant
 */
export const getInvitations = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	// Only owners and admins can view invitations
	if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
		throw new Error('Insufficient permissions');
	}

	const invitations = await db
		.select({
			invitation: table.invitation,
			invitedBy: {
				id: table.user.id,
				email: table.user.email,
				firstName: table.user.firstName,
				lastName: table.user.lastName
			}
		})
		.from(table.invitation)
		.innerJoin(table.user, eq(table.invitation.invitedByUserId, table.user.id))
		.where(eq(table.invitation.tenantId, event.locals.tenant.id))
		.orderBy(table.invitation.createdAt);

	return invitations.map(({ invitation, invitedBy }) => ({
		...invitation,
		invitedBy
	}));
});

/**
 * Cancel an invitation
 */
export const cancelInvitation = command(
	v.pipe(v.string(), v.minLength(1)),
	async (invitationId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Only owners and admins can cancel invitations
		if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
			throw new Error('Insufficient permissions');
		}

		// Verify invitation belongs to tenant and is pending
		const [invitation] = await db
			.select()
			.from(table.invitation)
			.where(
				and(
					eq(table.invitation.id, invitationId),
					eq(table.invitation.tenantId, event.locals.tenant.id),
					eq(table.invitation.status, 'pending')
				)
			)
			.limit(1);

		if (!invitation) {
			throw new Error('Invitation not found or already processed');
		}

		await db
			.update(table.invitation)
			.set({ status: 'cancelled' })
			.where(eq(table.invitation.id, invitationId));

		return { success: true };
	}
);

/**
 * Get invitation by token (public, no auth required)
 */
export const getInvitationByToken = query(
	v.pipe(v.string(), v.minLength(1)),
	async (token) => {
		const [invitation] = await db
		.select({
			invitation: table.invitation,
			tenant: {
				id: table.tenant.id,
				name: table.tenant.name,
				slug: table.tenant.slug
			},
			invitedBy: {
				id: table.user.id,
				email: table.user.email,
				firstName: table.user.firstName,
				lastName: table.user.lastName
			}
		})
			.from(table.invitation)
			.innerJoin(table.tenant, eq(table.invitation.tenantId, table.tenant.id))
			.innerJoin(table.user, eq(table.invitation.invitedByUserId, table.user.id))
			.where(eq(table.invitation.token, token))
			.limit(1);

		if (!invitation) {
			throw new Error('Invalid invitation token');
		}

		// Check if expired
		if (invitation.invitation.expiresAt < new Date()) {
			// Mark as expired
			await db
				.update(table.invitation)
				.set({ status: 'expired' })
				.where(eq(table.invitation.id, invitation.invitation.id));
			throw new Error('Invitation has expired');
		}

		// Check if already accepted or cancelled
		if (invitation.invitation.status !== 'pending') {
			throw new Error(`Invitation has been ${invitation.invitation.status}`);
		}

		return {
			...invitation.invitation,
			tenant: invitation.tenant,
			invitedBy: invitation.invitedBy
		};
	}
);

/**
 * Accept an invitation (for logged-in users).
 *
 * Validations (în ordine):
 *   1. User autenticat
 *   2. Token există
 *   3. Status === 'pending'
 *   4. Nu a expirat
 *   5. Email-ul utilizatorului logat = email-ul invitației (case-insensitive)
 *   6. User nu e deja tenantUser pentru acest tenant
 *   7. Inserează tenantUser și marchează invitația ca acceptată într-o
 *      singură tranzacție (atomic — fără stări parțiale)
 */
export const acceptInvitation = command(
	v.pipe(v.string(), v.minLength(1)),
	async (token) => {
		const event = getRequestEvent();
		if (!event?.locals.user) {
			throw redirect(302, `/invite/${token}/login`);
		}
		const actorUser = event.locals.user;

		// Get invitation
		const [invitation] = await db
			.select()
			.from(table.invitation)
			.where(eq(table.invitation.token, token))
			.limit(1);

		if (!invitation) {
			throw new Error('Token de invitație invalid.');
		}

		// Validate invitation
		if (invitation.status === 'cancelled') {
			throw new Error('Această invitație a fost anulată.');
		}
		if (invitation.status === 'accepted') {
			throw new Error('Invitația a fost deja acceptată.');
		}
		if (invitation.status === 'expired') {
			throw new Error('Invitația a expirat.');
		}
		if (invitation.status !== 'pending') {
			throw new Error(`Invitație inactivă (${invitation.status}).`);
		}

		if (invitation.expiresAt < new Date()) {
			await db
				.update(table.invitation)
				.set({ status: 'expired' })
				.where(eq(table.invitation.id, invitation.id));
			throw new Error('Invitația a expirat.');
		}

		// Email match check (case-insensitive). Required — accepting on
		// behalf of someone else creates security & ownership issues.
		const userEmail = (actorUser.email ?? '').trim().toLowerCase();
		const invEmail = invitation.email.trim().toLowerCase();
		if (!userEmail) {
			throw new Error('Contul tău nu are email setat. Contactează administratorul.');
		}
		if (invEmail !== userEmail) {
			throw new Error(
				`Această invitație a fost trimisă către ${invitation.email}, dar ești logat ca ${actorUser.email}. Loghează-te cu contul corect.`
			);
		}

		// Check if user is already in tenant
		const [existingTenantUser] = await db
			.select()
			.from(table.tenantUser)
			.where(
				and(
					eq(table.tenantUser.tenantId, invitation.tenantId),
					eq(table.tenantUser.userId, actorUser.id)
				)
			)
			.limit(1);

		if (existingTenantUser) {
			// Already a member — mark invitation as accepted (idempotent) and
			// return success. Do NOT throw, because user clicked "accept" and
			// the desired end-state (membership) already exists.
			if (invitation.status === 'pending') {
				await db
					.update(table.invitation)
					.set({ status: 'accepted', acceptedAt: new Date() })
					.where(eq(table.invitation.id, invitation.id));
			}
			const [tenant] = await db
				.select({ slug: table.tenant.slug })
				.from(table.tenant)
				.where(eq(table.tenant.id, invitation.tenantId))
				.limit(1);
			return { success: true, tenantSlug: tenant?.slug, alreadyMember: true };
		}

		// Get tenant slug
		const [tenant] = await db
			.select({ slug: table.tenant.slug })
			.from(table.tenant)
			.where(eq(table.tenant.id, invitation.tenantId))
			.limit(1);

		if (!tenant) {
			throw new Error('Organizația nu mai există.');
		}

		// Atomic: create tenantUser + mark invitation accepted
		const tenantUserId = generateInvitationId();
		await db.transaction(async (tx) => {
			await tx.insert(table.tenantUser).values({
				id: tenantUserId,
				tenantId: invitation.tenantId,
				userId: actorUser.id,
				role: invitation.role,
				department: invitation.department ?? null,
				title: invitation.title ?? null,
				status: 'active'
			});
			await tx
				.update(table.invitation)
				.set({ status: 'accepted', acceptedAt: new Date() })
				.where(eq(table.invitation.id, invitation.id));
		});

		return { success: true, tenantSlug: tenant.slug };
	}
);
