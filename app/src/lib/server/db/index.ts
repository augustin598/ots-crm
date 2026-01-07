import { env } from '$env/dynamic/private';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema';

let dbInstance: ReturnType<typeof drizzle>;

try {
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

	dbInstance = drizzle(client, { schema });
} catch (e) {
	console.warn('Database connection failed, using mock:', e);
	dbInstance = {
		select: () => ({
			from: () => ({
				innerJoin: () => ({ where: async () => [] }),
				where: async () => []
			})
		}),
		insert: () => ({ values: async () => {} }),
		update: () => ({ set: () => ({ where: async () => {} }) }),
		delete: () => ({ where: async () => {} })
	} as unknown as ReturnType<typeof drizzle>;
}

export const db = dbInstance;
