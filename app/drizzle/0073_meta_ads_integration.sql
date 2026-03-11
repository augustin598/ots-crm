-- Meta Ads Integration table (multiple per tenant — one per Business Manager)
CREATE TABLE IF NOT EXISTS `meta_ads_integration` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`business_id` text NOT NULL,
	`business_name` text NOT NULL DEFAULT '',
	`email` text NOT NULL DEFAULT '',
	`access_token` text NOT NULL DEFAULT '',
	`token_expires_at` timestamp,
	`is_active` number NOT NULL DEFAULT 0,
	`sync_enabled` number NOT NULL DEFAULT 1,
	`last_sync_at` timestamp,
	`last_sync_results` text,
	`created_at` timestamp NOT NULL DEFAULT current_date,
	`updated_at` timestamp NOT NULL DEFAULT current_date
);

-- Unique: one integration per tenant + Business Manager ID
CREATE UNIQUE INDEX IF NOT EXISTS `meta_ads_integration_tenant_bm` ON `meta_ads_integration` (`tenant_id`, `business_id`);

-- Meta Ads ad accounts cached from Business Manager, with CRM client mapping
CREATE TABLE IF NOT EXISTS `meta_ads_account` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`integration_id` text NOT NULL REFERENCES `meta_ads_integration`(`id`) ON DELETE CASCADE,
	`meta_ad_account_id` text NOT NULL,
	`account_name` text NOT NULL DEFAULT '',
	`client_id` text REFERENCES `client`(`id`),
	`is_active` number NOT NULL DEFAULT 1,
	`last_fetched_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT current_date,
	`updated_at` timestamp NOT NULL DEFAULT current_date
);

-- Unique: one row per tenant + Meta ad account ID
CREATE UNIQUE INDEX IF NOT EXISTS `meta_ads_account_tenant_adaccount` ON `meta_ads_account` (`tenant_id`, `meta_ad_account_id`);

-- Meta Ads invoices synced from Business Manager
CREATE TABLE IF NOT EXISTS `meta_ads_invoice` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`integration_id` text NOT NULL REFERENCES `meta_ads_integration`(`id`),
	`client_id` text NOT NULL REFERENCES `client`(`id`),
	`meta_ad_account_id` text NOT NULL,
	`meta_invoice_id` text NOT NULL,
	`invoice_number` text,
	`issue_date` timestamp,
	`due_date` timestamp,
	`amount_cents` integer,
	`currency_code` text NOT NULL DEFAULT 'USD',
	`invoice_type` text DEFAULT 'INVOICE',
	`payment_status` text,
	`pdf_path` text,
	`status` text NOT NULL DEFAULT 'synced',
	`synced_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT current_date,
	`updated_at` timestamp NOT NULL DEFAULT current_date
);

-- Unique index for deduplication
CREATE UNIQUE INDEX IF NOT EXISTS `meta_ads_invoice_dedup` ON `meta_ads_invoice` (`tenant_id`, `meta_invoice_id`);
