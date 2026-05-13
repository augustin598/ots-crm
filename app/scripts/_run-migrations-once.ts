#!/usr/bin/env bun
// One-shot migration runner. Reads SQLITE_URI/SQLITE_AUTH_TOKEN from process env
// (load .env yourself before running) and applies all pending migrations in
// ./drizzle. Safe to run multiple times — drizzle skips already-applied ones.
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';

const url = process.env.SQLITE_URI;
const authToken = process.env.SQLITE_AUTH_TOKEN;
const sqlitePath = process.env.SQLITE_PATH;

if (!url && !sqlitePath) {
	console.error('Missing SQLITE_URI or SQLITE_PATH in env');
	process.exit(1);
}

const client = sqlitePath
	? createClient({ url: `file:${sqlitePath}`, authToken: undefined })
	: createClient({
			url: url!,
			authToken,
			fetch: (input, init) => {
				const { signal: _ignored, ...rest } = init || {};
				return fetch(input, { ...rest, signal: AbortSignal.timeout(60_000) });
			}
		});

const db = drizzle(client);
console.log(`Applying migrations from ./drizzle to ${sqlitePath ?? url}`);
await migrate(db, { migrationsFolder: './drizzle' });
console.log('Migrations applied successfully');
process.exit(0);
