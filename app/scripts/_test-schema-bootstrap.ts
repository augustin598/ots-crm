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

	// --- user + tenant_user (needed for invoice.createdByUserId FK resolution) ---
	await db.run(sql`CREATE TABLE IF NOT EXISTS user (
		id text PRIMARY KEY NOT NULL,
		email text NOT NULL UNIQUE,
		first_name text NOT NULL,
		last_name text NOT NULL,
		username text,
		password_hash text NOT NULL
	)`);

	await db.run(sql`CREATE TABLE IF NOT EXISTS tenant_user (
		id text PRIMARY KEY NOT NULL,
		tenant_id text NOT NULL REFERENCES tenant(id),
		user_id text NOT NULL REFERENCES user(id),
		role text NOT NULL DEFAULT 'member',
		created_at timestamp NOT NULL DEFAULT current_date
	)`);

	// --- invoice_settings (hosting series config) ---
	await db.run(sql`CREATE TABLE IF NOT EXISTS invoice_settings (
		id text PRIMARY KEY,
		tenant_id text NOT NULL UNIQUE REFERENCES tenant(id),
		smartbill_series text,
		smartbill_start_number text,
		smartbill_last_synced_number text,
		smartbill_auto_sync integer NOT NULL DEFAULT 0,
		smartbill_tax_name_apply text,
		smartbill_tax_name_none text,
		smartbill_tax_name_reverse text,
		keez_series text,
		keez_start_number text,
		keez_last_synced_number text,
		keez_auto_sync integer NOT NULL DEFAULT 0,
		keez_default_payment_type_id integer DEFAULT 3,
		default_currency text NOT NULL DEFAULT 'RON',
		default_tax_rate integer NOT NULL DEFAULT 19,
		invoice_emails_enabled integer NOT NULL DEFAULT 1,
		send_invoice_email_enabled integer NOT NULL DEFAULT 1,
		paid_confirmation_email_enabled integer NOT NULL DEFAULT 1,
		overdue_reminder_enabled integer NOT NULL DEFAULT 0,
		overdue_reminder_days_after_due integer NOT NULL DEFAULT 3,
		overdue_reminder_repeat_days integer NOT NULL DEFAULT 7,
		overdue_reminder_max_count integer NOT NULL DEFAULT 3,
		auto_send_recurring_invoices integer NOT NULL DEFAULT 0,
		invoice_logo text,
		keez_series_hosting text,
		keez_start_number_hosting text,
		keez_last_synced_number_hosting text,
		whmcs_auto_push_to_keez integer NOT NULL DEFAULT 0,
		created_at timestamp NOT NULL DEFAULT current_date,
		updated_at timestamp NOT NULL DEFAULT current_date
	)`);

	// --- invoice + invoice_line_item (target for WHMCS invoice create) ---
	await db.run(sql`CREATE TABLE IF NOT EXISTS invoice (
		id text PRIMARY KEY NOT NULL,
		tenant_id text NOT NULL REFERENCES tenant(id),
		client_id text NOT NULL REFERENCES client(id),
		contract_id text,
		project_id text,
		service_id text,
		invoice_number text NOT NULL,
		status text NOT NULL DEFAULT 'draft',
		amount integer,
		tax_rate integer,
		tax_amount integer,
		total_amount integer,
		issue_date timestamp,
		due_date timestamp,
		paid_date timestamp,
		last_email_sent_at timestamp,
		last_email_status text,
		overdue_reminder_count integer NOT NULL DEFAULT 0,
		last_overdue_reminder_at timestamp,
		currency text NOT NULL DEFAULT 'RON',
		notes text,
		invoice_series text,
		invoice_currency text,
		payment_terms text,
		payment_method text,
		exchange_rate text,
		vat_on_collection integer DEFAULT 0,
		is_credit_note integer DEFAULT 0,
		tax_application_type text,
		discount_type text,
		discount_value integer,
		smartbill_series text,
		smartbill_number text,
		remaining_amount integer,
		keez_invoice_id text,
		keez_external_id text,
		keez_status text,
		spv_id text,
		external_source text,
		external_invoice_id integer,
		external_transaction_id text,
		created_by_user_id text NOT NULL REFERENCES user(id),
		created_at timestamp NOT NULL DEFAULT current_date,
		updated_at timestamp NOT NULL DEFAULT current_date
	)`);

	await db.run(sql`CREATE TABLE IF NOT EXISTS invoice_line_item (
		id text PRIMARY KEY NOT NULL,
		invoice_id text NOT NULL REFERENCES invoice(id) ON DELETE CASCADE,
		service_id text,
		description text NOT NULL,
		quantity real NOT NULL DEFAULT 1,
		rate integer NOT NULL,
		amount integer NOT NULL,
		tax_rate integer,
		discount integer,
		discount_type text,
		note text,
		currency text,
		unit_of_measure text,
		keez_item_external_id text,
		created_at timestamp NOT NULL DEFAULT current_date,
		updated_at timestamp NOT NULL DEFAULT current_date
	)`);

	// --- whmcs_invoice_sync ---
	await db.run(sql`CREATE TABLE IF NOT EXISTS whmcs_invoice_sync (
		id text PRIMARY KEY NOT NULL,
		tenant_id text NOT NULL REFERENCES tenant(id),
		whmcs_invoice_id integer NOT NULL,
		invoice_id text REFERENCES invoice(id),
		state text NOT NULL,
		last_event text,
		match_type text,
		last_payload_hash text,
		original_amount real,
		original_currency text,
		original_total_hash text,
		retry_count integer NOT NULL DEFAULT 0,
		last_error_class text,
		last_error_message text,
		raw_payload text,
		received_at timestamp NOT NULL DEFAULT current_date,
		processed_at timestamp
	)`);
	await db.run(
		sql`CREATE UNIQUE INDEX IF NOT EXISTS uniq_whmcs_tenant_invoice ON whmcs_invoice_sync(tenant_id, whmcs_invoice_id)`
	);
	await db.run(
		sql`CREATE INDEX IF NOT EXISTS idx_whmcs_invoice_sync_tenant_state ON whmcs_invoice_sync(tenant_id, state)`
	);
}
