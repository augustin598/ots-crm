#!/usr/bin/env bun
/**
 * Read-only: listează TOATE Meta Lead Forms de pe pagina BeOne Medical (105493187556063).
 * Nu modifică nimic în DB.
 * Usage: cd app && bun scripts/list-leadforms-beone.ts
 */
import { createClient } from '@libsql/client';
import { createHmac } from 'node:crypto';
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(import.meta.dir, '..', '.env') });

const SQLITE_URI = process.env.SQLITE_URI;
const SQLITE_AUTH_TOKEN = process.env.SQLITE_AUTH_TOKEN;
const META_APP_SECRET = process.env.META_APP_SECRET;
const PAGE_ID = '105493187556063';
const META_GRAPH_URL = 'https://graph.facebook.com/v25.0';

if (!SQLITE_URI) {
	console.error('SQLITE_URI not set');
	process.exit(1);
}
if (!META_APP_SECRET) {
	console.error('META_APP_SECRET not set — necesar pentru appsecret_proof');
	process.exit(1);
}

const db = createClient({ url: SQLITE_URI, authToken: SQLITE_AUTH_TOKEN });

function generateAppSecretProof(accessToken: string, appSecret: string): string {
	return createHmac('sha256', appSecret).update(accessToken).digest('hex');
}

async function main() {
	// 1. Găsește pagina în DB
	const pageRow = await db.execute({
		sql: `SELECT p.id, p.meta_page_id, p.page_name, p.page_access_token, p.client_id,
		             p.integration_id, p.is_monitored, p.last_lead_sync_at,
		             c.name as client_name
		      FROM meta_ads_page p
		      LEFT JOIN client c ON c.id = p.client_id
		      WHERE p.meta_page_id = ?
		      LIMIT 1`,
		args: [PAGE_ID]
	});

	if (pageRow.rows.length === 0) {
		console.log(JSON.stringify({
			ok: false,
			reason: 'page_not_found_in_crm',
			action_needed: `Pagina ${PAGE_ID} nu este conectată în CRM. Conecteaz-o din Meta Ads → Pages.`
		}, null, 2));
		return;
	}

	const page = pageRow.rows[0];
	const pageAccessToken = page.page_access_token as string;

	console.error(`[info] Pagina găsită: ${page.page_name} (client: ${page.client_name ?? 'nealocat'})`);
	console.error(`[info] page_access_token present: ${pageAccessToken ? 'DA' : 'NU'}`);

	if (!pageAccessToken) {
		console.log(JSON.stringify({
			ok: false,
			reason: 'token_missing',
			details: 'page_access_token gol în DB. Reconectează pagina din setările Meta Ads.'
		}, null, 2));
		return;
	}

	// 2. Apel Meta API leadgen_forms
	const proof = generateAppSecretProof(pageAccessToken, META_APP_SECRET!);
	const forms: Array<{ id: string; name: string; status: string; created_time: string }> = [];

	let url: string | null = `${META_GRAPH_URL}/${PAGE_ID}/leadgen_forms?fields=id,name,status,created_time&limit=100&access_token=${pageAccessToken}&appsecret_proof=${proof}`;

	try {
		while (url) {
			const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
			const data: any = await res.json();

			if (data.error) {
				const err = data.error;
				const isAuthError = err.code === 190 || err.code === 102 || err.type === 'OAuthException';
				const isPermError = err.code === 200 || (err.message?.toLowerCase().includes('permission'));

				if (isAuthError) {
					console.log(JSON.stringify({
						ok: false,
						reason: 'token_invalid',
						details: `Meta API error ${err.code}: ${err.message}`,
						action_needed: 'Reconectează pagina Facebook din Meta Ads Settings pentru a reîmprospăta page_access_token.'
					}, null, 2));
					return;
				}
				if (isPermError) {
					console.log(JSON.stringify({
						ok: false,
						reason: 'insufficient_permissions',
						details: `Meta API error ${err.code}: ${err.message}`,
						action_needed: 'Asigură-te că aplicația are permisiunea leads_retrieval și pagina este conectată cu un admin al paginii.'
					}, null, 2));
					return;
				}

				console.log(JSON.stringify({
					ok: false,
					reason: 'meta_api_error',
					details: `Code ${err.code} (${err.type}): ${err.message}`
				}, null, 2));
				return;
			}

			for (const f of data.data || []) {
				forms.push({
					id: f.id,
					name: f.name,
					status: f.status,
					created_time: f.created_time
				});
			}

			url = data.paging?.next || null;
		}
	} catch (err) {
		console.log(JSON.stringify({
			ok: false,
			reason: 'network_error',
			details: err instanceof Error ? err.message : String(err)
		}, null, 2));
		return;
	}

	if (forms.length === 0) {
		console.log(JSON.stringify({
			ok: false,
			reason: 'no_lead_forms_on_page',
			page_id: PAGE_ID,
			page_name: page.page_name,
			action_needed: 'Creează un formular în Meta Business Manager (Lead Ads Forms) pe pagina BeOne Medical.'
		}, null, 2));
		return;
	}

	const activeForms = forms.filter(f => f.status === 'ACTIVE');
	const archivedForms = forms.filter(f => f.status !== 'ACTIVE');

	console.log(JSON.stringify({
		ok: true,
		page_id: PAGE_ID,
		page_name: page.page_name,
		client_name: page.client_name ?? null,
		forms: forms.map(f => ({
			id: f.id,
			name: f.name,
			status: f.status,
			created_time: f.created_time
		})),
		total: forms.length,
		active: activeForms.length,
		archived: archivedForms.length
	}, null, 2));

	if (activeForms.length > 0) {
		console.error(`\n[sumar] ${activeForms.length} formulare ACTIVE:`);
		for (const f of activeForms) {
			console.error(`  ✓ ${f.id}  "${f.name}"`);
		}
	}
	if (archivedForms.length > 0) {
		console.error(`\n[sumar] ${archivedForms.length} formulare ARHIVATE/alte statusuri:`);
		for (const f of archivedForms) {
			console.error(`  ○ ${f.id}  "${f.name}"  (${f.status})`);
		}
	}
}

main().catch(console.error).finally(() => db.close());
