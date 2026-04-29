/**
 * Full Turso/libSQL database backup → SQL dump file.
 * Streams to disk to avoid OOM on large tables.
 *
 * Usage: bun --bun app/scripts/backup-db.ts [output-path]
 * Default output: backups/YYYY-MM-DD_HHmmss.sql (relative to repo root)
 */

import { createClient, type Row, type Value } from '@libsql/client';
import { createWriteStream, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';

const SQLITE_URI = process.env.SQLITE_URI || Bun.env.SQLITE_URI;
const SQLITE_AUTH_TOKEN = process.env.SQLITE_AUTH_TOKEN || Bun.env.SQLITE_AUTH_TOKEN;

if (!SQLITE_URI) {
	console.error('Missing SQLITE_URI');
	process.exit(1);
}

const client = createClient({ url: SQLITE_URI, authToken: SQLITE_AUTH_TOKEN });

const ts = new Date().toISOString().replace(/[:T]/g, '-').replace(/\..+$/, '');
const outPath = resolve(
	process.argv[2] || `${import.meta.dir}/../../backups/${ts}.sql`
);
mkdirSync(dirname(outPath), { recursive: true });

const out = createWriteStream(outPath);
const write = (s: string) => new Promise<void>((res, rej) => {
	if (!out.write(s)) out.once('drain', () => res());
	else res();
	out.once('error', rej);
});

function escapeValue(v: Value): string {
	if (v === null || v === undefined) return 'NULL';
	if (typeof v === 'number' || typeof v === 'bigint') return String(v);
	if (typeof v === 'boolean') return v ? '1' : '0';
	if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) {
		const bytes = v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array((v as ArrayBufferView).buffer);
		return `X'${Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')}'`;
	}
	return `'${String(v).replace(/'/g, "''")}'`;
}

console.log(`Writing dump → ${outPath}`);
await write(`-- Turso/libSQL backup taken ${new Date().toISOString()}\n`);
await write(`-- Source: ${SQLITE_URI}\n`);
await write(`PRAGMA foreign_keys=OFF;\nBEGIN TRANSACTION;\n\n`);

const tables = await client.execute(
	`SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_litestream%' ORDER BY name`
);

console.log(`Found ${tables.rows.length} tables`);

for (const t of tables.rows) {
	const name = t.name as string;
	const ddl = t.sql as string | null;
	if (!ddl) continue;

	await write(`-- Table: ${name}\nDROP TABLE IF EXISTS "${name}";\n${ddl};\n`);

	const count = (await client.execute(`SELECT COUNT(*) AS c FROM "${name}"`)).rows[0].c as number;
	process.stdout.write(`  ${name.padEnd(40)} ${String(count).padStart(8)} rows`);

	if (count === 0) {
		await write('\n');
		console.log('');
		continue;
	}

	// Stream rows in batches via OFFSET pagination (Turso supports it)
	const batchSize = 1000;
	let offset = 0;
	let written = 0;
	while (offset < count) {
		const batch = await client.execute({
			sql: `SELECT * FROM "${name}" LIMIT ? OFFSET ?`,
			args: [batchSize, offset]
		});
		const cols = batch.columns.map(c => `"${c}"`).join(',');
		for (const row of batch.rows as Row[]) {
			const vals = batch.columns.map(c => escapeValue(row[c])).join(',');
			await write(`INSERT INTO "${name}" (${cols}) VALUES (${vals});\n`);
			written++;
		}
		offset += batchSize;
		process.stdout.write(`\r  ${name.padEnd(40)} ${String(written).padStart(8)}/${count} rows`);
	}
	await write('\n');
	console.log('');
}

// Indexes (excluding auto-generated for primary keys)
const indexes = await client.execute(
	`SELECT name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name`
);
await write(`-- Indexes\n`);
for (const i of indexes.rows) {
	const ddl = i.sql as string;
	await write(`${ddl};\n`);
}

await write(`\nCOMMIT;\nPRAGMA foreign_keys=ON;\n`);

await new Promise<void>((res, rej) => out.end(err => err ? rej(err) : res()));
client.close();

console.log(`\nDone. Backup saved to: ${outPath}`);
