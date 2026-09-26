#!/usr/bin/env bun
// Verificare post-migrare 0568: coloana client.portal_scope există și jurnalul remote
// e la `when`-ul intrării noi. Read-only.
import { createClient } from '@libsql/client';

const client = createClient({ url: process.env.SQLITE_URI!, authToken: process.env.SQLITE_AUTH_TOKEN });

const cols = await client.execute("PRAGMA table_info('client')");
const col = (cols.rows as Array<{ name: string; type: string; notnull: number; dflt_value: string | null }>).find(
	(r) => r.name === 'portal_scope'
);
console.log('client.portal_scope:', col ? JSON.stringify(col) : 'LIPSEȘTE');

const last = await client.execute('SELECT max(created_at) AS m FROM __drizzle_migrations');
console.log('max(created_at) remote:', (last.rows[0] as { m: number }).m, '(așteptat 1788786476918026)');

const scopes = await client.execute("SELECT portal_scope, count(*) AS n FROM client GROUP BY portal_scope");
console.log('distribuție portal_scope:', JSON.stringify(scopes.rows));
process.exit(col && (last.rows[0] as { m: number }).m === 1788786476918026 ? 0 : 1);
