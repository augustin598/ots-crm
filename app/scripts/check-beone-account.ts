#!/usr/bin/env bun
/**
 * Read-only: verifică live statusul ad account-ului act_818842774503712 (BeOne Medical)
 * Compară datele din CRM DB cu răspunsul direct de la Meta Graph API.
 * Nu modifică nimic în DB.
 *
 * Usage: cd app && bun scripts/check-beone-account.ts
 */
import { createClient } from '@libsql/client';
import { createHmac } from 'node:crypto';
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(import.meta.dir, '..', '.env') });

const SQLITE_URI = process.env.SQLITE_URI;
const SQLITE_AUTH_TOKEN = process.env.SQLITE_AUTH_TOKEN;
const META_APP_SECRET = process.env.META_APP_SECRET;
const AD_ACCOUNT_ID = 'act_818842774503712';
const CLIENT_ID = 'g4gjn3qe6o734r64xiystdst';
const META_GRAPH_URL = 'https://graph.facebook.com/v21.0';

const META_STATUS_CODES: Record<number, string> = {
	1: 'ACTIVE',
	2: 'DISABLED',
	3: 'UNSETTLED',
	7: 'PENDING_RISK_REVIEW',
	8: 'PENDING_SETTLEMENT',
	9: 'IN_GRACE_PERIOD',
	100: 'PENDING_CLOSURE',
	101: 'CLOSED',
	201: 'ANY_ACTIVE',
	202: 'ANY_CLOSED'
};

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
	console.error('[1/4] Citesc ad account din CRM DB...');

	// Citim înregistrarea din CRM DB (join cu integration pentru token)
	const dbRow = await db.execute({
		sql: `SELECT
		        a.id,
		        a.meta_ad_account_id,
		        a.account_name,
		        a.is_active,
		        a.account_status,
		        a.disable_reason,
		        a.payment_status,
		        a.payment_status_raw,
		        a.last_fetched_at,
		        a.integration_id,
		        i.access_token,
		        i.token_expires_at,
		        i.business_name,
		        i.email as integration_email
		      FROM meta_ads_account a
		      JOIN meta_ads_integration i ON i.id = a.integration_id
		      WHERE a.meta_ad_account_id = ?
		      LIMIT 1`,
		args: [AD_ACCOUNT_ID]
	});

	if (dbRow.rows.length === 0) {
		// Încearcă și fără prefix act_
		const dbRow2 = await db.execute({
			sql: `SELECT a.id, a.meta_ad_account_id, a.account_name, a.is_active, a.account_status,
			             a.disable_reason, a.payment_status, a.integration_id, i.access_token
			      FROM meta_ads_account a
			      JOIN meta_ads_integration i ON i.id = a.integration_id
			      WHERE a.client_id = ?
			      LIMIT 5`,
			args: [CLIENT_ID]
		});

		console.log(JSON.stringify({
			ok: false,
			reason: 'ad_account_not_found_in_crm',
			searched_for: AD_ACCOUNT_ID,
			client_accounts_found: dbRow2.rows.map(r => ({
				meta_ad_account_id: r.meta_ad_account_id,
				account_name: r.account_name,
				is_active: r.is_active,
				account_status: r.account_status
			}))
		}, null, 2));

		// Dacă am găsit alt cont pentru client, folosim primul
		if (dbRow2.rows.length === 0) {
			console.error('Nu s-a găsit niciun ad account pentru client_id:', CLIENT_ID);
			process.exit(1);
		}
	}

	const row = dbRow.rows[0] ?? null;
	if (!row) {
		console.error('Nu am putut obține rândul din DB');
		process.exit(1);
	}

	const accessToken = row.access_token as string;
	if (!accessToken) {
		console.error('access_token gol pentru această integrare!');
		process.exit(1);
	}

	const dbStatus = row.account_status as number;
	const dbIsActive = row.is_active as boolean | number;

	console.error(`[2/4] Date CRM DB citite. account_status=${dbStatus}, is_active=${dbIsActive}`);
	console.error('[3/4] Apelez Meta Graph API...');

	// Apel live Meta API
	const appsecretProof = generateAppSecretProof(accessToken, META_APP_SECRET!);
	const fields = 'id,name,account_status,disable_reason,currency,timezone_name,business,age,balance,amount_spent,is_personal,funding_source_details,capabilities';
	const url = `${META_GRAPH_URL}/${AD_ACCOUNT_ID}?fields=${fields}&appsecret_proof=${appsecretProof}&access_token=${accessToken}`;

	let metaData: Record<string, unknown> | null = null;
	let metaError: string | null = null;

	try {
		const signal = AbortSignal.timeout(15000);
		const res = await fetch(url, { signal });
		const json = await res.json() as Record<string, unknown>;

		if (json.error) {
			const err = json.error as Record<string, unknown>;
			metaError = `[${err.code}] ${err.message} (type: ${err.type})`;
		} else {
			metaData = json;
		}
	} catch (e) {
		metaError = String(e);
	}

	console.error('[4/4] Generez raport...\n');

	// Interpretare status Meta
	const metaStatus = metaData ? (metaData.account_status as number) : null;
	const metaStatusLabel = metaStatus != null ? (META_STATUS_CODES[metaStatus] ?? `UNKNOWN(${metaStatus})`) : 'N/A';
	const dbStatusLabel = META_STATUS_CODES[dbStatus] ?? `UNKNOWN(${dbStatus})`;

	// Derivăm is_active din status Meta (1 = activ, 201 = any_active)
	const metaDerivedIsActive = metaStatus != null ? [1, 201].includes(metaStatus) : null;

	const comparison = {
		field_account_status: {
			crm_db: `${dbStatus} (${dbStatusLabel})`,
			meta_live: metaStatus != null ? `${metaStatus} (${metaStatusLabel})` : (metaError ?? 'ERROR')
		},
		field_is_active: {
			crm_db: Boolean(dbIsActive),
			meta_live_derived: metaDerivedIsActive
		},
		field_name: {
			crm_db: row.account_name as string,
			meta_live: metaData?.name ?? 'N/A'
		},
		field_disable_reason: {
			crm_db: row.disable_reason as number,
			meta_live: metaData?.disable_reason ?? 'N/A'
		},
		field_currency: {
			crm_db: 'N/A (not stored)',
			meta_live: metaData?.currency ?? 'N/A'
		},
		field_balance: {
			crm_db: 'N/A (not stored)',
			meta_live: metaData?.balance ?? 'N/A'
		},
		field_amount_spent: {
			crm_db: 'N/A (not stored)',
			meta_live: metaData?.amount_spent ?? 'N/A'
		}
	};

	// Concluzie
	let verdict: string;
	let action: string;

	if (metaError) {
		verdict = 'ERROR_META_API';
		action = `Apelul la Meta API a eșuat: ${metaError}. Verifică tokenul de access (expirat?).`;
	} else if (metaStatus === 1) {
		verdict = 'META_SAYS_ACTIVE_CRM_OUTDATED';
		action = 'Contul este ACTIV la Meta. CRM DB e desincronizat. Trebuie rulat sync-ul Meta Ads sau actualizat manual is_active=true, account_status=1.';
	} else if (metaStatus === 9) {
		verdict = 'GRACE_PERIOD_PAYMENT_NEEDED';
		action = 'Contul e în perioadă de grație (IN_GRACE_PERIOD). Trebuie achitată o factură Meta. Contul e TEMPORAR UTILIZABIL dar va fi dezactivat dacă factura nu e plătită.';
	} else if (metaStatus === 2) {
		verdict = 'ACCOUNT_DISABLED';
		action = 'Contul este dezactivat de Meta. Necesită appeal sau cont nou.';
	} else if (metaStatus === 101) {
		verdict = 'ACCOUNT_CLOSED';
		action = 'Contul este închis definitiv. Necesită cont nou.';
	} else {
		verdict = `STATUS_${metaStatus}_${metaStatusLabel}`;
		action = `Verifică manual semnificația statusului ${metaStatus} în Meta Business Manager.`;
	}

	const report = {
		checked_at: new Date().toISOString(),
		ad_account_id: AD_ACCOUNT_ID,
		client_id: CLIENT_ID,
		crm_integration: {
			id: row.integration_id as string,
			business_name: row.business_name as string,
			email: row.integration_email as string,
			token_expires_at: row.token_expires_at as string,
			token_present: !!accessToken,
			token_length: accessToken.length
		},
		crm_last_fetched_at: row.last_fetched_at as string,
		meta_status_codes_reference: META_STATUS_CODES,
		comparison,
		meta_full_response: metaData,
		meta_api_error: metaError,
		verdict,
		action_needed: action
	};

	console.log(JSON.stringify(report, null, 2));
}

main().catch(console.error).finally(() => db.close());
