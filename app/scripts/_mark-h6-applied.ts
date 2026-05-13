#!/usr/bin/env bun
// Register 0290 and 0291 in __drizzle_migrations so drizzle migrator skips them
// next time (we already applied the SQL manually via _apply-h6-direct.ts).
// Use folderMillis matching the journal's `when` values.
import { createClient } from '@libsql/client';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const client = createClient({ url: process.env.SQLITE_URI!, authToken: process.env.SQLITE_AUTH_TOKEN });

const migrations = [
	{ when: 1778593921452100, file: 'drizzle/0290_hosting_account_auto_suspended_by_invoice.sql' },
	{ when: 1778593921452200, file: 'drizzle/0291_backfill_auto_suspended_by_invoice.sql' }
];

for (const m of migrations) {
	const sql = readFileSync(m.file, 'utf8');
	const hash = createHash('sha256').update(sql).digest('hex');
	const existing = await client.execute({
		sql: 'SELECT id FROM __drizzle_migrations WHERE hash = ?',
		args: [hash]
	});
	if (existing.rows.length > 0) {
		console.log(`  ${m.file}  already registered`);
		continue;
	}
	await client.execute({
		sql: 'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)',
		args: [hash, m.when]
	});
	console.log(`  ${m.file}  registered (hash=${hash.slice(0, 16)}..., when=${m.when})`);
}
console.log('Done');
process.exit(0);
