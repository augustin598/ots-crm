import type { Actions, PageServerLoad } from './$types';
import { error, fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { encodeHexLowerCase } from '@oslojs/encoding';
import { sha256 } from '@oslojs/crypto/sha2';

function hashToken(token: string): string {
	return encodeHexLowerCase(sha256(new TextEncoder().encode(token)));
}

async function resolveTokenAndContract(tenantParam: string, rawToken: string) {
	// Find tenant by slug
	const [tenant] = await db
		.select()
		.from(table.tenant)
		.where(eq(table.tenant.slug, tenantParam))
		.limit(1);

	if (!tenant) return null;

	const hashed = hashToken(rawToken);

	const [signToken] = await db
		.select()
		.from(table.contractSignToken)
		.where(
			and(
				eq(table.contractSignToken.token, hashed),
				eq(table.contractSignToken.tenantId, tenant.id)
			)
		)
		.limit(1);

	if (!signToken) return null;
	if (signToken.used) return { expired: true } as const;
	if (signToken.expiresAt < new Date()) return { expired: true } as const;

	const [contract] = await db
		.select()
		.from(table.contract)
		.where(eq(table.contract.id, signToken.contractId))
		.limit(1);

	if (!contract) return null;

	const [client] = await db
		.select()
		.from(table.client)
		.where(eq(table.client.id, contract.clientId))
		.limit(1);

	return { tenant, signToken, contract, client };
}

export const load: PageServerLoad = async ({ params }) => {
	const result = await resolveTokenAndContract(params.tenant, params.token);

	if (!result) {
		throw error(400, 'Link invalid');
	}

	if ('expired' in result) {
		throw error(400, 'Link invalid sau expirat');
	}

	const { tenant, contract, client } = result;

	return {
		contract: {
			id: contract.id,
			contractNumber: contract.contractNumber,
			contractTitle: contract.contractTitle,
			contractDate: contract.contractDate?.toISOString() ?? null,
			status: contract.status,
			beneficiarSignatureName: contract.beneficiarSignatureName,
			beneficiarSignedAt: contract.beneficiarSignedAt?.toISOString() ?? null
		},
		tenant: {
			name: tenant.name,
			email: tenant.email,
			city: tenant.city
		},
		client: {
			name: client?.businessName || client?.name || '',
			email: client?.email || ''
		}
	};
};

export const actions: Actions = {
	sign: async ({ params, request }) => {
		const formData = await request.formData();
		const signatureName = (formData.get('signatureName') as string)?.trim();
		const signatureImage = (formData.get('signatureImage') as string) || '';

		if (!signatureName || signatureName.length < 1) {
			return fail(400, { error: 'Numele este obligatoriu' });
		}
		if (signatureName.length > 100) {
			return fail(400, { error: 'Numele este prea lung (max 100 caractere)' });
		}
		if (!signatureImage.startsWith('data:image/png;base64,')) {
			return fail(400, { error: 'Semnătura desenată este obligatorie' });
		}
		if (signatureImage.length > 700000) {
			return fail(400, { error: 'Imaginea semnăturii este prea mare' });
		}

		const result = await resolveTokenAndContract(params.tenant, params.token);

		if (!result || 'expired' in result) {
			return fail(400, { error: 'Link invalid sau expirat' });
		}

		const { signToken, contract } = result;

		// Mark token as used
		await db
			.update(table.contractSignToken)
			.set({ used: true, usedAt: new Date() })
			.where(eq(table.contractSignToken.id, signToken.id));

		// Save signature and mark contract as signed
		await db
			.update(table.contract)
			.set({
				beneficiarSignatureName: signatureName,
				beneficiarSignatureImage: signatureImage,
				beneficiarSignedAt: new Date(),
				status: 'signed',
				updatedAt: new Date()
			})
			.where(eq(table.contract.id, contract.id));

		return { success: true, signatureName };
	}
};
