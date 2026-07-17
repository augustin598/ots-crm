/**
 * Patch stale DRAFT hosting invoices in-place. Useful after a VAT rate change
 * (19% → 21%), a catalog price update, or a series-column backfill regression.
 *
 *   POST /[tenant]/api/_debug-cleanup-hosting-drafts            (dry-run; default)
 *   POST /[tenant]/api/_debug-cleanup-hosting-drafts?apply=true (mutate)
 *
 * Only operates on:
 *   status = 'draft' AND keezExternalId IS NULL AND hostingAccountId IS NOT NULL
 *
 * Per-invoice patches (applied in order):
 *   1. taxRate drift: if invoice.taxRate / 100 !== invoiceSettings.defaultTaxRate,
 *      update taxRate + recompute taxAmount + totalAmount.
 *   2. amount drift: if invoice.amount !== hostingAccount.recurringAmount (or the
 *      effective catalog price when hostingProductId is set), update amount +
 *      recompute taxAmount + totalAmount.
 *   3. missing series: if invoiceSeries IS NULL and invoiceNumber looks like
 *      "<SERIES> <NUM>" (Keez format), extract the prefix and write it.
 *
 * Does NOT regenerate invoiceIds (preserves any email links already sent to
 * clients). Admin-only.
 */

import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { resolveVatPercent } from '$lib/server/vat/rate';
import * as table from '$lib/server/db/schema';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { logInfo, logWarning, serializeError } from '$lib/server/logger';
import { getLatestBnrRate } from '$lib/server/bnr/client';
import type { RequestHandler } from './$types';

interface PatchChange {
	field: 'taxRate' | 'amount' | 'invoiceSeries' | 'taxAmount' | 'totalAmount';
	before: number | string | null;
	after: number | string | null;
}

interface PatchedInvoice {
	id: string;
	invoiceNumber: string;
	hostingAccountId: string | null;
	changes: PatchChange[];
}

interface SkippedInvoice {
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

	// Tenant invoice settings (VAT rate is source of truth).
	const [settings] = await db
		.select({ defaultTaxRate: table.invoiceSettings.defaultTaxRate })
		.from(table.invoiceSettings)
		.where(eq(table.invoiceSettings.tenantId, tenantId))
		.limit(1);

	const tenantTaxRatePercent = resolveVatPercent(settings?.defaultTaxRate);
	const tenantTaxRateBps = tenantTaxRatePercent * 100;

	// All draft hosting invoices that haven't been pushed to Keez.
	const candidates = await db
		.select({
			id: table.invoice.id,
			invoiceNumber: table.invoice.invoiceNumber,
			invoiceSeries: table.invoice.invoiceSeries,
			amount: table.invoice.amount,
			taxRate: table.invoice.taxRate,
			taxAmount: table.invoice.taxAmount,
			totalAmount: table.invoice.totalAmount,
			invoiceCurrency: table.invoice.currency,
			hostingAccountId: table.invoice.hostingAccountId,
			haAmount: table.hostingAccount.recurringAmount,
			haHostingProductId: table.hostingAccount.hostingProductId,
			productPrice: table.hostingProduct.price,
			productCurrency: table.hostingProduct.currency
		})
		.from(table.invoice)
		.leftJoin(
			table.hostingAccount,
			eq(table.invoice.hostingAccountId, table.hostingAccount.id)
		)
		.leftJoin(
			table.hostingProduct,
			eq(table.hostingAccount.hostingProductId, table.hostingProduct.id)
		)
		.where(
			and(
				eq(table.invoice.tenantId, tenantId),
				eq(table.invoice.status, 'draft'),
				isNull(table.invoice.keezExternalId),
				isNotNull(table.invoice.hostingAccountId)
			)
		);

	const patched: PatchedInvoice[] = [];
	const skipped: SkippedInvoice[] = [];

	for (const inv of candidates) {
		const changes: PatchChange[] = [];
		let newAmount = inv.amount ?? 0;
		let newTaxRate = inv.taxRate ?? 0;
		let newTaxAmount = inv.taxAmount ?? 0;
		let newTotalAmount = inv.totalAmount ?? 0;
		let newSeries: string | null = inv.invoiceSeries;

		// 1. Tax rate drift
		if (inv.taxRate !== tenantTaxRateBps) {
			changes.push({ field: 'taxRate', before: inv.taxRate, after: tenantTaxRateBps });
			newTaxRate = tenantTaxRateBps;
		}

		// 2. Amount drift — single source of truth is the catalog (hostingProduct.price).
		// When invoice currency differs from catalog currency, convert via BNR
		// (catalog RON → invoice EUR for intracom clients, etc.).
		if (inv.productPrice && inv.productPrice > 0) {
			const catalogCurrency = (inv.productCurrency || 'RON').toUpperCase();
			const invoiceCurrency = (inv.invoiceCurrency || 'RON').toUpperCase();
			let catalogAmountInInvoiceCurrency: number | null = inv.productPrice;
			if (catalogCurrency !== invoiceCurrency) {
				catalogAmountInInvoiceCurrency = await convertCentsViaBnr(
					inv.productPrice,
					catalogCurrency,
					invoiceCurrency
				);
			}
			if (
				catalogAmountInInvoiceCurrency !== null &&
				inv.amount !== catalogAmountInInvoiceCurrency
			) {
				changes.push({
					field: 'amount',
					before: inv.amount,
					after: catalogAmountInInvoiceCurrency
				});
				newAmount = catalogAmountInInvoiceCurrency;
			}
		}

		// Recompute tax + total when either taxRate or amount changed.
		if (changes.some((c) => c.field === 'taxRate' || c.field === 'amount')) {
			const recomputedTax = Math.round((newAmount * newTaxRate) / 10000);
			const recomputedTotal = newAmount + recomputedTax;
			if (recomputedTax !== inv.taxAmount) {
				changes.push({ field: 'taxAmount', before: inv.taxAmount, after: recomputedTax });
				newTaxAmount = recomputedTax;
			}
			if (recomputedTotal !== inv.totalAmount) {
				changes.push({ field: 'totalAmount', before: inv.totalAmount, after: recomputedTotal });
				newTotalAmount = recomputedTotal;
			}
		}

		// 3. Missing series — extract from invoiceNumber if it's the Keez "<SERIES> <NUM>" shape.
		if (!inv.invoiceSeries && inv.invoiceNumber) {
			const parts = inv.invoiceNumber.split(' ');
			if (parts.length === 2 && /^[A-Z][A-Z0-9-]*$/i.test(parts[0])) {
				changes.push({ field: 'invoiceSeries', before: null, after: parts[0] });
				newSeries = parts[0];
			}
		}

		if (changes.length === 0) {
			skipped.push({
				id: inv.id,
				invoiceNumber: inv.invoiceNumber,
				reason: 'no_drift_detected'
			});
			continue;
		}

		patched.push({
			id: inv.id,
			invoiceNumber: inv.invoiceNumber,
			hostingAccountId: inv.hostingAccountId,
			changes
		});

		if (apply) {
			try {
				await db
					.update(table.invoice)
					.set({
						amount: newAmount,
						taxRate: newTaxRate,
						taxAmount: newTaxAmount,
						totalAmount: newTotalAmount,
						invoiceSeries: newSeries,
						updatedAt: new Date()
					})
					.where(
						and(eq(table.invoice.id, inv.id), eq(table.invoice.tenantId, tenantId))
					);
			} catch (err) {
				const e = serializeError(err);
				logWarning(
					'directadmin',
					`Cleanup draft ${inv.id} (${inv.invoiceNumber}) UPDATE failed: ${e.message}`,
					{ tenantId, metadata: { invoiceId: inv.id }, stackTrace: e.stack }
				);
				skipped.push({
					id: inv.id,
					invoiceNumber: inv.invoiceNumber,
					reason: `update_failed: ${e.message}`
				});
			}
		}
	}

	logInfo(
		'directadmin',
		`Cleanup hosting drafts (apply=${apply}): ${patched.length} patched, ${skipped.length} skipped, candidates=${candidates.length}`,
		{ tenantId, action: 'cleanup_hosting_drafts' }
	);

	return json({
		ok: true,
		apply,
		tenantId,
		candidates: candidates.length,
		patchedCount: patched.length,
		skippedCount: skipped.length,
		patched,
		skipped
	});
};

/**
 * Convert `cents` from `fromCurrency` to `toCurrency` using the latest BNR rate.
 * Mirrors the helper in `hosting/recurring-template.ts` so cleanup ends up at
 * the same amount that sync would produce. Returns null if a needed rate is
 * missing (caller treats as "leave the invoice alone").
 */
async function convertCentsViaBnr(
	cents: number,
	fromCurrency: string,
	toCurrency: string
): Promise<number | null> {
	const F = fromCurrency.toUpperCase();
	const T = toCurrency.toUpperCase();
	if (F === T) return cents;

	let cents_ron: number;
	if (F === 'RON') {
		cents_ron = cents;
	} else {
		const fromRate = await getLatestBnrRate(F);
		if (!fromRate || fromRate <= 0) return null;
		cents_ron = Math.round(cents * fromRate);
	}
	if (T === 'RON') return cents_ron;
	const toRate = await getLatestBnrRate(T);
	if (!toRate || toRate <= 0) return null;
	return Math.round(cents_ron / toRate);
}
