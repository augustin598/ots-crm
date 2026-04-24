/**
 * Shared schema bootstrap for WHMCS test scripts.
 *
 * Recreates the subset of CRM tables that our tests touch, matching the
 * column shape in `src/lib/server/db/schema.ts` exactly (Drizzle INSERT
 * expands to every declared column, so partial schemas fail at runtime).
 *
 * Add new tables here as tests need them. Keep in sync with schema.ts —
 * if a column is added in a migration, add it here too.
 *
 * Only CREATE TABLE IF NOT EXISTS + unique indexes. No data.
 */
import { sql } from 'drizzle-orm';
import { db } from '../src/lib/server/db';

let bootstrapped = false;

export async function bootstrapTestSchema(): Promise<void> {
	if (bootstrapped) return;
	bootstrapped = true;

	// --- tenant ---
	await db.run(sql`CREATE TABLE IF NOT EXISTS tenant (
		id text PRIMARY KEY NOT NULL,
		name text NOT NULL,
		slug text NOT NULL UNIQUE,
		website text,
		company_type text,
		cui text,
		registration_number text,
		trade_register text,
		vat_number text,
		legal_representative text,
		iban text,
		iban_euro text,
		bank_name text,
		address text,
		city text,
		county text,
		postal_code text,
		country text DEFAULT 'România',
		phone text,
		email text,
		contract_prefix text DEFAULT 'CTR',
		theme_color text,
		favicon text,
		created_at timestamp DEFAULT current_date NOT NULL,
		updated_at timestamp DEFAULT current_date NOT NULL
	)`);

	// --- client (full schema.ts shape; Drizzle SELECT expands to every column) ---
	await db.run(sql`CREATE TABLE IF NOT EXISTS client (
		id text PRIMARY KEY NOT NULL,
		tenant_id text NOT NULL REFERENCES tenant(id),
		name text NOT NULL,
		business_name text,
		email text,
		phone text,
		website text,
		status text DEFAULT 'prospect',
		company_type text,
		cui text,
		registration_number text,
		trade_register text,
		vat_number text,
		legal_representative text,
		iban text,
		bank_name text,
		address text,
		city text,
		county text,
		postal_code text,
		country text DEFAULT 'România',
		keez_partner_id text,
		notes text,
		google_ads_customer_id text,
		restricted_access text,
		monthly_budget integer,
		budget_warning_threshold integer DEFAULT 80,
		avatar_path text,
		avatar_source text NOT NULL DEFAULT 'whatsapp',
		whmcs_client_id integer,
		created_at timestamp DEFAULT current_date NOT NULL,
		updated_at timestamp DEFAULT current_date NOT NULL
	)`);

	// --- whmcs_integration ---
	await db.run(sql`CREATE TABLE IF NOT EXISTS whmcs_integration (
		id text PRIMARY KEY,
		tenant_id text NOT NULL REFERENCES tenant(id),
		whmcs_url text NOT NULL,
		shared_secret text NOT NULL,
		is_active integer NOT NULL DEFAULT 0,
		enable_keez_push integer NOT NULL DEFAULT 0,
		circuit_breaker_until timestamp,
		consecutive_failures integer NOT NULL DEFAULT 0,
		last_successful_sync_at timestamp,
		last_failure_reason text,
		created_at timestamp NOT NULL DEFAULT current_date,
		updated_at timestamp NOT NULL DEFAULT current_date
	)`);
	await db.run(
		sql`CREATE UNIQUE INDEX IF NOT EXISTS whmcs_integration_tenant_unique ON whmcs_integration(tenant_id)`
	);

	// --- whmcs_client_sync ---
	await db.run(sql`CREATE TABLE IF NOT EXISTS whmcs_client_sync (
		id text PRIMARY KEY NOT NULL,
		tenant_id text NOT NULL REFERENCES tenant(id),
		whmcs_client_id integer NOT NULL,
		client_id text REFERENCES client(id),
		state text NOT NULL,
		match_type text,
		last_event text,
		last_payload_hash text,
		last_error_message text,
		raw_payload text,
		received_at timestamp NOT NULL DEFAULT current_date,
		processed_at timestamp
	)`);
	await db.run(
		sql`CREATE UNIQUE INDEX IF NOT EXISTS uniq_whmcs_tenant_client ON whmcs_client_sync(tenant_id, whmcs_client_id)`
	);
}
