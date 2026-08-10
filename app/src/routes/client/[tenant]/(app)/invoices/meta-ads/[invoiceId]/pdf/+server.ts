import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { getFileBuffer } from '$lib/server/storage';
import { getRequestAccessFlags } from '$lib/server/portal-access';

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

	// Build conditions - must belong to this tenant
	let conditions: any = and(
		eq(table.metaAdsSpending.id, spendingId),
		eq(table.metaAdsSpending.tenantId, tenantId)
	);

	// Client users: require a resolved client, scope to it, and enforce the
	// per-user invoices access flag. (app)/+layout.server.ts gates page routes;
	// +server.ts endpoints must enforce explicitly (layouts don't run for them).
	if (event.locals.isClientUser) {
		if (!event.locals.client) throw error(403, 'Acces interzis');
		const flags = await getRequestAccessFlags({
			tenantId,
			clientId: event.locals.client.id,
			userEmail: event.locals.user.email,
			isPrimary: event.locals.clientUser?.isPrimary ?? false
		});
		if (!flags.invoices) throw error(403, 'Nu ai acces la facturi.');
		conditions = and(
			conditions,
			eq(table.metaAdsSpending.clientId, event.locals.client.id)
		);
	}

	const [row] = await db
		.select()
		.from(table.metaAdsSpending)
		.where(conditions)
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
