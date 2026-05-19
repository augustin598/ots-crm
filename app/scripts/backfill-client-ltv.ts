#!/usr/bin/env bun
/**
 * One-shot backfill: recompute client.ltv_cents for every client across all tenants.
 * Run with: cd app && bun scripts/backfill-client-ltv.ts
 *
 * Idempotent — safe to re-run.
 */
import { db } from '../src/lib/server/db';
import * as table from '../src/lib/server/db/schema';
import { recalcClientLTV } from '../src/lib/server/hosting/ltv';

const clients = await db
	.select({ id: table.client.id, tenantId: table.client.tenantId, name: table.client.name })
	.from(table.client);

console.log(`Recomputing LTV for ${clients.length} clients...`);
let ok = 0;
let err = 0;
let withLtv = 0;
for (const c of clients) {
	try {
		const ltv = await recalcClientLTV(c.tenantId, c.id);
		ok++;
		if (ok % 25 === 0) console.log(`  ${ok}/${clients.length} done...`);
		if (ltv > 0) {
			withLtv++;
			console.log(`  ${c.name}: ${(ltv / 100).toFixed(2)} RON`);
		}
	} catch (e) {
		err++;
		console.error(`  FAILED ${c.name} (${c.id}):`, e);
	}
}
console.log(`\nDone. ${ok} ok · ${err} errors · ${withLtv} clients have non-zero LTV.`);
process.exit(err === 0 ? 0 : 1);
