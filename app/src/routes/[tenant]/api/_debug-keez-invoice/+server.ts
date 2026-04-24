import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, or } from 'drizzle-orm';
import { createKeezClientForTenant } from '$lib/server/plugins/keez/factory';
import { KeezClientError } from '$lib/server/plugins/keez/errors';
import { isMissingOnKeez } from '$lib/server/plugins/keez/error-classification';
import { logInfo, logWarning } from '$lib/server/logger';
import type { RequestHandler } from './$types';

/**
 * Verify whether a CRM invoice still exists on Keez upstream.
 *
 * GET  ?series=OTS&number=542
 *   → returns { crmInvoice, keezExists, keezStatus, suggest }
 *
 * POST ?series=OTS&number=542  body { purge: true }
 *   → if Keez returns 404, marks invoice cancelled and clears keez fields
 *
 * Until the sync engine grows reconciliation (see PR for soft-delete on
 * disappearance), this endpoint is the operational way to clean up CRM
 * invoices that were deleted on Keez.
 *
 * Admin-only.
 */
async function findInvoice(tenantId: string, series: string | null, number: string) {
	// Two storage shapes co-exist in the DB:
	//   A) split:    invoiceSeries='OTS', invoiceNumber='542'  (manual creation)
	//   B) combined: invoiceSeries=null,  invoiceNumber='OTS 542'  (Keez sync mapper)
	// Match either so the operator doesn't have to know which one applies.
	const combined = series ? `${series} ${number}` : number;
	const matchers = [eq(table.invoice.invoiceNumber, number), eq(table.invoice.invoiceNumber, combined)];
	if (series) {
		matchers.push(
			and(eq(table.invoice.invoiceSeries, series), eq(table.invoice.invoiceNumber, number))!,
		);
	}
	return db
		.select()
		.from(table.invoice)
		.where(and(eq(table.invoice.tenantId, tenantId), or(...matchers)));
}

async function verifyOnKeez(tenantId: string, externalId: string) {
	const [integration] = await db
		.select()
		.from(table.keezIntegration)
		.where(and(eq(table.keezIntegration.tenantId, tenantId), eq(table.keezIntegration.isActive, true)))
		.limit(1);
	if (!integration) {
		return { ok: false as const, reason: 'no active keez integration' };
	}
	const client = await createKeezClientForTenant(tenantId, integration);
	try {
		const remote = await client.getInvoice(externalId);
		return { ok: true as const, exists: true, status: remote?.status, raw: remote };
	} catch (err) {
		if (isMissingOnKeez(err)) {
			const why =
				err instanceof KeezClientError
					? `Keez ${err.status} (VALIDATION_ERROR / nu exista)`
					: '404 Not found';
			return { ok: true as const, exists: false, reason: why };
		}
		return {
			ok: false as const,
			reason: `keez API error (not a recognizable "missing" signal): ${err instanceof Error ? err.message : String(err)}`,
		};
	}
}

function requireAdmin(event: Parameters<RequestHandler>[0]) {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
		throw error(403, 'Forbidden: Admin access required');
	}
}

function parseQuery(event: Parameters<RequestHandler>[0]) {
	const series = event.url.searchParams.get('series');
	const number = event.url.searchParams.get('number');
	if (!number) throw error(400, 'missing ?number= (e.g. ?series=OTS&number=542)');
	return { series, number };
}

export const GET: RequestHandler = async (event) => {
	requireAdmin(event);
	const { series, number } = parseQuery(event);
	const tenantId = event.locals.tenant!.id;

	const matches = await findInvoice(tenantId, series, number);
	if (matches.length === 0) {
		return json({ found: false, message: `no CRM invoice matches series=${series} number=${number}` });
	}
	if (matches.length > 1) {
		return json(
			{
				found: true,
				ambiguous: true,
				count: matches.length,
				matches: matches.map((m) => ({
					id: m.id,
					series: m.invoiceSeries,
					number: m.invoiceNumber,
					status: m.status,
					keezExternalId: m.keezExternalId,
				})),
			},
			{ status: 409 },
		);
	}

	const inv = matches[0];
	if (!inv.keezExternalId) {
		return json({
			found: true,
			invoice: { id: inv.id, status: inv.status, keezExternalId: null },
			keez: { skipped: true, reason: 'invoice has no keezExternalId — never synced' },
			suggest: 'no purge needed',
		});
	}

	const keezResult = await verifyOnKeez(tenantId, inv.keezExternalId);
	const suggest = keezResult.ok && !keezResult.exists ? 'POST with body {"purge":true} to mark cancelled' : 'no action';

	return json({
		found: true,
		invoice: {
			id: inv.id,
			series: inv.invoiceSeries,
			number: inv.invoiceNumber,
			status: inv.status,
			keezExternalId: inv.keezExternalId,
		},
		keez: keezResult,
		suggest,
	});
};

export const POST: RequestHandler = async (event) => {
	requireAdmin(event);
	const { series, number } = parseQuery(event);
	const tenantId = event.locals.tenant!.id;

	const body = await event.request.json().catch(() => ({}));
	if (body?.purge !== true) {
		throw error(400, 'POST body must be {"purge": true}');
	}

	const matches = await findInvoice(tenantId, series, number);
	if (matches.length === 0) throw error(404, `no CRM invoice matches series=${series} number=${number}`);
	if (matches.length > 1) throw error(409, `${matches.length} matches — refine the query`);

	const inv = matches[0];
	if (!inv.keezExternalId) throw error(400, 'invoice has no keezExternalId — nothing to purge');

	const keezResult = await verifyOnKeez(tenantId, inv.keezExternalId);
	if (!keezResult.ok) {
		throw error(502, `cannot verify on Keez (refusing to purge on ambiguous response): ${keezResult.reason}`);
	}
	if (keezResult.exists) {
		throw error(409, `invoice still exists on Keez (status=${keezResult.status}) — refusing to purge`);
	}

	logWarning('keez', `_debug purge: marking invoice cancelled (Keez 404)`, {
		tenantId,
		metadata: { invoiceId: inv.id, series: inv.invoiceSeries, number: inv.invoiceNumber, keezExternalId: inv.keezExternalId },
	});

	await db
		.update(table.invoice)
		.set({ status: 'cancelled', keezInvoiceId: null, keezExternalId: null, updatedAt: new Date() })
		.where(eq(table.invoice.id, inv.id));

	logInfo('keez', `_debug purge: invoice marked cancelled`, {
		tenantId,
		metadata: { invoiceId: inv.id },
	});

	return json({
		purged: true,
		invoice: { id: inv.id, series: inv.invoiceSeries, number: inv.invoiceNumber, newStatus: 'cancelled' },
	});
};
