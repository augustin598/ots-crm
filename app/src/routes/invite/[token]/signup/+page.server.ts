import type { PageServerLoad } from './$types';
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

export const load: PageServerLoad = async ({ params }) => {
	const token = params.token;

	if (!token) {
		return {
			invitation: null as LoadedInvitation | null,
			error: 'Link de invitație invalid.'
		};
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
		return {
			invitation: null as LoadedInvitation | null,
			error: 'Token de invitație invalid.'
		};
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
		return {
			invitation: null as LoadedInvitation | null,
			error: 'Invitația a expirat.'
		};
	}

	if (row.invitation.status === 'cancelled') {
		return {
			invitation: null as LoadedInvitation | null,
			error: 'Această invitație a fost anulată.'
		};
	}

	if (row.invitation.status === 'accepted') {
		return {
			invitation: null as LoadedInvitation | null,
			error: 'Invitația a fost deja acceptată.'
		};
	}

	if (row.invitation.status !== 'pending') {
		return {
			invitation: null as LoadedInvitation | null,
			error: `Invitație inactivă (${row.invitation.status}).`
		};
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
		error: null
	};
};
