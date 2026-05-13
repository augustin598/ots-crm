#!/usr/bin/env bun
// Apply 0294 directly. Adds 22 columns to da_package + 1 to da_server.
// Idempotent: skips columns that already exist.
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

const daPackageAdds: { col: string; sql: string }[] = [
	{ col: 'max_email_forwarders', sql: 'integer' },
	{ col: 'max_mailing_lists', sql: 'integer' },
	{ col: 'max_autoresponders', sql: 'integer' },
	{ col: 'max_domain_pointers', sql: 'integer' },
	{ col: 'email_daily_limit', sql: 'integer' },
	{ col: 'anonymous_ftp', sql: 'integer DEFAULT 0 NOT NULL' },
	{ col: 'cgi', sql: 'integer DEFAULT 0 NOT NULL' },
	{ col: 'php', sql: 'integer DEFAULT 0 NOT NULL' },
	{ col: 'ssl', sql: 'integer DEFAULT 0 NOT NULL' },
	{ col: 'ssh', sql: 'integer DEFAULT 0 NOT NULL' },
	{ col: 'dns_control', sql: 'integer DEFAULT 0 NOT NULL' },
	{ col: 'cron', sql: 'integer DEFAULT 0 NOT NULL' },
	{ col: 'spam', sql: 'integer DEFAULT 0 NOT NULL' },
	{ col: 'clamav', sql: 'integer DEFAULT 0 NOT NULL' },
	{ col: 'wordpress', sql: 'integer DEFAULT 0 NOT NULL' },
	{ col: 'git', sql: 'integer DEFAULT 0 NOT NULL' },
	{ col: 'redis', sql: 'integer DEFAULT 0 NOT NULL' },
	{ col: 'suspend_at_limit', sql: 'integer DEFAULT 0 NOT NULL' },
	{ col: 'oversold', sql: 'integer DEFAULT 0 NOT NULL' },
	{ col: 'skin', sql: 'text' },
	{ col: 'language', sql: 'text' }
];

console.log('Adding da_package columns:');
for (const { col, sql } of daPackageAdds) {
	if (await colExists('da_package', col)) {
		console.log(`  = ${col}`);
	} else {
		await client.execute(`ALTER TABLE da_package ADD COLUMN ${col} ${sql}`);
		console.log(`  + ${col}`);
	}
}

console.log('\nAdding da_server columns:');
if (await colExists('da_server', 'last_sync_result')) {
	console.log('  = last_sync_result');
} else {
	await client.execute('ALTER TABLE da_server ADD COLUMN last_sync_result text');
	console.log('  + last_sync_result');
}

// Register in __drizzle_migrations
const latest = await client.execute('SELECT MAX(created_at) AS m FROM __drizzle_migrations');
const baseTs = Number((latest.rows[0] as { m: number }).m ?? Date.now() * 1000);
const when = baseTs + 100;

const sqlText = readFileSync('drizzle/0294_da_package_full_fields.sql', 'utf8');
const hash = createHash('sha256').update(sqlText).digest('hex');
const existing = await client.execute({
	sql: 'SELECT id FROM __drizzle_migrations WHERE hash = ?',
	args: [hash]
});
if (existing.rows.length === 0) {
	await client.execute({
		sql: 'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)',
		args: [hash, when]
	});
	console.log(`\nRegistered 0294 in __drizzle_migrations (when=${when})`);
} else {
	console.log('\n0294 already registered');
}

// Bump journal
const journalPath = 'drizzle/meta/_journal.json';
const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
const known = new Set(journal.entries.map((e: { tag: string }) => e.tag));
const tag = '0294_da_package_full_fields';
if (!known.has(tag)) {
	journal.entries.push({ idx: 294, version: '6', when, tag, breakpoints: true });
	writeFileSync(journalPath, JSON.stringify(journal, null, '\t') + '\n');
	console.log('Journal updated');
} else {
	console.log('Journal already in sync');
}

console.log('\nDone');
process.exit(0);
