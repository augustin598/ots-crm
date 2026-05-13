#!/usr/bin/env bun
import { createClient } from '@libsql/client';
const client = createClient({ url: process.env.SQLITE_URI!, authToken: process.env.SQLITE_AUTH_TOKEN });
const res = await client.execute("SELECT id, hash, created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 5");
console.log('Last 5 entries by created_at (raw numeric):');
for (const r of res.rows as Array<{ id: number; hash: string; created_at: number }>) {
	console.log(`  id=${r.id}  created_at=${r.created_at}  hash=${r.hash.slice(0, 16)}...`);
}
process.exit(0);
