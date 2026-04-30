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
	// Authorization: must be either a client user OR a tenantUser of this tenant
	if (!event.locals.isClientUser && !event.locals.tenantUser) {
		throw error(403, 'Acces interzis pentru acest tenant');
	}

	const spendingId = event.params.invoiceId;
	const tenantId = event.locals.tenant.id;

	let conditions: any = and(
		eq(table.tiktokAdsSpending.id, spendingId),
		eq(table.tiktokAdsSpending.tenantId, tenantId)
	);

	// Client users can only access their own data
	if (event.locals.isClientUser && event.locals.client) {
		conditions = and(conditions, eq(table.tiktokAdsSpending.clientId, event.locals.client.id));
	}

	const [row] = await db
		.select()
		.from(table.tiktokAdsSpending)
		.where(conditions)
		.limit(1);

	if (!row) {
		throw error(404, 'Raport cheltuieli TikTok Ads negăsit');
	}

	if (!row.pdfPath) {
		throw error(404, 'Nu există PDF pentru acest raport');
	}

	try {
		const fileBuffer = await getFileBuffer(row.pdfPath);
		const safeFilename = `TikTokAds-Cheltuieli-${row.periodStart}.pdf`;

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
