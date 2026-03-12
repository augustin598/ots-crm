-- TikTok Ads Integration table (one per tenant connection)
CREATE TABLE IF NOT EXISTS `tiktok_ads_integration` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`app_id` text NOT NULL DEFAULT '',
	`org_id` text NOT NULL DEFAULT '',
	`payment_account_id` text NOT NULL DEFAULT '',
	`email` text NOT NULL DEFAULT '',
	`access_token` text NOT NULL DEFAULT '',
	`refresh_token` text NOT NULL DEFAULT '',
	`token_expires_at` timestamp,
	`refresh_token_expires_at` timestamp,
	`is_active` number NOT NULL DEFAULT 0,
	`sync_enabled` number NOT NULL DEFAULT 1,
	`last_sync_at` timestamp,
	`last_sync_results` text,
	`tt_session_cookies` text,
	`tt_session_status` text NOT NULL DEFAULT 'none',
	`created_at` timestamp NOT NULL DEFAULT current_date,
	`updated_at` timestamp NOT NULL DEFAULT current_date
);

CREATE UNIQUE INDEX IF NOT EXISTS `tiktok_ads_integration_tenant` ON `tiktok_ads_integration` (`tenant_id`, `org_id`);

-- TikTok Ads advertiser accounts cached, with CRM client mapping
CREATE TABLE IF NOT EXISTS `tiktok_ads_account` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`integration_id` text NOT NULL REFERENCES `tiktok_ads_integration`(`id`) ON DELETE CASCADE,
	`tiktok_advertiser_id` text NOT NULL,
	`account_name` text NOT NULL DEFAULT '',
	`client_id` text REFERENCES `client`(`id`),
	`is_active` number NOT NULL DEFAULT 1,
	`last_fetched_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT current_date,
	`updated_at` timestamp NOT NULL DEFAULT current_date
);

CREATE UNIQUE INDEX IF NOT EXISTS `tiktok_ads_account_tenant_adv` ON `tiktok_ads_account` (`tenant_id`, `tiktok_advertiser_id`);

-- TikTok Ads spending data synced from Reporting API per advertiser
CREATE TABLE IF NOT EXISTS `tiktok_ads_spending` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`integration_id` text NOT NULL REFERENCES `tiktok_ads_integration`(`id`),
	`client_id` text NOT NULL REFERENCES `client`(`id`),
	`tiktok_advertiser_id` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`spend_amount` text NOT NULL DEFAULT '0',
	`spend_cents` integer NOT NULL DEFAULT 0,
	`currency_code` text NOT NULL DEFAULT 'RON',
	`impressions` integer DEFAULT 0,
	`clicks` integer DEFAULT 0,
	`conversions` integer DEFAULT 0,
	`pdf_path` text,
	`synced_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT current_date,
	`updated_at` timestamp NOT NULL DEFAULT current_date
);

CREATE UNIQUE INDEX IF NOT EXISTS `tiktok_ads_spending_dedup` ON `tiktok_ads_spending` (`tenant_id`, `tiktok_advertiser_id`, `period_start`, `client_id`);

-- TikTok invoice downloads (billing PDF receipts via cookie-based download)
CREATE TABLE IF NOT EXISTS `tiktok_invoice_download` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`integration_id` text NOT NULL REFERENCES `tiktok_ads_integration`(`id`) ON DELETE CASCADE,
	`client_id` text REFERENCES `client`(`id`),
	`tiktok_advertiser_id` text NOT NULL,
	`ad_account_name` text,
	`tiktok_invoice_id` text NOT NULL,
	`invoice_number` text,
	`amount_cents` integer,
	`currency_code` text NOT NULL DEFAULT 'RON',
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`pdf_path` text,
	`status` text NOT NULL DEFAULT 'pending',
	`downloaded_at` integer,
	`error_message` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS `tiktok_invoice_dl_dedup` ON `tiktok_invoice_download` (`tenant_id`, `tiktok_invoice_id`);

-- Additional indexes for performance
CREATE INDEX IF NOT EXISTS `idx_tiktok_ads_integration_tenant` ON `tiktok_ads_integration`(`tenant_id`);
CREATE INDEX IF NOT EXISTS `idx_tiktok_ads_account_integration` ON `tiktok_ads_account`(`integration_id`);
CREATE INDEX IF NOT EXISTS `idx_tiktok_ads_account_client` ON `tiktok_ads_account`(`client_id`);
CREATE INDEX IF NOT EXISTS `idx_tiktok_ads_spending_tenant` ON `tiktok_ads_spending`(`tenant_id`);
CREATE INDEX IF NOT EXISTS `idx_tiktok_ads_spending_client` ON `tiktok_ads_spending`(`client_id`);
CREATE INDEX IF NOT EXISTS `idx_tiktok_ads_spending_integration` ON `tiktok_ads_spending`(`integration_id`);
CREATE INDEX IF NOT EXISTS `idx_tiktok_invoice_dl_tenant` ON `tiktok_invoice_download`(`tenant_id`);
CREATE INDEX IF NOT EXISTS `idx_tiktok_invoice_dl_integration` ON `tiktok_invoice_download`(`integration_id`);
