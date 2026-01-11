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
	role: v.optional(v.picklist(['owner', 'admin', 'member'], 'Invalid role'))
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

	const { email, role = 'member' } = data;

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
			throw new Error('User is already a member of this organization');
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
		throw new Error('An invitation has already been sent to this email');
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
		expiresAt
	});

	// Send email
	try {
		const inviterName = `${event.locals.user.firstName} ${event.locals.user.lastName}`.trim() || event.locals.user.email;
		await sendInvitationEmail(email, token, event.locals.tenant.name, inviterName);
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
 * Accept an invitation (for logged-in users)
 */
export const acceptInvitation = command(
	v.pipe(v.string(), v.minLength(1)),
	async (token) => {
		const event = getRequestEvent();
		if (!event?.locals.user) {
			throw redirect(302, `/invite/${token}/login`);
		}

		// Get invitation
		const [invitation] = await db
			.select()
			.from(table.invitation)
			.where(eq(table.invitation.token, token))
			.limit(1);

		if (!invitation) {
			throw new Error('Invalid invitation token');
		}

		// Validate invitation
		if (invitation.status !== 'pending') {
			throw new Error(`Invitation has been ${invitation.status}`);
		}

		if (invitation.expiresAt < new Date()) {
			await db
				.update(table.invitation)
				.set({ status: 'expired' })
				.where(eq(table.invitation.id, invitation.id));
			throw new Error('Invitation has expired');
		}

		// Check if email matches (if user has email set)
		if (event.locals.user.email && invitation.email !== event.locals.user.email) {
			throw new Error('This invitation was sent to a different email address');
		}

		// Check if user is already in tenant
		const [existingTenantUser] = await db
			.select()
			.from(table.tenantUser)
			.where(and(eq(table.tenantUser.tenantId, invitation.tenantId), eq(table.tenantUser.userId, event.locals.user.id)))
			.limit(1);

		if (existingTenantUser) {
			// User already in tenant, mark invitation as accepted anyway
			await db
				.update(table.invitation)
				.set({ status: 'accepted', acceptedAt: new Date() })
				.where(eq(table.invitation.id, invitation.id));
			throw new Error('You are already a member of this organization');
		}

		// Create tenantUser relationship
		const tenantUserId = generateInvitationId();
		await db.insert(table.tenantUser).values({
			id: tenantUserId,
			tenantId: invitation.tenantId,
			userId: event.locals.user.id,
			role: invitation.role
		});

		// Mark invitation as accepted
		await db
			.update(table.invitation)
			.set({ status: 'accepted', acceptedAt: new Date() })
			.where(eq(table.invitation.id, invitation.id));

		// Get tenant slug for redirect
		const [tenant] = await db
			.select({ slug: table.tenant.slug })
			.from(table.tenant)
			.where(eq(table.tenant.id, invitation.tenantId))
			.limit(1);

		return { success: true, tenantSlug: tenant?.slug };
	}
);
