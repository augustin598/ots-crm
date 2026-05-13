#!/usr/bin/env bun
// Sanity-check the H6 migration applied: verify auto_suspended_by_invoice_id
// column exists on hosting_account and how many rows were backfilled from the
// "Overdue invoice X" suspendReason pattern.
import { createClient } from '@libsql/client';

const url = process.env.SQLITE_URI;
const authToken = process.env.SQLITE_AUTH_TOKEN;

if (!url) {
	console.error('Missing SQLITE_URI');
	process.exit(1);
}

const client = createClient({ url, authToken });

const cols = await client.execute("PRAGMA table_info('hosting_account')");
const colNames = (cols.rows as Array<{ name: string }>).map((r) => r.name);
console.log('hosting_account columns count:', colNames.length);
console.log(
	'auto_suspended_by_invoice_id present:',
	colNames.includes('auto_suspended_by_invoice_id') ? 'YES' : 'NO'
);

const total = await client.execute(
	"SELECT COUNT(*) AS c FROM hosting_account WHERE status = 'suspended' AND suspend_reason LIKE 'Overdue invoice %'"
);
const backfilled = await client.execute(
	"SELECT COUNT(*) AS c FROM hosting_account WHERE auto_suspended_by_invoice_id IS NOT NULL"
);
console.log('Overdue-suspended rows (target):', total.rows[0]?.c);
console.log('Rows with FK populated     :', backfilled.rows[0]?.c);
process.exit(0);
