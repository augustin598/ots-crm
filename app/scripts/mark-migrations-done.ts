import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

// Read journal to get all migrations
const journalPath = join(process.cwd(), 'drizzle', 'meta', '_journal.json');
const journal = JSON.parse(readFileSync(journalPath, 'utf-8'));

const sqlitePath = process.env.SQLITE_PATH;
const tursoUrl = process.env.SQLITE_URI;
const tursoAuthToken = process.env.SQLITE_AUTH_TOKEN;

if (!sqlitePath && !tursoUrl) {
	throw new Error('Neither SQLITE_PATH nor SQLITE_URI environment variable is set');
}

const client = createClient(
	sqlitePath
		? {
				url: `file:${sqlitePath}`,
				authToken: undefined
			}
		: {
				url: tursoUrl!,
				authToken: tursoAuthToken
			}
);

async function markMigrationsDone() {
	try {
		console.log('📝 Marking all migrations as done...\n');

		// Ensure migrations table exists
		console.log('🔍 Checking migrations table...');
		await client.execute(`
			CREATE TABLE IF NOT EXISTS __drizzle_migrations (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				hash TEXT NOT NULL,
				created_at NUMERIC
			)
		`);

		// Check existing migrations
		const existingMigrations = await client.execute('SELECT hash FROM __drizzle_migrations');
		const existingHashes = new Set(existingMigrations.rows.map((row) => row.hash as string));

		console.log(`Found ${existingMigrations.rows.length} existing migration records\n`);

		const drizzleDir = join(process.cwd(), 'drizzle');
		const now = Date.now();
		let inserted = 0;
		let skipped = 0;

		// Process each migration from the journal
		for (const entry of journal.entries) {
			const migrationTag = entry.tag;
			const migrationFile = join(drizzleDir, `${migrationTag}.sql`);

			try {
				// Read migration SQL file
				const sqlContent = readFileSync(migrationFile, 'utf-8');

				// Calculate hash (Drizzle uses SHA-256)
				const hash = createHash('sha256').update(sqlContent).digest('hex');

				// Skip if already exists
				if (existingHashes.has(hash)) {
					console.log(`⏭️  Skipping ${migrationTag} (already exists)`);
					skipped++;
					continue;
				}

				// Insert migration record
				await client.execute({
					sql: 'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)',
					args: [hash, now]
				});

				console.log(`✅ Marked ${migrationTag} as done`);
				inserted++;
			} catch (error) {
				if (error instanceof Error && error.message.includes('ENOENT')) {
					console.warn(`⚠️  Warning: Migration file not found: ${migrationTag}.sql`);
				} else {
					throw error;
				}
			}
		}

		console.log(`\n✨ Done! Inserted ${inserted} migrations, skipped ${skipped} existing ones.`);
	} catch (error) {
		console.error('❌ Error marking migrations as done:', error);
		process.exit(1);
	} finally {
		await client.close();
	}
}

markMigrationsDone();
