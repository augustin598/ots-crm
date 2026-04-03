#!/usr/bin/env bun
/**
 * Post-generate script: adds IF NOT EXISTS to CREATE TABLE/INDEX in migration SQL files.
 *
 * Run after `drizzle-kit generate`:
 *   bun run db:generate && bun run scripts/fix-migrations.ts
 *
 * Or use the combined script:
 *   bun run db:gen
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const DRIZZLE_DIR = join(import.meta.dir, '..', 'drizzle');

async function fixMigrations() {
	const files = await readdir(DRIZZLE_DIR);
	const sqlFiles = files.filter((f) => f.endsWith('.sql'));

	let fixed = 0;

	for (const file of sqlFiles) {
		const filePath = join(DRIZZLE_DIR, file);
		const original = await readFile(filePath, 'utf8');
		let content = original;

		// CREATE TABLE `name` → CREATE TABLE IF NOT EXISTS `name`
		content = content.replace(
			/CREATE TABLE (?!IF NOT EXISTS)(`\w+`)/g,
			'CREATE TABLE IF NOT EXISTS $1'
		);

		// CREATE INDEX `name` → CREATE INDEX IF NOT EXISTS `name`
		content = content.replace(
			/CREATE INDEX (?!IF NOT EXISTS)(`\w+`)/g,
			'CREATE INDEX IF NOT EXISTS $1'
		);

		// CREATE UNIQUE INDEX `name` → CREATE UNIQUE INDEX IF NOT EXISTS `name`
		content = content.replace(
			/CREATE UNIQUE INDEX (?!IF NOT EXISTS)(`\w+`)/g,
			'CREATE UNIQUE INDEX IF NOT EXISTS $1'
		);

		if (content !== original) {
			await writeFile(filePath, content);
			console.log(`Fixed: ${file}`);
			fixed++;
		}
	}

	console.log(`\nDone. ${fixed} file(s) updated, ${sqlFiles.length - fixed} already OK.`);
}

fixMigrations().catch((e) => {
	console.error(e);
	process.exit(1);
});
