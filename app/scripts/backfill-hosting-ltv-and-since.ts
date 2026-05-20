#!/usr/bin/env bun
/**
 * Hosting-specific backfill: rewrites client.ltv_cents and client.client_since
 * from invoices that contain at least one hosting line item.
 *
 * "Hosting invoice" = at least one of:
 *   - line item description LIKE '%gazduire%'   (Romanian, no diacritic)
 *   - line item description LIKE '%găzduire%'   (Romanian, with diacritic)
 *   - line item description LIKE '%gasduire%'   (common Romanian typo)
 *   - line item description LIKE '%gaduire%'    (common Romanian typo)
 *   - line item description LIKE '%hosting%'    (English / "Web Hosting")
 *   - line item description LIKE '%wordpress%'  (Wordpress_Standard, Wordpress_Pro, Wordpress_Extreme, …)
 *   - invoice.hosting_account_id IS NOT NULL    (recurring invoice generated for a hosting account)
 *
 * For each client:
 *   - ltv_cents     = SUM(invoice.total_amount) where status='paid' AND has hosting line item
 *   - client_since  = MIN(invoice.issue_date)   where invoice has hosting line item
 *
 * Run with: cd app && bun scripts/backfill-hosting-ltv-and-since.ts
 *
 * Idempotent — recomputes from scratch.
 */
import { createClient } from '@libsql/client';

const env = process.env;
if (!env.SQLITE_URI) {
	console.error('SQLITE_URI not set. Source .env first: `set -a && source .env && set +a`');
	process.exit(1);
}

const db = createClient({
	url: env.SQLITE_URI,
	authToken: env.SQLITE_AUTH_TOKEN
});

// 1. Pull all clients (id + tenant)
const clients = await db.execute('SELECT id, tenant_id, name FROM client ORDER BY tenant_id, name');
console.log(`Processing ${clients.rows.length} clients...\n`);

// 2. For each client compute hosting LTV + hosting since
let withLtv = 0;
let withSince = 0;
const top: Array<{ name: string; ltv: number; since: string }> = [];

for (const c of clients.rows) {
	const id = c.id as string;
	const tenantId = c.tenant_id as string;
	const name = c.name as string;

	// Hosting LTV (paid invoices with hosting line item)
	const ltvRow = await db.execute({
		sql: `
			SELECT COALESCE(SUM(i.total_amount), 0) AS s
			FROM invoice i
			WHERE i.tenant_id = ?
			  AND i.client_id = ?
			  AND i.status = 'paid'
			  AND (
			    i.hosting_account_id IS NOT NULL
			    OR EXISTS (
			      SELECT 1 FROM invoice_line_item li
			      WHERE li.invoice_id = i.id
			        AND (
			          LOWER(li.description) LIKE '%gazduire%'
			          OR LOWER(li.description) LIKE '%găzduire%'
			          OR LOWER(li.description) LIKE '%gasduire%'
			          OR LOWER(li.description) LIKE '%gaduire%'
			          OR LOWER(li.description) LIKE '%hosting%'
			          OR LOWER(li.description) LIKE '%wordpress%'
			        )
			    )
			  )
		`,
		args: [tenantId, id]
	});
	const ltvCents = Number(ltvRow.rows[0]?.s ?? 0);

	// Hosting client_since (earliest hosting invoice issued, any status)
	const sinceRow = await db.execute({
		sql: `
			SELECT MIN(i.issue_date) AS first
			FROM invoice i
			WHERE i.tenant_id = ?
			  AND i.client_id = ?
			  AND i.issue_date IS NOT NULL
			  AND (
			    i.hosting_account_id IS NOT NULL
			    OR EXISTS (
			      SELECT 1 FROM invoice_line_item li
			      WHERE li.invoice_id = i.id
			        AND (
			          LOWER(li.description) LIKE '%gazduire%'
			          OR LOWER(li.description) LIKE '%găzduire%'
			          OR LOWER(li.description) LIKE '%gasduire%'
			          OR LOWER(li.description) LIKE '%gaduire%'
			          OR LOWER(li.description) LIKE '%hosting%'
			          OR LOWER(li.description) LIKE '%wordpress%'
			        )
			    )
			  )
		`,
		args: [tenantId, id]
	});
	const sinceRaw = sinceRow.rows[0]?.first as string | null;
	const hostingSince = sinceRaw ? String(sinceRaw).slice(0, 10) : null;

	// Update only what we have hosting evidence for
	if (ltvCents > 0 || hostingSince) {
		await db.execute({
			sql: `UPDATE client
			      SET ltv_cents = ?,
			          client_since = COALESCE(?, client_since)
			      WHERE id = ? AND tenant_id = ?`,
			args: [ltvCents, hostingSince, id, tenantId]
		});
		if (ltvCents > 0) withLtv++;
		if (hostingSince) withSince++;
		top.push({ name, ltv: ltvCents, since: hostingSince ?? '?' });
	} else {
		// No hosting invoices — zero out LTV (was generic LTV before)
		await db.execute({
			sql: 'UPDATE client SET ltv_cents = 0 WHERE id = ? AND tenant_id = ?',
			args: [id, tenantId]
		});
	}
}

console.log(`Done. ${withLtv} clients with hosting LTV > 0 · ${withSince} with hosting client_since.\n`);

top.sort((a, b) => b.ltv - a.ltv);
console.log('Top 15 hosting clients by LTV:');
for (const t of top.slice(0, 15)) {
	console.log(
		`  ${t.name.padEnd(40)} ${(t.ltv / 100).toFixed(2).padStart(12)} RON  ·  since ${t.since}`
	);
}

process.exit(0);
