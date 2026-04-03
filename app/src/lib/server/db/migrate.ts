import { migrate } from 'drizzle-orm/libsql/migrator';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { env } from '$env/dynamic/private';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

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
			// Fallback to Turso if URI is set — use longer timeout for migrations
			client = createClient({
				url: tursoUrl,
				authToken: tursoAuthToken,
				fetch: (input, init) =>
					fetch(input, { ...init, signal: AbortSignal.timeout(30_000) })
			});
		} else {
			throw new Error('Neither SQLITE_PATH nor Turso database URL is set in environment');
		}

		const db = drizzle(client);

		// Resolve migrations folder path
		// In production (Docker), drizzle is copied to ./build/drizzle
		// In development, drizzle is at ./drizzle
		const cwd = process.cwd();
		const possiblePaths = [
			{ folder: './drizzle', path: resolve(cwd, 'drizzle') },
			{ folder: './build/drizzle', path: resolve(cwd, 'build', 'drizzle') },
			{ folder: '../drizzle', path: resolve(cwd, '..', 'drizzle') }
		];

		let migrationsFolder: string | null = null;
		for (const { folder, path } of possiblePaths) {
			if (existsSync(path)) {
				migrationsFolder = folder;
				break;
			}
		}

		if (!migrationsFolder) {
			const triedPaths = possiblePaths.map((p) => p.path).join(', ');
			throw new Error(
				`Migrations folder not found. Checked: ${triedPaths}. Current working directory: ${cwd}`
			);
		}

		const resolvedPath = possiblePaths.find((p) => p.folder === migrationsFolder)!.path;
		console.log(`Running database migrations from: ${resolvedPath}`);
		await migrate(db, { migrationsFolder });
		console.log('Database migrations completed successfully');
	} catch (error) {
		console.error('Failed to run database migrations:', error);
		throw error;
	}
}
