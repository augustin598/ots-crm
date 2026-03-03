#!/usr/bin/env node

/**
 * Migrates local-ots.db → remote Turso DB (from .env SQLITE_URI + SQLITE_AUTH_TOKEN)
 *
 * The remote DB must already have its schema (via drizzle migrations).
 * This script copies DATA only, matching common columns between local & remote.
 *
 * Usage: node migrate-to-remote.mjs [--dry-run] [--no-clean]
 *
 * --dry-run   Show what would be done without writing
 * --no-clean  Don't delete existing remote data before inserting
 */

import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ── Parse .env ──────────────────────────────────────────────────────────
function loadEnv(filePath) {
	const env = {};
	const content = readFileSync(filePath, 'utf-8');
	for (const line of content.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const eqIdx = trimmed.indexOf('=');
		if (eqIdx === -1) continue;
		const key = trimmed.slice(0, eqIdx).trim();
		let val = trimmed.slice(eqIdx + 1).trim();
		if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
			val = val.slice(1, -1);
		}
		env[key] = val;
	}
	return env;
}

const envPath = resolve(import.meta.dirname, '.env');
const env = loadEnv(envPath);

const REMOTE_URL = env.SQLITE_URI;
const REMOTE_TOKEN = env.SQLITE_AUTH_TOKEN;
const LOCAL_PATH = resolve(import.meta.dirname, 'local-ots.db');

if (!REMOTE_URL || !REMOTE_TOKEN) {
	console.error('Missing SQLITE_URI or SQLITE_AUTH_TOKEN in .env');
	process.exit(1);
}

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const NO_CLEAN = args.includes('--no-clean');

const local = createClient({ url: `file:${LOCAL_PATH}` });
const remote = createClient({ url: REMOTE_URL, authToken: REMOTE_TOKEN });

console.log(`\n📦 Source:  file:${LOCAL_PATH}`);
console.log(`🌐 Target:  ${REMOTE_URL}`);
if (DRY_RUN) console.log('🔍 DRY RUN — no writes\n');
else console.log();

// ── Get column names for a table ────────────────────────────────────────
async function getColumns(db, table) {
	try {
		const result = await db.execute(`PRAGMA table_info("${table}")`);
		return result.rows.map((r) => /** @type {string} */ (r.name));
	} catch {
		return [];
	}
}

// ── Get FK dependencies to determine table order ────────────────────────
async function getTableOrder() {
	const tablesResult = await local.execute(
		`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
	);
	const allTables = tablesResult.rows.map((r) => /** @type {string} */ (r.name));

	// Build dependency graph: table → set of tables it depends on
	const deps = new Map();
	for (const t of allTables) deps.set(t, new Set());

	for (const table of allTables) {
		const fks = await local.execute(`PRAGMA foreign_key_list("${table}")`);
		for (const fk of fks.rows) {
			const parent = /** @type {string} */ (fk.table);
			if (parent && allTables.includes(parent) && parent !== table) {
				deps.get(table).add(parent);
			}
		}
	}

	// Topological sort (Kahn's algorithm)
	const sorted = [];
	const inDegree = new Map();
	for (const [t, d] of deps) inDegree.set(t, d.size);

	const queue = [];
	for (const [t, deg] of inDegree) {
		if (deg === 0) queue.push(t);
	}

	while (queue.length > 0) {
		const t = queue.shift();
		sorted.push(t);
		for (const [other, d] of deps) {
			if (d.has(t)) {
				d.delete(t);
				inDegree.set(other, inDegree.get(other) - 1);
				if (inDegree.get(other) === 0) queue.push(other);
			}
		}
	}

	// Add any remaining (circular deps) at the end
	for (const t of allTables) {
		if (!sorted.includes(t)) sorted.push(t);
	}

	return sorted;
}

// ── Clean remote data ───────────────────────────────────────────────────
async function cleanRemote(tablesInOrder) {
	if (NO_CLEAN) {
		console.log('⏭  Skipping remote cleanup\n');
		return;
	}

	console.log('🗑  Cleaning existing data on remote (reverse FK order)...');

	// Delete in reverse order to respect FK constraints
	const reversed = [...tablesInOrder].reverse();

	for (const table of reversed) {
		// Skip __drizzle_migrations — we don't want to lose migration tracking
		if (table === '__drizzle_migrations') continue;

		try {
			const countResult = await remote.execute(`SELECT COUNT(*) as cnt FROM "${table}"`);
			const count = Number(countResult.rows[0].cnt);
			if (count === 0) continue;

			if (DRY_RUN) {
				console.log(`  [dry] DELETE FROM "${table}" (${count} rows)`);
			} else {
				await remote.execute(`DELETE FROM "${table}"`);
				console.log(`  🗑  ${table}: ${count} rows deleted`);
			}
		} catch (e) {
			// Table might not exist on remote
			if (!e.message?.includes('no such table')) {
				console.error(`  ⚠  ${table}: ${e.message}`);
			}
		}
	}
	console.log();
}

// ── Copy data ───────────────────────────────────────────────────────────
async function copyData(tablesInOrder) {
	console.log('📋 Copying data (FK-safe order)...\n');

	let totalRows = 0;
	let totalTables = 0;

	for (const table of tablesInOrder) {
		// Skip drizzle migrations — remote has its own tracking
		if (table === '__drizzle_migrations') continue;

		// Count local rows
		const countResult = await local.execute(`SELECT COUNT(*) as cnt FROM "${table}"`);
		const rowCount = Number(countResult.rows[0].cnt);
		if (rowCount === 0) continue;

		// Get columns from both databases
		const localCols = await getColumns(local, table);
		const remoteCols = await getColumns(remote, table);

		if (remoteCols.length === 0) {
			console.log(`  ⏭  ${table}: not on remote, skipping`);
			continue;
		}

		// Only use columns that exist in BOTH local and remote
		const commonCols = localCols.filter((c) => remoteCols.includes(c));
		if (commonCols.length === 0) {
			console.log(`  ⏭  ${table}: no common columns, skipping`);
			continue;
		}

		const droppedCols = localCols.filter((c) => !remoteCols.includes(c));
		if (droppedCols.length > 0) {
			console.log(`  ℹ️  ${table}: skipping local-only columns: ${droppedCols.join(', ')}`);
		}

		// Read data using only common columns
		const colSelect = commonCols.map((c) => `"${c}"`).join(', ');
		const dataResult = await local.execute(`SELECT ${colSelect} FROM "${table}"`);
		if (dataResult.rows.length === 0) continue;

		const placeholders = commonCols.map(() => '?').join(', ');
		const colNames = commonCols.map((c) => `"${c}"`).join(', ');
		const insertSql = `INSERT OR REPLACE INTO "${table}" (${colNames}) VALUES (${placeholders})`;

		if (DRY_RUN) {
			console.log(`  [dry] ${table}: ${rowCount} rows (${commonCols.length} cols)`);
			totalRows += rowCount;
			totalTables++;
			continue;
		}

		// Batch insert
		const BATCH_SIZE = 50;
		let inserted = 0;

		for (let i = 0; i < dataResult.rows.length; i += BATCH_SIZE) {
			const batch = dataResult.rows.slice(i, i + BATCH_SIZE);
			const stmts = batch.map((row) => ({
				sql: insertSql,
				args: commonCols.map((col) => {
					const val = row[col];
					if (typeof val === 'bigint') {
						if (val >= Number.MIN_SAFE_INTEGER && val <= Number.MAX_SAFE_INTEGER) {
							return Number(val);
						}
						return val.toString();
					}
					return val ?? null;
				})
			}));

			try {
				await remote.batch(stmts, 'write');
				inserted += batch.length;
			} catch (e) {
				console.error(`  ❌ ${table}: batch error at row ${i}: ${e.message}`);
				// Fallback: one by one
				for (const stmt of stmts) {
					try {
						await remote.execute(stmt);
						inserted++;
					} catch (e2) {
						console.error(`     Row error: ${e2.message}`);
					}
				}
			}
		}

		const status = inserted === rowCount ? '✅' : '⚠ ';
		console.log(`  ${status} ${table}: ${inserted}/${rowCount} rows`);
		totalRows += inserted;
		totalTables++;
	}

	console.log(`\n🎉 Done! Copied ${totalRows} rows across ${totalTables} tables.`);
}

// ── Verify ──────────────────────────────────────────────────────────────
async function verify(tablesInOrder) {
	if (DRY_RUN) return;

	console.log('\n🔍 Verifying...\n');
	let mismatches = 0;

	for (const table of tablesInOrder) {
		if (table === '__drizzle_migrations') continue;

		const localCount = Number(
			(await local.execute(`SELECT COUNT(*) as cnt FROM "${table}"`)).rows[0].cnt
		);
		if (localCount === 0) continue;

		let remoteCount;
		try {
			remoteCount = Number(
				(await remote.execute(`SELECT COUNT(*) as cnt FROM "${table}"`)).rows[0].cnt
			);
		} catch {
			remoteCount = '❌ missing';
		}

		if (localCount !== remoteCount) {
			console.log(`  ⚠  ${table}: local=${localCount} remote=${remoteCount}`);
			mismatches++;
		}
	}

	if (mismatches === 0) {
		console.log('  ✅ All tables match!\n');
	} else {
		console.log(`\n  ⚠  ${mismatches} table(s) with mismatches\n`);
	}
}

// ── Run ─────────────────────────────────────────────────────────────────
try {
	const tablesInOrder = await getTableOrder();
	console.log(`📐 ${tablesInOrder.length} tables, FK-sorted order.\n`);

	await cleanRemote(tablesInOrder);
	await copyData(tablesInOrder);
	await verify(tablesInOrder);
} catch (e) {
	console.error('\n💥 Fatal error:', e);
	process.exit(1);
} finally {
	local.close();
	remote.close();
}
