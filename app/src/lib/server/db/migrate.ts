import { migrate } from 'drizzle-orm/libsql/migrator';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { env } from '$env/dynamic/private';

/**
 * Run database migrations programmatically
 */
export async function runMigrations() {
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

		const db = drizzle(client);

		console.log('Running database migrations...');
		await migrate(db, { migrationsFolder: './drizzle' });
		console.log('Database migrations completed successfully');
	} catch (error) {
		console.error('Failed to run database migrations:', error);
		throw error;
	}
}
