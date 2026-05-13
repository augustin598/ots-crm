#!/usr/bin/env bun
import { createClient } from '@libsql/client';
const client = createClient({ url: process.env.SQLITE_URI!, authToken: process.env.SQLITE_AUTH_TOKEN });
const res = await client.execute("SELECT hash, created_at FROM __drizzle_migrations ORDER BY id DESC LIMIT 10");
console.log('Last 10 applied migrations:');
for (const r of res.rows as Array<{ hash: string; created_at: number }>) {
	console.log(`  ${new Date(r.created_at).toISOString()}  ${r.hash}`);
}
const cols = await client.execute("PRAGMA table_info('hosting_account')");
console.log('\nhosting_account cols:', (cols.rows as Array<{ name: string }>).map((r) => r.name).join(', '));
process.exit(0);
