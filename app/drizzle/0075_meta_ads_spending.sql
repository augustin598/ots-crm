-- Meta Ads spending data synced from /insights endpoint per ad account
CREATE TABLE IF NOT EXISTS `meta_ads_spending` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`integration_id` text NOT NULL REFERENCES `meta_ads_integration`(`id`),
	`client_id` text NOT NULL REFERENCES `client`(`id`),
	`meta_ad_account_id` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`spend_amount` text NOT NULL DEFAULT '0',
	`spend_cents` integer NOT NULL DEFAULT 0,
	`currency_code` text NOT NULL DEFAULT 'RON',
	`impressions` integer DEFAULT 0,
	`clicks` integer DEFAULT 0,
	`pdf_path` text,
	`synced_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT current_date,
	`updated_at` timestamp NOT NULL DEFAULT current_date
);

-- Dedup: one row per tenant + ad account + period start + client
CREATE UNIQUE INDEX IF NOT EXISTS `meta_ads_spending_dedup` ON `meta_ads_spending` (`tenant_id`, `meta_ad_account_id`, `period_start`, `client_id`);
