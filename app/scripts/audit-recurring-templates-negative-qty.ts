import { createClient } from '@libsql/client';

const db = createClient({
	url: process.env.TURSO_DATABASE_URL!,
	authToken: process.env.TURSO_AUTH_TOKEN
});

const templates = await db.execute(`
  SELECT id, tenant_id, name, line_items_json, invoice_fields_json
  FROM recurring_invoice
  WHERE line_items_json LIKE '%-1%'
     OR line_items_json LIKE '%-2%'
     OR line_items_json LIKE '%-3%'
`);

console.log(`Templates with potentially negative qty: ${templates.rows.length}`);

for (const t of templates.rows) {
	const items = JSON.parse(t.line_items_json as string);
	const isCreditNote = JSON.parse((t.invoice_fields_json as string) ?? '{}').isCreditNote ?? false;
	const negative = items.filter((i: { quantity: number }) => i.quantity < 0);
	if (negative.length > 0) {
		console.log(`\nTemplate ${t.id} (${t.name}):`);
		console.log(`  isCreditNote: ${isCreditNote}`);
		console.log(`  Negative items:`, negative);
		if (!isCreditNote) {
			console.log(`  ⚠️ NEGATIVE QTY WITHOUT isCreditNote — BUG`);
		}
	}
}

process.exit(0);
