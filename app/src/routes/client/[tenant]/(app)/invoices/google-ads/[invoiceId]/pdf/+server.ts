import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { getFileBuffer } from '$lib/server/storage';
import { readFile, stat } from 'fs/promises';

export const GET: RequestHandler = async (event) => {
	if (!event.locals.user || !event.locals.tenant) {
		throw error(401, 'Unauthorized');
	}

	const invoiceId = event.params.invoiceId;
	const tenantId = event.locals.tenant.id;

	// Build conditions - must belong to this tenant
	let conditions: any = and(
		eq(table.googleAdsInvoice.id, invoiceId),
		eq(table.googleAdsInvoice.tenantId, tenantId)
	);

	// If client user, also filter by their clientId
	if (event.locals.isClientUser && event.locals.client) {
		conditions = and(
			conditions,
			eq(table.googleAdsInvoice.clientId, event.locals.client.id)
		);
	}

	const [invoice] = await db
		.select()
		.from(table.googleAdsInvoice)
		.where(conditions)
		.limit(1);

	if (!invoice) {
		throw error(404, 'Google Ads invoice not found');
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
			const { join } = await import('path');
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

	const safeFilename = `GoogleAds-${(invoice.invoiceNumber || invoice.id).replace(/[^a-zA-Z0-9-_]/g, '_')}.pdf`;

	return new Response(new Uint8Array(fileBuffer), {
		status: 200,
		headers: {
			'Content-Type': 'application/pdf',
			'Content-Disposition': `inline; filename="${safeFilename}"`,
			'Content-Length': fileBuffer.length.toString()
		}
	});
};
