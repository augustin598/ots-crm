#!/usr/bin/env bun
/**
 * Read-only: găsește client_id, meta_page_id și lead_form_id pentru beonemedical.ro
 * Necesar pentru lansarea unei campanii Meta Ads OUTCOME_LEADS.
 * Nu modifică nimic în DB.
 */
import { createClient } from '@libsql/client';
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(import.meta.dir, '..', '.env') });

const url = process.env.SQLITE_URI;
const authToken = process.env.SQLITE_AUTH_TOKEN;
if (!url) {
	console.error('SQLITE_URI not set');
	process.exit(1);
}

const db = createClient({ url, authToken });

async function main() {
	// 1. Găsește clientul
	const clientRows = await db.execute({
		sql: `SELECT id, name, website, email, business_name FROM client
		      WHERE website LIKE '%beonemedical%'
		         OR name LIKE '%beonemedical%'
		         OR business_name LIKE '%beonemedical%'
		         OR email LIKE '%beonemedical%'`,
		args: []
	});

	if (clientRows.rows.length === 0) {
		console.log('\n❌ Nu s-a găsit niciun client cu "beonemedical" în website/name/business_name/email.');
		console.log('Verifică manual în tabela client.');
		return;
	}

	console.log(`\n✅ Client(i) găsiți: ${clientRows.rows.length}`);

	for (const row of clientRows.rows) {
		const clientId = row.id as string;
		const clientName = row.name as string;
		const clientWebsite = row.website as string;

		console.log('\n=== CLIENT ===');
		console.log(JSON.stringify({ client_id: clientId, client_name: clientName, website: clientWebsite }, null, 2));

		// 2. Meta Ad Accounts pentru acest client
		const adAccountRows = await db.execute({
			sql: `SELECT id, meta_ad_account_id, account_name, status, integration_id
			      FROM meta_ads_account
			      WHERE client_id = ?`,
			args: [clientId]
		});

		console.log('\n=== META AD ACCOUNTS ===');
		if (adAccountRows.rows.length === 0) {
			console.log('  ⚠️  Niciun ad account asociat acestui client.');
		} else {
			for (const a of adAccountRows.rows) {
				console.log(JSON.stringify({
					id: a.id,
					meta_ad_account_id: a.meta_ad_account_id,
					account_name: a.account_name,
					status: a.status,
					integration_id: a.integration_id
				}, null, 2));
			}
		}

		// 3. Meta Pages pentru acest client
		const pageRows = await db.execute({
			sql: `SELECT id, meta_page_id, page_name, status, integration_id
			      FROM meta_ads_page
			      WHERE client_id = ?`,
			args: [clientId]
		});

		console.log('\n=== META PAGES ===');
		if (pageRows.rows.length === 0) {
			console.log('  ⚠️  Nicio pagină Meta asociată acestui client.');
			console.log('  → Trebuie conectată o pagină Facebook din Meta Business Manager.');
		} else {
			for (const p of pageRows.rows) {
				console.log(JSON.stringify({
					id: p.id,
					meta_page_id: p.meta_page_id,
					page_name: p.page_name,
					status: p.status,
					integration_id: p.integration_id
				}, null, 2));
			}
		}

		// 4. Lead Forms — dacă există tabelă meta_lead_form
		const hasLeadFormTable = await db.execute({
			sql: `SELECT name FROM sqlite_master WHERE type='table' AND name='meta_lead_form'`,
			args: []
		});

		console.log('\n=== META LEAD FORMS ===');
		if (hasLeadFormTable.rows.length === 0) {
			console.log('  ℹ️  Tabela meta_lead_form nu există în schema curentă.');
			console.log('  → Lead forms nu sunt cache-uite în CRM; trebuie preluate live din Meta API.');
			console.log('  → Folosește GET /me/leadgen_forms?access_token=<PAGE_ACCESS_TOKEN> pe fiecare pagină.');
		} else {
			const formRows = await db.execute({
				sql: `SELECT id, form_id, form_name, page_id, status
				      FROM meta_lead_form
				      WHERE client_id = ?`,
				args: [clientId]
			});
			if (formRows.rows.length === 0) {
				console.log('  ⚠️  Niciun lead form cache-uit pentru acest client.');
			} else {
				for (const f of formRows.rows) {
					console.log(JSON.stringify(f, null, 2));
				}
			}
		}

		// 5. Sumar final
		const firstPage = pageRows.rows[0];
		const firstAdAccount = adAccountRows.rows[0];

		console.log('\n=== SUMAR PENTRU CAMPANIE OUTCOME_LEADS ===');
		console.log(JSON.stringify({
			client_id: clientId,
			meta_ad_account_id: firstAdAccount ? firstAdAccount.meta_ad_account_id : '❌ LIPSĂ',
			meta_page_id: firstPage ? firstPage.meta_page_id : '❌ LIPSĂ',
			lead_form_id: '→ Preia live din Meta API cu page_access_token (nu e cache-uit în CRM)'
		}, null, 2));
	}

	// Fallback: dacă nu s-a găsit clientul, caută toate paginile Meta ca să vedem ce e disponibil
	if (clientRows.rows.length === 0) {
		const allPages = await db.execute({
			sql: `SELECT p.id, p.meta_page_id, p.page_name, p.client_id, c.name as client_name, c.domain
			      FROM meta_ads_page p
			      LEFT JOIN client c ON c.id = p.client_id
			      ORDER BY p.page_name
			      LIMIT 20`,
			args: []
		});
		console.log('\n=== TOATE PAGINILE META DIN SISTEM ===');
		for (const p of allPages.rows) {
			console.log(JSON.stringify(p, null, 2));
		}
	}
}

main().catch(console.error).finally(() => db.close());
