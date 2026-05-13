#!/usr/bin/env bun
// Apply 0292 + 0293 directly via libsql, idempotent.
// Then register them in __drizzle_migrations + bump journal so drizzle-kit migrate skips them.
import { createClient } from '@libsql/client';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const client = createClient({
	url: process.env.SQLITE_URI!,
	authToken: process.env.SQLITE_AUTH_TOKEN
});

async function colExists(table: string, col: string): Promise<boolean> {
	const r = await client.execute(`PRAGMA table_info('${table}')`);
	return (r.rows as Array<{ name: string }>).some((row) => row.name === col);
}

// --- 0292: schema additions ---
console.log('0292: schema additions');

if (!(await colExists('hosting_product', 'features'))) {
	await client.execute('ALTER TABLE hosting_product ADD COLUMN features text');
	console.log('  + hosting_product.features');
} else console.log('  = hosting_product.features (already exists)');

if (!(await colExists('hosting_product', 'highlight_badge'))) {
	await client.execute('ALTER TABLE hosting_product ADD COLUMN highlight_badge text');
	console.log('  + hosting_product.highlight_badge');
} else console.log('  = hosting_product.highlight_badge (already exists)');

if (!(await colExists('hosting_product', 'sort_order'))) {
	await client.execute('ALTER TABLE hosting_product ADD COLUMN sort_order integer DEFAULT 0 NOT NULL');
	console.log('  + hosting_product.sort_order');
} else console.log('  = hosting_product.sort_order (already exists)');

if (!(await colExists('da_package', 'is_active'))) {
	await client.execute('ALTER TABLE da_package ADD COLUMN is_active integer DEFAULT 1 NOT NULL');
	console.log('  + da_package.is_active');
} else console.log('  = da_package.is_active (already exists)');

// --- 0293: cleanup ---
console.log('\n0293: cleanup');

const del = await client.execute({
	sql: `DELETE FROM hosting_product
	      WHERE description = 'Auto-created product from Server Sync Tool'
	        AND price = 0
	        AND whmcs_product_id IS NULL`,
	args: []
});
console.log(`  deleted ${del.rowsAffected} auto-created rows`);

const upd = await client.execute({
	sql: `UPDATE hosting_product SET description = NULL WHERE description LIKE '%<%>%'`,
	args: []
});
console.log(`  nulled description on ${upd.rowsAffected} rows with HTML`);

// --- register in __drizzle_migrations with timestamps after latest ---
const latest = await client.execute(
	'SELECT MAX(created_at) AS m FROM __drizzle_migrations'
);
const baseTs = Number((latest.rows[0] as { m: number }).m ?? Date.now() * 1000);

const migrations = [
	{ when: baseTs + 100, file: 'drizzle/0292_hosting_product_features_da_package_active.sql' },
	{ when: baseTs + 200, file: 'drizzle/0293_cleanup_hosting_products.sql' }
];

for (const m of migrations) {
	const sql = readFileSync(m.file, 'utf8');
	const hash = createHash('sha256').update(sql).digest('hex');
	const existing = await client.execute({
		sql: 'SELECT id FROM __drizzle_migrations WHERE hash = ?',
		args: [hash]
	});
	if (existing.rows.length > 0) {
		console.log(`  ${m.file} already registered`);
		continue;
	}
	await client.execute({
		sql: 'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)',
		args: [hash, m.when]
	});
	console.log(`  ${m.file} registered (when=${m.when})`);
}

// --- bump journal ---
const journalPath = 'drizzle/meta/_journal.json';
const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
const known = new Set(journal.entries.map((e: { tag: string }) => e.tag));
const additions = [
	{
		idx: 292,
		version: '6',
		when: migrations[0].when,
		tag: '0292_hosting_product_features_da_package_active',
		breakpoints: true
	},
	{
		idx: 293,
		version: '6',
		when: migrations[1].when,
		tag: '0293_cleanup_hosting_products',
		breakpoints: true
	}
];
let appended = 0;
for (const a of additions) {
	if (!known.has(a.tag)) {
		journal.entries.push(a);
		appended++;
	}
}
if (appended > 0) {
	writeFileSync(journalPath, JSON.stringify(journal, null, '\t') + '\n');
	console.log(`  journal: appended ${appended} entries`);
} else {
	console.log('  journal: already in sync');
}

console.log('\nDone');
process.exit(0);
