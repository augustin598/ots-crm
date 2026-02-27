import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { encodeHexLowerCase } from '@oslojs/encoding';
import { sha256 } from '@oslojs/crypto/sha2';
import { generateContractPDF } from '$lib/server/contract-pdf-generator';

function hashToken(token: string): string {
	return encodeHexLowerCase(sha256(new TextEncoder().encode(token)));
}

export const GET: RequestHandler = async ({ params }) => {
	// Find tenant by slug
	const [tenant] = await db
		.select()
		.from(table.tenant)
		.where(eq(table.tenant.slug, params.tenant))
		.limit(1);

	if (!tenant) {
		throw error(400, 'Link invalid');
	}

	const hashed = hashToken(params.token);

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

	if (!signToken) {
		throw error(400, 'Link invalid');
	}
	if (signToken.used || signToken.expiresAt < new Date()) {
		throw error(400, 'Link expirat');
	}

	const [contract] = await db
		.select()
		.from(table.contract)
		.where(eq(table.contract.id, signToken.contractId))
		.limit(1);

	if (!contract) {
		throw error(404, 'Contract not found');
	}

	const lineItems = await db
		.select()
		.from(table.contractLineItem)
		.where(eq(table.contractLineItem.contractId, contract.id))
		.orderBy(asc(table.contractLineItem.id));

	const [client] = await db
		.select()
		.from(table.client)
		.where(eq(table.client.id, contract.clientId))
		.limit(1);

	if (!client) {
		throw error(404, 'Client not found');
	}

	const pdfBuffer = await generateContractPDF({ contract, lineItems, tenant, client });
	const uint8 = new Uint8Array(pdfBuffer);

	return new Response(uint8, {
		status: 200,
		headers: {
			'Content-Type': 'application/pdf',
			'Content-Disposition': 'inline',
			'Content-Length': pdfBuffer.length.toString()
		}
	});
};
