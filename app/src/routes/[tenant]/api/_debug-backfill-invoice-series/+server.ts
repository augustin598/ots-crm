/**
 * Backfill `invoice.invoiceSeries` from the prefix of `invoiceNumber` for legacy
 * hosting invoices. Aligns the CRM column with the series Keez has already used
 * to push these invoices.
 *
 *   POST /[tenant]/api/_debug-backfill-invoice-series            (dry-run; default)
 *   POST /[tenant]/api/_debug-backfill-invoice-series?apply=true (mutate)
 *
 * Only operates on:
 *   invoiceSeries IS NULL AND keezExternalId IS NOT NULL AND hostingAccountId IS NOT NULL
 *
 * Series is extracted as the alphabetic prefix of `invoiceNumber` when the
 * shape is "<SERIES> <NUMBER>" (Keez convention from generateKeezInvoiceNumber).
 * Synthetic numbers like "INV-1234567890" are skipped.
 *
 * Admin-only.
 */

import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { logInfo, serializeError, logWarning } from '$lib/server/logger';
import type { RequestHandler } from './$types';

interface BackfillEntry {
	id: string;
	invoiceNumber: string;
	extractedSeries: string;
}

interface SkipEntry {
	id: string;
	invoiceNumber: string;
	reason: string;
}

export const POST: RequestHandler = async (event) => {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	const role = event.locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') {
		throw error(403, 'Forbidden: Admin access required');
	}
	const tenantId = event.locals.tenant.id;
	const apply = event.url.searchParams.get('apply') === 'true';

	const candidates = await db
		.select({
			id: table.invoice.id,
			invoiceNumber: table.invoice.invoiceNumber
		})
		.from(table.invoice)
		.where(
			and(
				eq(table.invoice.tenantId, tenantId),
				isNotNull(table.invoice.hostingAccountId),
				isNull(table.invoice.invoiceSeries),
				isNotNull(table.invoice.keezExternalId)
			)
		);

	const willBackfill: BackfillEntry[] = [];
	const willSkip: SkipEntry[] = [];

	for (const inv of candidates) {
		if (!inv.invoiceNumber) {
			willSkip.push({ id: inv.id, invoiceNumber: '(null)', reason: 'no_invoice_number' });
			continue;
		}
		const parts = inv.invoiceNumber.split(' ');
		if (parts.length !== 2 || !/^[A-Z][A-Z0-9-]*$/i.test(parts[0])) {
			willSkip.push({
				id: inv.id,
				invoiceNumber: inv.invoiceNumber,
				reason: 'invoice_number_not_in_series_format'
			});
			continue;
		}
		willBackfill.push({
			id: inv.id,
			invoiceNumber: inv.invoiceNumber,
			extractedSeries: parts[0]
		});
	}

	let applied = 0;
	if (apply && willBackfill.length > 0) {
		for (const entry of willBackfill) {
			try {
				await db
					.update(table.invoice)
					.set({ invoiceSeries: entry.extractedSeries, updatedAt: new Date() })
					.where(
						and(eq(table.invoice.id, entry.id), eq(table.invoice.tenantId, tenantId))
					);
				applied++;
			} catch (err) {
				const e = serializeError(err);
				logWarning(
					'directadmin',
					`Backfill invoiceSeries failed for ${entry.id} (${entry.invoiceNumber}): ${e.message}`,
					{ tenantId, metadata: { invoiceId: entry.id }, stackTrace: e.stack }
				);
				willSkip.push({
					id: entry.id,
					invoiceNumber: entry.invoiceNumber,
					reason: `update_failed: ${e.message}`
				});
			}
		}
	}

	logInfo(
		'directadmin',
		`Backfill invoiceSeries (apply=${apply}): ${willBackfill.length} candidates, ${applied} applied, ${willSkip.length} skipped`,
		{ tenantId, action: 'backfill_invoice_series' }
	);

	return json({
		ok: true,
		apply,
		tenantId,
		candidates: candidates.length,
		willBackfillCount: willBackfill.length,
		willSkipCount: willSkip.length,
		applied,
		willBackfill,
		willSkip
	});
};
