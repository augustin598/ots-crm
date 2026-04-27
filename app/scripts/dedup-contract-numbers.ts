/**
 * Resolve duplicate contract numbers within a tenant.
 *
 * Picks a keeper per (tenant_id, contract_number) group based on status
 * priority (active > signed > sent > draft > expired > cancelled) and
 * tiebreaks on oldest createdAt. The remaining contracts are renumbered to
 * the next available `<prefix>-NNNN` for that tenant. Each renumber writes
 * a contract_activity entry so the change is auditable.
 *
 * Run dry-run first:
 *   bun --bun scripts/dedup-contract-numbers.ts --dry-run
 *
 * Then for real:
 *   bun --bun scripts/dedup-contract-numbers.ts
 */

import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { and, eq, sql } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import * as schema from '../src/lib/server/db/schema';

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
	const envPath = join(__dirname, '..', '.env');
	try {
		const content = readFileSync(envPath, 'utf-8');
		for (const line of content.split('\n')) {
			const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
			if (m) {
				const [, key, rawVal] = m;
				const val = rawVal.replace(/^['"]|['"]$/g, '');
				if (!process.env[key]) process.env[key] = val;
			}
		}
	} catch {
		// rely on process env
	}
}
loadEnv();

const sqlitePath = process.env.SQLITE_PATH;
const tursoUrl = process.env.SQLITE_URI;
const tursoAuthToken = process.env.SQLITE_AUTH_TOKEN;

let client;
if (sqlitePath) {
	client = createClient({ url: `file:${sqlitePath}` });
	console.log(`[dedup] using local sqlite: ${sqlitePath}`);
} else if (tursoUrl) {
	client = createClient({ url: tursoUrl, authToken: tursoAuthToken });
	console.log(`[dedup] using turso (url hidden)`);
} else {
	console.error('[dedup] Neither SQLITE_PATH nor SQLITE_URI is set');
	process.exit(1);
}

const db = drizzle(client, { schema });

const STATUS_PRIORITY: Record<string, number> = {
	active: 6,
	signed: 5,
	sent: 4,
	draft: 3,
	expired: 2,
	cancelled: 1
};

function pickKeeper<T extends { status: string; createdAt: Date }>(rows: T[]): T {
	return rows.slice().sort((a, b) => {
		const pa = STATUS_PRIORITY[a.status] ?? 0;
		const pb = STATUS_PRIORITY[b.status] ?? 0;
		if (pa !== pb) return pb - pa; // higher priority first
		return a.createdAt.getTime() - b.createdAt.getTime(); // older first
	})[0];
}

function nextNumberFor(prefix: string, allNumbers: string[]): string {
	const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const re = new RegExp(`^${escapedPrefix}-(\\d+)$`);
	let maxNum = 0;
	for (const n of allNumbers) {
		const m = n.match(re);
		if (m) {
			const v = parseInt(m[1], 10);
			if (v > maxNum) maxNum = v;
		}
	}
	return `${prefix}-${String(maxNum + 1).padStart(4, '0')}`;
}

function newId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

async function main() {
	const isDryRun = process.argv.includes('--dry-run');

	const dupNumbers = await db
		.select({
			tenantId: schema.contract.tenantId,
			contractNumber: schema.contract.contractNumber,
			cnt: sql<number>`count(*)`.as('cnt')
		})
		.from(schema.contract)
		.groupBy(schema.contract.tenantId, schema.contract.contractNumber)
		.having(sql`count(*) > 1`);

	if (dupNumbers.length === 0) {
		console.log('[dedup] no duplicates found — nothing to do');
		process.exit(0);
	}

	console.log(`[dedup] found ${dupNumbers.length} duplicate (tenant, number) groups`);

	type Plan = { contractId: string; tenantId: string; oldNumber: string; newNumber: string; clientName: string; status: string };
	const plans: Plan[] = [];

	const tenantPrefixCache = new Map<string, string>();
	const tenantNumberCache = new Map<string, Set<string>>();

	async function getPrefix(tenantId: string): Promise<string> {
		if (tenantPrefixCache.has(tenantId)) return tenantPrefixCache.get(tenantId)!;
		const [t] = await db
			.select({ prefix: schema.tenant.contractPrefix })
			.from(schema.tenant)
			.where(eq(schema.tenant.id, tenantId))
			.limit(1);
		const prefix = t?.prefix || 'CTR';
		tenantPrefixCache.set(tenantId, prefix);
		return prefix;
	}

	async function getAllNumbers(tenantId: string): Promise<Set<string>> {
		if (tenantNumberCache.has(tenantId)) return tenantNumberCache.get(tenantId)!;
		const rows = await db
			.select({ contractNumber: schema.contract.contractNumber })
			.from(schema.contract)
			.where(eq(schema.contract.tenantId, tenantId));
		const set = new Set(rows.map((r) => r.contractNumber));
		tenantNumberCache.set(tenantId, set);
		return set;
	}

	for (const grp of dupNumbers) {
		const rows = await db
			.select({
				id: schema.contract.id,
				tenantId: schema.contract.tenantId,
				contractNumber: schema.contract.contractNumber,
				clientId: schema.contract.clientId,
				status: schema.contract.status,
				createdAt: schema.contract.createdAt,
				version: schema.contract.version
			})
			.from(schema.contract)
			.where(
				and(
					eq(schema.contract.tenantId, grp.tenantId),
					eq(schema.contract.contractNumber, grp.contractNumber)
				)
			);

		const keeper = pickKeeper(rows);
		const renumberTargets = rows.filter((r) => r.id !== keeper.id);

		const prefix = await getPrefix(grp.tenantId);
		const allNumbers = await getAllNumbers(grp.tenantId);

		console.log(
			`\n  group: tenant=${grp.tenantId.slice(0, 8)}… number=${grp.contractNumber} count=${rows.length}`
		);
		for (const r of rows) {
			const [c] = await db
				.select({ name: schema.client.name, business: schema.client.businessName })
				.from(schema.client)
				.where(eq(schema.client.id, r.clientId))
				.limit(1);
			const clientName = c?.business || c?.name || '(no client)';
			const role = r.id === keeper.id ? 'KEEP   ' : 'RENUMBER';
			console.log(
				`    ${role}  ${r.id}  status=${r.status.padEnd(9)}  client=${clientName}  createdAt=${r.createdAt.toISOString()}`
			);
			if (r.id !== keeper.id) {
				const newNumber = nextNumberFor(prefix, [...allNumbers]);
				allNumbers.add(newNumber);
				plans.push({
					contractId: r.id,
					tenantId: r.tenantId,
					oldNumber: r.contractNumber,
					newNumber,
					clientName,
					status: r.status
				});
			}
		}
	}

	console.log(`\n[dedup] ${plans.length} contract(s) will be renumbered:`);
	for (const p of plans) {
		console.log(
			`  ${p.contractId}  ${p.oldNumber}  →  ${p.newNumber}  (${p.status}, ${p.clientName})`
		);
	}

	if (isDryRun) {
		console.log('\n[dedup] --dry-run set, no changes written');
		process.exit(0);
	}

	for (const p of plans) {
		const [target] = await db
			.select({ version: schema.contract.version })
			.from(schema.contract)
			.where(eq(schema.contract.id, p.contractId))
			.limit(1);
		if (!target) {
			console.error(`  skipped ${p.contractId}: not found`);
			continue;
		}
		await db
			.update(schema.contract)
			.set({
				contractNumber: p.newNumber,
				version: target.version + 1,
				updatedAt: new Date()
			})
			.where(eq(schema.contract.id, p.contractId));

		await db.insert(schema.contractActivity).values({
			id: newId(),
			contractId: p.contractId,
			tenantId: p.tenantId,
			userId: null,
			action: 'updated',
			field: 'contractNumber',
			oldValue: p.oldNumber,
			newValue: p.newNumber
		});

		console.log(`  ✓ ${p.contractId}  ${p.oldNumber} → ${p.newNumber}`);
	}

	console.log('\n[dedup] done');
	process.exit(0);
}

main().catch((err) => {
	console.error('[dedup] failed:', err);
	process.exit(1);
});
