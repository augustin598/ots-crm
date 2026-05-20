#!/usr/bin/env bun
/**
 * One-shot backfill: set client.tier based on LTV and account health.
 * Run with: cd app && bun scripts/backfill-client-tier.ts
 *
 * Rules:
 *   - tier = 'vip'      → ltv_cents >= VIP_THRESHOLD_CENTS
 *   - tier = 'watch'    → at least one suspended hosting account OR overdue invoice
 *   - tier = 'standard' → everyone else
 *
 * Idempotent — safe to re-run. Resets prior assignments first.
 */
import { createClient } from '@libsql/client';

const VIP_THRESHOLD_CENTS = 5_000_000; // 50.000 RON

const env = process.env;
if (!env.SQLITE_URI) {
	console.error('SQLITE_URI not set. Source .env first: `set -a && source .env && set +a`');
	process.exit(1);
}

const db = createClient({
	url: env.SQLITE_URI,
	authToken: env.SQLITE_AUTH_TOKEN
});

// 1. Reset all non-standard tiers
await db.execute('UPDATE client SET tier = "standard" WHERE tier != "standard"');

// 2. Promote high-LTV clients to VIP
const promote = await db.execute({
	sql: 'UPDATE client SET tier = "vip" WHERE ltv_cents >= ?',
	args: [VIP_THRESHOLD_CENTS]
});
console.log(`Promoted to VIP: ${promote.rowsAffected} (threshold: ${VIP_THRESHOLD_CENTS / 100} RON)`);

// 3. Flag at-risk clients as watch
const watch = await db.execute(`
  UPDATE client
  SET tier = "watch"
  WHERE tier = "standard"
    AND (
      id IN (SELECT DISTINCT client_id FROM hosting_account WHERE status = "suspended" AND client_id IS NOT NULL)
      OR id IN (SELECT DISTINCT client_id FROM invoice WHERE status = "overdue" AND due_date < strftime("%Y-%m-%d", "now"))
    )
`);
console.log(`Set to watch: ${watch.rowsAffected}`);

// 4. Summary
const summary = await db.execute('SELECT tier, COUNT(*) AS n FROM client GROUP BY tier ORDER BY tier');
console.log('\nTier distribution:');
for (const r of summary.rows) console.log(`  ${r.tier} : ${r.n}`);

const vips = await db.execute('SELECT name, ltv_cents FROM client WHERE tier = "vip" ORDER BY ltv_cents DESC');
console.log('\nVIP clients:');
for (const r of vips.rows) {
	console.log(`  ${String(r.name).padEnd(40)} ${(Number(r.ltv_cents) / 100).toFixed(2).padStart(12)} RON`);
}

process.exit(0);
