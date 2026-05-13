#!/usr/bin/env bun
import { createClient } from '@libsql/client';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const c = createClient({
	url: process.env.SQLITE_URI!,
	authToken: process.env.SQLITE_AUTH_TOKEN
});

async function tableExists(name: string) {
	const r = await c.execute({
		sql: "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
		args: [name]
	});
	return r.rows.length > 0;
}

if (!(await tableExists('stripe_integration'))) {
	await c.execute(`CREATE TABLE stripe_integration (
		id text PRIMARY KEY NOT NULL,
		tenant_id text NOT NULL,
		account_id text,
		account_name text,
		account_email text,
		secret_key_encrypted text NOT NULL,
		publishable_key text NOT NULL,
		webhook_secret_encrypted text,
		is_test_mode integer DEFAULT 1 NOT NULL,
		is_active integer DEFAULT 1 NOT NULL,
		last_tested_at text,
		last_error text,
		created_at text DEFAULT (current_date) NOT NULL,
		updated_at text DEFAULT (current_date) NOT NULL,
		FOREIGN KEY (tenant_id) REFERENCES tenant(id)
	)`);
	await c.execute(
		'CREATE UNIQUE INDEX stripe_integration_tenant_id_unique ON stripe_integration (tenant_id)'
	);
	await c.execute('CREATE INDEX stripe_integration_tenant_idx ON stripe_integration (tenant_id)');
	console.log('+ table stripe_integration created');
} else {
	console.log('= stripe_integration exists');
}

// Register in journal
const latest = await c.execute('SELECT MAX(created_at) AS m FROM __drizzle_migrations');
const baseTs = Number((latest.rows[0] as { m: number }).m ?? Date.now() * 1000);
const when = baseTs + 100;
const sql = readFileSync('drizzle/0298_stripe_integration.sql', 'utf8');
const hash = createHash('sha256').update(sql).digest('hex');
const exists = await c.execute({
	sql: 'SELECT id FROM __drizzle_migrations WHERE hash = ?',
	args: [hash]
});
if (exists.rows.length === 0) {
	await c.execute({
		sql: 'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)',
		args: [hash, when]
	});
	console.log(`Registered 0298 (when=${when})`);
}
const journalPath = 'drizzle/meta/_journal.json';
const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
const known = new Set(journal.entries.map((e: { tag: string }) => e.tag));
if (!known.has('0298_stripe_integration')) {
	journal.entries.push({
		idx: 298,
		version: '6',
		when,
		tag: '0298_stripe_integration',
		breakpoints: true
	});
	writeFileSync(journalPath, JSON.stringify(journal, null, '\t') + '\n');
	console.log('Journal updated');
}
console.log('Done');
process.exit(0);
