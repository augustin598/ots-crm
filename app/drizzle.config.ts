import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	schema: 'src/lib/server/db/schema.ts',
	dialect: 'turso',
	dbCredentials: process.env.SQLITE_PATH
		? {
				url: `file:${process.env.SQLITE_PATH}`,
				authToken: undefined
			}
		: {
				url: process.env.SQLITE_URI || '',
				authToken: process.env.SQLITE_AUTH_TOKEN || ''
			},
	verbose: true,
	strict: true
});
