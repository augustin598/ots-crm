import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { getFileBuffer } from '$lib/server/storage';
import { readFile, stat } from 'fs/promises';
import { join, basename } from 'path';

export const GET: RequestHandler = async (event) => {
	if (!event.locals.user || !event.locals.tenant) {
		throw error(401, 'Unauthorized');
	}

	const invoiceId = event.params.invoiceId;
	const tenantId = event.locals.tenant.id;

	const [invoice] = await db
		.select()
		.from(table.supplierInvoice)
		.where(
			and(
				eq(table.supplierInvoice.id, invoiceId),
				eq(table.supplierInvoice.tenantId, tenantId)
			)
		)
		.limit(1);

	if (!invoice) {
		throw error(404, 'Supplier invoice not found');
	}

	if (!invoice.pdfPath) {
		throw error(404, 'No PDF available for this invoice');
	}

	let fileBuffer: Buffer;

	// Try MinIO first (new storage), then filesystem (legacy)
	try {
		fileBuffer = await getFileBuffer(invoice.pdfPath);
	} catch {
		// Fallback: try reading from local filesystem
		try {
			const absolutePath = join(process.cwd(), invoice.pdfPath);
			const fileStat = await stat(absolutePath);
			const MAX_SIZE = 50 * 1024 * 1024;
			if (fileStat.size > MAX_SIZE) {
				throw error(413, 'File too large');
			}
			fileBuffer = await readFile(absolutePath);
		} catch (err: any) {
			if (err.status) throw err;
			throw error(404, 'PDF file not found');
		}
	}
	const safeFilename = `Factura-Furnizor-${(invoice.invoiceNumber || invoice.id).replace(/[^a-zA-Z0-9-_]/g, '_')}.pdf`;

	return new Response(new Uint8Array(fileBuffer), {
		status: 200,
		headers: {
			'Content-Type': 'application/pdf',
			'Content-Disposition': `inline; filename="${safeFilename}"`,
			'Content-Length': fileBuffer.length.toString()
		}
	});
};
