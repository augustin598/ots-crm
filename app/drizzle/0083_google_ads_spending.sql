-- Google Ads spending table for periodic spend data (mirrors meta_ads_spending / tiktok_ads_spending)
CREATE TABLE IF NOT EXISTS `google_ads_spending` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`client_id` text NOT NULL REFERENCES `client`(`id`),
	`google_ads_customer_id` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`spend_amount` text NOT NULL DEFAULT '0',
	`spend_cents` integer NOT NULL DEFAULT 0,
	`currency_code` text NOT NULL DEFAULT 'EUR',
	`impressions` integer DEFAULT 0,
	`clicks` integer DEFAULT 0,
	`conversions` integer DEFAULT 0,
	`synced_at` timestamp,
	`created_at` timestamp DEFAULT (current_date) NOT NULL,
	`updated_at` timestamp DEFAULT (current_date) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `google_ads_spending_tenant_idx` ON `google_ads_spending`(`tenant_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `google_ads_spending_client_idx` ON `google_ads_spending`(`client_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `google_ads_spending_period_idx` ON `google_ads_spending`(`tenant_id`, `google_ads_customer_id`, `period_start`);
