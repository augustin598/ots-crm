/**
 * Backfill `invoice.hosting_account_id` for invoices generated from hosting recurring
 * templates BEFORE the fix that propagates the FK landed (Phase 1.2 of the addendum
 * dated 2026-05-12).
 *
 * Why this matters: the DirectAdmin suspend hook keys off `invoice.hostingAccountId` to
 * pick the granular path (suspend ONLY this account vs. all client accounts). Without
 * the FK, every overdue invoice falls back to client-wide suspend, which can suspend
 * unrelated hosting accounts.
 *
 * Strategy: there is no explicit `invoice.recurringInvoiceId` column, so we use a 1:1
 * heuristic on (clientId, currency, amount). For each candidate, we accept ONLY if
 * exactly ONE recurring template matches. Ambiguous matches are logged as warnings and
 * skipped — operator can inspect manually.
 *
 * Pure ADDITIVE — never modifies description, never re-pushes to Keez. Setting the FK
 * is safe for invoices in any Keez state (Draft / Valid / Cancelled).
 *
 * Usage:
 *   bun run scripts/backfill-hosting-invoice-fk.ts --dry-run
 *   bun run scripts/backfill-hosting-invoice-fk.ts --apply
 */

import 'dotenv/config';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from '../src/lib/server/db/schema.ts';
import { and, eq, isNull, isNotNull } from 'drizzle-orm';

const DRY_RUN = process.argv.includes('--dry-run');
const APPLY = process.argv.includes('--apply');
if (!DRY_RUN && !APPLY) {
	console.error('Usage: bun run scripts/backfill-hosting-invoice-fk.ts [--dry-run|--apply]');
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

async function main() {
	const orphanInvoices = await db
		.select({
			id: schema.invoice.id,
			invoiceNumber: schema.invoice.invoiceNumber,
			tenantId: schema.invoice.tenantId,
			clientId: schema.invoice.clientId,
			currency: schema.invoice.currency,
			amount: schema.invoice.amount
		})
		.from(schema.invoice)
		.where(isNull(schema.invoice.hostingAccountId));

	console.log(`[backfill] ${orphanInvoices.length} invoice(s) without hosting_account_id (scanning for hosting candidates)`);

	let matched = 0;
	let ambiguous = 0;
	let unmatched = 0;

	for (const inv of orphanInvoices) {
		const candidates = await db
			.select({
				hostingAccountId: schema.recurringInvoice.hostingAccountId,
				templateId: schema.recurringInvoice.id
			})
			.from(schema.recurringInvoice)
			.where(
				and(
					isNotNull(schema.recurringInvoice.hostingAccountId),
					eq(schema.recurringInvoice.tenantId, inv.tenantId),
					eq(schema.recurringInvoice.clientId, inv.clientId),
					eq(schema.recurringInvoice.currency, inv.currency),
					eq(schema.recurringInvoice.amount, inv.amount)
				)
			);

		if (candidates.length === 0) {
			unmatched++;
			continue; // not a hosting invoice — leave alone
		}
		if (candidates.length > 1) {
			const ids = candidates.map((c) => c.hostingAccountId).join(', ');
			console.warn(
				`[backfill] AMBIGUOUS: invoice ${inv.invoiceNumber} (${inv.id}) matches ${candidates.length} hosting templates: ${ids}. SKIPPING.`
			);
			ambiguous++;
			continue;
		}
		const target = candidates[0].hostingAccountId!;
		if (DRY_RUN) {
			console.log(`[dry-run] invoice ${inv.invoiceNumber} (${inv.id}) ← hosting_account_id = ${target}`);
		} else {
			await db
				.update(schema.invoice)
				.set({ hostingAccountId: target, updatedAt: new Date() })
				.where(eq(schema.invoice.id, inv.id));
			console.log(`[apply] invoice ${inv.invoiceNumber} ← ${target}`);
		}
		matched++;
	}

	console.log(`\n[summary] matched: ${matched}, ambiguous (skipped): ${ambiguous}, non-hosting (skipped): ${unmatched}`);
	if (!APPLY) {
		console.log('[backfill] dry-run complete. Pass --apply to write.');
	}
}

main()
	.catch((e) => {
		console.error('[backfill] failed:', e);
		process.exit(1);
	})
	.finally(() => client.close());
