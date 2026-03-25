-- Google Ads Integration table
CREATE TABLE IF NOT EXISTS `google_ads_integration` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`email` text NOT NULL,
	`access_token` text NOT NULL,
	`refresh_token` text NOT NULL,
	`token_expires_at` timestamp NOT NULL,
	`is_active` number NOT NULL DEFAULT 1,
	`mcc_account_id` text NOT NULL,
	`developer_token` text NOT NULL,
	`last_sync_at` timestamp,
	`sync_enabled` number NOT NULL DEFAULT 1,
	`last_sync_results` text,
	`created_at` timestamp NOT NULL DEFAULT current_date,
	`updated_at` timestamp NOT NULL DEFAULT current_date
);--> statement-breakpoint

-- Google Ads Invoice table
CREATE TABLE IF NOT EXISTS `google_ads_invoice` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`client_id` text NOT NULL REFERENCES `client`(`id`),
	`google_ads_customer_id` text NOT NULL,
	`google_invoice_id` text NOT NULL,
	`invoice_number` text,
	`issue_date` timestamp,
	`due_date` timestamp,
	`subtotal_amount_micros` integer,
	`total_amount_micros` integer,
	`currency_code` text NOT NULL DEFAULT 'EUR',
	`invoice_type` text,
	`pdf_path` text,
	`status` text NOT NULL DEFAULT 'synced',
	`synced_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT current_date,
	`updated_at` timestamp NOT NULL DEFAULT current_date
);--> statement-breakpoint

-- Unique index for deduplication
CREATE UNIQUE INDEX IF NOT EXISTS `google_ads_invoice_dedup` ON `google_ads_invoice` (`tenant_id`, `google_invoice_id`);--> statement-breakpoint

-- Add Google Ads customer ID column to client table
ALTER TABLE `client` ADD COLUMN `google_ads_customer_id` text;
