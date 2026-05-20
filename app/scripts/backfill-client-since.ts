#!/usr/bin/env bun
/**
 * One-shot backfill: set client.client_since from client.created_at where NULL.
 * Run with: cd app && bun scripts/backfill-client-since.ts
 *
 * This is a fallback — the actual "client since" date (when the customer
 * relationship started) may predate the CRM import. Staff can override
 * manually via the client edit form. This backfill just ensures the field
 * is non-NULL so the group card "Client din [year] · N ani" line renders.
 *
 * Idempotent — only touches rows where client_since IS NULL.
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

const before = await db.execute('SELECT COUNT(*) AS n FROM client WHERE client_since IS NULL');
console.log(`Clients with NULL client_since: ${before.rows[0].n}`);

const res = await db.execute(`
  UPDATE client
  SET client_since = substr(created_at, 1, 10)
  WHERE client_since IS NULL AND created_at IS NOT NULL
`);
console.log(`Updated: ${res.rowsAffected} clients`);

const after = await db.execute('SELECT COUNT(*) AS n FROM client WHERE client_since IS NULL');
console.log(`Remaining NULL: ${after.rows[0].n}`);

// Sanity: oldest + newest after backfill
const stats = await db.execute(`
  SELECT
    MIN(client_since) AS oldest,
    MAX(client_since) AS newest,
    COUNT(DISTINCT substr(client_since, 1, 4)) AS years_covered
  FROM client
  WHERE client_since IS NOT NULL
`);
console.log('\nDate range:');
for (const r of stats.rows) {
	console.log(`  Oldest:        ${r.oldest}`);
	console.log(`  Newest:        ${r.newest}`);
	console.log(`  Years covered: ${r.years_covered}`);
}

process.exit(0);
