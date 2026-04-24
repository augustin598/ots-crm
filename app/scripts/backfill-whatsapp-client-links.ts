/**
 * Backfill whatsappMessage.clientId for rows where it was left null because
 * the inbound handler matched client.phone by exact string only (so CRM phones
 * stored as "0753755327" didn't match WhatsApp's "+40753755327").
 *
 * The fix in inbound-handler.ts and whatsapp.remote.ts already covers new
 * messages and the live thread/list views. This script patches the historical
 * rows so getWhatsappHistoryForClient (client profile page) also shows them.
 *
 * Usage:
 *   bun run scripts/backfill-whatsapp-client-links.ts [--dry-run] [--tenant=<id>]
 */

import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from '../src/lib/server/db/schema';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { phoneE164Variants, tryToE164 } from '../src/lib/server/whatsapp/phone';

const SQLITE_URI = process.env.SQLITE_URI || Bun.env.SQLITE_URI;
const SQLITE_AUTH_TOKEN = process.env.SQLITE_AUTH_TOKEN || Bun.env.SQLITE_AUTH_TOKEN;

if (!SQLITE_URI || !SQLITE_AUTH_TOKEN) {
	console.error('❌ Missing SQLITE_URI or SQLITE_AUTH_TOKEN environment variables');
	process.exit(1);
}

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const tenantArg = args.find((a) => a.startsWith('--tenant='));
const TENANT_FILTER = tenantArg ? tenantArg.slice('--tenant='.length) : null;

const sqliteClient = createClient({ url: SQLITE_URI, authToken: SQLITE_AUTH_TOKEN });
const db = drizzle(sqliteClient, { schema });
const table = schema;

async function resolveClientId(
	tenantId: string,
	remotePhoneE164: string,
	tenantClientsCache: Map<string, Array<{ id: string; phone: string | null }>>
): Promise<string | null> {
	const variants = phoneE164Variants(remotePhoneE164);
	const [fast] = await db
		.select({ id: table.client.id })
		.from(table.client)
		.where(and(eq(table.client.tenantId, tenantId), inArray(table.client.phone, variants)))
		.limit(1);
	if (fast) return fast.id;

	// Fallback: normalize every stored phone via toE164 and compare.
	// Pre-filtering by tail-includes is unreliable — spaces in stored phones
	// (e.g. "+40 753 755 327") break contiguous-digit matching.
	let candidates = tenantClientsCache.get(tenantId);
	if (!candidates) {
		candidates = await db
			.select({ id: table.client.id, phone: table.client.phone })
			.from(table.client)
			.where(eq(table.client.tenantId, tenantId));
		tenantClientsCache.set(tenantId, candidates);
	}
	for (const c of candidates) {
		if (!c.phone) continue;
		if (tryToE164(c.phone) === remotePhoneE164) return c.id;
	}
	return null;
}

async function main() {
	console.log(`🔍 Scanning whatsappMessage rows with clientId = NULL${DRY_RUN ? ' (DRY RUN)' : ''}`);
	if (TENANT_FILTER) console.log(`   Filter: tenantId = ${TENANT_FILTER}`);

	const baseWhere = TENANT_FILTER
		? and(isNull(table.whatsappMessage.clientId), eq(table.whatsappMessage.tenantId, TENANT_FILTER))
		: isNull(table.whatsappMessage.clientId);

	const rows = await db
		.select({
			tenantId: table.whatsappMessage.tenantId,
			remotePhoneE164: table.whatsappMessage.remotePhoneE164
		})
		.from(table.whatsappMessage)
		.where(baseWhere);

	if (rows.length === 0) {
		console.log('✅ No messages with null clientId. Nothing to do.');
		return;
	}

	// Unique (tenantId, phone) pairs
	const pairs = new Map<string, { tenantId: string; phone: string }>();
	for (const r of rows) {
		const key = `${r.tenantId}::${r.remotePhoneE164}`;
		if (!pairs.has(key)) pairs.set(key, { tenantId: r.tenantId, phone: r.remotePhoneE164 });
	}
	console.log(`   Total null-clientId rows: ${rows.length}`);
	console.log(`   Distinct (tenant, phone) pairs to resolve: ${pairs.size}\n`);

	let resolvedPairs = 0;
	let unresolvedPairs = 0;
	let totalUpdated = 0;
	const tenantClientsCache = new Map<string, Array<{ id: string; phone: string | null }>>();

	for (const { tenantId, phone } of pairs.values()) {
		const clientId = await resolveClientId(tenantId, phone, tenantClientsCache);
		if (!clientId) {
			unresolvedPairs += 1;
			continue;
		}
		resolvedPairs += 1;

		if (DRY_RUN) {
			const count = rows.filter((r) => r.tenantId === tenantId && r.remotePhoneE164 === phone).length;
			console.log(`  [dry] tenant=${tenantId} phone=${phone} → client=${clientId} (${count} msgs)`);
			totalUpdated += count;
		} else {
			const result = await db
				.update(table.whatsappMessage)
				.set({ clientId, updatedAt: new Date() })
				.where(
					and(
						eq(table.whatsappMessage.tenantId, tenantId),
						eq(table.whatsappMessage.remotePhoneE164, phone),
						isNull(table.whatsappMessage.clientId)
					)
				)
				.returning({ id: table.whatsappMessage.id });
			console.log(`  ✅ tenant=${tenantId} phone=${phone} → client=${clientId} (${result.length} msgs)`);
			totalUpdated += result.length;
		}
	}

	console.log('\n─────────────────────────────');
	console.log(`Summary${DRY_RUN ? ' (DRY RUN — no writes)' : ''}:`);
	console.log(`  Resolved pairs:   ${resolvedPairs}`);
	console.log(`  Unresolved pairs: ${unresolvedPairs}  (no matching client in CRM)`);
	console.log(`  Messages ${DRY_RUN ? 'would be' : ''} updated: ${totalUpdated}`);
	console.log('─────────────────────────────');
}

main()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error('❌ Error:', err);
		process.exit(1);
	});
