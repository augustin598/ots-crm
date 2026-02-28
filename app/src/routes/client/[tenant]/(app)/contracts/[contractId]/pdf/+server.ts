import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { generateContractPDF } from '$lib/server/contract-pdf-generator';
import * as storage from '$lib/server/storage';

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

	// If this is an uploaded contract, serve the uploaded file directly
	if (contract.uploadedFilePath) {
		const fileBuffer = await storage.getFileBuffer(contract.uploadedFilePath);
		const safeFilename = `Contract-${contract.contractNumber.replace(/[^a-zA-Z0-9-_]/g, '_')}.pdf`;
		const download = event.url.searchParams.get('download') === 'true';
		const disposition = download
			? `attachment; filename="${safeFilename}"`
			: `inline; filename="${safeFilename}"`;

		return new Response(new Uint8Array(fileBuffer), {
			status: 200,
			headers: {
				'Content-Type': contract.uploadedFileMimeType || 'application/pdf',
				'Content-Disposition': disposition,
				'Content-Length': fileBuffer.length.toString()
			}
		});
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

	const download = event.url.searchParams.get('download') === 'true';
	const disposition = download
		? `attachment; filename="${safeFilename}"`
		: `inline; filename="${safeFilename}"`;

	return new Response(uint8, {
		status: 200,
		headers: {
			'Content-Type': 'application/pdf',
			'Content-Disposition': disposition,
			'Content-Length': pdfBuffer.length.toString()
		}
	});
};
