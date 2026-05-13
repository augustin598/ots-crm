#!/usr/bin/env bun
import { createClient } from '@libsql/client';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const client = createClient({
	url: process.env.SQLITE_URI!,
	authToken: process.env.SQLITE_AUTH_TOKEN
});
async function tableExists(name: string): Promise<boolean> {
	const r = await client.execute({
		sql: "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
		args: [name]
	});
	return r.rows.length > 0;
}
if (!(await tableExists('hosting_inquiry'))) {
	const sql = readFileSync('drizzle/0296_hosting_inquiry.sql', 'utf8');
	for (const stmt of sql.split(';').map(s => s.trim()).filter(Boolean)) {
		await client.execute(stmt);
	}
	console.log('+ table hosting_inquiry created');
} else {
	console.log('= hosting_inquiry exists');
}
// Register
const latest = await client.execute('SELECT MAX(created_at) AS m FROM __drizzle_migrations');
const baseTs = Number((latest.rows[0] as { m: number }).m ?? Date.now() * 1000);
const when = baseTs + 100;
const sqlText = readFileSync('drizzle/0296_hosting_inquiry.sql', 'utf8');
const hash = createHash('sha256').update(sqlText).digest('hex');
const exists = await client.execute({ sql: 'SELECT id FROM __drizzle_migrations WHERE hash = ?', args: [hash] });
if (exists.rows.length === 0) {
	await client.execute({ sql: 'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)', args: [hash, when] });
	console.log(`Registered 0296 (when=${when})`);
}
const journalPath = 'drizzle/meta/_journal.json';
const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
const known = new Set(journal.entries.map((e: { tag: string }) => e.tag));
if (!known.has('0296_hosting_inquiry')) {
	journal.entries.push({ idx: 296, version: '6', when, tag: '0296_hosting_inquiry', breakpoints: true });
	writeFileSync(journalPath, JSON.stringify(journal, null, '\t') + '\n');
	console.log('Journal updated');
}
console.log('Done');
process.exit(0);
