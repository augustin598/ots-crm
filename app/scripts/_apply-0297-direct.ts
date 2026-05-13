#!/usr/bin/env bun
import { createClient } from '@libsql/client';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const c = createClient({
	url: process.env.SQLITE_URI!,
	authToken: process.env.SQLITE_AUTH_TOKEN
});

async function colExists(table: string, col: string) {
	const r = await c.execute(`PRAGMA table_info('${table}')`);
	return (r.rows as Array<{ name: string }>).some((row) => row.name === col);
}
async function tableExists(name: string) {
	const r = await c.execute({
		sql: "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
		args: [name]
	});
	return r.rows.length > 0;
}

const additions = [
	['client', 'legal_type', 'text'],
	['client', 'signup_source', 'text'],
	['client', 'onboarding_status', "text DEFAULT 'active' NOT NULL"],
	['client', 'stripe_customer_id', 'text'],
	['hosting_product', 'stripe_price_id', 'text'],
	['hosting_product', 'stripe_product_id', 'text'],
	['invoice', 'stripe_payment_intent_id', 'text'],
	['invoice', 'stripe_session_id', 'text'],
	['invoice', 'stripe_subscription_id', 'text'],
	['hosting_inquiry', 'stripe_checkout_session_id', 'text'],
	['hosting_inquiry', 'client_created', 'integer DEFAULT 0 NOT NULL'],
	['hosting_inquiry', 'client_created_at', 'text'],
	['hosting_inquiry', 'proforma_invoice_id', 'text']
] as const;

for (const [table, col, type] of additions) {
	if (await colExists(table, col)) {
		console.log(`= ${table}.${col} exists`);
	} else {
		await c.execute(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
		console.log(`+ ${table}.${col}`);
	}
}

if (!(await tableExists('processed_stripe_event'))) {
	await c.execute(`CREATE TABLE processed_stripe_event (
		id text PRIMARY KEY NOT NULL,
		event_type text NOT NULL,
		tenant_id text,
		processed_at text DEFAULT (current_date) NOT NULL,
		FOREIGN KEY (tenant_id) REFERENCES tenant(id)
	)`);
	await c.execute(
		'CREATE INDEX processed_stripe_event_processed_at_idx ON processed_stripe_event (processed_at)'
	);
	await c.execute(
		'CREATE INDEX processed_stripe_event_type_idx ON processed_stripe_event (event_type)'
	);
	console.log('+ table processed_stripe_event');
} else {
	console.log('= processed_stripe_event exists');
}

// Register migration in drizzle journal
const latest = await c.execute('SELECT MAX(created_at) AS m FROM __drizzle_migrations');
const baseTs = Number((latest.rows[0] as { m: number }).m ?? Date.now() * 1000);
const when = baseTs + 100;
const sql = readFileSync('drizzle/0297_stripe_onboarding.sql', 'utf8');
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
	console.log(`Registered 0297 (when=${when})`);
}
const journalPath = 'drizzle/meta/_journal.json';
const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
const known = new Set(journal.entries.map((e: { tag: string }) => e.tag));
if (!known.has('0297_stripe_onboarding')) {
	journal.entries.push({
		idx: 297,
		version: '6',
		when,
		tag: '0297_stripe_onboarding',
		breakpoints: true
	});
	writeFileSync(journalPath, JSON.stringify(journal, null, '\t') + '\n');
	console.log('Journal updated');
}
console.log('Done');
process.exit(0);
