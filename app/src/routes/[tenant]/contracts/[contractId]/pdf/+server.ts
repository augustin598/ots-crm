import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { generateContractPDF } from '$lib/server/contract-pdf-generator';
import { classifyClientVat } from '$lib/server/vat/classify-client';
import * as storage from '$lib/server/storage';

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

	// If this is an uploaded contract, serve the uploaded file directly
	if (contract.uploadedFilePath) {
		try {
			const fileBuffer = await storage.getFileBuffer(contract.uploadedFilePath);
			const safeFilename = `Contract-${contract.contractNumber.replace(/[^a-zA-Z0-9-_]/g, '_')}.pdf`;
			const download = event.url.searchParams.get('download') === 'true';
			const disposition = download
				? `attachment; filename="${safeFilename}"`
				: `inline; filename="${safeFilename}"`;

			return new Response(new Uint8Array(fileBuffer), {
				status: 200,
				headers: {
					'Content-Type': 'application/pdf',
					'Content-Disposition': disposition,
					'Content-Length': fileBuffer.length.toString()
				}
			});
		} catch (err) {
			console.warn(`Uploaded file missing from storage: ${contract.uploadedFilePath}, falling back to PDF generation`);
		}
	}

	const lineItems = await db
		.select()
		.from(table.contractLineItem)
		.where(eq(table.contractLineItem.contractId, contractId))
		.orderBy(asc(table.contractLineItem.sortOrder));

	const [client] = await db
		.select()
		.from(table.client)
		.where(eq(table.client.id, contract.clientId))
		.limit(1);

	if (!client) {
		throw error(404, 'Client not found');
	}

	const [invoiceSettings] = await db
		.select()
		.from(table.invoiceSettings)
		.where(eq(table.invoiceSettings.tenantId, tenantId))
		.limit(1);

	const vatScenario = classifyClientVat({ country: client.country, cui: client.cui });
	const settingsTaxRate = invoiceSettings?.defaultTaxRate ?? 19;
	const effectiveTaxRate = vatScenario === 'ro_domestic' ? settingsTaxRate : 0;

	const pdfBuffer = await generateContractPDF({
		contract,
		lineItems,
		tenant: event.locals.tenant,
		client,
		taxRate: effectiveTaxRate,
		vatScenario
	});

	const clientName = (client.businessName || client.name || 'Client').replace(/[^a-zA-Z0-9-_]/g, '_');
	const safeFilename = `Contract-${contract.contractNumber.replace(/[^a-zA-Z0-9-_]/g, '_')}-${clientName}.pdf`;

	const uint8 = new Uint8Array(pdfBuffer);
	const download = event.url.searchParams.get('download') === 'true';
	const disposition = download ? `attachment; filename="${safeFilename}"` : `inline; filename="${safeFilename}"`;

	return new Response(uint8, {
		status: 200,
		headers: {
			'Content-Type': 'application/pdf',
			'Content-Disposition': disposition,
			'Content-Length': pdfBuffer.length.toString()
		}
	});
};
