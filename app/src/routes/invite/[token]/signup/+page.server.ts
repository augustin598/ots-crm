import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

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
	emailExists: boolean;
};

export const load: PageServerLoad = async ({ params, locals }): Promise<LoadResult> => {
	const token = params.token;

	if (!token) {
		return { invitation: null, error: 'Link de invitație invalid.', emailExists: false };
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
		return { invitation: null, error: 'Token de invitație invalid.', emailExists: false };
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
		return { invitation: null, error: 'Invitația a expirat.', emailExists: false };
	}

	if (row.invitation.status === 'cancelled') {
		return {
			invitation: null,
			error: 'Această invitație a fost anulată.',
			emailExists: false
		};
	}

	if (row.invitation.status === 'accepted') {
		return {
			invitation: null,
			error: 'Invitația a fost deja acceptată.',
			emailExists: false
		};
	}

	if (row.invitation.status !== 'pending') {
		return {
			invitation: null,
			error: `Invitație inactivă (${row.invitation.status}).`,
			emailExists: false
		};
	}

	// Check if a user with this email already exists. If yes, signup will fail —
	// redirect them back to /invite/<token> with a hint to use Login.
	const [existing] = await db
		.select({ id: table.user.id })
		.from(table.user)
		.where(eq(table.user.email, row.invitation.email))
		.limit(1);

	const emailExists = !!existing;

	// If user is already logged in, redirect to the accept page
	if (locals.user) {
		throw redirect(302, `/invite/${token}`);
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
		} satisfies LoadedInvitation,
		error: null,
		emailExists
	};
};
