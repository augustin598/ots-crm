/**
 * Cleanup duplicate clients in Navitech tenant
 * 
 * Strategy:
 * 1. Find duplicate clients by name
 * 2. For each duplicate group:
 *    - Identify the "good" client (has correct CUI format, or is older)
 *    - Identify "bad" clients (have registration numbers in CUI field, or are newer duplicates)
 *    - For bad clients with NO invoices: DELETE them
 *    - For bad clients WITH invoices: MERGE into good client (update invoice.client_id)
 */

import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from '../src/lib/server/db/schema';
import { eq, sql } from 'drizzle-orm';

// Load environment variables
const SQLITE_URI = process.env.SQLITE_URI || Bun.env.SQLITE_URI;
const SQLITE_AUTH_TOKEN = process.env.SQLITE_AUTH_TOKEN || Bun.env.SQLITE_AUTH_TOKEN;

if (!SQLITE_URI || !SQLITE_AUTH_TOKEN) {
	console.error('❌ Missing SQLITE_URI or SQLITE_AUTH_TOKEN environment variables');
	process.exit(1);
}

const client = createClient({
	url: SQLITE_URI,
	authToken: SQLITE_AUTH_TOKEN
});

const db = drizzle(client, { schema });
const table = schema;

const TENANT_ID = '77rbshk25px6qjerng3qapge'; // NAVITECH SYSTEMS S.R.L.

interface DuplicateGroup {
	name: string;
	ids: string[];
}

interface ClientWithInvoiceCount {
	id: string;
	name: string;
	cui: string | null;
	vatNumber: string | null;
	registrationNumber: string | null;
	createdAt: Date | null;
	invoiceCount: number;
}

async function main() {
	console.log('🔍 Finding duplicate clients...\n');

	// Find clients that have duplicate names - use raw client query
	const allClients = await db
		.select()
		.from(table.client)
		.where(eq(table.client.tenantId, TENANT_ID));

	// Group by name
	const clientsByName = new Map<string, string[]>();
	for (const client of allClients) {
		const existing = clientsByName.get(client.name) || [];
		existing.push(client.id);
		clientsByName.set(client.name, existing);
	}

	// Filter to only duplicates
	const duplicateGroups: DuplicateGroup[] = [];
	for (const [name, ids] of clientsByName.entries()) {
		if (ids.length > 1) {
			duplicateGroups.push({ name, ids: ids.join(',') });
		}
	}

	if (duplicateGroups.length === 0) {
		console.log('✅ No duplicate clients found!');
		return;
	}

	console.log(`Found ${duplicateGroups.length} groups of duplicate clients:\n`);

	for (const group of duplicateGroups) {
		const clientIds = group.ids.split(',');
		console.log(`\n📋 Group: ${group.name} (${clientIds.length} duplicates)`);
		console.log('─'.repeat(80));

		// Get full details for each client including invoice count
		const clients: ClientWithInvoiceCount[] = [];
		for (const clientId of clientIds) {
			const [client] = await db
				.select()
				.from(table.client)
				.where(eq(table.client.id, clientId));

			const invoiceCountResult = await db
				.select({ count: sql<number>`COUNT(*)` })
				.from(table.invoice)
				.where(eq(table.invoice.clientId, clientId));

			clients.push({
				...client,
				invoiceCount: Number(invoiceCountResult[0]?.count || 0)
			});
		}

		// Display clients
		for (const client of clients) {
			console.log(`\nClient ID: ${client.id}`);
			console.log(`  CUI: ${client.cui || 'NULL'}`);
			console.log(`  VAT Number: ${client.vatNumber || 'NULL'}`);
			console.log(`  Registration: ${client.registrationNumber || 'NULL'}`);
			console.log(`  Created: ${client.createdAt?.toISOString() || 'NULL'}`);
			console.log(`  Invoices: ${client.invoiceCount}`);
			console.log(`  Has bad CUI: ${client.cui?.startsWith('J') ? '⚠️ YES' : '✅ NO'}`);
		}

		// Determine "good" client (prefer one with correct CUI, then oldest)
		const goodClient = clients.reduce((best, current) => {
			// Prefer client without registration number in CUI field
			const bestHasBadCui = best.cui?.startsWith('J');
			const currentHasBadCui = current.cui?.startsWith('J');

			if (bestHasBadCui && !currentHasBadCui) return current;
			if (!bestHasBadCui && currentHasBadCui) return best;

			// If both are good or both are bad, prefer older one
			if (!best.createdAt) return current;
			if (!current.createdAt) return best;
			return current.createdAt < best.createdAt ? current : best;
		});

		console.log(`\n✅ Good client: ${goodClient.id} (${goodClient.cui})`);

		const badClients = clients.filter((c) => c.id !== goodClient.id);

		for (const badClient of badClients) {
			if (badClient.invoiceCount === 0) {
				console.log(`\n🗑️  Deleting duplicate client ${badClient.id} (no invoices)`);
				await db.delete(table.client).where(eq(table.client.id, badClient.id));
				console.log(`   ✅ Deleted`);
			} else {
				console.log(
					`\n🔄 Merging client ${badClient.id} → ${goodClient.id} (${badClient.invoiceCount} invoices)`
				);
				await db
					.update(table.invoice)
					.set({ clientId: goodClient.id })
					.where(eq(table.invoice.clientId, badClient.id));
				console.log(`   ✅ Moved ${badClient.invoiceCount} invoices`);

				// Delete the now-empty client
				await db.delete(table.client).where(eq(table.client.id, badClient.id));
				console.log(`   ✅ Deleted empty client`);
			}
		}
	}

	console.log('\n\n✅ Cleanup complete!');
}

main().catch((error) => {
	console.error('❌ Error:', error);
	process.exit(1);
});
