/**
 * Populate `recurring_invoice.line_items_json` for hosting templates that were created
 * before the WHMCS import fix shipped (Phase 1.1 of the addendum dated 2026-05-12).
 *
 * Without this column, the detail page `/<tenant>/invoices/recurring/<id>` shows
 * "No items yet" for hosting recurring templates, and the scheduler falls back to a
 * generic single-line invoice using `recurring_invoice.name`.
 *
 * Strategy: pure SELECT → conditional UPDATE. Idempotent (the WHERE excludes already-
 * populated rows). Safe to re-run.
 *
 * Usage:
 *   bun run scripts/backfill-hosting-recurring-line-items.ts --dry-run
 *   bun run scripts/backfill-hosting-recurring-line-items.ts --apply
 */

import 'dotenv/config';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from '../src/lib/server/db/schema.ts';
import { eq, isNotNull } from 'drizzle-orm';

const DRY_RUN = process.argv.includes('--dry-run');
const APPLY = process.argv.includes('--apply');
if (!DRY_RUN && !APPLY) {
	console.error('Usage: bun run scripts/backfill-hosting-recurring-line-items.ts [--dry-run|--apply]');
	process.exit(1);
}

if (!process.env.SQLITE_URI || !process.env.SQLITE_AUTH_TOKEN) {
	throw new Error('SQLITE_URI / SQLITE_AUTH_TOKEN not set');
}

const client = createClient({
	url: process.env.SQLITE_URI,
	authToken: process.env.SQLITE_AUTH_TOKEN
});
const db = drizzle(client, { schema });

async function getTaxRatePercent(tenantId: string): Promise<number> {
	const [s] = await db
		.select({ defaultTaxRate: schema.invoiceSettings.defaultTaxRate })
		.from(schema.invoiceSettings)
		.where(eq(schema.invoiceSettings.tenantId, tenantId))
		.limit(1);
	return s?.defaultTaxRate ?? 21;
}

async function main() {
	// Re-run mode: by default backfills only rows with NULL lineItemsJson. Pass --refresh-vat
	// to ALSO refresh rows whose stored taxRate is stale vs. invoiceSettings.defaultTaxRate
	// (use after a VAT change like 19% → 21%).
	const REFRESH_VAT = process.argv.includes('--refresh-vat');

	const allHosting = await db
		.select({
			id: schema.recurringInvoice.id,
			tenantId: schema.recurringInvoice.tenantId,
			amount: schema.recurringInvoice.amount,
			currency: schema.recurringInvoice.currency,
			taxRate: schema.recurringInvoice.taxRate,
			lineItemsJson: schema.recurringInvoice.lineItemsJson,
			hostingAccountId: schema.recurringInvoice.hostingAccountId,
			domain: schema.hostingAccount.domain,
			daPackageName: schema.hostingAccount.daPackageName
		})
		.from(schema.recurringInvoice)
		.innerJoin(
			schema.hostingAccount,
			eq(schema.hostingAccount.id, schema.recurringInvoice.hostingAccountId)
		)
		.where(isNotNull(schema.recurringInvoice.hostingAccountId));

	// Per-tenant cache so we don't refetch invoiceSettings for every row.
	const taxByTenant = new Map<string, number>();
	const getCachedTax = async (tenantId: string) => {
		if (!taxByTenant.has(tenantId)) {
			taxByTenant.set(tenantId, await getTaxRatePercent(tenantId));
		}
		return taxByTenant.get(tenantId)!;
	};

	const candidates: typeof allHosting = [];
	for (const row of allHosting) {
		const expectedBps = (await getCachedTax(row.tenantId)) * 100;
		const needsLineItems = row.lineItemsJson === null;
		const vatStale = REFRESH_VAT && row.taxRate !== expectedBps;
		if (needsLineItems || vatStale) candidates.push(row);
	}

	console.log(`[backfill] ${candidates.length} hosting recurring template(s) need refresh (mode: ${REFRESH_VAT ? 'lineItems + VAT' : 'lineItems only'})`);
	if (candidates.length === 0) {
		console.log('[backfill] nothing to do.');
		return;
	}

	let updated = 0;
	for (const row of candidates) {
		const taxRatePercent = await getCachedTax(row.tenantId);
		const taxRateBps = taxRatePercent * 100;
		const baseDescription = row.daPackageName
			? `${row.daPackageName} - ${row.domain}`
			: `Hosting - ${row.domain}`;
		const lineItem = {
			description: baseDescription,
			quantity: 1,
			rate: row.amount / 100, // currency units (NOT cents — invoice-utils multiplies by 100)
			taxRate: taxRatePercent,
			currency: row.currency,
			unitOfMeasure: 'Buc'
		};
		const lineItemsJson = JSON.stringify([lineItem]);

		if (DRY_RUN) {
			console.log(`[dry-run] ${row.id} ← ${baseDescription} @ ${taxRatePercent}% VAT (${row.amount / 100} ${row.currency})`);
		} else {
			await db
				.update(schema.recurringInvoice)
				.set({ lineItemsJson, taxRate: taxRateBps, updatedAt: new Date() })
				.where(eq(schema.recurringInvoice.id, row.id));
			console.log(`[apply] ${row.id} ← ${baseDescription} @ ${taxRatePercent}% VAT`);
			updated++;
		}
	}

	if (APPLY) {
		console.log(`[backfill] done. ${updated} row(s) updated.`);
	} else {
		console.log(`[backfill] dry-run complete. Pass --apply to write.`);
	}
}

main()
	.catch((e) => {
		console.error('[backfill] failed:', e);
		process.exit(1);
	})
	.finally(() => client.close());
