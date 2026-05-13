#!/usr/bin/env bun
// Apply H6 schema change + backfill directly via libsql client.
// Idempotent: checks if column already exists before altering.
import { createClient } from '@libsql/client';

const client = createClient({
	url: process.env.SQLITE_URI!,
	authToken: process.env.SQLITE_AUTH_TOKEN
});

const cols = await client.execute("PRAGMA table_info('hosting_account')");
const colNames = (cols.rows as Array<{ name: string }>).map((r) => r.name);

if (colNames.includes('auto_suspended_by_invoice_id')) {
	console.log('Column already exists, skipping ALTER');
} else {
	console.log('Adding column auto_suspended_by_invoice_id...');
	await client.execute(
		"ALTER TABLE hosting_account ADD COLUMN auto_suspended_by_invoice_id text"
	);
	console.log('Column added');
}

console.log('Backfilling from suspend_reason...');
const result = await client.execute({
	sql: `UPDATE hosting_account
	      SET auto_suspended_by_invoice_id = (
	          SELECT invoice.id
	          FROM invoice
	          WHERE invoice.tenant_id = hosting_account.tenant_id
	            AND invoice.invoice_number = REPLACE(hosting_account.suspend_reason, 'Overdue invoice ', '')
	          LIMIT 1
	      )
	      WHERE hosting_account.status = 'suspended'
	        AND hosting_account.suspend_reason LIKE 'Overdue invoice %'
	        AND hosting_account.auto_suspended_by_invoice_id IS NULL`,
	args: []
});
console.log('Backfill rows affected:', result.rowsAffected);

const verify = await client.execute(
	"SELECT COUNT(*) AS total, SUM(CASE WHEN auto_suspended_by_invoice_id IS NOT NULL THEN 1 ELSE 0 END) AS linked FROM hosting_account WHERE status = 'suspended' AND suspend_reason LIKE 'Overdue invoice %'"
);
const row = verify.rows[0] as { total: number; linked: number };
console.log(`Verification: ${row.linked}/${row.total} overdue-suspended accounts now have FK populated`);
process.exit(0);
