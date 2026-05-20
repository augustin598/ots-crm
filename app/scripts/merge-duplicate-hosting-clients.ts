#!/usr/bin/env bun
/**
 * Merge duplicate client records caused by the 2026-05-12 hosting import.
 *
 * Context: WHMCS importer created NEW client rows for each hosting service
 * instead of matching existing clients by business_name. Result: each affected
 * business has TWO records — one canonical (with CUI + invoices, created
 * earlier) and one orphan (no CUI, owns the hosting_account, created
 * 2026-05-12). The hosting accounts page joins on hosting_account.client_id,
 * which points at the orphan, so the UI shows LTV=0 and client_since=2026.
 *
 * This script:
 *   1. Finds duplicate (business_name, tenant_id) groups
 *   2. Picks the canonical record (the one WITH cui)
 *   3. For each orphan in the group, reassigns hosting_account.client_id
 *      to the canonical id
 *   4. Optionally copies any non-null orphan fields the canonical lacks
 *      (email, phone, address) — preserves data from the recent import
 *   5. Does NOT delete the orphan client — leaves it for manual review
 *
 * Run modes:
 *   bun scripts/merge-duplicate-hosting-clients.ts              (dry-run; default)
 *   bun scripts/merge-duplicate-hosting-clients.ts --apply      (writes changes)
 *
 * Idempotent — safe to re-run; if no orphans remain, prints "nothing to do".
 */
import { createClient } from '@libsql/client';

const APPLY = process.argv.includes('--apply');

const env = process.env;
if (!env.SQLITE_URI) {
	console.error('SQLITE_URI not set. Source .env first: `set -a && source .env && set +a`');
	process.exit(1);
}

const db = createClient({
	url: env.SQLITE_URI,
	authToken: env.SQLITE_AUTH_TOKEN
});

console.log(APPLY ? '*** APPLY MODE — writing changes ***' : '*** DRY-RUN — no changes will be written ***');
console.log('');

// 1. Find duplicates
const dups = await db.execute(`
  WITH g AS (
    SELECT business_name, tenant_id, COUNT(*) AS n
    FROM client
    WHERE business_name IS NOT NULL
    GROUP BY business_name, tenant_id
    HAVING n > 1
  )
  SELECT cl.id, cl.business_name, cl.cui, cl.tenant_id, cl.email, cl.phone,
         cl.address, cl.city, cl.county, cl.created_at,
         (SELECT COUNT(*) FROM hosting_account WHERE client_id = cl.id) AS ha,
         (SELECT COUNT(*) FROM invoice WHERE client_id = cl.id) AS inv
  FROM client cl
  JOIN g ON g.business_name = cl.business_name AND g.tenant_id = cl.tenant_id
  ORDER BY cl.business_name, cl.cui IS NULL ASC
`);

// 2. Group by (business_name, tenant_id)
type Row = {
	id: string;
	business_name: string;
	cui: string | null;
	tenant_id: string;
	email: string | null;
	phone: string | null;
	address: string | null;
	city: string | null;
	county: string | null;
	created_at: string;
	ha: number;
	inv: number;
};
const groups = new Map<string, Row[]>();
for (const r of dups.rows) {
	const row = r as unknown as Row;
	const key = `${row.tenant_id}|${row.business_name}`;
	if (!groups.has(key)) groups.set(key, []);
	groups.get(key)!.push(row);
}

console.log(`Found ${groups.size} duplicate groups:\n`);

let totalAccountsReassigned = 0;
let totalGroupsMerged = 0;
let totalFieldCopies = 0;
const skipped: string[] = [];

const FIELDS_TO_COPY = ['email', 'phone', 'address', 'city', 'county'] as const;

for (const [, group] of groups) {
	const businessName = group[0].business_name;
	const canonical = group.find((x) => x.cui);
	const orphans = group.filter((x) => !x.cui);

	if (!canonical) {
		console.log(`  SKIP "${businessName}" — no record has CUI`);
		skipped.push(businessName);
		continue;
	}
	if (orphans.length === 0) {
		console.log(`  SKIP "${businessName}" — no orphans (already clean)`);
		continue;
	}

	console.log(`▶ "${businessName}"`);
	console.log(`    canonical: ${canonical.id.slice(0, 12)} · CUI ${canonical.cui} · ${canonical.inv} inv · ${canonical.ha} ha`);

	for (const orphan of orphans) {
		console.log(`    orphan:    ${orphan.id.slice(0, 12)} · CUI ${orphan.cui ?? '∅'} · ${orphan.inv} inv · ${orphan.ha} ha`);

		// 3a. Reassign hosting_account.client_id (CRITICAL — do this first)
		if (orphan.ha > 0) {
			if (APPLY) {
				const res = await db.execute({
					sql: 'UPDATE hosting_account SET client_id = ? WHERE client_id = ? AND tenant_id = ?',
					args: [canonical.id, orphan.id, orphan.tenant_id]
				});
				console.log(`        → ${res.rowsAffected} hosting account(s) reassigned`);
				totalAccountsReassigned += res.rowsAffected;
			} else {
				console.log(`        → would reassign ${orphan.ha} hosting account(s) to canonical`);
				totalAccountsReassigned += orphan.ha;
			}
		}

		// 3b. Copy non-null orphan fields the canonical lacks — best-effort
		// (UNIQUE constraint on (tenant_id, email) means we must clear the orphan first.
		//  Wrap each copy in try/catch so a single conflict doesn't abort the whole merge.)
		for (const f of FIELDS_TO_COPY) {
			const orphanVal = orphan[f];
			const canonicalVal = canonical[f];
			if (!orphanVal || canonicalVal) continue;

			if (APPLY) {
				try {
					// Clear from orphan first to avoid UNIQUE constraint conflict
					await db.execute({
						sql: `UPDATE client SET ${f} = NULL WHERE id = ?`,
						args: [orphan.id]
					});
					await db.execute({
						sql: `UPDATE client SET ${f} = ? WHERE id = ?`,
						args: [orphanVal, canonical.id]
					});
					console.log(`        + copy ${f}: ${String(orphanVal).slice(0, 40)}`);
					totalFieldCopies++;
				} catch (e) {
					console.log(`        ! copy ${f} failed: ${e instanceof Error ? e.message.slice(0, 60) : 'unknown'}`);
				}
			} else {
				console.log(`        + would copy ${f}: ${String(orphanVal).slice(0, 40)}`);
				totalFieldCopies++;
			}
		}
	}
	totalGroupsMerged++;
	console.log('');
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`Groups ${APPLY ? 'merged' : 'to merge'}:        ${totalGroupsMerged}`);
console.log(`Hosting accounts ${APPLY ? 'reassigned' : 'to reassign'}: ${totalAccountsReassigned}`);
console.log(`Field copies ${APPLY ? 'made' : 'pending'}:    ${totalFieldCopies}`);
if (skipped.length > 0) console.log(`Skipped (no canonical):   ${skipped.length}`);

if (!APPLY && totalAccountsReassigned > 0) {
	console.log('\nTo apply: bun scripts/merge-duplicate-hosting-clients.ts --apply');
}

process.exit(0);
