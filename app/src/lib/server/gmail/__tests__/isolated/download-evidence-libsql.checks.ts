/**
 * Test de integrare pe un libSQL REAL, în memorie.
 *
 * De ce există: `recordDownload` înghite orice eroare de scriere (ca să nu strice
 * descărcarea). Dacă lista de coloane din `onConflictDoUpdate` se desincronizează
 * de indexul unic, SQLite ridică „ON CONFLICT clause does not match any PRIMARY KEY
 * or UNIQUE constraint”, eroarea e înghițită, iar tabela de evidență rămâne goală
 * pentru totdeauna — cu un simplu warning în loguri. Numai un DB adevărat, cu
 * migrările reale aplicate, poate demonstra că ținta conflictului bate indexul.
 *
 * Fișier separat pentru că `mock.module` din Bun e global pe tot rulajul: aici
 * `$lib/server/db` trebuie să fie drizzle-ul real, nu mock-ul din testele unitare.
 */

import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { customType, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Oglinda tabelei din `$lib/server/db/schema.ts` (același helper `timestamp`).
// Nu putem importa schema reală: alt fișier de test o înlocuiește global cu un
// Proxy, iar drizzle are nevoie de obiecte Column adevărate. Numele coloanelor
// sunt verificate mai jos față de migrarea 0443.
const timestamp = customType<{ data: Date }>({
	dataType: () => 'timestamp',
	fromDriver: (value: unknown) => new Date(value as string | number),
	toDriver: (value: unknown) => (value as Date).toISOString()
});

const gmailInvoiceDownload = sqliteTable('gmail_invoice_download', {
	id: text('id').primaryKey(),
	tenantId: text('tenant_id').notNull(),
	gmailMessageId: text('gmail_message_id').notNull(),
	attachmentFilename: text('attachment_filename'),
	bankReference: text('bank_reference'),
	downloadedAt: timestamp('downloaded_at', { withTimezone: true, mode: 'date' }).notNull(),
	downloadedByUserId: text('downloaded_by_user_id')
});

const migrationSql = (file: string) =>
	readFileSync(new URL(`../../../../../../drizzle/${file}`, import.meta.url), 'utf-8');

const CREATE_TABLE_SQL = migrationSql('0443_gmail_invoice_download.sql');
const CREATE_INDEX_SQL = migrationSql('0444_gmail_invoice_download_idx.sql');

const client = createClient({ url: ':memory:' });
// FK-urile trimit la `tenant`/`user`, tabele care nu există în acest DB de test
await client.execute('PRAGMA foreign_keys = OFF');
await client.execute(CREATE_TABLE_SQL);
await client.execute(CREATE_INDEX_SQL);

const warnings: Array<{ message: string; opts?: Record<string, unknown> }> = [];

mock.module('$lib/server/db', () => ({ db: drizzle(client) }));
mock.module('$lib/server/db/schema', () => ({ gmailInvoiceDownload }));
mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logWarning: (_source: string, message: string, opts?: Record<string, unknown>) => {
		warnings.push({ message, opts });
	},
	logError: () => {},
	serializeError: (e: unknown) => String(e),
}));

const { recordDownload } = await import('../../download-evidence');

const rows = async () => {
	const res = await client.execute(
		'SELECT id, tenant_id, gmail_message_id, attachment_filename, bank_reference, downloaded_at, downloaded_by_user_id FROM gmail_invoice_download ORDER BY rowid'
	);
	return res.rows as unknown as Array<Record<string, string | null>>;
};

describe('recordDownload pe libSQL real', () => {
	beforeEach(async () => {
		warnings.length = 0;
		await client.execute('DELETE FROM gmail_invoice_download');
	});

	it('oglinda tabelei folosește exact coloanele din migrarea 0443', () => {
		const migrationColumns = [...CREATE_TABLE_SQL.matchAll(/^\t`([a-z_]+)`/gm)].map((m) => m[1]);
		const mirrored = [
			gmailInvoiceDownload.id.name,
			gmailInvoiceDownload.tenantId.name,
			gmailInvoiceDownload.gmailMessageId.name,
			gmailInvoiceDownload.attachmentFilename.name,
			gmailInvoiceDownload.bankReference.name,
			gmailInvoiceDownload.downloadedAt.name,
			gmailInvoiceDownload.downloadedByUserId.name
		];
		expect(migrationColumns).toEqual(mirrored);
	});

	it('prima descărcare inserează un rând, fără warning înghițit', async () => {
		await recordDownload('t1', 'u1', 'msg-1', 'factura.pdf', '12326');

		expect(warnings).toEqual([]);
		const all = await rows();
		expect(all).toHaveLength(1);
		expect(all[0].tenant_id).toBe('t1');
		expect(all[0].attachment_filename).toBe('factura.pdf');
		expect(all[0].bank_reference).toBe('12326');
	});

	it('a doua descărcare pe aceeași tripletă face UPDATE, nu INSERT', async () => {
		await recordDownload('t1', 'u1', 'msg-1', 'factura.pdf', '12326');
		const first = (await rows())[0];

		await recordDownload('t1', 'u2', 'msg-1', 'factura.pdf', '12999');

		expect(warnings).toEqual([]);
		const all = await rows();
		expect(all).toHaveLength(1);
		expect(all[0].id).toBe(first.id); // rândul original, actualizat
		expect(all[0].downloaded_by_user_id).toBe('u2');
		expect(all[0].bank_reference).toBe('12999');
		expect(String(all[0].downloaded_at) >= String(first.downloaded_at)).toBe(true);
	});

	it('atașamente diferite din același email rămân rânduri separate', async () => {
		await recordDownload('t1', 'u1', 'msg-1', 'factura.pdf');
		await recordDownload('t1', 'u1', 'msg-1', 'anexa.pdf');
		await recordDownload('t2', 'u1', 'msg-1', 'factura.pdf');

		expect(warnings).toEqual([]);
		expect(await rows()).toHaveLength(3);
	});
});
