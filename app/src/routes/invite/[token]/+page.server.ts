import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';

type LoadedInvitation = {
	id: string;
	email: string;
	role: string;
	department: string | null;
	title: string | null;
	expiresAt: Date;
	tenant: { id: string; name: string; slug: string };
	invitedBy: {
		id: string;
		email: string;
		firstName: string | null;
		lastName: string | null;
	};
};

type LoadResult = {
	invitation: LoadedInvitation | null;
	error: string | null;
	isLoggedIn: boolean;
	loggedInEmail: string | null;
	emailMismatch: boolean;
	alreadyMember: boolean;
	memberTenantSlug: string | null;
};

export const load: PageServerLoad = async ({ params, locals }): Promise<LoadResult> => {
	const token = params.token;
	const isLoggedIn = !!locals.user;
	const loggedInEmail = locals.user?.email ?? null;

	const baseEmpty = {
		invitation: null,
		isLoggedIn,
		loggedInEmail,
		emailMismatch: false,
		alreadyMember: false,
		memberTenantSlug: null
	} as const;

	if (!token) {
		return { ...baseEmpty, error: 'Link de invitație invalid.' };
	}

	const [row] = await db
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

	if (!row) {
		return { ...baseEmpty, error: 'Token de invitație invalid.' };
	}

	if (row.invitation.expiresAt < new Date()) {
		try {
			await db
				.update(table.invitation)
				.set({ status: 'expired' })
				.where(eq(table.invitation.id, row.invitation.id));
		} catch {
			// ignore
		}
		return { ...baseEmpty, error: 'Invitația a expirat.' };
	}

	if (row.invitation.status === 'cancelled') {
		return { ...baseEmpty, error: 'Această invitație a fost anulată.' };
	}
	if (row.invitation.status === 'accepted') {
		return { ...baseEmpty, error: 'Invitația a fost deja acceptată.' };
	}
	if (row.invitation.status === 'expired') {
		return { ...baseEmpty, error: 'Invitația a expirat.' };
	}
	if (row.invitation.status !== 'pending') {
		return { ...baseEmpty, error: `Invitație inactivă (${row.invitation.status}).` };
	}

	const invEmail = row.invitation.email.trim().toLowerCase();
	const userEmail = (loggedInEmail ?? '').trim().toLowerCase();
	const emailMismatch = isLoggedIn && userEmail !== invEmail;

	// If logged-in user is already a member of this tenant — show "already member"
	let alreadyMember = false;
	let memberTenantSlug: string | null = null;
	if (isLoggedIn && locals.user) {
		const [existing] = await db
			.select({ slug: table.tenant.slug })
			.from(table.tenantUser)
			.innerJoin(table.tenant, eq(table.tenant.id, table.tenantUser.tenantId))
			.where(
				and(
					eq(table.tenantUser.tenantId, row.tenant.id),
					eq(table.tenantUser.userId, locals.user.id),
					eq(table.tenantUser.status, 'active')
				)
			)
			.limit(1);
		if (existing) {
			alreadyMember = true;
			memberTenantSlug = existing.slug;
		}
	}

	return {
		invitation: {
			id: row.invitation.id,
			email: row.invitation.email,
			role: row.invitation.role,
			department: row.invitation.department,
			title: row.invitation.title,
			expiresAt: row.invitation.expiresAt,
			tenant: row.tenant,
			invitedBy: row.invitedBy
		},
		error: null,
		isLoggedIn,
		loggedInEmail,
		emailMismatch,
		alreadyMember,
		memberTenantSlug
	};
};
