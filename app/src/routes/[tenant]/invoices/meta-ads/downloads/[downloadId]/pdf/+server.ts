import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { getFileBuffer } from '$lib/server/storage';

export const GET: RequestHandler = async (event) => {
	if (!event.locals.user || !event.locals.tenant) {
		throw error(401, 'Unauthorized');
	}

	const downloadId = event.params.downloadId;
	const tenantId = event.locals.tenant.id;

	const [row] = await db
		.select()
		.from(table.metaInvoiceDownload)
		.where(
			and(
				eq(table.metaInvoiceDownload.id, downloadId),
				eq(table.metaInvoiceDownload.tenantId, tenantId)
			)
		)
		.limit(1);

	if (!row) {
		throw error(404, 'Factură Meta Ads negăsită');
	}

	if (!row.pdfPath) {
		throw error(404, 'Nu există PDF pentru această factură');
	}

	try {
		const fileBuffer = await getFileBuffer(row.pdfPath);
		const safeFilename = `MetaAds-Factura-${row.metaAdAccountId}-${row.periodStart}.pdf`;

		return new Response(new Uint8Array(fileBuffer), {
			status: 200,
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': `inline; filename="${safeFilename}"`,
				'Content-Length': fileBuffer.length.toString()
			}
		});
	} catch (err) {
		console.error(`[META-PDF] Failed to read PDF for download ${downloadId}: ${err instanceof Error ? err.message : String(err)}`);
		throw error(404, 'PDF file not found');
	}
};
