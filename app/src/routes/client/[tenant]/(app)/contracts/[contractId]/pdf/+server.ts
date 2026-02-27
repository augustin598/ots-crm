import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { generateContractPDF } from '$lib/server/contract-pdf-generator';

export const GET: RequestHandler = async (event) => {
	if (!event.locals.user || !event.locals.isClientUser || !event.locals.client || !event.locals.tenant) {
		throw error(401, 'Unauthorized');
	}

	const contractId = event.params.contractId;
	const tenantId = event.locals.tenant.id;
	const clientId = event.locals.client.id;

	// Scope to both tenant and client so clients can only access their own contracts
	const [contract] = await db
		.select()
		.from(table.contract)
		.where(
			and(
				eq(table.contract.id, contractId),
				eq(table.contract.tenantId, tenantId),
				eq(table.contract.clientId, clientId)
			)
		)
		.limit(1);

	if (!contract) {
		throw error(404, 'Contract not found');
	}

	const lineItems = await db
		.select()
		.from(table.contractLineItem)
		.where(eq(table.contractLineItem.contractId, contractId))
		.orderBy(asc(table.contractLineItem.sortOrder));

	const pdfBuffer = await generateContractPDF({
		contract,
		lineItems,
		tenant: event.locals.tenant,
		client: event.locals.client
	});

	const clientName = (event.locals.client.businessName || event.locals.client.name || 'Client').replace(/[^a-zA-Z0-9-_]/g, '_');
	const safeFilename = `Contract-${contract.contractNumber.replace(/[^a-zA-Z0-9-_]/g, '_')}-${clientName}.pdf`;

	const uint8 = new Uint8Array(pdfBuffer);

	return new Response(uint8, {
		status: 200,
		headers: {
			'Content-Type': 'application/pdf',
			'Content-Disposition': `attachment; filename="${safeFilename}"`,
			'Content-Length': pdfBuffer.length.toString()
		}
	});
};
