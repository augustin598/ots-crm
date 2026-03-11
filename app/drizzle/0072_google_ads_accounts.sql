-- Google Ads sub-accounts cached from MCC, with CRM client mapping
CREATE TABLE IF NOT EXISTS `google_ads_account` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenant`(`id`),
	`google_ads_customer_id` text NOT NULL,
	`account_name` text NOT NULL,
	`client_id` text REFERENCES `client`(`id`),
	`is_active` number NOT NULL DEFAULT 1,
	`last_fetched_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT current_date,
	`updated_at` timestamp NOT NULL DEFAULT current_date
);

-- Unique: one row per tenant + Google Ads customer ID
CREATE UNIQUE INDEX IF NOT EXISTS `google_ads_account_tenant_customer` ON `google_ads_account` (`tenant_id`, `google_ads_customer_id`);
