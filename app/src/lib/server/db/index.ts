import { env } from '$env/dynamic/private';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema';

const sqlitePath = env.SQLITE_PATH;
const tursoUrl = env.SQLITE_URI;
const tursoAuthToken = env.SQLITE_AUTH_TOKEN;

let client;

if (sqlitePath) {
	// If SQLITE_PATH is present, use local file with libsql
	client = createClient({
		url: `file:${sqlitePath}`,
		authToken: undefined
	});
} else if (tursoUrl) {
	// Fallback to Turso if URI is set
	client = createClient({
		url: tursoUrl,
		authToken: tursoAuthToken
	});
} else {
	throw new Error('Neither SQLITE_PATH nor Turso database URL is set in environment');
}

export const db = drizzle(client, { schema });
