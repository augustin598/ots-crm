import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { readFile, stat } from 'fs/promises';
import { join } from 'path';

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

	const absolutePath = join(process.cwd(), row.pdfPath);

	try {
		const fileStat = await stat(absolutePath);
		const MAX_SIZE = 50 * 1024 * 1024;
		if (fileStat.size > MAX_SIZE) {
			throw error(413, 'File too large');
		}
	} catch (err: any) {
		if (err.status) throw err;
		throw error(404, 'PDF file not found on disk');
	}

	const fileBuffer = await readFile(absolutePath);
	const safeFilename = `MetaAds-Cheltuieli-${row.periodStart}.pdf`;

	return new Response(new Uint8Array(fileBuffer), {
		status: 200,
		headers: {
			'Content-Type': 'application/pdf',
			'Content-Disposition': `inline; filename="${safeFilename}"`,
			'Content-Length': fileBuffer.length.toString()
		}
	});
};
