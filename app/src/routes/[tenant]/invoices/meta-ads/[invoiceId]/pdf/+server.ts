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

	const spendingId = event.params.invoiceId;
	const tenantId = event.locals.tenant.id;

	const [row] = await db
		.select()
		.from(table.metaAdsSpending)
		.where(
			and(
				eq(table.metaAdsSpending.id, spendingId),
				eq(table.metaAdsSpending.tenantId, tenantId)
			)
		)
		.limit(1);

	if (!row) {
		throw error(404, 'Raport cheltuieli Meta Ads negăsit');
	}

	if (!row.pdfPath) {
		throw error(404, 'Nu există PDF pentru acest raport');
	}

	try {
		const fileBuffer = await getFileBuffer(row.pdfPath);
		const safeFilename = `MetaAds-Cheltuieli-${row.periodStart}.pdf`;

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
