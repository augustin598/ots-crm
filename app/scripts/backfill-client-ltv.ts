#!/usr/bin/env bun
/**
 * One-shot backfill: recompute client.ltv_cents for every client across all tenants.
 * Run with: cd app && bun scripts/backfill-client-ltv.ts
 *
 * Idempotent — safe to re-run.
 *
 * NOTE: Self-contained on libSQL (no $env or $lib imports) so it works
 * outside the SvelteKit runtime. The query is identical to the one in
 * src/lib/server/hosting/ltv.ts:recalcClientLTV.
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

const clients = await db.execute('SELECT id, tenant_id, name FROM client ORDER BY tenant_id, name');

console.log(`Recomputing LTV for ${clients.rows.length} clients...`);
let ok = 0;
let err = 0;
let withLtv = 0;
const top: Array<{ name: string; ltv: number }> = [];

for (const c of clients.rows) {
	const id = c.id as string;
	const tenantId = c.tenant_id as string;
	const name = c.name as string;
	try {
		const sumRow = await db.execute({
			sql: `SELECT COALESCE(SUM(total_amount), 0) AS s
			      FROM invoice
			      WHERE tenant_id = ? AND client_id = ? AND status = 'paid'`,
			args: [tenantId, id]
		});
		const ltvCents = Number(sumRow.rows[0]?.s ?? 0);
		await db.execute({
			sql: 'UPDATE client SET ltv_cents = ? WHERE id = ? AND tenant_id = ?',
			args: [ltvCents, id, tenantId]
		});
		ok++;
		if (ltvCents > 0) {
			withLtv++;
			top.push({ name, ltv: ltvCents });
		}
		if (ok % 25 === 0) console.log(`  ${ok}/${clients.rows.length} done...`);
	} catch (e) {
		err++;
		console.error(`  FAILED ${name} (${id}):`, e);
	}
}

console.log(`\nDone. ${ok} ok · ${err} errors · ${withLtv} clients have non-zero LTV.`);

// Top 10 by LTV for sanity check
top.sort((a, b) => b.ltv - a.ltv);
console.log('\nTop 10 by LTV:');
for (const t of top.slice(0, 10)) {
	console.log(`  ${t.name.padEnd(40)} ${(t.ltv / 100).toFixed(2).padStart(12)} RON`);
}

process.exit(err === 0 ? 0 : 1);
