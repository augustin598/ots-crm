import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { createKeezClientForTenant } from '$lib/server/plugins/keez/factory';
import { classifyKeezError } from '$lib/server/plugins/keez/error-classification';
import { getNextInvoiceNumberFromPlugin } from '$lib/server/invoice-utils';
import type { RequestHandler } from './$types';

/**
 * Diagnostic for the hosting invoice numbering bug.
 *
 *   GET /[tenant]/api/_debug-next-hosting-invoice-number
 *
 * Returns the configured Keez series (default + hosting), the raw next number
 * Keez would assign for each, and what `getNextInvoiceNumberFromPlugin` resolves
 * to in both hosting and non-hosting modes. Operator uses this to confirm:
 *
 *   - `keezApi.hosting` returns an integer (Keez reachable on the hosting series)
 *   - `plugin.hosting` is `"<keezSeriesHosting> <keezApi.hosting>"` — i.e. our
 *     helper resolves to the hosting series, not the default series.
 *   - The fallback chain (used when Keez is unreachable) lands on
 *     `keezLastSyncedNumberHosting` / `keezStartNumberHosting` for hosting and
 *     on the default columns for non-hosting.
 *
 * Admin-only. No side effects.
 */
export const GET: RequestHandler = async (event) => {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	const role = event.locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') {
		throw error(403, 'Forbidden: Admin access required');
	}
	const tenantId = event.locals.tenant.id;

	const [settings] = await db
		.select()
		.from(table.invoiceSettings)
		.where(eq(table.invoiceSettings.tenantId, tenantId))
		.limit(1);
	if (!settings) {
		return json({
			ok: false,
			reason: 'no invoice_settings row for tenant — configure /[tenant]/settings/keez first'
		});
	}

	const keezDefault = settings.keezSeries?.trim() || null;
	const keezHosting = settings.keezSeriesHosting?.trim() || null;

	// Probe Keez directly for both series.
	const keezApi: {
		default: number | null;
		hosting: number | null;
		defaultError?: string;
		hostingError?: string;
	} = { default: null, hosting: null };

	// Latest invoice metadata per series (the row Keez returns when ordering by
	// number desc, count=1). Operator uses this to confirm the most recent OTSH
	// number, when it was issued, to whom, and for how much — without needing
	// to log into the Keez UI.
	const latest: {
		default: unknown;
		hosting: unknown;
		defaultError?: string;
		hostingError?: string;
	} = { default: null, hosting: null };

	const [integration] = await db
		.select()
		.from(table.keezIntegration)
		.where(
			and(eq(table.keezIntegration.tenantId, tenantId), eq(table.keezIntegration.isActive, true))
		)
		.limit(1);
	if (integration) {
		const client = await createKeezClientForTenant(tenantId, integration);
		if (keezDefault) {
			try {
				keezApi.default = await client.getNextInvoiceNumber(keezDefault);
			} catch (err) {
				keezApi.defaultError = `${classifyKeezError(err)}: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`;
			}
			try {
				const resp = await client.getInvoices({
					count: 1,
					filter: `series eq '${keezDefault.replace(/'/g, "''")}'`,
					order: 'number desc'
				});
				latest.default = resp.data?.[0] ?? null;
			} catch (err) {
				latest.defaultError = err instanceof Error ? err.message.slice(0, 200) : String(err);
			}
		}
		if (keezHosting) {
			try {
				keezApi.hosting = await client.getNextInvoiceNumber(keezHosting);
			} catch (err) {
				keezApi.hostingError = `${classifyKeezError(err)}: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`;
			}
			try {
				const resp = await client.getInvoices({
					count: 1,
					filter: `series eq '${keezHosting.replace(/'/g, "''")}'`,
					order: 'number desc'
				});
				latest.hosting = resp.data?.[0] ?? null;
			} catch (err) {
				latest.hostingError = err instanceof Error ? err.message.slice(0, 200) : String(err);
			}
		}
	}

	// Run the plugin helper in both modes.
	const plugin = {
		default: await getNextInvoiceNumberFromPlugin(tenantId).catch((e) => `error: ${e}`),
		hosting: await getNextInvoiceNumberFromPlugin(tenantId, undefined, { isHosting: true }).catch(
			(e) => `error: ${e}`
		)
	};

	return json({
		ok: true,
		tenantId,
		settings: {
			keezSeries: settings.keezSeries,
			keezSeriesHosting: settings.keezSeriesHosting,
			keezLastSyncedNumber: settings.keezLastSyncedNumber,
			keezStartNumber: settings.keezStartNumber,
			keezLastSyncedNumberHosting: settings.keezLastSyncedNumberHosting,
			keezStartNumberHosting: settings.keezStartNumberHosting
		},
		keezApi,
		latest,
		plugin,
		// Documentation hint inline so the operator doesn't need a doc lookup.
		expected: {
			beforeFix:
				'plugin.hosting returned a number formatted with the DEFAULT series (e.g. "OTS 567"), not the hosting series.',
			afterFix:
				'plugin.hosting returns "<keezSeriesHosting> <keezApi.hosting>" — same numeric value as keezApi.hosting, hosting series prefix.'
		}
	});
};
