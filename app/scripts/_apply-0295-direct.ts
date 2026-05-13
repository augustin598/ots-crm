#!/usr/bin/env bun
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

if (!(await colExists('hosting_product', 'is_public'))) {
	await client.execute('ALTER TABLE hosting_product ADD COLUMN is_public integer DEFAULT 0 NOT NULL');
	console.log('+ is_public');
} else console.log('= is_public exists');

if (!(await colExists('hosting_product', 'public_sort_order'))) {
	await client.execute('ALTER TABLE hosting_product ADD COLUMN public_sort_order integer DEFAULT 0 NOT NULL');
	console.log('+ public_sort_order');
} else console.log('= public_sort_order exists');

// Mark the 4 active WP products as public + set publicSortOrder = sortOrder
const upd = await client.execute({
	sql: `UPDATE hosting_product SET is_public = 1, public_sort_order = sort_order WHERE is_active = 1 AND name LIKE 'Wordpress %' AND name != 'Wordpress Demo'`,
	args: []
});
console.log(`✓ Marked ${upd.rowsAffected} products as public`);

// Register migration
const latest = await client.execute('SELECT MAX(created_at) AS m FROM __drizzle_migrations');
const baseTs = Number((latest.rows[0] as { m: number }).m ?? Date.now() * 1000);
const when = baseTs + 100;
const sql = readFileSync('drizzle/0295_hosting_product_public.sql', 'utf8');
const hash = createHash('sha256').update(sql).digest('hex');
const exists = await client.execute({ sql: 'SELECT id FROM __drizzle_migrations WHERE hash = ?', args: [hash] });
if (exists.rows.length === 0) {
	await client.execute({ sql: 'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)', args: [hash, when] });
	console.log(`Registered 0295 (when=${when})`);
}
const journalPath = 'drizzle/meta/_journal.json';
const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
const known = new Set(journal.entries.map((e: { tag: string }) => e.tag));
if (!known.has('0295_hosting_product_public')) {
	journal.entries.push({ idx: 295, version: '6', when, tag: '0295_hosting_product_public', breakpoints: true });
	writeFileSync(journalPath, JSON.stringify(journal, null, '\t') + '\n');
	console.log('Journal updated');
}
console.log('Done');
process.exit(0);
