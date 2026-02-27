import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { generateContractPDF } from '$lib/server/contract-pdf-generator';

export const GET: RequestHandler = async (event) => {
	if (!event.locals.user || !event.locals.tenant) {
		throw error(401, 'Unauthorized');
	}

	const contractId = event.params.contractId;
	const tenantId = event.locals.tenant.id;

	const [contract] = await db
		.select()
		.from(table.contract)
		.where(and(eq(table.contract.id, contractId), eq(table.contract.tenantId, tenantId)))
		.limit(1);

	if (!contract) {
		throw error(404, 'Contract not found');
	}

	const lineItems = await db
		.select()
		.from(table.contractLineItem)
		.where(eq(table.contractLineItem.contractId, contractId))
		.orderBy(asc(table.contractLineItem.id));

	const [client] = await db
		.select()
		.from(table.client)
		.where(eq(table.client.id, contract.clientId))
		.limit(1);

	if (!client) {
		throw error(404, 'Client not found');
	}

	const pdfBuffer = await generateContractPDF({
		contract,
		lineItems,
		tenant: event.locals.tenant,
		client
	});

	const clientName = (client.businessName || client.name || 'Client').replace(/[^a-zA-Z0-9-_]/g, '_');
	const safeFilename = `Contract-${contract.contractNumber.replace(/[^a-zA-Z0-9-_]/g, '_')}-${clientName}.pdf`;

	const uint8 = new Uint8Array(pdfBuffer);
	const inline = event.url.searchParams.get('inline') === 'true';
	const disposition = inline ? `inline; filename="${safeFilename}"` : `attachment; filename="${safeFilename}"`;

	return new Response(uint8, {
		status: 200,
		headers: {
			'Content-Type': 'application/pdf',
			'Content-Disposition': disposition,
			'Content-Length': pdfBuffer.length.toString()
		}
	});
};
