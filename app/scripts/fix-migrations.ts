#!/usr/bin/env bun
/**
 * Post-generate script: adds IF NOT EXISTS to CREATE TABLE/INDEX in migration SQL
 * files, and ridică `when`-ul intrărilor noi din jurnal peste maximul existent.
 *
 * Run after `drizzle-kit generate`:
 *   bun run db:generate && bun run scripts/fix-migrations.ts
 *
 * Or use the combined script:
 *   bun run db:gen
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const DRIZZLE_DIR = join(import.meta.dir, '..', 'drizzle');

/**
 * Doar migrările care nu sunt încă în git. Cele comise au rulat deja pe
 * producție; a le rescrie ar produce un diff de zeci de fișiere fără niciun
 * efect real și ar ascunde, printre ele, schimbările care chiar contează.
 */
function uncommittedSqlFiles(): Set<string> | null {
	try {
		const out = execSync('git ls-files --others --exclude-standard -- drizzle/*.sql', {
			cwd: join(import.meta.dir, '..'),
			encoding: 'utf8'
		});
		return new Set(out.split('\n').filter(Boolean).map((f) => f.replace(/^drizzle\//, '')));
	} catch {
		return null; // în afara unui repo git: tratează toate fișierele
	}
}
const JOURNAL = join(DRIZZLE_DIR, 'meta', '_journal.json');

type JournalEntry = { idx: number; version: string; when: number; tag: string; breakpoints: boolean };

/**
 * Migrațiile se aplică doar dacă `when`-ul lor e mai mare decât cel al ultimei
 * migrări deja aplicate. Jurnalul ăsta a ajuns pe o scară de timp cu trei ordine
 * de mărime peste ceasul real, deci o intrare nouă pusă de `drizzle-kit generate`
 * (care folosește `Date.now()`) ar cădea sub maxim și n-ar rula niciodată, fără
 * niciun mesaj de eroare.
 *
 * Ridicăm doar intrările de după cea care ține maximul. Cele istorice rămân cum
 * sunt: sunt aplicate peste tot, iar rescrierea lor ar putea reporni migrări pe o
 * bază oprită la jumătate.
 */
async function fixJournalOrder(): Promise<void> {
	const journal = JSON.parse(await readFile(JOURNAL, 'utf8')) as { entries: JournalEntry[] };
	const entries = journal.entries;
	if (entries.length === 0) return;

	let maxAt = 0;
	for (let i = 1; i < entries.length; i++) {
		if (entries[i].when > entries[maxAt].when) maxAt = i;
	}

	let running = entries[maxAt].when;
	let bumped = 0;
	for (let i = maxAt + 1; i < entries.length; i++) {
		if (entries[i].when <= running) {
			entries[i].when = running + 1;
			bumped++;
		}
		running = entries[i].when;
	}

	if (bumped > 0) {
		await writeFile(JOURNAL, JSON.stringify(journal, null, 2) + '\n');
		console.log(`Journal: ${bumped} intrare(i) ridicate peste maximul existent.`);
	}
}

async function fixMigrations() {
	const files = await readdir(DRIZZLE_DIR);
	const untracked = uncommittedSqlFiles();
	const sqlFiles = files.filter((f) => f.endsWith('.sql') && (untracked === null || untracked.has(f)));

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

	await fixJournalOrder();
}

fixMigrations().catch((e) => {
	console.error(e);
	process.exit(1);
});
