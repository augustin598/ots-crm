#!/usr/bin/env bun
/**
 * Șterge clienții orfani creați de importul WHMCS→DirectAdmin din 2026-05-12.
 *
 * Context: importul a rezolvat fiecare `tblclients` prin cascada
 * whmcs_client_id → cui → email → CREATE (vezi src/lib/server/whmcs/client-matching.ts).
 * Rândurile fără `tax_id` și fără `email` au căzut pe CREATE, deși clientul
 * exista deja în CRM → duplicate. Scriptul merge-duplicate-hosting-clients.ts
 * (2026-05-20) a mutat conturile de hosting pe clientul canonic, dar a lăsat
 * intenționat rândurile orfane „pentru review manual". Acesta le curăță.
 *
 * Siguranță:
 *   - candidat = client cu `notes LIKE 'Auto-created from WHMCS import%'`
 *     ȘI care are un omonim (același tenant_id + name) creat mai devreme
 *   - înainte de ștergere se scanează TOATE tabelele cu coloană `client_id` /
 *     `matched_client_id`; orice referință > 0 ⇒ candidatul e SĂRIT (nu e orfan)
 *   - rândurile șterse se salvează în JSON înainte de DELETE
 *
 * Rulare:
 *   bun scripts/delete-orphan-whmcs-clients.ts            (dry-run; implicit)
 *   bun scripts/delete-orphan-whmcs-clients.ts --apply    (scrie în DB)
 *
 * Idempotent — la a doua rulare nu mai găsește nimic.
 */
import { createClient } from '@libsql/client';
import { writeFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');

const env = process.env;
if (!env.SQLITE_URI) {
	console.error('SQLITE_URI nu e setat. Rulează întâi: `set -a && source .env && set +a`');
	process.exit(1);
}

const db = createClient({ url: env.SQLITE_URI, authToken: env.SQLITE_AUTH_TOKEN });

console.log(APPLY ? '*** APPLY — se scrie în DB ***' : '*** DRY-RUN — nu se scrie nimic ***');
console.log('');

// ── 1. Candidați: orfani din import care au un omonim mai vechi ──────────────
const candidates = await db.execute(`
  SELECT c.id, c.tenant_id, c.name, c.cui, c.email, c.whmcs_client_id, c.created_at, c.notes,
         (SELECT COUNT(*) FROM client o
           WHERE o.tenant_id = c.tenant_id AND o.name = c.name
             AND o.id <> c.id AND o.created_at < c.created_at) AS older_twins
  FROM client c
  WHERE c.notes LIKE 'Auto-created from WHMCS import%'
  ORDER BY c.name
`);

const withTwin = candidates.rows.filter((r: any) => Number(r.older_twins) > 0);

console.log(`Clienți marcați „Auto-created from WHMCS import": ${candidates.rows.length}`);
console.log(`Dintre ei, cu omonim mai vechi (candidați la ștergere): ${withTwin.length}`);
console.log('');

if (withTwin.length === 0) {
	console.log('Nimic de făcut.');
	process.exit(0);
}

// ── 2. Toate coloanele care pot referi un client ─────────────────────────────
const refCols = await db.execute(`
  SELECT m.name AS tbl, p.name AS col
  FROM sqlite_master m JOIN pragma_table_info(m.name) p
  WHERE m.type = 'table' AND m.name <> 'client'
    AND p.name IN ('client_id', 'matched_client_id')
`);

console.log(`Se scanează ${refCols.rows.length} coloane de referință per candidat...`);
console.log('');

// ── 3. Verifică fiecare candidat ────────────────────────────────────────────
const toDelete: any[] = [];
const skipped: { row: any; refs: string[] }[] = [];

for (const row of withTwin as any[]) {
	const refs: string[] = [];
	for (const rc of refCols.rows as any[]) {
		const res = await db.execute({
			sql: `SELECT COUNT(*) AS c FROM "${rc.tbl}" WHERE "${rc.col}" = ?`,
			args: [row.id]
		});
		const c = Number((res.rows[0] as any).c);
		if (c > 0) refs.push(`${rc.tbl}.${rc.col}=${c}`);
	}

	if (refs.length === 0) {
		toDelete.push(row);
		console.log(`  ORFAN   ${row.name}  (${row.id}, whmcs #${row.whmcs_client_id})`);
	} else {
		skipped.push({ row, refs });
		console.log(`  SĂRIT   ${row.name}  (${row.id}) — are referințe: ${refs.join(', ')}`);
	}
}

console.log('');
console.log(`De șters: ${toDelete.length}   Sărite: ${skipped.length}`);

if (toDelete.length === 0) {
	console.log('Nimic de șters.');
	process.exit(0);
}

if (!APPLY) {
	console.log('');
	console.log('Dry-run terminat. Rulează cu --apply pentru a șterge.');
	process.exit(0);
}

// ── 4. Backup + DELETE ──────────────────────────────────────────────────────
const backup: any[] = [];
for (const row of toDelete) {
	const full = await db.execute({ sql: 'SELECT * FROM client WHERE id = ?', args: [row.id] });
	backup.push(full.rows[0]);
}

const stamp = (await db.execute("SELECT strftime('%Y%m%d-%H%M%S','now') AS s")).rows[0] as any;
const backupPath = `orphan-clients-backup-${stamp.s}.json`;
writeFileSync(backupPath, JSON.stringify(backup, null, 2));
console.log('');
console.log(`Backup scris: ${backupPath}`);

for (const row of toDelete) {
	await db.execute({ sql: 'DELETE FROM client WHERE id = ?', args: [row.id] });
	console.log(`  șters  ${row.name}  (${row.id})`);
}

console.log('');
console.log(`Gata: ${toDelete.length} clienți orfani șterși.`);
