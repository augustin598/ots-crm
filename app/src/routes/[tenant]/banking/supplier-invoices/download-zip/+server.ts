import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { getFileBuffer } from '$lib/server/storage';
import { readFile } from 'fs/promises';
import { join } from 'path';
import JSZip from 'jszip';

export const POST: RequestHandler = async (event) => {
	if (!event.locals.user || !event.locals.tenant) {
		throw error(401, 'Unauthorized');
	}

	const body = await event.request.json();
	const invoiceIds: string[] = body.invoiceIds;

	if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
		throw error(400, 'No invoice IDs provided');
	}

	if (invoiceIds.length > 200) {
		throw error(400, 'Too many invoices selected (max 200)');
	}

	const tenantId = event.locals.tenant.id;

	const invoices = await db
		.select({
			id: table.supplierInvoice.id,
			pdfPath: table.supplierInvoice.pdfPath,
			invoiceNumber: table.supplierInvoice.invoiceNumber,
			supplierType: table.supplierInvoice.supplierType
		})
		.from(table.supplierInvoice)
		.where(
			and(
				inArray(table.supplierInvoice.id, invoiceIds),
				eq(table.supplierInvoice.tenantId, tenantId)
			)
		);

	const zip = new JSZip();
	let addedFiles = 0;

	for (const invoice of invoices) {
		if (!invoice.pdfPath) continue;

		try {
			let buffer: Buffer;
			try {
				buffer = await getFileBuffer(invoice.pdfPath);
			} catch {
				// Fallback: try filesystem (legacy)
				const absolutePath = join(process.cwd(), invoice.pdfPath);
				buffer = await readFile(absolutePath);
			}
			const filename = `${invoice.supplierType || 'invoice'}_${invoice.invoiceNumber || invoice.id}.pdf`.replace(/[^a-zA-Z0-9-_.]/g, '_');
			zip.file(filename, buffer);
			addedFiles++;
		} catch {
			console.warn(`[Download ZIP] Could not read PDF: ${invoice.pdfPath}`);
		}
	}

	if (addedFiles === 0) {
		throw error(404, 'No PDF files found for selected invoices');
	}

	const zipBuffer = await zip.generateAsync({ type: 'uint8array' });
	const date = new Date().toISOString().slice(0, 10);

	return new Response(zipBuffer as unknown as BodyInit, {
		status: 200,
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename="facturi-furnizori-${date}.zip"`,
			'Content-Length': zipBuffer.length.toString()
		}
	});
};
