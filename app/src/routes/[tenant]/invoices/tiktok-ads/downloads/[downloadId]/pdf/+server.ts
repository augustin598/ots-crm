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
		.from(table.tiktokInvoiceDownload)
		.where(
			and(
				eq(table.tiktokInvoiceDownload.id, downloadId),
				eq(table.tiktokInvoiceDownload.tenantId, tenantId)
			)
		)
		.limit(1);

	if (!row) {
		throw error(404, 'Factură TikTok Ads negăsită');
	}

	if (!row.pdfPath) {
		throw error(404, 'Nu există PDF pentru această factură');
	}

	try {
		const fileBuffer = await getFileBuffer(row.pdfPath);
		const safeFilename = `TikTokAds-Factura-${row.tiktokAdvertiserId}-${row.periodStart}.pdf`;

		return new Response(new Uint8Array(fileBuffer), {
			status: 200,
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': `inline; filename="${safeFilename}"`,
				'Content-Length': fileBuffer.length.toString()
			}
		});
	} catch {
		throw error(404, 'PDF file not found');
	}
};
