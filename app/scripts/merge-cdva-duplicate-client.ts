#!/usr/bin/env bun
/**
 * Merge duplicatul CDVA GLOBAL TECHNOLOGY LTD rămas din importul WHMCS 2026-05-12.
 *
 * De ce a scăpat de merge-duplicate-hosting-clients.ts (2026-05-20): scriptul acela
 * alege drept canonic „rândul care ARE cui" — aici ambele au cui, pentru că matching-ul
 * din client-matching.ts compară CUI-ul normalizat din payload (`10440695`) cu valoarea
 * BRUTĂ din coloană (`CY10440695U`) → nu s-au potrivit și s-a creat un client nou.
 *
 * Canonic  mt623f467obv5xthpb7rgkvj  (13.01.2026) — cui CY10440695U, keez_partner_id,
 *                                     adresă reală în Cipru, client_since 2025-01-14, LTV
 * Orfan    teyhhndluha47figmi5hbqa2  (12.05.2026) — cui 10440695, whmcs #26,
 *                                     deține 2 conturi hosting + 2 facturi recurente
 *
 * Ce face:
 *   1. Reasignează pe canonic TOATE referințele orfanului (scanează toate coloanele
 *      `client_id` / `matched_client_id` din DB, nu doar hosting)
 *   2. Mută pe canonic câmpurile pe care le are doar orfanul: email, phone, postal_code,
 *      whmcs_client_id (emailul se șterge întâi de pe orfan — UNIQUE(tenant_id, email))
 *   3. Setează legal_representative = 'Dragoș Costea' (confirmat de client)
 *   4. Backup JSON + șterge orfanul
 *
 * Se păstrează de la canonic: cui CY10440695U, vat_number, adresa, țara Cipru,
 * keez_partner_id, client_since, tier, ltv_cents.
 *
 * Rulare:
 *   bun scripts/merge-cdva-duplicate-client.ts            (dry-run; implicit)
 *   bun scripts/merge-cdva-duplicate-client.ts --apply    (scrie în DB)
 *
 * Idempotent — dacă orfanul nu mai există, iese fără să facă nimic.
 */
import { createClient } from '@libsql/client';
import { writeFileSync } from 'node:fs';

const CANONICAL_ID = 'mt623f467obv5xthpb7rgkvj';
const ORPHAN_ID = 'teyhhndluha47figmi5hbqa2';
const LEGAL_REPRESENTATIVE = 'Dragoș Costea';

const APPLY = process.argv.includes('--apply');

const env = process.env;
if (!env.SQLITE_URI) {
	console.error('SQLITE_URI nu e setat. Rulează întâi: `set -a && source .env && set +a`');
	process.exit(1);
}

const db = createClient({ url: env.SQLITE_URI, authToken: env.SQLITE_AUTH_TOKEN });

console.log(APPLY ? '*** APPLY — se scrie în DB ***' : '*** DRY-RUN — nu se scrie nimic ***');
console.log('');

// ── 0. Ambele rânduri există? ───────────────────────────────────────────────
const rows = await db.execute({
	sql: 'SELECT * FROM client WHERE id IN (?, ?)',
	args: [CANONICAL_ID, ORPHAN_ID]
});
const canonical = rows.rows.find((r: any) => r.id === CANONICAL_ID) as any;
const orphan = rows.rows.find((r: any) => r.id === ORPHAN_ID) as any;

if (!orphan) {
	console.log('Orfanul nu mai există — merge deja făcut. Nimic de făcut.');
	process.exit(0);
}
if (!canonical) {
	console.error(`Clientul canonic ${CANONICAL_ID} nu există. Abort.`);
	process.exit(1);
}
if (canonical.tenant_id !== orphan.tenant_id) {
	console.error('Tenant-uri diferite. Abort.');
	process.exit(1);
}

console.log(`Canonic: ${canonical.name}  cui=${canonical.cui}  email=${canonical.email ?? '—'}`);
console.log(`Orfan:   ${orphan.name}  cui=${orphan.cui}  email=${orphan.email ?? '—'}`);
console.log('');

// ── 1. Referințele orfanului ────────────────────────────────────────────────
const refCols = await db.execute(`
  SELECT m.name AS tbl, p.name AS col
  FROM sqlite_master m JOIN pragma_table_info(m.name) p
  WHERE m.type = 'table' AND m.name <> 'client'
    AND p.name IN ('client_id', 'matched_client_id')
`);

const refs: { tbl: string; col: string; count: number }[] = [];
for (const rc of refCols.rows as any[]) {
	const res = await db.execute({
		sql: `SELECT COUNT(*) AS c FROM "${rc.tbl}" WHERE "${rc.col}" = ?`,
		args: [ORPHAN_ID]
	});
	const c = Number((res.rows[0] as any).c);
	if (c > 0) refs.push({ tbl: rc.tbl, col: rc.col, count: c });
}

console.log(`Referințe de reasignat (${refs.length} tabele):`);
for (const r of refs) console.log(`  ${r.tbl}.${r.col} → ${r.count} rânduri`);
if (refs.length === 0) console.log('  (niciuna)');
console.log('');

// ── 2. Câmpuri de mutat pe canonic ──────────────────────────────────────────
const FIELDS_TO_COPY = ['email', 'phone', 'postal_code', 'whmcs_client_id'] as const;
const updates: Record<string, unknown> = {};
for (const f of FIELDS_TO_COPY) {
	if (canonical[f] == null && orphan[f] != null) updates[f] = orphan[f];
}
if (canonical.legal_representative == null) updates.legal_representative = LEGAL_REPRESENTATIVE;

console.log('Câmpuri de completat pe canonic:');
for (const [k, v] of Object.entries(updates)) console.log(`  ${k} = ${JSON.stringify(v)}`);
if (Object.keys(updates).length === 0) console.log('  (niciunul)');
console.log('');

if (!APPLY) {
	console.log('Dry-run terminat. Rulează cu --apply pentru a aplica.');
	process.exit(0);
}

// ── 3. Backup ───────────────────────────────────────────────────────────────
const stamp = (await db.execute("SELECT strftime('%Y%m%d-%H%M%S','now') AS s")).rows[0] as any;
const backupPath = `cdva-merge-backup-${stamp.s}.json`;
writeFileSync(backupPath, JSON.stringify({ canonical, orphan, refs }, null, 2));
console.log(`Backup scris: ${backupPath}`);
console.log('');

// ── 4. Reasignare referințe ─────────────────────────────────────────────────
for (const r of refs) {
	await db.execute({
		sql: `UPDATE "${r.tbl}" SET "${r.col}" = ? WHERE "${r.col}" = ?`,
		args: [CANONICAL_ID, ORPHAN_ID]
	});
	console.log(`  reasignat  ${r.tbl}.${r.col}  (${r.count} rânduri)`);
}

// ── 5. Copiere câmpuri (emailul se eliberează întâi de pe orfan) ────────────
if (Object.keys(updates).length > 0) {
	if ('email' in updates) {
		await db.execute({ sql: 'UPDATE client SET email = NULL WHERE id = ?', args: [ORPHAN_ID] });
	}
	const setSql = Object.keys(updates)
		.map((k) => `"${k}" = ?`)
		.join(', ');
	await db.execute({
		sql: `UPDATE client SET ${setSql}, updated_at = ? WHERE id = ?`,
		args: [...Object.values(updates), new Date().toISOString(), CANONICAL_ID] as any
	});
	console.log(`  completat canonic: ${Object.keys(updates).join(', ')}`);
}

// ── 6. Verificare finală + ștergere orfan ───────────────────────────────────
let leftover = 0;
for (const rc of refCols.rows as any[]) {
	const res = await db.execute({
		sql: `SELECT COUNT(*) AS c FROM "${rc.tbl}" WHERE "${rc.col}" = ?`,
		args: [ORPHAN_ID]
	});
	leftover += Number((res.rows[0] as any).c);
}
if (leftover > 0) {
	console.error(`\nAu rămas ${leftover} referințe către orfan — NU îl șterg. Verifică manual.`);
	process.exit(1);
}

await db.execute({ sql: 'DELETE FROM client WHERE id = ?', args: [ORPHAN_ID] });
console.log(`  șters orfanul ${ORPHAN_ID}`);
console.log('');
console.log('Merge complet.');
