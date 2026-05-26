#!/usr/bin/env bun
/**
 * One-shot backfill for the May 2026 Comenzi hosting redesign.
 *
 * Run: `cd app && bun run scripts/backfill-hosting-order-numbers-and-items.ts`
 *
 * Idempotent — safe to re-run. Numbers rows that already have `order_number`
 * are skipped; inquiries that already have at least one item row are skipped.
 *
 * Order of operations matters: we run this AFTER migrations 0381-0385 have
 * been applied and BEFORE deploying code that depends on either column being
 * populated.
 *
 * NOTE: Self-contained on libSQL (no $env or $lib imports) so it works
 * outside the SvelteKit runtime — same pattern as backfill-client-ltv.ts.
 */
import { createClient } from '@libsql/client';
import { encodeBase32LowerCase } from '@oslojs/encoding';

const env = process.env;
if (!env.SQLITE_URI) {
	console.error('SQLITE_URI not set. Source .env first: `set -a && source .env && set +a`');
	process.exit(1);
}

const db = createClient({
	url: env.SQLITE_URI,
	authToken: env.SQLITE_AUTH_TOKEN
});

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

async function main(): Promise<void> {
	let numbered = 0;
	let synthesized = 0;

	// 1. Assign order_number to rows missing one, grouped by tenant.
	const tenantsWithMissing = await db.execute(
		`SELECT DISTINCT tenant_id FROM hosting_inquiry WHERE order_number IS NULL`
	);

	for (const t of tenantsWithMissing.rows) {
		const tenantId = t.tenant_id as string;

		const rows = await db.execute({
			sql: `SELECT id FROM hosting_inquiry
			      WHERE tenant_id = ? AND order_number IS NULL
			      ORDER BY created_at`,
			args: [tenantId]
		});

		const maxRes = await db.execute({
			sql: `SELECT COALESCE(MAX(order_number), 0) AS max_n FROM hosting_inquiry WHERE tenant_id = ?`,
			args: [tenantId]
		});
		let n = Number(maxRes.rows[0]?.max_n ?? 0);

		for (const row of rows.rows) {
			n += 1;
			await db.execute({
				sql: `UPDATE hosting_inquiry SET order_number = ? WHERE id = ?`,
				args: [n, row.id as string]
			});
			numbered += 1;
		}
	}

	console.log(`[backfill] Assigned order_number to ${numbered} rows.`);

	// 2. Synthesize one 'hosting' item per inquiry that has zero items today.
	const missing = await db.execute(`
		SELECT hi.id, hi.tenant_id, hi.hosting_product_id,
		       hp.name AS product_name, hp.price AS product_price, hp.billing_cycle AS product_cycle
		FROM hosting_inquiry hi
		LEFT JOIN hosting_product hp ON hp.id = hi.hosting_product_id
		WHERE NOT EXISTS (
			SELECT 1 FROM hosting_inquiry_item WHERE inquiry_id = hi.id
		)
	`);

	for (const r of missing.rows) {
		// Skip inquiries with no product (legacy contact-form submissions that
		// never picked a product). These render in the UI as "—" pachet and the
		// drawer line-items section is empty — acceptable.
		const productPrice = r.product_price as number | null;
		const productName = r.product_name as string | null;
		if (!productPrice || !productName) continue;

		const period = r.product_cycle === 'yearly' ? 'anual' : 'lunar';
		await db.execute({
			sql: `INSERT INTO hosting_inquiry_item
			      (id, inquiry_id, tenant_id, kind, label, hosting_product_id, unit_price_cents, quantity, vat_rate)
			      VALUES (?, ?, ?, 'hosting', ?, ?, ?, 1, 19)`,
			args: [
				generateId(),
				r.id as string,
				r.tenant_id as string,
				`${productName} (${period})`,
				(r.hosting_product_id as string | null) ?? null,
				productPrice
			]
		});
		synthesized += 1;
	}

	console.log(`[backfill] Synthesized ${synthesized} hosting items.`);
	console.log('[backfill] Done.');
}

main()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error('[backfill] FAILED:', err);
		process.exit(1);
	});
